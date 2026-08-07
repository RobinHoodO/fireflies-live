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
| 🧭 **7** | Adaptive Navigator | ✅ **7.1–7.3 shipped 2026-07-12** (7.4 kernel-native ⬜) — design: [`ADAPTIVE-NAVIGATOR.md`](./ADAPTIVE-NAVIGATOR.md) |
| 🕊️ **8** | Facilitation intelligence | ⬜ planned — sourced from the Max Semenchuk call, 2026-08-07 |

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
- ✅ 📈 Live sentiment analysis *(2026-07-14)* — dedicated ~60-token fast-model micro-call
  every 20s (`fetchSentiment`, navigator-pattern clone: seq guard, clamp, null on failure);
  sidebar strip with current-mood label + score + SVG sparkline (green/gray/red), wired to
  the existing Sentiment toggle; in Markdown export; reset per connection. Key-moments
  flag still inert.
- ✅ 🩺 **2026-08-07 data-loss fix pass** — the meeting record was destroying more than it
  kept. `FEED_CAP` 60 → 400 and `lines` 500 → 3000 (both were hard slices, and
  `prioritize` sinks handled items to the bottom, so *done notes were deleted first* —
  that's the "notes are disappearing" report); near-duplicate suppression (`isNearDupe`,
  word-overlap, same-type only) since the AI rewords its own suggestions and each reword
  claimed a slot; wrong-language ASR banner (`garbledSpeakers`). Measured on the Max
  call: 53% of the words and three quarters of the suggestions were being thrown away.
  Full analysis: [`postmortem-2026-08-07-max.md`](./postmortem-2026-08-07-max.md).
- ✅ 🕸️ **2026-08-07 map fixes** — ring radius `230 · depth^0.72` instead of a flat 260px
  per ring (a 20-deep conversation sat on a 5200px radius of empty space), and edges use
  `pathLength={1}` so the grow-in dash matches the curve — the hardcoded
  `strokeDasharray: 900` was rendering any longer filament as 900-on/900-off, which is
  why lines looked disconnected on the outer rings.

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
- ⬜ 🎙️ Voice analysis — per-speaker tone/energy/prosody from actual audio (not text).
  Depends on Phase 4 tab-audio capture; complements text sentiment with how things are said.
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

## 🧭 Phase 7 — Adaptive Navigator (🟡 in build)

> From *transcriber with tips* → **goal-conditioned conversation navigator**: knows
> Robin's 🎯 goal, tracks 🧭 where the conversation is, pulls 🌌 his own resources into
> the moment, and guides what to say / how to say it / how to act — live.
> Full design: [`ADAPTIVE-NAVIGATOR.md`](./ADAPTIVE-NAVIGATOR.md)

```
🎯 goal card ──▶ 🌌 constellation ──▶ 🧭 navigator loop (~45s) ──▶ ⚡ fast loop (8–12s)
   (once)         (on demand)           situation frame              goal-directed
                  semsearch :3015       phase·stance·next move       suggestions/chat
```

