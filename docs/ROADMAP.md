# Fireflies Live — Roadmap

A real-time meeting copilot: live Fireflies transcription + an AI assistant that
suggests questions, drafts responses, runs quick actions, and (planned) delegates
work to a backend. Light, spacious, futuristic UI.

Status legend: ✅ done · 🟡 in progress · ⬜ planned

---

## Phase 0 — Core realtime (✅ shipped)

- ✅ Fireflies Realtime API over Socket.IO (`wss://api.fireflies.ai`, `/ws/realtime`).
- ✅ **Bug fix:** transcription payload is nested under `data.payload`; `chunk_id`
  is a stable, server-revised segment id → upsert by it (don't append per event).
- ✅ Speaker grouping — consecutive same-speaker segments merge into one paragraph;
  new line only on speaker change.
- ✅ `active_meetings` GraphQL query → auto-fetch on load; per-session Connect.
- ✅ Demo mode fallback.

## Phase 1 — AI assistant (✅ shipped)

- ✅ OpenRouter backend with model picker (DeepSeek, GPT-4o/mini, Claude 3.5 Sonnet,
  Gemini 1.5 Flash, Llama 3.1 70B).
- ✅ Real, transcript-driven suggestions (replaces canned random) on a throttled pulse.
- ✅ Configurable pulse rate (8s / 12s / 20s / 30s / off).
- ✅ Suggestion **history feed** — newest on top, deduped, capped.
- ✅ **Question mode** — live-drafts what the host should say in reply to the latest turn.
- ✅ Agent-context **modes** — preset chips + custom textarea + "propose modes from
  this meeting" (AI reads the transcript and proposes tailored modes).
- ✅ Quick-action command palette.
- ✅ Rich markdown rendering for all AI output (fixes raw `**stars**`).

## Phase 2 — UX & workspace (🟡 in progress)

- ✅ Light, spacious redesign; centered max-width frame off the screen edges.
- ✅ Header restructure — Active Meetings + Paste-ID top-right; contextual Stop.
- ✅ View modes: Transcript / Split / Chat; resizable split; full-screen centered chat.
- 🟡 Suggestions: filter by type (question/action/insight) + expand/collapse so the
  feed shows only the newest/most-relevant by default.
- ⬜ Persist session (transcript + suggestions + config) to localStorage; restore on reload.
- ⬜ Export meeting (transcript + suggestions + chat) to Markdown.
- ⬜ Keyboard shortcuts (connect, toggle question mode, focus chat, switch views).
- ⬜ Surface OpenRouter key status in-UI (clear "AI offline — set OPENROUTER_API" state).
- ⬜ Sentiment / key-moments flags wired to real behavior (currently inert toggles).

## Phase 3 — Backend delegation bridge (⬜ planned, security-sensitive)

Goal: when Fireflies Live is open, spin up a **localhost-only** companion server the
frontend can use to delegate work to **PI** (terminal agent) with full system access.

- ⬜ Local Node/Bun WS server, bound to `127.0.0.1`, started/stopped with the app session.
- ⬜ Command protocol: frontend emits an intent → server relays to PI.
- ⛔ **Guardrails (required before any exec):** per-command user confirmation, an
  allowlist of permitted operations, an audit log, and a hard kill-switch. No
  unconfirmed arbitrary execution. Never expose the port beyond loopback.
- ⬜ "Delegate to PI" affordance from chat / quick actions / suggestions.
- ⬜ Stream PI output back into a backend-terminal pane that only mounts while connected.

## Phase 4 — Chrome extension form factor (⬜ planned)

- ⬜ MV3 **side-panel** extension: dock the copilot next to the live call.
- ⬜ Detect a meeting tab where the user's Fireflies bot is present → one-click "Join Live."
- ⬜ Reuse the existing React app inside the side panel; share auth/config.
- ⬜ Optional: capture tab audio as a fallback transcription source.

## Phase 5 — Intelligence & polish (⬜ later)

- ⬜ Relevance ranking for suggestions (not just recency).
- ⬜ Per-speaker context / roles; "who is the host" detection for question mode.
- ⬜ Auto-actions (let approved suggestions execute without a click).
- ⬜ Multi-meeting support; meeting history browser (re-introduce Recent).
- ⬜ Tests (Vitest + Playwright) and CI.

---

## Known follow-ups / tech debt

- Pre-existing unused `statusMsg`/`setStatusMsg` and `src/hooks/useFirefliesConnection.ts`
  (dead file) — remove in a cleanup pass.
- Vite dev server reads `OPENROUTER_API` / `FIREFLY_API_KEY` from `~/Thrivbe-AI/.env`
  via a dev middleware; needs a real config story for non-dev deploys.
- Question mode assumes "other speakers ask the host"; no true host identification yet.
