// Mock data + style helpers, ported from the design source (Fireflies Live.dc.html).
// Interface-only: no real data, no backend. Phase 2 swaps these for live wiring.
import type { CSSProperties } from "react";

export const C = {
  ac: "oklch(0.585 0.16 242)", hover: "oklch(0.5 0.17 242)", tint: "oklch(0.965 0.03 242)",
  tint2: "oklch(0.93 0.05 242)", border: "oklch(0.84 0.08 242)", text: "oklch(0.45 0.17 242)",
};

export type Para = { name: string; color: string; text: string };
export const PARAS: Para[] = [
  { name: "Maya Chen", color: "oklch(0.55 0.16 25)", text: "Thanks for hopping on. We're evaluating a few tools to cut down the time our CS team spends writing follow-ups after every call." },
  { name: "You", color: "oklch(0.52 0.16 242)", text: "Totally — that's the pain we hear most. Before I dive in, how big is the CS team today?" },
  { name: "Maya Chen", color: "oklch(0.55 0.16 25)", text: "We're at fourteen, scaling to maybe twenty-five by end of year. Onboarding new reps fast is the other headache." },
  { name: "Devin Rao", color: "oklch(0.5 0.14 155)", text: "On onboarding, the shared call library has been the biggest win for our mid-market customers — new hires ramp by listening to real calls." },
  { name: "Maya Chen", color: "oklch(0.55 0.16 25)", text: "Good to know. What does pricing look like for a team our size — and is there a ramp as we grow?" },
];

export const MODES = [
  { id: "sales", l: "Sales call" }, { id: "interview", l: "Interview" }, { id: "standup", l: "Standup" },
  { id: "negotiation", l: "Negotiation" }, { id: "oneone", l: "1:1" }, { id: "discovery", l: "Discovery" },
];

export const MODELS = [
  { p: "Anthropic", items: [{ id: "anthropic/claude-sonnet-4", l: "Claude Sonnet 4" }, { id: "anthropic/claude-opus-4", l: "Claude Opus 4" }, { id: "anthropic/claude-haiku", l: "Claude Haiku" }] },
  { p: "OpenAI", items: [{ id: "openai/gpt-4o", l: "GPT-4o" }, { id: "openai/gpt-4o-mini", l: "GPT-4o mini" }, { id: "openai/o3", l: "o3" }] },
  { p: "Google", items: [{ id: "google/gemini-2.5-pro", l: "Gemini 2.5 Pro" }, { id: "google/gemini-flash", l: "Gemini 2.5 Flash" }] },
  { p: "DeepSeek", items: [{ id: "deepseek/v3", l: "DeepSeek V3" }, { id: "deepseek/r1", l: "DeepSeek R1" }] },
  { p: "Meta Llama", items: [{ id: "meta/llama-3.3-70b", l: "Llama 3.3 70B" }] },
];

export const FLAGS = [
  { k: "autosuggest", l: "Auto-suggest" }, { k: "sentiment", l: "Sentiment" }, { k: "actions", l: "Action items" },
  { k: "summary", l: "Live summary" }, { k: "speakers", l: "Speaker labels" }, { k: "profanity", l: "Profanity filter" },
];

export const MEETINGS = [
  { id: "acme", title: "Acme Corp", sub: "Discovery · 5 people", time: "12:31" },
  { id: "internal", title: "Weekly Standup", sub: "Internal · 8 people", time: "04:02" },
];

export const VIEWS = [
  { id: "transcript", l: "Transcript", ic: "i-file" }, { id: "split", l: "Split", ic: "i-columns" }, { id: "chat", l: "Chat", ic: "i-sparkles" },
];

export const TABS = [
  { id: "feed", l: "Live feed", ic: "i-bulb" }, { id: "chat", l: "Chat", ic: "i-message" }, { id: "terminal", l: "Terminal", ic: "i-terminal" },
];

export const FILTERS = [{ id: "all", l: "All" }, { id: "ask", l: "Ask" }, { id: "do", l: "Do" }, { id: "note", l: "Note" }];

export const SUGMETA: Record<string, { kind: string; icon: string; color: string; bg: string }> = {
  ask: { kind: "Ask", icon: "i-help", color: "oklch(0.55 0.16 242)", bg: "oklch(0.965 0.03 242)" },
  do: { kind: "Do", icon: "i-zap", color: "oklch(0.5 0.14 155)", bg: "oklch(0.96 0.04 155)" },
  note: { kind: "Note", icon: "i-bulb", color: "oklch(0.6 0.12 70)", bg: "oklch(0.97 0.04 75)" },
};

export const SUG_POOL = [
  { type: "ask", text: "Ask Maya what success looks like 90 days after rollout." },
  { type: "do", text: "Generate a one-line value recap for the chat." },
  { type: "note", text: "Devin surfaced the shared call library — strong onboarding hook." },
  { type: "ask", text: "Confirm the timeline: when do they want to be live?" },
  { type: "do", text: "Draft a follow-up email with pricing tiers attached." },
  { type: "note", text: "Decision likely involves more than Maya — map the buying group." },
];

