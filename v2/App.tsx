// Fireflies Live — v2 interface, Phase 2 (wired).
// The design/markup is the Phase 1 port of the handoff (docs/design), unchanged.
// The mock data and local handlers are replaced with the real backend: Fireflies
// meetings + live socket (demo fallback), OpenRouter suggestions/chat/answers, and
// the localhost command bridge. See ./backend and v2/vite.config.ts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { Icon, IconSprite } from "./icons";
import { mdToHtml } from "./md";
import {
  C, MODES, MODELS, MODEL_IDS, FLAGS, VIEWS, TABS, FILTERS, SUGMETA,
  RATES, EMPTY_STEPS,
  segBtn, tabBtn, modeChip, filterChip, countBadge, modelRow, track, knob, qBtnStyle, rel,
  type Suggestion, type Message,
} from "./data";
import {
  fetchKeys, fetchMeetings, callAI, fetchSuggestions, streamLiveAnswer, streamPI, proposeModes,
  connectLive, connectDemo, MODE_CONTEXT, type Meeting, type ConnStatus,
} from "./backend";

// Persisted UI config — survives reloads / new sessions (localStorage).
const SAVED: any = (() => { try { return JSON.parse(localStorage.getItem("fl-config") || "{}"); } catch { return {}; } })();
const SESSION: any = (() => { try { const s = JSON.parse(localStorage.getItem("fl-session") || "{}"); return s && typeof s === "object" ? s : {}; } catch { return {}; } })();

const BORDER = "oklch(0.91 0.006 255)";
const CARD_SHADOW = "0 1px 2px rgba(16,24,40,.04),0 12px 32px -24px rgba(16,24,40,.22)";
const cardBase: CSSProperties = { display: "flex", flexDirection: "column", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: "hidden" };
const iconBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, border: `1px solid ${BORDER}`, borderRadius: 11, background: "#fff", color: "oklch(0.45 0.02 255)", cursor: "pointer" };

const GREETING_CHAT: Message = { id: 0, role: "agent", text: "Hi — I'm following this call live. Ask me anything about it, or tap an Ask / Do / Note suggestion." };
const GREETING_PI: Message = { id: 0, role: "agent", text: "● **PI session ready** — read · bash · edit · write tools loaded. Message me, or tap a Command suggestion and it runs right here." };

type Line = { speaker: string; text: string; isFinal: boolean; id: string };

