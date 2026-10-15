import { shownStatuses, statusChoices } from "./task-statuses.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import type { PluginContext, PluginObject, PluginType } from "../../packages/plugin-api/src/index.ts";
import "./surface.css";
import "./properties-editor.css";
import { Select, Combobox, DatePicker } from "../../src/core/ui/index.ts";
import { DependencyList } from "./DependencyList.tsx";
// Rendered inside another builtin surface, which supplies the provider.
import { useT } from "./i18n.tsx";

interface SchemaField { type?: string; options?: string[]; refType?: string; }

const TAG_PALETTE = ["#e07a5f", "#3d9970", "#4a6fa5", "#b5838d", "#c9a227", "#7b6d8d", "#5c8374", "#a15c53", "#4f8a8b", "#8e6c88"];

/** Deterministic per-tag color: same tag name always gets the same swatch,
 * across cards and re-renders, without persisting a color assignment. */
export function tagColor(tag: string): string {
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

/** Other records in the same project — walking up parentId via `in`
 * relations, the same scope MainPanel's legacy TagBar uses. Feeds both the
 * tag suggestions and the dependency picker, so neither has to reload the
 * sibling set on its own. */
export function useProjectSiblings(context: PluginContext | undefined, objectId: string | undefined): PluginObject[] {
  const [siblings, setSiblings] = useState<PluginObject[]>([]);
  useEffect(() => {
    if (!context || !objectId) { setSiblings([]); return; }
    let active = true;
    (async () => {
      try {
        let scopeId: string | null = null;
        let cursorId: string | null = objectId;
        for (let depth = 0; cursorId && depth < 8; depth += 1) {
          const relations = await context.data.relations.list(cursorId);
          const parentId = relations.find((relation) => relation.from_id === cursorId && relation.kind === "in")?.to_id ?? null;
          if (!parentId) break;
          const parent = await context.data.objects.get(parentId);
          if (parent?.type === "project") { scopeId = parent.id; break; }
          cursorId = parentId;
        }
        const found = await context.data.objects.query({ parentId: scopeId ?? undefined, limit: 250 });
        if (active) setSiblings(found);
      } catch { if (active) setSiblings([]); }
    })();
    return () => { active = false; };
  }, [context, objectId]);
  return siblings;
}

/** Native <datalist> is unreliable in WebView2 (Windows) when its options
 * change dynamically, so tag suggestions render their own small dropdown. */
function useProjectTagPool(context: PluginContext | undefined, objectId: string | undefined): string[] {
  const siblings = useProjectSiblings(context, objectId);
  return useMemo(() => {
    const seen = new Set<string>();
    for (const sibling of siblings) {
      try {
        const siblingTags = (JSON.parse(sibling.props) as { tags?: unknown }).tags;
        if (Array.isArray(siblingTags)) for (const tag of siblingTags) if (typeof tag === "string" && tag.trim()) seen.add(tag.trim());
      } catch { /* malformed props on a sibling shouldn't break suggestions */ }
    }
    return [...seen].sort();
  }, [siblings]);
}

function TagsField({ label, value, onChange, context, objectId }: { label: string; value: unknown; onChange: (next: unknown) => void; context?: PluginContext; objectId?: string }) {
  const t = useT();
  const tags = Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Which suggestion the keyboard has landed on (-1 = the typed text itself).
  // Testers reported the list was mouse-only: ↑/↓ did nothing and Tab
  // committed the half-typed draft instead of the suggestion under it.
  const [highlight, setHighlight] = useState(-1);
  const pool = useProjectTagPool(context, objectId);
  function commit(tag: string) {
    const next = tag.trim();
    setDraft("");
    setHighlight(-1);
    setDismissed(false);
    if (!next || tags.includes(next)) return;
    onChange([...tags, next]);
  }
  const suggestions = focused && draft.trim() && !dismissed
    ? pool.filter((tag) => !tags.includes(tag) && tag.toLowerCase().includes(draft.trim().toLowerCase()))
    : [];
  const active = highlight >= 0 && highlight < suggestions.length ? suggestions[highlight] : "";
  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, -1));
    } else if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(active || draft);
    } else if (event.key === "Tab" && suggestions.length) {
      // Pick the suggestion (highlighted, else the first) rather than
      // tabbing away and letting blur commit a partial word.
      event.preventDefault();
      commit(active || suggestions[0]);
    } else if (event.key === "Escape" && suggestions.length) {
      event.preventDefault();
      setDismissed(true);
      setHighlight(-1);
    }
  }
  return (
    <label className="properties-editor-field">
      {label}
      <div className="properties-editor-tags">
        {tags.map((tag) => <span key={tag} className="properties-editor-tag" style={{ background: tagColor(tag) }}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((existing) => existing !== tag))}>×</button></span>)}
        <span className="properties-editor-tag-input-wrap">
          <input
            value={draft}
            placeholder={t("Add tag…")}
            onChange={(event) => { setDraft(event.target.value); setHighlight(-1); setDismissed(false); }}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            onBlur={() => { commit(draft); setFocused(false); }}
          />
          {suggestions.length > 0 && (
            <div className="properties-editor-tag-suggest">
              {suggestions.map((tag, index) => (
                <button key={tag} type="button" className={index === highlight ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); commit(tag); }}>{tag}</button>
              ))}
            </div>
          )}
        </span>
      </div>
    </label>
  );
}

