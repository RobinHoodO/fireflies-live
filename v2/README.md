# Fireflies Live — v2 (interface)

Phase 1 deliverable: the redesigned interface, **rebuilt from scratch** against the
design handoff in `docs/design/` (preview + `.dc.html` source + screenshots). This is a
**clean, self-contained interface** — **no backend wiring**.

- **No** Fireflies socket, **no** OpenRouter, **no** localhost bridge.
- All data is mock (`data.ts`) and every action is local UI state.
- Faithful to the design's exact tokens, type, spacing, and components
  (azure accent, Manrope / Space Grotesk / JetBrains Mono, 18px cards, 28px frame inset).

## Run it
```bash
npx vite --config v2/vite.config.ts        # dev  → http://localhost:5273
npx vite build --config v2/vite.config.ts  # build
```

## Files
- `App.tsx` — the whole interface (header, transcript, tabbed sidebar, chat view, config slide-over).
- `data.ts` — mock data + ported style helpers.
- `md.ts` — Markdown→HTML for agent bubbles (ported from the source).
- `icons.tsx` — the lucide icon sprite.
- `styles.css` — fonts, keyframes, scrollbar, hover/focus affordances.

## What's faithful to the handoff
- Card-based shell, 1660px frame, 28px page inset, header card.
- View modes: Transcript / Split (drag divider, clamp 0.34–0.74) / Chat (820px column).
- **Tabbed** sidebar (Live feed · Chat · Terminal) — the chosen direction.
- Config summary row → right-side **slide-over** (agent mode, model picker, feature switches).
- Question-mode "Say this" banner, empty / connecting / connected states.
- Suggestion feed (filters + counts + show-more), chat bubbles + thinking dots,
  terminal with confirm bar + route-through-PI.

## Phase 2 (next, separate)
Connect the existing backend wiring (`src/`) to this interface: replace the mock data and
local handlers in `App.tsx`/`data.ts` with the real Fireflies socket, OpenRouter calls, and
the bridge — then retire the old `src/` interface.
