# Notible product roadmap

This is the persistent implementation plan following `0.2.0`. Items are
ordered by dependency. A release is complete only after migration, Polish and
English UI, automated tests, and a local installer smoke test have passed.

## Product direction

Notible combines disciplined project execution with a local-first knowledge
base: Linear-quality task flow, Notion-like views, and Obsidian-like ownership
and linking of local knowledge.

## 0.3 - Workflow Core

- [x] Triage inbox for unreviewed tasks and issues
- [x] Semantic relations: blocks, blocked by, parent, subtask, related, duplicate
- [x] Subtask progress and blocker warnings
- [x] Saved views with filters, sorting, grouping, columns, and layout
- [x] Reusable templates for projects, tasks, issues, meetings, and notes
- [x] Reminders, overdue state, and recurring tasks
- [x] Meaningful activity events instead of generic "updated" rows
- [x] End-to-end editor command tests and an untranslated-string check

## 0.4 - Project Planning

- [x] First-class milestones linked to tasks and issues
- [x] Cycles/sprints with rollover, capacity, and completion statistics
- [x] Timeline and roadmap views with dependencies
- [x] Project health: on track, at risk, off track
- [x] Periodic project updates and change summaries
- [x] Estimates, actual effort, velocity, and scope-change reporting
- [x] Releases and changelog generation

## 0.5 - Knowledge Layer

- [ ] Readability and information-architecture pass across the entire app
- [x] Rebuild project timeline readability: visible date axis, useful scale,
      zoom/range controls, legible milestone markers, status legend, and
      sensible handling of items without explicit dates
- [x] Remove duplicated task/issue property surfaces and keep one canonical,
      responsive property editor
- [ ] Group work properties into Workflow, Planning, Ownership, Dates, and
      Effort; hide empty secondary fields behind progressive disclosure
- [x] Replace technical labels such as `Cycle Id`, `Milestone Id`, and
      `Release Id` with human-readable linked-object selectors
- [ ] Improve small-text contrast, minimum font sizes, spacing, field widths,
      truncation, and wrapping at wide and narrow window sizes
- [ ] Complete Polish translations for all 0.4 planning labels and verify both
      language variants visually
- [ ] Add screenshot-based readability checks for project, timeline, task,
      issue, Triage, and Reminders screens before release
- [ ] Backlinks with context and unlinked mentions
- [ ] Useful local/global graph with filters and orphan detection
- [ ] Daily notes and global quick capture into Inbox
- [ ] Saved searches and advanced full-text query operators
- [ ] Portable workspace export preserving relations and metadata
- [ ] Optional local semantic search and summaries

## 0.6 - Power Platform

- [x] Formula, rollup, relation, people, duration, progress, and unique-ID fields
- [x] Rule automations and one-click action buttons
- [x] Intake forms connected to Triage
- [x] Stable local API/MCP contract, webhooks, and integration documentation
- [x] Importers for common Markdown and project-management formats

## 0.7 - Project Finance

Finance follows the planning model so costs can reference real projects,
milestones, people, time, and releases.

- [x] Project budget with base currency and planned/approved/actual amounts
- [x] Cost and income items, categories, vendors, and attachments
- [x] Recurring costs and forecast cash flow
- [x] Billable rates, time entries, and cost derived from actual effort
- [x] Budget alerts and variance by project, milestone, and category
- [x] Financial dashboard: burn rate, runway, margin, forecast at completion
- [x] CSV/XLSX import/export and audit-friendly history
- [x] Permission boundary for sensitive financial properties

## After 0.7.0 - next work session

- [ ] Improve theme consistency in the remaining views and states, including
  contrast, control surfaces, hover/focus states, and light/dark variants.
- [ ] Execute the focused Test Host repair plan in
      `PLAN_POPRAWEK_TEST_HOST_2026-08-08.md` (internal, not published).
- [ ] Execute the critical plugin and Test Host audit in
      `PLAN_AUDYTU_PLUGINOW_I_TEST_HOST_2026-08-09.md` (internal, not published).
- [ ] Continue functional development of Notible, prioritizing coherent
      workflows over adding isolated features.
