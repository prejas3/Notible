import { useEffect, useMemo, useRef, useState } from "react";
import { Settings, Pencil } from "lucide-react";
import { Select, DatePicker } from "../../src/core/ui/index.ts";
import type { PluginContext, PluginObject, PluginType } from "../../packages/plugin-api/src/index.ts";
import { PropertiesEditor, PropertyOrderEditor, parseTypeSchema } from "./PropertiesEditor.tsx";
import "./surface.css";
import "./properties-panel-ui.css";
import { PluginI18nProvider, useT, type Translate } from "./i18n.tsx";
import { mergePropsEdit, parsePropsText } from "./props-patch.ts";

type CustomFieldType = "text" | "date" | "url" | "number" | "bool";
interface CustomFieldDef { key: string; label: string; type: CustomFieldType }

/** Per-object ad-hoc properties (distinct from per-type schema fields, see
 * `PropertiesEditor`/`types.schema.fields`) — definitions live in the
 * object's own props under `_customFields` (leading underscore keeps them
 * out of CSV export and other prop UIs, same convention as `_views`). Lets a
 * single note carry one-off properties without touching its type's schema. */
function parseCustomFields(values: Record<string, unknown>): CustomFieldDef[] {
  const raw = values._customFields;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is CustomFieldDef =>
    Boolean(entry) && typeof entry === "object" && typeof (entry as CustomFieldDef).key === "string" && typeof (entry as CustomFieldDef).label === "string");
}

/** URLs default to a clickable link (hover highlight, click opens) instead
 * of a plain text box — click the pencil to edit the address itself. */
