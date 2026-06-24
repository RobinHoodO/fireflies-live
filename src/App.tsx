import { useState, useRef, useEffect, useCallback } from "react";
import { QUICK_ACTIONS } from "./data/quickActions";
import type { ChatMessage, FeatureFlags, ConnectionStatus } from "./types";
import {
  Mic, Play, Square, Send, Copy, Check, Lightbulb, Command,
  ChevronDown, ChevronUp, MessageSquare, RefreshCw, HelpCircle, Zap, Eye,
  Sparkles, Settings2, Radio, Columns, FileText, Cpu, Plug, Search,
  X, Wand2, ArrowRight, Gauge, Terminal, Download, AlertTriangle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SPEAKER_COLORS = [
  "text-emerald-600", "text-sky-600", "text-amber-600", "text-rose-600",
  "text-violet-600", "text-cyan-600", "text-orange-600", "text-fuchsia-600",
];

function speakerColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

// Tiny relative-time formatter for the suggestion feed timestamps.
function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 8) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const PULSE_OPTIONS: { value: number; label: string }[] = [
  { value: 8000, label: "Fast · 8s" },
  { value: 12000, label: "Normal · 12s" },
  { value: 20000, label: "Relaxed · 20s" },
  { value: 30000, label: "Slow · 30s" },
  { value: 0, label: "Off" },
];

type SuggestionType = "question" | "action" | "insight";

interface Suggestion {
  text: string;
  type: SuggestionType;
  id: string;
  ts: number;
}

const SUGGESTION_STYLE: Record<SuggestionType, { icon: typeof HelpCircle; bg: string; border: string; dot: string; icon_color: string; label: string }> = {
  question: { icon: HelpCircle, bg: "bg-amber-dim", border: "border-amber-600/15 hover:border-amber-600/35", dot: "bg-amber-500", icon_color: "text-amber-600", label: "Ask" },
  action:   { icon: Zap,         bg: "bg-accent-dim", border: "border-accent/15 hover:border-accent/35", dot: "bg-accent", icon_color: "text-accent", label: "Do" },
  insight:  { icon: Eye,         bg: "bg-violet-dim", border: "border-violet-600/15 hover:border-violet-600/35", dot: "bg-violet-500", icon_color: "text-violet-600", label: "Note" },
};

interface MeetingOption { id: string; title: string; date: string; active: boolean; }

async function fetchMeetings(apiKey: string): Promise<{ meetings: MeetingOption[]; raw: any }> {
  const q = `query {
    active_meetings { id title start_time end_time organizer_email }
    transcripts(limit: 15) { id title date organizer_email }
  }`;
  const r = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const d = await r.json();
  console.log("Fireflies API response:", d);
  const active: MeetingOption[] = (d?.data?.active_meetings || []).map((m: any) => ({ id: m.id, title: m.title || "Untitled", date: m.start_time ? new Date(m.start_time).toISOString() : new Date().toISOString(), active: true }));
  const past: MeetingOption[] = (d?.data?.transcripts || []).filter((t: any) => t.date).map((t: any) => ({ id: t.id, title: t.title || "Untitled", date: new Date(t.date).toISOString(), active: false }));
  return { meetings: [...active, ...past], raw: d };
}

async function callAI(messages: { role: string; content: string }[], key: string, model = "deepseek/deepseek-chat"): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5173", "X-Title": "Fireflies Live" },
    body: JSON.stringify({ model, messages, max_tokens: 400, temperature: 0.7 }),
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "Couldn't generate a response.";
}

// Real, transcript-driven suggestions (replaces the old random canned generator).
async function fetchSuggestions(ctx: string, key: string, context: string, model: string): Promise<Suggestion[]> {
  const sys = `You are a real-time meeting copilot.${context ? ` Context: ${context}` : ""} Read the live transcript and surface up to 3 high-value, specific suggestions for the listener right now. Each item is one of: "question" (a sharp question to ask), "action" (a concrete task to do), or "insight" (something notable to remember). Respond ONLY with a JSON array, e.g. [{"type":"question","text":"..."}]. Each text under 12 words. No prose.`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    const valid: SuggestionType[] = ["question", "action", "insight"];
    return arr.filter((x: any) => x?.text).slice(0, 3).map((x: any) => ({ text: String(x.text), type: valid.includes(x.type) ? x.type : "insight", id: crypto.randomUUID(), ts: Date.now() }));
  } catch { return []; }
}

function connectLive(onLine: (speaker: string, text: string, final: boolean, key?: string) => void, onStatus: (s: ConnectionStatus) => void, apiKey: string, meetingId: string) {
  let socket: any = null;
  return {
    async connect() {
      onStatus("connecting");
      try {
        const { io } = await import("socket.io-client");
        socket = io("wss://api.fireflies.ai", {
          path: "/ws/realtime",
          transports: ["websocket"],
          auth: {
            token: `Bearer ${apiKey}`,
            transcriptId: meetingId,
          },
        });

        socket.onAny((event: string, ...args: any[]) => {
          console.log("[Fireflies]", event, args);
        });

        socket.on("auth.success", () => {
          console.log("Authenticated with Fireflies");
        });

        socket.on("auth.failed", (err: any) => {
          console.error("Auth failed:", err);
          onStatus("error");
        });

        socket.on("connection.established", () => {
          console.log("Connection established, receiving transcription");
          onStatus("connected");
        });

        socket.on("connection.error", (err: any) => {
          console.error("Connection error:", err);
          onStatus("error");
        });

        socket.on("transcription.broadcast", (data: any) => {
          // Fireflies nests the chunk under `payload`; top-level data.text is undefined.
          const p = data?.payload ?? data;
          const text = p?.text || "";
          if (!text) return;
          // chunk_id is a stable, repeatedly-revised segment id — upsert by it, don't append per-event.
          onLine(p.speaker_name || "Speaker", text, true, `c${p.chunk_id}`);
        });

        socket.on("disconnect", (reason: string) => {
          console.log("Disconnected:", reason);
          onStatus("disconnected");
        });
      } catch (e) {
        console.error("Socket.IO failed:", e);
        onStatus("error");
      }
    },
    disconnect() {
      if (socket) { socket.disconnect(); socket = null; }
      onStatus("disconnected");
    },
  };
}