- [ ] Recheck user documentation screenshots after the next visual pass.

## 0.7.1 - Stabilization

- [x] Unify document/workspace surfaces in dark themes.
- [x] Make embedded view sources explicit and repair the empty-project flow.
- [x] Extend Polish translations and enforce translated UI attributes.
- [x] Read application version from release metadata.
- [x] Add updater plugin foundation, update UI and signed-manifest tooling.
- [ ] Configure the permanent HTTPS update feed and release signing key.
- [x] Complete visual smoke tests and publish EXE/MSI artifacts.

## 0.8–1.0 - Unified Work Platform

The detailed, dependency-ordered plan is maintained in
`PLAN_ROZWOJU_0.8-1.0.md` (internal, not published).

- **0.7.1 — Stabilization:** themes, i18n, source semantics, one schema per
  type, migration and recovery gates.
- **0.8.0 — Data Foundation:** reusable data sources, query builder, powerful
  tables and saved views.
- **0.9.0 — Workflows:** versioned structure templates, Support/Development/
  Project/Operations packs and automation engine 2.0.
- **0.10.0 — Semantic Model:** relations, lookups, formulas, rollups and named
  measures across domains.
- **0.11.0 — Analytics:** pivot views, drill-down reporting and cross-domain
  dashboards.
- **0.12.0 — Safety & Scale:** undoable bulk history, verified restore,
  recovery mode and large-workspace performance.
- **1.0.0 — Unified Work Platform:** goal-based onboarding, stable migrations,
  complete documentation, accessibility and installer/update guarantees.

## 0.8.0 - Data Foundation

- [x] Durable reusable sources for containers, types and the workspace.
- [x] Nested AND/OR query builder with natural-language summaries.
- [x] Saved sources shared by table, Kanban, list and calendar views.
- [x] Named-view duplication and persistent table layout.
- [x] Multi-column sorting, grouping, pinning, resizing and visibility.
- [x] Bulk status, priority, tag and archive operations.
- [x] Count, sum, average, minimum and maximum table summaries.
- [x] Previewed and mapped CSV/spreadsheet import.
- [ ] Clipboard ranges and conditional formatting move to a focused table
      follow-up after real-world feedback, without blocking the data model.

## 0.9.0 - Workflows, Templates & Automation

- [x] Versioned, safely re-applicable structure templates.
- [x] Support Desk, Development, Project Delivery and Personal & Operations
      packs on one shared data model.
- [x] Pack preflight backup, non-destructive schema merge and optional examples.
- [x] Managed types, saved views and automation rules with update metadata.
- [x] Record-created, property-changed, date-reached and manual rule triggers.
- [x] Shared query-builder conditions and multi-action rules.
- [x] Set-property, create-record, relation, move, reminder and history actions.
- [x] Rule test against an example record and readable execution history.
- [x] Loop-resistant execution, daily date guards and action limits.
- [x] Polish/English workflow UI, automated checks and installer artifacts.

## 0.10.0 - Relations, Formulas & Semantic Model

- [x] Relation cardinality, reverse labels and optional target-record types.
- [x] Lookup fields based on related records.
- [x] Count, sum, average, minimum, maximum, date and conditional rollups.
- [x] Formula suggestions, non-blocking errors and live/persisted results.
- [x] Reusable named measures and a readable dependency inspector.
- [x] Responsive embedded Kanban width up to the properties rail.
- [x] Polish/English semantic-model UI and automated regression coverage.

## Engineering gates for every release

- [ ] Przed publicznym wydaniem: przenieść wymianę kodu Google OAuth do HTTPS token brokera.
- [ ] Usunąć `NOTIBLE_GOOGLE_CLIENT_SECRET` z buildów desktopowych i obrócić tymczasowy klucz.

- Schema migrations preserve existing objects and custom fields.
- Every new label is available in Polish and English.
- Keyboard and mouse paths have equivalent behavior.
- Critical workflows have automated tests and a manual smoke-test checklist.
- Backup restoration is tested before installer publication.
- Performance is checked with a workspace containing at least 10,000 objects.
