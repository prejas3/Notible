# Notible — Notch identity system

## Idea

**Make space for what matters.** The container represents the local workspace,
the stepped notch creates room for the current context, and the Iris point marks
the single source of truth. The two offset lobes create a quiet `N` rhythm.

## Canonical assets

- `public/brand/notible-icon.svg` — canonical application icon and the only
  source used to generate Tauri raster and installer assets.
- `public/brand/notible-mark.svg` — mark for dark product surfaces.
- `public/brand/notible-mark-mono.svg` — one-colour reproduction.
- `public/brand/notible-lockup.svg` — horizontal presentation lockup.

Do not redraw the mark, move the point, change the notch proportions, add a
gradient, or substitute a different purple. Preserve at least 12.5% of the
mark width as clear space. Use the complete application icon below 32 px.

## Palette

| Token | Value | Role |
| --- | --- | --- |
| Ink | `#090B0D` | application frame, dark icon field |
| Paper | `#F3F0E8` | primary light mark and warm light surface |
| Iris | `#7557E8` | focus, active context, primary action |
| Mist | `#A7ADB8` | supporting text and neutral states |

CSS uses `--brand-ink`, `--brand-paper`, `--brand-iris` and `--brand-mist`.
User-selected accents remain available, but Iris is the default and the
permanent colour of the logo.

## Interface language

Use the notch sparingly for brand-bearing surfaces: active navigation, empty
states, onboarding, installer art and release communication. Normal controls
remain conventional and accessible. The Iris point may indicate one active
context; it must not become decorative confetti.