function UrlField({ label, value, onChange }: { label: string; value: unknown; onChange: (next: unknown) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const stringValue = value == null ? "" : String(value);
  const showLink = !editing && stringValue.trim();
  return <label className="properties-editor-field pp-url-field">
    {label}
    {showLink
      ? <span className="pp-url-display">
          <a href={stringValue} target="_blank" rel="noreferrer noopener">{stringValue}</a>
          <button type="button" className="pp-url-edit" aria-label={t("Edit URL")} onClick={() => setEditing(true)}><Pencil size={12} /></button>
        </span>
      : <input
          type="url"
          autoFocus={editing}
          value={stringValue}
          onChange={(event) => onChange(event.target.value || undefined)}
          onBlur={() => setEditing(false)}
        />}
  </label>;
}

function CustomFieldsSection({ values, onChange }: { values: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const t = useT();
  const fields = parseCustomFields(values);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<CustomFieldType>("text");

  function addField() {
    const label = newLabel.trim();
    if (!label) return;
    const key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "") || Date.now()}`;
    onChange({ ...values, _customFields: [...fields, { key, label, type: newType }] });
    setNewLabel("");
    setNewType("text");
    setAdding(false);
  }

  function removeField(key: string) {
    const rest = { ...values };
    delete rest[key];
    onChange({ ...rest, _customFields: fields.filter((field) => field.key !== key) });
  }

  function setValue(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return <div className="pp-custom-fields">
    {fields.map((field) => <div key={field.key} className="pp-custom-field">
      {field.type === "url"
        ? <UrlField label={field.label} value={values[field.key]} onChange={(next) => setValue(field.key, next)} />
        : <label className="properties-editor-field">
            {field.label}
            {field.type === "bool"
              ? <input type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => setValue(field.key, event.target.checked)} />
              : field.type === "date"
              ? <DatePicker
                  value={values[field.key] == null ? "" : String(values[field.key]).slice(0, 10)}
                  ariaLabel={field.label}
                  onChange={(next) => setValue(field.key, next || undefined)}
                />
              : <input
                  type={field.type === "number" ? "number" : "text"}
                  value={values[field.key] == null ? "" : String(values[field.key])}
                  onChange={(event) => setValue(field.key, field.type === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value || undefined)}
                />}
          </label>}
      <button type="button" className="pp-custom-field-remove" title={t("Remove property")} aria-label={t("Remove property")} onClick={() => removeField(field.key)}>×</button>
    </div>)}
    {adding ? <div className="pp-custom-field-new">
      <input
        placeholder={t("Property name")}
        value={newLabel}
        onChange={(event) => setNewLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); addField(); }
          else if (event.key === "Escape") { event.preventDefault(); setAdding(false); setNewLabel(""); setNewType("text"); }
        }}
        autoFocus
      />
      <Select
        value={newType}
        ariaLabel={t("Property type")}
        onChange={(next) => setNewType(next as CustomFieldType)}
        options={[
          { value: "text", label: "Text" },
          { value: "date", label: "Date" },
          { value: "url", label: "URL" },
          { value: "number", label: "Number" },
          { value: "bool", label: "Checkbox" },
        ]}
      />
      <button type="button" className="pp-primary" onClick={addField} disabled={!newLabel.trim()}>{t("Add")}</button>
      <button type="button" onClick={() => setAdding(false)}>{t("Cancel")}</button>
    </div> : <button type="button" className="pp-custom-field-add" onClick={() => setAdding(true)}>+ Add property</button>}
  </div>;
}

interface Props {
  context: unknown;
  host?: { openObject(id: string): Promise<void>; notifyChanged(): void };
  initialContainerId?: string;
}

function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
function isConflict(value: unknown) { return errorMessage(value).toLowerCase().includes("conflict"); }

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  note: "Note",
  current_step: "Current step",
  next_step: "Next step",
  client_response: "Client response",
  decision: "Decision",
};

function activityTypeLabel(t: Translate, value: string): string {
  if (value === "current_step") return t("Current step");
  if (value === "next_step") return t("Next step");
  if (value === "client_response") return t("Client response");
  if (value === "decision") return t("Decision");
  return t("Note");
}

/** 5: SalesForce-case-style activity log, only relevant once a note is a
 * task/issue tracked inside a project — a bare note has nothing to log
 * activity against. Entries are ordinary child objects (type
 * "activity_entry", parentId = this record), same convention as
 * financial_entry/time_entry — no bespoke table needed. */
function ActivitySection({ context, objectId }: { context: PluginContext; objectId: string }) {
  const t = useT();
  const [entries, setEntries] = useState<PluginObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [activityType, setActivityType] = useState("note");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const records = await context.data.objects.query({ parentId: objectId, type: "activity_entry", limit: 200 });
      setEntries(records.sort((a, b) => b.created_at - a.created_at));
    } catch (value) { setError(errorMessage(value)); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [context, objectId]);

  async function addEntry() {
    if (!content.trim()) return;
    setBusy(true); setError("");
    try {
      await context.data.objects.create({
        type: "activity_entry",
        title: `${activityTypeLabel(t, activityType)} · ${new Date().toLocaleDateString()}`,
        parentId: objectId,
        content,
        props: JSON.stringify({ activityType, dueDate: dueDate || undefined }),
      });
      setContent(""); setDueDate("");
      await refresh();
    } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); }
  }

  return <div className="pp-activity">
    {error && <p className="pp-error" role="alert">{error}</p>}
    <div className="pp-activity-form">
      <div className="pp-activity-form-row">
        <Select
          value={activityType}
          ariaLabel={t("Activity type")}
          onChange={(next) => setActivityType(next)}
          options={Object.keys(ACTIVITY_TYPE_LABELS).map((value) => ({ value, label: activityTypeLabel(t, value) }))}
        />
        <DatePicker value={dueDate} ariaLabel={t("Due date")} onChange={(next) => setDueDate(next)} />
      </div>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={t("What happened…")} rows={3} />
      <button type="button" className="pp-primary" onClick={() => void addEntry()} disabled={busy || !content.trim()}>{t("Log activity")}</button>
    </div>
    {loading ? <p className="pp-muted">{t("Loading…")}</p> : entries.length === 0 ? <p className="pp-muted">{t("No activity logged yet.")}</p> : <ul className="pp-activity-list">
      {entries.map((entry) => {
        let props: { activityType?: string; dueDate?: string } = {};
        try { props = JSON.parse(entry.props); } catch { /* ignore */ }
        return <li key={entry.id} className="pp-activity-entry">
          <div className="pp-activity-entry-head">
            <strong>{activityTypeLabel(t, props.activityType ?? "note")}</strong>
            <span>{new Date(entry.created_at).toLocaleString()}</span>
            {props.dueDate && <span className="pp-activity-due">{t("Due")} {props.dueDate}</span>}
          </div>
          <p>{entry.content}</p>
        </li>;
      })}
    </ul>}
  </div>;
}

function PropertiesPanelInner({ context: rawContext, initialContainerId }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  const [objectId, setObjectId] = useState(initialContainerId ?? "");
  const [object, setObject] = useState<PluginObject | null>(null);
  const [types, setTypes] = useState<PluginType[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const objectRef = useRef<PluginObject | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The debounced edit and the object it belongs to, fixed when it was made.
  // Reading objectRef when the timer fired wrote one note's properties onto
  // whatever note had been opened in the meantime.
  // PROPS-PATCH (Hive #36): `base` is the props the shown values came from, so
  // a save writes only what the user changed onto the current props.
  const pendingSave = useRef<{ next: Record<string, unknown>; target: PluginObject; base: Record<string, unknown> } | null>(null);
  const baseRef = useRef<Record<string, unknown>>({});
  const savingRef = useRef(0);
  const flushSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (pending) void save(pending.next, pending.target, pending.base);
  };
  const [activeTab, setActiveTab] = useState<"properties" | "activity">("properties");

  useEffect(() => { setObjectId(initialContainerId ?? ""); }, [initialContainerId]);

  useEffect(() => {
    // Leaving an object: write its pending edit now, to that object.
    flushSave();
    if (!objectId) { setObject(null); return; }
    let active = true;
    (async () => {
      try {
        const [current, nextTypes] = await Promise.all([context.data.objects.get(objectId), context.data.types.list()]);
        if (!active) return;
        setObject(current);
        objectRef.current = current;
        setTypes(nextTypes);
        if (current) { baseRef.current = parsePropsText(current.props); setValues(baseRef.current); }
        setError(current ? "" : "Object not found.");
      } catch (value) { if (active) setError(errorMessage(value)); }
    })();
    return () => { active = false; };
  }, [context, objectId]);

  // PROPS-PATCH: show what others wrote meanwhile (a plugin, an automation, a
  // sync merge — sync announces only workspace.changed), unless an edit of
  // ours is waiting or saving: then the save's result is shown instead.
  useEffect(() => {
    if (!objectId) return;
    const idle = () => !pendingSave.current && savingRef.current === 0;
    const subscription = context.events.on("workspace.changed", () => {
      if (!idle()) return;
      void context.data.objects.get(objectId).then((current) => {
        const shown = objectRef.current;
        if (!current || !shown || shown.id !== current.id || !idle()) return;
        if (current.updated_at === shown.updated_at && current.props === shown.props) return;
        setObject(current);
        objectRef.current = current;
        baseRef.current = parsePropsText(current.props);
        setValues(baseRef.current);
      }).catch(() => {});
    });
    return () => subscription.dispose();
  }, [context, objectId]);

  const typeDef = useMemo(() => types.find((candidate) => candidate.name === object?.type), [types, object]);
  const hasFields = useMemo(() => Object.keys(parseTypeSchema(typeDef)).length > 0, [typeDef]);
  // Activity only makes sense once a note is a task/issue tracked inside a
  // project — a bare note or a planning item has nothing to log against.
  const showActivityTab = object?.type === "task" || object?.type === "issue";
  useEffect(() => { if (!showActivityTab) setActiveTab("properties"); }, [showActivityTab]);

  function scheduleSave(next: Record<string, unknown>) {
    setValues(next);
    setError("");
    const target = objectRef.current;
    if (!target) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSave.current = { next, target, base: baseRef.current };
    saveTimer.current = setTimeout(flushSave, 450);
  }

  async function save(next: Record<string, unknown>, current: PluginObject, base: Record<string, unknown>) {
    setBusy(true); setError("");
    savingRef.current += 1;
    // PROPS-PATCH: read the current props and apply only the keys this edit
    // changed. Writing the whole panel copy erased whatever a plugin, an
    // automation or a sync merge had written since the panel loaded.
    const write = async () => {
      const fresh = await context.data.objects.get(current.id);
      if (!fresh) throw new Error("Object not found.");
      const merged = mergePropsEdit(parsePropsText(fresh.props), base, next);
      return context.data.objects.update(fresh.id, { props: JSON.stringify(merged) }, fresh.updated_at);
    };
    try {
      let updated: PluginObject;
      try {
        updated = await write();
      } catch (value) {
        // Optimistic locking: something wrote between our read and our write
        // (Core's own save of the note body, an automation, our own previous
        // keystroke). Read again and re-apply the same edit once.
        if (!isConflict(value)) throw value;
        updated = await write();
      }
      // The panel may already show another object; only refresh our own.
      if (objectRef.current?.id === updated.id) {
        setObject(updated);
        objectRef.current = updated;
        // Show the merged result, unless the user is already editing again
        // or a later save is still on its way.
        // `baseRef` moves only together with the shown values: the next edit
        // is diffed against what the user was looking at, or it would read
        // every outside change as "the user put the old value back".
        if (!pendingSave.current && savingRef.current === 1) { baseRef.current = parsePropsText(updated.props); setValues(baseRef.current); }
      }
    } catch (value) {
      setError(isConflict(value)
        ? "This record changed somewhere else. Reopen it to see the current values."
        : errorMessage(value));
    } finally { savingRef.current -= 1; setBusy(false); }
  }

  // Closing the panel writes a pending edit instead of dropping it.
  useEffect(() => () => flushSave(), []);
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => { setCustomizing(false); }, [typeDef?.name]);

  return <div className="pp-panel" data-plugin-surface="notible.properties">
    <div className="pp-heading">
      {showActivityTab
        ? <div className="pp-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={activeTab === "properties"} className={activeTab === "properties" ? "is-active" : ""} onClick={() => setActiveTab("properties")}>{t("Properties")}</button>
            <button type="button" role="tab" aria-selected={activeTab === "activity"} className={activeTab === "activity" ? "is-active" : ""} onClick={() => setActiveTab("activity")}>{t("Activity")}</button>
          </div>
        : <h3>{t("Properties")}</h3>}
      {hasFields && activeTab === "properties" && !customizing && <button type="button" className="pp-customize-btn" title={t("Customize properties")} aria-label={t("Customize properties")} onClick={() => setCustomizing(true)}><Settings size={15} /></button>}
      {busy && <span className="pp-busy">{t("Saving…")}</span>}
    </div>
    {!initialContainerId && !object && <p className="pp-muted">{t("Open a task, issue or other typed record to edit its properties here.")}</p>}
    <p className={`pp-status${error ? " pp-error" : ""}`} role="alert">{error}</p>
    {object && activeTab === "activity" && showActivityTab && <div className="pp-tab-content" key="activity"><ActivitySection context={context} objectId={object.id} /></div>}
    {object && activeTab === "properties" && customizing && typeDef && <div className="pp-tab-content" key="customize"><PropertyOrderEditor
      type={typeDef}
      context={context}
      onCancel={() => setCustomizing(false)}
      onSaved={() => {
        setCustomizing(false);
        void context.data.types.list().then(setTypes).catch(() => {});
      }}
    /></div>}
    {object && activeTab === "properties" && !customizing && <div className="pp-tab-content" key="properties">
      {!hasFields && <p className="pp-muted">{t("No properties yet.")}</p>}
      {hasFields && <PropertiesEditor type={typeDef} values={values} onChange={scheduleSave} context={context} objectId={object.id} />}
      <CustomFieldsSection values={values} onChange={scheduleSave} />
    </div>}
    {!object && !error && objectId && <p className="pp-muted">{t("Loading…")}</p>}
  </div>;
}

/** Translation for every component below, from the plugin's own context. The
 * provider has to sit outside the component that consumes it, so the surface
 * proper is `PropertiesPanelInner`. */
export default function PropertiesPanel(props: Props) {
  return <PluginI18nProvider context={props.context as PluginContext}><PropertiesPanelInner {...props} /></PluginI18nProvider>;
}
