import { useState } from "react";
import type { PluginContext, SettingsField, SettingsSchema } from "../extensions/types";
import { coreHost } from "./CoreOnlyApp";
import { HotkeyRecorder, effectiveHotkey, useHotkeyOverrides } from "./CorePluginSurfaces.tsx";
import { useCoreI18n } from "./core-i18n.ts";
import { Select } from "../ui/index.ts";

/**
 * D17 — Core renders a plugin's declared settings.
 *
 * A plugin describes its panel (`SettingsSchema`) instead of drawing it, so
 * every plugin's settings look like the rest of the app and gain keyboard
 * and label handling for free. Values live in the plugin's own storage under
 * the field's `key`, which is also where the plugin reads them.
 *
 * `mount` remains available for genuinely custom panels; this is the
 * documented default, not the only option.
 */
export function PluginSettingsForm({ pluginId, schema }: { pluginId: string; schema: SettingsSchema }) {
  const { t } = useCoreI18n();
  const plugin = coreHost.getPluginContext(pluginId);
  if (!plugin) return <p className="core-plugin-empty">{t("This plugin is not active.")}</p>;
  return (
    <div className="core-plugin-settings-form">
      {schema.sections.map((section, index) => (
        <section key={section.title ?? index}>
          {section.title && <h3>{section.title}</h3>}
          {section.description && <p className="core-plugin-settings-hint">{section.description}</p>}
          {section.fields.map((field) => (
            <PluginSettingsRow key={field.key} plugin={plugin} field={field} />
          ))}
        </section>
      ))}
    </div>
  );
}

function defaultFor(field: SettingsField): unknown {
  if (field.kind === "toggle") return field.default ?? false;
  if (field.kind === "number") return field.default ?? 0;
  if (field.kind === "select") return field.default ?? field.options[0]?.value ?? "";
  if (field.kind === "text") return field.default ?? "";
  return "";
}

function PluginSettingsRow({ plugin, field }: { plugin: PluginContext; field: SettingsField }) {
  // Storage is the source of truth; this state only mirrors it so the input
  // stays controlled. Reading through `?? defaultFor` rather than writing the
  // default on first render means a plugin that never had its settings opened
  // still sees `null` and can tell "untouched" from "explicitly set".
  const [value, setValue] = useState<unknown>(() => plugin.storage.get(field.key) ?? defaultFor(field));

  function commit(next: unknown) {
    setValue(next);
    plugin.storage.set(field.key, next);
  }

  const inputId = `plugin-setting-${plugin.manifest.id}-${field.key}`;
  return (
    <div className="core-setting-row">
      <div>
        <label htmlFor={inputId}>{field.label}</label>
        {field.description && <small>{field.description}</small>}
      </div>
      {field.kind === "toggle" && (
        <input id={inputId} type="checkbox" checked={Boolean(value)} onChange={(event) => commit(event.target.checked)} />
      )}
      {field.kind === "text" && (
        <input id={inputId} type="text" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => commit(event.target.value)} />
      )}
      {field.kind === "number" && (
        <input
          id={inputId}
          type="number"
          value={Number(value ?? 0)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => commit(event.target.value === "" ? null : Number(event.target.value))}
        />
      )}
      {field.kind === "select" && (
        <Select
          id={inputId}
          ariaLabel={field.label}
          value={String(value ?? "")}
          onChange={(next) => commit(next)}
          options={field.options.map((option) => ({ value: option.value, label: option.label }))}
        />
      )}
      {field.kind === "folder" && (
        <FolderField id={inputId} value={String(value ?? "")} onPick={commit} />
      )}
      {field.kind === "hotkey" && <HotkeyField plugin={plugin} commandId={field.commandId} />}
    </div>
  );
}

/**
 * The binding is Core's to store, not the plugin's: it is written under the
 * user's own overrides, never into `storage` under `field.key`. A plugin must
 * not be able to rewrite which keys the user pressed to reach it.
 */
function HotkeyField({ plugin, commandId }: { plugin: PluginContext; commandId: string }) {
  useHotkeyOverrides();
  const snapshot = coreHost.getSnapshot(plugin.manifest.id)[0];
  const command = snapshot?.commands.find((entry) => entry.id === commandId);
  const declared = command?.hotkey ?? null;
  return (
    <HotkeyRecorder
      pluginId={plugin.manifest.id}
      commandId={commandId}
      declared={declared}
      binding={effectiveHotkey(plugin.manifest.id, commandId, declared ?? undefined)}
      conflict={null}
    />
  );
}

function FolderField({ id, value, onPick }: { id: string; value: string; onPick: (value: string) => void }) {
  const { t } = useCoreI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div className="core-plugin-folder-field">
      <input id={id} type="text" value={value} readOnly placeholder={t("No folder chosen")} />
      <button
        type="button"
        className="core-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            // Imported lazily so this component stays usable in builds that do
            // not include the folder picker.
            const { pickPluginFolder } = await import("../data/core-data-api.ts");
            const chosen = await pickPluginFolder();
            if (chosen) onPick(chosen);
          } finally {
            setBusy(false);
          }
        }}
      >{t("Choose…")}</button>
    </div>
  );
}
