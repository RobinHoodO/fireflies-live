import { GRAPH_STATES, type GraphNodeState } from "./graph.ts";

// Real backend wiring for the v2 interface (Phase 2).
// Ported from the original src/App.tsx: key injection, Fireflies meetings + live
// socket (with demo fallback), OpenRouter calls, suggestions, live answers, mode
// proposal. The bridge (terminal) is called directly from App via /bridge/*.

export type ConnStatus = "disconnected" | "connecting" | "connected" | "error";
export type SugType = "ask" | "do" | "note" | "command";
export type AgendaKind = "topic" | "clarify" | "branch";
// One feed: suggestions and agenda points are the same list, differing only by type.
export type FeedType = SugType | AgendaKind;
export const AGENDA_TYPES: AgendaKind[] = ["topic", "clarify", "branch"];
export const FEED_TYPES: FeedType[] = ["ask", "do", "note", "command", "topic", "clarify", "branch"];
export interface BackendSuggestion { id: number; type: SugType; text: string; t: number }
export interface NavFrame { phase: string; stance: string; goal_progress: string; next_move: string; risk: string }
export interface SentimentPoint { score: number; label: string; t: number }
export interface ConstellationSource { kind: string; label: string; n: number }
export interface Constellation { bundle: string; sources: ConstellationSource[]; counterpart: string; topic: string }

export interface Meeting { id: string; title: string; sub: string; time: string; active: boolean }

// Per-built-in-mode operating context (keyed by v2 MODES ids in data.ts).
export const MODE_CONTEXT: Record<string, string> = {
  sales: "You're supporting the host on a sales call. Surface objections, buying signals, pricing cues, and concise responses that move the deal forward.",
  interview: "Help the host interview a candidate: propose sharp follow-up questions, flag vague or evasive answers, and track competencies.",
  standup: "Track decisions, blockers, action items and their owners. Keep everything concise and actionable.",
  negotiation: "Help the host negotiate: flag concessions, anchors, and suggested counter-offers in real time.",
  oneone: "Support a thoughtful 1:1: surface listening prompts, open questions, and gentle follow-ups.",
  discovery: "Help the host run product discovery: surface user pain points, jobs-to-be-done, and probing questions.",
};

// Map the old suggestion taxonomy (question/action/insight) onto v2's (ask/do/note).
const TYPE_MAP: Record<string, SugType> = { question: "ask", action: "do", insight: "note" };

function modelJsonArray(raw: string): any[] | null {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    const value = JSON.parse(clean.slice(clean.indexOf("["), clean.lastIndexOf("]") + 1));
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}

function modelJsonObject(raw: string): Record<string, any> | null {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    const value = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export async function fetchKeys(): Promise<{ ffKey: string; orKey: string; bridgeToken: string }> {
  try {
    const d = await fetch("/api/fireflies-key").then(r => r.json());
    return { ffKey: d.ffKey || "", orKey: d.orKey || "", bridgeToken: d.bridgeToken || "" };
  } catch {
    return { ffKey: "", orKey: "", bridgeToken: "" };
  }
}

export async function fileMeeting(title: string, markdown: string, bridgeToken: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const r = await fetch("/bridge/file", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken}` },
      body: JSON.stringify({ title, markdown }),
    });
    return await r.json();
  } catch {
    return { ok: false, error: "bridge offline" };
  }
}

export async function fetchContext(goal: string, counterpart: string, topic: string, bridgeToken: string): Promise<{ ok: boolean; bundle?: string; sources?: ConstellationSource[]; error?: string }> {
  try {
    const r = await fetch("/bridge/context", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken}` },
      body: JSON.stringify({ goal, counterpart, topic }),
    });
    return await r.json();
  } catch {
    return { ok: false, error: "bridge offline" };
  }
}

function clock(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function fetchMeetings(apiKey: string): Promise<{ meetings: Meeting[]; error: string }> {
  const q = `query { active_meetings { id title start_time end_time organizer_email } }`;
  try {
    const r = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
    });
    const d = await r.json();
    if (d?.errors) return { meetings: [], error: d.errors[0]?.message || "API error" };
    const meetings: Meeting[] = (d?.data?.active_meetings || []).map((m: any) => ({
      id: m.id,
      title: m.title || "Untitled",
      sub: m.organizer_email || "Live now",
      time: m.start_time ? clock(new Date(m.start_time).toISOString()) : "",
      active: true,
    }));
    return { meetings, error: "" };
  } catch (e: any) {
    return { meetings: [], error: e?.message || "Failed to load" };
  }
}

