import { useEffect, useState } from "react";
import { RefreshCw, Download, Settings2, CheckCircle2 } from "lucide-react";
import { checkForUpdate, installUpdate, isAutostartEnabled, setAutostart } from "../data/core-data-api.ts";
import { CoreSwitch } from "./CoreSwitch.tsx";
import { useCoreI18n } from "./core-i18n.ts";
import packageJson from "../../../package.json";

const UPDATES_ENABLED = import.meta.env.VITE_NOTIBLE_UPDATER_ENABLED === "true"
  || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);

type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing" | "error";

/** Mirrors the legacy Settings → Updates flow (check → download → install)
 * against the same Cloudflare-hosted latest.json / Ed25519 signature. */
export function CoreUpdateSection() {
  const { t } = useCoreI18n();
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [available, setAvailable] = useState<string | null>(null);
  // `null` means "not known yet" (still loading) or "the OS registration
  // couldn't be read" — either way there's nothing safe to toggle from, so
  // the control renders disabled rather than guessing a starting state.
  const [autostart, setAutostartValue] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isAutostartEnabled().then((value) => { if (!cancelled) setAutostartValue(value); }).catch(() => { if (!cancelled) setAutostartValue(null); });
    return () => { cancelled = true; };
  }, []);

  async function toggleAutostart() {
    if (autostart === null || autostartBusy) return;
    const next = !autostart;
    setAutostartBusy(true);
    try {
      await setAutostart(next);
      setAutostartValue(next);
    } catch {
      // Leave the toggle at its last known-good value: the OS registration
      // did not change, so the UI must not claim it did.
    } finally {
      setAutostartBusy(false);
    }
  }

  async function checkNow() {
    if (!UPDATES_ENABLED) return;
    setStatus("checking");
    setAvailable(null);
    try {
      const version = await checkForUpdate();
      setAvailable(version);
      setStatus(version ? "available" : "current");
    } catch {
      setStatus("error");
    }
  }

  async function installNow() {
    if (!available) return;
    setStatus("installing");
    try {
      await installUpdate();
    } catch {
      setStatus("error");
    }
  }

  return (
    <article className="core-settings-section core-view-in">
      <div className="core-settings-section-heading">
        <div>
          <p className="core-eyebrow">{t("Updates")}</p>
          <h2>{t("Keep Notible current")}</h2>
          <p>{t("Checks the signed release feed and installs updates without leaving the app.")}</p>
        </div>
        <span className="core-settings-mark"><Settings2 size={21} /></span>
      </div>

      <div className="core-setting-row">
        <div><label>{t("Installed version")}</label></div>
        <span className="core-setting-value">{packageJson.version}</span>
      </div>

      {!UPDATES_ENABLED && (
        <div className="core-settings-note"><strong>{t("Not available here")}</strong><p>{t("The update channel is only active in the installed desktop build.")}</p></div>
      )}

      {UPDATES_ENABLED && <div className="core-settings-action core-settings-action-wide">
        <div>
          <strong>{status === "idle" && t("Check for updates")}
            {status === "checking" && t("Checking for updates…")}
            {/* A chip, not only a quiet label swap that was easy to miss (CE57). */}
            {status === "current" && <span className="core-update-chip" role="status"><CheckCircle2 size={14} aria-hidden="true" /> {t("Notible is up to date")}</span>}
            {status === "available" && available && t("Version {version} is available", { version: available })}
            {status === "installing" && t("Downloading and installing…")}
            {status === "error" && t("Could not check for or install the update")}</strong>
          <p>{t("Updates are only accepted when their signature matches the key embedded in Notible.")}</p>
        </div>
        <div className="core-settings-heading-actions core-update-actions">
          {/* One button that morphs in place (check → install) instead of a
              second button growing in beside it — a status swap, not a
              layout change, so nothing else in the row ever jumps. */}
          <button
            type="button"
            className={`core-button core-update-button${status === "available" && available ? " core-button-primary" : ""}`}
            disabled={status === "checking" || status === "installing"}
            onClick={() => void (status === "available" && available ? installNow() : checkNow())}
          >
            {status === "available" && available
              ? <><Download size={14} /> {t("Download and install")}</>
              : <><RefreshCw size={14} className={status === "checking" ? "is-spinning" : ""} /> {t("Check for updates")}</>}
          </button>
        </div>
      </div>}

      <div className="core-setting-row">
        <div><label>{t("Launch at startup")}</label><small>{t("Starts Notible automatically when you sign in to this machine.")}</small></div>
        {autostart === null
          ? <span className="core-setting-value">{t("Not available here")}</span>
          : <CoreSwitch checked={autostart} disabled={autostartBusy} label={t("Launch at startup")} onChange={() => void toggleAutostart()} />}
      </div>
    </article>
  );
}
