import { useMemo, useState } from "react";
import { coreHost } from "../core/app/CoreOnlyApp";
import { BUILTIN_PLUGINS } from "./builtin";
import { turnOnBuiltin } from "./matrix-controller";
import { useCoreI18n } from "../core/app/core-i18n";
import { availableModules, defaultModules, offeredModules } from "./container-modules";
import "./ContainerModulePicker.css";

interface ContainerModulePickerProps {
  objectKind: "project" | "folder" | "space";
  initialSelection?: string[];
  /** `name` is what the user typed when creating; absent in edit mode. */
  onConfirm: (moduleIds: string[], name?: string) => void;
  onCancel: () => void;
}

/**
 * Create a project or workspace (name first, then what it starts with), or
 * edit an existing one's modules. Name first (S2): people type the name the
 * moment the dialog opens, and those keystrokes used to go nowhere.
 */
export function ContainerModulePicker({ objectKind, initialSelection, onConfirm, onCancel }: ContainerModulePickerProps) {
  const { t } = useCoreI18n();
  // Bumped after "Turn on", so the new plugin's tabs show up in the list.
  const [hostVersion, setHostVersion] = useState(0);
  const rows = useMemo(() => availableModules(coreHost.getSnapshot(), objectKind), [objectKind, hostVersion]);
  const offers = useMemo(() => offeredModules(coreHost.getSnapshot(), objectKind), [objectKind, hostVersion]);
  const [turningOn, setTurningOn] = useState<string | null>(null);

  async function turnOn(pluginId: string) {
    setTurningOn(pluginId);
    try {
      await turnOnBuiltin(coreHost, BUILTIN_PLUGINS, pluginId);
      // Its tabs start ticked: you turned it on to use them here.
      const added = availableModules(coreHost.getSnapshot(), objectKind).filter((row) => row.pluginId === pluginId).map((row) => row.id);
      setSelected((current) => new Set([...current, ...added]));
      setHostVersion((version) => version + 1);
    } finally {
      setTurningOn(null);
    }
  }
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelection ?? defaultModules(coreHost.getSnapshot(), objectKind)),
  );
  const [name, setName] = useState("");
  const editMode = initialSelection !== undefined;

  // Literal `t()` calls so the locale extractor sees the keys; the word is then
  // interpolated into the surrounding sentences.
  const kind = objectKind === "project" ? t("project") : objectKind === "folder" ? t("folder") : t("workspace");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const confirm = () => onConfirm([...selected], editMode ? undefined : name.trim() || undefined);

  return (
    <div className="cmp-backdrop" onClick={onCancel} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form
        className="cmp-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmp-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); confirm(); }}
      >
        <h2 className="cmp-title" id="cmp-title">{editMode ? t("Modules") : t("New {kind}", { kind })}</h2>
        {!editMode && <label className="cmp-name">
          <span>{t("Name")}</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("New {kind}", { kind })} />
        </label>}
        <p className="cmp-intro">
          {editMode
            ? t("Turn parts on or off for this {kind}. Turning one off hides it; nothing is deleted.", { kind })
            : t("What it starts with. You can change this later under Modules.")}
        </p>
        <ul className="cmp-list">
          {rows.map((row) => (
            <li key={row.id}>
              <label className="cmp-row">
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                <span className="cmp-row-text">
                  <strong>{row.label}</strong>
                  {row.description && <small>{row.description}</small>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {offers.length > 0 && <>
          <p className="cmp-more-title">{t("More with plugins")}</p>
          <ul className="cmp-list cmp-offers">
            {offers.map((offer) => (
              <li key={offer.pluginId} className="cmp-row cmp-offer">
                <span className="cmp-row-text">
                  <strong>{t(offer.label)}</strong>
                  <small>{t(offer.description)}</small>
                </span>
                <button type="button" className="cmp-turn-on" disabled={turningOn !== null} onClick={() => void turnOn(offer.pluginId)}>{turningOn === offer.pluginId ? t("Turning on…") : t("Turn on")}</button>
              </li>
            ))}
          </ul>
        </>}
        <div className="cmp-actions">
          <span className="cmp-spacer" />
          <button type="button" className="cmp-cancel" onClick={onCancel}>{t("Cancel")}</button>
          <button type="submit" className="cmp-confirm" autoFocus={editMode}>
            {editMode ? t("Save") : t("Create")}
          </button>
        </div>
      </form>
    </div>
  );
}