/** Fields named `<x>Id` with no explicit refType are assumed to reference
 * an object of type `<x>` (milestoneId -> "milestone"), so existing schemas
 * get autocomplete without every call site adding refType by hand. */
function inferRefType(name: string, spec: SchemaField): string | undefined {
  if (spec.refType) return spec.refType;
  const match = /^(.+)Id$/.exec(name);
  return match ? match[1] : undefined;
}

/** Themed searchable picker over existing `<refType>` records, so picking
 * e.g. a milestone suggests titles instead of requiring a raw id. */
function RefField({ label, refType, value, onChange, context }: { label: string; refType: string; value: unknown; onChange: (next: unknown) => void; context: PluginContext | undefined }) {
  const [options, setOptions] = useState<PluginObject[]>([]);
  useEffect(() => {
    let active = true;
    if (!context) return;
    void context.data.objects.query({ type: refType }).then((records) => { if (active) setOptions(records); }).catch(() => { if (active) setOptions([]); });
    return () => { active = false; };
  }, [context, refType]);
  const current = options.find((option) => option.id === value);
  return (
    <label className="properties-editor-field">
      {label}
      <Combobox
        value={current ? current.id : typeof value === "string" ? value : ""}
        options={options.map((option) => ({ value: option.id, label: option.title || "Untitled" }))}
        placeholder={context ? `Search ${refType}…` : undefined}
        onChange={(id) => onChange(id || undefined)}
        onFreeText={(text) => onChange(text || undefined)}
        ariaLabel={label}
        disabled={!context}
      />
    </label>
  );
}

export function parseTypeSchema(type: PluginType | undefined): Record<string, SchemaField> {
  if (!type) return {};
  try {
    const schema = JSON.parse(type.schema) as { fields?: Record<string, SchemaField> };
    return schema.fields && typeof schema.fields === "object" ? schema.fields : {};
  } catch {
    return {};
  }
}

/** `primary` = shown open (General), `more` = collapsed under "More
 * properties" (Other) — the same two areas the panel itself renders,
 * named to match. */
export interface TypeUiConfig { primary: string[]; more: string[]; hidden: string[] }

/** Per-type Properties panel customization (which fields show, which
 * section, in what order) — a sibling of `fields` in the same schema JSON,
 * so it round-trips through `types.upsert` without touching the field
 * definitions themselves. Applies to every record of the type, not
 * per-object. */
export function parseTypeUiConfig(type: PluginType | undefined): TypeUiConfig {
  if (!type) return { primary: [], more: [], hidden: [] };
  try {
    const schema = JSON.parse(type.schema) as { uiPrimary?: unknown; uiMore?: unknown; uiHidden?: unknown };
    const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return { primary: strings(schema.uiPrimary), more: strings(schema.uiMore), hidden: strings(schema.uiHidden) };
  } catch {
    return { primary: [], more: [], hidden: [] };
  }
}

/** Persist a new grouping/order/hidden set for a type without touching its
 * field definitions or any other schema keys already present. */
