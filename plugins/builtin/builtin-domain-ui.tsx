import { useMemo, useState } from "react";
import "./surface.css";
import type { PluginContext } from "../../packages/plugin-api/src/index.ts";
import { installWorkModels } from "./work-models.ts";
import { installPlanning } from "./planning.ts";
import { listAutomationRules } from "./automations.ts";
import { installFinance } from "./finance.ts";
import { searchWorkspace } from "./search.ts";
import { createWhiteboard } from "./whiteboard.ts";
import { prioritizeWorkspace } from "./ai.ts";
import { inspectCode } from "./editor-extensions.ts";
import { exportPluginData } from "./import-export.ts";
import { activeTheme, selectTheme } from "./themes.ts";

interface Props { context: unknown; }

const descriptions: Record<string, string> = {
  "notible.work-models": "Installs and upgrades the task, issue and project model catalog.",
  "notible.views": "Persists view definitions; a target container is required to create a default view.",
  "notible.planning": "Installs milestone, cycle and release models.",
  "notible.automations": "Reads automation rules stored on workspace containers.",
  "notible.finance": "Installs financial entry, time entry and vendor models.",
  "notible.search": "Searches workspace records through the public object API.",
  "notible.whiteboard": "Creates a versioned, persisted whiteboard document.",
  "notible.calendar": "Stores project calendar metadata; OAuth and tokens remain Core-owned.",
  "notible.ai": "Ranks open workspace records; provider execution remains a separate host capability.",
  "notible.editor-extensions": "Inspects code blocks through the editor extension surface.",
  "notible.import-export": "Exports workspace records through the plugin data contract.",
  "notible.themes": "Selects a theme manifest through plugin storage; token application remains host-owned.",
};

export default function BuiltinDomainSettings({ context: rawContext }: Props) {
  const context = rawContext as PluginContext;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const theme = useMemo(() => context.manifest.id === "notible.themes" ? activeTheme() : null, [context]);

  async function run() {
    setBusy(true); setMessage(""); setError("");
    try {
      let result: unknown;
      switch (context.manifest.id) {
        case "notible.work-models": result = await installWorkModels(context); break;
        case "notible.views": setMessage("Select a container from the host to create its default view."); return;
        case "notible.planning": result = await installPlanning(context); break;
        case "notible.automations": result = await listAutomationRules(context); break;
        case "notible.finance": result = await installFinance(context); break;
        case "notible.search": result = await searchWorkspace(context, { query: "" }); break;
        case "notible.whiteboard": result = await createWhiteboard(context); break;
        case "notible.calendar": setMessage("Calendar configuration requires a project target; OAuth stays in Core."); return;
        case "notible.ai": result = await prioritizeWorkspace(context); break;
        case "notible.editor-extensions": result = inspectCode({ language: "plain", source: "" }); break;
        case "notible.import-export": result = await exportPluginData(context); break;
        case "notible.themes": result = selectTheme(context, { themeId: null }); break;
        default: result = null;
      }
      setMessage(typeof result === "string" ? result : JSON.stringify(result));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setBusy(false); }
  }

  return (
    <div className="settings-section" data-plugin-surface={context.manifest.id}>
      <h2 className="settings-h2">{context.manifest.name}</h2>
      <p className="settings-intro">{descriptions[context.manifest.id] ?? "Builtin plugin surface."}</p>
      {theme && <p>Active theme: <strong>{theme.name}</strong></p>}
      {error && <div role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {message && <pre role="status" style={{ marginTop: 12, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{message}</pre>}
      <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "Running…" : "Run plugin operation"}</button>
    </div>
  );
}
