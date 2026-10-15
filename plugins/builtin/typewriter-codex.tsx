import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginContext, PluginObject, PluginRelation, PluginType } from "../../packages/plugin-api/src/index.ts";
import { Combobox } from "../../src/core/ui/index.ts";
import { removeSystemicRelation, setSystemicRelation, TYPEWRITER_TYPE_DEFINITIONS } from "./typewriter.ts";
import { PropertiesEditor } from "./PropertiesEditor.tsx";
import { useT, tr } from "./i18n.tsx";
import { inManuscript, sceneReadingRank, singletonRepair } from "./typewriter-model.ts";

const NS = "notible.typewriter.";
const TYPE = {
  scene: `${NS}scene`,
  part: `${NS}part`,
  chapter: `${NS}chapter`,
  character: `${NS}character`,
  location: `${NS}location`,
  plotline: `${NS}plotline`,
  memo: `${NS}memo`,
} as const;

function orderOf(object: PluginObject): number {
  const value = Number(parseProps(object.props).order);
  return Number.isFinite(value) ? value : 0;
}

export const REL = {
  pov: "tw.pov",
  present: "tw.present",
  setIn: "tw.setIn",
  covers: "tw.covers",
} as const;

type EntityKind = "character" | "location" | "plotline" | "memo";
const KIND_TYPE: Record<EntityKind, string> = { character: TYPE.character, location: TYPE.location, plotline: TYPE.plotline, memo: TYPE.memo };
const KIND_LABEL: Record<EntityKind, string> = { character: tr("Characters"), location: tr("Locations"), plotline: tr("Plotlines"), memo: tr("Memos") };
// One deliberate colour per kind — not a hash of the record's own title, which
// read as random and clashed from row to row. Tokens only, same as the beat
// colours on the Board: --notible-accent/-success/-warning are the app's
// three strong, white-text-safe fills.
const KIND_AVATAR_COLOR: Record<EntityKind, string> = {
  character: "var(--notible-accent)",
  location: "var(--notible-success)",
  plotline: "var(--notible-warning)",
  memo: "var(--notible-highlight-purple)",
};