function connectDemo(onLine: (speaker: string, text: string, final: boolean, key?: string) => void, onStatus: (s: ConnectionStatus) => void) {
  const LINES: [string, string][] = [
    ["Alice Chen", "Alright, let's kick off the sprint planning. We need to finalize the API integration timeline."],
    ["Marcus Johnson", "I've been looking at the Fireflies API docs. The real-time WebSocket looks solid — we can stream live transcription."],
    ["Sarah Kim", "What's the latency like? If we're building a live agent, every second counts."],
    ["Marcus Johnson", "From the docs, it's about 1-2 seconds behind. Not bad for transcription."],
    ["David Park", "I can wire up the Socket.IO client today. The auth flow is straightforward — just an API token and transcript ID."],
    ["Alice Chen", "Great. Sarah, what about the AI suggestions feature? That's the core differentiator."],
    ["Sarah Kim", "We can pipe the transcription stream directly into the LLM context. As each chunk arrives, we check for trigger phrases."],
    ["Marcus Johnson", "What triggers are we thinking? Questions? Action items?"],
    ["Sarah Kim", "Questions, deadlines, decisions, and any explicit hey can someone look up type requests."],
    ["David Park", "Should we also listen for sentiment? Like if someone sounds frustrated or confused?"],
    ["Alice Chen", "Yes, but let's ship the core features first. Transcription plus suggestions plus commands. We can add sentiment in v2."],
    ["Marcus Johnson", "Agreed. I'll start on the command palette — that's the quick-action interface."],
    ["Sarah Kim", "For the suggestions UI, I'm thinking a sidebar panel with real-time cards that update as the conversation evolves."],
    ["David Park", "We should also add a whisper mode where the agent can DM the host privately instead of posting to everyone."],
    ["Alice Chen", "Love that. Okay, action items: Marcus on command palette, Sarah on suggestions engine, David on Fireflies integration."],
    ["Sarah Kim", "I'll also spike on the context window management. We don't want to blow past token limits on long meetings."],
    ["Marcus Johnson", "Good call. What's the plan for the demo? We need something working by Friday."],
    ["Alice Chen", "Minimal viable: live transcription feed plus command palette with at least 5 working actions. Suggestions can be simulated."],
    ["David Park", "I can have the Fireflies connection working by tomorrow. Then we integrate."],
  ];
  let running = false;
  return {
    async connect() {
      running = true; onStatus("connecting"); await new Promise(r => setTimeout(r, 500)); onStatus("connected");
      for (const [s, t] of LINES) { if (!running) break; const w = t.split(" "); for (let i = 0; i < w.length; i++) { if (!running) break; onLine(s, w.slice(0, i + 1).join(" "), i === w.length - 1); await new Promise(r => setTimeout(r, 55 + Math.random() * 70)); } await new Promise(r => setTimeout(r, 450 + Math.random() * 600)); }
      if (running) onStatus("disconnected");
    },
    disconnect() { running = false; onStatus("disconnected"); },
  };
}

