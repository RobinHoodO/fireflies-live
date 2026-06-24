# Handoff: Fireflies Live — real-time meeting copilot (redesign)

## Overview
Fireflies Live is a single-screen, desktop-first web app used *during* a live meeting. It streams the live transcript on the left and runs an AI copilot on the right (suggestions feed, AI chat, a backend shell terminal, and agent configuration). This package is a full redesign that solves the previous version's central problem — a cramped, over-stacked sidebar — and establishes a spacing/type/color system plus all view modes and component states.

The north star: **spacious · bright · light · minimalist · futuristic.** Every element sits inside an invisible inner frame; nothing touches its container walls. Breathing room is a hard requirement, not a nicety.

## About the design files
The files in `design-source/` and the `Fireflies Live (preview).html` are **design references built in HTML** — a working prototype that shows the intended look and behavior. They are **not** production code to copy. Your job is to **recreate this design in the target codebase** using its established stack and patterns:

- **React 19 + Tailwind v4** (`@theme` tokens in `src/index.css`), light theme.
- Single main component **`src/App.tsx`** (the team implements from specs/this README).
- Icons: **lucide-react**. Markdown: **react-markdown**. No heavy UI frameworks expected.
- Must work down to **~1280px** wide; desktop-first, wide-monitor friendly.

