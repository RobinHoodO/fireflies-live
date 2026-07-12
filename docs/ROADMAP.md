# 🪰 Fireflies Live — Roadmap

A real-time meeting copilot: 📡 live Fireflies transcription + 🤖 an AI assistant that
suggests questions, drafts responses, runs quick actions, and 🔀 delegates work to a
backend. Light, spacious, futuristic UI.

**Status legend:** ✅ done · 🟡 in progress · ⬜ planned

## 📊 Status dashboard

| Phase | Theme | Status |
|-------|-------|--------|
| 📡 **0** | Core realtime | ✅ shipped |
| 🤖 **1** | AI assistant | ✅ shipped |
| 🎨 **2** | UX & workspace | ✅ shipped *(2026-07-12: persistence + shortcuts + autoscroll landed)* |
| 🖥️ **3** | Backend delegation bridge | 🟡 MVP shipped, security-sensitive |
| 🧩 **4** | Chrome extension form factor | ⬜ planned |
| 🧠 **5** | Intelligence & polish | ⬜ later |
| 🌐 **6** | Thrivbe OS integration | 🟡 **6.1 End & File shipped 2026-07-12** |

```
before 📅 ──────── during 🔴 LIVE ──────── after 📝
prospect            ┌───────────────┐       meeting-analyser
research            │ FIREFLIES LIVE │──📁──▶ → Notion page
(sales OS)          └───────────────┘ file   → decisions DB
                     you are here 🫵          → tasks DB
```

---

## 📡 Phase 0 — Core realtime (✅ shipped)

