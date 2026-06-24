# Design-System Integration Plan

How to swap the current UI for the new standalone design system and re-wire it to the
existing backend. Written for a **fresh session** to execute cheaply.

## The source file

`~/Desktop/Fireflies Live (standalone).html` (~383 KB, 182 lines). It is a **bundled
prototype export** ("Bundled Page"): the real UI is rendered at runtime by inline
minified JS (Vue/React-ish), with an SVG thumbnail fallback. It has **no clean
semantic ids/classes** to hook into (only `__bundler_*`). So you cannot "inject wiring"
into it — you must **extract the design and rebuild it as React**, reusing our wiring.

## Recommended extraction method

1. Serve/open the HTML in a browser via Playwright MCP (`browser_navigate` to a
   `file://` URL or copy it into `public/` and open `/standalone.html`).
2. Drive it through every state and `browser_take_screenshot` each: the split view,
   transcript-only, **chat view** (see spec below), Active Meetings, the sidebar
   sections (config/suggestions/palette/terminal), empty state, question-mode banner.
3. Optionally `browser_evaluate` to pull computed `outerHTML` + stylesheet rules for
   pixel-accurate tokens (colors, radii, spacing, fonts).
4. Rebuild as the new `src/App.tsx` markup + `src/index.css` tokens, matching the
   captured design. Keep React 19 + Tailwind v4.

## Backend contract to RE-ATTACH (all already exist in current `src/App.tsx`)

Do NOT rewrite these — wire the new markup to them:

- **Keys/config:** `GET /api/fireflies-key` → `{ ffKey, orKey, bridgeToken }` (Vite plugin).
- **Meetings:** `fetchMeetings(ffKey)` → `active_meetings` GraphQL; `startConnection(m)`,
  `handleConnect()`, `connRef.current?.disconnect()`.
- **Live transcript:** `connectLive(onLine,onStatus,ffKey,meetingId)` — Socket.IO to
  `wss://api.fireflies.ai` path `/ws/realtime`, auth `{ token:"Bearer "+key, transcriptId }`.
  **Critical:** transcription payload is nested under `data.payload`
  (`{chunk_id,text,speaker_name}`); upsert lines by `chunk_id`. `grouped` merges
  consecutive same-speaker segments into one paragraph.
- **AI:** `callAI(messages,orKey,aiModel)` → OpenRouter. `AI_MODELS` (grouped optgroups).
- **Suggestions feed:** throttled effect → `fetchSuggestions(ctx,orKey,agentContext,aiModel)`,
  prepended newest-first; `pulseMs`/`PULSE_OPTIONS`; filter + expand state
  (`suggFilter`, `suggExpanded`).
- **Question mode:** `questionMode` + `fetchLiveAnswer(...)` → `liveAnswer` banner.
- **Agent modes:** `AGENT_MODES`, `proposeModes(...)`→`proposedModes`, `agentContext`.
- **Bridge / PI terminal:** `GET /bridge/health`, `POST /bridge/run` (NDJSON stream,
  header `Authorization: Bearer ${bridgeToken}`). State: `bridgeOnline`, `termInput`,
  `termLines`, `termRunning`, `usePI`, `piCmd`, `pendingCmd` + `requestRun`/`confirmRun`/
  `cancelPending`. Server: `server/bridge.mjs` (loopback-only, token-gated, denylist, audit).
- **Markdown:** `<Markdown text={...}/>` (react-markdown + remark-gfm) for all AI output.
- **Layout:** `viewMode` (split/transcript/chat), `splitPct` + `startResize`, `exportMarkdown`.

## Captured spec — AI chat view (from user screenshot)

Light, centered, readable column (this is the `viewMode === "chat"` layout).

- **Header:** sparkle icon + **"AI assistant"** (bold) over **"Ask anything about this
  meeting"** (muted subtitle), left-aligned at top of the column.
- **Seeded greeting** (agent): "Hi — I'm following this call live. Ask me anything, or
  tap a suggestion to dig in." → consider seeding `chatMessages` with this on connect.
- **Agent bubble:** pale blue-gray fill (~`#eef3f8`), dark text, rounded-2xl, a small
  sparkle avatar to its left. Renders Markdown: **bold** labels, bulleted list, and
  **inline code pills** (e.g. `14 → 25`) shown as light-blue rounded chips.
- **User bubble:** solid blue (~`#1668e3`), white text, rounded-2xl, right-aligned, no avatar.
- **Composer:** full-width rounded input "Ask the AI anything…" with a **blue circular
  send button** (paper-plane) on the right; generous padding; clears the right edge.
- Ignore the "Sidebar direction: Stacked / Tabbed" pill — that's the design tool's own UI.

## Design north star

See `docs/DESIGN_BRIEF.md`. Spacious / light / minimalist / futuristic; the "invisible
inner frame" rule (nothing flush to walls); one restrained accent; bold spacing, not nudges.

## Suggested execution order (fresh session)

1. Extract design (Playwright screenshots + optional DOM/CSS pull).
2. Port theme tokens to `src/index.css`.
3. Rebuild `App.tsx` markup per view (start with chat — spec above — since it's nearly wired).
4. Re-attach each backend hook from the contract above.
5. `npx vite build` clean; verify live (Playwright screenshot vs the design).
6. Commit per region.
