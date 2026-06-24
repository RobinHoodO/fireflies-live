import { useState, useRef, useEffect, useCallback } from "react";
import { QUICK_ACTIONS } from "./data/quickActions";
import type { ChatMessage, FeatureFlags, ConnectionStatus } from "./types";
import {
  Mic, Play, Square, Send, Copy, Check, Lightbulb, Command,
  ChevronDown, ChevronUp, MessageSquare, RefreshCw, HelpCircle, Zap, Eye,
  Sparkles, Settings2, Radio, Columns, FileText, Cpu, Plug, Search,
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
    return arr.filter((x: any) => x?.text).slice(0, 3).map((x: any) => ({ text: String(x.text), type: valid.includes(x.type) ? x.type : "insight", id: crypto.randomUUID() }));
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

const AI_MODELS: { value: string; label: string }[] = [
  { value: "deepseek/deepseek-chat", label: "DeepSeek Chat (fast, cheap)" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "google/gemini-flash-1.5", label: "Gemini 1.5 Flash" },
  { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
];

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
  const scrollRef = useRef<HTMLDivElement>(null); const chatScrollRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<{ connect: () => Promise<void>; disconnect: () => void } | null>(null);
  const lastSpeakerRef = useRef(""); const lineCounter = useRef(0); const lastSuggestRef = useRef(0);

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

  // Auto-fetch active meetings as soon as the key arrives (on load / refresh).
  useEffect(() => { if (ffKey && useLive) loadMeetings(); }, [ffKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time suggestions: throttled LLM pass over the live transcript.
  useEffect(() => {
    if (!useLive || !flags.aiSuggestions || !orKey || lines.length === 0) return;
    const now = Date.now();
    if (now - lastSuggestRef.current < 12000) return;
    lastSuggestRef.current = now;
    const ctx = lines.map(l => `[${l.speaker}]: ${l.text}`).join("\n");
    fetchSuggestions(ctx, orKey, agentContext, aiModel).then(s => { if (s.length) setSuggestions(s); }).catch(() => {});
  }, [lines, flags.aiSuggestions, orKey, useLive, agentContext, aiModel]);

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

  const cats = ["all", ...new Set(QUICK_ACTIONS.map(a => a.category))];
  const filtered = activeCategory === "all" ? QUICK_ACTIONS : QUICK_ACTIONS.filter(a => a.category === activeCategory);
  const dot = status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : status === "error" ? "bg-rose-500" : "bg-text-muted/50";
  const activeMeetings = meetings.filter(m => m.active);
  const pastMeetings = meetings.filter(m => !m.active);

  const showTranscript = viewMode === "split" || viewMode === "transcript";
  const showSidebar = viewMode === "split" || viewMode === "chat";

  // ── Transcription column ───────────────────────────────────────
  const transcriptColumn = (
    <main className={`flex flex-col min-w-0 ${viewMode === "split" ? "flex-1 border-r border-border" : "flex-1"}`}>
      <div className="h-16 border-b border-border flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Mic size={16} className="text-accent shrink-0" />
          <span className="text-[14px] font-semibold text-text-primary tracking-tight">Live transcription</span>
          {selectedMeeting && <span className="text-[12px] text-text-muted font-medium truncate max-w-[260px] pl-3 ml-1 border-l border-border">{selectedMeeting.title || selectedMeeting.id.slice(-8)}</span>}
        </div>
        <button onClick={copyTx} title="Copy transcript" className="btn btn-ghost btn-icon shrink-0">{copiedId === "tx" ? <Check size={16} className="text-success" /> : <Copy size={16} />}</button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-8 space-y-1">
        {lines.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-[480px] w-full">
              <div className="mx-auto mb-7 grid place-items-center w-16 h-16 rounded-3xl bg-accent-dim border border-accent/15">
                <Radio size={28} className="text-accent" />
              </div>
              <h2 className="text-[19px] font-semibold text-text-primary tracking-tight">Listen in on a live meeting</h2>
              <p className="text-[13px] text-text-muted mt-2.5 leading-relaxed max-w-[400px] mx-auto">
                We auto-detect your active Fireflies meetings. Pick one and hit Connect — or paste a meeting ID to jump straight in.
              </p>
              <div className="mt-8 grid gap-3 text-left">
                <div className="card-soft flex items-start gap-4 p-5">
                  <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-accent-dim text-accent"><Search size={17} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">Auto-detect active meetings</p>
                    <p className="text-[12px] text-text-muted mt-1 leading-relaxed">Your live sessions appear in the panel — no setup needed.</p>
                  </div>
                </div>
                <div className="card-soft flex items-start gap-4 p-5">
                  <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-accent-dim text-accent"><Plug size={17} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">Pick one &amp; hit Connect</p>
                    <p className="text-[12px] text-text-muted mt-1 leading-relaxed">One click streams the transcript here in real time.</p>
                  </div>
                </div>
                <div className="card-soft flex items-start gap-4 p-5">
                  <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-accent-dim text-accent"><Command size={17} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">Or paste a meeting ID</p>
                    <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                      Grab it from the URL <code className="font-mono text-[11px] bg-surface-2 text-text-secondary px-1.5 py-0.5 rounded border border-border">app.fireflies.ai/view/<span className="text-accent font-semibold">ID</span></code>, then Set &amp; Connect.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {grouped.map(l => (
          <div key={l.id} className="animate-fade-in group flex items-baseline gap-5 py-2.5 px-3 -mx-3 rounded-xl hover:bg-surface-2/60 transition-colors">
            <span className={`text-[12px] font-semibold shrink-0 w-[136px] text-right tracking-tight ${speakerColor(l.speaker)}`}>{l.speaker}</span>
            <span className="text-[15px] text-text-primary leading-relaxed">{l.text}{!l.isFinal && <span className="inline-block w-[2px] h-4 bg-accent ml-1 animate-cursor align-middle rounded-full" />}</span>
          </div>
        ))}
      </div>
    </main>
  );

  // ── Config / context panel ─────────────────────────────────────
  const configPanel = (
    <div className="border-b border-border px-6 py-6 space-y-6">
      <div className="flex items-center gap-2.5 text-[13px] font-semibold text-text-primary tracking-tight">
        <Settings2 size={15} className="text-accent" /> Agent configuration
      </div>

      {/* Agent context */}
      <div className="space-y-2">
        <label htmlFor="agent-context" className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Agent context / instructions</label>
        <textarea id="agent-context" value={agentContext} onChange={e => setAgentContext(e.target.value)} rows={4}
          placeholder="e.g. You're advising the host; goal is to close the deal. Flag risks and next steps."
          className="field px-3.5 py-3 leading-relaxed resize-none" />
      </div>

      {/* AI model */}
      <div className="space-y-2">
        <label htmlFor="ai-model" className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wider"><Cpu size={12} /> AI model (OpenRouter)</label>
        <select id="ai-model" value={aiModel} onChange={e => setAiModel(e.target.value)}
          className="field px-3.5 py-2.5 cursor-pointer h-11">
          {AI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* Feature flags */}
      <div className="space-y-2.5">
        <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Features</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(flags) as (keyof FeatureFlags)[]).map(k => (
            <button key={k} onClick={() => setFlags(p => ({ ...p, [k]: !p[k] }))}
              className={`shrink-0 px-3.5 py-2 rounded-full text-[11px] font-semibold transition-all ${flags[k] ? "bg-accent text-white shadow-[0_2px_8px_-2px_var(--color-accent-glow)]" : "bg-surface-2 text-text-muted hover:text-text-secondary"}`}>
              {k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Sidebar (suggestions / palette / chat / config) ────────────
  const sidebar = (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {configPanel}

        {/* Suggestions — color-coded */}
        {flags.aiSuggestions && (
          <div className="border-b border-border">
            <div className="h-14 flex items-center px-6 text-[13px] font-semibold text-text-primary tracking-tight"><Lightbulb size={15} className="mr-2.5 text-amber-500" /> Suggestions</div>
            <div className="px-4 pb-5 space-y-2.5">
              {suggestions.length === 0 && <p className="text-[12.5px] text-text-muted px-2 py-1 font-medium leading-relaxed">Suggestions surface here as the conversation evolves. Tap one to ask the AI.</p>}
              {suggestions.map((s, i) => {
                const st = SUGGESTION_STYLE[s.type];
                return (
                  <button key={s.id || i} onClick={() => handleSuggestion(s)} disabled={aiLoading}
                    className={`group w-full animate-slide-in flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border text-left transition-all disabled:opacity-40 hover:-translate-y-px active:translate-y-0 active:scale-[0.99] ${st.bg} ${st.border}`}>
                    <div className="relative shrink-0">
                      <st.icon size={16} className={st.icon_color} />
                      <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-surface-1 ${st.dot}`} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[9.5px] font-bold text-text-muted uppercase tracking-wider">{st.label}</span>
                      <p className="text-[13px] text-text-secondary font-medium leading-snug mt-0.5">{s.text}</p>
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
              className="w-full h-14 flex items-center justify-between px-6 text-[13px] font-semibold text-text-primary tracking-tight hover:bg-surface-2/60 transition-colors">
              <div className="flex items-center gap-2.5"><Command size={15} className="text-accent" /> Code Palette</div>
              <span className="grid place-items-center w-7 h-7 rounded-lg text-text-muted">{showPalette ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
            </button>
            {showPalette && (
              <div className="px-4 pb-5">
                <div className="flex gap-2 mb-3.5 flex-wrap">
                  {cats.map(c => <button key={c} onClick={() => setActiveCategory(c)} className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold capitalize transition-colors ${activeCategory === c ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text-secondary"}`}>{c}</button>)}
                </div>
                <div className="space-y-1">
                  {filtered.map(a => (
                    <button key={a.id} onClick={() => handleAction(a)} disabled={aiLoading}
                      className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-left hover:bg-surface-2 transition-colors group disabled:opacity-40">
                      <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-surface-2 text-base group-hover:bg-accent-dim transition-colors">{a.icon}</span><span className="text-[13px] text-text-secondary font-medium group-hover:text-text-primary transition-colors">{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI Chat */}
        <div className="flex flex-col">
          <div className="h-14 flex items-center px-6 text-[13px] font-semibold text-text-primary tracking-tight shrink-0">
            <MessageSquare size={15} className="mr-2.5 text-accent" /> {orKey ? "AI Assistant" : "System Chat"}
            {aiLoading && <span className="ml-2.5 inline-flex items-center gap-1.5 text-accent text-[11px] font-medium"><span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />thinking</span>}
          </div>
          <div ref={chatScrollRef} className="px-5 space-y-3 pb-2">
            {chatMessages.length === 0 && <p className="text-[12.5px] text-text-muted py-2 px-1 font-medium leading-relaxed">{orKey ? "Tap a suggestion or quick action, or just ask anything about the meeting." : "Chat with the system."}</p>}
            {chatMessages.map(m => (
              <div key={m.id} className={`animate-fade-in px-4 py-3 rounded-2xl text-[13px] leading-relaxed ${m.role === "user" ? "bg-accent text-white ml-8 rounded-br-md" : "bg-surface-1 border border-border text-text-primary mr-8 rounded-bl-md shadow-[0_2px_12px_-6px_rgba(14,21,37,0.12)]"}`}>
                <div className={`text-[9.5px] font-bold mb-1 tracking-wide uppercase ${m.role === "user" ? "text-white/70" : "text-text-muted"}`}>{m.role === "user" ? "You" : "AI"}</div>
                <div className="whitespace-pre-wrap font-medium">{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat composer — pinned */}
      <div className="p-5 border-t border-border shrink-0">
        <div className="field flex gap-2 items-center pl-4 pr-2 py-2">
          <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleChat()}
            placeholder={orKey ? "Ask the AI anything..." : "Type a message..."}
            className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none font-medium" />
          <button onClick={handleChat} disabled={aiLoading} className="btn btn-primary btn-icon-sm shrink-0"><Send size={15} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col text-text-primary">
      {/* === TOP BAR === */}
      <header className="h-20 bg-surface-1/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-8 shrink-0 gap-6">
        {/* Left: brand + Connect/Stop */}
        <div className="flex items-center gap-5 shrink-0">
          <div className="flex items-center gap-3 pr-1">
            <span className="relative flex items-center justify-center w-2.5 h-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${dot} ${status === "connected" ? "animate-pulse-glow" : ""}`} />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Fireflies <span className="text-accent">Live</span></span>
          </div>
          <div className="h-7 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <button onClick={handleConnect} disabled={status === "connecting" || status === "connected" || (useLive && !selectedMeeting)}
              className="btn btn-primary btn-lg">
              <Play size={15} /> Connect
            </button>
            <button onClick={() => connRef.current?.disconnect()} disabled={status !== "connected"} className="btn btn-secondary btn-lg">
              <Square size={13} /> Stop
            </button>
          </div>
        </div>

        {/* Right: view switcher + live toggle */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="segmented" role="tablist" aria-label="View mode">
            <button role="tab" aria-selected={viewMode === "transcript"} data-active={viewMode === "transcript"} onClick={() => setViewMode("transcript")} className="segmented-item"><FileText size={14} /> Transcript</button>
            <button role="tab" aria-selected={viewMode === "split"} data-active={viewMode === "split"} onClick={() => setViewMode("split")} className="segmented-item"><Columns size={14} /> Split</button>
            <button role="tab" aria-selected={viewMode === "chat"} data-active={viewMode === "chat"} onClick={() => setViewMode("chat")} className="segmented-item"><Sparkles size={14} /> Chat</button>
          </div>
          <div className="h-7 w-px bg-border" />
          <label className="flex items-center gap-2 text-[12px] text-text-secondary font-medium cursor-pointer select-none">
            <input type="checkbox" checked={useLive} onChange={e => setUseLive(e.target.checked)} className="w-4 h-4 rounded border-border accent-accent cursor-pointer" />
            <Radio size={13} className={useLive ? "text-accent" : "text-text-muted"} /> Live API
          </label>
        </div>
      </header>

      {/* === SESSION BAR: active sessions + manual ID === */}
      <div className="bg-surface-1/50 border-b border-border px-8 py-5 shrink-0">
        <div className="flex items-start gap-6 flex-wrap">
          {/* Active sessions */}
          <div className="flex-1 min-w-[320px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                <Radio size={13} className="text-accent" /> Active meetings
                {activeMeetings.length > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-accent-dim text-accent text-[10px] font-bold normal-case tracking-normal">{activeMeetings.length}</span>}
              </div>
              <button onClick={loadMeetings} disabled={!ffKey || loadingMeetings} className="btn btn-ghost btn-sm" title="Refresh meetings">
                <RefreshCw size={13} className={loadingMeetings ? "animate-spin" : ""} /> Refresh
              </button>
            </div>

            {loadingMeetings ? (
              <div className="flex items-center gap-3 text-[13px] text-text-muted font-medium px-1 py-3">
                <RefreshCw size={15} className="animate-spin text-accent" /> Scanning for active meetings…
              </div>
            ) : activeMeetings.length > 0 ? (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {activeMeetings.map(m => {
                  const isSel = selectedMeeting?.id === m.id;
                  return (
                    <div key={m.id} className={`card-soft flex items-center gap-3 p-3.5 transition-colors ${isSel ? "ring-2 ring-accent/40" : ""}`}>
                      <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-accent-dim text-accent">
                        <span className="relative flex w-2.5 h-2.5"><span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-60 animate-ping" /><span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-accent" /></span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{m.title || m.id.slice(-8)}</p>
                        <p className="text-[11px] text-text-muted font-medium mt-0.5">Live now</p>
                      </div>
                      <button onClick={() => startConnection(m)} disabled={status === "connecting" || status === "connected"} className="btn btn-primary btn-sm shrink-0">
                        <Play size={12} /> Connect
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-text-muted font-medium px-1 py-3">
                {ffKey ? "No active meetings right now. Refresh, pick a recent one, or paste an ID." : "Add your Fireflies key to auto-detect live meetings."}
              </p>
            )}
            {meetingStatus && <p className="text-[11px] text-text-muted font-medium mt-2.5 px-1">{meetingStatus}</p>}
          </div>

          {/* Recent + manual ID */}
          <div className="w-[320px] shrink-0 space-y-3">
            <div className="space-y-2">
              <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Recent meetings</span>
              <select value={selectedMeeting?.id || ""} onChange={e => { const m = meetings.find(x => x.id === e.target.value); if (m) { setSelectedMeeting(m); setMeetingStatus(""); } }}
                className="field px-3.5 py-2.5 h-11 cursor-pointer truncate">
                <option value="">{meetings.length === 0 ? "Load meetings to begin" : "Select a meeting…"}</option>
                {activeMeetings.length > 0 && <optgroup label="Active now">{activeMeetings.map(m => <option key={m.id} value={m.id}>{m.title || m.id.slice(-8)}</option>)}</optgroup>}
                {pastMeetings.length > 0 && <optgroup label="Recent">{pastMeetings.slice(0, 12).map(m => <option key={m.id} value={m.id}>{new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - {m.title || m.id.slice(-8)}</option>)}</optgroup>}
              </select>
            </div>
            <div className="space-y-2">
              <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Or paste a meeting ID</span>
              <div className="field flex items-center gap-2 pl-3.5 pr-2 py-2">
                <input placeholder="Paste meeting ID" value={manualId} onChange={e => setManualId(e.target.value)} onKeyDown={e => e.key === "Enter" && useManualId()}
                  className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none font-medium min-w-0" />
                <button onClick={useManualId} disabled={!manualId.trim()} className="btn btn-secondary btn-sm shrink-0">Set</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === MAIN === */}
      <div className="flex-1 flex overflow-hidden">
        {showTranscript && transcriptColumn}
        {showSidebar && (
          <aside className={`flex flex-col shrink-0 bg-surface-1/60 min-h-0 ${viewMode === "chat" ? "flex-1 max-w-[760px] mx-auto w-full border-x border-border" : "w-[400px]"}`}>
            {sidebar}
          </aside>
        )}
      </div>
    </div>
  );
}
