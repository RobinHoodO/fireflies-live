# Fireflies Live — v2

The redesigned interface (Phase 1, rebuilt from scratch against the design handoff in
`docs/design/`) **wired to the real backend** (Phase 2). The design is unchanged; the
mock content was removed and replaced with live data.

- **Fireflies** active-meeting detection + live transcription socket (`backend.ts`),
  with a scripted demo fallback when no API key / meeting is set.
- **OpenRouter** for live suggestions, the question-mode "Say this" answer, the chat
  assistant, and "Suggest agent mode from meeting".
- **Localhost command bridge** (`../server/bridge.mjs`) for the Terminal tab.
- Keys are injected by the dev server from `/Users/robinsverd/Thrivbe-AI/.env`
  (`FIREFLY_API_KEY`, `OPENROUTER_API`) via `/api/fireflies-key` — never in client code.

## Run it
```bash
npx vite --config v2/vite.config.ts        # dev  → http://localhost:5173 (boots the bridge too)
npx vite build --config v2/vite.config.ts  # build
```

## Files
- `App.tsx` — the whole interface (header, transcript, tabbed sidebar, chat view, config slide-over).
- `backend.ts` — Fireflies meetings/socket, OpenRouter calls, suggestions, live answers, mode proposal.
- `data.ts` — static design config + ported style helpers (no mock content).
- `md.ts` — Markdown→HTML for agent bubbles (ported from the source).
- `icons.tsx` — the lucide icon sprite.
- `styles.css` — fonts, keyframes, scrollbar, hover/focus affordances.
- `vite.config.ts` — standalone config: key injection + bridge boot + `/bridge` proxy.

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
