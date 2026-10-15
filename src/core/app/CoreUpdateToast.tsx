import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { checkForUpdate, installUpdate } from "../data/core-data-api.ts";
import { useCoreI18n } from "./core-i18n.ts";

const UPDATES_ENABLED = import.meta.env.VITE_NOTIBLE_UPDATER_ENABLED === "true"
  || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);

/** Dismissal is per version, so declining 0.56.0 does not hide 0.57.0. */
const DISMISSED_KEY = "notible.update.dismissed";

/** How often a window that stays open keeps asking. */
// Hourly since 0.92.1 (was 6 h): the feed is one small static file.
const CHECK_EVERY = 60 * 60 * 1000;
/** Coming back to the window re-checks, but not more often than this. */
const CHECK_ON_RETURN_AFTER = 15 * 60 * 1000;

/**
 * A quiet notice that a signed release is waiting, and one button that
 * installs it.
 *
 * Deliberately not a modal and never blocking: Notible keeps running,
 * unchanged, if this is ignored or closed. The old path — Settings →
 * Updates → Check → Download — still exists and is what this replaces for
 * the person who just wants the new version.
 *
 * The first check is delayed, then repeated every few hours and whenever a
 * window that has been idle comes back — Notible sits in the tray for days,
 * so a startup-only check reaches almost nobody. Repetition does not become
 * nagging because a dismissed version is remembered and never offered again.
 * Same signed feed and same key as `CoreUpdateSection`: nothing new trusted.
 */
export function CoreUpdateToast() {
  const { t } = useCoreI18n();
  const [version, setVersion] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!UPDATES_ENABLED) return;
    let live = true;
    let lastCheck = 0;

    // Notible lives in the tray and stays open for days, so "check once at
    // startup" meant most people would only ever be told about an update on
    // the morning they happened to restart. Two triggers, both cheap:
    // a slow interval, and coming back to a window that has been idle.
    const check = () => {
      if (!live) return;
      lastCheck = Date.now();
      void checkForUpdate()
        .then((found) => {
          if (!live || !found) return;
          // Dismissal is read here rather than at render, so a version
          // waved away earlier never even mounts the card — which is what
          // keeps a repeating check from turning into repeated nagging.
          let dismissed: string | null = null;
          try { dismissed = window.localStorage.getItem(DISMISSED_KEY); } catch { /* private mode */ }
          if (dismissed === found) return;
          setVersion(found);
        })
        // Offline, or the feed is down. Neither is worth a word on screen:
        // nothing the person was doing has failed.
        .catch(() => {});
    };

    // Not at the first paint: a notice competing with the app opening is what
    // makes these feel like nagware.
    const first = window.setTimeout(check, 8_000);
    const interval = window.setInterval(check, CHECK_EVERY);
    // Waking the window is the moment a person is most likely to accept an
    // update, and the moment a machine that was asleep needs a fresh answer.
    // Rate-limited so alt-tabbing does not hammer the feed.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < CHECK_ON_RETURN_AFTER) return;
      check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  if (!version || closed) return null;

  async function install() {
    setInstalling(true);
    setFailed(false);
    try {
      await installUpdate();
      // Windows hands over to the installer, which closes Notible and starts
      // the new build, so anything after this line usually never runs.
    } catch {
      setInstalling(false);
      setFailed(true);
    }
  }

  function dismiss() {
    try { window.localStorage.setItem(DISMISSED_KEY, version ?? ""); } catch { /* private mode */ }
    setClosed(true);
  }

  return (
    <aside className="core-update-toast" role="status" aria-live="polite">
      <div>
        <strong>{t("Notible {version} is ready", { version })}</strong>
        <p>
          {installing
            ? t("Downloading and installing…")
            : failed
              ? t("The update could not be installed. Try again from Settings → Updates.")
              : t("Signed update. Notible closes and reopens on the new version.")}
        </p>
      </div>
      <button type="button" className="core-button core-button-primary" onClick={() => void install()} disabled={installing}>
        <Download size={14} /> {installing ? t("Installing") : t("Update now")}
      </button>
      <button type="button" className="core-update-toast-close" onClick={dismiss} aria-label={t("Not now")} title={t("Not now")}>
        <X size={15} />
      </button>
    </aside>
  );
}