// Curated OpenRouter models grouped by provider for granular choice. `group` drives <optgroup>.
const AI_MODELS: { value: string; label: string; group: string }[] = [
  // DeepSeek
  { value: "deepseek/deepseek-chat", label: "DeepSeek Chat (fast, cheap)", group: "DeepSeek" },
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1 (reasoning)", group: "DeepSeek" },
  // OpenAI
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini", group: "OpenAI" },
  { value: "openai/gpt-4o", label: "GPT-4o", group: "OpenAI" },
  { value: "openai/gpt-4.1", label: "GPT-4.1", group: "OpenAI" },
  { value: "openai/gpt-4.1-mini", label: "GPT-4.1 mini", group: "OpenAI" },
  { value: "openai/o1", label: "o1 (reasoning)", group: "OpenAI" },
  { value: "openai/o3-mini", label: "o3-mini (reasoning)", group: "OpenAI" },
  // Anthropic
  { value: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet", group: "Anthropic" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", group: "Anthropic" },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (fast)", group: "Anthropic" },
  { value: "anthropic/claude-3-opus", label: "Claude 3 Opus", group: "Anthropic" },
  // Google
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", group: "Google" },
  { value: "google/gemini-flash-1.5", label: "Gemini 1.5 Flash (fast, cheap)", group: "Google" },
  { value: "google/gemini-pro-1.5", label: "Gemini 1.5 Pro", group: "Google" },
  // Meta Llama
  { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", group: "Meta Llama" },
  { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B", group: "Meta Llama" },
  { value: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B", group: "Meta Llama" },
  // Others
  { value: "mistralai/mistral-large", label: "Mistral Large", group: "Other" },
  { value: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", group: "Other" },
  { value: "x-ai/grok-2-1212", label: "Grok 2", group: "Other" },
];

// Preset agent modes the user can click; each sets the agentContext fed to every AI call.
const AGENT_MODES: { label: string; context: string }[] = [
  { label: "Sales call", context: "You're supporting the host on a sales call. Surface objections, buying signals, pricing cues, and concise responses that move the deal forward." },
  { label: "Interview", context: "Help the host interview a candidate: propose sharp follow-up questions, flag vague or evasive answers, and track competencies." },
  { label: "Standup / sync", context: "Track decisions, blockers, action items and their owners. Keep everything concise and actionable." },
  { label: "Negotiation", context: "Help the host negotiate: flag concessions, anchors, and suggested counter-offers in real time." },
  { label: "1:1 / coaching", context: "Support a thoughtful 1:1: surface listening prompts, open questions, and gentle follow-ups." },
  { label: "Discovery", context: "Help the host run product discovery: surface user pain points, jobs-to-be-done, and probing questions." },
];

// Ask the model to read the meeting and propose tailored agent modes (label + context).
async function proposeModes(ctx: string, key: string, model: string): Promise<{ label: string; context: string }[]> {
  const sys = `You are configuring a real-time meeting copilot. From the transcript, infer the meeting type and the host's likely goal. Propose up to 4 distinct "agent modes" — each a short label plus a one-sentence context instruction the copilot should adopt to best support the host. Respond ONLY as a JSON array: [{"label":"...","context":"..."}].`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    return arr.filter((x: any) => x?.label && x?.context).slice(0, 4).map((x: any) => ({ label: String(x.label), context: String(x.context) }));
  } catch { return []; }
}

// Question mode: draft what the host should say in reply to the latest turn (or "—" if none needed).
async function fetchLiveAnswer(ctx: string, key: string, context: string, model: string): Promise<string> {
  const sys = `You are a live meeting copilot helping the HOST respond.${context ? ` Context: ${context}` : ""} Look only at the most recent turns. If someone is asking the host a question or clearly expecting a response, draft a concise, natural reply (1-3 sentences) in the first person, ready to speak aloud. If no response is needed, reply with exactly "—". No preamble, no labels.`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  return raw.trim();
}

// Rich-text renderer for AI output (fixes raw ** markdown showing as stars).
function Markdown({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [statusMsg, setStatusMsg] = useState("");
  const [lines, setLines] = useState<{ speaker: string; text: string; isFinal: boolean; id: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [flags, setFlags] = useState<FeatureFlags>({
    liveTranscription: true, aiSuggestions: true, autoActions: false,
    codePalette: true, sentimentTracking: false, keyMoments: false,
    commandMode: false, meetingNotes: true,
  });
  const [showPalette, setShowPalette] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [ffKey, setFfKey] = useState(""); const [orKey, setOrKey] = useState("");
  const [useLive, setUseLive] = useState(true);
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingOption | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [meetingStatus, setMeetingStatus] = useState("");
  const [manualId, setManualId] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [agentContext, setAgentContext] = useState("");
  const [aiModel, setAiModel] = useState("deepseek/deepseek-chat");
  const [viewMode, setViewMode] = useState<"split" | "transcript" | "chat">("split");
  const [splitPct, setSplitPct] = useState(62);
  const [pulseMs, setPulseMs] = useState(12000);
  // View-only state for the suggestions feed: collapse/expand + type filter.
  const [suggExpanded, setSuggExpanded] = useState(false);
  const [suggFilter, setSuggFilter] = useState<"all" | "question" | "action" | "insight">("all");
  const [questionMode, setQuestionMode] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [proposedModes, setProposedModes] = useState<{ label: string; context: string }[]>([]);
  const [proposingModes, setProposingModes] = useState(false);
  // Backend bridge (localhost command runner / PI delegation)
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [bridgeToken, setBridgeToken] = useState("");
  const [termInput, setTermInput] = useState("");
  const [termLines, setTermLines] = useState<{ stream: "out" | "err" | "sys"; text: string }[]>([]);
  const [termRunning, setTermRunning] = useState(false);
  const [usePI, setUsePI] = useState(false);
  const [piCmd, setPiCmd] = useState("pi");
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);
  const termScrollRef = useRef<HTMLDivElement>(null);
  // Presentation-only: Active Meetings popover open/closed (no data/logic).
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  // Presentation-only: Backend Terminal · PI section open/closed.
  const [showTerminal, setShowTerminal] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null); const chatScrollRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<{ connect: () => Promise<void>; disconnect: () => void } | null>(null);
  const lastSpeakerRef = useRef(""); const lineCounter = useRef(0); const lastSuggestRef = useRef(0); const lastAnswerRef = useRef(0);

  useEffect(() => { fetch("/api/fireflies-key").then(r => r.json()).then(d => { if (d.ffKey) setFfKey(d.ffKey); if (d.orKey) setOrKey(d.orKey); if (d.bridgeToken) setBridgeToken(d.bridgeToken); }).catch(() => {}); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  useEffect(() => { chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" }); }, [chatMessages]);
  useEffect(() => { termScrollRef.current?.scrollTo({ top: termScrollRef.current.scrollHeight }); }, [termLines]);
  // Poll the local bridge so the UI can show online/offline (it only runs while the dev server is up).
  useEffect(() => {
    let alive = true;
    const ping = () => fetch("/bridge/health").then(r => r.ok).then(ok => { if (alive) setBridgeOnline(ok); }).catch(() => { if (alive) setBridgeOnline(false); });
    ping(); const id = setInterval(ping, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const loadMeetings = async () => {
    if (!ffKey) return; setLoadingMeetings(true); setMeetingStatus("");
    try {
      const { meetings: opts, raw } = await fetchMeetings(ffKey);
      setMeetings(opts);
      const a = opts.find(m => m.active);
      if (a) { setSelectedMeeting(a); setMeetingStatus(`Found ${opts.length} meetings, ${opts.filter(m=>m.active).length} active`); }
      else if (opts.length > 0) { setMeetingStatus(`${opts.length} recent meetings loaded, none active right now`); }
      else { setMeetingStatus("No meetings found. Paste your meeting ID below."); }
      // Check for API errors
      if (raw?.errors) { setMeetingStatus("API error: " + raw.errors[0]?.message); console.error(raw.errors); }
    } catch (e: any) { setMeetingStatus("Failed to load: " + (e.message || "unknown")); }
    setLoadingMeetings(false);
  };

  // Auto-fetch active meetings as soon as the key arrives (on load / refresh).
  useEffect(() => { if (ffKey && useLive) loadMeetings(); }, [ffKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time suggestions: throttled LLM pass; new items prepend to a running feed (history kept, newest first).
  useEffect(() => {
    if (!flags.aiSuggestions || !orKey || lines.length === 0 || pulseMs === 0) return;
    const now = Date.now();
    if (now - lastSuggestRef.current < pulseMs) return;
    lastSuggestRef.current = now;
    const ctx = lines.map(l => `[${l.speaker}]: ${l.text}`).join("\n");
    fetchSuggestions(ctx, orKey, agentContext, aiModel).then(fresh => {
      if (!fresh.length) return;
      setSuggestions(prev => {
        const seen = new Set(prev.slice(0, 40).map(s => s.text.toLowerCase()));
        const add = fresh.filter(s => !seen.has(s.text.toLowerCase()));
        return [...add, ...prev].slice(0, 100); // newest first, capped
      });
    }).catch(() => {});
  }, [lines, flags.aiSuggestions, orKey, agentContext, aiModel, pulseMs]);

  // Question mode: when on, live-draft what the host should say in reply to the latest turn.
  useEffect(() => {
    if (!questionMode || !orKey || lines.length === 0) return;
    const now = Date.now();
    if (now - lastAnswerRef.current < 5000) return;
    lastAnswerRef.current = now;
    const ctx = lines.slice(-12).map(l => `[${l.speaker}]: ${l.text}`).join("\n");
    fetchLiveAnswer(ctx, orKey, agentContext, aiModel).then(a => setLiveAnswer(a && a !== "—" ? a : "")).catch(() => {});
  }, [lines, questionMode, orKey, agentContext, aiModel]);

  const useManualId = () => {
    if (!manualId.trim()) return;
    setSelectedMeeting({ id: manualId.trim(), title: "Manual meeting", date: new Date().toISOString(), active: true });
    setMeetingStatus("Using manual ID: " + manualId.trim());
  };

  const onTranscriptLine = useCallback((speaker: string, text: string, isFinal: boolean, key?: string) => {
    setLines(prev => {
      // Live path: upsert by stable segment key (chunk_id) — server revises segments out of order.
      if (key != null) {
        const idx = prev.findIndex(l => l.id === key);
        if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], speaker, text, isFinal: true }; return u; }
        return [...prev, { speaker, text, isFinal: true, id: key }];
      }
      // Demo path: word-streaming with speaker continuity.
      if (speaker === lastSpeakerRef.current && prev.length > 0 && !prev[prev.length - 1].isFinal) { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], text, isFinal }; return u; }
      lastSpeakerRef.current = speaker; lineCounter.current++; return [...prev, { speaker, text, isFinal, id: `l${lineCounter.current}` }];
    });
  }, []);

  const startConnection = (m?: MeetingOption) => {
    const meeting = m ?? selectedMeeting;
    if (m) setSelectedMeeting(m);
    setLines([]); setChatMessages([]); setSuggestions([]); lastSpeakerRef.current = ""; lineCounter.current = 0;
    connRef.current = (useLive && ffKey && meeting) ? connectLive(onTranscriptLine, setStatus, ffKey, meeting.id) : connectDemo(onTranscriptLine, setStatus);
    connRef.current.connect();
  };
  const handleConnect = () => startConnection();

  // Merge consecutive same-speaker segments into one paragraph; new line only on speaker change.
  const grouped = lines.reduce<typeof lines>((acc, l) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === l.speaker) acc[acc.length - 1] = { ...last, text: `${last.text} ${l.text}`, isFinal: l.isFinal };
    else acc.push({ ...l });
    return acc;
  }, []);

  const getCtx = () => grouped.map(l => `[${l.speaker}]: ${l.text}`).join("\n");

  // Let the agent read the meeting and propose tailored modes the user can click.
  const handleProposeModes = async () => {
    if (!orKey || grouped.length === 0) return;
    setProposingModes(true);
    try { const m = await proposeModes(getCtx(), orKey, aiModel); if (m.length) setProposedModes(m); } catch {}
    setProposingModes(false);
  };

  // Drag-to-resize the split between transcript and sidebar.
  const startResize = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setSplitPct(Math.min(80, Math.max(28, (ev.clientX / window.innerWidth) * 100)));
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  // Bridge: build the command (raw shell or routed through PI), confirm, then stream output.
  const buildBridgeCmd = (input: string) => usePI ? `${piCmd} ${JSON.stringify(input)}` : input;
  const requestRun = () => { if (!termInput.trim() || termRunning) return; setPendingCmd(buildBridgeCmd(termInput.trim())); };
  const cancelPending = () => setPendingCmd(null);
  const confirmRun = async () => {
    const cmd = pendingCmd; setPendingCmd(null);
    if (!cmd) return;
    setTermInput(""); setTermRunning(true);
    setTermLines(prev => [...prev, { stream: "sys", text: `$ ${cmd}` }]);
    try {
      const res = await fetch("/bridge/run", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${bridgeToken}` }, body: JSON.stringify({ cmd }) });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() || "";
        for (const p of parts) {
          if (!p.trim()) continue;
          let m: any; try { m = JSON.parse(p); } catch { continue; }
          if (m.type === "out") setTermLines(prev => [...prev, { stream: "out", text: m.data }]);
          else if (m.type === "err") setTermLines(prev => [...prev, { stream: "err", text: m.data }]);
          else if (m.type === "exit") setTermLines(prev => [...prev, { stream: "sys", text: `[exit ${m.code}]` }]);
        }
      }
    } catch (e: any) { setTermLines(prev => [...prev, { stream: "err", text: "Bridge unreachable: " + (e?.message || "error") }]); }
    setTermRunning(false);
  };

  const handleSuggestion = async (s: Suggestion) => {
    if (!orKey) return; setAiLoading(true);
    const ctx = getCtx();
    const prompts: Record<SuggestionType, string> = {
      question: `You are a meeting coach. Based on the transcript, the user is considering asking: "${s.text}". Write what they should say — 1-2 natural sentences they can speak aloud. Don't label it.`,
      action: `You are a meeting assistant. Execute this: "${s.text}". Based on the transcript context, provide the result concisely.`,
      insight: `You spotted this in the meeting: "${s.text}". Write a brief note about why this matters and what to do about it. Keep it to 2 sentences.`,
    };
    try {
      const resp = await callAI([{ role: "system", content: `You are a meeting assistant.${agentContext ? ` ${agentContext}` : ""}` }, { role: "user", content: `Transcript:\n${ctx}\n\n${prompts[s.type]}` }], orKey, aiModel);
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]);
    } catch { setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: "AI unavailable.", timestamp: Date.now() }]); }
    setAiLoading(false);
  };

  const handleChat = async () => { if (!chatInput.trim()) return; const m: ChatMessage = { id: crypto.randomUUID(), role: "user", text: chatInput, timestamp: Date.now() }; setChatMessages(prev => [...prev, m]); setChatInput(""); if (!orKey) return; setAiLoading(true); try { const resp = await callAI([{ role: "system", content: `You are a meeting assistant. Answer concisely.${agentContext ? ` ${agentContext}` : ""}` }, { role: "user", content: `Transcript:\n${getCtx()}\n\nUser: ${m.text}` }], orKey, aiModel); setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]); } catch {} setAiLoading(false); };

  const handleAction = async (a: typeof QUICK_ACTIONS[0]) => { setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: a.label, timestamp: Date.now() }]); setShowPalette(false); if (!orKey) return; setAiLoading(true); try { const resp = await callAI([{ role: "system", content: `Execute: "${a.prompt}". Based on transcript, provide the result.${agentContext ? ` Context: ${agentContext}` : ""}` }, { role: "user", content: getCtx() }], orKey, aiModel); setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]); } catch {} setAiLoading(false); };

  const copyTx = () => { navigator.clipboard.writeText(grouped.map(l => `[${l.speaker}]: ${l.text}`).join("\n")); setCopiedId("tx"); setTimeout(() => setCopiedId(null), 2000); };

  // Export the whole session (transcript + suggestions + chat) to a Markdown file.
  const exportMarkdown = () => {
    const md = [
      `# ${selectedMeeting?.title || "Meeting"}`,
      `\n## Transcript\n`,
      grouped.map(l => `**${l.speaker}:** ${l.text}`).join("\n\n") || "_No transcript._",
      `\n## Suggestions\n`,
      suggestions.map(s => `- _${s.type}_ — ${s.text}`).join("\n") || "_None._",
      `\n## Assistant chat\n`,
      chatMessages.map(m => `**${m.role === "user" ? "You" : "AI"}:** ${m.text}`).join("\n\n") || "_None._",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `fireflies-${Date.now()}.md`; a.click(); URL.revokeObjectURL(a.href);
  };

  const cats = ["all", ...new Set(QUICK_ACTIONS.map(a => a.category))];
  const filtered = activeCategory === "all" ? QUICK_ACTIONS : QUICK_ACTIONS.filter(a => a.category === activeCategory);
  const dot = status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : status === "error" ? "bg-rose-500" : "bg-text-muted/50";
  const activeMeetings = meetings.filter(m => m.active);

  // ── Suggestions feed: pure view logic over `suggestions` ───────
  // Filter by type, then show newest ~5 by default with a show-more reveal.
  const SUGG_COLLAPSED = 5;
  const SUGG_FILTERS: { value: typeof suggFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "question", label: "Ask" },
    { value: "action", label: "Do" },
    { value: "insight", label: "Note" },
  ];
  const filteredSuggestions = suggFilter === "all" ? suggestions : suggestions.filter(s => s.type === suggFilter);
  const visibleSuggestions = suggExpanded ? filteredSuggestions : filteredSuggestions.slice(0, SUGG_COLLAPSED);
  const suggOverflow = filteredSuggestions.length - SUGG_COLLAPSED;

  // ── Question-mode "Say this" live banner ───────────────────────
  const sayThisBanner = questionMode && liveAnswer && (
    <div className="px-10 lg:px-14 pt-8">
      <div className="animate-live-glow rounded-2xl border border-accent/30 bg-accent-dim/60 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-3 px-8 pt-6 pb-2">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-accent" />
          </span>
          <span className="text-[11px] font-bold text-accent uppercase tracking-wider">Say this</span>
          <ArrowRight size={13} className="text-accent" />
          <span className="text-[11px] text-text-muted font-medium ml-auto">live suggested reply</span>
        </div>
        <div className="px-8 pb-7 pt-3 text-text-primary">
          <Markdown text={liveAnswer} />
        </div>
      </div>
    </div>
  );

  // ── Transcription column ───────────────────────────────────────
  const transcriptColumn = (
    <main className="flex flex-col min-w-0 flex-1 h-full">
      <div className="h-24 border-b border-border flex items-center justify-between px-10 lg:px-14 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <Mic size={16} className="text-accent shrink-0" />
          <span className="text-[14px] font-semibold text-text-primary tracking-tight">Live transcription</span>
          {selectedMeeting && <span className="text-[12px] text-text-muted font-medium truncate max-w-[260px] pl-4 ml-1 border-l border-border">{selectedMeeting.title || selectedMeeting.id.slice(-8)}</span>}
        </div>
        <div className="flex items-center gap-3.5 shrink-0">
          <button
            onClick={() => setQuestionMode(!questionMode)}
            data-active={questionMode}
            className={`btn btn-sm ${questionMode ? "btn-primary" : "btn-secondary"}`}
            title="Draft what to say in reply to the live conversation">
            <Sparkles size={13} /> Question mode
          </button>
          <button onClick={copyTx} title="Copy transcript" className="btn btn-ghost btn-icon shrink-0">{copiedId === "tx" ? <Check size={16} className="text-success" /> : <Copy size={16} />}</button>
          <button onClick={exportMarkdown} title="Export session as Markdown" className="btn btn-ghost btn-icon shrink-0"><Download size={16} /></button>
        </div>
      </div>
      {sayThisBanner}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 lg:px-14 py-12 space-y-3">
        {lines.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-[480px] w-full px-4">
              <div className="mx-auto mb-8 grid place-items-center w-16 h-16 rounded-3xl bg-accent-dim border border-accent/15">
                <Radio size={28} className="text-accent" />
              </div>
              <h2 className="text-[19px] font-semibold text-text-primary tracking-tight">Listen in on a live meeting</h2>
              <p className="text-[13px] text-text-muted mt-3 leading-relaxed max-w-[400px] mx-auto">
                We auto-detect your active Fireflies meetings. Pick one and hit Connect — or paste a meeting ID to jump straight in.
              </p>
              <div className="mt-10 grid gap-5 text-left">
                <div className="card-soft flex items-start gap-5 p-7">
                  <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-accent-dim text-accent"><Search size={17} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">Auto-detect active meetings</p>
                    <p className="text-[12px] text-text-muted mt-1.5 leading-relaxed">Your live sessions appear in the panel — no setup needed.</p>
                  </div>
                </div>
                <div className="card-soft flex items-start gap-5 p-7">
                  <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-accent-dim text-accent"><Plug size={17} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">Pick one &amp; hit Connect</p>
                    <p className="text-[12px] text-text-muted mt-1.5 leading-relaxed">One click streams the transcript here in real time.</p>
                  </div>
                </div>
                <div className="card-soft flex items-start gap-5 p-7">
                  <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-accent-dim text-accent"><Command size={17} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">Or paste a meeting ID</p>
                    <p className="text-[12px] text-text-muted mt-1.5 leading-relaxed">
                      Grab it from the URL <code className="font-mono text-[11px] bg-surface-2 text-text-secondary px-1.5 py-0.5 rounded border border-border">app.fireflies.ai/view/<span className="text-accent font-semibold">ID</span></code>, then Set &amp; Connect.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {grouped.map(l => (
          <div key={l.id} className="animate-fade-in group flex items-baseline gap-7 py-4 px-5 -mx-5 rounded-xl hover:bg-surface-2/60 transition-colors">
            <span className={`text-[12px] font-semibold shrink-0 w-[136px] text-right tracking-tight ${speakerColor(l.speaker)}`}>{l.speaker}</span>
            <span className="text-[15px] text-text-primary leading-relaxed">{l.text}{!l.isFinal && <span className="inline-block w-[2px] h-4 bg-accent ml-1 animate-cursor align-middle rounded-full" />}</span>
          </div>
        ))}
      </div>
    </main>
  );

  // ── Config / context panel ─────────────────────────────────────
  const configPanel = (
    <div className="border-b border-border px-8 py-9 space-y-9">
      <div className="flex items-center gap-2.5 text-[13px] font-semibold text-text-primary tracking-tight">
        <Settings2 size={15} className="text-accent" /> Agent configuration
      </div>

      {/* Agent context modes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Agent mode</label>
          <button onClick={handleProposeModes} disabled={proposingModes || grouped.length === 0}
            className="chip chip-dashed" title="Let the AI read the meeting and propose tailored modes">
            {proposingModes
              ? <><RefreshCw size={12} className="animate-spin" /> Reading…</>
              : <><Wand2 size={12} /> Suggest from meeting</>}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {AGENT_MODES.map(m => (
            <button key={m.label} onClick={() => setAgentContext(m.context)} data-active={agentContext === m.context} className="chip">
              {m.label}
            </button>
          ))}
          {proposedModes.map(m => (
            <button key={`p-${m.label}`} onClick={() => setAgentContext(m.context)} data-active={agentContext === m.context}
              className="chip" title={m.context}>
              <Sparkles size={11} /> {m.label}
            </button>
          ))}
        </div>
        <textarea value={agentContext} onChange={e => setAgentContext(e.target.value)} rows={3}
          placeholder="Or write your own: 'You're advising the host; goal is to close the deal. Flag risks and next steps.'"
          className="field px-5 py-4 leading-relaxed resize-none" />
      </div>

      {/* AI model */}
      <div className="space-y-2.5">
        <label htmlFor="ai-model" className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wider"><Cpu size={12} /> AI model (OpenRouter)</label>
        <select id="ai-model" value={aiModel} onChange={e => setAiModel(e.target.value)}
          className="field px-5 py-3 cursor-pointer h-12">
          {[...new Set(AI_MODELS.map(m => m.group))].map(g => (
            <optgroup key={g} label={g}>
              {AI_MODELS.filter(m => m.group === g).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Feature flags */}
      <div className="space-y-3">
        <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Features</span>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(flags) as (keyof FeatureFlags)[]).map(k => (
            <button key={k} onClick={() => setFlags(p => ({ ...p, [k]: !p[k] }))}
              className={`shrink-0 px-5 py-2.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${flags[k] ? "bg-accent text-white shadow-[0_2px_8px_-2px_var(--color-accent-glow)]" : "bg-surface-2 text-text-muted hover:text-text-secondary"}`}>
              {k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Backend Terminal · PI (localhost command bridge UI) ────────
  const terminalPane = (
    <div className="border-b border-border">
      <button onClick={() => setShowTerminal(v => !v)}
        className="w-full h-16 flex items-center justify-between px-7 text-[13px] font-semibold text-text-primary tracking-tight hover:bg-surface-2/60 transition-colors">
        <div className="flex items-center gap-2.5">
          <Terminal size={15} className="text-accent" /> Backend Terminal · PI
          <span className={`bridge-dot ${bridgeOnline ? "online" : "offline"}`} title={bridgeOnline ? "Bridge online" : "Bridge offline"} />
        </div>
        <span className="grid place-items-center w-7 h-7 rounded-lg text-text-muted">{showTerminal ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
      </button>

      {showTerminal && (
        <div className="px-7 pb-8 space-y-5">
          {/* Output console */}
          <div ref={termScrollRef} className="term-screen px-6 py-5 h-[240px] overflow-y-auto space-y-1.5">
            {termLines.length === 0 ? (
              <div className="term-empty term-line leading-relaxed">
                Delegate shell tasks to your machine.{"\n"}Bridge runs on 127.0.0.1.
              </div>
            ) : (
              termLines.map((l, i) => (
                <div key={i} className={`term-line ${l.stream === "err" ? "term-err" : l.stream === "sys" ? "term-sys" : "term-out"}`}>{l.text}</div>
              ))
            )}
            {termRunning && (
              <div className="term-sys term-line inline-flex items-center gap-2 pt-1">
                <RefreshCw size={12} className="animate-spin" /> running…
              </div>
            )}
          </div>

          {/* Confirmation guardrail — prominent, not a tiny link */}
          {pendingCmd && (
            <div className="confirm-bar animate-fade-in px-6 py-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Confirm command</span>
              </div>
              <pre className="font-mono text-[12.5px] text-text-primary bg-surface-1 border border-border rounded-xl px-4 py-3.5 overflow-x-auto whitespace-pre-wrap break-words">{pendingCmd}</pre>
              <div className="flex items-center gap-3">
                <button onClick={confirmRun} className="btn btn-primary btn-sm">
                  <Play size={12} /> Run
                </button>
                <button onClick={cancelPending} className="btn btn-secondary btn-sm">
                  <X size={12} /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* Input row */}
          <div className="space-y-3.5">
            <div className="field flex items-center gap-2.5 pl-4 pr-2.5 py-2.5">
              <Terminal size={15} className="text-text-muted shrink-0" />
              <input
                value={termInput}
                onChange={e => setTermInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && requestRun()}
                disabled={termRunning || !bridgeOnline}
                placeholder={usePI ? "Describe a task to delegate…" : "Type a shell command…"}
                className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none font-mono disabled:opacity-50 min-w-0" />
              <button onClick={requestRun} disabled={termRunning || !bridgeOnline} className="btn btn-primary btn-icon-sm shrink-0" title="Send command">
                <Send size={15} />
              </button>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => setUsePI(v => !v)} data-active={usePI} className="toggle-pill" title="Route the command through PI instead of running it raw">
                <span className="toggle-track"><span className="toggle-knob" /></span>
                Route through PI
              </button>
              {usePI && (
                <div className="field flex items-center gap-2 pl-3.5 pr-2.5 py-2 !w-auto">
                  <Cpu size={13} className="text-text-muted shrink-0" />
                  <input
                    value={piCmd}
                    onChange={e => setPiCmd(e.target.value)}
                    placeholder="pi"
                    className="w-20 bg-transparent text-[12.5px] text-text-primary placeholder-text-muted outline-none font-mono" />
                </div>
              )}
            </div>

            {!bridgeOnline && (
              <p className="text-[11px] text-text-muted font-medium leading-relaxed flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 shrink-0" />
                Bridge offline — start the dev server.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ── Sidebar (suggestions / palette / chat / config) ────────────
  const sidebar = (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {configPanel}

        {/* Suggestions — live news-feed, newest first, filterable + collapsible */}
        {flags.aiSuggestions && (
          <div className="border-b border-border">
            <div className="min-h-16 flex items-center justify-between px-8 py-5 gap-4">
              <div className="flex items-center text-[13px] font-semibold text-text-primary tracking-tight"><Lightbulb size={15} className="mr-2.5 text-amber-500" /> Live feed</div>
              <label className="flex items-center gap-2 cursor-pointer" title="How often the AI refreshes suggestions">
                <Gauge size={13} className="text-text-muted" />
                <select value={pulseMs} onChange={e => setPulseMs(Number(e.target.value))}
                  className="field !w-auto text-[11px] font-semibold pl-3 pr-2 py-2 cursor-pointer">
                  {PULSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>

            {/* Filter chip row */}
            <div className="flex items-center gap-3 px-8 pb-3">
              {SUGG_FILTERS.map(f => {
                const count = f.value === "all" ? suggestions.length : suggestions.filter(s => s.type === f.value).length;
                return (
                  <button key={f.value} onClick={() => setSuggFilter(f.value)} data-active={suggFilter === f.value} className="chip-filter">
                    {f.label}
                    {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
                  </button>
                );
              })}
            </div>

            {!orKey && (
              <div className="px-7 pb-1 pt-1">
                <span className="offline-note">
                  <span className="offline-note-dot" />
                  AI offline — set OPENROUTER_API
                </span>
              </div>
            )}

            <div className="px-6 pt-3 pb-7 space-y-3.5">
              {filteredSuggestions.length === 0 && (
                <p className="text-[12.5px] text-text-muted px-3 py-2.5 font-medium leading-relaxed">
                  {suggestions.length === 0
                    ? "Suggestions stream in here as the conversation evolves — newest on top. Tap one to ask the AI."
                    : "Nothing in this filter yet. Try another, or switch back to All."}
                </p>
              )}
              {visibleSuggestions.map((s, i) => {
                const st = SUGGESTION_STYLE[s.type];
                return (
                  <button key={s.id || i} onClick={() => handleSuggestion(s)} disabled={aiLoading}
                    className={`group w-full ${i === 0 ? "animate-feed-in" : ""} flex items-start gap-4 px-6 py-5 rounded-2xl border text-left transition-all disabled:opacity-40 hover:-translate-y-px active:translate-y-0 active:scale-[0.99] cursor-pointer ${st.bg} ${st.border}`}>
                    <div className="relative shrink-0 mt-0.5">
                      <st.icon size={16} className={st.icon_color} />
                      <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-surface-1 ${st.dot}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[9.5px] font-bold text-text-muted uppercase tracking-wider">{st.label}</span>
                        <span className="text-[9.5px] font-semibold text-text-muted/80 ml-auto tabular-nums">{relTime(s.ts)}</span>
                      </div>
                      <p className="text-[13px] text-text-secondary font-medium leading-snug mt-1.5">{s.text}</p>
                    </div>
                  </button>
                );
              })}

              {suggOverflow > 0 && (
                <button onClick={() => setSuggExpanded(v => !v)} className="feed-toggle mt-1">
                  {suggExpanded
                    ? <>Show less <ChevronUp size={13} /></>
                    : <>Show more ({suggOverflow}) <ChevronDown size={13} /></>}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Code Palette */}
        {flags.codePalette && (
          <div className="border-b border-border">
            <button onClick={() => setShowPalette(!showPalette)}
              className="w-full h-16 flex items-center justify-between px-7 text-[13px] font-semibold text-text-primary tracking-tight hover:bg-surface-2/60 transition-colors">
              <div className="flex items-center gap-2.5"><Command size={15} className="text-accent" /> Code Palette</div>
              <span className="grid place-items-center w-7 h-7 rounded-lg text-text-muted">{showPalette ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
            </button>
            {showPalette && (
              <div className="px-6 pb-7">
                <div className="flex gap-3 mb-5 flex-wrap">
                  {cats.map(c => <button key={c} onClick={() => setActiveCategory(c)} className={`shrink-0 px-4 py-2.5 rounded-full text-[11px] font-semibold capitalize transition-colors ${activeCategory === c ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text-secondary"}`}>{c}</button>)}
                </div>
                <div className="space-y-2">
                  {filtered.map(a => (
                    <button key={a.id} onClick={() => handleAction(a)} disabled={aiLoading}
                      className="w-full flex items-center gap-4 px-5 py-3.5 rounded-xl text-left hover:bg-surface-2 transition-colors group disabled:opacity-40">
                      <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-surface-2 text-base group-hover:bg-accent-dim transition-colors">{a.icon}</span><span className="text-[13px] text-text-secondary font-medium group-hover:text-text-primary transition-colors">{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Backend Terminal · PI */}
        {terminalPane}

        {/* AI Chat */}
        <div className="flex flex-col">
          <div className="h-16 flex items-center px-7 text-[13px] font-semibold text-text-primary tracking-tight shrink-0">
            <MessageSquare size={15} className="mr-2.5 text-accent" /> {orKey ? "AI Assistant" : "System Chat"}
            {aiLoading && <span className="ml-2.5 inline-flex items-center gap-1.5 text-accent text-[11px] font-medium"><span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />thinking</span>}
          </div>
          <div ref={chatScrollRef} className="px-7 space-y-6 pb-4">
            {chatMessages.length === 0 && <p className="text-[12.5px] text-text-muted py-2.5 px-1 font-medium leading-relaxed">{orKey ? "Tap a suggestion or quick action, or just ask anything about the meeting." : "Chat with the system."}</p>}
            {chatMessages.map(m => (
              <div key={m.id} className={`animate-fade-in flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`text-[9.5px] font-bold mb-1.5 px-1 tracking-wide uppercase text-text-muted`}>{m.role === "user" ? "You" : "AI assistant"}</div>
                {m.role === "user" ? (
                  <div className="md-invert max-w-[88%] px-6 py-4 rounded-2xl rounded-br-md bg-accent text-white shadow-[0_4px_16px_-6px_var(--color-accent-glow)]">
                    <Markdown text={m.text} />
                  </div>
                ) : (
                  <div className="max-w-[92%] px-6 py-5 rounded-2xl rounded-bl-md bg-surface-1 border border-border text-text-primary shadow-[0_2px_14px_-8px_rgba(14,21,37,0.18)]">
                    <Markdown text={m.text} />
                  </div>
                )}
              </div>
            ))}
            {aiLoading && (
              <div className="flex flex-col items-start animate-fade-in">
                <div className="text-[9.5px] font-bold mb-1.5 px-1 tracking-wide uppercase text-text-muted">AI assistant</div>
                <div className="px-6 py-5 rounded-2xl rounded-bl-md bg-surface-1 border border-border inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat composer — pinned */}
      <div className="p-6 border-t border-border shrink-0 space-y-3.5">
        {!orKey && (
          <span className="offline-note">
            <span className="offline-note-dot" />
            AI offline — set OPENROUTER_API
          </span>
        )}
        <div className="field flex gap-2.5 items-center pl-5 pr-3 py-3">
          <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleChat()}
            placeholder={orKey ? "Ask the AI anything..." : "Type a message..."}
            className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none font-medium" />
          <button onClick={handleChat} disabled={aiLoading} className="btn btn-primary btn-icon-sm shrink-0"><Send size={15} /></button>
        </div>
      </div>
    </div>
  );

  const statusLabel = status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : status === "error" ? "Error" : "Idle";

  // ── Active Meetings popover (top-right control) ────────────────
  const activeMeetingsControl = (
    <div className="relative">
      <button onClick={() => setMeetingsOpen(o => !o)}
        className={`btn btn-secondary btn-lg ${meetingsOpen ? "border-border-hover text-text-primary" : ""}`}>
        <Radio size={15} className="text-accent" /> Active meetings
        {activeMeetings.length > 0 && <span className="ml-0.5 px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-bold leading-none">{activeMeetings.length}</span>}
        <ChevronDown size={14} className={`transition-transform ${meetingsOpen ? "rotate-180" : ""}`} />
      </button>

      {meetingsOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMeetingsOpen(false)} aria-hidden />
          <div className="popover animate-pop-in absolute right-0 top-[calc(100%+12px)] z-40 w-[420px] max-w-[calc(100vw-3rem)] p-8">
            {/* header row */}
            <div className="flex items-center justify-between mb-6">
              <span className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider">Active meetings</span>
              <div className="flex items-center gap-1">
                <button onClick={loadMeetings} disabled={!ffKey || loadingMeetings} className="btn btn-ghost btn-icon-sm" title="Refresh meetings">
                  <RefreshCw size={15} className={loadingMeetings ? "animate-spin" : ""} />
                </button>
                <button onClick={() => setMeetingsOpen(false)} className="btn btn-ghost btn-icon-sm" title="Close"><X size={15} /></button>
              </div>
            </div>

            {/* list */}
            {loadingMeetings ? (
              <div className="flex items-center gap-3 text-[13px] text-text-muted font-medium px-1 py-6 justify-center">
                <RefreshCw size={15} className="animate-spin text-accent" /> Scanning…
              </div>
            ) : activeMeetings.length > 0 ? (
              <div className="space-y-3.5 max-h-[320px] overflow-y-auto -mx-1 px-1">
                {activeMeetings.map(m => {
                  const isSel = selectedMeeting?.id === m.id;
                  return (
                    <div key={m.id} className={`card-soft flex items-center gap-4 p-5 ${isSel ? "ring-2 ring-accent/40" : ""}`}>
                      <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-accent-dim text-accent">
                        <span className="relative flex w-2.5 h-2.5"><span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-60 animate-ping" /><span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-accent" /></span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{m.title || m.id.slice(-8)}</p>
                        <p className="text-[11px] text-text-muted font-medium mt-0.5">Live now</p>
                      </div>
                      <button onClick={() => { startConnection(m); setMeetingsOpen(false); }} disabled={status === "connecting" || status === "connected"} className="btn btn-primary btn-sm shrink-0">
                        <Play size={12} /> Connect
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-text-muted font-medium px-1 py-5 text-center">
                {ffKey ? "No active meetings right now. Refresh, or paste a meeting ID below." : "Add your Fireflies key to auto-detect live meetings."}
              </p>
            )}

            {/* manual ID */}
            <div className="mt-6 pt-6 border-t border-border space-y-3">
              <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Paste a meeting ID</span>
              <div className="field flex items-center gap-2.5 pl-5 pr-3 py-3">
                <input placeholder="Meeting ID…" value={manualId} onChange={e => setManualId(e.target.value)} onKeyDown={e => e.key === "Enter" && useManualId()}
                  className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none font-medium min-w-0" />
                <button onClick={useManualId} disabled={!manualId.trim()} className="btn btn-secondary btn-sm shrink-0">Set</button>
              </div>
              {selectedMeeting && (
                <button onClick={() => { handleConnect(); setMeetingsOpen(false); }} disabled={status === "connecting" || status === "connected"} className="btn btn-primary btn-sm w-full mt-1.5">
                  <Play size={12} /> Connect to “{selectedMeeting.title || selectedMeeting.id.slice(-8)}”
                </button>
              )}
            </div>
            {meetingStatus && <p className="text-[11px] text-text-muted font-medium mt-4 px-1 leading-relaxed">{meetingStatus}</p>}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col text-text-primary">
      {/* === OUTER FRAME: centered, generous horizontal padding === */}
      <div className="flex-1 flex flex-col min-h-0 w-full max-w-[1700px] mx-auto px-8 lg:px-14 xl:px-20">
        {/* === TOP BAR === */}
        <header className="h-24 flex items-center justify-between shrink-0 gap-8">
          {/* Left: brand + status pill (with inline Stop when connected) */}
          <div className="flex items-center gap-4 shrink-0 min-w-0">
            <span className="text-[18px] font-semibold tracking-tight whitespace-nowrap">Fireflies <span className="text-accent">Live</span></span>
            <div className="flex items-center gap-2.5 pl-4 pr-2 h-9 rounded-full bg-surface-1 border border-border shrink-0">
              <span className="relative flex items-center justify-center w-2.5 h-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${dot} ${status === "connected" ? "animate-pulse-glow" : ""}`} />
              </span>
              <span className="text-[12px] font-semibold text-text-secondary tracking-tight">{statusLabel}</span>
              {status === "connected" && (
                <button onClick={() => connRef.current?.disconnect()} className="btn btn-ghost btn-sm ml-0.5 !h-7 !px-2.5 text-rose-600 hover:!text-rose-600 hover:!bg-rose-500/10" title="Stop streaming">
                  <Square size={11} /> Stop
                </button>
              )}
            </div>
          </div>

          {/* Right: view switcher + Active Meetings */}
          <div className="flex items-center gap-5 shrink-0">
            <div className="segmented" role="tablist" aria-label="View mode">
              <button role="tab" aria-selected={viewMode === "transcript"} data-active={viewMode === "transcript"} onClick={() => setViewMode("transcript")} className="segmented-item"><FileText size={14} /> Transcript</button>
              <button role="tab" aria-selected={viewMode === "split"} data-active={viewMode === "split"} onClick={() => setViewMode("split")} className="segmented-item"><Columns size={14} /> Split</button>
              <button role="tab" aria-selected={viewMode === "chat"} data-active={viewMode === "chat"} onClick={() => setViewMode("chat")} className="segmented-item"><Sparkles size={14} /> Chat</button>
            </div>
            <div className="h-7 w-px bg-border" />
            {activeMeetingsControl}
          </div>
        </header>

        {/* === MAIN WORKSPACE === */}
        <div className="flex-1 flex min-h-0 pb-8 lg:pb-10">
          <div className="flex-1 flex min-h-0 rounded-3xl border border-border bg-surface-1/60 backdrop-blur-sm overflow-hidden shadow-[0_24px_60px_-32px_rgba(14,21,37,0.22)]">
            {/* Chat-only view: one centered reading column, full height */}
            {viewMode === "chat" ? (
              <div className="flex-1 flex justify-center min-h-0">
                <aside className="flex flex-col w-full max-w-3xl min-h-0 border-x border-border">
                  {sidebar}
                </aside>
              </div>
            ) : (
              <>
                <div
                  className="flex flex-col min-w-0 min-h-0"
                  style={viewMode === "split" ? { width: `${splitPct}%` } : { flex: "1 1 0%" }}>
                  {transcriptColumn}
                </div>

                {viewMode === "split" && (
                  <>
                    <div className="split-divider" onMouseDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize panels" title="Drag to resize">
                      <span className="grip" />
                    </div>
                    <aside className="flex flex-col min-w-0 min-h-0 flex-1 bg-surface-1/40">
                      {sidebar}
                    </aside>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
