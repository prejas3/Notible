// SYNC-TRANSPORT (Hive #9): the shared-folder transport behaves like the Drive
// one as Sync uses it: snapshots and key at the top, media apart, bytes intact,
// and an upload to an existing id replaces that file.
import assert from "node:assert/strict";

export async function checkSharedFolder(SharedFolder) {
  const files = new Map();
  const folder = {
    list: async () => [...files.keys()].map((name) => ({ name, modified: String(files.get(name).at) })),
    read: async (name) => files.get(name).data,
    write: async (name, data) => { files.set(name, { data, at: (files.get(name)?.at ?? 0) + 1 }); },
    remove: async (name) => { files.delete(name); },
  };
  const remote = new SharedFolder(folder);
  const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);

  const top = await remote.folderId();
  const media = await remote.mediaFolderId();
  const id = await remote.upload("device-a.json", bytes, undefined, top);
  await remote.upload("x.png.bin", Uint8Array.of(1, 2), undefined, media);
  assert.deepEqual((await remote.list()).map((f) => f.name), ["device-a.json"], "media stays out of the top level");
  assert.deepEqual((await remote.list(media)).map((f) => f.name), ["x.png.bin"]);
  assert.deepEqual(await remote.download(id), bytes, "bytes survive the round trip");

  const before = (await remote.list())[0].modifiedTime;
  assert.equal(await remote.upload("device-a.json", Uint8Array.of(9), id), id, "upload to an existing id replaces it");
  assert.notEqual((await remote.list())[0].modifiedTime, before, "a rewrite changes modifiedTime");
  await remote.delete(id);
  assert.deepEqual(await remote.list(), []);
  assert.ok(remote.signedIn());
}