function parseProps(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

/** Synthetic PluginType so PropertiesEditor can render a namespaced type's
 *  fields (minus `related`, which has its own editor in Task 6). */
function synthType(typeName: string): PluginType | undefined {
  const def = TYPEWRITER_TYPE_DEFINITIONS.find((candidate) => candidate.name === typeName);
  if (!def) return undefined;
  const fields = Object.fromEntries(Object.entries(def.fields).filter(([key]) => key !== "related"));
  return { name: def.name, schema: JSON.stringify({ fields, uiPrimary: Object.keys(fields) }), icon: def.icon, color: def.color };
}

interface Props {
  context: PluginContext;
  manuscriptId: string;
}

export default function TypewriterCodex({ context, manuscriptId }: Props) {
  const t = useT();
  const [kind, setKind] = useState<EntityKind>("character");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [records, setRecords] = useState<PluginObject[]>([]);
  const [scenes, setScenes] = useState<PluginObject[]>([]);
  const [containers, setContainers] = useState<PluginObject[]>([]);
  const [relations, setRelations] = useState<PluginRelation[]>([]);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [relatedLabel, setRelatedLabel] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [chars, locs, plots, memos, sceneRows, parts, chapters] = await Promise.all([
        context.data.objects.query({ type: TYPE.character, limit: 2000 }),
        context.data.objects.query({ type: TYPE.location, limit: 2000 }),
        context.data.objects.query({ type: TYPE.plotline, limit: 2000 }),
        context.data.objects.query({ type: TYPE.memo, limit: 2000 }),
        context.data.objects.query({ type: TYPE.scene, limit: 5000 }),
        context.data.objects.query({ type: TYPE.part, limit: 1000 }),
        context.data.objects.query({ type: TYPE.chapter, limit: 2000 }),
      ]);
      const mine = (list: PluginObject[]) => list.filter((row) => inManuscript(row.props, manuscriptId));
      const myRecords = [...mine(chars), ...mine(locs), ...mine(plots), ...mine(memos)];
      // Self-heal entities created before they were parented — without a
      // parent Core's editor shows no "back to parent" arrow from "Edit notes".
      const orphans = myRecords.filter((row) => !row.parent_id);
      if (orphans.length) {
        await Promise.all(orphans.map((row) => context.data.objects.move(row.id, manuscriptId).catch(() => {})));
        for (const row of orphans) row.parent_id = manuscriptId;
      }
      setRecords(myRecords);
      setScenes(mine(sceneRows));
      setContainers([...mine(parts), ...mine(chapters)]);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }, [context, manuscriptId]);

  useEffect(() => { void load(); }, [load]);

  const kindRecords = useMemo(
    () => records
      .filter((row) => row.type === KIND_TYPE[kind])
      .filter((row) => !search.trim() || row.title.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title)),
    [records, kind, search],
  );

  // Keep the detail pane useful after loading, filtering or changing category.
  useEffect(() => {
    setSelectedId((current) => kindRecords.some((row) => row.id === current) ? current : kindRecords[0]?.id ?? "");
  }, [kindRecords]);

  const selected = useMemo(() => records.find((row) => row.id === selectedId) ?? null, [records, selectedId]);
  const scenesById = useMemo(() => new Map(scenes.map((row) => [row.id, row])), [scenes]);

  // Reading order for "appears in": part/chapter `order`, then scene `order`
  // within each — flattened depth-first (see sceneReadingRank).
  const sceneRank = useMemo(
    () => sceneReadingRank(
      scenes.map((row) => ({ id: row.id, parentId: row.parent_id ?? null, order: orderOf(row) })),
      [
        { id: manuscriptId, parentId: null, order: 0 },
        ...containers.map((row) => ({ id: row.id, parentId: row.parent_id ?? null, order: orderOf(row) })),
      ],
    ),
    [scenes, containers, manuscriptId],
  );

  const reloadRelations = useCallback(async () => {
    if (!selectedId) { setRelations([]); return; }
    const grouped = await context.data.relations.listForObjects([selectedId]);
    setRelations(grouped[selectedId] ?? []);
  }, [context, selectedId]);

  useEffect(() => {
    if (!selected) { setRelations([]); setPreview(""); return; }
    let cancelled = false;
    (async () => {
      try {
        await reloadRelations();
        const blocks = await context.data.document.get(selected.id);
        if (!cancelled) setPreview(blocks.slice(0, 6).map((block) => block.text).filter(Boolean).join("\n"));
      } catch (value) {
        if (!cancelled) setError(value instanceof Error ? value.message : String(value));
      }
    })();
    return () => { cancelled = true; };
  }, [context, selected, reloadRelations]);

  // singleton repair — a synced-in duplicate pov/setIn on any scene.
  useEffect(() => {
    if (scenes.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const grouped = await context.data.relations.listForObjects(scenes.map((row) => row.id));
        for (const scene of scenes) {
          if (cancelled) return;
          for (const relKind of [REL.pov, REL.setIn]) {
            const hits = (grouped[scene.id] ?? [])
              .filter((rel) => rel.from_id === scene.id && rel.kind === relKind)
              .map((rel) => ({ toId: rel.to_id }));
            if (hits.length > 1) {
              const { drop } = singletonRepair(hits);
              for (const extra of drop) await context.data.relations.delete(scene.id, extra.toId, relKind);
              console.warn(`typewriter: repaired duplicate ${relKind} on scene ${scene.id}`);
            }
          }
        }
      } catch { /* best effort */ }
    })();
    return () => { cancelled = true; };
  }, [context, scenes]);

  const appearsIn = useMemo(() => {
    if (!selected) return [] as PluginObject[];
    const sceneIds = new Set<string>();
    for (const rel of relations) {
      if (kind === "plotline") {
        if (rel.kind === REL.covers && rel.from_id === selected.id) sceneIds.add(rel.to_id);
      } else if (rel.to_id === selected.id && (rel.kind === REL.pov || rel.kind === REL.present || rel.kind === REL.setIn)) {
        sceneIds.add(rel.from_id);
      }
    }
    return [...sceneIds]
      .map((id) => scenesById.get(id))
      .filter((row): row is PluginObject => Boolean(row))
      .sort((a, b) => (sceneRank.get(a.id) ?? 0) - (sceneRank.get(b.id) ?? 0));
  }, [selected, relations, kind, scenesById, sceneRank]);

  const linkedSceneIds = useCallback((relKind: string): string[] => {
    if (!selected) return [];
    return relations
      .filter((rel) => rel.kind === relKind && (kind === "plotline" ? rel.from_id === selected.id : rel.to_id === selected.id))
      .map((rel) => (kind === "plotline" ? rel.to_id : rel.from_id));
  }, [relations, selected, kind]);

  async function addSceneLink(sceneId: string, relKind: string, single: boolean) {
    if (!selected) return;
    const from = kind === "plotline" ? selected.id : sceneId;
    const to = kind === "plotline" ? sceneId : selected.id;
    setBusy(true);
    try { await setSystemicRelation(context, from, to, relKind, { single }); await reloadRelations(); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  }

  async function removeSceneLink(sceneId: string, relKind: string) {
    if (!selected) return;
    const from = kind === "plotline" ? selected.id : sceneId;
    const to = kind === "plotline" ? sceneId : selected.id;
    setBusy(true);
    try { await removeSystemicRelation(context, from, to, relKind); await reloadRelations(); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  }

  function renderSceneLinks(title: string, relKind: string, single: boolean) {
    const linked = linkedSceneIds(relKind);
    const linkedSet = new Set(linked);
    const candidates = scenes
      .filter((scene) => !linkedSet.has(scene.id))
      .sort((a, b) => (sceneRank.get(a.id) ?? 0) - (sceneRank.get(b.id) ?? 0));
    return (
      <div className="tw-links" key={relKind}>
        <span className="tw-links-title">{title}</span>
        <div className="tw-links-chips">
          {linked.map((id) => (
            <span key={id} className="tw-chip">
              {scenesById.get(id)?.title || t("Untitled scene")}
              <button type="button" aria-label={t("Remove")} disabled={busy} onClick={() => void removeSceneLink(id, relKind)}>×</button>
            </span>
          ))}
          {linked.length === 0 && <span className="ns-muted">none</span>}
        </div>
        {candidates.length > 0 && (
          <Combobox
            value=""
            options={candidates.map((scene) => ({ value: scene.id, label: scene.title || t("Untitled scene") }))}
            onChange={(sceneId) => { if (sceneId) void addSceneLink(sceneId, relKind, single); }}
            ariaLabel={`Add scene to ${title}`}
            placeholder={t("Add scene…")}
          />
        )}
      </div>
    );
  }

  async function setRelatedCharacters(next: { toId: string; label: string }[]) {
    await saveProps({ related: JSON.stringify(next) });
  }

  function renderRelatedCharacters() {
    if (!selected || kind !== "character") return null;
    const own: { toId: string; label: string }[] = (() => {
      try { return JSON.parse(String(parseProps(selected.props).related ?? "[]")); } catch { return []; }
    })();
    const ownSet = new Set(own.map((entry) => entry.toId));
    const inbound = records
      .filter((row) => row.type === TYPE.character && row.id !== selected.id)
      .filter((row) => {
        try { return (JSON.parse(String(parseProps(row.props).related ?? "[]")) as { toId: string }[]).some((entry) => entry.toId === selected.id); }
        catch { return false; }
      });
    const candidates = records.filter((row) => row.type === TYPE.character && row.id !== selected.id && !ownSet.has(row.id));
    return (
      <div className="tw-links">
        <span className="tw-links-title">{t("Related characters")}</span>
        <ul className="tw-codex-appears">
          {own.map((entry) => (
            <li key={entry.toId}>
              <button type="button" onClick={() => void context.ui.openObject(entry.toId)}>
                {records.find((row) => row.id === entry.toId)?.title || t("Unknown")}
              </button>
              <span className="ns-muted"> {entry.label}</span>
              <button type="button" aria-label={t("Remove")} disabled={busy} onClick={() => void setRelatedCharacters(own.filter((other) => other.toId !== entry.toId))}>×</button>
            </li>
          ))}
          {inbound.map((row) => (
            <li key={`in-${row.id}`}>
              <button type="button" onClick={() => void context.ui.openObject(row.id)}>{row.title || t("Unknown")}</button>
              <span className="ns-muted"> (linked from)</span>
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <div className="tw-links-add">
            <input type="text" placeholder={t("Relationship (e.g. sister)")} value={relatedLabel} onChange={(event) => setRelatedLabel(event.target.value)} />
            <Combobox
              value=""
              options={candidates.map((row) => ({ value: row.id, label: row.title || "Untitled" }))}
              onChange={(id) => { if (id) { void setRelatedCharacters([...own, { toId: id, label: relatedLabel.trim() }]); setRelatedLabel(""); } }}
              ariaLabel={t("Add related character")}
              placeholder={t("Add character…")}
            />
          </div>
        )}
      </div>
    );
  }

  async function saveProps(next: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    try {
      await context.data.objects.update(selected.id, { props: JSON.stringify({ ...parseProps(selected.props), ...next }) }, selected.updated_at);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function createEntity() {
    setBusy(true);
    try {
      const created = await context.data.objects.create({
        type: KIND_TYPE[kind],
        title: `New ${kind}`,
        // parentId = the manuscript so Core's editor shows a "back to parent"
        // arrow from the entity note; the row stays hidden (behaviour.treeHidden).
        parentId: manuscriptId,
        props: JSON.stringify({ "tw.manuscriptId": manuscriptId }),
      });
      await load();
      setSelectedId(created.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntity() {
    if (!selected) return;
    setBusy(true);
    try {
      await context.data.objects.trash(selected.id);
      setSelectedId("");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tw-codex">
        <div className="tw-codex-kinds" role="group" aria-label={t("Codex")}>
          {(Object.keys(KIND_LABEL) as EntityKind[]).map((entityKind) => (
            <button key={entityKind} type="button" aria-pressed={entityKind === kind} className={entityKind === kind ? "is-active" : ""} onClick={() => { setKind(entityKind); setSelectedId(""); setSearch(""); }}>
              {t(KIND_LABEL[entityKind])}
              <span className="tw-kind-count">{records.filter((row) => row.type === KIND_TYPE[entityKind]).length}</span>
            </button>
          ))}
        </div>
      <div className="tw-codex-folder">
      <div className="tw-codex-list">
        <input className="tw-codex-search" type="text" aria-label={t("Filter codex entries")} placeholder={t("Filter…")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <button type="button" className="tw-btn tw-codex-new" disabled={busy} onClick={() => void createEntity()}>+ New {kind}</button>
        <ul className="tw-codex-rows">
          {kindRecords.map((row) => {
            const title = row.title || "Untitled";
            return (
              <li key={row.id}>
                <button type="button" aria-pressed={row.id === selectedId} className={row.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(row.id)}>
                  <span className="tw-codex-avatar" style={{ background: KIND_AVATAR_COLOR[kind] }} aria-hidden="true">{title.slice(0, 1).toUpperCase()}</span>
                  <span className="tw-codex-row-title">{title}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {kindRecords.length === 0 && <p className="ns-muted tw-codex-empty">{search.trim() ? t("No matching entries.") : t("No entries yet.")}</p>}
      </div>

      <div className="tw-codex-page" key={selected?.id ?? kind}>
        {error && <p className="ns-message ns-message-error">{error}</p>}
        {!selected ? (
          <div className="tw-codex-empty-detail"><h3>{t(KIND_LABEL[kind])}</h3><p className="ns-muted">{search.trim() ? t("Try a different search.") : t("Create an entry to start building your story world.")}</p></div>
        ) : (
          <>
            <div className="tw-codex-page-head">
              <span className="tw-codex-seal" style={{ background: KIND_AVATAR_COLOR[kind] }} aria-hidden="true">
                {(selected.title || "?").slice(0, 1).toUpperCase()}
              </span>
              <h3 className="tw-codex-name">{selected.title || "Untitled"}</h3>
              <div className="tw-codex-page-actions">
                <button type="button" className="tw-btn-quiet" onClick={() => void context.ui.openObject(selected.id)}>{t("Edit notes")}</button>
                <button type="button" className="tw-btn-danger" disabled={busy} onClick={() => void deleteEntity()}>{t("Delete")}</button>
              </div>
            </div>
            <PropertiesEditor type={synthType(selected.type)} values={parseProps(selected.props)} onChange={saveProps} context={context} objectId={selected.id} />
            {preview && <pre className="tw-codex-preview">{preview}</pre>}

            <div className="tw-codex-relations">
            {kind === "character" && renderSceneLinks(t("POV of scenes"), REL.pov, true)}
            {kind === "character" && renderSceneLinks(t("Present in scenes"), REL.present, false)}
            {kind === "location" && renderSceneLinks(t("Setting for scenes"), REL.setIn, true)}
            {kind === "plotline" && renderSceneLinks(t("Covers scenes"), REL.covers, false)}
            </div>
            {renderRelatedCharacters()}

            {kind !== "memo" && <h4 className="tw-codex-h4">{t("Appears in")}</h4>}
            {kind === "memo" ? (
              <p className="ns-muted">{t("Open “Edit notes” to write the memo itself. Link it to Board cards from a card's right-click menu.")}</p>
            ) : appearsIn.length === 0 ? (
              <p className="ns-muted">{t("No linked scenes yet.")}</p>
            ) : (
              <ul className="tw-codex-appears">
                {appearsIn.map((scene) => (
                  <li key={scene.id}>
                    <button type="button" onClick={() => void context.ui.openObject(scene.id)}>{scene.title || t("Untitled scene")}</button>
                    <span className="ns-muted"> {String(parseProps(scene.props).status ?? "")}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