- ✅ 🔌 Fireflies Realtime API over Socket.IO (`wss://api.fireflies.ai`, `/ws/realtime`).
- ✅ 🐛 **Bug fix:** transcription payload is nested under `data.payload`; `chunk_id`
  is a stable, server-revised segment id → upsert by it (don't append per event).
- ✅ 🗣️ Speaker grouping — consecutive same-speaker segments merge into one paragraph;
  new line only on speaker change.
- ✅ 📋 `active_meetings` GraphQL query → auto-fetch on load; per-session Connect.
- ✅ 🎭 Demo mode fallback.

## 🤖 Phase 1 — AI assistant (✅ shipped)

- ✅ 🧭 OpenRouter backend with model picker.
- ✅ 💡 Real, transcript-driven suggestions (replaces canned random) on a throttled pulse.
- ✅ ⏱️ Configurable pulse rate (8s / 12s / 20s / 30s / off).
- ✅ 📜 Suggestion **history feed** — newest on top, deduped, capped.
- ✅ 🗨️ **Question mode** — live-drafts what the host should say in reply to the latest turn.
- ✅ 🎛️ Agent-context **modes** — preset chips + custom textarea + "propose modes from
  this meeting" (AI reads the transcript and proposes tailored modes).
- ✅ ⚡ Quick-action command palette.
- ✅ ✍️ Rich markdown rendering for all AI output (fixes raw `**stars**`).

## 🎨 Phase 2 — UX & workspace (✅ shipped)

- ✅ 🌤️ Light, spacious redesign; centered max-width frame off the screen edges.
- ✅ 🧭 Header restructure — Active Meetings + Paste-ID top-right; contextual Stop.
- ✅ 🪟 View modes: Transcript / Split / Chat; resizable split; full-screen centered chat.
- ✅ 🔎 Suggestions filter by type + expand/collapse (newest/most-relevant by default).
- ✅ 📤 Export meeting (transcript + suggestions + chat) to Markdown.
- ✅ 🚦 AI-offline state in-UI when `OPENROUTER_API` is missing.
- ✅ 💾 Persist session (transcript + suggestions + chat + PI log) to localStorage; restore
  on reload with a "Restored from your last session" transcript state (debounced +
  pagehide flush, shape-validated so a corrupt blob can't white-screen). *(2026-07-12)*
- ✅ ⌨️ Keyboard shortcuts — ⌘/Ctrl+1/2/3 views, ⌘K meetings, ⌘U question mode, ⌘J focus chat. *(2026-07-12)*
- ✅ 🧲 Stick-to-bottom autoscroll on transcript + chat + PI threads (never hijacks after
  scroll-up; follows in-place text growth; pre-paint via `useLayoutEffect`). *(2026-07-12)*
- ✅ 🩹 2026-07-12 fix pass: reconnect socket leak, question-mode stream race (seq guard) +
  stuck `answering` flag, meetings-API errors surfaced in the popover, model roster
  refreshed to current OpenRouter slugs (Sonnet 5 default) with stale-slug migration.
- ⬜ 📈 Sentiment / key-moments flags wired to real behavior (currently inert toggles).

## 🖥️ Phase 3 — Backend delegation bridge (🟡 MVP shipped, security-sensitive)

Goal: when Fireflies Live is open, spin up a **localhost-only** companion server the
frontend can use to delegate work to **PI** (terminal agent) with full system access.

- ✅ 🔒 Local Node server (`server/bridge.mjs`), bound to `127.0.0.1`, spawned by Vite
  (lives only while the dev server / app is open), `/bridge` proxy.
- ✅ 🧵 Command protocol: NDJSON streaming (`start`/`out`/`err`/`exit`); optional routing
  through a configurable PI command (`usePI` + `piCmd`).
- ✅ 🛡️ **Guardrails:** in-UI per-command confirmation, a denylist of catastrophic
  patterns (rm -rf /, fork bombs, pipe-to-shell, force-push, …), output cap + timeout,
  audit log (`server/audit.log`), loopback-only bind, per-session bearer token,
  Host-header check (anti DNS-rebinding), no-CORS posture.
- ✅ 🖲️ Backend-terminal pane in the sidebar with online/offline status and live output.
- ⬜ 🧱 Upgrade denylist → allowlist + kill-switch before any non-local/multi-user use.
- ✅ 🎯 "Delegate to PI" affordance — `command` suggestions run in the PI tab.

## 🧩 Phase 4 — Chrome extension form factor (⬜ planned)

- ⬜ 📌 MV3 **side-panel** extension: dock the copilot next to the live call.
- ⬜ 🕵️ Detect a meeting tab where the user's Fireflies bot is present → one-click "Join Live."
- ⬜ ♻️ Reuse the existing React app inside the side panel; share auth/config.
- ⬜ 🎙️ Optional: capture tab audio as a fallback transcription source.

## 🧠 Phase 5 — Intelligence & polish (⬜ later)

- ⬜ 🏅 Relevance ranking for suggestions (not just recency).
- ⬜ 👤 Per-speaker context / roles; "who is the host" detection for question mode.
- ⬜ 🤝 Auto-actions (let approved suggestions execute without a click).
- ⬜ 🗂️ Multi-meeting support; meeting history browser (re-introduce Recent).
- ⬜ 🧪 Tests (Vitest + Playwright) and CI.

## 🌐 Phase 6 — Thrivbe OS integration (🟡 in progress — the strategic home)

Fireflies Live is the missing **"during-meeting" layer** of the sales OS meeting loop
already running on Thrivbe-1 (research before → ??? during → meeting-analyser → Notion/
Twenty after). Weave, in order of leverage:

- ✅ 📁 **6.1 End & File** *(2026-07-12)* — the 📂 File button (and auto-file on ⏹ Stop)
  writes the full meeting record via a locked-down bridge `POST /file` endpoint into
  `~/Thrivbe-AI/content/meetings/transcripts/`, where the existing **meeting-analyser**
  skill ingests it unchanged (analysis → Notion meeting page → decisions + tasks).
  Fixed server-side destination, sanitized slugs (path traversal impossible), collision
  suffixes, size cap, audit-logged, token-authed. Zero new infra. 🎉
- ⬜ 🧠 **6.2 Command → kernel delegation** — replace local `pi` spawn with a POST to the
  thrivbe-os kernel on Thrivbe-1 (voice-bridge pattern: confirmation gate + tool manifest).
  Mid-meeting "do" / "command" suggestions land in **🌸 Bloom** as tracked tasks and execute
  on the fleet instead of dying in a local chat pane.
- ⬜ 🏢 **6.3 Command Center absorption** — end-state: this app becomes CC's `/meetings/live`
  tab on Thrivbe-1 (tailnet :3002), keys held server-side. That *is* the deploy/config story
  (today keys come from a Vite dev middleware reading `~/Thrivbe-AI/.env` — Mac dev only).
- 💯 100x framing: live copilot on Robin's own calls = Client Zero's most demoable
  "AI employee" artifact → labs entry + AI-Factory story.

---

## 🧾 Known follow-ups / tech debt

- 🧟 Pre-existing unused `statusMsg`/`setStatusMsg` in v1 (`src/App.tsx`) — remove in a
  cleanup pass. (`src/hooks/useFirefliesConnection.ts` deleted 2026-07-12.)
- 🔑 Vite dev server reads `OPENROUTER_API` / `FIREFLY_API_KEY` from `~/Thrivbe-AI/.env`
  via a dev middleware; needs a real config story for non-dev deploys (→ Phase 6.3).
  Note: `FIREFLY_API_KEY` is actually the **Fireflies.ai** token, mislabeled.
- 🙋 Question mode assumes "other speakers ask the host"; no true host identification yet.
- 🐢 Demo mode stream freezes in background tabs (Chrome timer throttling) — cosmetic,
  the real socket is event-driven and unaffected.
