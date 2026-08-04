// Static config + style helpers, ported from the design source (Fireflies Live.dc.html).
// Phase 2: the mock content (transcript, meetings, suggestions, chat, terminal) has
// been removed — those now come from the live backend. What remains is design config.
import type { CSSProperties } from "react";

export const C = {
  ac: "oklch(0.585 0.16 242)", hover: "oklch(0.5 0.17 242)", tint: "oklch(0.965 0.03 242)",
  tint2: "oklch(0.93 0.05 242)", border: "oklch(0.84 0.08 242)", text: "oklch(0.45 0.17 242)",
};

export const MODES = [
  { id: "sales", l: "Sales call" }, { id: "interview", l: "Interview" }, { id: "standup", l: "Standup" },
  { id: "negotiation", l: "Negotiation" }, { id: "oneone", l: "1:1" }, { id: "discovery", l: "Discovery" },
];

// OpenRouter model slugs (verified slug format). Grouped by provider.
export const MODELS = [
  { p: "Anthropic", items: [
    { id: "anthropic/claude-sonnet-5", l: "Claude Sonnet 5" },
    { id: "anthropic/claude-opus-4.8", l: "Claude Opus 4.8" },
    { id: "anthropic/claude-haiku-4.5", l: "Claude Haiku 4.5" },
  ] },
  { p: "OpenAI", items: [
    { id: "openai/gpt-5.6-terra", l: "GPT-5.6 Terra" },
    { id: "openai/gpt-5.6-sol", l: "GPT-5.6 Sol" },
    { id: "openai/gpt-5.5", l: "GPT-5.5" },
    { id: "openai/gpt-5.4-mini", l: "GPT-5.4 mini" },
  ] },
  { p: "Google", items: [
    { id: "google/gemini-3.5-flash", l: "Gemini 3.5 Flash" },
    { id: "google/gemini-3.1-flash-lite", l: "Gemini 3.1 Flash Lite" },
  ] },
  { p: "DeepSeek", items: [
    { id: "deepseek/deepseek-v4-pro", l: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", l: "DeepSeek V4 Flash" },
    { id: "deepseek/deepseek-v3.2", l: "DeepSeek V3.2" },
  ] },
  { p: "Meta Llama", items: [
    { id: "meta-llama/llama-4-maverick", l: "Llama 4 Maverick" },
    { id: "meta-llama/llama-3.3-70b-instruct", l: "Llama 3.3 70B" },
  ] },
  { p: "xAI", items: [{ id: "x-ai/grok-4.5", l: "Grok 4.5" }] },
  { p: "Mistral", items: [{ id: "mistralai/mistral-large-2512", l: "Mistral Large" }] },
];

export const MODEL_IDS = MODELS.flatMap(g => g.items.map(i => i.id));

export const FAST_MODELS = [
  { id: "anthropic/claude-haiku-4.5", l: "Claude Haiku 4.5" },
  { id: "google/gemini-3.5-flash", l: "Gemini 3.5 Flash" },
  { id: "deepseek/deepseek-v4-flash", l: "DeepSeek V4 Flash" },
  { id: "anthropic/claude-sonnet-5", l: "Claude Sonnet 5 (quality)" },
];

export const FLAGS = [
  { k: "autosuggest", l: "Auto-suggest" }, { k: "sentiment", l: "Sentiment" }, { k: "actions", l: "Action items" },
  { k: "summary", l: "Live summary" }, { k: "speakers", l: "Speaker labels" }, { k: "profanity", l: "Profanity filter" },
];

export const VIEWS = [
  { id: "transcript", l: "Transcript", ic: "i-file" }, { id: "split", l: "Split", ic: "i-columns" },
  { id: "chat", l: "Chat", ic: "i-sparkles" }, { id: "map", l: "Map", ic: "i-command" },
];

export const TABS = [
  { id: "feed", l: "Live feed", ic: "i-bulb" }, { id: "chat", l: "Chat", ic: "i-message" }, { id: "pi", l: "Command", ic: "i-terminal" },
];

// Feed filter chips — multi-select, none selected = everything. Each carries
// the icon and colour of the items it shows, so the chip row and the list read
// as one system. Types per chip live in feed.ts FILTER_TYPES.
export const FILTERS = [
  { id: "ask", l: "Ask", ic: "i-help", color: "oklch(0.55 0.16 242)", bg: "oklch(0.965 0.03 242)" },
  { id: "do", l: "Do", ic: "i-zap", color: "oklch(0.5 0.14 155)", bg: "oklch(0.96 0.04 155)" },
  { id: "note", l: "Note", ic: "i-bulb", color: "oklch(0.6 0.12 70)", bg: "oklch(0.97 0.04 75)" },
  { id: "command", l: "Command", ic: "i-terminal", color: "oklch(0.52 0.15 290)", bg: "oklch(0.96 0.03 290)" },
  { id: "agenda", l: "Agenda", ic: "i-arrow", color: "oklch(0.45 0.17 242)", bg: "oklch(0.93 0.05 242)" },
  { id: "branch", l: "Branch", ic: "i-command", color: "oklch(0.5 0.15 320)", bg: "oklch(0.96 0.03 320)" },
];

// Types Robin can add by hand from the feed composer.
export const ADDABLE = [
  { id: "note", l: "Note" }, { id: "topic", l: "Agenda point" }, { id: "ask", l: "Ask" },
  { id: "do", l: "Do" }, { id: "clarify", l: "Clarify" }, { id: "branch", l: "Branch" },
  { id: "command", l: "Command" },
];

export const SUGMETA: Record<string, { kind: string; icon: string; color: string; bg: string }> = {
  ask: { kind: "Ask", icon: "i-help", color: "oklch(0.55 0.16 242)", bg: "oklch(0.965 0.03 242)" },
  do: { kind: "Do", icon: "i-zap", color: "oklch(0.5 0.14 155)", bg: "oklch(0.96 0.04 155)" },
  note: { kind: "Note", icon: "i-bulb", color: "oklch(0.6 0.12 70)", bg: "oklch(0.97 0.04 75)" },
  command: { kind: "Command", icon: "i-terminal", color: "oklch(0.52 0.15 290)", bg: "oklch(0.96 0.03 290)" },
  topic: { kind: "Agenda", icon: "i-arrow", color: "oklch(0.45 0.17 242)", bg: "oklch(0.93 0.05 242)" },
  clarify: { kind: "Clarify", icon: "i-help", color: "oklch(0.58 0.12 70)", bg: "oklch(0.97 0.04 75)" },
  branch: { kind: "Branch", icon: "i-command", color: "oklch(0.5 0.15 320)", bg: "oklch(0.96 0.03 320)" },
};

// Live data shapes — populated by the backend at runtime (see App.tsx / backend.ts).
export type Suggestion = { id: number; type: string; text: string; t: number; status?: "done"; outcome?: string };
export type Message = { id: number; role: "user" | "agent"; text: string };
export type TermLine = { k: string; t: string };

export const EMPTY_STEPS = [
  { icon: "i-search", title: "Auto-detect active meetings", body: "Your live Fireflies sessions appear here — no setup needed." },
  { icon: "i-plug", title: "Pick one and hit Connect", body: "One click streams the transcript here in real time." },
  { icon: "i-command", title: "Or paste a meeting ID", body: "Grab it from app.fireflies.ai/view/ID, then connect." },
];

export const RATES = [
  { v: "8s", l: "Fast · 8s" }, { v: "12s", l: "Normal · 12s" }, { v: "20s", l: "Relaxed · 20s" }, { v: "30s", l: "Slow · 30s" }, { v: "off", l: "Paused" },
];

// ── Style helpers (ported verbatim) ──────────────────────────────
export const segBtn = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 15px", borderRadius: 10, border: "none", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", background: active ? "#fff" : "transparent", color: active ? "oklch(0.27 0.025 255)" : "oklch(0.5 0.02 255)", boxShadow: active ? "0 1px 2px rgba(16,24,40,.12)" : "none" });
export const tabBtn = (active: boolean): CSSProperties => ({ flex: "1 1 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 10, borderRadius: 9, border: "none", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", transition: "all .15s", background: active ? "#fff" : "transparent", color: active ? "oklch(0.27 0.025 255)" : "oklch(0.52 0.02 255)", boxShadow: active ? "0 1px 2px rgba(16,24,40,.12)" : "none" });
export const modeChip = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 16px", borderRadius: 11, fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, lineHeight: 1, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", border: "1px solid " + (active ? C.border : "oklch(0.91 0.006 255)"), background: active ? C.tint : "#fff", color: active ? C.text : "oklch(0.4 0.02 255)" });
export const filterChip = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 999, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all .15s", border: "1px solid " + (active ? C.border : "oklch(0.92 0.006 255)"), background: active ? C.tint : "#fff", color: active ? C.text : "oklch(0.5 0.02 255)" });
// A type chip wears its own type's colour when on — so the row of chips and the
// list below it are visibly the same taxonomy. Empty types dim, never vanish:
// a disappearing control is worse than a quiet one.
export const typeChip = (active: boolean, color: string, bg: string, empty: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999,
  fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap",
  border: "1px solid " + (active ? color : "oklch(0.92 0.006 255)"),
  background: active ? bg : "#fff", color: active ? color : "oklch(0.5 0.02 255)",
  opacity: !active && empty ? 0.45 : 1,
});
export const countBadge = (active: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: active ? "#fff" : "oklch(0.96 0.005 250)", color: active ? C.text : "oklch(0.55 0.015 255)" });
// Small neutral control (sort select, toggles) — one visual weight, so view
// controls never compete with the type filters for attention.
export const viewControl = (active = false): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", borderRadius: 9,
  fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap",
  border: "1px solid " + (active ? C.border : "oklch(0.92 0.006 255)"),
  background: active ? C.tint : "oklch(0.985 0.004 250)", color: active ? C.text : "oklch(0.45 0.02 255)",
});
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
