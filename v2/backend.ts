// Real backend wiring for the v2 interface (Phase 2).
// Ported from the original src/App.tsx: key injection, Fireflies meetings + live
// socket (with demo fallback), OpenRouter calls, suggestions, live answers, mode
// proposal. The bridge (terminal) is called directly from App via /bridge/*.

export type ConnStatus = "disconnected" | "connecting" | "connected" | "error";
export type SugType = "ask" | "do" | "note" | "command";
export interface BackendSuggestion { id: number; type: SugType; text: string; t: number }
export interface NavFrame { phase: string; stance: string; goal_progress: string; next_move: string; risk: string }

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
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "Couldn't generate a response.";
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

// A suggestion to add (id:null) or to refine in place (id = existing suggestion id).
export interface SuggestionUpdate { id: number | null; type: SugType; text: string }

export async function fetchSuggestions(
  ctx: string, key: string, context: string, model: string,
  existing: { id: number; type: SugType; text: string }[],
): Promise<SuggestionUpdate[]> {
  const list = existing.slice(0, 10).map(s => ({ id: s.id, type: s.type, text: s.text }));
  const sys = `You are Robin's real-time meeting copilot.${context ? ` Context: ${context}` : ""} You maintain a short live list of suggestions for Robin. Types: "ask" (a sharp question Robin could ask), "do" (a concrete task), "note" (something notable to remember), "command" (an exact shell command to run on Robin's machine — for this type "text" MUST be a single runnable command with no prose).
Existing suggestions as JSON (each with an "id"): ${JSON.stringify(list)}
Read the latest transcript, then decide changes:
- If newer context makes an EXISTING suggestion more precise or more actionable, return it with its SAME "id" and improved "text". This UPDATES it in place — never emit a near-duplicate of something that already exists.
- Only create a NEW suggestion ("id": null) for a genuinely new idea not already covered.
- Do NOT return existing suggestions that are unchanged.
- Only propose a "command" when running something on Robin's machine is clearly useful and safe.
Each item: {"id": <existing id or null>, "type": "ask"|"do"|"note"|"command", "text": "<under 14 words; for command, the exact shell command>"}. Respond ONLY with a JSON array (it may be empty). No prose.`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    const valid: SugType[] = ["ask", "do", "note", "command"];
    return arr.filter((x: any) => x?.text).slice(0, 6).map((x: any) => ({
      id: typeof x.id === "number" ? x.id : null,
      type: valid.includes(x.type) ? x.type : (TYPE_MAP[x.type] || "note"),
      text: String(x.text),
    }));
  } catch { return []; }
}

// Live "Say this" answer, streamed token-by-token via onDelta so the UI shows it
// being formulated. Resolves with the final text ("—" when no response is needed).
export async function streamLiveAnswer(
  ctx: string, key: string, context: string, model: string,
  onDelta: (partial: string) => void,
): Promise<string> {
  const sys = `You are Robin's live meeting copilot. Always draft, in Robin's own first-person voice, the single best thing Robin could say right now — ready to read aloud (1-3 sentences). Frame everything from Robin's perspective. Look at the most recent turns: if someone asked Robin something, answer it directly; otherwise give Robin's natural next line to move the conversation forward. Always produce a usable response — never decline, never output a dash or placeholder. No preamble, no labels.${context ? ` Context: ${context}` : ""}`;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5173", "X-Title": "Fireflies Live" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], max_tokens: 400, temperature: 0.7, stream: true }),
  });
  if (!r.ok || !r.body) return "";
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ""; let full = "";
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
  return full.trim();
}

export async function proposeModes(ctx: string, key: string, model: string): Promise<{ label: string; context: string }[]> {
  const sys = `You are configuring a real-time meeting copilot. From the transcript, infer the meeting type and the host's likely goal. Propose up to 4 distinct "agent modes" — each a short label plus a one-sentence context instruction. Respond ONLY as a JSON array: [{"label":"...","context":"..."}].`;
  const raw = await callAI([{ role: "system", content: sys }, { role: "user", content: `Transcript:\n${ctx}` }], key, model);
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
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
  onDelta: (text: string) => void,
): Promise<string> {
  // Dedicated /pi endpoint: fixed argv, no shell, provider keys injected server-side only.
  const res = await fetch("/bridge/pi", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken}` },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok || !res.body) return "";
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let raw = "";
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
