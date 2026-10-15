import { useState } from "react";
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
import { VIEW_LAYOUTS } from "./views.ts";
import { activeTheme, selectTheme } from "./themes.ts";

interface Props { context: unknown; }

const descriptions: Record<string, string> = {
  "notible.work-models": "The plugin owns the work model catalog and applies it through DataApi.types.",
  "notible.views": "The plugin owns persisted view definitions; the Core host owns mounting this surface.",
  "notible.planning": "Planning models and items are managed by the plugin through the public contract.",
  "notible.automations": "Automation rules are read and validated by the plugin.",
  "notible.finance": "Finance models and summaries are managed by the plugin.",
  "notible.search": "Search uses the public object query contract rather than Core SQLite imports.",
  "notible.whiteboard": "Whiteboard documents are persisted as ordinary plugin data.",
  "notible.calendar": "Calendar metadata belongs to the plugin; OAuth remains a platform capability.",
  "notible.ai": "Deterministic prioritization belongs to the plugin; provider execution remains a host capability.",
  "notible.editor-extensions": "Editor language inspection is exposed as a plugin surface.",
  "notible.import-export": "Workspace JSON transfer is exposed through the plugin data contract.",
  "notible.themes": "Theme selection is plugin-owned; Core applies the resulting host tokens.",
};

export default function BuiltinDomainView({ context: rawContext }: Props) {
  const context = rawContext as PluginContext;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() => context.manifest.id === "notible.themes" ? activeTheme() : null);

  async function run() {
    setBusy(true); setMessage(""); setError("");
    try {
      let result: unknown;
      switch (context.manifest.id) {
        case "notible.work-models": result = await installWorkModels(context); break;
        case "notible.views": result = { pluginId: context.manifest.id, layouts: [...VIEW_LAYOUTS] }; break;
        case "notible.planning": result = await installPlanning(context); break;
        case "notible.automations": result = await listAutomationRules(context); break;
        case "notible.finance": result = await installFinance(context); break;
        case "notible.search": result = await searchWorkspace(context, { query: "" }); break;
        case "notible.whiteboard": result = await createWhiteboard(context); break;
        case "notible.calendar": result = { pluginId: context.manifest.id, requiresProjectTarget: true, oauthOwnedBy: "core" }; break;
        case "notible.ai": result = await prioritizeWorkspace(context); break;
        case "notible.editor-extensions": result = inspectCode({ language: "plain", source: "" }); break;
        case "notible.import-export": result = await exportPluginData(context); break;
        case "notible.themes": result = selectTheme(context, { themeId: null }); setTheme(activeTheme()); break;
        default: result = { pluginId: context.manifest.id };
      }
      setMessage(typeof result === "string" ? result : JSON.stringify(result, null, 2));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("notible:workspace-changed"));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setBusy(false); }
  }

  return (
    <article className="plugin-domain-view" data-plugin-view={context.manifest.id}>
      <h2 className="settings-h2">{context.manifest.name}</h2>
      <p className="settings-intro">{descriptions[context.manifest.id] ?? "Builtin plugin surface."}</p>
      {theme && <p>Active theme: <strong>{theme.name}</strong></p>}
      {error && <div role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {message && <pre role="status" style={{ marginTop: 12, whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto" }}>{message}</pre>}
      <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "Running…" : "Run plugin view operation"}</button>
    </article>
  );
}