export type Suggestion = { id: number; type: string; text: string; t: number };
export function initialSuggestions(now: number): Suggestion[] {
  return [
    { id: 1, type: "note", text: "Budget sensitivity signal — they asked about a ramp as the team grows.", t: now - 184000 },
    { id: 2, type: "do", text: "Pull mid-market pricing tiers into the chat.", t: now - 122000 },
    { id: 3, type: "ask", text: "Ask who else is involved in the buying decision.", t: now - 61000 },
    { id: 4, type: "note", text: "Maya framed onboarding (14 → 25 reps) as a second buying motive.", t: now - 41000 },
    { id: 5, type: "do", text: "Draft a recap email for this call.", t: now - 22000 },
    { id: 6, type: "ask", text: "Ask what their current follow-up process costs in hours per week.", t: now - 4000 },
  ];
}

export type Message = { id: number; role: "user" | "agent"; text: string };
export const INITIAL_MESSAGES: Message[] = [
  { id: 1, role: "agent", text: "Hi — I'm following this call live. Ask me anything, or tap a suggestion to dig in." },
  { id: 2, role: "user", text: "Summarize what Maya cares about so far." },
  { id: 3, role: "agent", text: "**Maya's priorities so far:**\n\n- **Follow-up time** — her CS team spends too long writing post-call recaps.\n- **Onboarding speed** — scaling `14 → 25` reps this year; ramping new hires fast is a real pain.\n- **Pricing that scales** — she wants a *range* and a growth ramp, not a flat number.\n\nBest next move: anchor on time saved before you say a price." },
];

export type TermLine = { k: string; t: string };
export const INITIAL_TERM: TermLine[] = [
  { k: "system", t: "PI bridge connected · 127.0.0.1:7842" },
  { k: "system", t: "Delegate shell tasks to your machine. Every command asks first." },
];

export const EMPTY_STEPS = [
  { icon: "i-search", title: "Auto-detect active meetings", body: "Your live Fireflies sessions appear here — no setup needed." },
  { icon: "i-plug", title: "Pick one and hit Connect", body: "One click streams the transcript here in real time." },
  { icon: "i-command", title: "Or paste a meeting ID", body: "Grab it from app.fireflies.ai/view/ID, then connect." },
];

export const Q_BANNER_TEXT = "**Acknowledge the budget question, then reframe around value before the number.**\n\n*“Great question — let me give you a range and how it scales as you grow.”* Anchor on the CS time saved across `14 → 25` reps, then offer the growth ramp so the future feels handled.";

export const RATES = [
  { v: "8s", l: "Fast · 8s" }, { v: "12s", l: "Normal · 12s" }, { v: "20s", l: "Relaxed · 20s" }, { v: "30s", l: "Slow · 30s" }, { v: "off", l: "Paused" },
];

// ── Style helpers (ported verbatim) ──────────────────────────────
export const segBtn = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 15px", borderRadius: 10, border: "none", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", background: active ? "#fff" : "transparent", color: active ? "oklch(0.27 0.025 255)" : "oklch(0.5 0.02 255)", boxShadow: active ? "0 1px 2px rgba(16,24,40,.12)" : "none" });
export const tabBtn = (active: boolean): CSSProperties => ({ flex: "1 1 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 10, borderRadius: 9, border: "none", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", transition: "all .15s", background: active ? "#fff" : "transparent", color: active ? "oklch(0.27 0.025 255)" : "oklch(0.52 0.02 255)", boxShadow: active ? "0 1px 2px rgba(16,24,40,.12)" : "none" });
export const modeChip = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 16px", borderRadius: 11, fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, lineHeight: 1, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", border: "1px solid " + (active ? C.border : "oklch(0.91 0.006 255)"), background: active ? C.tint : "#fff", color: active ? C.text : "oklch(0.4 0.02 255)" });
export const filterChip = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 999, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all .15s", border: "1px solid " + (active ? C.border : "oklch(0.92 0.006 255)"), background: active ? C.tint : "#fff", color: active ? C.text : "oklch(0.5 0.02 255)" });
export const countBadge = (active: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: active ? "#fff" : "oklch(0.96 0.005 250)", color: active ? C.text : "oklch(0.55 0.015 255)" });
export const modelRow = (active: boolean): CSSProperties => ({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", padding: "13px 16px", borderRadius: 12, fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left", transition: "all .15s", border: "1px solid " + (active ? C.border : "oklch(0.92 0.006 255)"), background: active ? C.tint : "#fff", color: active ? C.text : "oklch(0.32 0.018 255)" });
export const track = (active: boolean): CSSProperties => ({ position: "relative", display: "inline-block", width: 42, height: 24, borderRadius: 999, flex: "0 0 auto", transition: "background .18s", background: active ? C.ac : "oklch(0.87 0.006 255)" });
export const knob = (active: boolean): CSSProperties => ({ position: "absolute", top: 3, left: active ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .18s", boxShadow: "0 1px 3px rgba(16,24,40,.3)" });
export const qBtnStyle = (on: boolean): CSSProperties => on
  ? { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 11, border: "1px solid " + C.border, background: C.tint, color: C.text, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", transition: "all .15s" }
  : { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 11, border: "1px solid oklch(0.91 0.006 255)", background: "#fff", color: "oklch(0.42 0.02 255)", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", transition: "all .15s" };

export function rel(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  return Math.round(m / 60) + "h ago";
}
