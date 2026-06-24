import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage, ConnectionStatus } from "./types";
import {
  Mic, Radio, Copy, Download, Sparkles, SlidersHorizontal, Lightbulb, Gauge,
  Terminal, Plug, Search, Send, MessageSquare, ChevronDown, X, RefreshCw,
  Columns2, FileText, Check, Zap, HelpCircle, ArrowRight, Square, Play, Settings, Wand2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Helpers ───────────────────────────────────────────────────────
function speakerColor(name: string) {
  if (name === "You") return "text-accent";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 2 === 0 ? "text-speaker-a" : "text-speaker-b";
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 8) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const PULSE_OPTIONS = [
  { value: 8000, label: "Fast · 8s" },
  { value: 12000, label: "Normal · 12s" },
  { value: 20000, label: "Relaxed · 20s" },
  { value: 30000, label: "Slow · 30s" },
  { value: 0, label: "Paused" },
];

type SuggestionType = "question" | "action" | "insight";
interface Suggestion { text: string; type: SuggestionType; id: string; ts: number; }

const SUGGESTION_STYLE: Record<SuggestionType, { icon: typeof HelpCircle; label: string; color: string; tile: string; border: string }> = {
  question: { icon: HelpCircle, label: "Ask", color: "text-type-ask", tile: "bg-accent-tint text-type-ask", border: "hover:border-type-ask/50" },
  action: { icon: Zap, label: "Do", color: "text-type-do", tile: "bg-type-do/10 text-type-do", border: "hover:border-type-do/50" },
  insight: { icon: Lightbulb, label: "Note", color: "text-type-note", tile: "bg-type-note/10 text-type-note", border: "hover:border-type-note/50" },
};

const SUGG_FILTERS: { value: "all" | SuggestionType; label: string }[] = [
  { value: "all", label: "All" }, { value: "question", label: "Ask" }, { value: "action", label: "Do" }, { value: "insight", label: "Note" },
];

interface MeetingOption { id: string; title: string; date: string; active: boolean; }

async function fetchMeetings(apiKey: string): Promise<{ meetings: MeetingOption[]; raw: any }> {
  const q = `query { active_meetings { id title start_time end_time organizer_email } }`;
  const r = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const d = await r.json();
  const active: MeetingOption[] = (d?.data?.active_meetings || []).map((m: any) => ({ id: m.id, title: m.title || "Untitled", date: m.start_time ? new Date(m.start_time).toISOString() : new Date().toISOString(), active: true }));
  return { meetings: active, raw: d };
}

async function callAI(messages: { role: string; content: string }[], key: string, model = "deepseek/deepseek-chat"): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5173", "X-Title": "Fireflies Live" },
    body: JSON.stringify({ model, messages, max_tokens: 400, temperature: 0.7 }),
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "Couldn't generate a response.";
}

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
        socket = io("wss://api.fireflies.ai", { path: "/ws/realtime", transports: ["websocket"], auth: { token: `Bearer ${apiKey}`, transcriptId: meetingId } });
        socket.on("auth.failed", () => onStatus("error"));
        socket.on("connection.established", () => onStatus("connected"));
        socket.on("connection.error", () => onStatus("error"));
        socket.on("transcription.broadcast", (data: any) => {
          const p = data?.payload ?? data;
          const text = p?.text || "";
          if (!text) return;
          onLine(p.speaker_name || "Speaker", text, true, `c${p.chunk_id}`);
        });
        socket.on("disconnect", () => onStatus("disconnected"));
      } catch { onStatus("error"); }
    },
    disconnect() { if (socket) { socket.disconnect(); socket = null; } onStatus("disconnected"); },
  };
}

function connectDemo(onLine: (speaker: string, text: string, final: boolean, key?: string) => void, onStatus: (s: ConnectionStatus) => void) {
  const LINES: [string, string][] = [
    ["Maya Patel", "Thanks for hopping on. Before we dig in — the biggest thing for us right now is follow-up time. My CS team spends way too long writing post-call recaps."],
    ["You", "That's exactly what we automate. Recaps drop in your inbox within a minute of the call ending."],
    ["Maya Patel", "Good. The other pain is onboarding speed — we're scaling from 14 to 25 reps this year and ramping new hires fast is brutal."],
    ["You", "Live coaching helps there. New reps get real-time prompts during calls, so they ramp on live deals, not roleplay."],
    ["Maya Patel", "And pricing — I need something that scales with us. Not a flat number, a range with a growth ramp."],
    ["You", "Totally. Let me anchor on the time saved first, then walk you through a ramp that matches your headcount plan."],
    ["Diego Romero", "From an ops view, the integration matters too — does this sit inside our existing CRM or is it another tab?"],
    ["You", "It writes straight back into your CRM. No new tab to babysit."],
  ];
  let running = false;
  return {
    async connect() {
      running = true; onStatus("connecting"); await new Promise(r => setTimeout(r, 1300)); onStatus("connected");
      for (const [s, t] of LINES) { if (!running) break; const w = t.split(" "); for (let i = 0; i < w.length; i++) { if (!running) break; onLine(s, w.slice(0, i + 1).join(" "), i === w.length - 1); await new Promise(r => setTimeout(r, 40 + Math.random() * 55)); } await new Promise(r => setTimeout(r, 500 + Math.random() * 600)); }
    },
    disconnect() { running = false; onStatus("disconnected"); },
  };
}

