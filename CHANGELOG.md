# Changelog

## 0.77.5 - Legacy app removed

- Deleted the archived legacy application (the pre-plugin domain build). The
  shipped app is Core + builtin plugins; behaviour is unchanged.
- Sidebar search filters now use the themed Select / date picker controls.
- Internal: `npm test` is green again after clearing three long-masked
  quality-check failures.

> Note: this file was maintained through 0.26.x; releases 0.27–0.77 are
> recorded in `RELEASE_CHECKLIST_*.md` (internal, not published) and `docs/AKTUALIZACJE.md`.

## 0.26.2 - Cloud Connection Hotfix

- Allow HTTPS cloud connections through the Tauri CSP, fixing `Failed to fetch` during account restore and synchronization.

## 0.26.1 - Sync Reliability Patch

- Refresh the workspace immediately after manual or post-login synchronization.
- Serialize automatic and manual sync runs so concurrent SQLite writes do not race.
- Add a SQLite busy timeout and verify saved cloud sessions on read-back.
- Show account-restore errors instead of silently falling back to the sign-in form.

## 0.26.0 - Reliable Google Sync & Updates

- Moved Google authorization-code exchange to the Cloudflare Worker with PKCE and a server-side secret, fixing the desktop sign-in callback flow.
- Hid non-Google account registration while retaining email sign-in for existing accounts.
- Added automatic sync on app start, focus and a one-minute interval.
- Added explicit tombstones so hard-deleted records and their relations disappear on other installations without resurrecting older copies.
- Added a release guard that refuses to package a version that is not newer than the published updater manifest.

## 0.25.0 - Import, Account & Sync

- Connected the existing Import action to a guided Markdown and tabular import flow with preview, column mapping and optional parent placement.
- Added robust CSV parsing for quoted multiline fields and transactional imports so partial files do not leave incomplete records.
- Rebuilt Account & sync around a clear local-first connection flow with loading, success and error states.
- Added Google sign-in through the native desktop OAuth loopback + PKCE flow; Google tokens are exchanged and discarded without being stored in the app.
- Added account registration, login, logout and secure local session storage through the temporary Cloudflare Worker endpoint.
- Added additive cloud synchronization that merges records from both installations by UUID, keeps distinct notes and never deletes local data during pull.
- Added a D1-backed sync schema, cursor-based changes and manual synchronization controls in Settings.

## 0.24.0 - Activity Timeline & Focused Editing

- Added a dedicated Activity tab in the right rail with explicit chronological entries for notes, current steps, next steps and client responses.
- Added optional due dates to activity entries, including overdue state and a compact date picker.
- Added configurable Properties sections with show/hide and drag-free ordering controls persisted per object type.
- Preserved the selected right-rail tab between records and sessions so Activity stays easy to return to.
- Kept the floating editor toolbar on one line and added horizontal scrolling on narrow screens instead of wrapping controls.

## 0.23.0 - Faster AI Connections & Reliable Updates

- Enabled the desktop Check for updates action without a build-time flag and added visible provider errors.
- Moved CLI status checks off the UI path and added a two-second timeout so opening AI models stays responsive.
- Added optional direct OpenAI and Anthropic API connections without installing their CLIs.
- Stored direct API keys in Windows Credential Manager and kept AI mutations review-first.
- Fixed the font-family control in the floating editor toolbar and preserved the selected text range while using it.

## 0.22.0 - Contextual Editor & In-place Updates

- Added a wider, horizontally scrollable floating formatting menu with text
  color, highlights, font family and inline formatting controls.
- Added contextual Polish/English spellchecking by marking the dominant
  language of the document and individual editor blocks.
- Added comfortable bottom editor space for long notes and command menus.
- Activated signed Tauri updater artifacts with passive Windows installation
  through the Cloudflare R2 update channel.

## 0.20.0 - Subscription AI Harness