export async function saveTypeUiConfig(context: PluginContext, type: PluginType, config: TypeUiConfig): Promise<void> {
  const schema = JSON.parse(type.schema) as Record<string, unknown>;
  schema.uiPrimary = config.primary;
  schema.uiMore = config.more;
  schema.uiHidden = config.hidden;
  await context.data.types.upsert(type.name, JSON.stringify(schema), type.icon ?? undefined, type.color ?? undefined);
}

function labelOf(value: string): string {
  if (!value) return value;
  const withoutTrailingId = value.replace(/Id$/, "");
  const spaced = withoutTrailingId.replaceAll("-", " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Shown open, above the fold, in this order when present. Everything else
// (ids, reminders, recurrence, ...) is secondary and lives in the collapsed
// "More properties" section below.
const PRIMARY_FIELD_ORDER = ["status", "priority", "severity", "assignee", "due", "targetDate", "startDate"];

/** The built-in General/Other split for a type that has never been
 * customized — same rule `PropertiesEditor` uses to render by default.
 * Shared with the Customize screen so it opens already reflecting the
 * panel's actual current grouping, not an arbitrary schema-declaration
 * order. */
function defaultGrouping(fields: [string, SchemaField][]): { primary: string[]; more: string[] } {
  const names = fields.map(([name]) => name);
  const primary = PRIMARY_FIELD_ORDER.filter((name) => names.includes(name));
  const tagsName = fields.find(([name, spec]) => spec.type === "tags" && !primary.includes(name))?.[0];
  if (tagsName) primary.push(tagsName);
  const more = names.filter((name) => !primary.includes(name));
  return { primary, more };
}

/**
 * Shared inline properties editor: renders one control per schema field
 * (select/date/number/bool/text) so a plugin's create/edit form exposes the
 * real record shape instead of only a title. Any domain plugin can reuse
 * this against its own type's schema and DataApi.
 */
const PEOPLE_FIELDS = new Set(["assignee", "reporter", "owner", "lead"]);

export function PropertiesEditor({
  type,
  values,
  onChange,
  context,
  objectId,
}: {
  type: PluginType | undefined;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  context?: PluginContext;
  objectId?: string;
}) {
  const t = useT();
  // The project around this item decides which statuses it offers (D2). Before any early return:
  // a hook after one is the React #310 crash of 0.64.
  const [parentProps, setParentProps] = useState<Record<string, unknown> | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setParentProps(undefined);
    if (!context || !objectId || type?.name !== "task") return;
    void (async () => {
      try {
        const self = await context.data.objects.get(objectId);
        const parent = self?.parent_id ? await context.data.objects.get(self.parent_id) : null;
        const parsed = parent ? JSON.parse(parent.props || "{}") as unknown : null;
        if (!cancelled) setParentProps(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined);
      } catch { /* no parent, or no access: the full list */ }
    })();
    return () => { cancelled = true; };
  }, [context, objectId, type?.name]);
  const allFields = Object.entries(parseTypeSchema(type));
  if (allFields.length === 0) return null;
  const uiConfig = parseTypeUiConfig(type);
  const hiddenSet = new Set(uiConfig.hidden);
  const fields = allFields.filter(([name]) => !hiddenSet.has(name));
  if (fields.length === 0) return null;

  function renderField([name, spec]: [string, SchemaField]) {
    const value = values[name];
    const set = (next: unknown) => onChange({ ...values, [name]: next });
    const refType = spec.type !== "select" && spec.type !== "date" && spec.type !== "number" && spec.type !== "bool" && spec.type !== "tags" && spec.type !== "deps" ? inferRefType(name, spec) : undefined;
    if (refType) {
      return <RefField key={name} label={labelOf(name)} refType={refType} value={value} onChange={set} context={context} />;
    }
    if (spec.type === "deps") {
      return <DependencyList key={name} label={t("Dependencies")} value={value} onChange={set} context={context} objectId={objectId} />;
    }
    if (spec.type === "tags") {
      return <TagsField key={name} label={labelOf(name)} value={value} onChange={set} context={context} objectId={objectId} />;
    }
    if (spec.type === "select") {
      return (
        <label key={name} className="properties-editor-field">
          {labelOf(name)}
          <Select
            value={String(value ?? "")}
            onChange={(next) => set(next || undefined)}
            options={(name === "status" ? statusChoices(shownStatuses(spec.options ?? [], parentProps, type?.name ?? ""), String(value ?? "")) : spec.options ?? []).map((option) => ({ value: option, label: labelOf(option) }))}
            ariaLabel={labelOf(name)}
          />
        </label>
      );
    }
    if (spec.type === "date") {
      return (
        <label key={name} className="properties-editor-field">
          {labelOf(name)}
          <DatePicker
            value={typeof value === "string" ? value.slice(0, 10) : ""}
            onChange={(next) => set(next || undefined)}
            ariaLabel={labelOf(name)}
          />
        </label>
      );
    }
    if (spec.type === "number") {
      return (
        <label key={name} className="properties-editor-field">
          {labelOf(name)}
          <input type="number" value={value == null ? "" : String(value)} onChange={(event) => set(event.target.value === "" ? undefined : Number(event.target.value))} />
        </label>
      );
    }
    if (spec.type === "bool") {
      return (
        <label key={name} className="properties-editor-field properties-editor-bool">
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => set(event.target.checked)} />
          {labelOf(name)}
        </label>
      );
    }
    return (
      <label key={name} className="properties-editor-field">
        {labelOf(name)}
        <input type="text" value={typeof value === "string" ? value : value == null ? "" : String(value)} placeholder={PEOPLE_FIELDS.has(name) ? t("Who? Type a name") : name === "team" ? t("Which team?") : t("Empty")} onChange={(event) => set(event.target.value || undefined)} />
      </label>
    );
  }

  // A user-set grouping (via the panel's Customize screen) replaces the
  // built-in primary/more-properties split entirely: every visible field
  // renders full-width, one per row, in exactly the chosen order — no grid
  // packing, so "move X above Y" always means what it looks like. A field
  // added to the type's schema after the grouping was saved is appended to
  // Other (More properties) rather than disappearing.
  if (uiConfig.primary.length > 0 || uiConfig.more.length > 0) {
    const byName = new Map(fields);
    const known = new Set([...uiConfig.primary, ...uiConfig.more]);
    const uncategorized = fields.map(([name]) => name).filter((name) => !known.has(name));
    const primaryNames = uiConfig.primary.filter((name) => byName.has(name));
    const moreNames = [...uiConfig.more.filter((name) => byName.has(name)), ...uncategorized];
    return (
      <div className="properties-editor">
        {primaryNames.map((name) => renderField([name, byName.get(name)!]))}
        {moreNames.length > 0 && (
          <details className="properties-editor-more" open={primaryNames.length === 0}>
            <summary>{t("More properties")}</summary>
            {moreNames.map((name) => renderField([name, byName.get(name)!]))}
          </details>
        )}
      </div>
    );
  }

  const primary = PRIMARY_FIELD_ORDER.map((name) => fields.find(([candidate]) => candidate === name)).filter((entry): entry is [string, SchemaField] => entry !== undefined);
  const primaryNames = new Set(primary.map(([name]) => name));
  // Tags is a full-width block, not a one-line grid field — a wrapped row of
  // pills can be wider than a 150px grid column, which forced the whole
  // panel to scroll sideways. Render it below the primary grid, same
  // treatment as Dependencies below.
  const tagsField = fields.find(([name, spec]) => spec.type === "tags" && !primaryNames.has(name));
  const rest = fields.filter(([name]) => !primaryNames.has(name) && name !== tagsField?.[0]);
  const restDeps = rest.filter(([, spec]) => spec.type === "deps");
  const restGrid = rest.filter(([, spec]) => spec.type !== "deps");

  return (
    <div className="properties-editor">
      {primary.length > 0 && <div className="properties-editor-grid">{primary.map(renderField)}</div>}
      {tagsField && renderField(tagsField)}
      {rest.length > 0 && (
        <details className="properties-editor-more" open={primary.length === 0}>
          <summary>{t("More properties")}</summary>
          {restGrid.length > 0 && <div className="properties-editor-grid">{restGrid.map(renderField)}</div>}
          {restDeps.map(renderField)}
        </details>
      )}
    </div>
  );
}

