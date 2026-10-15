import {
  createObject,
  createRelation,
  deleteRelation,
  deleteDataSource,
  getObject,
  listRelations,
  listDataSources,
  listTypes,
  moveObject,
  queryObjects,
  setObjectType,
  trashObject,
  updateObject,
  upsertType,
  upsertDataSource,
  type NObject,
  type Relation,
  type TypeDef,
} from "../../lib/api";
import type {
  DataApi,
  PluginObject,
  PluginRelation,
  PluginDataSource,
  PluginType,
} from "../../../packages/plugin-api/src/index.ts";

const object = (value: NObject): PluginObject => value;
const relation = (value: Relation): PluginRelation => value;
const type = (value: TypeDef): PluginType => value;
const dataSource = (value: import("../../lib/api").DataSourceRecord): PluginDataSource => value;

/** Core-owned adapter exposed to plugins through the public DataApi contract. */
export const coreDataApi: DataApi = {
  objects: {
    get: async (id) => {
      const value = await getObject(id);
      return value ? object(value) : null;
    },
    create: async (input) => object(await createObject(input.type, input.title, input.content, input.props, input.parentId)),
    update: async (id, patch, expectedUpdatedAt) => object(await updateObject(id, patch, expectedUpdatedAt)),
    setType: async (id, newType, expectedUpdatedAt) => object(await setObjectType(id, newType, expectedUpdatedAt)),
    move: async (id, parentId) => {
      await moveObject(id, parentId);
      const value = await getObject(id);
      if (!value) throw new Error(`Object not found: ${id}`);
      return object(value);
    },
    trash: async (id) => {
      const value = await trashObject(id);
      return value ? object(value) : null;
    },
    query: async (query = {}) => (await queryObjects(query)).map(object),
    // The legacy adapter has no lifecycle event stream (see the index/document/
    // media/sync stubs below) — failing loudly beats a subscription that is
    // silently never called.
    onChange: () => { throw new Error("object change notifications are not available in this host"); },
    // No indexed title lookup either. Degrades to a client-side substring
    // filter over `queryObjects` — acceptable here because this adapter only
    // backs the headless check scripts, never a real workspace at scale.
    findByTitle: async (query, options) => {
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) return [];
      const all = (await queryObjects({ limit: 5000 })).map(object);
      return all.filter((candidate) => {
        const title = (candidate.title || "").toLocaleLowerCase();
        return options?.exact ? title === needle : title.includes(needle);
      });
    },
  },
  index: {
    // The legacy adapter has no content index; the shipped Core one does.
    // Failing loudly beats returning [] and looking like an empty workspace.
    query: async () => { throw new Error("content index is not available in this host"); },
    forObject: async () => { throw new Error("content index is not available in this host"); },
  },
  document: {
    get: async () => { throw new Error("document projection is not available in this host"); },
  },
  media: {
    read: async () => { throw new Error("pasted-image bytes are not available in this host"); },
    pickImage: async () => { throw new Error("the native image picker is not available in this host"); },
    importImageFromUrl: async () => { throw new Error("image import is not available in this host"); },
  },
  relations: {
    list: async (objectId) => (await listRelations(objectId)).map(relation),
    listForObjects: async (ids: string[]) => {
      // The legacy adapter has no bulk command; loop the per-object list. Not
      // efficient, but this host is only used by the headless check scripts.
      const out: Record<string, ReturnType<typeof relation>[]> = {};
      for (const id of ids) {
        out[id] = (await listRelations(id)).map(relation);
      }
      return out;
    },
    create: async (fromId, toId, kind) => relation(await createRelation(fromId, toId, kind)),
    delete: (fromId, toId, kind) => deleteRelation(fromId, toId, kind),
  },
  types: {
    list: async () => (await listTypes()).map(type),
    upsert: async (name, schema, icon, color) => type(await upsertType(name, schema, icon, color)),
  },
  // The legacy adapter predates the sync bridge. Failing loudly beats
  // returning an empty snapshot, which a replicator would read as "this
  // workspace is empty" and act on.
  sync: {
    export: async () => { throw new Error("the sync journal is not available in this host"); },
    apply: async () => { throw new Error("the sync journal is not available in this host"); },
    markOutboxAttempts: async () => { throw new Error("the sync journal is not available in this host"); },
    media: {
      missing: async () => { throw new Error("the sync journal is not available in this host"); },
      read: async () => { throw new Error("the sync journal is not available in this host"); },
      write: async () => { throw new Error("the sync journal is not available in this host"); },
    },
  },
  dataSources: {
    list: async () => (await listDataSources()).map(dataSource),
    upsert: async (name, definition, id) => dataSource(await upsertDataSource(name, definition, id)),
    delete: (id) => deleteDataSource(id),
  },
};
