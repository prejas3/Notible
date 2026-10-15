import { tCore } from "../core/app/core-i18n.ts";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CoreOnlyApp } from "../core/app/CoreOnlyApp";
import { CoreMatrixPanel } from "./CoreMatrixPanel";
import { CorePluginContainerPanel } from "./CorePluginContainerPanel";
import { CorePluginPropertiesPanel } from "./CorePluginPropertiesPanel";
import { BUILTIN_PLUGINS } from "./builtin";
import { applyPluginSelection, DEFAULT_BUILTIN_SELECTION } from "./matrix-controller";
import { coreHost } from "../core/app/CoreOnlyApp";

const MATRIX_SELECTION_KEY = "notible-test-host.matrix-selection";
/** For `context.help` (API 1.22): every shipped plugin, whether it is on or not. */
const BUILTIN_CATALOG = BUILTIN_PLUGINS.map((plugin) => plugin.manifest);

class TestHostErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Notible render error", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="core-fatal-error"><p className="core-eyebrow">Notible</p><h1>{tCore("This view could not be displayed")}</h1><p>{this.state.error.message}</p><button type="button" onClick={() => window.location.reload()}>{tCore("Reload")}</button></main>;
  }
}

function readPersistedBuiltinSelection(): string[] {
  try {
    const raw = localStorage.getItem(MATRIX_SELECTION_KEY);
    // No key at all means a fresh install/profile — nothing was ever chosen
    // in Matrix, so fall back to the shipped default set. A stored "[]" (the
    // user explicitly picking the "Core only" preset) is left untouched.
    if (raw === null) return [...DEFAULT_BUILTIN_SELECTION];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [...DEFAULT_BUILTIN_SELECTION];
  } catch {
    return [...DEFAULT_BUILTIN_SELECTION];
  }
}

export function UnifiedTestHostApp() {
  useEffect(() => {
    void applyPluginSelection(coreHost, BUILTIN_PLUGINS, readPersistedBuiltinSelection());
  }, []);
  return <TestHostErrorBoundary><CoreOnlyApp builtinCatalog={BUILTIN_CATALOG} matrixSlot={(props) => <CoreMatrixPanel tab={props.tab} entries={props.entries} detailContainer={props.detailContainer} emptyState={props.emptyState} onToggleLocal={(row) => props.onToggleLocal(row.id)} onReloadLocal={(row) => props.onReloadLocal(row.id)} onRemoveLocal={(row) => props.onRemoveLocal(row.id)} onError={props.onError} onInstall={props.onInstall} />} containerSlot={(containerId, objectType, onOpenObject) => <CorePluginContainerPanel containerId={containerId} objectType={objectType} onOpenObject={onOpenObject} />} propertiesSlot={(objectId, objectType) => <CorePluginPropertiesPanel objectId={objectId} objectType={objectType} />} /></TestHostErrorBoundary>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><UnifiedTestHostApp /></React.StrictMode>,
);