- Added local subscription-backed Claude and Codex agents using their official CLI authentication flows.
- Added one-click CLI installation, sign-in, status refresh, active-provider selection and MCP configuration in Settings.
- Made the bundled Notible MCP server the default provider integration and re-register it before every agent turn.
- Added a comprehensive guarded harness covering discovery, retrieval, summaries, planning, updates, creation, privacy, conflicts and structured proposals.
- Connected the compact Notible AI window to the same active model, instructions and local MCP context as AI Work Desk.
- Kept all mutations review-first with propose-only model tools, explicit approval and optimistic locking.
- Fixed Windows CLI discovery, hidden background model processes, localized Home dates and active-navigation geometry.

## 0.19.0 - Clearer Everyday Workflows

- Redesigned Properties into adaptive, type-aware sections with a clearer information hierarchy.
- Rebuilt Version History around readable change summaries, version selection, current-state detection and confirmed, undoable restores.
- Added safe removal directly from an open record, with recovery through Trash.
- Localized calendar labels and week layout consistently for Polish and English.
- Fixed Kanban creation in filtered views and dragging records into empty columns while preserving workflow status.

## 0.18.1 - Installed Shortcut Icon Repair

- Changed the installed main binary name to `NotibleApp.exe` so Windows creates
  a fresh icon-cache entry instead of retaining the former Tauri icon associated
  with `notible.exe`.
- Kept the visible product and shortcut name as `Notible`.
- Rebuilt portable, NSIS and MSI artifacts from the canonical Notch icon.

## 0.18.0 - Notch Identity & System Tray

- Replaced the default Tauri artwork with the original Notible Notch identity.
- Added canonical SVG mark, monochrome mark, lockup and documented brand tokens.
- Generated every desktop, installer and platform icon from one SVG source.
- Applied the Ink, Paper, Iris and Mist palette across the application shell.
- Added branded sidebar, active-navigation notch and home identity treatment.
- Added a Windows system tray icon with show and quit actions.
- Closing the main window now hides Notible to the tray instead of ending work.
- Left-clicking the tray icon restores and focuses the main window.

## 0.17.2 - Google Calendar & Sidebar Groups

- Completed Google Calendar desktop OAuth with PKCE, loopback redirects, optional client credentials and secure token storage.
- Added readable provider errors for token exchange, calendar discovery and event synchronization.
- Added virtual project groups for tasks, issues, notes, whiteboards, planning and reports with counts and remembered expansion.
- Moved people out of Unfiled into a dedicated collapsible directory.
- Aligned sidebar counts, chevrons and resource rows to a shared grid.

## 0.16.0 - Calendar OAuth & Sidebar Repair

- Fixed the project calendar section expanding and breaking the right properties rail.
- Added Google and Microsoft desktop OAuth Authorization Code with PKCE and loopback sign-in.
- Added secure token storage in Windows Credential Manager, refresh and disconnect.
- Added read-only source discovery and manual synchronization of selected project calendars.
- Added compact Connect, Disconnect, Sync, visibility, loading and error states.

## 0.15.0 - Project Calendar Views

- Added month, week and day calendar modes with all-day and hourly event layouts.
- Added a project Calendar tab combining dated tasks, issues and cached external meetings.
- Added project-level Google Calendar and Outlook Calendar read-only connection metadata and source visibility.
- Added safe event normalization, filtering and optional task/issue assignment without storing OAuth tokens in project properties.
- Added an explicit configuration-required state instead of simulating cloud synchronization without credentials.

## 0.14.0 - Code Blocks & Comparisons

- Added language-aware code blocks with automatic detection after paste and a manual language selector.
- Added a dedicated side-by-side code comparison block for previous and new versions.
- Added deterministic line diffing with additions, removals, modifications, line numbers and a large-input safety mode.
- Preserved code languages and both comparison sides in Markdown export.
- Added automated checks for language detection and code diff behavior.

## 0.13.0 - Project Automations & Tag Suggestions

- Added project-scoped recurring and relation-change automation triggers with configurable weekend handling.
- Added manual execution, validation, safe deactivation after errors and detailed AND/OR audit reasons.
- Added a guided editor with schedule controls and a filterable execution log.
- Added up to three local project tag suggestions based on content and existing usage.
- Kept tag suggestions review-first: tags are saved only after explicit confirmation.

## 0.12.0 - Gantt Dependencies