Open `Fireflies Live (preview).html` in any browser to interact with the real thing (it's fully offline/self-contained). The `.dc.html` files are the authored source if you want to read exact markup/logic — but treat them as reference, not something to port verbatim (they use a bespoke runtime, not React).

## Fidelity
**High-fidelity.** Final colors, typography, spacing, interactions, and copy. Recreate the UI pixel-faithfully using lucide-react + Tailwind v4. All values below are exact.

---

## Decisions already made (don't re-explore)
- **Sidebar layout: TABBED is the chosen direction.** The sidebar shows a segmented tab strip (Live feed · Chat · Terminal) and renders **one section at a time** — no vertical stacking. (A "stacked / collapsible" variant was also prototyped and rejected. The prototype's `sidebarLayout` prop / `dir` state can be dropped; build only the tabbed sidebar.)
- **Agent configuration lives in a right-side slide-over**, not in the column. A compact summary row at the top of the sidebar opens it. Config is set occasionally, so it's tucked away.
- **Accent is azure** `oklch(0.585 0.16 242)` (a deliberate move away from the old indigo). Used consistently for primary actions, active states, focus rings, links.
- Live mode is the default; there is **no demo/live toggle** and **no big Connect/Stop buttons in the top bar** (connecting happens per-meeting inside the Active meetings popover; a small contextual **Stop** appears in the header only while connected).
- Recent/past meetings are intentionally **not** shown.

---

## Layout shell

- **Page**: full viewport, `padding: 28px`, background = a soft radial accent glow at top-right over a cool off-white:
  `radial-gradient(1200px 600px at 78% -8%, <accent-tint>, transparent 60%), oklch(0.975 0.006 250)`.
- **App frame**: centered, `max-width: 1660px`, `height: calc(100vh - 56px)`, vertical flex, `gap: 18px`. Clearly inset from screen edges (this was a fix — old app felt edge-to-edge).
- **Top bar**: its own white card. Below it, the **workspace** fills remaining height (`flex: 1; min-height: 0`), a horizontal flex with `gap: 18px`.
- Each column is a white card that scrolls **internally** (`overflow-y: auto`), never the page.

### View modes (segmented control in the top bar; default = Split)
| Mode | Behavior |
|---|---|
| **Transcript** | Transcript card full-width; sidebar hidden. |
| **Split** | Transcript + sidebar with a **drag-to-resize divider**. Ratio clamped to 0.34–0.74; default left = 0.60. |
| **Chat** | AI chat fills the screen but is centered in an **820px max-width reading column** (not a narrow strip, not edge-to-edge). Transcript hidden. |

**Split divider**: a 14px-wide hit area with a 5px×54px rounded grab handle (`oklch(0.88 0.008 255)`). On hover the handle turns accent and grows to 78px. `cursor: col-resize`. Drag updates the left column's flex-basis live.

---

## Top bar (header card)
`padding: 18px 26px; display:flex; align-items:center; gap:24px;` white card, `border:1px solid oklch(0.91 0.006 255)`, `border-radius:18px`, shadow (see tokens).

**Left group** (`gap:20px`):
- Wordmark "Fireflies Live" — Space Grotesk 700, 21px, `letter-spacing:-0.02em`. "Fireflies" in ink, "Live" in accent. Needs space from the corner.
- **Status pill**: `padding:8px 15px 8px 13px`, bg `oklch(0.98 0.004 250)`, `border:1px solid oklch(0.92 0.006 255)`, `border-radius:999px`, `gap:9px`. A 9px dot + label. States: **Idle** (gray `oklch(0.7 0.01 250)`), **Connecting…** (amber `oklch(0.78 0.14 75)`), **Connected** (green `oklch(0.68 0.16 155)` with a soft expanding pulse ring behind the dot).
- **Stop** button — appears only when connected. Ghost style, `border:1px solid oklch(0.9 0.02 25)`, text `oklch(0.55 0.16 25)`, filled square icon.

**Right group** (`gap:14px`):
- **View switcher** — segmented control: `padding:5px`, bg `oklch(0.97 0.005 250)`, `border-radius:13px`. Buttons: icon + label, active = white pill with shadow + ink text; inactive = transparent + `oklch(0.5 0.02 255)`. Icons: Transcript = `file-text`, Split = `columns-2`, Chat = `sparkles`.
- **Settings** gear button (42×42, white, `border-radius:12px`) — opens the config slide-over (available in all views).
- **Active meetings** button + popover (see below).

### Active meetings popover
Anchored under its button, `width:380px`, white, `border-radius:18px`, `padding:22px`, big soft shadow `0 18px 50px -20px rgba(16,24,40,.4)`.
- Header row: "Active meetings" + a 32×32 refresh button.
- Meeting rows (`padding:14px`, `border:1px solid oklch(0.93 0.006 255)`, `border-radius:13px`, hover → accent border + accent tint bg): green pulsing live dot, title (700/14px) + subtitle (`oklch(0.6 0.015 255)`/12.5px, e.g. "Discovery · 5 people · 12:31"), and a one-click accent **Connect** button.
- Divider, then "Paste a meeting ID": a monospace input (`app.fireflies.ai/view/…`) + Connect button.

---

## Left column — Live transcription

**Header** (`padding:24px 28px`, bottom hairline `oklch(0.95 0.005 250)`): NOTE — header content must have left padding (it used to hug the edge).
- 40×40 accent-tint rounded square with a `mic` icon, then title "Live transcription" (Space Grotesk 700/17px) + meeting title subtitle ("Acme Corp · Discovery").
- Right side actions: **Question mode** toggle button (prominent), **Copy** (40×40 icon button), **Export** (download icon → Markdown).
- **Question mode** button: ON = accent tint bg + accent border + accent text + 700 weight; OFF = white + hairline border + `oklch(0.42 0.02 255)`.

**Body** (`padding: 8px 32px 32px`, internal scroll):
- **Question-mode banner** (only when Question mode is ON): sticky to the top of the scroll area. `padding:20px 22px`, background `linear-gradient(180deg, <accent-tint>, #fff)`, accent border, `border-radius:16px`, soft accent shadow, `margin:16px 0 26px`.
  - Top row: an accent **"Say this"** pill (white text, `arrow-right` icon), label "Drafted for you · read it aloud" (accent-text), and a right-aligned green "live" dot + label.
  - Body: AI-drafted response as **rich text / markdown** (bold lead sentence, italic quote, inline code), 15px/1.65, `oklch(0.3 0.02 255)`.
- **Transcript stream**: `display:flex; flex-direction:column; gap:22px`. One paragraph per speaker turn; a new block starts only when the speaker changes.
  - Speaker name: 12.5px/700, color-coded. Colors used: prospect = `oklch(0.55 0.16 25)` (warm red), colleague = `oklch(0.5 0.14 155)` (green), **You** = accent.
  - Body text: 15.5px/1.7, `oklch(0.32 0.018 255)`.
- A live **"Listening…"** caret at the bottom: a 7×16 accent bar blinking + muted label.

**Empty state** (status = idle): centered, generous. A 74×74 accent-tint rounded square with a pulsing ring + `radio` icon; headline "Pick a meeting and hit Connect" (Space Grotesk 700/24px); friendly subcopy ("We auto-detect your active Fireflies meetings. Choose one and connect — or paste a meeting ID to jump straight in."); three step cards (Auto-detect / Pick one & Connect / Paste a meeting ID), each with an accent-tint icon tile; a primary "See active meetings" button. Keep it inviting and spacious.

**Connecting state**: centered spinner + "Connecting to your meeting…".

---

## Right sidebar (TABBED)

The sidebar card scrolls internally; everything inside lives in a **26px inner gutter** (`padding:26px`) with **26px vertical rhythm** between blocks. This consistent gutter is the core fix — nothing (selects, send buttons, chip rows) may touch the right wall.

1. **Config summary row** (top, always visible): a full-width button, bg `oklch(0.98 0.004 250)`, hairline border, `border-radius:14px`, `padding:16px 18px`. A `sliders-horizontal` icon tile + current mode label (700/14px) + "<model> · N features on" subtitle + a "Configure" accent label on the right. Opens the slide-over.

2. **Tab strip**: segmented control, `padding:5px`, bg `oklch(0.97 0.005 250)`, `border-radius:13px`. Three equal tabs (`flex:1`): **Live feed** (`lightbulb`), **Chat** (`message-square`), **Terminal** (`terminal`). Active = white pill + shadow + ink; inactive = `oklch(0.52 0.02 255)`. Only the active tab's panel renders.

### Tab A — Live feed (suggestions)
- **Rate row**: "Pulse rate" label (`gauge` icon) + a styled native `<select>` on the right (must clear the wall via the gutter). Options: `Fast · 8s`, `Normal · 12s` (default), `Relaxed · 20s`, `Slow · 30s`, `Paused`. Drives how often a new suggestion streams in.
- **Filter chips**: pill chips `All / Ask / Do / Note` (`padding:8px 15px`, `border-radius:999px`, `gap:9px`, wrap allowed). Active = accent tint + accent border + accent text. Non-"All" chips show a count badge. Selecting a filter resets the expand state.
- **Suggestion cards** (`gap:12px`): each is a tappable card (`padding:16px 18px`, hairline border, `border-radius:14px`; hover → typed color border + soft shadow). Left: 34×34 rounded icon tile in the type's tint. Right: a tiny uppercase type label + relative timestamp ("4s ago"), then the suggestion text (14px/1.55). **Tapping a card opens the AI chat** (switches to Chat tab/view to answer it).
  - Types & colors: **Ask** (azure accent, `help-circle` icon), **Do** (green `oklch(0.5 0.14 155)`, `zap` icon), **Note** (amber `oklch(0.6 0.12 70)`, `lightbulb` icon).
- **Show more / less**: by default show the newest 4; a full-width subtle button expands to the full scrollable history ("Show N more" / "Show less"). Must never become an endless wall.
- Newest on top. Relative timestamps update over time. New items stream in on the pulse interval.

### Tab B — AI assistant (chat)
- Threaded chat. **User** bubbles: accent bg, white text, `border-radius:16px 16px 4px 16px`, right-aligned, max-width 80%. **Agent** bubbles: 34×34 accent-tint avatar (`sparkles`) + a card bubble (bg `oklch(0.98 0.004 250)`, hairline border, `border-radius:4px 16px 16px 16px`) whose content is **rendered Markdown** — headings, **bold**, *italics*, bullet/numbered lists, `inline code`, code blocks. (Critical: the old build leaked raw `**asterisks**` — must render real Markdown via react-markdown.)
- **Thinking indicator**: three dots bouncing in an agent bubble while awaiting a reply.
- **Composer**: a rounded input row (`border-radius:16px`, hairline border, focus → accent border + 3px accent-tint focus ring). Auto-growing textarea + a 42×42 accent **send** button (`send` icon) that is **inset from the right wall** (row has `padding:8px 8px 8px 18px`). Enter submits, Shift+Enter newlines.
- **AI offline**: when the AI key is missing, show a subtle "AI offline" note near the header so it's clear why it's quiet.

### Tab C — Backend terminal · PI
A console that delegates shell tasks to the user's machine via a localhost bridge.
- **Online/offline** status dot (green when online) + "PI online".
- **Console**: dark surface `oklch(0.2 0.025 260)`, `border-radius:14px`, `padding:20px 22px` (text must NOT touch the top-left corner), `min-height:200px; max-height:280px`, internal scroll, JetBrains Mono 12.5px/1.7. Color-coded lines: **system** muted `oklch(0.7 0.02 250)`, **stdout** light `oklch(0.92 0.01 240)`, **command echo** accent-ish `oklch(0.82 0.09 242)`, **stderr** red `oklch(0.72 0.16 25)`, success-ish green.
- **Confirm bar** (safety guardrail — appears after you submit, before anything runs): an amber band (`bg oklch(0.97 0.03 75)`, `border oklch(0.85 0.08 75)`, `border-radius:13px`, `padding:16px 18px`). "Run this on your machine?" + the command shown in a mono chip + two buttons: **Cancel** (ghost) and **Run command** (accent). Nothing executes without this confirmation.
- **Input row**: mono input with a `terminal` prefix icon; a 38×38 accent **send** button **inset from the right wall** (row `padding:8px 8px 8px 16px`); focus-within → accent ring. Enter submits → opens confirm bar.
- **Route through PI** toggle: a full-width row (`plug` icon + label + switch) below the input.

---

## Config slide-over (Agent configuration)
Opened by the header gear or the sidebar summary row. A dimmed backdrop `oklch(0.2 0.02 260 / 0.32)` + a right panel `width:460px (max 92vw)`, bg `oklch(0.99 0.003 250)`, left border, big shadow. Internal scroll. Sticky translucent header (`sliders-horizontal` icon + "Agent configuration" + close X). Body `padding:30px; gap:34px`, sections divided by hairlines.

1. **Agent mode** — preset chips (`padding:11px 16px`, `border-radius:11px`, `gap:10px`, wrap): **Sales call · Interview · Standup · Negotiation · 1:1 · Discovery**. Selected = accent tint + accent border + accent text. A **"Suggest from meeting"** button (accent-tint, `sparkles`) appends AI-proposed modes as extra chips. A free-text **custom context** textarea below.
2. **AI model** — a granular picker grouped by provider, "Routed through OpenRouter": **Anthropic** (Claude Sonnet 4 / Opus 4 / Haiku), **OpenAI** (GPT-4o / GPT-4o mini / o3), **Google** (Gemini 2.5 Pro / Flash), **DeepSeek** (V3 / R1), **Meta Llama** (Llama 3.3 70B). Each provider has an uppercase group label; rows are selectable (selected = accent tint + accent border + a check icon).
3. **Features** — toggle rows (full-width, label + switch): **Auto-suggest · Sentiment · Action items · Live summary · Speaker labels · Profanity filter**.

**Switch component**: 42×24 track, `border-radius:999px`; off = `oklch(0.87 0.006 255)`, on = accent; 18px white knob with a soft shadow, slides 3px→21px, `transition: .18s`.

---

## Interactions & behavior
- **View switching**: instant; Split mounts the divider; Chat centers in the 820px column.
- **Divider drag**: pointer drag updates left flex-basis; clamp 0.34–0.74; set `cursor:col-resize` and disable text selection during drag.
- **Connect**: from a meeting row or paste field → status goes `connecting` (~1.3s) → `connected`; the suggestion pulse starts. **Stop** → `idle` (empty state) and stops the pulse.
- **Suggestion pulse**: every `rate` seconds prepend a new typed suggestion (cap history ~40). "Paused" stops it. Relative timestamps re-render periodically.
- **Tap a suggestion** → open AI chat to answer it.
- **Send chat**: append user msg, show thinking indicator, then append an agent Markdown reply (~1.4s in the prototype; real impl streams from the model).
- **Terminal submit**: Enter or send → confirm bar → on "Run command" echo the command (prefix `pi $ ` if Route-through-PI is on, else `$ `) then append output.
- **Question mode toggle**: shows/hides the sticky "Say this" banner.
- **Hover states** everywhere (cards lift to a typed-color border + soft shadow; buttons darken/tint).
- **Respect `prefers-reduced-motion`** (disable the pulse/blink/transition motion). **Accessible contrast (WCAG AA).**
- Avoid one-shot entrance fade-ins on persistent content (in React you won't hit the prototype's issue, but keep entrance motion subtle/optional).

## State (suggested)
`view` (transcript|split|chat) · `status` (idle|connecting|connected) · `splitRatio` · `questionMode` · `activeTab` (feed|chat|terminal) · `feedFilter` · `feedExpanded` · `pulseRate` · `suggestions[]` · `messages[]` · `thinking` · `agentMode` · `model` · `flags{}` · `customContext` · `routeThroughPI` · `termLines[]` · `pendingCommand` · `configOpen` · `meetingsOpen` · `pasteId`.

---

## Design tokens (map into Tailwind v4 `@theme` in `src/index.css`)

All accent values are the **azure** family; the prototype also supports Teal `…200` and Indigo `…278` swaps by changing only the hue — keep accent as one token set so it's swappable.

```css
@theme {
  /* Accent (azure) */
  --color-accent: oklch(0.585 0.16 242);
  --color-accent-hover: oklch(0.5 0.17 242);
  --color-accent-tint: oklch(0.965 0.03 242);
  --color-accent-tint2: oklch(0.93 0.05 242);   /* focus ring */
  --color-accent-border: oklch(0.84 0.08 242);
  --color-accent-text: oklch(0.45 0.17 242);

  /* Surfaces (cool off-whites) */
  --color-page: oklch(0.975 0.006 250);
  --color-card: #ffffff;
  --color-surface-soft: oklch(0.98 0.004 250);
  --color-border: oklch(0.91 0.006 255);
  --color-border-soft: oklch(0.94 0.005 250);

  /* Ink */
  --color-ink: oklch(0.27 0.025 255);
  --color-ink-2: oklch(0.45 0.02 255);
  --color-muted: oklch(0.6 0.015 255);
  --color-faint: oklch(0.7 0.012 255);

  /* Status */
  --color-live: oklch(0.68 0.16 155);
  --color-connecting: oklch(0.78 0.14 75);
  --color-idle: oklch(0.7 0.01 250);

  /* Suggestion types */
  --color-type-ask: oklch(0.55 0.16 242);
  --color-type-do: oklch(0.5 0.14 155);
  --color-type-note: oklch(0.6 0.12 70);

  /* Speakers */
  --color-speaker-a: oklch(0.55 0.16 25);
  --color-speaker-b: oklch(0.5 0.14 155);
  /* "You" = --color-accent */

  /* Terminal */
  --color-term-bg: oklch(0.2 0.025 260);

  /* Type */
  --font-display: "Space Grotesk", sans-serif;  /* wordmark + section headers */
  --font-sans: "Manrope", system-ui, sans-serif; /* UI / body */
  --font-mono: "JetBrains Mono", monospace;       /* terminal / code */

  /* Radius */
  --radius-card: 18px;
  --radius-control: 13px;
  --radius-chip: 11px;
  --radius-pill: 999px;

  /* Shadow */
  --shadow-card: 0 1px 2px rgba(16,24,40,.04), 0 12px 32px -22px rgba(16,24,40,.25);
  --shadow-pop: 0 18px 50px -20px rgba(16,24,40,.4);
}
```

**Spacing scale** (px): 4 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · **26 (sidebar gutter & section rhythm)** · 28 (frame inset) · 32 · 40 · 48 · 64.

**Type scale**: wordmark 21/700 (display); screen titles 17–18/700 (display); section labels 15.5/700; body 14–15.5; meta/caption 11.5–13; mono 12.5–13. Minimum interactive hit target ~40px.

---

## Assets / icons
No bitmap assets. **All icons are lucide** (use `lucide-react`). Icons used: `mic, radio, copy, download, sparkles, sliders-horizontal, lightbulb, gauge, command, terminal, plug, search, send, message-square, chevron-down, chevron-up, x, refresh-cw, columns-2, file-text, check, plus, bot, user, settings, zap, clock, help-circle, arrow-right, square`. Fonts: Space Grotesk, Manrope, JetBrains Mono (Google Fonts). No emoji.

## Files in this package
- `Fireflies Live (preview).html` — self-contained, offline interactive prototype. **Open this first** to see/feel the target.
- `design-source/Fireflies Live.dc.html` — authored source (markup + logic) for the whole app. Reference for exact values/copy.
- `design-source/ChatThread.dc.html`, `design-source/Composer.dc.html` — the chat thread + composer sub-components.
- `design-source/support.js` — the prototype runtime (not needed for your React build; included for completeness).

## Out of scope (for now)
Chrome-extension form factor, mobile layouts, session persistence, keyboard shortcuts. (These are later phases.)