export async function callAI(messages: { role: string; content: string }[], key: string, model = "anthropic/claude-sonnet-5", maxTokens = 400): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5173", "X-Title": "Fireflies Live" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7 }),
  });
  const d = await r.json().catch(() => null);
  const content = d?.choices?.[0]?.message?.content;
  if (content) return content;
  // Name the model + status so a stale hardcoded slug is diagnosable from the UI.
  const detail = d?.error?.message ? `: ${String(d.error.message).slice(0, 120)}` : "";
  return `⚠ Model "${model}" returned no response (HTTP ${r.status})${detail}. It may be an invalid slug.`;
}

export async function fetchNavFrame(ctx: string, key: string, goal: string, bundleHint: string, model: string): Promise<NavFrame | null> {
  const sys = `You are the navigator for Robin's live conversation. From the transcript, output the current situation as JSON only:
{"phase":"opening|discovery|pitch|objections|negotiation|closing|smalltalk","stance":"<counterpart's current position/mood, one short line>","goal_progress":"<one short line vs Robin's goal>","next_move":"<the single best next move for Robin, imperative, under 15 words>","risk":"<biggest live risk, or empty string>"}
No prose.${goal ? ` ROBIN'S GOAL: ${goal}` : ""}${bundleHint ? `\nBACKGROUND:\n${bundleHint}` : ""}`;
  try {
    const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript (latest last):\n${ctx}` }], key, model, 250);
    const frame = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) return null;
    return {
      phase: typeof frame.phase === "string" ? frame.phase : "",
      stance: typeof frame.stance === "string" ? frame.stance : "",
      goal_progress: typeof frame.goal_progress === "string" ? frame.goal_progress : "",
      next_move: typeof frame.next_move === "string" ? frame.next_move : "",
      risk: typeof frame.risk === "string" ? frame.risk : "",
    };
  } catch { return null; }
}

export async function fetchSentiment(ctx: string, key: string, model: string): Promise<{ score: number; label: string } | null> {
  const sys = `Rate the OTHER participants' current sentiment toward the conversation (exclude the speaker "You" = Robin). Output JSON only: {"score": <number -1 to 1, negative=hostile/cold, 0=neutral, positive=warm/enthusiastic>, "label": "<their mood in 1-2 words>"}. No prose.`;
  try {
    const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript (latest last):\n${ctx}` }], key, model, 60);
    const value = modelJsonObject(raw);
    if (!value || typeof value.score !== "number" || !Number.isFinite(value.score) || typeof value.label !== "string") return null;
    return { score: Math.max(-1, Math.min(1, value.score)), label: value.label.trim().slice(0, 24) };
  } catch { return null; }
}

// A feed item to add (id:null), refine in place (id = existing item id), or mark done.
export interface FeedUpdate { id: number | null; type?: FeedType; text: string; status?: "done"; outcome?: string }
// `order` is the AI's priority ranking; null when it left priority unchanged (saves tokens).
export interface FeedResult { items: FeedUpdate[]; order: number[] | null }

export interface FeedOpts { context: string; goal: string; bundleHint: string; meetingTitle: string; agenda: boolean }

// One call maintains the whole live feed — suggestions AND agenda points — plus
// their priority order. Two loops used to do this; merging halves the input cost
// and lets the model rank everything against everything.
export async function fetchFeed(
  ctx: string, key: string, opts: FeedOpts, model: string,
  existing: { id: number; type: FeedType; text: string; done?: boolean; votes: number; source: "ai" | "you" }[],
): Promise<FeedResult | null> {
  const list = existing.slice(0, 24).map(item => ({ id: item.id, type: item.type, text: item.text, votes: item.votes, source: item.source, ...(item.done ? { done: true } : {}) }));
  const sys = `You are Robin's real-time meeting copilot. You maintain ONE priority-ordered live feed for the meeting.
Item types:
- "ask": a sharp question Robin could ask right now
- "do": a concrete task
- "note": something notable to remember
- "command": an exact single runnable shell command for Robin's machine ("text" IS the command, no prose) — only when clearly useful and safe${opts.agenda ? `
- "topic": a point still to cover in this meeting
- "clarify": an open question or unresolved point that needs clarifying
- "branch": a promising conversation direction worth steering into` : ""}
MEETING: ${opts.meetingTitle || "Meeting"}
ROBIN'S GOAL: ${opts.goal || "Advance the meeting productively."}${opts.context ? `\nCONTEXT: ${opts.context}` : ""}${opts.bundleHint ? `\nBACKGROUND (Robin's resources):\n${opts.bundleHint}` : ""}
Current feed as JSON, most important first: ${JSON.stringify(list)}
Items with "source":"you" were written by Robin himself — that is human intuition and outranks yours: never drop them, never reword them, and keep them high unless the transcript shows they are handled. "votes" is Robin's explicit priority signal. "done" items are already handled.
Read the latest transcript, then return ONLY changes:
- Refine an existing item in place with its SAME "id" and better "text" when newer context makes it sharper. Never emit a near-duplicate of an existing item.
- FOLLOW-THROUGH: if the transcript shows an item was said, done, covered or made irrelevant, return its SAME "id" with "status":"done" and "outcome":"<how it landed, under 12 words>". Never mark done without transcript evidence.
- Create a NEW item ("id":null) only for a genuinely new idea not already covered.${opts.agenda ? " When the feed has no agenda points yet, seed a few from Robin's goal and the background." : ""}
- Omit unchanged items entirely.
- "order": the full priority ranking of ALL current ids, most important first. Rank by what most advances Robin's goal right now, then time-sensitivity. Include "order" ONLY when the priority actually changed — otherwise omit the key entirely. New items are not in "order" yet (they have no id until the app assigns one); they enter at the top and you rank them on your next pass, so re-rank promptly after adding.
Each item: {"id":<existing id or null>,"type":"<type>","text":"<under 16 words>"}. A done update needs only "id", "status", "outcome".
Respond ONLY with {"items":[...]} (plus "order" when it changed). No prose, no markdown.`;
  try {
    const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript (latest last):\n${ctx}` }], key, model, 900);
    const value = modelJsonObject(raw);
    if (!value || !Array.isArray(value.items)) return null;
    const order = Array.isArray(value.order) && value.order.every((id: any) => Number.isInteger(id)) ? (value.order as number[]) : null;
    const items = value.items
      .filter((x: any) => x && typeof x === "object" && (x.id === null || Number.isInteger(x.id)) && (x.status === undefined || x.status === "done") && (typeof x.text === "string" || (x.status === "done" && Number.isInteger(x.id))))
      .slice(0, 8)
      .map((x: any) => ({
        id: Number.isInteger(x.id) ? x.id : null,
        ...(FEED_TYPES.includes(x.type) ? { type: x.type as FeedType } : TYPE_MAP[x.type] ? { type: TYPE_MAP[x.type] } : {}),
        text: typeof x.text === "string" ? x.text : "",
        ...(x.status === "done" ? { status: "done" as const, outcome: String(x.outcome ?? "") } : {}),
      }));
    return { items, order };
  } catch { return null; }
}

