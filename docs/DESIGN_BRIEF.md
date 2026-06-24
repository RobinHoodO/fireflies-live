# Fireflies Live — Design Brief

A brief for an external design team. It captures the product, the design vision, the
specific problems to solve, and the per-region requirements. The goal is a redesign (or
design system + high-fidelity screens) we can implement in **React + Tailwind v4**.

---

## 1. What the product is

**Fireflies Live** is a real-time meeting copilot. While you're in a meeting that your
Fireflies notetaker has joined, the app streams the **live transcript** and an **AI
assistant** works alongside you: it suggests questions to ask, drafts what to say, runs
quick actions, lets you chat about the meeting, and can delegate shell tasks to a local
backend agent ("PI").

It's a single-screen web app (desktop-first, wide layouts). Think **Linear / Arc /
Raycast**-grade polish, but in **light mode**.

Primary user: a meeting host/operator who needs glanceable, low-friction assistance
*during* a live call — not a dashboard they study.

---

## 2. Design vision (north star)

**Spacious · bright · light · minimalist · futuristic.**

The single most important quality: **breathing room**. Every box, panel, card, button,
and input should sit inside an *invisible inner frame* — content must never be squeezed
against its container walls or against neighboring elements. When in doubt, add space.

- **Light, airy surfaces** — cool off-whites, not stark white; soft depth via hairline
  borders and gentle shadows, never heavy chrome.
- **One restrained accent** (currently indigo) used consistently for primary actions,
  active states, and focus — never neon, never AI-purple-glow soup.
- **Calm density** — this is a *live* tool used in the corner of attention. Favor
  generous whitespace and clear hierarchy over information density.
- **Futuristic, not flashy** — subtle (a faint background grid/aurora, smooth
  micro-interactions, a soft live pulse on "connected"). Restraint over effects.
- **Real icons** (lucide), never emoji. Accessible contrast (WCAG AA). Respect
  `prefers-reduced-motion`.

> The recurring failure mode so far: timid, incremental spacing (e.g. 32px → 36px
> padding) that's imperceptible. We want **bold, deliberate spacing decisions**, not
> nudges. Treat "is this squeezed to the wall?" as a hard checklist item on every element.

---

## 3. The biggest open problem: cramped sidebar

The right-hand sidebar holds a lot (config, suggestions feed, command palette, backend
terminal, AI chat). It has repeatedly felt **crammed** — content flush against the panel's
right edge, chips packed tight, sections stacked with no breathing room. We've partially
addressed this (an inner frame on the sidebar, a collapsible config section), but we want
the design team to solve it **properly and holistically**:

- Give the whole column a consistent inner gutter so nothing touches the card walls
  (especially the **right edge** — selects, send buttons, and chip rows kept hugging it).
- Establish a clear **vertical rhythm** between sections.
- Decide what deserves to be **always visible** vs **collapsed/secondary**. The
  configuration (agent modes, AI model, feature flags) is set occasionally — it should be
  tucked away (collapsible or relocated), not dominating the column.
- The column may simply be **too narrow for its content** — consider width, or moving
  some functions into other layouts/views.

---

## 4. Layout & view modes

The app has a top bar, a left **transcript** column, and a right **sidebar**. The user can
switch the working layout via a segmented control:

| Mode | Behavior |
|---|---|
| **Transcript** | Transcript full-width; sidebar hidden. |
| **Split** | Transcript + sidebar, with a **drag-to-resize divider** (user sets the ratio). |
| **Chat** | The AI chat takes the **entire screen**, but **centered** in a comfortable reading column. Transcript hidden. |

Requirements:
- The split divider must feel like a real, grabbable handle.
- "Chat" mode must feel full-screen yet centered/readable — not a narrow strip, not edge-to-edge.
- The whole app should sit inside a centered max-width frame that's clearly **inset from
  the screen edges** (it currently feels close to edge-to-edge on wide monitors).

---

## 5. Top bar (header)

- Left: product mark **"Fireflies Live"** + a **status pill** (idle / connecting /
  connected — with a soft live pulse when connected). The pill and mark need space from
  each other and from the top-left corner.
- A contextual **Stop** affordance appears only while connected.
- Right: the **view switcher** (Transcript / Split / Chat) and an **Active Meetings**
  control (top-right): a dropdown/popover listing currently-active meetings, each with a
  one-click **Connect**, plus a compact **"Paste meeting ID"** field and a refresh.
- Live mode is the default; there is **no** "demo vs live" toggle in the UI.
- Past/"Recent" meetings are intentionally **not** shown for now.
- The big Connect/Stop buttons were removed from the top — connecting happens per-meeting
  from Active Meetings.

---

## 6. Left column — Live transcription

- Header "Live transcription" + meeting title, with **Copy** and **Export** (to Markdown)
  actions. Header content needs left padding (it has hugged the left edge).
- Body: a stream of transcript paragraphs. **One paragraph per speaker**, speaker name
  color-coded; a new line starts only when the speaker changes.
- A strong, friendly **empty state**: "We auto-detect your active Fireflies meetings —
  pick one and hit Connect, or paste a meeting ID." (Currently three cards; keep it
  inviting and spacious.)
