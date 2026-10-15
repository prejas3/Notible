import { useMemo, useState } from "react";
import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { previewRuleMatches, runRuleNow, type PluginAutomationRule } from "./automations.ts";
import { useT } from "./i18n.tsx";

/** Live "what would this rule do right now" plus the one-click way to do it to
 * every matching record. Preview is a pure dry-run; nothing is written until
 * the user confirms. */
export function RunPanel({ context, containerId, rule, objects, onDone, onRunning }: { context: PluginContext; containerId: string; rule: PluginAutomationRule; objects: PluginObject[]; onDone: () => void; onRunning?: (on: boolean) => void }) {
  const t = useT();
  const matches = useMemo(() => previewRuleMatches(rule, objects), [rule, objects]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  async function apply() {
    setBusy(true);
    onRunning?.(true);
    try {
      const entries = await runRuleNow(context, containerId, rule, matches);
      const failed = entries.filter((entry) => entry.status === "error").length;
      setResult(failed ? t("Done — {ok} changed, {failed} failed (see the log).", { ok: entries.length - failed, failed }) : t("Done — {ok} changed.", { ok: entries.length }));
      setConfirming(false);
      onDone();
    } catch (value) { setResult(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); onRunning?.(false); }
  }
  return <div className="automation-run-panel">
    <span className="automation-preview">{t("Matches {n} of {total} items right now", { n: matches.length, total: objects.length })}{matches.length > 0 && <small>{matches.slice(0, 5).map((record) => record.title || t("Untitled")).join(" · ")}{matches.length > 5 ? " …" : ""}</small>}</span>
    {!confirming
      ? <button type="button" onClick={() => { setResult(""); setConfirming(true); }} disabled={matches.length === 0 || busy}>{t("Run now")}</button>
      : <span className="automation-confirm"><button type="button" className="btn-primary" onClick={() => void apply()} disabled={busy} aria-busy={busy}>{busy && <span className="automation-spinner" aria-hidden="true" />}{busy ? t("Running…") : t("Apply to {n} items", { n: matches.length })}</button><button type="button" onClick={() => setConfirming(false)} disabled={busy}>{t("Cancel")}</button></span>}
    {result && <small role="status" className="automation-result">{result}</small>}
  </div>;
}
