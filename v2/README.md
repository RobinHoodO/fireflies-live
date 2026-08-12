# Fireflies Live client

The active React interface. `AuthBoundary.tsx` establishes the Robin-only HttpOnly session before `App.tsx` mounts; `backend.ts` talks only to same-origin `/api/*` routes. No provider credential or broad bridge token enters browser state.

`App.tsx` owns the live meeting experience and durable checkpoint schedule. Meeting setup explicitly records the host speaker label, meeting type, goal, and optional context. The neutral meeting type is the default. The calm surface is intentionally allowed to remain silent and shows at most one cue Robin wrote or promoted.

Feature switches correspond to implemented behavior:

- auto-suggest, dynamic agenda, sentiment, conversation map, and speaker labels;
- AI command suggestions, off by default, which only stage reviewed commands;
- calm cue, which never promotes an unreviewed AI/navigation instruction by itself.

Key files:

- `AuthBoundary.tsx` — session status and login screen.
- `App.tsx` — live transcript, meeting setup, feed, chat, command review, checkpointing, and recovery UI.
- `backend.ts` — bounded same-origin client calls and stream cancellation.
- `feed.ts`, `graph.ts`, `session.ts` — tested pure behavior.
- `vite.config.ts` — local API/bridge wiring; production uses `server/serve.mjs`.

Run from the repository root with `npm run dev`; validate with `npm run verify`.
