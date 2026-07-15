# Fireflies Live

Live meeting copilot — the "during-meeting" layer of the sales OS (research
before → live copilot → meeting-analyser after). Status source of truth:
`docs/ROADMAP.md`.

## Active app

`v2/` is the app (Vite + React 19, one main component `v2/App.tsx`, backend
wiring in `v2/backend.ts`). The legacy v1 `src/` tree was deleted 2026-07-15
(plan 008) — if you see references to it in docs, they're historical.

## Run / build / verify

- `npm run dev` — dev server on :5173 (strict port; shared with worldmonitor,
  one at a time). Boots the bridge (`server/bridge.mjs`) as a child.
- `npm run verify` — **the gate; run before considering any change done.**
  Chains lint (`oxlint v2 server`) + `node --test` + build (which typechecks
  v2 via `tsc -p tsconfig.v2.json`).
- `npm test` — `node --test` alone (bridge guards + v2 pure-helper tests; `.ts`
  tests run natively on Node 22).

## Bridge security invariants (never regress)

`server/bridge.mjs` is a localhost command bridge with provider keys — treat
every change as security-sensitive. Invariants, frozen as tests in
`server/bridge.test.mjs` (run them after any bridge edit):

- Binds 127.0.0.1 only; Host header allowlisted (anti DNS-rebinding);
  OPTIONS→403; no CORS headers on purpose.
- Every protected endpoint requires the per-session bearer token (injected by
  the Vite plugin, `randomUUID` per boot).
- `/run` and `/pi` refuse denylisted commands — but "denylist is a fat-finger
  guard, not a sandbox — operator has full shell on their own box by design"
  (see the ponytail note at the end of bridge.mjs).
- File reads are rooted under `content/` / `clients/`; `/file` writes only
  into the fixed transcripts dir with a sanitized slug.
- Transcript-derived `command` suggestions must always confirm in the UI
  before reaching `/pi` (v2/App.tsx `pendingCmd`).

## Env

Keys live in `/Users/robinsverd/Thrivbe-AI/.env`: `FIREFLY_API_KEY` (the
Fireflies token, despite the name) and `OPENROUTER_API`. The dev middleware
(`/api/fireflies-key`) injects them; never hardcode or paste values.

## Conventions

- Inline-style objects everywhere in v2 — design-port convention, not a
  mistake. Match it.
- Development is largely delegated; verify-before-commit workflow and history
  in `docs/codex-delegation-log.md`. Improvement plans live in `plans/`.
