# Fireflies Live

Live meeting copilot — the "during-meeting" layer of the sales OS (research
before → live copilot → meeting-analyser after). Status source of truth:
`docs/ROADMAP.md`.

## Active app

`v2/` is the app (Vite + React 19, one main component `v2/App.tsx`, backend
wiring in `v2/backend.ts`). The legacy v1 `src/` tree was deleted 2026-07-15
(plan 008) — if you see references to it in docs, they're historical.

## Hosted on Thrivbe-1 (since 2026-07-30)

Production runs on Thrivbe-1: `fireflies-live.service` → `server/serve.mjs`
(static `v2/dist` + key injection + `/bridge` proxy) on tailnet
`100.114.219.63:3017` (ufw tailnet-only). The Chrome extension opens that URL.
Deploy: push to GitHub, then on the server
`cd /opt/Thrivbe-AI/lab/fireflies-live && git pull && npm ci && npm run build && sudo systemctl restart fireflies-live`.
Failure pings Telegram via `OnFailure=os-ping-fail@%n`. **The only real
network boundary is ufw** (tailnet-only) — the Host/Sec-Fetch gates in
serve.mjs only stop browser-mediated attacks; after any firewall change,
re-check `sudo ufw status` still denies public access to 3017. Meeting records
(`/file`) land in `/opt/Thrivbe-AI/content/meetings/transcripts/` on the server.
Session content persists in localStorage (`v2/session.ts`) — reloads restore
the meeting and auto-reconnect within 10min.

## Run / build / verify

- `npm run dev` — local dev server on :5173 (strict port; shared with
  worldmonitor, one at a time). Boots the bridge (`server/bridge.mjs`) as a
  child.
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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **fireflies-live** (1225 symbols, 2407 relationships, 105 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/fireflies-live/context` | Codebase overview, check index freshness |
| `gitnexus://repo/fireflies-live/clusters` | All functional areas |
| `gitnexus://repo/fireflies-live/processes` | All execution flows |
| `gitnexus://repo/fireflies-live/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