- **Question mode**: a prominent toggle. When ON, a distinct, live-feeling **"Say this →"
  banner** appears at the top of the transcript showing an AI-drafted response the host can
  read aloud (rich text). Hidden when OFF.

---

## 7. Right sidebar — sections

Designed as a stack of sections; several are collapsible. Needs the spacing overhaul from §3.

### a. Agent configuration (collapsible, secondary)
Set occasionally; should be collapsed/tucked by default.
- **Agent modes**: clickable preset chips (Sales call, Interview, Standup, Negotiation,
  1:1, Discovery) that set the assistant's operating context. Plus a **"Suggest from
  meeting"** action where the AI reads the transcript and proposes tailored modes as
  additional chips. Plus a **custom** free-text context field.
- **AI model**: a granular picker of OpenRouter models, **grouped by provider** (DeepSeek,
  OpenAI, Anthropic, Google, Meta Llama, others).
- **Feature flags**: a set of toggle chips.
- These chip groups have been the worst offenders for cramping — they need real gaps and
  per-chip padding, and room to wrap.

### b. Suggestions — a live "news feed"
- AI suggestions stream in on a **pulse** (configurable rate: 8s / 12s / 20s / 30s / off).
- **Newest on top**, full **history kept** (scrollable), with relative timestamps.
- Show only the newest/most-relevant by default with a **show-more / show-less** expander —
  it must not become an endless wall.
- **Filter chips** (All / Ask / Do / Note) to filter by suggestion type.
- Each card is typed/color-coded (question / action / insight) and tappable (expands into
  an AI answer in the chat).

### c. Command palette (collapsible)
- Quick actions grouped by category; collapsed row needs real vertical padding.

### d. Backend Terminal · PI (collapsible)
- A small console that delegates shell tasks to the user's machine via a localhost bridge.
- Online/offline status dot; live, color-coded output (stdout / stderr / system).
- A command input + a **"Route through PI"** toggle.
- A **confirmation step** before any command runs (a clearly visible confirm bar — this is
  a safety guardrail, not a tiny link).
- The console's inner text must have padding (it has touched the box's top-left corner);
  the input row's send button must clear the right wall.

### e. AI Assistant chat
- A threaded chat about the meeting. **Agent replies render rich Markdown** (headings,
  bold, lists, code) — currently raw `**asterisks**` leak through, which must be fixed.
- Clear user-vs-agent bubbles, a thinking indicator, a roomy composer. The **send button
  must be inset from the right edge** (it hugs the wall).
- When the AI key is missing, show a subtle "AI offline" note so it's clear why it's quiet.

---

## 8. Known cramped spots (from user annotation)

These were explicitly circled as "too little space" — treat as a checklist:
1. Top-left status pill ("Idle") — flush to the mark and corner.
2. "Live transcription" header — flush to the left edge.
3. Agent-mode chips — tight against each other and the right wall.
4. Feature-flag chips — tight, touching.
5. "Live feed" + pulse select ("Normal · 12s") — select hugs the right edge.
6. Suggestion filter chips (All / Ask / Do / Note) — tight.
7. Command palette collapsed row — thin/cramped.
8. Backend Terminal — console text in the corner; input + send cramped.
9. Both **Send** buttons (terminal + chat composer) — flush to the right wall.
10. The entire right column — insufficient gutter from the card's right edge.

---

## 9. Tone & copy

- Friendly, plain, confident. Short. No jargon, no hype.
- Sentence case for labels (avoid ALL-CAPS-tracking "eyebrow" labels everywhere — they read
  templated). Microcopy should feel human ("Pick one and hit Connect").

---

## 10. Technical constraints (for implementation handoff)

- **React 19 + Tailwind v4** (`@theme` tokens in `src/index.css`). Light theme.
- Single main component (`src/App.tsx`) — the design team works in Figma/specs; we implement.
- Icons: **lucide-react**. Markdown: react-markdown. No heavy UI frameworks expected.
- Must work down to ~1280px wide; desktop-first, wide-monitor friendly.
- Deliver as a design system would: spacing scale, type scale, color tokens, component
  states (default/hover/active/disabled/focus), and the key screens/view-modes.

---

## 11. Deliverables we'd like

1. A **spacing & layout system** that guarantees the "inner frame" breathing room.
2. High-fidelity designs for: **Split**, **Transcript-only**, **Chat-only** views;
   the **Active Meetings** popover; the **collapsed vs expanded** sidebar sections; the
   **empty state**; the **Question-mode banner**; the **Backend Terminal** (incl. confirm
   bar); and the **suggestions feed** (filters + expand).
3. Component specs (chips, buttons, selects, inputs, cards, toggles, segmented control,
   collapsible section header) with all states.
4. Color/type tokens mappable to Tailwind v4 `@theme`.

---

## 12. Out of scope (for now)

- Chrome extension form factor (planned later — see `docs/ROADMAP.md` Phase 4).
- Mobile layouts.
- Session persistence, keyboard shortcuts (planned — Phase 2).

---

*Companion docs in this repo: `docs/ROADMAP.md` (phasing) and `docs/FEATURES.md` (feature
inventory with status).*
