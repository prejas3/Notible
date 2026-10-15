# Builtin plugin set

This directory is the product bundle, not the Core runtime. Each domain has a
separate manifest and entrypoint. Product modules implement domain operations
through the public plugin contract; package entrypoints repeat that contract
without importing the application or Core internals.

Current plugin boundaries:

- `notible.work-models` — tasks, issues and projects;
- `notible.views` — list, table, kanban, calendar, canvas and dashboard;
- `notible.planning` — milestones, cycles, releases and Gantt;
- `notible.automations` — rules and triggers;
- `notible.finance` — budgets, finance and time entries;
- `notible.calendar` — external calendar integrations;
- `notible.ai` — AI work desk and providers;
- `notible.editor-extensions` — code/diff/editor extensions;
- `notible.whiteboard` — visual workspace;
- `notible.search` — search, backlinks and graph surfaces;
- `notible.import-export` — optional importers and exporters;
- `notible.themes` — optional appearance extensions.

Every TypeScript plugin module is free of `src/components`, `src/lib`, Tauri
and SQLite imports. Product-only settings surfaces may use React through the
Core-owned opaque renderer host; package entrypoints remain dependency-free.
A plugin is not considered fully migrated until its legacy path has a
behavior-equivalence test and can be disabled without data loss. Current
contract tests cover every plugin separately and together. Work Packs was
removed in 0.78.7 — its role is now filled by container modules
(`props._modules` + `ContainerModulePicker`).
