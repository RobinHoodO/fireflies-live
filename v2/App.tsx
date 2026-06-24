// Fireflies Live — v2 interface (Phase 1).
// A faithful, self-contained port of the design handoff (docs/design).
// INTERFACE ONLY — no Fireflies socket, no OpenRouter, no bridge. All data is
// mock and all actions are local UI state. Phase 2 wires the real backend in.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, IconSprite } from "./icons";
import { mdToHtml } from "./md";
import {
  C, PARAS, MODES, MODELS, FLAGS, MEETINGS, VIEWS, TABS, FILTERS, SUGMETA, SUG_POOL,
  RATES, EMPTY_STEPS, Q_BANNER_TEXT, INITIAL_MESSAGES, INITIAL_TERM, initialSuggestions,
  segBtn, tabBtn, modeChip, filterChip, countBadge, modelRow, track, knob, qBtnStyle, rel,
  type Suggestion, type Message, type TermLine,
} from "./data";

const BORDER = "oklch(0.91 0.006 255)";
const CARD_SHADOW = "0 1px 2px rgba(16,24,40,.04),0 12px 32px -24px rgba(16,24,40,.22)";
const cardBase: CSSProperties = { display: "flex", flexDirection: "column", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: "hidden" };
const iconBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, border: `1px solid ${BORDER}`, borderRadius: 11, background: "#fff", color: "oklch(0.45 0.02 255)", cursor: "pointer" };

let SUG_N = 100;

