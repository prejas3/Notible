import { appLocale } from "./app-locale.ts";
import { useT } from "./i18n.tsx";
import { useEffect, useMemo, useState } from "react";
import { Select } from "../../src/core/ui/index.ts";
import type { PluginContext, PluginObject, PluginType } from "../../packages/plugin-api/src/index.ts";
import { createPlanningItem, installPlanning, PLANNING_TYPE_DEFINITIONS } from "./planning.ts";
import { PropertiesEditor, parseTypeSchema } from "./PropertiesEditor.tsx";
import "./surface.css";
import "./planning-ui.css";

interface Props {
  context: unknown;
}

type PlanningType = "milestone" | "cycle" | "release";

const typeLabels: Record<PlanningType, string> = {
  milestone: "Milestones",
  cycle: "Cycles",
  release: "Releases",
};

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function formatDate(value: number) {
  return new Date(value).toLocaleString(appLocale());
}

export default function PlanningSurface({ context: rawContext }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  const [items, setItems] = useState<PluginObject[]>([]);
  const [types, setTypes] = useState<PluginType[]>([]);
  const [projects, setProjects] = useState<PluginObject[]>([]);
  const [selectedType, setSelectedType] = useState<PlanningType>("milestone");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [propValues, setPropValues] = useState<Record<string, unknown>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedDefinition = useMemo(
    () => PLANNING_TYPE_DEFINITIONS.find((definition) => definition.name === selectedType) ?? PLANNING_TYPE_DEFINITIONS[0],
    [selectedType],
  );
  const typeDef = useMemo(() => types.find((candidate) => candidate.name === selectedType), [types, selectedType]);
  const editingRecord = useMemo(() => items.find((item) => item.id === editingId) ?? null, [items, editingId]);
  const editingTypeDef = useMemo(() => types.find((candidate) => candidate.name === editingRecord?.type), [types, editingRecord]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextTypes, nextProjects, ...records] = await Promise.all([context.data.types.list(), context.data.objects.query({ type: "project", limit: 200 }), ...PLANNING_TYPE_DEFINITIONS.map((definition) => context.data.objects.query({ type: definition.name, limit: 50 }))]);
      setTypes(nextTypes);
      setProjects(nextProjects);
      setItems(records.flat().sort((left, right) => right.updated_at - left.updated_at));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [context]);

  useEffect(() => {
    const fields = parseTypeSchema(typeDef);
    const defaults: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(fields)) if (spec.type === "select" && Array.isArray(spec.options) && spec.options.length > 0) defaults[name] = spec.options[0];
    setPropValues(defaults);
  }, [typeDef]);

  async function installModels() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await installPlanning(context);
      setNotice(`Planning models ready: ${result.types.join(", ")}.`);
      await refresh();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function createItem() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Add a title before creating a planning item.");
      return;
    }
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await createPlanningItem(context, { type: selectedType, title: cleanTitle, props: propValues, parentId: projectId || undefined });
      setTitle("");
      setNotice(`${typeLabels[selectedType].slice(0, -1)} created.`);
      await refresh();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("notible:workspace-changed"));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(item: PluginObject) {
    setEditingId(item.id);
    try { setEditValues(JSON.parse(item.props) as Record<string, unknown>); } catch { setEditValues({}); }
  }

  async function saveEdit() {
    if (!editingRecord) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await context.data.objects.update(editingRecord.id, { props: JSON.stringify(editValues) }, editingRecord.updated_at);
      setEditingId(null);
      setNotice("Planning item saved.");
      await refresh();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="planning-surface" data-plugin-surface="notible.planning">
      <header className="planning-header">
        <div>
          <h2>{t("Planning")}</h2>
          <p>{t("Milestones, cycles and releases are stored through the public Core data contract.")}</p>
        </div>
        <button type="button" className="planning-primary" onClick={() => void installModels()} disabled={busy}>
          {busy ? "Working…" : "Install / update models"}
        </button>
      </header>

      {error && <div className="planning-message planning-error" role="alert">{error}</div>}
      {notice && <div className="planning-message planning-notice" role="status">{notice}</div>}

      <div className="planning-content-grid">
        <section className="planning-create-card">
          <div className="planning-section-heading">
            <div>
              <p className="planning-eyebrow">{t("New planning record")}</p>
              <h3>{t("Create an item")}</h3>
            </div>
            <span className="planning-type-badge">{selectedDefinition.icon}</span>
          </div>
          <label>{t("Type")}<Select value={selectedType} ariaLabel={t("Type")} onChange={(next) => setSelectedType(next as PlanningType)} options={PLANNING_TYPE_DEFINITIONS.map((definition) => ({ value: definition.name, label: typeLabels[definition.name as PlanningType].slice(0, -1) }))} /></label>
          <label>{t("Title")}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>{t("Project")}<Select value={projectId} ariaLabel={t("Project")} placeholder={"No project"} onChange={(next) => setProjectId(next)} options={projects.map((project) => ({ value: project.id, label: project.title || "Untitled project" }))} /></label>
          <PropertiesEditor type={typeDef} values={propValues} onChange={setPropValues} context={context} />
          <button type="button" className="planning-primary planning-create-button" onClick={() => void createItem()} disabled={busy}>{t("Create planning item")}</button>
        </section>

        {editingRecord && (
          <section className="planning-create-card">
            <div className="planning-section-heading">
              <div>
                <p className="planning-eyebrow">{t("Edit item")}</p>
                <h3>{editingRecord.title || "Untitled planning item"}</h3>
              </div>
            </div>
            <PropertiesEditor type={editingTypeDef} values={editValues} onChange={setEditValues} context={context} />
            <div className="planning-form-row">
              <button type="button" className="planning-primary planning-create-button" onClick={() => void saveEdit()} disabled={busy}>{t("Save")}</button>
              <button type="button" className="planning-secondary" onClick={() => setEditingId(null)}>{t("Cancel")}</button>
            </div>
          </section>
        )}

        <section className="planning-list-card">
          <div className="planning-section-heading">
            <div>
              <p className="planning-eyebrow">{t("Workspace records")}</p>
              <h3>{t("Recent planning items")}</h3>
            </div>
            <button type="button" className="planning-secondary" onClick={() => void refresh()} disabled={loading}>{t("Refresh")}</button>
          </div>
          {loading ? <p className="planning-empty">{t("Loading planning records…")}</p> : items.length === 0 ? <p className="planning-empty">{t("No planning items yet. Create the first milestone, cycle or release.")}</p> : <div className="planning-record-list">{items.map((item) => <article className="planning-record planning-record-clickable" key={item.id} onClick={() => openEdit(item)} role="button" tabIndex={0}><div><strong>{item.title || "Untitled planning item"}</strong><small>{item.type} · {formatDate(item.updated_at)}</small></div><span>{item.type}</span></article>)}</div>}
        </section>
      </div>
    </section>
  );
}
