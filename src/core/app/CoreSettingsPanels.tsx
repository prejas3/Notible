// Two self-contained Settings panels, moved out of CoreOnlyApp.tsx unchanged.

import { useEffect, useState, useSyncExternalStore } from "react";
import { listGrantedFolders, revokeGrantedFolder } from "../data/core-data-api.ts";
import { HotkeyRecorder, resolveHotkeyBindings, useHotkeyOverrides } from "./CorePluginSurfaces.tsx";
import { useCoreI18n } from "./core-i18n.ts";
// Render-time use only, so the import cycle with CoreOnlyApp is harmless.
import { coreHost } from "./CoreOnlyApp.tsx";

/**
 * The folders the user has linked, and a way to take them back.
 *
 * Under the no-sandbox model every plugin runs in this realm and can call
 * `invoke` directly, so a linked folder is readable by all of them. That was
 * true before this panel too — the difference is that it was invisible and
 * permanent. A grant the user cannot see is not a decision they made.
 */
export function GrantedFolderSettings() {
  const { t } = useCoreI18n();
  const [folders, setFolders] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGrantedFolders().then(setFolders).catch((value) => setError(String(value)));
  }, []);

  async function revoke(path: string) {
    try {
      setFolders(await revokeGrantedFolder(path));
    } catch (value) {
      setError(String(value));
    }
  }

  // Every "Install .zip" before this session's fix left the archive granted
  // forever, since nothing revoked it once extraction finished — that grant
  // is now dropped automatically (see installPluginPackage). This is the
  // one-time cleanup for the ones that already piled up.
  const stalePackages = folders?.filter((path) => path.toLowerCase().endsWith(".zip")) ?? [];

  async function revokeAllPackages() {
    try {
      let remaining = folders ?? [];
      for (const path of stalePackages) remaining = await revokeGrantedFolder(path);
      setFolders(remaining);
    } catch (value) {
      setError(String(value));
    }
  }

  return (
    <>
      <div className="core-settings-group-heading"><h3>{t("Linked folders")}</h3><p>{t("Folders you picked stay readable until you unlink them. Every active plugin can read them.")}</p></div>
      {error && <p className="core-settings-hint">{error}</p>}
      {folders === null && !error && <p className="core-settings-hint">{t("Loading…")}</p>}
      {folders?.length === 0 && <p className="core-settings-hint">{t("No folders are linked. One is added whenever you pick a folder or a plugin package.")}</p>}
      {stalePackages.length > 0 && <div className="core-setting-row">
        <div><label>{t("Installed package files")}</label><small>{t("{count} plugin package files from “Install .zip”, already unpacked and no longer needed.", { count: stalePackages.length })}</small></div>
        <button type="button" className="core-secondary-action core-secondary-action-danger" onClick={() => void revokeAllPackages()}>{t("Unlink all")}</button>
      </div>}
      {folders?.map((path) => (
        <div className="core-setting-row" key={path}>
          <div><label className="core-granted-path">{path}</label></div>
          <button type="button" className="core-secondary-action core-secondary-action-danger" onClick={() => void revoke(path)}>{t("Unlink")}</button>
        </div>
      ))}
    </>
  );
}

/**
 * Rebinding for every command an active plugin registered.
 *
 * Lists commands with no declared binding too. A plugin author cannot guess
 * which keys are free on your keyboard, so "this command has no shortcut" is
 * the common case and the one worth fixing here — not an omission to hide.
 */
export function PluginHotkeySettings() {
  const { t } = useCoreI18n();
  const snapshots = useSyncExternalStore(
    (listener) => { const subscription = coreHost.onChange(listener); return () => subscription.dispose(); },
    () => coreHost.getSnapshot(),
  );
  useHotkeyOverrides();
  const rows = resolveHotkeyBindings(snapshots);

  if (rows.length === 0) {
    return <p className="core-settings-hint">{t("No plugin commands are active. Enable a plugin in Plugin Matrix to give it a shortcut.")}</p>;
  }
  return (
    <>
      <div className="core-settings-group-heading"><h3>{t("Plugin shortcuts")}</h3><p>{t("Click a shortcut and press the keys you want. × removes it; reset restores the plugin's own.")}</p></div>
      <div className="core-plugin-hotkey-list">
        {rows.map((row) => (
          <div className="core-setting-row" key={`${row.pluginId}:${row.commandId}`}>
            <div><label>{t(row.name)}</label><small>{coreHost.getPluginContext(row.pluginId)?.manifest.name ?? row.pluginId}</small></div>
            <HotkeyRecorder {...row} />
          </div>
        ))}
      </div>
    </>
  );
}