const AI_MODELS: { value: string; label: string; group: string }[] = [
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", group: "Anthropic" },
  { value: "anthropic/claude-opus-4", label: "Claude Opus 4", group: "Anthropic" },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku", group: "Anthropic" },
  { value: "openai/gpt-4o", label: "GPT-4o", group: "OpenAI" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini", group: "OpenAI" },
  { value: "openai/o3", label: "o3", group: "OpenAI" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Google" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Google" },
  { value: "deepseek/deepseek-chat", label: "DeepSeek V3", group: "DeepSeek" },
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1", group: "DeepSeek" },
  { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", group: "Meta Llama" },
];
const MODEL_LABEL = (v: string) => AI_MODELS.find(m => m.value === v)?.label || v;

const AGENT_MODES: { label: string; context: string }[] = [
  { label: "Sales call", context: "You're supporting the host on a sales call. Surface objections, buying signals, pricing cues, and concise responses that move the deal forward." },
  { label: "Interview", context: "Help the host interview a candidate: propose sharp follow-up questions, flag vague or evasive answers, and track competencies." },
  { label: "Standup", context: "Track decisions, blockers, action items and their owners. Keep everything concise and actionable." },
  { label: "Negotiation", context: "Help the host negotiate: flag concessions, anchors, and suggested counter-offers in real time." },
  { label: "1:1", context: "Support a thoughtful 1:1: surface listening prompts, open questions, and gentle follow-ups." },
  { label: "Discovery", context: "Help the host run product discovery: surface user pain points, jobs-to-be-done, and probing questions." },
];

async function proposeModes(ctx: string, key: string, model: string): Promise<{ label: string; context: string }[]> {
  const sys = `You are configuring a real-time meeting copilot. From the transcript, infer the meeting type and the host's likely goal. Propose up to 4 distinct "agent modes" — each a short label plus a one-sentence context instruction. Respond ONLY as a JSON array: [{"label":"...","context":"..."}].`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    return arr.filter((x: any) => x?.label && x?.context).slice(0, 4).map((x: any) => ({ label: String(x.label), context: String(x.context) }));
  } catch { return []; }
}

async function fetchLiveAnswer(ctx: string, key: string, context: string, model: string): Promise<string> {
  const sys = `You are a live meeting copilot helping the HOST respond.${context ? ` Context: ${context}` : ""} Look only at the most recent turns. If someone is asking the host a question or clearly expecting a response, draft a concise, natural reply (1-3 sentences) in the first person, ready to speak aloud. If no response is needed, reply with exactly "—". No preamble, no labels.`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  return raw.trim();
}

function Markdown({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

const FEATURE_FLAGS = ["Auto-suggest", "Sentiment", "Action items", "Live summary", "Speaker labels", "Profanity filter"];

// ── App ───────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [lines, setLines] = useState<{ speaker: string; text: string; isFinal: boolean; id: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [flags, setFlags] = useState<Record<string, boolean>>({ "Auto-suggest": true, "Sentiment": false, "Action items": true, "Live summary": true, "Speaker labels": true, "Profanity filter": false });
  const [copiedTx, setCopiedTx] = useState(false);
  const [ffKey, setFfKey] = useState(""); const [orKey, setOrKey] = useState("");
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingOption | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [meetingStatus, setMeetingStatus] = useState("");
  const [manualId, setManualId] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [agentContext, setAgentContext] = useState("");
  const [agentMode, setAgentMode] = useState("General");
  const [aiModel, setAiModel] = useState("deepseek/deepseek-chat");
  const [viewMode, setViewMode] = useState<"split" | "transcript" | "chat">("split");
  const [splitPct, setSplitPct] = useState(60);
  const [pulseMs, setPulseMs] = useState(12000);
  const [suggExpanded, setSuggExpanded] = useState(false);
  const [suggFilter, setSuggFilter] = useState<"all" | SuggestionType>("all");
  const [questionMode, setQuestionMode] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [proposedModes, setProposedModes] = useState<{ label: string; context: string }[]>([]);
  const [proposingModes, setProposingModes] = useState(false);
  const [activeTab, setActiveTab] = useState<"feed" | "chat" | "terminal">("feed");
  const [configOpen, setConfigOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  // Bridge
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [bridgeToken, setBridgeToken] = useState("");
  const [termInput, setTermInput] = useState("");
  const [termLines, setTermLines] = useState<{ stream: "out" | "err" | "sys" | "cmd"; text: string }[]>([]);
  const [termRunning, setTermRunning] = useState(false);
  const [usePI, setUsePI] = useState(false);
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null); const chatScrollRef = useRef<HTMLDivElement>(null); const termScrollRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<{ connect: () => Promise<void>; disconnect: () => void } | null>(null);
  const lastSpeakerRef = useRef(""); const lineCounter = useRef(0); const lastSuggestRef = useRef(0); const lastAnswerRef = useRef(0);

  useEffect(() => { fetch("/api/fireflies-key").then(r => r.json()).then(d => { if (d.ffKey) setFfKey(d.ffKey); if (d.orKey) setOrKey(d.orKey); if (d.bridgeToken) setBridgeToken(d.bridgeToken); }).catch(() => {}); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  useEffect(() => { chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" }); }, [chatMessages, activeTab, viewMode]);
  useEffect(() => { termScrollRef.current?.scrollTo({ top: termScrollRef.current.scrollHeight }); }, [termLines]);
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
      if (a) { setSelectedMeeting(a); setMeetingStatus(`${opts.length} active`); }
      else { setMeetingStatus("No active meetings. Paste a meeting ID."); }
      if (raw?.errors) setMeetingStatus("API error: " + raw.errors[0]?.message);
    } catch (e: any) { setMeetingStatus("Failed to load: " + (e.message || "unknown")); }
    setLoadingMeetings(false);
  };
  useEffect(() => { if (ffKey) loadMeetings(); }, [ffKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flags["Auto-suggest"] || !orKey || lines.length === 0 || pulseMs === 0) return;
    const now = Date.now();
    if (now - lastSuggestRef.current < pulseMs) return;
    lastSuggestRef.current = now;
    const ctx = lines.map(l => `[${l.speaker}]: ${l.text}`).join("\n");
    fetchSuggestions(ctx, orKey, agentContext, aiModel).then(fresh => {
      if (!fresh.length) return;
      setSuggestions(prev => {
        const seen = new Set(prev.slice(0, 40).map(s => s.text.toLowerCase()));
        return [...fresh.filter(s => !seen.has(s.text.toLowerCase())), ...prev].slice(0, 40);
      });
    }).catch(() => {});
  }, [lines, flags, orKey, agentContext, aiModel, pulseMs]);

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
    setMeetingStatus("Using manual ID");
  };

  const onTranscriptLine = useCallback((speaker: string, text: string, isFinal: boolean, key?: string) => {
    setLines(prev => {
      if (key != null) {
        const idx = prev.findIndex(l => l.id === key);
        if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], speaker, text, isFinal: true }; return u; }
        return [...prev, { speaker, text, isFinal: true, id: key }];
      }
      if (speaker === lastSpeakerRef.current && prev.length > 0 && !prev[prev.length - 1].isFinal) { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], text, isFinal }; return u; }
      lastSpeakerRef.current = speaker; lineCounter.current++; return [...prev, { speaker, text, isFinal, id: `l${lineCounter.current}` }];
    });
  }, []);

  const startConnection = (m?: MeetingOption) => {
    const meeting = m ?? selectedMeeting;
    if (m) setSelectedMeeting(m);
    setLines([]); setChatMessages([]); setSuggestions([]); lastSpeakerRef.current = ""; lineCounter.current = 0;
    connRef.current = (ffKey && meeting) ? connectLive(onTranscriptLine, setStatus, ffKey, meeting.id) : connectDemo(onTranscriptLine, setStatus);
    connRef.current.connect();
  };
  const handleConnect = () => startConnection();
  const stop = () => connRef.current?.disconnect();

  const grouped = lines.reduce<typeof lines>((acc, l) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === l.speaker) acc[acc.length - 1] = { ...last, text: `${last.text} ${l.text}`, isFinal: l.isFinal };
    else acc.push({ ...l });
    return acc;
  }, []);
  const getCtx = () => grouped.map(l => `[${l.speaker}]: ${l.text}`).join("\n");

  const handleProposeModes = async () => {
    if (!orKey || grouped.length === 0) return;
    setProposingModes(true);
    try { const m = await proposeModes(getCtx(), orKey, aiModel); if (m.length) setProposedModes(m); } catch {}
    setProposingModes(false);
  };

  const pickMode = (label: string, context: string) => { setAgentMode(label); setAgentContext(context); };

  const startResize = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setSplitPct(Math.min(74, Math.max(34, (ev.clientX / window.innerWidth) * 100)));
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  // Bridge
  const requestRun = () => { if (!termInput.trim() || termRunning) return; setPendingCmd(termInput.trim()); };
  const cancelPending = () => setPendingCmd(null);
  const confirmRun = async () => {
    const raw = pendingCmd; setPendingCmd(null);
    if (!raw) return;
    const cmd = usePI ? `pi ${JSON.stringify(raw)}` : raw;
    setTermInput(""); setTermRunning(true);
    setTermLines(prev => [...prev, { stream: "cmd", text: `${usePI ? "pi $" : "$"} ${raw}` }]);
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
    setActiveTab("chat");
    if (!orKey) return; setAiLoading(true);
    const prompts: Record<SuggestionType, string> = {
      question: `You are a meeting coach. The user is considering asking: "${s.text}". Write what they should say — 1-2 natural sentences they can speak aloud. Don't label it.`,
      action: `Execute this: "${s.text}". Based on the transcript context, provide the result concisely.`,
      insight: `You spotted this: "${s.text}". Write a brief note about why it matters and what to do. 2 sentences.`,
    };
    setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: s.text, timestamp: Date.now() }]);
    try {
      const resp = await callAI([{ role: "system", content: `You are a meeting assistant.${agentContext ? ` ${agentContext}` : ""}` }, { role: "user", content: `Transcript:\n${getCtx()}\n\n${prompts[s.type]}` }], orKey, aiModel);
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]);
    } catch { setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: "AI unavailable.", timestamp: Date.now() }]); }
    setAiLoading(false);
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const m: ChatMessage = { id: crypto.randomUUID(), role: "user", text: chatInput, timestamp: Date.now() };
    setChatMessages(prev => [...prev, m]); setChatInput("");
    if (!orKey) return; setAiLoading(true);
    try { const resp = await callAI([{ role: "system", content: `You are a meeting assistant. Answer concisely.${agentContext ? ` ${agentContext}` : ""}` }, { role: "user", content: `Transcript:\n${getCtx()}\n\nUser: ${m.text}` }], orKey, aiModel); setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]); } catch {}
    setAiLoading(false);
  };

  const copyTx = () => { navigator.clipboard.writeText(getCtx()); setCopiedTx(true); setTimeout(() => setCopiedTx(false), 2000); };
  const exportMarkdown = () => {
    const md = [`# ${selectedMeeting?.title || "Meeting"}`, `\n## Transcript\n`, grouped.map(l => `**${l.speaker}:** ${l.text}`).join("\n\n") || "_No transcript._", `\n## Chat\n`, chatMessages.map(m => `**${m.role === "user" ? "You" : "AI"}:** ${m.text}`).join("\n\n") || "_None._"].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `fireflies-${Date.now()}.md`; a.click(); URL.revokeObjectURL(a.href);
  };

  const isConnected = status === "connected";
  const activeMeetings = meetings.filter(m => m.active);
  const statusLabel = status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : status === "error" ? "Error" : "Idle";
  const statusColor = status === "connected" ? "bg-live" : status === "connecting" ? "bg-connecting" : status === "error" ? "bg-speaker-a" : "bg-idle";
  const filteredSuggestions = suggFilter === "all" ? suggestions : suggestions.filter(s => s.type === suggFilter);
  const visibleSuggestions = suggExpanded ? filteredSuggestions : filteredSuggestions.slice(0, 4);
  const featuresOn = Object.values(flags).filter(Boolean).length;

  // ── Chat thread + composer (shared by sidebar tab and chat view) ──
  const chatThread = (compact = false) => (
    <>
      <div className="flex items-start gap-3.5">
        <span className="chat-avatar"><Sparkles size={17} /></span>
        <div className={`bubble-agent px-5 py-4 ${compact ? "max-w-[86%]" : "max-w-[80%]"}`}>
          <p className="text-[14.5px] text-ink leading-relaxed">Hi — I'm following this call live. Ask me anything, or tap a suggestion to dig in.</p>
        </div>
      </div>
      {chatMessages.map(m => m.role === "user" ? (
        <div key={m.id} className="flex justify-end">
          <div className="bubble-user md-invert px-5 py-3.5 max-w-[80%]"><Markdown text={m.text} /></div>
        </div>
      ) : (
        <div key={m.id} className="flex items-start gap-3.5">
          <span className="chat-avatar"><Sparkles size={17} /></span>
          <div className={`bubble-agent px-5 py-4 ${compact ? "max-w-[86%]" : "max-w-[80%]"}`}><Markdown text={m.text} /></div>
        </div>
      ))}
      {aiLoading && (
        <div className="flex items-start gap-3.5">
          <span className="chat-avatar"><Sparkles size={17} /></span>
          <div className="bubble-agent px-5 py-5 inline-flex items-center gap-1.5">
            <span className="dot-bounce" /><span className="dot-bounce [animation-delay:150ms]" /><span className="dot-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </>
  );

  const composer = (
    <div className="chat-composer field flex items-end gap-2.5 pl-[18px] pr-2 py-2">
      <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
        rows={1} placeholder={orKey ? "Ask the AI anything…" : "Type a message…"}
        className="flex-1 bg-transparent text-[14.5px] text-ink placeholder-muted outline-none font-medium resize-none py-2 min-w-0 max-h-28" />
      <button onClick={handleChat} disabled={aiLoading || !chatInput.trim()} className="chat-send" title="Send"><Send size={17} /></button>
    </div>
  );

  // ── Active meetings popover ───────────────────────────────────────
  const activeMeetingsControl = (
    <div className="relative">
      <button onClick={() => setMeetingsOpen(o => !o)} className={`btn btn-soft ${meetingsOpen ? "border-accent-border text-ink" : ""}`}>
        <Radio size={16} className="text-accent" /> Active meetings
        {activeMeetings.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-accent text-white text-[10px] font-bold leading-none">{activeMeetings.length}</span>}
        <ChevronDown size={14} className={`transition-transform ${meetingsOpen ? "rotate-180" : ""}`} />
      </button>
      {meetingsOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMeetingsOpen(false)} aria-hidden />
          <div className="popover anim-pop absolute right-0 top-[calc(100%+12px)] z-40 w-[380px] max-w-[calc(100vw-3rem)] p-[22px]">
            <div className="flex items-center justify-between mb-5">
              <span className="font-display text-[15px] font-bold text-ink">Active meetings</span>
              <button onClick={loadMeetings} disabled={!ffKey || loadingMeetings} className="icon-btn !w-8 !h-8"><RefreshCw size={15} className={loadingMeetings ? "animate-spin" : ""} /></button>
            </div>
            {loadingMeetings ? (
              <div className="flex items-center gap-3 text-[13px] text-muted font-medium py-6 justify-center"><RefreshCw size={15} className="animate-spin text-accent" /> Scanning…</div>
            ) : activeMeetings.length > 0 ? (
              <div className="space-y-3 max-h-[320px] overflow-y-auto">
                {activeMeetings.map(m => (
                  <div key={m.id} className="flex items-center gap-3.5 p-3.5 rounded-control border border-border-soft hover:border-accent-border hover:bg-accent-tint/40 transition-colors">
                    <span className="status-dot"><span className="live-ring" /><span className="relative w-2.5 h-2.5 rounded-full bg-live" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-ink truncate">{m.title || m.id.slice(-8)}</p>
                      <p className="text-[12.5px] text-muted font-medium mt-0.5">Live now</p>
                    </div>
                    <button onClick={() => { startConnection(m); setMeetingsOpen(false); }} disabled={isConnected || status === "connecting"} className="btn btn-accent btn-sm"><Play size={12} /> Connect</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted font-medium py-5 text-center">{ffKey ? "No active meetings right now." : "Add your Fireflies key to detect meetings."}</p>
            )}
            <div className="mt-5 pt-5 border-t border-border-soft space-y-3">
              <span className="block text-[12.5px] font-bold text-ink-2">Paste a meeting ID</span>
              <div className="field flex items-center gap-2.5 pl-4 pr-2 py-2">
                <input placeholder="app.fireflies.ai/view/…" value={manualId} onChange={e => setManualId(e.target.value)} onKeyDown={e => e.key === "Enter" && useManualId()}
                  className="flex-1 bg-transparent text-[13px] font-mono text-ink placeholder-muted outline-none min-w-0" />
                <button onClick={useManualId} disabled={!manualId.trim()} className="btn btn-soft btn-sm">Set</button>
              </div>
              {selectedMeeting && <button onClick={() => { handleConnect(); setMeetingsOpen(false); }} disabled={isConnected || status === "connecting"} className="btn btn-accent btn-sm w-full"><Play size={12} /> Connect</button>}
            </div>
            {meetingStatus && <p className="text-[11.5px] text-muted font-medium mt-3">{meetingStatus}</p>}
          </div>
        </>
      )}
    </div>
  );

  // ── Header card ───────────────────────────────────────────────────
  const header = (
    <header className="card flex items-center gap-6 px-[26px] py-[18px] shrink-0">
      <div className="flex items-center gap-5 shrink-0">
        <span className="font-display text-[21px] font-bold tracking-[-0.02em] whitespace-nowrap pl-1">Fireflies <span className="text-accent">Live</span></span>
        <div className="status-pill">
          <span className="status-dot">{isConnected && <span className="live-ring" />}<span className={`relative w-2.5 h-2.5 rounded-full ${statusColor}`} /></span>
          <span className="text-[13px] font-semibold text-ink-2">{statusLabel}</span>
        </div>
        {isConnected && <button onClick={stop} className="btn btn-sm bg-card border border-[oklch(0.9_0.02_25)] text-speaker-a hover:bg-speaker-a/5"><Square size={12} className="fill-current" /> Stop</button>}
      </div>
      <div className="flex items-center gap-3.5 shrink-0 ml-auto">
        <div className="seg" role="tablist">
          <button data-active={viewMode === "transcript"} onClick={() => setViewMode("transcript")} className="seg-item"><FileText size={14} /> Transcript</button>
          <button data-active={viewMode === "split"} onClick={() => setViewMode("split")} className="seg-item"><Columns2 size={14} /> Split</button>
          <button data-active={viewMode === "chat"} onClick={() => setViewMode("chat")} className="seg-item"><Sparkles size={14} /> Chat</button>
        </div>
        <button onClick={() => setConfigOpen(true)} className="icon-btn" title="Agent configuration"><Settings size={17} /></button>
        {activeMeetingsControl}
      </div>
    </header>
  );

  // ── Transcript card ───────────────────────────────────────────────
  const transcriptCard = (
    <div className="card flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-7 py-6 border-b border-border-soft shrink-0">
        <div className="flex items-center gap-3.5 min-w-0">
          <span className="grid place-items-center w-10 h-10 rounded-control bg-accent-tint text-accent shrink-0"><Mic size={18} /></span>
          <div className="min-w-0">
            <div className="font-display text-[17px] font-bold text-ink tracking-[-0.01em]">Live transcription</div>
            {isConnected && selectedMeeting && <div className="text-[13px] text-muted font-medium truncate">{selectedMeeting.title}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button onClick={() => setQuestionMode(q => !q)} className={`btn btn-sm ${questionMode ? "bg-accent-tint border border-accent-border text-accent-text font-bold" : "btn-soft"}`}><Sparkles size={14} /> Question mode</button>
          <button onClick={copyTx} className="icon-btn" title="Copy">{copiedTx ? <Check size={17} className="text-live" /> : <Copy size={17} />}</button>
          <button onClick={exportMarkdown} className="icon-btn" title="Export Markdown"><Download size={17} /></button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 pt-2 pb-8">
        {/* Empty state */}
        {status !== "connected" && status !== "connecting" && lines.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-[460px] py-10">
              <div className="mx-auto mb-7 relative grid place-items-center w-[74px] h-[74px] rounded-[20px] bg-accent-tint text-accent">
                <span className="absolute inset-0 rounded-[20px] live-ring opacity-30" /><Radio size={30} />
              </div>
              <h2 className="font-display text-[24px] font-bold text-ink tracking-[-0.02em]">Pick a meeting and hit Connect</h2>
              <p className="text-[14px] text-muted mt-3 leading-relaxed max-w-[400px] mx-auto">We auto-detect your active Fireflies meetings. Choose one and connect — or paste a meeting ID to jump straight in.</p>
              <div className="mt-8 grid gap-3.5 text-left">
                {[{ i: <Search size={17} />, t: "Auto-detect active meetings", d: "Your live sessions appear in the panel — no setup." }, { i: <Plug size={17} />, t: "Pick one & hit Connect", d: "One click streams the transcript here live." }, { i: <Mic size={17} />, t: "Or paste a meeting ID", d: "Grab it from the Fireflies view URL." }].map((c, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 rounded-control border border-border-soft">
                    <span className="grid place-items-center w-9 h-9 shrink-0 rounded-[10px] bg-accent-tint text-accent">{c.i}</span>
                    <div><p className="text-[13.5px] font-bold text-ink">{c.t}</p><p className="text-[12.5px] text-muted mt-1 leading-relaxed">{c.d}</p></div>
                  </div>
                ))}
              </div>
              <button onClick={() => setMeetingsOpen(true)} className="btn btn-accent mt-7"><Radio size={15} /> See active meetings</button>
            </div>
          </div>
        )}
        {status === "connecting" && lines.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-muted">
            <RefreshCw size={26} className="animate-spin text-accent" /><p className="text-[14px] font-medium">Connecting to your meeting…</p>
          </div>
        )}
        {/* Question-mode banner */}
        {questionMode && liveAnswer && (
          <div className="sticky top-0 z-10 mt-4 mb-6 p-[22px] rounded-2xl border border-accent-border bg-gradient-to-b from-accent-tint to-card shadow-[0_12px_32px_-18px_var(--color-accent)]">
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent text-white text-[11.5px] font-bold"><ArrowRight size={13} /> Say this</span>
              <span className="text-[12.5px] font-semibold text-accent-text">Drafted for you · read it aloud</span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-muted font-medium"><span className="status-dot"><span className="live-ring" /><span className="relative w-2 h-2 rounded-full bg-live" /></span> live</span>
            </div>
            <div className="text-[15px] text-ink leading-relaxed"><Markdown text={liveAnswer} /></div>
          </div>
        )}
        {/* Transcript stream */}
        {lines.length > 0 && (
          <div className="flex flex-col gap-[22px] pt-4">
            {grouped.map(l => (
              <div key={l.id}>
                <div className={`text-[12.5px] font-bold mb-1.5 ${speakerColor(l.speaker)}`}>{l.speaker}</div>
                <p className="text-[15.5px] text-[oklch(0.32_0.018_255)] leading-[1.7]">{l.text}{!l.isFinal && <span className="inline-block w-[7px] h-4 bg-accent ml-1 anim-cursor align-middle rounded-sm" />}</p>
              </div>
            ))}
            {isConnected && <div className="flex items-center gap-2 text-muted text-[12.5px] font-medium pt-1"><span className="inline-block w-[7px] h-4 bg-accent anim-cursor rounded-sm" /> Listening…</div>}
          </div>
        )}
      </div>
    </div>
  );

  // ── Sidebar (tabbed) ──────────────────────────────────────────────
  const sidebarCard = (
    <div className="card flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-[26px] gap-[26px]">
        {/* Config summary row */}
        <button onClick={() => setConfigOpen(true)} className="flex items-center gap-3.5 w-full px-[18px] py-4 rounded-[14px] bg-surface-soft border border-border text-left hover:border-accent-border transition-colors shrink-0">
          <span className="grid place-items-center w-9 h-9 shrink-0 rounded-[10px] bg-accent-tint text-accent"><SlidersHorizontal size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-ink truncate">{agentMode}</div>
            <div className="text-[12px] text-muted font-medium truncate">{MODEL_LABEL(aiModel)} · {featuresOn} features on</div>
          </div>
          <span className="text-[12.5px] font-bold text-accent-text shrink-0">Configure</span>
        </button>

        {/* Tab strip */}
        <div className="seg shrink-0">
          <button data-active={activeTab === "feed"} onClick={() => setActiveTab("feed")} className="seg-item flex-1"><Lightbulb size={14} /> Live feed</button>
          <button data-active={activeTab === "chat"} onClick={() => setActiveTab("chat")} className="seg-item flex-1"><MessageSquare size={14} /> Chat</button>
          <button data-active={activeTab === "terminal"} onClick={() => setActiveTab("terminal")} className="seg-item flex-1"><Terminal size={14} /> Terminal</button>
        </div>

        {/* Tab A — Live feed */}
        {activeTab === "feed" && (
          <div className="flex flex-col gap-[22px] min-h-0">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Gauge size={15} className="text-muted" /> Pulse rate</span>
              <select value={pulseMs} onChange={e => setPulseMs(Number(e.target.value))} className="field !w-auto text-[13px] font-semibold py-2 pl-3.5">
                {PULSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {SUGG_FILTERS.map(f => {
                const count = f.value === "all" ? suggestions.length : suggestions.filter(s => s.type === f.value).length;
                return <button key={f.value} data-active={suggFilter === f.value} onClick={() => { setSuggFilter(f.value); setSuggExpanded(false); }} className="chip"> {f.label}{f.value !== "all" && count > 0 && <span className="tabular-nums opacity-70">{count}</span>}</button>;
              })}
            </div>
            {!orKey && <span className="inline-flex items-center gap-2 text-[11.5px] font-semibold text-muted"><span className="w-1.5 h-1.5 rounded-full bg-connecting" /> AI offline — set OPENROUTER_API</span>}
            <div className="flex flex-col gap-3">
              {filteredSuggestions.length === 0 && <p className="text-[13px] text-muted font-medium leading-relaxed">{suggestions.length === 0 ? "Suggestions stream in here as the conversation evolves — newest on top. Tap one to ask the AI." : "Nothing in this filter yet."}</p>}
              {visibleSuggestions.map(s => {
                const st = SUGGESTION_STYLE[s.type];
                return (
                  <button key={s.id} onClick={() => handleSuggestion(s)} disabled={aiLoading} className={`group flex items-start gap-3.5 p-[18px] rounded-[14px] border border-border-soft text-left transition-all hover:shadow-card disabled:opacity-50 ${st.border}`}>
                    <span className={`grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[10px] ${st.tile}`}><st.icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5"><span className={`text-[10px] font-bold uppercase tracking-wider ${st.color}`}>{st.label}</span><span className="text-[10px] font-semibold text-muted ml-auto tabular-nums">{relTime(s.ts)}</span></div>
                      <p className="text-[14px] text-ink-2 font-medium leading-[1.55] mt-1.5">{s.text}</p>
                    </div>
                  </button>
                );
              })}
              {filteredSuggestions.length > 4 && (
                <button onClick={() => setSuggExpanded(v => !v)} className="btn btn-soft btn-sm w-full">{suggExpanded ? "Show less" : `Show ${filteredSuggestions.length - 4} more`}</button>
              )}
            </div>
          </div>
        )}

        {/* Tab B — Chat */}
        {activeTab === "chat" && (
          <div className="flex flex-col gap-5 min-h-0">
            <div ref={chatScrollRef} className="flex flex-col gap-5 overflow-y-auto -mr-1 pr-1">{chatThread(true)}</div>
            {composer}
          </div>
        )}

        {/* Tab C — Terminal */}
        {activeTab === "terminal" && (
          <div className="flex flex-col gap-4 min-h-0">
            <div className="flex items-center gap-2.5"><span className={`status-dot`}>{bridgeOnline && <span className="live-ring" />}<span className={`relative w-2.5 h-2.5 rounded-full ${bridgeOnline ? "bg-live" : "bg-idle"}`} /></span><span className="text-[13px] font-semibold text-ink-2">{bridgeOnline ? "PI online" : "PI offline"}</span></div>
            <div ref={termScrollRef} className="term-screen">
              {termLines.length === 0 ? <div className="term-sys term-line">Delegate shell tasks to your machine.{"\n"}Bridge runs on 127.0.0.1.</div> : termLines.map((l, i) => <div key={i} className={`term-line term-${l.stream}`}>{l.text}</div>)}
              {termRunning && <div className="term-sys term-line inline-flex items-center gap-2 pt-1"><RefreshCw size={12} className="animate-spin" /> running…</div>}
            </div>
            {pendingCmd && (
              <div className="confirm-bar p-[18px] space-y-3">
                <p className="text-[13px] font-bold text-[oklch(0.45_0.12_70)]">Run this on your machine?</p>
                <pre className="font-mono text-[12.5px] text-ink bg-card border border-border rounded-[10px] px-3.5 py-3 overflow-x-auto whitespace-pre-wrap break-words">{usePI ? `pi $ ${pendingCmd}` : `$ ${pendingCmd}`}</pre>
                <div className="flex items-center gap-3"><button onClick={confirmRun} className="btn btn-accent btn-sm"><Play size={12} /> Run command</button><button onClick={cancelPending} className="btn btn-soft btn-sm"><X size={12} /> Cancel</button></div>
              </div>
            )}
            <div className="field flex items-center gap-2.5 pl-4 pr-2 py-2">
              <Terminal size={15} className="text-muted shrink-0" />
              <input value={termInput} onChange={e => setTermInput(e.target.value)} onKeyDown={e => e.key === "Enter" && requestRun()} disabled={termRunning || !bridgeOnline} placeholder={usePI ? "Describe a task to delegate…" : "Type a shell command…"}
                className="flex-1 bg-transparent text-[13px] font-mono text-ink placeholder-muted outline-none disabled:opacity-50 min-w-0" />
              <button onClick={requestRun} disabled={termRunning || !bridgeOnline} className="chat-send !w-[38px] !h-[38px]" title="Send"><Send size={15} /></button>
            </div>
            <button onClick={() => setUsePI(v => !v)} className="flex items-center gap-3 w-full px-4 py-3 rounded-control bg-surface-soft border border-border text-left">
              <Plug size={15} className="text-muted shrink-0" /><span className="text-[13px] font-semibold text-ink-2 flex-1">Route through PI</span>
              <span className="switch" data-on={usePI}><span className="knob" /></span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ── Chat view (centered 820px column) ─────────────────────────────
  const chatView = (
    <div className="card flex-1 flex justify-center min-h-0 overflow-hidden">
      <div className="flex flex-col w-full max-w-[820px] min-h-0 px-7">
        <div className="flex items-center gap-4 pt-9 pb-7 shrink-0">
          <span className="chat-avatar !w-11 !h-11 !rounded-2xl"><Sparkles size={20} /></span>
          <div><h2 className="font-display text-[18px] font-bold text-ink tracking-[-0.01em] leading-none">AI assistant</h2><p className="text-[13px] text-muted font-medium mt-2">Ask anything about this meeting{!orKey && " · AI offline"}</p></div>
        </div>
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto pb-7 flex flex-col gap-6">{chatThread(false)}</div>
        <div className="pt-2 pb-9 shrink-0">{composer}</div>
      </div>
    </div>
  );

  // ── Config slide-over ─────────────────────────────────────────────
  const slideOver = configOpen && (
    <>
      <div className="slideover-backdrop" onClick={() => setConfigOpen(false)} aria-hidden />
      <div className="slideover anim-slideover">
        <div className="flex items-center justify-between px-[30px] py-5 border-b border-border-soft bg-[oklch(0.99_0.003_250)]/90 backdrop-blur sticky top-0">
          <span className="inline-flex items-center gap-2.5 font-display text-[16px] font-bold text-ink"><SlidersHorizontal size={17} className="text-accent" /> Agent configuration</span>
          <button onClick={() => setConfigOpen(false)} className="icon-btn !w-9 !h-9"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-[30px] flex flex-col gap-[34px]">
          {/* Agent mode */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15.5px] font-bold text-ink">Agent mode</h3>
              <button onClick={handleProposeModes} disabled={proposingModes || grouped.length === 0} className="chip chip-dashed">{proposingModes ? <><RefreshCw size={13} className="animate-spin" /> Reading…</> : <><Wand2 size={13} /> Suggest from meeting</>}</button>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {AGENT_MODES.map(m => <button key={m.label} data-active={agentMode === m.label} onClick={() => pickMode(m.label, m.context)} className="chip chip-mode">{m.label}</button>)}
              {proposedModes.map(m => <button key={`p-${m.label}`} data-active={agentMode === m.label} onClick={() => pickMode(m.label, m.context)} className="chip chip-mode" title={m.context}><Sparkles size={12} /> {m.label}</button>)}
            </div>
            <textarea value={agentContext} onChange={e => setAgentContext(e.target.value)} rows={3} placeholder="Or write a custom context: 'You're advising the host; goal is to close the deal.'" className="field px-4 py-3.5 leading-relaxed resize-none" />
          </section>
          <div className="border-t border-border-soft" />
          {/* AI model */}
          <section className="flex flex-col gap-4">
            <div><h3 className="text-[15.5px] font-bold text-ink">AI model</h3><p className="text-[12.5px] text-muted font-medium mt-1">Routed through OpenRouter</p></div>
            {[...new Set(AI_MODELS.map(m => m.group))].map(g => (
              <div key={g} className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{g}</span>
                <div className="flex flex-col gap-2">
                  {AI_MODELS.filter(m => m.group === g).map(m => (
                    <button key={m.value} onClick={() => setAiModel(m.value)} className={`flex items-center justify-between px-4 py-3 rounded-control border text-left transition-colors ${aiModel === m.value ? "bg-accent-tint border-accent-border text-accent-text" : "border-border-soft hover:border-accent-border"}`}>
                      <span className="text-[13.5px] font-semibold">{m.label}</span>{aiModel === m.value && <Check size={16} className="text-accent" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <div className="border-t border-border-soft" />
          {/* Features */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[15.5px] font-bold text-ink">Features</h3>
            {FEATURE_FLAGS.map(k => (
              <button key={k} onClick={() => setFlags(p => ({ ...p, [k]: !p[k] }))} className="flex items-center gap-3 w-full px-4 py-3 rounded-control border border-border-soft text-left">
                <span className="text-[13.5px] font-semibold text-ink-2 flex-1">{k}</span><span className="switch" data-on={!!flags[k]}><span className="knob" /></span>
              </button>
            ))}
          </section>
        </div>
      </div>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="h-screen p-7 flex justify-center">
      <div className="w-full max-w-[1660px] h-full flex flex-col gap-[18px] min-h-0">
        {header}
        <div className="flex-1 flex gap-[18px] min-h-0">
          {viewMode === "chat" ? chatView : (
            <>
              <div className="flex min-w-0 min-h-0" style={viewMode === "split" ? { flexBasis: `${splitPct}%`, flexGrow: 0, flexShrink: 0 } : { flex: "1 1 0%" }}>{transcriptCard}</div>
              {viewMode === "split" && (
                <>
                  <div className="split-divider" onMouseDown={startResize} role="separator" title="Drag to resize"><span className="grip" /></div>
                  <div className="flex-1 flex min-w-0 min-h-0">{sidebarCard}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {slideOver}
    </div>
  );
}
