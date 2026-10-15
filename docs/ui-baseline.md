# UI baseline — mandatory values

The rules every Core and plugin-surface screen follows so the UI stays one
system instead of drifting screen by screen. Introduced with Feedback
27.08.26 #1 (spec: `2026-08-27-ui-baseline-controls-design.md` (dokument wewnętrzny, nieopublikowany)).

## Tokens

Paint only with the public `--notible-*` theme vocabulary. Theme plugins and
user themes set these at runtime; `scripts/theme-contract-check.mjs` enforces
that `--notible-*` is public and `--core-*` is a private `var(--notible-*)`
alias. `scripts/plugin-css-token-check.mjs` fails any plugin CSS that paints a
surface with a colour literal.

| Token | Use |
|-------|-----|
| `--notible-background` | app canvas behind everything |
| `--notible-surface` | cards, popovers, raised panels |
| `--notible-raised` | a surface on top of a surface |
| `--notible-hover` | row / option hover wash |
| `--notible-active` | pressed / current |
| `--notible-selected` / `--notible-selected-soft` | selected row, selected-not-focused |
| `--notible-border` | field underline, card edge, dividers |
| `--notible-border-subtle` | section dividers, faint rules |
| `--notible-text` | primary text |
| `--notible-muted` | labels, hints, placeholders |
| `--notible-faint` | disabled text, out-of-range |
| `--notible-accent` / `--notible-accent-hover` | focus line, selected day, primary button |
| `--notible-on-accent` | text on an accent fill |
| `--notible-danger` / `--notible-danger-surface` | destructive |
| `--notible-success` / `--notible-warning` | status |

`box-shadow` may use translucent black (`rgba(0,0,0,.14)`) — theme-neutral by
construction, and the one literal the token check allows.

## Form controls

`<Select>`, `<Combobox>`, `<DatePicker>`, `<FieldRow>` live in
`src/core/ui/`. They are the **only** sanctioned way to render a dropdown, a
searchable reference picker, or a date field. `scripts/ui-baseline-check.mjs`
(wired into `test:quality`) fails the build on a raw `<select>`,
`<input type="date">`, or `<datalist>` anywhere under `plugins/builtin/**` or
`src/core/**` except `src/core/ui/` itself. `src/components/**` is the dead
legacy tree — printed in the check's ledger, not migrated.

- **`<Select>`** — button + portalled listbox. Full keyboard model
  (Up/Down/Home/End/typeahead/Enter/Esc), `role="combobox"`/`listbox`/`option`,
  focus returns to the trigger on close. `label`/`placeholder` render as text
  nodes — no markup form, now or later. Option list caps at 500.
  `onChange(value: string)` — never an event.
- **`<Combobox>`** — `<Select>` plus a filter input; `onFreeText` for a typed
  value that matches no option. Replaces `<input list>` + `<datalist>`.
- **`<DatePicker>`** — typeable field (`dd.mm.rrrr` for `pl`, ISO elsewhere)
  + month-grid popover, week starts Monday, `Wyczyść` / `Dzisiaj`. Emits ISO
  `yyyy-mm-dd` (or `+THH:mm` with `time`) — never a `Date`. `range` and
  `time` are opt-in props, default off.
- Popover positioning: `src/core/ui/anchorPopover.ts` — measures the trigger,
  places below with a flip above on overflow, clamps to the viewport,
  repositions on scroll/resize. The overlay layer sits **below** the modal
  layer (`--nb-popover-z: 60`).

### Field style

The flat "Properties panel" look: no box, no fill — a `1px solid
var(--notible-border)` underline, fixed `34px` height, `border-bottom-color:
var(--notible-accent)` on focus. `surface.css` / `core-only.css` own the
outer box for native `input`/`textarea`; the control components self-style
their `.nb-control-trigger` to match. Never a second copy of these values.

### Plugin API

Third-party plugin surfaces (raw `HTMLElement`, no React) use
`context.ui.mountSelect(el, options)` / `context.ui.mountDatePicker(el,
options)` — API 1.11. First-party builtin surfaces import the components
directly from `src/core/ui` (the per-plugin isolation checks whitelist that
path).

## Section layout

- Divider between sections: `1px solid var(--notible-border-subtle)` — the
  split must read graphically, not only as whitespace.
- Section title: `font: 650 13px/1.3`, `var(--notible-text)`, uppercase
  eyebrow tracking. Bigger than the old 11px muted label.
- A multi-category list (e.g. planning items) is a column board
  (`grid-template-columns: repeat(3, 1fr)`, collapsing to one under 720px),
  not one flat list.

## Row and card actions

Per-row / per-card actions go in a **right-click context menu**, never an
inline row of icon buttons (standing convention). Use the in-plugin menu
pattern (`project-dashboard-ui.tsx` `setPlanningMenu` / the Kanban card menu
in `views-ui.tsx`), backdrop-dismissed. Core's own sidebar menu is private to
Core — plugins cannot reach it.