// ── EXPERIMENT: conversation map ─────────────────────────────────
// One slow call maintains the meeting as a TREE of topics — the route walked
// plus the branches that opened and were never taken.
export interface GraphUpdate { id: number | null; label: string; parent: number | null; state: GraphNodeState }
export interface GraphResult { nodes: GraphUpdate[]; current: number | null }

export async function fetchGraph(
  ctx: string, key: string, goal: string, model: string,
  existing: { id: number; label: string; parent: number | null; state: GraphNodeState }[],
): Promise<GraphResult | null> {
  const sys = `You map a live conversation as a TREE of topics. Not a summary — a map of where the conversation went and where it could still go.
Each node is one topic, labelled in 2-6 words.
"parent" is the topic this one grew out of. ONE tree only: exactly the very first topic of the meeting has "parent":null — everything after it grew out of something already on the map, so give it a real parent (the topic that was live when it came up, if nothing better fits). Never leave a second node parentless.
"state":
- "active": what is being discussed right now (exactly one node)
- "explored": discussed, then moved on from
- "open": a direction that surfaced but was NOT taken — a path still available
- "dropped": was open, now clearly irrelevant
${goal ? `ROBIN'S GOAL: ${goal}\nBranches that serve this goal matter most.\n` : ""}Current map as JSON: ${JSON.stringify(existing)}
Read the latest transcript, then return ONLY changes:
- A node whose state changed: its SAME "id" with the new "state". Give it a "parent" too if you now see which topic it grew out of — that is how a flat list becomes a tree. Only ever set a real parent; never send null to detach a node.
- NEW nodes: give each a NEGATIVE temporary id (-1, -2, -3). You may use a temporary id as another new node's "parent", as long as the parent is listed FIRST. So you can add a topic and its branch in the same pass. Up to 4 new nodes per pass.
- Mark a branch "open" the moment someone gestures at a direction the group does not follow — a question parked, an aside, a "we should also…", a topic raised and dropped. Those unwalked branches are the whole point of this map, so surface them generously.
- Never delete a node. A topic that died becomes "dropped", not missing.
- Omit unchanged nodes.
- "current": the id of the "active" node ("current" may be a temporary id).
Respond ONLY with {"nodes":[{"id":<id|-1|null>,"label":"...","parent":<id|-1|null>,"state":"..."}],"current":<id|null>}. No prose.`;
  try {
    const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript (latest last):\n${ctx}` }], key, model, 700);
    const value = modelJsonObject(raw);
    if (!value || !Array.isArray(value.nodes)) return null;
    const nodes = value.nodes
      .filter((n: any) => n && typeof n === "object" && (n.id === null || Number.isInteger(n.id)) && (n.parent === null || n.parent === undefined || Number.isInteger(n.parent)) && GRAPH_STATES.includes(n.state))
      .slice(0, 8)
      .map((n: any) => ({
        id: Number.isInteger(n.id) ? n.id : null,
        label: typeof n.label === "string" ? n.label.trim().slice(0, 60) : "",
        parent: Number.isInteger(n.parent) ? n.parent : null,
        state: n.state as GraphNodeState,
      }));
    return { nodes, current: Number.isInteger(value.current) ? value.current : null };
  } catch { return null; }
}