- Added finish-to-start, start-to-start, finish-to-finish and blocking dependencies.
- Added accessible dependency creation, visible connectors and direct removal on the project Timeline.
- Added backend validation that prevents self-dependencies and dependency cycles while preserving legacy relations.
- Added automatic downstream date propagation for tasks, issues, cycles and milestones after drag or resize.
- Added an independently tested scheduling engine with chain propagation and milestone-point semantics.

## 0.11.0 - Project Workflows & Safe MCP Editing

- Added a local people directory with reusable assignee suggestions and a forward-compatible profile model.
- Added project-specific workflow statuses with ordering and preservation of legacy task and issue values.
- Added project, selected-project and workspace-global scopes for milestones, cycles and releases.
- Reorganized cycles into current, upcoming and completed groups with dates, progress and accessible labels.
- Fixed clipped date pickers and added viewport-aware positioning plus tooltips for truncated values.
- Expanded MCP with review-before-apply edits, conflict checks, record creation and undoable history.
- Added release tooling for signed Tauri updater artifacts that update an existing installation in place.

## 0.10.2 - Page History Navigation

- Added a persistent Back button to every workspace page, including Home,
  Triage, Reminders, notes, containers, projects and dashboards.
- Made Back follow the real order of visited pages instead of sidebar or tab
  order, while keeping reopened objects in the tab bar.
- Added `Alt+Left` keyboard navigation, accessible labels, Polish translations
  and a tooltip naming the previous page.

## 0.10.1 - Project Workspace Redesign

- Rebalanced project screens around neutral working surfaces and distinct
  record cards, following the visual hierarchy of the Reminders screen.
- Added a Kanban control for hiding empty columns and made empty columns hidden
  by default.
- Reorganized data-source, view and file actions into two readable toolbar
  groups for Tasks and Issues.
- Made data tables fill their container and removed the abrupt empty surface at
  the right edge.
- Expanded Planning, Timeline, Finance and Updates to the available width.
- Added timeline drag and resize editing that persists changed dates back to
  source records, plus readable labels for very short tasks.
- Added a weekly person-hours schedule to Finance, including editable capacity
  allocation across weeks.
- Added an option to show the three latest project updates directly in the
  Overview screen.

## 0.10.0 - Relations, Formulas & Semantic Model

- Expanded relations with one/many cardinality, target-type constraints and a
  label for the reverse side.
- Added lookup fields that read values from related records without copying
  source data.
- Expanded rollups with count, sum, average, minimum, maximum, earliest/latest
  date and percentage matching a condition.
- Added formula field suggestions, readable non-blocking errors and live or
  persisted calculation modes.
- Added named aggregate measures and a compact dependency inspector in the
  table data-model panel.
- Made embedded Kanban boards consume the available width up to the properties
  rail, with flexible columns and contained horizontal scrolling in small
  windows.
- Added Polish UI coverage and automated semantic-model regression checks.

## 0.9.0 - Workflows, Templates & Automation

- Added versioned work packs for Support Desk, Development, Project Delivery
  and Personal & Operations, built on the same object and data-source model.
- Added safe pack installation with an automatic database backup, non-
  destructive schema merging, optional example records and repeatable updates.
- Added managed views and domain types for tickets, customers, knowledge
  articles, bugs, decisions, risks, procedures and operational requests.
- Rebuilt automations around record-created, property-changed, date-reached and
  manual triggers, with shared query-builder conditions and multiple actions.
- Added dry-run testing on a real example record, a readable execution log,
  once-per-day date guards, action limits and loop-resistant execution.
- Preserved legacy automation rules through automatic in-memory migration to
  the version 2 rule model.
- Added Polish and English workflow UI plus responsive light/dark surfaces.
- Added a browser-safe frontend mode for repeatable visual documentation and
  regression checks without changing desktop behavior.

## 0.8.0 - Data Foundation

- Added durable, reusable data sources scoped to a project, folder, object
  type or the complete workspace.
- Added a natural-language query builder with nested AND/OR groups, text and
  numeric comparisons, empty-value checks and relative date filters.
