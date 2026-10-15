import assert from "node:assert/strict";
import { buildPluginRows } from "../src/product/plugin-rows.ts";
import { BUILTIN_PLUGINS } from "../src/product/builtin.ts";
import { categoryOf } from "../src/product/plugin-enrichment.ts";

const rows = buildPluginRows({ builtins: BUILTIN_PLUGINS, activeIds: [], localEntries: [] });

// Every builtin is visible regardless of enrichment tables.
for (const plugin of BUILTIN_PLUGINS) {
  assert.ok(
    rows.some((row) => row.id === plugin.manifest.id),
    `builtin ${plugin.manifest.id} missing from plugin rows`,
  );
}
assert.ok(rows.every((row) => row.source === "core" && row.state === "disabled"));

// A hypothetical new builtin with no enrichment entry still yields a full row.
const fake = { manifest: { id: "notible.brand-new-xyz", name: "Brand New", version: "9.9.9" } };
const withFake = buildPluginRows({
  builtins: [...BUILTIN_PLUGINS, fake],
  activeIds: ["notible.brand-new-xyz"],
  localEntries: [],
});
const fakeRow = withFake.find((row) => row.id === "notible.brand-new-xyz");
assert.ok(
  fakeRow && fakeRow.name === "Brand New" && fakeRow.state === "active" && fakeRow.source === "core",
  "a new builtin with no enrichment entry must still render a full row",
);
assert.equal(categoryOf("notible.brand-new-xyz"), "Other", "unknown plugin id must fall into the Other category");

// A local entry that shadows a builtin id is not duplicated.
const shadow = [{ plugin_id: BUILTIN_PLUGINS[0].manifest.id, version: "1.0.0", source: "package", state: "active", verified: false }];
const merged = buildPluginRows({ builtins: BUILTIN_PLUGINS, activeIds: [], localEntries: shadow });
assert.equal(
  merged.filter((row) => row.id === BUILTIN_PLUGINS[0].manifest.id).length,
  1,
  "a local entry sharing a builtin id must not create a second row",
);

// A genuine local-only entry becomes a row.
const outsider = [{ plugin_id: "example.outsider", version: "2.1.0", source: "package", state: "disabled", verified: false }];
const withOutsider = buildPluginRows({ builtins: BUILTIN_PLUGINS, activeIds: [], localEntries: outsider });
const outsiderRow = withOutsider.find((row) => row.id === "example.outsider");
assert.ok(
  outsiderRow && outsiderRow.source === "local" && outsiderRow.state === "disabled" && outsiderRow.verified === false,
  "a local-only registry entry must become a row",
);

console.log("plugin-rows checks passed");