// Live "Say this" answer, streamed token-by-token via onDelta so the UI shows it
// being formulated. Resolves with the final text ("—" when no response is needed).
export async function streamLiveAnswer(
  ctx: string, key: string, context: string, model: string, prev: string,
  onDelta: (partial: string) => void, signal?: AbortSignal,
): Promise<string> {
  const sys = `You are Robin's live meeting copilot. Always draft, in Robin's own first-person voice, the single best thing Robin could say right now — ready to read aloud (1-3 sentences). Frame everything from Robin's perspective. Look at the most recent turns: if someone asked Robin something, answer it directly; otherwise proactively draft the line that best steers the conversation toward Robin's stated goal. Always produce a usable response — never decline, never output a dash or placeholder. No preamble, no labels.${prev ? `\nYOUR CURRENT DRAFT (already on Robin's screen):\n${prev}\nStability matters more than novelty: if that draft is still the right thing to say, repeat it VERBATIM. Only rewrite it when the conversation has genuinely moved past it.` : ""}${context ? ` Context: ${context}` : ""}`;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5173", "X-Title": "Fireflies Live" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], max_tokens: 400, temperature: 0.7, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) return "";
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ""; let full = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (data === "[DONE]" || !data) continue;
        try { const j = JSON.parse(data); const d = j.choices?.[0]?.delta?.content || ""; if (d) { full += d; onDelta(full); } } catch { /* keepalive / partial frame */ }
      }
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  return full.trim();
}

export async function proposeModes(ctx: string, key: string, model: string): Promise<{ label: string; context: string }[]> {
  const sys = `You are configuring a real-time meeting copilot. From the transcript, infer the meeting type and the host's likely goal. Propose up to 4 distinct "agent modes" — each a short label plus a one-sentence context instruction. Respond ONLY as a JSON array: [{"label":"...","context":"..."}].`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  const arr = modelJsonArray(raw);
  if (!arr) return [];
  try {
    return arr.filter((x: any) => x?.label && x?.context).slice(0, 4).map((x: any) => ({ label: String(x.label), context: String(x.context) }));
  } catch { return []; }
}

// Safe single-quote shell escaping so an arbitrary message can be passed as one
// argv to `pi` without the shell interpreting $(), backticks, $vars, etc.
export function shq(s: string): string { return "'" + s.replace(/'/g, "'\\''") + "'"; }

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");

// Send a message to PI as a persistent session (pi --print --session-id <id>) over
// the localhost bridge, streaming its output back (ANSI-stripped) so the chat shows
// PI working in real time. Same session id => PI keeps the conversation context.
export async function streamPI(
  message: string, sessionId: string, bridgeToken: string,
  onDelta: (text: string) => void, signal?: AbortSignal,
): Promise<string> {
  // Dedicated /pi endpoint: fixed argv, no shell, provider keys injected server-side only.
  const res = await fetch("/bridge/pi", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken}` },
    body: JSON.stringify({ message, sessionId }),
    signal,
  });
  if (!res.ok || !res.body) return "";
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let raw = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n"); buf = parts.pop() || "";
      for (const p of parts) {
        if (!p.trim()) continue;
        let m: any; try { m = JSON.parse(p); } catch { continue; }
        if (m.type === "out" || m.type === "err") { raw += m.data; onDelta(stripAnsi(raw)); }
      }
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  return stripAnsi(raw).trim();
}

type LineCb = (speaker: string, text: string, final: boolean, key?: string) => void;
type StatusCb = (s: ConnStatus) => void;

export function connectLive(onLine: LineCb, onStatus: StatusCb, apiKey: string, meetingId: string) {
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

// Fallback used when there is no Fireflies key / selected meeting — a scripted
// stream that exercises the live UI exactly like the socket would.
export function connectDemo(onLine: LineCb, onStatus: StatusCb) {
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
      for (const [s, t] of LINES) {
        if (!running) break;
        const w = t.split(" ");
        for (let i = 0; i < w.length; i++) { if (!running) break; onLine(s, w.slice(0, i + 1).join(" "), i === w.length - 1); await new Promise(r => setTimeout(r, 40 + Math.random() * 55)); }
        await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
      }
    },
    disconnect() { running = false; onStatus("disconnected"); },
  };
}

// Test-only surface — pure helpers exercised by v2/backend.test.ts.
export const __test = { modelJsonArray, modelJsonObject, shq };