- Made saved sources reusable by table, Kanban, list and calendar views, with
  visible record counts and missing-field warnings.
- Extended named views with duplication, persistent column order, visibility,
  widths, pinned columns, multi-column sorting and collapsible grouping.
- Added multi-row selection with bulk status, priority, tag and archive
  operations.
- Added numeric table summaries for count, sum, average, minimum and maximum.
- Added CSV, TSV, XLSX, XLS, XLSB and ODS import with preview, record-type
  selection and explicit per-column mapping before data is written.
- Added migration and integration coverage for data-source persistence and
  mapped imports.

## 0.7.1 - Stabilization

- Unified dark-theme document and workspace surfaces and removed the visible
  background band below shorter pages.
- Made embedded data sources explicit, selectable and useful for projects;
  new table, board, list and calendar blocks use the current project by
  default instead of an invisible empty folder.
- Added recovery actions for existing empty embedded views.
- Completed another Polish UI pass across properties, history, tables,
  dashboards, file browsing, settings, tooltips and empty states.
- Added a quality gate that rejects untranslated literal tooltip, placeholder
  and accessibility attributes.
- Corrected application version reporting and aligned release metadata.
- Added the official Tauri updater foundation, update settings UI, signed
  manifest tooling and release documentation. The public update channel stays
  disabled until its permanent HTTPS feed and signing key are configured.

## 0.7.0 - Project Finance

- Added project budgets with base currency, planned and approved limits, opening cash, and configurable alerts.
- Added cost and income ledgers with categories, vendors, recurrence, status, and attachment references.
- Added time entries, billable and cost rates, margin, burn rate, runway, variance, and forecast-at-completion calculations.
- Added a quiet project-finance workspace with recurring 12-month forecasts and budget health signals.
- Added native CSV, TSV, XLSX, XLS, XLSB, and ODS finance import plus CSV and real XLSX export.
- Added local audit events for finance changes and an opt-in MCP privacy boundary for sensitive records.

## 0.6.0 - Power Platform

- Added formula, rollup, relation, people, duration, progress, unique-ID, and action-button table fields.
- Added container-level rules that apply property actions when configured values change.
- Added reusable intake form views that submit tasks and issues directly to Triage.
- Added CSV and TSV import for project-management exports while preserving source columns.
- Added a durable, cursor-based integration event stream for local webhook consumers.
- Extended the read-only MCP server with `list_changes` and documented the stable local integration contract.

## 0.5.0 - Knowledge Layer

- Added a quieter, more consistent application visual system and improved active navigation states.
- Added shared object presentation across tabs, breadcrumbs, navigation, and page chrome.
- Rebuilt the project timeline with a visible date axis, useful ranges, navigation controls, milestone markers, status legend, and an explicit unscheduled section.
- Improved responsive readability for project planning at wide and narrow window sizes.
- Extended Polish and English planning labels and accessibility descriptions.

## 0.4.0 - Project Planning

- Fixed the infinite loading/flicker loop in Triage and Reminders.
- Added first-class milestones and migration of legacy project milestones.
- Added cycles with dates, capacity, velocity, and automatic unfinished-work rollover.
- Added releases with linked work and Markdown changelog export.
- Added task and issue links to milestones, cycles, and releases.
- Added project timeline with date ranges and blocked-work indicators.
- Added project health: on track, at risk, and off track.
- Added structured project updates with cadence warnings and historical scope changes.
- Added estimate versus actual-effort reporting.

## 0.3.0 - Workflow Core

- Added global Triage for reviewing new tasks and issues.
- Added semantic work relations, blockers, parent tasks, subtasks, and duplicates.
- Added blocker warnings and subtask completion progress.
- Added persisted named views with layouts, filters, sorting, and table columns.
- Added built-in templates for tasks, bugs, projects, meetings, and decisions.
- Added reminders, overdue work, snoozing, and recurring tasks.
- Added meaningful project activity based on property and content changes.
- Reworked slash-command execution and removed duplicate mouse execution.
- Added automated command/i18n quality checks and an interactive editor harness.
- Extended Polish translations for the complete 0.3 workflow.