export default function App() {
  const [view, setView] = useState<"transcript" | "split" | "chat">("split");
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("connected");
  const [splitRatio, setSplitRatio] = useState(0.6);
  const [questionMode, setQuestionMode] = useState(true);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [tab, setTab] = useState<"feed" | "chat" | "terminal">("feed");
  const [filter, setFilter] = useState("all");
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [mode, setMode] = useState("sales");
  const [model, setModel] = useState("anthropic/claude-sonnet-4");
  const [flags, setFlags] = useState<Record<string, boolean>>({ autosuggest: true, sentiment: true, actions: true, summary: false, speakers: true, profanity: false });
  const [suggested, setSuggested] = useState<{ id: string; l: string }[]>([]);
  const [customContext, setCustomContext] = useState("");
  const [rate, setRate] = useState("12s");
  const [routePI, setRoutePI] = useState(false);
  const [termInput, setTermInput] = useState("");
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);
  const [pasteId, setPasteId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [, force] = useState(0);
  const [termLines, setTermLines] = useState<TermLine[]>(INITIAL_TERM);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => initialSuggestions(Date.now()));
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);

  const splitElRef = useRef<HTMLDivElement>(null);

  // suggestion pulse + relative-time tick
  const rateSecs = rate === "off" ? 0 : parseInt(rate, 10);
  useEffect(() => {
    if (!rateSecs || status !== "connected") return;
    const id = setInterval(() => {
      const p = SUG_POOL[SUG_N % SUG_POOL.length];
      const item = { id: ++SUG_N, type: p.type, text: p.text, t: Date.now() };
      setSuggestions(prev => [item, ...prev].slice(0, 40));
    }, rateSecs * 1000);
    return () => clearInterval(id);
  }, [rateSecs, status]);
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 5000); return () => clearInterval(id); }, []);

  const stop = () => setStatus("idle");
  const connectMeeting = () => { setStatus("connecting"); setMeetingsOpen(false); setTimeout(() => setStatus("connected"), 1300); };
  const selectMode = (id: string) => setMode(id);
  const toggleFlag = (k: string) => setFlags(f => ({ ...f, [k]: !f[k] }));
  const suggestModes = () => setSuggested([{ id: "renewal", l: "Renewal call" }, { id: "champion", l: "Champion build" }]);
  const submitTerm = () => { const v = termInput.trim(); if (v) setPendingCmd(v); };
  const fakeOut = (c: string) => /build/.test(c) ? "✓ build complete in 4.2s" : /^ls/.test(c) ? "acme-discovery.m4a   internal-standup.m4a   notes.md" : /git/.test(c) ? "On branch main · nothing to commit" : "done.";
  const confirmCmd = () => {
    const cmd = pendingCmd!; const prefix = routePI ? "pi $ " : "$ ";
    setTermInput(""); setPendingCmd(null);
    setTermLines(prev => [...prev, { k: "cmd", t: prefix + cmd }]);
    setTimeout(() => setTermLines(prev => [...prev, { k: "out", t: fakeOut(cmd) }]), 480);
  };
  const fakeReply = (q: string) => { const c = q.replace(/[?.!]+$/, ""); return "Quick take on **" + c + "**:\n\n- Frame it around the **CS time saved** first — that's Maya's primary motive.\n- Keep the number anchored to the `14 → 25` rep growth so the future feels handled.\n\nWant me to draft the message?"; };
  const sendChat = () => {
    const v = chatInput.trim(); if (!v) return; const id = Date.now();
    setMessages(prev => [...prev, { id, role: "user", text: v }]); setChatInput(""); setThinking(true);
    setTimeout(() => { setThinking(false); setMessages(prev => [...prev, { id: id + 1, role: "agent", text: fakeReply(v) }]); }, 1400);
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
  const counts: Record<string, number> = { ask: 0, do: 0, note: 0 }; suggestions.forEach(x => counts[x.type]++);
  const visibleSug = filtered.slice(0, limit);
  const hasMore = filtered.length > 4;
  const moreLabel = feedExpanded ? "Show less" : "Show " + (filtered.length - 4) + " more";

  const termColor = (k: string) => k === "cmd" ? "oklch(0.82 0.09 242)" : k === "system" ? "oklch(0.7 0.02 250)" : k === "out" ? "oklch(0.85 0.04 155)" : k === "stderr" ? "oklch(0.72 0.16 25)" : "oklch(0.9 0.01 240)";
  const flagsCount = Object.values(flags).filter(Boolean).length;
  const modeLabel = MODES.find(m => m.id === mode)?.l || "Custom";
  let modelLabel = ""; MODELS.forEach(g => g.items.forEach(i => { if (i.id === model) modelLabel = i.l; }));

  const rootStyle = {
    "--ac": C.ac, "--ac-hover": C.hover, "--ac-tint": C.tint, "--ac-tint2": C.tint2, "--ac-border": C.border, "--ac-text": C.text,
    minHeight: "100vh", width: "100%", padding: 28, background: `radial-gradient(1200px 600px at 78% -8%, ${C.tint}, transparent 60%), oklch(0.975 0.006 250)`, overflow: "auto",
  } as CSSProperties;

  // ── Chat thread + composer (shared) ──────────────────────────────
  const ChatThread = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {messages.map(m => m.role === "user" ? (
        <div key={m.id} style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ maxWidth: "80%", padding: "14px 18px", background: "var(--ac)", color: "#fff", borderRadius: "16px 16px 4px 16px", fontSize: 14.5, lineHeight: 1.6 }}>{m.text}</div>
        </div>
      ) : (
        <div key={m.id} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, background: "var(--ac-tint)", flex: "0 0 auto", marginTop: 2 }}><Icon id="i-sparkles" stroke="var(--ac)" /></span>
          <div style={{ flex: "1 1 auto", minWidth: 0, padding: "14px 18px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.93 0.006 255)", borderRadius: "4px 16px 16px 16px", fontSize: 14.5, color: "oklch(0.3 0.02 255)" }} dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
        </div>
      ))}
      {thinking && (
        <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, background: "var(--ac-tint)", flex: "0 0 auto" }}><Icon id="i-sparkles" stroke="var(--ac)" /></span>
          <div style={{ display: "flex", gap: 5, padding: "14px 18px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.93 0.006 255)", borderRadius: "4px 16px 16px 16px" }}>
            {[0, 0.2, 0.4].map((d, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.6 0.02 255)", animation: `fl-think 1.2s ease-in-out ${d}s infinite` }} />)}
          </div>
        </div>
      )}
    </div>
  );

  const Composer = ({ placeholder }: { placeholder: string }) => (
    <div className="fl-composer" style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "8px 8px 8px 18px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" }}>
      <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }} placeholder={placeholder} rows={1}
        style={{ flex: "1 1 auto", minWidth: 0, border: "none", outline: "none", background: "none", resize: "none", fontFamily: "inherit", fontSize: 14.5, lineHeight: 1.5, color: "oklch(0.3 0.02 255)", padding: "9px 0", maxHeight: 120 }} />
      <button onClick={sendChat} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 11, background: "var(--ac)", border: "none", color: "#fff", cursor: "pointer", flex: "0 0 auto" }}><Icon id="i-send" /></button>
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
            <Icon id="i-radio" size={17} stroke="var(--ac)" /> Active meetings <Icon id="i-down" size={15} stroke="oklch(0.6 0.015 255)" />
          </button>
          {meetingsOpen && meetingsPopover}
        </div>
      </div>
    </header>
  );

  const meetingsPopover = (
    <div style={{ position: "absolute", top: "calc(100% + 12px)", right: 0, width: 380, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: "0 18px 50px -20px rgba(16,24,40,.4)", padding: 22, zIndex: 60, animation: "fl-pop .18s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.27 0.025 255)" }}>Active meetings</div>
        <button onClick={() => force(n => n + 1)} title="Refresh" className="fl-hover-soft" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "1px solid oklch(0.92 0.006 255)", borderRadius: 9, background: "#fff", color: "oklch(0.5 0.02 255)", cursor: "pointer" }}><Icon id="i-refresh" size={15} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {MEETINGS.map(m => (
          <div key={m.id} className="fl-hover-soft" style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, border: "1px solid oklch(0.93 0.006 255)", borderRadius: 13 }}>
            <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8, flex: "0 0 auto" }}><span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "oklch(0.68 0.16 155)", animation: "fl-pulse 2.4s ease-out infinite" }} /><span style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: "oklch(0.68 0.16 155)" }} /></span>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.27 0.025 255)" }}>{m.title}</div>
              <div style={{ fontSize: 12.5, color: "oklch(0.6 0.015 255)", marginTop: 2 }}>{m.sub} · {m.time}</div>
            </div>
            <button onClick={connectMeeting} style={{ padding: "9px 16px", background: "var(--ac)", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", flex: "0 0 auto" }}>Connect</button>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: "oklch(0.93 0.006 255)", margin: "18px 0" }} />
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "oklch(0.5 0.02 255)", marginBottom: 10 }}>Paste a meeting ID</div>
      <div style={{ display: "flex", gap: 10 }}>
        <input value={pasteId} onChange={e => setPasteId(e.target.value)} placeholder="app.fireflies.ai/view/…" className="fl-focus" style={{ flex: "1 1 auto", minWidth: 0, padding: "11px 14px", border: `1px solid ${BORDER}`, borderRadius: 11, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: "oklch(0.3 0.02 255)", outline: "none" }} />
        <button onClick={connectMeeting} className="fl-hover-soft" style={{ padding: "0 18px", background: "oklch(0.97 0.005 250)", border: `1px solid ${BORDER}`, borderRadius: 11, color: "oklch(0.3 0.02 255)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", flex: "0 0 auto" }}>Connect</button>
      </div>
    </div>
  );

  // ── Transcript card ───────────────────────────────────────────────
  const transcriptCard = (
    <div style={{ ...cardBase, flex: "1 1 auto", minWidth: 0 }}>
      <div style={{ padding: "24px 28px", display: "flex", alignItems: "center", gap: 18, flex: "0 0 auto", borderBottom: "1px solid oklch(0.95 0.005 250)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 11, background: "var(--ac-tint)", flex: "0 0 auto" }}><Icon id="i-mic" size={19} stroke="var(--ac)" /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700, color: "oklch(0.27 0.025 255)", letterSpacing: "-0.01em" }}>Live transcription</div>
            {isConnected && <div style={{ fontSize: 13, color: "oklch(0.6 0.015 255)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Acme Corp · Discovery</div>}
          </div>
        </div>
        {isConnected && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
            <button onClick={() => setQuestionMode(q => !q)} style={qBtnStyle(questionMode)}><Icon id="i-sparkles" size={16} />Question mode</button>
            <button title="Copy" className="fl-hover-soft" style={{ ...iconBtn }}><Icon id="i-copy" size={17} /></button>
            <button title="Export to Markdown" className="fl-hover-soft" style={{ ...iconBtn }}><Icon id="i-download" size={17} /></button>
          </div>
        )}
      </div>
      <div className="fl-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {isConnected && (
          <div style={{ padding: "8px 32px 32px" }}>
            {questionMode && (
              <div style={{ position: "sticky", top: 0, zIndex: 5, margin: "16px 0 26px", padding: "20px 22px", background: "linear-gradient(180deg,var(--ac-tint),#fff)", border: "1px solid var(--ac-border)", borderRadius: 16, boxShadow: "0 8px 24px -18px var(--ac)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", background: "var(--ac)", borderRadius: 999, color: "#fff", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.01em" }}><Icon id="i-arrow" size={13} sw={2.2} />Say this</span>
                  <span style={{ fontSize: 12.5, color: "var(--ac-text)", fontWeight: 600 }}>Drafted for you · read it aloud</span>
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "oklch(0.6 0.015 255)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.68 0.16 155)" }} />live</span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.65, color: "oklch(0.3 0.02 255)" }} dangerouslySetInnerHTML={{ __html: mdToHtml(Q_BANNER_TEXT) }} />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {PARAS.map((p, i) => (
                <div key={i}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.01em", marginBottom: 5, color: p.color }}>{p.name}</div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.7, color: "oklch(0.32 0.018 255)" }}>{p.text}</div>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4, color: "oklch(0.7 0.012 255)", fontSize: 13 }}>
                <span style={{ width: 7, height: 16, background: "var(--ac)", borderRadius: 2, animation: "fl-blink 1.1s steps(1) infinite", display: "inline-block" }} />
                <span>Listening…</span>
              </div>
            </div>
          </div>
        )}
        {isIdle && (
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
            <button onClick={() => setMeetingsOpen(true)} style={{ marginTop: 28, display: "inline-flex", alignItems: "center", gap: 10, padding: "13px 22px", background: "var(--ac)", border: "none", borderRadius: 12, color: "#fff", fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}><Icon id="i-radio" size={17} />See active meetings</button>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleSug.map(s => { const m = SUGMETA[s.type]; return (
            <button key={s.id} onClick={() => setView("chat")} style={{ display: "flex", gap: 14, width: "100%", padding: "16px 18px", background: "#fff", border: "1px solid oklch(0.93 0.006 255)", borderRadius: 14, cursor: "pointer", textAlign: "left" }}>
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
      {sectionLabel("i-message", "AI assistant")}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="fl-scroll" style={{ display: "flex", flexDirection: "column", gap: 20, maxHeight: 440, overflowY: "auto", paddingRight: 4 }}><ChatThread /></div>
        <Composer placeholder="Ask the AI anything…" />
      </div>
    </section>
  );

  const termPanel = (
    <section>
      {sectionLabel("i-terminal", "Backend terminal", <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "oklch(0.6 0.015 255)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.68 0.16 155)" }} />PI online</span>)}
      <div style={{ marginTop: 16 }}>
        <div className="fl-scroll" style={{ background: "oklch(0.2 0.025 260)", borderRadius: 14, padding: "20px 22px", minHeight: 200, maxHeight: 280, overflowY: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, lineHeight: 1.7 }}>
          {termLines.map((l, i) => <div key={i} style={{ color: termColor(l.k), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{l.t}</div>)}
        </div>
        {pendingCmd && (
          <div style={{ marginTop: 12, padding: "16px 18px", background: "oklch(0.97 0.03 75)", border: "1px solid oklch(0.85 0.08 75)", borderRadius: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, fontWeight: 700, color: "oklch(0.45 0.1 60)", marginBottom: 6 }}><Icon id="i-help" size={15} />Run this on your machine?</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: "oklch(0.35 0.02 255)", background: "#fff", border: "1px solid oklch(0.9 0.02 75)", borderRadius: 8, padding: "9px 12px", marginBottom: 14, wordBreak: "break-all" }}>{routePI ? "pi $ " : "$ "}{pendingCmd}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPendingCmd(null)} className="fl-hover-soft" style={{ flex: "1 1 auto", padding: 10, background: "#fff", border: "1px solid oklch(0.9 0.01 255)", borderRadius: 10, color: "oklch(0.4 0.02 255)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={confirmCmd} style={{ flex: "1 1 auto", padding: 10, background: "var(--ac)", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Run command</button>
            </div>
          </div>
        )}
        <div className="fl-composer" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 16px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 13 }}>
          <Icon id="i-terminal" size={16} stroke="oklch(0.6 0.015 255)" />
          <input value={termInput} onChange={e => setTermInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitTerm(); } }} placeholder="Type a shell command…" style={{ flex: "1 1 auto", minWidth: 0, border: "none", outline: "none", background: "none", fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: "oklch(0.3 0.02 255)" }} />
          <button onClick={submitTerm} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 9, background: "var(--ac)", border: "none", color: "#fff", cursor: "pointer", flex: "0 0 auto" }}><Icon id="i-send" size={16} /></button>
        </div>
        <button onClick={() => setRoutePI(v => !v)} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "13px 16px", background: "oklch(0.98 0.004 250)", border: "1px solid oklch(0.93 0.006 255)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
          <Icon id="i-plug" size={17} stroke="var(--ac)" />
          <span style={{ flex: "1 1 auto", fontSize: 13.5, fontWeight: 600, color: "oklch(0.32 0.018 255)" }}>Route through PI</span>
          <span style={track(routePI)}><span style={knob(routePI)} /></span>
        </button>
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
        {tab === "terminal" && termPanel}
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
            <div style={{ fontSize: 13, color: "oklch(0.6 0.015 255)", marginTop: 1 }}>Ask anything about this meeting</div>
          </div>
        </div>
        <div className="fl-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "18px 40px 8px" }}><ChatThread /></div>
        <div style={{ padding: "18px 40px 30px", flex: "0 0 auto" }}><Composer placeholder="Ask the AI anything…" /></div>
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
              {suggested.map(m => <button key={m.id} onClick={() => selectMode(m.id)} style={modeChip(mode === m.id)}><Icon id="i-sparkles" size={13} />{m.l}</button>)}
            </div>
            <button onClick={suggestModes} style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 16px", background: "var(--ac-tint)", border: "1px solid var(--ac-border)", borderRadius: 11, color: "var(--ac-text)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}><Icon id="i-sparkles" size={15} />Suggest from meeting</button>
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
