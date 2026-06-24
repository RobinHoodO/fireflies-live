import { useState, useRef, useEffect, useCallback } from "react";
import { QUICK_ACTIONS } from "./data/quickActions";
import type { ChatMessage, FeatureFlags, ConnectionStatus } from "./types";
import {
  Mic, Play, Square, Send, Copy, Check, Lightbulb, Command,
  ChevronDown, ChevronUp, MessageSquare, RefreshCw, HelpCircle, Zap, Eye,
} from "lucide-react";

const SPEAKER_COLORS = [
  "text-emerald-600", "text-sky-600", "text-amber-600", "text-rose-600",
  "text-violet-600", "text-cyan-600", "text-orange-600", "text-fuchsia-600",
];

function speakerColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

type SuggestionType = "question" | "action" | "insight";

interface Suggestion {
  text: string;
  type: SuggestionType;
  id: string;
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

async function callAI(messages: { role: string; content: string }[], key: string): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5173", "X-Title": "Fireflies Live" },
    body: JSON.stringify({ model: "deepseek/deepseek-chat", messages, max_tokens: 400, temperature: 0.7 }),
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "Couldn't generate a response.";
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

function generateSuggestions(): Suggestion[] {
  const questions: string[] = ["What's the timeline for this?", "Who owns this decision?", "What are the risks?", "Can we get clarification on that?", "How does this affect the budget?", "What's the fallback plan?"];
  const actions: string[] = ["Schedule a follow-up", "Send meeting notes", "Create a task for this", "Share this with the team", "Pull relevant data", "Draft a summary"];
  const insights: string[] = ["Key decision made here", "Deadline mentioned — track this", "Potential blocker identified", "Stakeholder concern raised", "Action item: needs owner"];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const types: SuggestionType[] = ["question", "question", "action", "action", "insight"];
  const type = types[Math.floor(Math.random() * types.length)];
  if (type === "question") return [{ text: pick(questions), type: "question", id: crypto.randomUUID() }];
  if (type === "action") return [{ text: pick(actions), type: "action", id: crypto.randomUUID() }];
  return [{ text: pick(insights), type: "insight", id: crypto.randomUUID() }];
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
  const [useLive, setUseLive] = useState(false);
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingOption | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [meetingStatus, setMeetingStatus] = useState("");
  const [manualId, setManualId] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null); const chatScrollRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<{ connect: () => Promise<void>; disconnect: () => void } | null>(null);
  const lastSpeakerRef = useRef(""); const lineCounter = useRef(0);