- ✅ 🎯 **7.1 Goal card** *(2026-07-12)* — free-text intent at connect (objective, red
  lines, desired outcome); 🎯 pill in the sidebar; every prompt (suggestions, "Say
  this", chat, navigator) goal-conditioned; persisted.
- ✅ 🧭 **7.2 Navigator strip** *(2026-07-12)* — 45s pulse → situation frame `{phase,
  stance, goal_progress, next_move, risk}` pinned above the transcript with manual ↻,
  injected into every fast-loop prompt, in export/File output. Wire-verified: real
  frame on a discount push → *"Anchor ROI math, then propose paid pilot at list price."*
- ✅ 🌌 **7.3 Constellation** *(2026-07-12)* — bridge `POST /context` fans out over
  turbovec corpora (📜 meetings 125 · 📚 wiki_skills 10.5K · 🧠 notion 34K · 🧑 people
  2K, 6s timeouts, score floor) + local meeting analyses + `clients/` folders →
  ≤8KB bundle + source chips (🧑1 📜2 📚6 🧠4 📁1 in live test); adaptive, not a
  template — assembled from Robin's request; grounds all guidance.
- ✅ ⚡ **Fast + cheap** *(2026-07-12)* — live loops (suggestions/Say-this/navigator)
  on a dedicated fast model (default 🐇 Haiku 4.5), chat on the quality model;
  pulse context capped (last-40 lines, 1.5KB bundle slice vs 6KB for chat).
- ✅ 🔁 **Follow-through** *(2026-07-12)* — the pulse tracks execution: Robin says the
  suggested thing → suggestion flips to ✓ Done with *how it landed* ("↳ Team writes
  ~120 recaps/week, their biggest time sink") — zero extra API calls; stays in
  touch with where the conversation is.
- ⬜ 🏢 **7.4 Kernel-native** — retrieval + guidance via Thrivbe-1 kernel (private
  routing, full wiki text, Twenty/Notion enrichment). Merges with 6.2/6.3.

## 🕊️ Phase 8 — Facilitation intelligence (⬜ planned)

> From **goal-conditioned navigator** → **AI facilitator**. Phase 7 asks *am I
> getting what I came for?* Phase 8 asks *is this conversation working, for
> everyone in it?* — intentions, emotional arc, conflict patterns, and the
> non-verbal layer.
>
> Sourced almost entirely from the Max Semenchuk call, **2026-08-07** — the
> first hour of real user feedback on the product from someone building the
> adjacent thing. Full transcript:
> `content/meetings/transcripts/2026-08-07-robin-max-semenchuk-fireflies-full.md`.
> Post-mortem on why the live system captured almost none of it:
> [`postmortem-2026-08-07-max.md`](./postmortem-2026-08-07-max.md).

Robin's framing in the call: *"a motivation for me is to have an AI facilitator
that can always help a meeting… facilitation is a crucial skill, but it takes a
lot of energy, and most people don't have that experience."* Max's constraint on
the same idea: *"it can be a support system for thinking, but not delegate
thinking to AI."*

### 8.1 — Ready to build

- ⬜ 🎭 **The three questions** — replace the generic post-meeting summary with
  Max's own framework, which he uses on every meeting *because* it's cheap
  enough to sustain: **What were the intentions of the parties? What was the
  emotional arc? What is the metaphor for this meeting?** Then: how well were
  those intentions served, per side. Direct product critique from him: *"your
  fireflies… when it tries to give me a typical summary, well, it's not too bad
  — but then it usually misunderstands the tasks. I haven't found a lot of help
  with that."* Note what this replaces: Navigator gives phase/stance/risk and
  sentiment gives a number; neither answers any of the three. Feeds the
  meeting-analyser output too (6.1).
- ⬜ 🙋 **Intentions panel — opening protocol, closed at the end.** Max's friend
  opens every meeting with *state your intention, state your distractions* (so a
  distracted participant reads as distracted, not demotivated). Max was
  sceptical, then converted: *"How can you start a meeting without intentions?"*
  Robin's variant needs no ceremony — the AI **infers and surfaces** background
  intentions and unspoken assumptions from the transcript. Build both: captured
  early, checked against at close.
- ⬜ ⚠️ **Conflict-pattern detection → mediation nudge.** Max ran two real
  conflict transcripts through analysis; both returned the same finding —
  *both parties wanted the same thing, never made intentions visible, then spun
  in circles.* His proposal: spot the pattern live and at the ~5–10 min mark
  offer *"it looks like you might want to try another strategy."* Distinct from
  the sentiment score — pattern-matching against known dialogue failure modes,
  not a mood reading.
- ⬜ 📮 **Pre-meeting prep, sent out.** Robin's extension of the facilitator
  idea: the system mails participants their preparation beforehand. Max
  independently described his own 100% mode as *prep → present → analyse* and
  said he only pays that cost for crucial conversations because *"it's daunting
  to try to do it every time."* **That is the positioning for the whole
  product** — make 100% mode cheap enough for routine meetings.

### 8.2 — Design constraints (from the same call)

- ⬜ 🫥 **Solve the presence problem — the sharpest objection in the call.**
  *"If there is a conversation happening and I keep track of this window, which
  also works with a bit of delay, and I'm trying to see what's written in there —
  I lose connection with the person in conversation."* That is a direct critique
  of a live dashboard as a form factor. His fix is not to abandon it: make
  delivery **non-intrusive** (*"could maybe send you just a personal message in
  the chat, or just on your screen"*) and push heavy analysis async/post-call.
  Re-examine the current UI's attention cost against this. Interacts with Phase
  4 (side panel) and 8.4.
- ⬜ 🤲 **Support thinking, never delegate it.** Standing constraint on every
  Phase 8 feature — and *especially* never delegate relationship-building.
- ⬜ ⚖️ **Neutrality is a hard requirement, and refusal is a real state.** Max
  and his wife resolved a finance tension well by each laying their side out
  through ChatGPT; days later he proposed an AI mediator for the same topic and
  she flatly refused — *"I wasn't prepared to somebody say no to AI mediator."*
  He also named the failure mode: a one-sided AI becomes an advocate and starts
  using clinical language against the other party (*"you're abusing…"*). Any
  mediation feature must be visibly neutral **and** degrade gracefully when a
  participant wants no part of it.

### 8.3 — The bigger bet: agent-to-agent mediation

- ⬜ 🕊️ **Neutral mediator agent between two parties' agents.** Robin's design:
  each party brings their own agent carrying full personal history; a neutral
  mediator sits between them, able to search each side's context **in a sandbox,
  wiped after the meeting**. Plus the private-channel move — the mediator DMs
  one participant: *"two weeks ago you said this — might it be relevant now?"*
- ⬜ 🔐 **ZK-style selective disclosure.** Max's sharpening: the bartender
  doesn't need your passport, only *over 18*. The mediator requests one specific
  fact, gets that user's explicit approval, and only that fact crosses. He also
  named the actual gap: **there is no protocol for AI-to-AI context sharing
  today** — a ChatGPT shared chat leaks everything from the moment you share it.
  Greenfield; possibly the most interesting thing in the call.

### 8.4 — Beyond text: the non-verbal layer

- ⬜ 🕺 **Movements / body language.** Robin's theatre ratio — ~5% words, 10–15%
  tone, the rest body. Max's demo (built on Maha's art-of-dialogue framework)
  segments a video into chunks by dominating **movement** — speaking from above,
  horizontally, the "snail" — with ElevenLabs emotion recognition on his list.
  Ties into Phase 5's voice-analysis item and Phase 4's tab-audio capture.
- 🔵 **Encouraging finding:** his system is **transcript-only today**, and from
  an hour of rich context it reliably detected that people were arguing —
  without audio. More is recoverable from text than assumed; don't block 8.4 on
  audio/video capture.
- ⬜ 🎲 **The calibration game — a pattern worth stealing wholesale.** His demo
  doesn't assert. *You* guess the movement, the AI guesses, you compare, it gives
  its rationale: *"it's more like a provocation… not you're wrong, AI is right."*
  It trains the human's attentiveness while generating labels for a framework
  that has none (Maha's ~16 movements have no reference document and no labelled
  corpus; his plan is 2-of-3 or 3-of-5 human agreement as ground truth). The AI
  is the **"fly on the wall"** point of view, offered for comparison rather than
  authority. Applies straight to the feed: *a suggestion offered as one read to
  compare against your instinct* is a different product from one asserting what
  to say next — and it is the version that survives the "don't outsource
  cognition" objection in 8.2.

### 8.5 — Meeting type / mode

- ⬜ 🏷️ **Pick a check-in type before the feed starts generating.** The
  2026-08-07 call ran the entire hour in sales-discovery mode against a friend —
  26 of 60 saved items were near-identical *"position Robin as…"* branches on a
  peer catch-up. Whatever goal/context was set, the mode was wrong. Phase 7's
  goal card conditions the *content*; this conditions the *register*.

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
- 🗣️ **Fireflies realtime locks a speaker to the wrong language.** On 2026-08-07 Robin's
  entire side streamed as Ukrainian/Russian fragments (264 garbage words) while Max
  streamed clean; the *final* transcript had Robin in English (1616 words), so the defect
  leaves no trace after the call. The copilot therefore advised on half a conversation for
  an hour. We can only warn (`garbledSpeakers` banner) — **open question: can the
  Fireflies workspace/bot be pinned to English?** Their post-call pass clearly gets it
  right. Never validate live-transcription quality against the post-call transcript;
  they are different systems.
- 💾 The meeting record is written once, at export — a mid-call crash still loses the
  meeting. The caps no longer do (2026-08-07), but the write is still a single point.