function useStickToBottom() {
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const onScroll = useCallback(() => { const el = ref.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80; }, []);
  const stick = useCallback(() => { const el = ref.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, []);
  return { ref, onScroll, stick };
}

function speakerColor(name: string) {
  if (name === "You") return C.text;
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 2 === 0 ? "oklch(0.55 0.16 25)" : "oklch(0.5 0.14 155)";
}

export default function App() {
  const [view, setView] = useState<"transcript" | "split" | "chat">(SAVED.view ?? "split");
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [splitRatio, setSplitRatio] = useState(0.6);
  const [questionMode, setQuestionMode] = useState<boolean>(SAVED.questionMode ?? false);
  const [answering, setAnswering] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [meetingsOpenIdle, setMeetingsOpenIdle] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [tab, setTab] = useState<"feed" | "chat" | "pi">("feed");
  const [filter, setFilter] = useState("all");
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [mode, setMode] = useState<string>(SAVED.mode ?? "");
  const [model, setModel] = useState<string>(() => MODEL_IDS.includes(SAVED.model) ? SAVED.model : "anthropic/claude-sonnet-5");
  const [flags, setFlags] = useState<Record<string, boolean>>(SAVED.flags ?? { autosuggest: true, sentiment: true, actions: true, summary: false, speakers: true, profanity: false });
  const [suggested, setSuggested] = useState<{ id: string; l: string; context: string }[]>([]);
  const [proposing, setProposing] = useState(false);
  const [customContext, setCustomContext] = useState<string>(SAVED.customContext ?? "");
  const [rate, setRate] = useState<string>(SAVED.rate ?? "12s");
  const [pasteId, setPasteId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [piInput, setPiInput] = useState("");
  const [piThinking, setPiThinking] = useState(false);
  const [, force] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => Array.isArray(SESSION.suggestions) ? SESSION.suggestions.filter((s: any) => s && typeof s.text === "string" && typeof s.type === "string").slice(0, 40) : []);
  const [messages, setMessages] = useState<Message[]>(() => { const saved = Array.isArray(SESSION.messages) ? SESSION.messages.filter((m: any) => m && typeof m.text === "string" && (m.role === "user" || m.role === "agent")) : []; return saved.length > 1 ? saved : [GREETING_CHAT]; });
  const [piMessages, setPiMessages] = useState<Message[]>(() => { const saved = Array.isArray(SESSION.piMessages) ? SESSION.piMessages.filter((m: any) => m && typeof m.text === "string" && (m.role === "user" || m.role === "agent")) : []; return saved.length > 1 ? saved : [GREETING_PI]; });

  // backend state
  const [ffKey, setFfKey] = useState(""); const [orKey, setOrKey] = useState(""); const [bridgeToken, setBridgeToken] = useState("");
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(() => SESSION.selectedMeeting && typeof SESSION.selectedMeeting === "object" && typeof SESSION.selectedMeeting.id === "string" ? SESSION.selectedMeeting : null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [meetingsError, setMeetingsError] = useState("");
  const [lines, setLines] = useState<Line[]>(() => Array.isArray(SESSION.lines) ? SESSION.lines.filter((l: any) => l && typeof l.speaker === "string" && typeof l.text === "string" && typeof l.id === "string").slice(-500) : []);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [copied, setCopied] = useState(false);

  const splitElRef = useRef<HTMLDivElement>(null);
  const chatComposerRef = useRef<HTMLTextAreaElement>(null);
  const connRef = useRef<{ connect: () => Promise<void>; disconnect: () => void } | null>(null);
  const lastSpeakerRef = useRef(""); const lineCounter = useRef(0); const lastSuggestRef = useRef(0); const lastAnswerRef = useRef(0);
  const suggestionsRef = useRef<Suggestion[]>([]); suggestionsRef.current = suggestions;
  const answerSeqRef = useRef(0);
  const liveAnswerRef = useRef(""); const sidRef = useRef(1);
  const sessionSnapRef = useRef({ lines: [] as Line[], suggestions: [] as Suggestion[], messages: [] as Message[], piMessages: [] as Message[], selectedMeeting: null as Meeting | null });
  // Stable PI session id — reused across reloads so PI keeps conversation context.
  const piSessionRef = useRef<string>(SAVED.piSession || ("fl-" + Math.random().toString(36).slice(2, 10)));

  // Persist config so it's consistent across sessions.
  useEffect(() => {
    try { localStorage.setItem("fl-config", JSON.stringify({ view, mode, model, flags, rate, questionMode, customContext, piSession: piSessionRef.current })); } catch { /* storage unavailable */ }
  }, [view, mode, model, flags, rate, questionMode, customContext]);

  useEffect(() => {
    const snapshot = { lines: lines.slice(-500), suggestions: suggestions.slice(0, 40), messages, piMessages, selectedMeeting };
    sessionSnapRef.current = snapshot;
    const id = window.setTimeout(() => {
      try { localStorage.setItem("fl-session", JSON.stringify(snapshot)); } catch { /* storage unavailable */ }
    }, 1000);
    return () => window.clearTimeout(id);
  }, [lines, suggestions, messages, piMessages, selectedMeeting]);
  useEffect(() => {
    const flushSession = () => { try { localStorage.setItem("fl-session", JSON.stringify(sessionSnapRef.current)); } catch { /* storage unavailable */ } };
    window.addEventListener("pagehide", flushSession);
    return () => window.removeEventListener("pagehide", flushSession);
  }, []);

  // derived context for the AI: selected mode + any custom note
  const modeCtx = MODE_CONTEXT[mode] ?? suggested.find(s => s.id === mode)?.context ?? "";
  const agentContext = [modeCtx, customContext.trim()].filter(Boolean).join(" ");

  const setStatusMapped = (s: ConnStatus) => setStatus(s === "connected" ? "connected" : s === "connecting" ? "connecting" : "idle");

  const grouped = lines.reduce<Line[]>((acc, l) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === l.speaker) acc[acc.length - 1] = { ...last, text: `${last.text} ${l.text}`, isFinal: l.isFinal };
    else acc.push({ ...l });
    return acc;
  }, []);
  const getCtx = () => grouped.map(l => `[${l.speaker}]: ${l.text}`).join("\n");
  const { ref: transcriptScrollRef, onScroll: onTranscriptScroll, stick: stickTranscript } = useStickToBottom();
  const { ref: chatPanelScrollRef, onScroll: onChatPanelScroll, stick: stickChatPanel } = useStickToBottom();
  const { ref: piPanelScrollRef, onScroll: onPiPanelScroll, stick: stickPiPanel } = useStickToBottom();
  const { ref: chatViewScrollRef, onScroll: onChatViewScroll, stick: stickChatView } = useStickToBottom();

  useLayoutEffect(() => { stickTranscript(); }, [lines, liveAnswer, stickTranscript]);
  useLayoutEffect(() => { stickChatPanel(); }, [messages, thinking, stickChatPanel]);
  useLayoutEffect(() => { stickPiPanel(); }, [piMessages, piThinking, stickPiPanel]);
  useLayoutEffect(() => { stickChatView(); }, [messages, thinking, stickChatView]);

  // ── boot: keys, meetings, bridge health ──────────────────────────
  useEffect(() => { fetchKeys().then(k => { setFfKey(k.ffKey); setOrKey(k.orKey); setBridgeToken(k.bridgeToken); }); }, []);
  const loadMeetings = useCallback(async () => {
    if (!ffKey) return; setLoadingMeetings(true); setMeetingsError("");
    const { meetings: ms, error } = await fetchMeetings(ffKey);
    setMeetings(ms); setMeetingsError(error); const a = ms.find(m => m.active); if (a) setSelectedMeeting(a);
    setLoadingMeetings(false);
  }, [ffKey]);
  useEffect(() => { if (ffKey) loadMeetings(); }, [ffKey, loadMeetings]);
  useEffect(() => {
    let alive = true;
    const ping = () => fetch("/bridge/health").then(r => r.ok).then(ok => { if (alive) setBridgeOnline(ok); }).catch(() => { if (alive) setBridgeOnline(false); });
    ping(); const id = setInterval(ping, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 5000); return () => clearInterval(id); }, []);

  // ── live suggestion pulse ────────────────────────────────────────
  const rateSecs = rate === "off" ? 0 : parseInt(rate, 10);
  useEffect(() => {
    if (!flags.autosuggest || !orKey || lines.length === 0 || !rateSecs || status !== "connected") return;
    const now = Date.now();
    if (now - lastSuggestRef.current < rateSecs * 1000) return;
    lastSuggestRef.current = now;
    const ctx = lines.map(l => `[${l.speaker}]: ${l.text}`).join("\n");
    const existing = suggestionsRef.current.slice(0, 10).map(s => ({ id: s.id, type: s.type as any, text: s.text }));
    fetchSuggestions(ctx, orKey, agentContext, model, existing).then(items => {
      if (!items.length) return;
      setSuggestions(prev => {
        const next = [...prev];
        for (const it of items) {
          if (it.id != null) {
            const idx = next.findIndex(s => s.id === it.id);
            if (idx >= 0) { next[idx] = { ...next[idx], type: it.type, text: it.text, t: Date.now() }; continue; } // refine in place
          }
          if (next.some(s => s.text.toLowerCase() === it.text.toLowerCase())) continue; // skip exact dupe
          next.unshift({ id: sidRef.current++, type: it.type, text: it.text, t: Date.now() }); // genuinely new
        }
        return next.slice(0, 40);
      });
    }).catch(() => {});
  }, [lines, flags, orKey, agentContext, model, rateSecs, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── question-mode live answer ────────────────────────────────────
  useEffect(() => {
    if (!questionMode || !orKey || lines.length === 0) { answerSeqRef.current++; setAnswering(false); return; }
    const now = Date.now();
    if (now - lastAnswerRef.current < 5000) return;
    lastAnswerRef.current = now;
    const ctx = lines.slice(-12).map(l => `[${l.speaker}]: ${l.text}`).join("\n");
    const prev = liveAnswerRef.current;
    const seq = ++answerSeqRef.current;
    setAnswering(true);
    streamLiveAnswer(ctx, orKey, agentContext, model, partial => {
      if (seq !== answerSeqRef.current) return;
      const p = partial.trim();
      if (p && p !== "—") setLiveAnswer(p); // show it being formulated live
    }).then(final => {
      if (seq !== answerSeqRef.current) return;
      const f = (final || "").trim();
      if (!f || f === "—") setLiveAnswer(prev); // nothing to say right now — keep the last draft, don't vanish
      else { setLiveAnswer(f); liveAnswerRef.current = f; }
      setAnswering(false);
    }).catch(() => { if (seq === answerSeqRef.current) setAnswering(false); });
  }, [lines, questionMode, orKey, agentContext, model]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── transcript ingest ────────────────────────────────────────────
  const onTranscriptLine = (speaker: string, text: string, isFinal: boolean, key?: string) => {
    setLines(prev => {
      if (key != null) {
        const idx = prev.findIndex(l => l.id === key);
        if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], speaker, text, isFinal: true }; return u; }
        return [...prev, { speaker, text, isFinal: true, id: key }];
      }
      if (speaker === lastSpeakerRef.current && prev.length > 0 && !prev[prev.length - 1].isFinal) { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], text, isFinal }; return u; }
      lastSpeakerRef.current = speaker; lineCounter.current++; return [...prev, { speaker, text, isFinal, id: `l${lineCounter.current}` }];
    });
  };

  const startConnection = (m?: Meeting) => {
    connRef.current?.disconnect();
    const meeting = m ?? selectedMeeting;
    if (m) setSelectedMeeting(m);
    setLines([]); setSuggestions([]); setLiveAnswer(""); liveAnswerRef.current = ""; lastSpeakerRef.current = ""; lineCounter.current = 0;
    try { localStorage.removeItem("fl-session"); } catch { /* storage unavailable */ }
    connRef.current = (ffKey && meeting) ? connectLive(onTranscriptLine, setStatusMapped, ffKey, meeting.id) : connectDemo(onTranscriptLine, setStatusMapped);
    connRef.current.connect();
    setMeetingsOpen(false);
  };
  const connectMeeting = () => {
    const id = pasteId.trim();
    const meeting: Meeting | undefined = id ? { id, title: "Manual meeting", sub: "", time: "", active: true } : (selectedMeeting ?? undefined);
    startConnection(meeting);
  };
  const stop = () => connRef.current?.disconnect();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || (!e.metaKey && !e.ctrlKey)) return;
      if (e.key === "1") { e.preventDefault(); setView("transcript"); }
      else if (e.key === "2") { e.preventDefault(); setView("split"); }
      else if (e.key === "3") { e.preventDefault(); setView("chat"); }
      else if (e.key.toLowerCase() === "k") { e.preventDefault(); if (!meetingsOpen && ffKey) loadMeetings(); setMeetingsOpen(o => !o); }
      else if (e.key.toLowerCase() === "u") { e.preventDefault(); setQuestionMode(q => !q); }
      else if (e.key.toLowerCase() === "j") { e.preventDefault(); if (view === "transcript") setView("split"); setTab("chat"); setTimeout(() => chatComposerRef.current?.focus(), 0); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, ffKey, meetingsOpen, loadMeetings]);

  const selectMode = (id: string) => setMode(id);
  const toggleFlag = (k: string) => setFlags(f => ({ ...f, [k]: !f[k] }));
  const suggestModes = async () => {
    if (!orKey || grouped.length === 0) return;
    setProposing(true);
    try { const ms = await proposeModes(getCtx(), orKey, model); if (ms.length) setSuggested(ms.map((m, i) => ({ id: `p${i}-${m.label}`, l: m.label, context: m.context }))); } catch {}
    setProposing(false);
  };

  // ── Chat (OpenRouter, meeting-aware) ─────────────────────────────
  const askChat = async (text: string) => {
    const v = text.trim(); if (!v) return;
    setTab("chat");
    const id = Date.now();
    setMessages(prev => [...prev, { id, role: "user", text: v }]);
    if (!orKey) { setMessages(prev => [...prev, { id: id + 1, role: "agent", text: "AI offline — set OPENROUTER_API." }]); return; }
    setThinking(true);
    try {
      const resp = await callAI([{ role: "system", content: `You are a meeting assistant. Answer concisely.${agentContext ? ` ${agentContext}` : ""}` }, { role: "user", content: `Transcript:\n${getCtx()}\n\nUser: ${v}` }], orKey, model);
      setMessages(prev => [...prev, { id: id + 1, role: "agent", text: resp }]);
    } catch { setMessages(prev => [...prev, { id: id + 1, role: "agent", text: "AI unavailable." }]); }
    setThinking(false);
  };
  const sendChat = () => { const v = chatInput.trim(); if (!v) return; setChatInput(""); askChat(v); };

  // ── PI (terminal assistant, streamed via the bridge) ─────────────
  const sendPI = async (text: string) => {
    const t = text.trim(); if (!t) return;
    setTab("pi");
    const uid = Date.now();
    setPiMessages(prev => [...prev, { id: uid, role: "user", text: t }]);
    if (!bridgeOnline) { setPiMessages(prev => [...prev, { id: uid + 1, role: "agent", text: "⚠ PI bridge offline — is the dev server running?" }]); return; }
    setPiThinking(true);
    const aid = uid + 1; let started = false;
    try {
      await streamPI(t, piSessionRef.current, bridgeToken, partial => {
        if (!started) { started = true; setPiThinking(false); setPiMessages(prev => [...prev, { id: aid, role: "agent", text: partial }]); }
        else setPiMessages(prev => prev.map(m => m.id === aid ? { ...m, text: partial } : m));
      });
    } catch { setPiMessages(prev => [...prev, { id: aid, role: "agent", text: "⚠ PI unreachable." }]); }
    if (!started) setPiMessages(prev => [...prev, { id: aid, role: "agent", text: "_(no output)_" }]);
    setPiThinking(false);
  };
  const submitPI = () => { const v = piInput.trim(); if (v) { setPiInput(""); sendPI(v); } };

  // Ask / Do / Note → meeting chat (has transcript context); Command → PI terminal.
  const handleSuggestion = (s: Suggestion) => {
    if (s.type === "command") sendPI(s.text);
    else askChat(s.text);
  };

  const copyTx = () => { navigator.clipboard.writeText(getCtx()); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const exportMd = () => {
    const transcript = grouped.map(l => `**${l.speaker}:** ${l.text}`).join("\n\n") || "_No transcript._";
    const liveFeed = suggestions.map(s => `- **${SUGMETA[s.type]?.kind || s.type}** (${new Date(s.t).toLocaleString()}): ${s.text}`).join("\n") || "_No live feed items._";
    const chat = messages.map(m => `**${m.role === "user" ? "You" : "AI"}:**\n${m.text}`).join("\n\n") || "_No chat messages._";
    const piLog = piMessages.map(m => `[${m.role === "user" ? "Command" : "PI"}] ${m.text}`).join("\n") || "_No PI command log entries._";
    const sections = [
      `# ${selectedMeeting?.title || "Meeting"}`,
      `Exported: ${new Date().toLocaleString()}`,
      selectedMeeting?.id ? `Meeting ID: \`${selectedMeeting.id}\`` : "",
      `Status: ${statusLabel}`,
      `\n## Transcript\n${transcript}`,
      `\n## Live Feed\n${liveFeed}`,
      liveAnswer ? `\n## Question Mode Draft\n${liveAnswer}` : "",
      `\n## Full Chat\n${chat}`,
      `\n## PI Command Log\n\`\`\`text\n${piLog.replace(/```/g, "'''")}\n\`\`\``,
    ];
    const md = sections.filter(Boolean).join("\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `fireflies-${Date.now()}.md`; a.click(); URL.revokeObjectURL(a.href);
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => { const el = splitElRef.current; if (!el) return; const r = el.getBoundingClientRect(); let ratio = (ev.clientX - r.left) / r.width; ratio = Math.min(0.74, Math.max(0.34, ratio)); setSplitRatio(ratio); };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };

  // derived
  const isSplit = view === "split", isChat = view === "chat";
  const isConnected = status === "connected", isConnecting = status === "connecting", isIdle = status === "idle";
  const statusColor = isConnected ? "oklch(0.68 0.16 155)" : isConnecting ? "oklch(0.78 0.14 75)" : "oklch(0.7 0.01 250)";
  const statusLabel = isConnected ? "Connected" : isConnecting ? "Connecting…" : "Idle";
  const pct = Math.round(splitRatio * 1000) / 10 + "%";

  const filtered = suggestions.filter(x => filter === "all" ? true : x.type === filter);
  const limit = feedExpanded ? filtered.length : 4;
  const counts: Record<string, number> = { ask: 0, do: 0, note: 0, command: 0 }; suggestions.forEach(x => counts[x.type]++);
  const visibleSug = filtered.slice(0, limit);
  const hasMore = filtered.length > 4;
  const moreLabel = feedExpanded ? "Show less" : "Show " + (filtered.length - 4) + " more";

  const flagsCount = Object.values(flags).filter(Boolean).length;
  const modeLabel = MODES.find(m => m.id === mode)?.l || suggested.find(s => s.id === mode)?.l || "No agent mode";
  let modelLabel = ""; MODELS.forEach(g => g.items.forEach(i => { if (i.id === model) modelLabel = i.l; }));
  const activeMeetings = meetings.filter(m => m.active);

  const rootStyle = {
    "--ac": C.ac, "--ac-hover": C.hover, "--ac-tint": C.tint, "--ac-tint2": C.tint2, "--ac-border": C.border, "--ac-text": C.text,
    minHeight: "100vh", width: "100%", padding: 28, background: `radial-gradient(1200px 600px at 78% -8%, ${C.tint}, transparent 60%), oklch(0.975 0.006 250)`, overflow: "auto",
  } as CSSProperties;

  // ── Chat thread + composer (reusable; called inline so inputs keep focus) ──
  const renderThread = (msgs: Message[], busy: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {msgs.map(m => m.role === "user" ? (
        <div key={m.id} style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ maxWidth: "80%", padding: "14px 18px", background: "var(--ac)", color: "#fff", borderRadius: "16px 16px 4px 16px", fontSize: 14.5, lineHeight: 1.6 }}>{m.text}</div>
        </div>
      ) : (
        <div key={m.id} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, background: "var(--ac-tint)", flex: "0 0 auto", marginTop: 2 }}><Icon id="i-sparkles" stroke="var(--ac)" /></span>
          <div style={{ flex: "1 1 auto", minWidth: 0, padding: "14px 18px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.93 0.006 255)", borderRadius: "4px 16px 16px 16px", fontSize: 14.5, color: "oklch(0.3 0.02 255)" }} dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
        </div>
      ))}
      {busy && (
        <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, background: "var(--ac-tint)", flex: "0 0 auto" }}><Icon id="i-sparkles" stroke="var(--ac)" /></span>
          <div style={{ display: "flex", gap: 5, padding: "14px 18px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.93 0.006 255)", borderRadius: "4px 16px 16px 16px" }}>
            {[0, 0.2, 0.4].map((d, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.6 0.02 255)", animation: `fl-think 1.2s ease-in-out ${d}s infinite` }} />)}
          </div>
        </div>
      )}
    </div>
  );

  const renderComposer = (value: string, onChange: (v: string) => void, onSend: () => void, placeholder: string, inputRef?: Ref<HTMLTextAreaElement>) => (
    <div className="fl-composer" style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "8px 8px 8px 18px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" }}>
      <textarea ref={inputRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} placeholder={placeholder} rows={1}
        style={{ flex: "1 1 auto", minWidth: 0, border: "none", outline: "none", background: "none", resize: "none", fontFamily: "inherit", fontSize: 14.5, lineHeight: 1.5, color: "oklch(0.3 0.02 255)", padding: "9px 0", maxHeight: 120 }} />
      <button onClick={onSend} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 11, background: "var(--ac)", border: "none", color: "#fff", cursor: "pointer", flex: "0 0 auto" }}><Icon id="i-send" /></button>
    </div>
  );

  // ── Header ────────────────────────────────────────────────────────
  const header = (
    <header style={{ ...cardBase, flexDirection: "row", alignItems: "center", gap: 24, padding: "18px 26px", flex: "0 0 auto", overflow: "visible" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, minWidth: 0 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 21, letterSpacing: "-0.02em", color: "oklch(0.27 0.025 255)", whiteSpace: "nowrap" }}>Fireflies&nbsp;<span style={{ color: "var(--ac)" }}>Live</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 15px 8px 13px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.92 0.006 255)", borderRadius: 999 }}>
          <span style={{ position: "relative", display: "inline-flex", width: 9, height: 9 }}>
            {isConnected && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: statusColor, animation: "fl-pulse 2.4s ease-out infinite" }} />}
            <span style={{ position: "relative", width: 9, height: 9, borderRadius: "50%", background: statusColor }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "oklch(0.4 0.02 255)", whiteSpace: "nowrap" }}>{statusLabel}</span>
        </div>
        {isConnected && (
          <button onClick={stop} className="fl-hover-soft" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", background: "#fff", border: "1px solid oklch(0.9 0.02 25)", borderRadius: 10, color: "oklch(0.55 0.16 25)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <Icon id="i-square" size={14} fill="currentColor" stroke="none" />Stop
          </button>
        )}
      </div>
      <div style={{ flex: "1 1 auto" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "0 0 auto" }}>
        <div style={{ display: "flex", gap: 4, padding: 5, background: "oklch(0.97 0.005 250)", border: "1px solid oklch(0.92 0.006 255)", borderRadius: 13 }}>
          {VIEWS.map(v => <button key={v.id} onClick={() => setView(v.id as any)} style={segBtn(view === v.id)}><Icon id={v.ic} size={16} /><span>{v.l}</span></button>)}
        </div>
        <button onClick={() => { setConfigOpen(true); setMeetingsOpen(false); }} title="Settings" className="fl-hover-soft" style={{ ...iconBtn, width: 42, height: 42, borderRadius: 12 }}><Icon id="i-settings" size={19} /></button>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMeetingsOpen(o => !o)} className="fl-hover-soft" style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "11px 16px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, color: "oklch(0.27 0.025 255)", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <Icon id="i-radio" size={17} stroke="var(--ac)" /> Active meetings {activeMeetings.length > 0 && <span style={{ padding: "1px 7px", borderRadius: 999, background: "var(--ac)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{activeMeetings.length}</span>} <Icon id="i-down" size={15} stroke="oklch(0.6 0.015 255)" />
          </button>
          {meetingsOpen && renderMeetingsPopover()}
        </div>
      </div>
    </header>
  );

  function renderMeetingsPopover() { return (
    <div style={{ position: "absolute", top: "calc(100% + 12px)", right: 0, width: 380, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: "0 18px 50px -20px rgba(16,24,40,.4)", padding: 22, zIndex: 60, animation: "fl-pop .18s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.27 0.025 255)" }}>Active meetings</div>
        <button onClick={loadMeetings} disabled={!ffKey || loadingMeetings} title="Refresh" className="fl-hover-soft" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "1px solid oklch(0.92 0.006 255)", borderRadius: 9, background: "#fff", color: "oklch(0.5 0.02 255)", cursor: "pointer" }}><Icon id="i-refresh" size={15} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {activeMeetings.map(m => (
          <div key={m.id} className="fl-hover-soft" style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, border: "1px solid oklch(0.93 0.006 255)", borderRadius: 13 }}>
            <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8, flex: "0 0 auto" }}><span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "oklch(0.68 0.16 155)", animation: "fl-pulse 2.4s ease-out infinite" }} /><span style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: "oklch(0.68 0.16 155)" }} /></span>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.27 0.025 255)" }}>{m.title}</div>
              <div style={{ fontSize: 12.5, color: "oklch(0.6 0.015 255)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[m.sub, m.time].filter(Boolean).join(" · ") || "Live now"}</div>
            </div>
            <button onClick={() => startConnection(m)} disabled={isConnected || isConnecting} style={{ padding: "9px 16px", background: "var(--ac)", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", flex: "0 0 auto", opacity: isConnected || isConnecting ? 0.5 : 1 }}>Connect</button>
          </div>
        ))}
        {activeMeetings.length === 0 && (
          <div style={{ padding: "14px 4px", fontSize: 13, color: meetingsError ? "oklch(0.55 0.16 25)" : "oklch(0.6 0.015 255)", lineHeight: 1.5 }}>{loadingMeetings ? "Scanning for active meetings…" : meetingsError || (ffKey ? "No active meetings right now." : "Add your Fireflies key to detect meetings.")}</div>
        )}
      </div>
      <div style={{ height: 1, background: "oklch(0.93 0.006 255)", margin: "18px 0" }} />
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "oklch(0.5 0.02 255)", marginBottom: 10 }}>Paste a meeting ID</div>
      <div style={{ display: "flex", gap: 10 }}>
        <input value={pasteId} onChange={e => setPasteId(e.target.value)} onKeyDown={e => { if (e.key === "Enter") connectMeeting(); }} placeholder="app.fireflies.ai/view/…" className="fl-focus" style={{ flex: "1 1 auto", minWidth: 0, padding: "11px 14px", border: `1px solid ${BORDER}`, borderRadius: 11, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: "oklch(0.3 0.02 255)", outline: "none" }} />
        <button onClick={connectMeeting} className="fl-hover-soft" style={{ padding: "0 18px", background: "oklch(0.97 0.005 250)", border: `1px solid ${BORDER}`, borderRadius: 11, color: "oklch(0.3 0.02 255)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", flex: "0 0 auto" }}>Connect</button>
      </div>
    </div>
  ); }

  // ── Transcript card ───────────────────────────────────────────────
  const transcriptCard = (
    <div style={{ ...cardBase, flex: "1 1 auto", minWidth: 0 }}>
      <div style={{ padding: "24px 28px", display: "flex", alignItems: "center", gap: 18, flex: "0 0 auto", borderBottom: "1px solid oklch(0.95 0.005 250)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 11, background: "var(--ac-tint)", flex: "0 0 auto" }}><Icon id="i-mic" size={19} stroke="var(--ac)" /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700, color: "oklch(0.27 0.025 255)", letterSpacing: "-0.01em" }}>Live transcription</div>
            {isConnected && selectedMeeting && <div style={{ fontSize: 13, color: "oklch(0.6 0.015 255)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedMeeting.title}</div>}
          </div>
        </div>
        {isConnected && <button onClick={() => setQuestionMode(q => !q)} style={qBtnStyle(questionMode)}><Icon id="i-sparkles" size={16} />Question mode</button>}
        {(isConnected || grouped.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
            <button onClick={copyTx} title="Copy" className="fl-hover-soft" style={{ ...iconBtn }}><Icon id={copied ? "i-check" : "i-copy"} size={17} stroke={copied ? "oklch(0.6 0.14 155)" : "currentColor"} /></button>
            <button onClick={exportMd} title="Export all outputs" className="fl-hover-soft" style={{ ...iconBtn }}><Icon id="i-download" size={17} /></button>
          </div>
        )}
      </div>
      <div ref={transcriptScrollRef} onScroll={onTranscriptScroll} className="fl-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {(isConnected || (isIdle && grouped.length > 0)) && (
          <div style={{ padding: "8px 32px 32px" }}>
            {isConnected && questionMode && (
              <div style={{ position: "sticky", top: 0, zIndex: 5, margin: "16px 0 26px", padding: "20px 22px", background: "linear-gradient(180deg,var(--ac-tint),#fff)", border: "1px solid var(--ac-border)", borderRadius: 16, boxShadow: "0 8px 24px -18px var(--ac)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", background: "var(--ac)", borderRadius: 999, color: "#fff", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.01em" }}><Icon id="i-arrow" size={13} sw={2.2} />Say this</span>
                  <span style={{ fontSize: 12.5, color: "var(--ac-text)", fontWeight: 600 }}>Drafted for you · read it aloud</span>
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "oklch(0.6 0.015 255)" }}>
                    {answering
                      ? <>{[0, 0.2, 0.4].map((d, i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ac)", animation: `fl-think 1.2s ease-in-out ${d}s infinite` }} />)}<span style={{ marginLeft: 3 }}>formulating</span></>
                      : <><span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.68 0.16 155)" }} />live</>}
                  </span>
                </div>
                {liveAnswer
                  ? <div style={{ fontSize: 15, lineHeight: 1.65, color: "oklch(0.3 0.02 255)" }} dangerouslySetInnerHTML={{ __html: mdToHtml(liveAnswer) }} />
                  : <div style={{ fontSize: 14, lineHeight: 1.6, color: "oklch(0.55 0.015 255)" }}>{answering ? "Formulating a response…" : "Listening — I'll draft what to say when someone asks you something."}</div>}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {grouped.map(l => (
                <div key={l.id}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.01em", marginBottom: 5, color: speakerColor(l.speaker) }}>{l.speaker}</div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.7, color: "oklch(0.32 0.018 255)" }}>{l.text}{isConnected && !l.isFinal && <span style={{ display: "inline-block", width: 7, height: 16, background: "var(--ac)", borderRadius: 2, marginLeft: 4, verticalAlign: "middle", animation: "fl-blink 1.1s steps(1) infinite" }} />}</div>
                </div>
              ))}
              {isConnected
                ? <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4, color: "oklch(0.7 0.012 255)", fontSize: 13 }}><span style={{ width: 7, height: 16, background: "var(--ac)", borderRadius: 2, animation: "fl-blink 1.1s steps(1) infinite", display: "inline-block" }} /><span>Listening…</span></div>
                : <div style={{ fontSize: 13, color: "oklch(0.6 0.015 255)", paddingTop: 4 }}>Restored from your last session — connect to continue.</div>}
            </div>
          </div>
        )}
        {isIdle && grouped.length === 0 && (
          <div style={{ height: "100%", minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 48 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 74, height: 74, borderRadius: 20, background: "var(--ac-tint)", marginBottom: 26, position: "relative" }}>
              <span style={{ position: "absolute", inset: 0, borderRadius: 20, border: "2px solid var(--ac-border)", animation: "fl-pulse 2.6s ease-out infinite" }} />
              <Icon id="i-radio" size={32} stroke="var(--ac)" />
            </span>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: "oklch(0.27 0.025 255)", letterSpacing: "-0.01em" }}>Pick a meeting and hit Connect</div>
            <div style={{ fontSize: 15, lineHeight: 1.6, color: "oklch(0.55 0.015 255)", maxWidth: 440, marginTop: 12 }}>We auto-detect your active Fireflies meetings. Choose one and connect — or paste a meeting ID to jump straight in.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 460, marginTop: 34, textAlign: "left" }}>
              {EMPTY_STEPS.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 20px", border: "1px solid oklch(0.93 0.006 255)", borderRadius: 14, background: "#fff" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 11, background: "var(--ac-tint)", flex: "0 0 auto" }}><Icon id={s.icon} size={19} stroke="var(--ac)" /></span>
                  <div><div style={{ fontSize: 14.5, fontWeight: 700, color: "oklch(0.27 0.025 255)" }}>{s.title}</div><div style={{ fontSize: 13, color: "oklch(0.58 0.015 255)", marginTop: 2, lineHeight: 1.5 }}>{s.body}</div></div>
                </div>
              ))}
            </div>
            <div style={{ position: "relative", marginTop: 28 }}>
              <button onClick={() => { setMeetingsOpenIdle(o => !o); if (ffKey) loadMeetings(); }} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "13px 22px", background: "var(--ac)", border: "none", borderRadius: 12, color: "#fff", fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}><Icon id="i-radio" size={17} />See active meetings<Icon id="i-down" size={15} /></button>
              {meetingsOpenIdle && renderMeetingsPopover()}
            </div>
          </div>
        )}
        {isConnecting && (
          <div style={{ height: "100%", minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, color: "oklch(0.5 0.02 255)" }}>
            <span style={{ display: "inline-flex", width: 44, height: 44, border: "3px solid oklch(0.92 0.006 255)", borderTopColor: "var(--ac)", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Connecting to your meeting…</div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Sidebar (tabbed) ──────────────────────────────────────────────
  const sectionLabel = (icon: string, text: string, right?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 11, paddingBottom: 2 }}>
      <Icon id={icon} size={18} stroke="var(--ac)" />
      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15.5, fontWeight: 700, color: "oklch(0.27 0.025 255)", letterSpacing: "-0.01em", flex: "1 1 auto" }}>{text}</span>
      {right}
    </div>
  );

  const feedPanel = (
    <section>
      {sectionLabel("i-bulb", "Live feed", <span style={{ fontSize: 12, fontWeight: 600, color: "oklch(0.6 0.015 255)" }}>{suggestions.length}</span>)}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "oklch(0.55 0.015 255)", fontWeight: 600 }}><Icon id="i-gauge" size={15} />Pulse rate</span>
          <div style={{ flex: "1 1 auto" }} />
          <select value={rate} onChange={e => setRate(e.target.value)} className="fl-focus" style={{ appearance: "none", WebkitAppearance: "none", padding: "9px 38px 9px 14px", border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 12px center", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "oklch(0.3 0.02 255)", cursor: "pointer", outline: "none" }}>
            {RATES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 18 }}>
          {FILTERS.map(f => { const active = filter === f.id; const cnt = f.id === "all" ? suggestions.length : counts[f.id]; return (
            <button key={f.id} onClick={() => { setFilter(f.id); setFeedExpanded(false); }} style={filterChip(active)}>{f.l}{f.id !== "all" && <span style={countBadge(active)}>{cnt}</span>}</button>
          ); })}
        </div>
        {!orKey && <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 600, color: "oklch(0.6 0.015 255)", marginBottom: 14 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "oklch(0.78 0.14 75)" }} />AI offline — set OPENROUTER_API</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleSug.map(s => { const m = SUGMETA[s.type]; return (
            <button key={s.id} onClick={() => handleSuggestion(s)} disabled={thinking || piThinking} style={{ display: "flex", gap: 14, width: "100%", padding: "16px 18px", background: "#fff", border: "1px solid oklch(0.93 0.006 255)", borderRadius: 14, cursor: "pointer", textAlign: "left", opacity: thinking || piThinking ? 0.6 : 1 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, flex: "0 0 auto", background: m.bg }}><Icon id={m.icon} size={17} stroke={m.color} /></span>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: m.color }}>{m.kind}</span>
                  <span style={{ fontSize: 11.5, color: "oklch(0.68 0.012 255)" }}>{rel(s.t)}</span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.55, color: "oklch(0.32 0.018 255)" }}>{s.text}</div>
              </div>
            </button>
          ); })}
        </div>
        {hasMore && <button onClick={() => setFeedExpanded(v => !v)} className="fl-hover-soft" style={{ marginTop: 14, width: "100%", padding: 11, background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.93 0.006 255)", borderRadius: 11, color: "oklch(0.45 0.02 255)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{moreLabel}</button>}
        {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13.5, color: "oklch(0.6 0.015 255)", lineHeight: 1.5 }}>Suggestions stream in here as the conversation evolves — newest on top. Tap one to ask the AI.</div>}
      </div>
    </section>
  );

  const chatPanel = (
    <section style={{ display: "flex", flexDirection: "column" }}>
      {sectionLabel("i-message", "AI assistant", !orKey ? <span style={{ fontSize: 11.5, fontWeight: 600, color: "oklch(0.6 0.015 255)" }}>offline</span> : undefined)}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <div ref={chatPanelScrollRef} onScroll={onChatPanelScroll} className="fl-scroll" style={{ display: "flex", flexDirection: "column", gap: 20, maxHeight: "min(56vh, 540px)", overflowY: "auto", paddingRight: 4 }}>{renderThread(messages, thinking)}</div>
        {renderComposer(chatInput, setChatInput, sendChat, "Ask anything about the meeting…", chatComposerRef)}
      </div>
    </section>
  );

  const piPanel = (
    <section style={{ display: "flex", flexDirection: "column" }}>
      {sectionLabel("i-terminal", "PI", <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "oklch(0.6 0.015 255)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: bridgeOnline ? "oklch(0.68 0.16 155)" : "oklch(0.7 0.01 250)" }} />{bridgeOnline ? "online" : "offline"}</span>)}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <div ref={piPanelScrollRef} onScroll={onPiPanelScroll} className="fl-scroll" style={{ display: "flex", flexDirection: "column", gap: 20, maxHeight: "min(56vh, 540px)", overflowY: "auto", paddingRight: 4 }}>{renderThread(piMessages, piThinking)}</div>
        {renderComposer(piInput, setPiInput, submitPI, "Message PI — ask, or run a command…")}
      </div>
    </section>
  );

  const sidebarCard = (
    <div className="fl-scroll" style={{ ...cardBase, flex: "1 1 0", minWidth: 380, overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", padding: 26, gap: 26 }}>
        <button onClick={() => setConfigOpen(true)} className="fl-hover-soft" style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "16px 18px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.92 0.006 255)", borderRadius: 14, cursor: "pointer", textAlign: "left" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, background: "#fff", border: "1px solid oklch(0.92 0.006 255)", flex: "0 0 auto" }}><Icon id="i-sliders" size={18} stroke="var(--ac)" /></span>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.27 0.025 255)" }}>{modeLabel}</div>
            <div style={{ fontSize: 12.5, color: "oklch(0.6 0.015 255)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{modelLabel} · {flagsCount} features on</div>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ac-text)", whiteSpace: "nowrap", flex: "0 0 auto" }}>Configure</span>
        </button>
        <div style={{ display: "flex", gap: 5, padding: 5, background: "oklch(0.97 0.005 250)", border: "1px solid oklch(0.92 0.006 255)", borderRadius: 13 }}>
          {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id as any)} style={tabBtn(tab === t.id)}><Icon id={t.ic} size={15} />{t.l}</button>)}
        </div>
        {tab === "feed" && feedPanel}
        {tab === "chat" && chatPanel}
        {tab === "pi" && piPanel}
      </div>
    </div>
  );

  // ── Chat-only view ────────────────────────────────────────────────
  const chatView = (
    <div style={{ ...cardBase, flex: "1 1 auto", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 820, margin: "0 auto", flex: "1 1 auto", minHeight: 0 }}>
        <div style={{ padding: "30px 40px 18px", display: "flex", alignItems: "center", gap: 13, flex: "0 0 auto" }}>
          <Icon id="i-sparkles" size={22} stroke="var(--ac)" />
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, color: "oklch(0.27 0.025 255)", letterSpacing: "-0.01em" }}>AI assistant</div>
            <div style={{ fontSize: 13, color: "oklch(0.6 0.015 255)", marginTop: 1 }}>Ask anything about this meeting{!orKey && " · AI offline"}</div>
          </div>
        </div>
        <div ref={chatViewScrollRef} onScroll={onChatViewScroll} className="fl-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "18px 40px 8px" }}>{renderThread(messages, thinking)}</div>
        <div style={{ padding: "18px 40px 30px", flex: "0 0 auto" }}>{renderComposer(chatInput, setChatInput, sendChat, "Ask anything about the meeting…", chatComposerRef)}</div>
      </div>
    </div>
  );

  // ── Config slide-over ─────────────────────────────────────────────
  const slideOver = configOpen && (
    <>
      <div onClick={() => setConfigOpen(false)} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.02 260 / 0.32)", zIndex: 90 }} />
      <div className="fl-scroll" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "92vw", background: "oklch(0.99 0.003 250)", borderLeft: `1px solid ${BORDER}`, boxShadow: "-24px 0 60px -30px rgba(16,24,40,.5)", zIndex: 91, overflowY: "auto", animation: "fl-slide .22s ease-out" }}>
        <div style={{ position: "sticky", top: 0, background: "oklch(0.99 0.003 250 / 0.9)", backdropFilter: "blur(8px)", padding: "26px 30px", display: "flex", alignItems: "center", gap: 13, borderBottom: "1px solid oklch(0.93 0.006 255)", zIndex: 2 }}>
          <Icon id="i-sliders" size={21} stroke="var(--ac)" />
          <div style={{ flex: "1 1 auto", fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, color: "oklch(0.27 0.025 255)", letterSpacing: "-0.01em" }}>Agent configuration</div>
          <button onClick={() => setConfigOpen(false)} className="fl-hover-soft" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, border: "1px solid oklch(0.92 0.006 255)", background: "#fff", color: "oklch(0.45 0.02 255)", cursor: "pointer" }}><Icon id="i-x" size={17} /></button>
        </div>
        <div style={{ padding: 30, display: "flex", flexDirection: "column", gap: 34 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "oklch(0.27 0.025 255)", marginBottom: 6 }}>Agent mode</div>
            <div style={{ fontSize: 13, color: "oklch(0.58 0.015 255)", marginBottom: 16, lineHeight: 1.5 }}>Sets the assistant's operating context for this call.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {MODES.map(m => <button key={m.id} onClick={() => selectMode(m.id)} style={modeChip(mode === m.id)}>{m.l}</button>)}
            </div>
            <button onClick={suggestModes} disabled={proposing || grouped.length === 0} style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 16px", background: "var(--ac-tint)", border: "1px solid var(--ac-border)", borderRadius: 11, color: "var(--ac-text)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: proposing || grouped.length === 0 ? 0.55 : 1 }}><Icon id="i-sparkles" size={15} />{proposing ? "Reading…" : "Suggest from meeting"}</button>
            {suggested.length > 0 && (
              <select value={suggested.some(s => s.id === mode) ? mode : ""} onChange={e => { if (e.target.value) selectMode(e.target.value); }} className="fl-focus" style={{ marginTop: 12, width: "100%", appearance: "none", WebkitAppearance: "none", padding: "12px 38px 12px 16px", border: `1px solid ${BORDER}`, borderRadius: 11, background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 14px center", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: "oklch(0.3 0.02 255)", cursor: "pointer", outline: "none" }}>
                <option value="">Proposed modes…</option>
                {suggested.map(m => <option key={m.id} value={m.id}>{m.l}</option>)}
              </select>
            )}
            <textarea value={customContext} onChange={e => setCustomContext(e.target.value)} placeholder="Add custom context — e.g. “Enterprise renewal, focus on security and SSO.”" className="fl-focus" style={{ marginTop: 16, width: "100%", minHeight: 84, resize: "vertical", padding: "14px 16px", border: `1px solid ${BORDER}`, borderRadius: 12, fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: "oklch(0.3 0.02 255)", outline: "none" }} />
          </div>
          <div style={{ height: 1, background: "oklch(0.93 0.006 255)" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "oklch(0.27 0.025 255)", marginBottom: 6 }}>AI model</div>
            <div style={{ fontSize: 13, color: "oklch(0.58 0.015 255)", marginBottom: 16, lineHeight: 1.5 }}>Routed through OpenRouter.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {MODELS.map(g => (
                <div key={g.p}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "oklch(0.6 0.015 255)", marginBottom: 10 }}>{g.p}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.items.map(it => <button key={it.id} onClick={() => setModel(it.id)} style={modelRow(model === it.id)}><span>{it.l}</span>{model === it.id && <Icon id="i-check" size={17} stroke="var(--ac)" sw={2.4} />}</button>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 1, background: "oklch(0.93 0.006 255)" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "oklch(0.27 0.025 255)", marginBottom: 6 }}>Features</div>
            <div style={{ fontSize: 13, color: "oklch(0.58 0.015 255)", marginBottom: 16, lineHeight: 1.5 }}>Toggle what the assistant tracks live.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {FLAGS.map(f => (
                <button key={f.k} onClick={() => toggleFlag(f.k)} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "14px 16px", background: "#fff", border: "1px solid oklch(0.92 0.006 255)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ flex: "1 1 auto", fontSize: 14, fontWeight: 600, color: "oklch(0.3 0.02 255)" }}>{f.l}</span>
                  <span style={track(!!flags[f.k])}><span style={knob(!!flags[f.k])} /></span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="fl-scroll" style={rootStyle}>
      <IconSprite />
      <div style={{ width: "100%", maxWidth: 1660, margin: "0 auto", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", gap: 18 }}>
        {header}
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", gap: 18 }}>
          {isChat ? chatView : (
            <>
              <div ref={splitElRef} style={isSplit ? { flex: `0 0 ${pct}`, minWidth: 0, display: "flex" } : { flex: "1 1 auto", minWidth: 0, display: "flex" }}>{transcriptCard}</div>
              {isSplit && (
                <>
                  <div className="fl-divider" onMouseDown={startDrag} style={{ flex: "0 0 auto", width: 14, display: "flex", alignItems: "center", justifyContent: "center", cursor: "col-resize", margin: "0 -7px", zIndex: 20 }}>
                    <div style={{ width: 5, height: 54, borderRadius: 99, background: "oklch(0.88 0.008 255)", transition: "background .15s,height .15s" }} />
                  </div>
                  <div style={{ flex: "1 1 0", minWidth: 380, display: "flex" }}>{sidebarCard}</div>
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