  useEffect(() => { fetch("/api/fireflies-key").then(r => r.json()).then(d => { if (d.ffKey) setFfKey(d.ffKey); if (d.orKey) setOrKey(d.orKey); }).catch(() => {}); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  useEffect(() => { chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" }); }, [chatMessages]);

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

  const useManualId = () => {
    if (!manualId.trim()) return;
    setSelectedMeeting({ id: manualId.trim(), title: "Manual meeting", date: new Date().toISOString(), active: true });
    setMeetingStatus("Using manual ID: " + manualId.trim());
  };

  const onTranscriptLine = useCallback((speaker: string, text: string, isFinal: boolean, key?: string) => {
    let isNewSegment = false;
    setLines(prev => {
      // Live path: upsert by stable segment key (chunk_id) — server revises segments out of order.
      if (key != null) {
        const idx = prev.findIndex(l => l.id === key);
        if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], speaker, text, isFinal: true }; return u; }
        isNewSegment = true; return [...prev, { speaker, text, isFinal: true, id: key }];
      }
      // Demo path: word-streaming with speaker continuity.
      if (speaker === lastSpeakerRef.current && prev.length > 0 && !prev[prev.length - 1].isFinal) { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], text, isFinal }; return u; }
      lastSpeakerRef.current = speaker; lineCounter.current++; return [...prev, { speaker, text, isFinal, id: `l${lineCounter.current}` }];
    });
    const triggers = key != null ? isNewSegment : isFinal;
    if (triggers && flags.aiSuggestions && Math.random() > 0.55) setSuggestions(prev => [...prev.slice(-4), ...generateSuggestions()]);
  }, [flags.aiSuggestions]);

  const handleConnect = () => { setLines([]); setChatMessages([]); setSuggestions([]); lastSpeakerRef.current = ""; lineCounter.current = 0; connRef.current = (useLive && ffKey && selectedMeeting) ? connectLive(onTranscriptLine, setStatus, ffKey, selectedMeeting.id) : connectDemo(onTranscriptLine, setStatus); connRef.current.connect(); };

  const getCtx = () => lines.map(l => `[${l.speaker}]: ${l.text}`).join("\n");

  const handleSuggestion = async (s: Suggestion) => {
    if (!orKey) return; setAiLoading(true);
    const ctx = getCtx();
    const prompts: Record<SuggestionType, string> = {
      question: `You are a meeting coach. Based on the transcript, the user is considering asking: "${s.text}". Write what they should say — 1-2 natural sentences they can speak aloud. Don't label it.`,
      action: `You are a meeting assistant. Execute this: "${s.text}". Based on the transcript context, provide the result concisely.`,
      insight: `You spotted this in the meeting: "${s.text}". Write a brief note about why this matters and what to do about it. Keep it to 2 sentences.`,
    };
    try {
      const resp = await callAI([{ role: "user", content: `Transcript:\n${ctx}\n\n${prompts[s.type]}` }], orKey);
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]);
    } catch { setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: "AI unavailable.", timestamp: Date.now() }]); }
    setAiLoading(false);
  };

  const handleChat = async () => { if (!chatInput.trim()) return; const m: ChatMessage = { id: crypto.randomUUID(), role: "user", text: chatInput, timestamp: Date.now() }; setChatMessages(prev => [...prev, m]); setChatInput(""); if (!orKey) return; setAiLoading(true); try { const resp = await callAI([{ role: "system", content: "You are a meeting assistant. Answer concisely." }, { role: "user", content: `Transcript:\n${getCtx()}\n\nUser: ${m.text}` }], orKey); setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]); } catch {} setAiLoading(false); };

  const handleAction = async (a: typeof QUICK_ACTIONS[0]) => { setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: a.label, timestamp: Date.now() }]); setShowPalette(false); if (!orKey) return; setAiLoading(true); try { const resp = await callAI([{ role: "system", content: `Execute: "${a.prompt}". Based on transcript, provide the result.` }, { role: "user", content: getCtx() }], orKey); setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "agent", text: resp, timestamp: Date.now() }]); } catch {} setAiLoading(false); };

  const copyTx = () => { navigator.clipboard.writeText(lines.map(l => `[${l.speaker}]: ${l.text}`).join("\n")); setCopiedId("tx"); setTimeout(() => setCopiedId(null), 2000); };

  const cats = ["all", ...new Set(QUICK_ACTIONS.map(a => a.category))];
  const filtered = activeCategory === "all" ? QUICK_ACTIONS : QUICK_ACTIONS.filter(a => a.category === activeCategory);
  const dot = status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : status === "error" ? "bg-rose-500" : "bg-text-muted/50";
  const activeMeetings = meetings.filter(m => m.active);
  const pastMeetings = meetings.filter(m => !m.active);

  return (
    <div className="h-screen flex flex-col text-text-primary">
      {/* === TOP BAR === */}
      <header className="h-16 bg-surface-1/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-6 shrink-0 gap-5">
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex items-center gap-3 shrink-0 pr-1">
            <span className="relative flex items-center justify-center w-2.5 h-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${dot} ${status === "connected" ? "animate-pulse-glow" : ""}`} />
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight">Fireflies <span className="text-accent">Live</span></span>
            </div>
          </div>
          <div className="h-6 w-px bg-border shrink-0" />
          <div className="flex items-center gap-2">
            <button onClick={loadMeetings} disabled={!ffKey || loadingMeetings} className="grid place-items-center w-8 h-8 rounded-lg text-text-muted hover:text-accent hover:bg-accent-dim transition-colors disabled:opacity-30" title="Load meetings">
              <RefreshCw size={14} className={loadingMeetings ? "animate-spin" : ""} />
            </button>
            <select value={selectedMeeting?.id || ""} onChange={e => { const m = meetings.find(x => x.id === e.target.value); if (m) { setSelectedMeeting(m); setMeetingStatus(""); } }}
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-text-primary max-w-[220px] truncate outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent-dim transition-all font-medium cursor-pointer">
              <option value="">{meetings.length === 0 ? "Load meetings to begin" : "Select meeting..."}</option>
              {activeMeetings.length > 0 && <optgroup label="Active now">{activeMeetings.map(m => <option key={m.id} value={m.id}>{m.title || m.id.slice(-8)}</option>)}</optgroup>}
              {pastMeetings.length > 0 && <optgroup label="Recent">{pastMeetings.slice(0, 12).map(m => <option key={m.id} value={m.id}>{new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - {m.title || m.id.slice(-8)}</option>)}</optgroup>}
            </select>
            <div className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-lg pl-3 pr-1 py-1 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent-dim transition-all">
              <input
                placeholder="Paste meeting ID"
                value={manualId}
                onChange={e => setManualId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && useManualId()}
                className="bg-transparent text-[11px] text-text-primary placeholder-text-muted outline-none w-[120px] font-medium"
              />
              <button onClick={useManualId} disabled={!manualId.trim()}
                className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-surface-1 border border-border text-text-secondary hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-30 disabled:hover:text-text-secondary">
                Set
              </button>
            </div>
            {meetingStatus && <span className="text-[10px] text-text-muted font-medium truncate max-w-[200px]">{meetingStatus}</span>}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-text-secondary font-medium shrink-0 cursor-pointer select-none">
            <input type="checkbox" checked={useLive} onChange={e => setUseLive(e.target.checked)} className="w-3.5 h-3.5 rounded border-border accent-accent cursor-pointer" /> Live API
          </label>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button onClick={handleConnect} disabled={status === "connecting" || status === "connected" || (useLive && !selectedMeeting)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold shadow-[0_2px_12px_-2px_var(--color-accent-glow)] disabled:opacity-40 disabled:shadow-none hover:brightness-110 hover:-translate-y-px transition-all active:translate-y-0 active:scale-[0.98]">
            <Play size={13} /> Connect
          </button>
          <button onClick={() => connRef.current?.disconnect()} disabled={status !== "connected"}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface-1 border border-border text-text-secondary text-xs font-medium disabled:opacity-30 hover:text-text-primary hover:border-border-hover transition-colors active:scale-[0.98]">
            <Square size={12} /> Stop
          </button>
        </div>
      </header>

      {/* === MAIN === */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Transcription */}
        <main className="flex-1 flex flex-col border-r border-border min-w-0">
          <div className="h-12 border-b border-border flex items-center justify-between px-6 shrink-0">
            <div className="flex items-center gap-2.5">
              <Mic size={14} className="text-accent" />
              <span className="text-[13px] font-semibold text-text-primary tracking-tight">Live transcription</span>
              {selectedMeeting && <span className="text-[11px] text-text-muted font-medium truncate max-w-[200px] pl-2 ml-1 border-l border-border">{selectedMeeting.title || selectedMeeting.id.slice(-8)}</span>}
            </div>
            <button onClick={copyTx} title="Copy transcript" className="grid place-items-center w-8 h-8 rounded-lg text-text-muted hover:text-accent hover:bg-accent-dim transition-colors">{copiedId === "tx" ? <Check size={14} className="text-success" /> : <Copy size={14} />}</button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-0.5">
            {lines.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-[420px]">
                  <div className="mx-auto mb-5 grid place-items-center w-14 h-14 rounded-2xl bg-accent-dim border border-accent/15">
                    <Mic size={24} className="text-accent" />
                  </div>
                  <p className="text-[15px] font-semibold text-text-primary">Click <span className="text-accent">Connect</span> to {useLive && selectedMeeting ? `join "${selectedMeeting.title}"` : "start the demo"}</p>
                  <p className="text-xs text-text-muted mt-1.5 mb-5">Transcription appears here in real time as the meeting unfolds.</p>
                  <ol className="text-left text-[12px] text-text-secondary space-y-2.5 bg-surface-1 border border-border rounded-2xl p-5 shadow-[0_8px_30px_-12px_rgba(14,21,37,0.12)]">
                    <li className="flex gap-3"><span className="grid place-items-center w-5 h-5 shrink-0 rounded-full bg-accent-dim text-accent text-[10px] font-bold">1</span><span>Toggle <span className="text-accent font-semibold">Live API</span> on in the top bar.</span></li>
                    <li className="flex gap-3"><span className="grid place-items-center w-5 h-5 shrink-0 rounded-full bg-accent-dim text-accent text-[10px] font-bold">2</span><span>Hit the <RefreshCw size={11} className="inline align-middle text-accent" /> refresh icon to load your meetings.</span></li>
                    <li className="flex gap-3"><span className="grid place-items-center w-5 h-5 shrink-0 rounded-full bg-accent-dim text-accent text-[10px] font-bold">3</span><span>Not listed? Copy the ID from the Fireflies URL:<br /><code className="font-mono text-[10.5px] bg-surface-2 text-text-secondary px-1.5 py-0.5 rounded mt-1 inline-block border border-border">app.fireflies.ai/view/<span className="text-accent font-semibold">MEETING_ID</span></code></span></li>
                    <li className="flex gap-3"><span className="grid place-items-center w-5 h-5 shrink-0 rounded-full bg-accent-dim text-accent text-[10px] font-bold">4</span><span>Paste it, click <span className="text-accent font-semibold">Set</span>, then <span className="text-accent font-semibold">Connect</span>.</span></li>
                  </ol>
                </div>
              </div>
            )}
            {lines.map(l => (
              <div key={l.id} className="animate-fade-in group flex items-baseline gap-4 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-2/60 transition-colors">
                <span className={`text-[11px] font-semibold shrink-0 w-[128px] text-right tracking-tight ${speakerColor(l.speaker)}`}>{l.speaker}</span>
                <span className="text-[14px] text-text-primary leading-relaxed">{l.text}{!l.isFinal && <span className="inline-block w-[2px] h-4 bg-accent ml-1 animate-cursor align-middle rounded-full" />}</span>
              </div>
            ))}
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-[380px] flex flex-col shrink-0 bg-surface-1/60">
          {/* Toggles */}
          <div className="h-12 border-b border-border flex items-center gap-1.5 px-4 shrink-0 overflow-x-auto">
            {(Object.keys(flags) as (keyof FeatureFlags)[]).slice(0, 5).map(k => (
              <button key={k} onClick={() => setFlags(p => ({ ...p, [k]: !p[k] }))}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[10.5px] font-semibold transition-all ${flags[k] ? "bg-accent text-white shadow-[0_2px_8px_-2px_var(--color-accent-glow)]" : "bg-surface-2 text-text-muted hover:text-text-secondary"}`}>
                {k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
              </button>
            ))}
          </div>

          {/* Suggestions — color-coded */}
          {flags.aiSuggestions && (
            <div className="border-b border-border">
              <div className="h-11 flex items-center px-5 text-[13px] font-semibold text-text-primary tracking-tight"><Lightbulb size={14} className="mr-2 text-amber-500" /> Suggestions</div>
              <div className="px-3 pb-4 space-y-2 max-h-52 overflow-y-auto">
                {suggestions.length === 0 && <p className="text-[12px] text-text-muted px-2 py-1 font-medium">Suggestions surface here as the conversation evolves. Tap one to ask the AI.</p>}
                {suggestions.map((s, i) => {
                  const st = SUGGESTION_STYLE[s.type];
                  return (
                    <button key={s.id || i} onClick={() => handleSuggestion(s)} disabled={aiLoading}
                      className={`group w-full animate-slide-in flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-all disabled:opacity-40 hover:-translate-y-px active:translate-y-0 active:scale-[0.99] ${st.bg} ${st.border}`}>
                      <div className="relative shrink-0">
                        <st.icon size={15} className={st.icon_color} />
                        <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-surface-1 ${st.dot}`} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[9.5px] font-bold text-text-muted uppercase tracking-wider">{st.label}</span>
                        <p className="text-[12.5px] text-text-secondary font-medium leading-snug mt-0.5">{s.text}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Code Palette */}
          {flags.codePalette && (
            <div className="border-b border-border">
              <button onClick={() => setShowPalette(!showPalette)}
                className="w-full h-11 flex items-center justify-between px-5 text-[13px] font-semibold text-text-primary tracking-tight hover:bg-surface-2/60 transition-colors">
                <div className="flex items-center gap-2"><Command size={14} className="text-accent" /> Code Palette</div>
                <span className="grid place-items-center w-6 h-6 rounded-md text-text-muted">{showPalette ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
              </button>
              {showPalette && (
                <div className="px-3 pb-4">
                  <div className="flex gap-1.5 mb-3 overflow-x-auto">
                    {cats.map(c => <button key={c} onClick={() => setActiveCategory(c)} className={`shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-semibold capitalize transition-colors ${activeCategory === c ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text-secondary"}`}>{c}</button>)}
                  </div>
                  <div className="space-y-0.5 max-h-44 overflow-y-auto">
                    {filtered.map(a => (
                      <button key={a.id} onClick={() => handleAction(a)} disabled={aiLoading}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-surface-2 transition-colors group disabled:opacity-40">
                        <span className="grid place-items-center w-7 h-7 shrink-0 rounded-lg bg-surface-2 text-sm group-hover:bg-accent-dim transition-colors">{a.icon}</span><span className="text-[12.5px] text-text-secondary font-medium group-hover:text-text-primary transition-colors">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Chat */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-11 flex items-center px-5 text-[13px] font-semibold text-text-primary tracking-tight shrink-0">
              <MessageSquare size={14} className="mr-2 text-accent" /> {orKey ? "AI Assistant" : "System Chat"}
              {aiLoading && <span className="ml-2 inline-flex items-center gap-1.5 text-accent text-[10.5px] font-medium"><span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />thinking</span>}
            </div>
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 space-y-2.5 pb-1">
              {chatMessages.length === 0 && <p className="text-[12px] text-text-muted py-2 px-1 font-medium">{orKey ? "Tap a suggestion or quick action, or just ask anything about the meeting." : "Chat with the system."}</p>}
              {chatMessages.map(m => (
                <div key={m.id} className={`animate-fade-in px-3.5 py-2.5 rounded-2xl text-[12.5px] leading-relaxed ${m.role === "user" ? "bg-accent text-white ml-6 rounded-br-md" : "bg-surface-1 border border-border text-text-primary mr-6 rounded-bl-md shadow-[0_2px_12px_-6px_rgba(14,21,37,0.12)]"}`}>
                  <div className={`text-[9.5px] font-bold mb-1 tracking-wide uppercase ${m.role === "user" ? "text-white/70" : "text-text-muted"}`}>{m.role === "user" ? "You" : "AI"}</div>
                  <div className="whitespace-pre-wrap font-medium">{m.text}</div>
                </div>
              ))}
            </div>
            <div className="p-3.5 border-t border-border shrink-0">
              <div className="flex gap-2 items-center bg-surface-2 border border-border rounded-xl pl-3.5 pr-1.5 py-1.5 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent-dim transition-all">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleChat()}
                  placeholder={orKey ? "Ask the AI anything..." : "Type a message..."}
                  className="flex-1 bg-transparent text-[12.5px] text-text-primary placeholder-text-muted outline-none font-medium" />
                <button onClick={handleChat} disabled={aiLoading}
                  className="grid place-items-center w-8 h-8 rounded-lg bg-accent text-white shadow-[0_2px_8px_-2px_var(--color-accent-glow)] hover:brightness-110 transition-all disabled:opacity-40 active:scale-95"><Send size={14} /></button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
