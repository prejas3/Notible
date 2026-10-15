import { useMemo } from "react";
import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { Combobox, Select } from "../../src/core/ui/index.ts";
import { wouldCycle, type Dep, type DependencyKind } from "./ganttCascade.ts";
import { useProjectSiblings } from "./PropertiesEditor.tsx";
import { useT } from "./i18n.tsx";
import "./surface.css";
import "./properties-editor.css";

/** Plain-language names for the three schedule rules. The old Gantt menu
 * labelled these "Then (finish → start)" / "Together (start → start)" /
 * "Finish together", which testers found opaque — these say what actually
 * happens to the dependent item's dates. */
export const DEPENDENCY_KIND_LABEL: Record<DependencyKind, string> = {
  "finish-start": "After it finishes",
  "start-start": "When it starts",
  "finish-finish": "Finishes with it",
  "start-finish": "Can't finish before it starts",
};

export const KIND_OPTIONS: { value: DependencyKind; label: string }[] = [
  { value: "finish-start", label: DEPENDENCY_KIND_LABEL["finish-start"] },
  { value: "start-start", label: DEPENDENCY_KIND_LABEL["start-start"] },
  { value: "finish-finish", label: DEPENDENCY_KIND_LABEL["finish-finish"] },
  { value: "start-finish", label: DEPENDENCY_KIND_LABEL["start-finish"] },
];

function normalize(value: unknown): Dep[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Dep[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const on = (entry as { on?: unknown }).on;
    if (typeof on !== "string" || !on || seen.has(on)) continue;
    seen.add(on);
    const kind = (entry as { kind?: unknown }).kind;
    out.push({ on, kind: kind === "start-start" || kind === "finish-finish" || kind === "start-finish" ? kind : "finish-start" });
  }
  return out;
}

/**
 * Multi-predecessor dependency editor, rendered by `PropertiesEditor` for the
 * schema field named `deps` (tasks and issues). One row per predecessor:
 * which record it waits on, and the schedule rule. The Gantt draws a
 * connector for every row. Picks that would form a cycle (or point at the
 * item itself) are kept out of the "add" list.
 */
export function DependencyList({ label, value, onChange, context, objectId }: {
  label: string;
  value: unknown;
  onChange: (next: unknown) => void;
  context?: PluginContext;
  objectId?: string;
}) {
  const t = useT();
  const deps = normalize(value);
  const siblings = useProjectSiblings(context, objectId);

  const titleOf = useMemo(() => {
    const map = new Map(siblings.map((sibling) => [sibling.id, sibling.title || "Untitled"]));
    return (id: string) => map.get(id) ?? id;
  }, [siblings]);

  const chosen = new Set(deps.map((dep) => dep.on));
  const addable = siblings.filter((sibling) =>
    sibling.id !== objectId
    && !chosen.has(sibling.id)
    && (sibling.type === "task" || sibling.type === "issue" || sibling.type === "milestone" || sibling.type === "cycle" || sibling.type === "release")
    && (!objectId || !wouldCycle(depGraphInput(siblings, objectId, deps), objectId, sibling.id)));

  function commit(next: Dep[]) { onChange(next.length ? next : undefined); }

  return (
    <div className="properties-editor-field properties-editor-deps">
      {label}
      {deps.length === 0 && <p className="properties-editor-deps-empty">{t("No dependencies. This item can start any time.")}</p>}
      {deps.map((dep, index) => (
        <div key={dep.on} className="properties-editor-deps-row">
          <span className="properties-editor-deps-name">{titleOf(dep.on)}</span>
          <Select
            value={dep.kind}
            onChange={(kind) => commit(deps.map((existing, position) => position === index ? { ...existing, kind: kind as DependencyKind } : existing))}
            options={KIND_OPTIONS}
            ariaLabel={t("Schedule rule")}
          />
          <button type="button" aria-label={t("Remove dependency")} onClick={() => commit(deps.filter((_, position) => position !== index))}>×</button>
        </div>
      ))}
      <Combobox
        value=""
        options={addable.map((sibling) => ({ value: sibling.id, label: sibling.title || "Untitled" }))}
        placeholder={context ? t("Add a dependency…") : undefined}
        onChange={(id) => { if (id) commit([...deps, { on: id, kind: "finish-start" }]); }}
        ariaLabel={t("Add a dependency")}
        disabled={!context}
      />
    </div>
  );
}

/** The sibling list plus this item's own in-progress `deps` (not yet saved),
 * so `wouldCycle` sees the edit being made and rejects a pick that closes a
 * loop against an unsaved link too. */
function depGraphInput(siblings: PluginObject[], objectId: string, deps: Dep[]): PluginObject[] {
  return siblings.map((sibling) => sibling.id === objectId
    ? { ...sibling, props: JSON.stringify({ ...safeProps(sibling), deps }) }
    : sibling);
}

function safeProps(object: PluginObject): Record<string, unknown> {
  try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