type OrderSections = { primary: string[]; more: string[] };
type SectionKey = "primary" | "more";

/** "Customize" screen for the Properties panel — per-TYPE (every record of
 * this type gets the same layout), not per-object. Two sections, General
 * and Other, mirror the panel's own open/"More properties" areas exactly —
 * dragging a field between them moves it between those two areas.
 *
 * Reordering is pointer-events + `elementFromPoint`, not native HTML5
 * drag-and-drop — the latter doesn't work reliably in the Tauri/WebView2
 * shell (see the Tables plugin's own drag-select fix, same root cause). */
export function PropertyOrderEditor({
  type,
  context,
  onCancel,
  onSaved,
}: {
  type: PluginType;
  context: PluginContext;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const schemaFields = Object.entries(parseTypeSchema(type));
  const initial = parseTypeUiConfig(type);
  const hasCustomGrouping = initial.primary.length > 0 || initial.more.length > 0;
  const [sections, setSections] = useState<OrderSections>(() => {
    if (!hasCustomGrouping) return defaultGrouping(schemaFields);
    const known = new Set([...initial.primary, ...initial.more]);
    const uncategorized = schemaFields.map(([name]) => name).filter((name) => !known.has(name));
    return {
      primary: initial.primary.filter((name) => schemaFields.some(([candidate]) => candidate === name)),
      more: [...initial.more.filter((name) => schemaFields.some(([candidate]) => candidate === name)), ...uncategorized],
    };
  });
  const [hidden, setHidden] = useState(new Set(initial.hidden));
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);

  function toggle(name: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function startDrag(event: ReactPointerEvent, name: string) {
    event.preventDefault();
    draggingRef.current = name;
    setDragging(name);

    function onMove(moveEvent: PointerEvent) {
      const dragged = draggingRef.current;
      if (!dragged) return;
      const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const container = el?.closest("[data-order-container]") as HTMLElement | null;
      if (!container) return;
      const targetSection = container.dataset.orderContainer as SectionKey;
      const row = el?.closest("[data-order-name]") as HTMLElement | null;
      const targetName = row?.dataset.orderName;
      if (targetName === dragged) return;
      setSections((current) => {
        const primary = current.primary.filter((n) => n !== dragged);
        const more = current.more.filter((n) => n !== dragged);
        const list = targetSection === "primary" ? primary : more;
        const index = targetName ? list.indexOf(targetName) : list.length;
        list.splice(index < 0 ? list.length : index, 0, dragged);
        return { primary, more };
      });
    }
    function onUp() {
      draggingRef.current = null;
      setDragging(null);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  async function save() {
    setBusy(true);
    try {
      await saveTypeUiConfig(context, type, { primary: sections.primary, more: sections.more, hidden: [...hidden] });
      onSaved();
    } finally { setBusy(false); }
  }

  function renderList(names: string[], section: SectionKey) {
    return <ul className="pp-order-list" data-order-container={section}>
      {names.map((name) => <li
        key={name}
        data-order-name={name}
        className={`pp-order-row${dragging === name ? " is-dragging" : ""}`}
      >
        <button type="button" className="pp-order-grip" aria-label={t("Drag to reorder")} onPointerDown={(event) => startDrag(event, name)}>
          <GripVertical size={14} />
        </button>
        <label>
          <input type="checkbox" checked={!hidden.has(name)} onChange={() => toggle(name)} />
          {labelOf(name)}
        </label>
      </li>)}
      {names.length === 0 && <li className="pp-order-empty" data-order-container={section}>{t("Drop a field here")}</li>}
    </ul>;
  }

  return <div className="pp-order-editor">
    <p className="pp-muted">{t("Applies to every {type} record. Drag a field between sections to move it.", { type: labelOf(type.name) })}</p>
    <div className="pp-order-section">
      <h4>{t("General")}</h4>
      {renderList(sections.primary, "primary")}
    </div>
    <div className="pp-order-section">
      <h4>{t("Other")}</h4>
      {renderList(sections.more, "more")}
    </div>
    <div className="pp-order-actions">
      <button type="button" className="ns-btn" onClick={onCancel} disabled={busy}>{t("Cancel")}</button>
      <button type="button" className="pp-primary" onClick={() => void save()} disabled={busy}>{t("Save")}</button>
    </div>
  </div>;
}
