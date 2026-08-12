import { readFileSync } from "node:fs";
import path from "node:path";
import { createMeetingStore } from "./meeting-store.mjs";
import { createSessionAuth } from "./session-auth.mjs";

const JSON_LIMIT = 6_000_000;

function readKey(env, name) {
  const match = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "").trim() : "";
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readJson(req, limit = JSON_LIMIT) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw Object.assign(new Error("request too large"), { statusCode: 413 });
  }
  try { return JSON.parse(body || "{}"); }
  catch { throw Object.assign(new Error("invalid json"), { statusCode: 400 }); }
}

function safeModel(value) {
  const model = String(value || "");
  if (!/^[A-Za-z0-9_.:/-]{1,160}$/.test(model)) throw Object.assign(new Error("invalid model"), { statusCode: 400 });
  return model;
}

function safeMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 60) throw Object.assign(new Error("invalid messages"), { statusCode: 400 });
  let bytes = 0;
  const messages = value.map(item => {
    const role = item?.role === "system" || item?.role === "assistant" ? item.role : "user";
    const content = String(item?.content || "");
    bytes += Buffer.byteLength(content);
    return { role, content };
  });
  if (bytes > 1_000_000) throw Object.assign(new Error("messages too large"), { statusCode: 413 });
  return messages;
}

async function pipeResponse(upstream, res, contentType) {
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || contentType,
    "Cache-Control": "no-store",
  });
  if (!upstream.body) { res.end(); return; }
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

function responseSignal(res, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  res.on("close", () => { clearTimeout(timer); controller.abort(); });
  return controller.signal;
}

async function defaultRealtime(meetingId, token) {
  const { io } = await import("socket.io-client");
  return io("wss://api.fireflies.ai", {
    path: "/ws/realtime",
    transports: ["websocket"],
    auth: { token: `Bearer ${token}`, transcriptId: meetingId },
  });
}

export function createAppApi({
  envFile,
  bridgeToken,
  bridgeOrigin = "http://127.0.0.1:8787",
  recordsDir,
  fetchImpl = fetch,
  realtime = defaultRealtime,
  meetingStore = createMeetingStore({ recordsDir }),
  requireAuth = false,
  secureCookie = false,
  sessionTtlMs,
}) {
  const loadSecrets = () => {
    let env = "";
    try { env = readFileSync(envFile, "utf8"); } catch { /* unavailable providers stay offline */ }
    return {
      fireflies: process.env.FIREFLY_API_KEY || readKey(env, "FIREFLY_API_KEY"),
      openRouter: process.env.OPENROUTER_API || process.env.OPENROUTER_API_KEY || readKey(env, "OPENROUTER_API") || readKey(env, "OPENROUTER_API_KEY"),
      appSecret: process.env.FIREFLIES_APP_SECRET || readKey(env, "FIREFLIES_APP_SECRET"),
      allowedTailscaleLogins: new Set((process.env.FIREFLIES_ALLOWED_TAILSCALE_LOGINS || readKey(env, "FIREFLIES_ALLOWED_TAILSCALE_LOGINS")).split(",").map(value => value.trim().toLowerCase()).filter(Boolean)),
      allowedProcessors: new Set((process.env.FIREFLIES_ALLOWED_DATA_PROCESSORS || readKey(env, "FIREFLIES_ALLOWED_DATA_PROCESSORS")).split(",").map(value => value.trim().toLowerCase()).filter(Boolean)),
    };
  };
  const auth = createSessionAuth({
    loadSecret: () => loadSecrets().appSecret,
    loadAllowedLogins: () => loadSecrets().allowedTailscaleLogins,
    required: requireAuth,
    secureCookie,
    ...(sessionTtlMs ? { sessionTtlMs } : {}),
  });
  const providerAllowed = (secrets, provider) => secrets.allowedProcessors.has(provider);

  async function bridge(req, res, route, stream = false) {
    if (!bridgeToken) { json(res, 503, { ok: false, error: "bridge unavailable" }); return; }
    const body = req.method === "POST" ? await readJson(req, 300_000) : undefined;
    const upstream = await fetchImpl(`${bridgeOrigin}/${route}`, {
      method: req.method,
      headers: req.method === "POST" ? { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken}` } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: responseSignal(res, stream ? 125_000 : 10_000),
    });
    await pipeResponse(upstream, res, stream ? "application/x-ndjson" : "application/json");
  }

  async function route(req, res, url) {
    const secrets = loadSecrets();

    if (req.method === "GET" && url.pathname === "/api/config") {
      json(res, 200, {
        firefliesAvailable: !!secrets.fireflies && providerAllowed(secrets, "fireflies"),
        openRouterAvailable: !!secrets.openRouter && providerAllowed(secrets, "openrouter"),
        bridgeAvailable: !!bridgeToken,
        providerPolicyConfigured: secrets.allowedProcessors.size > 0,
        blockedProviders: [
          ...(secrets.fireflies && !providerAllowed(secrets, "fireflies") ? ["fireflies"] : []),
          ...(secrets.openRouter && !providerAllowed(secrets, "openrouter") ? ["openrouter"] : []),
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fireflies/meetings") {
      if (!providerAllowed(secrets, "fireflies")) { json(res, 403, { meetings: [], error: "Fireflies data processing is not approved" }); return; }
      if (!secrets.fireflies) { json(res, 503, { meetings: [], error: "Fireflies unavailable" }); return; }
      const query = "query { active_meetings { id title start_time end_time organizer_email } }";
      const upstream = await fetchImpl("https://api.fireflies.ai/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${secrets.fireflies}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: responseSignal(res, 12_000),
      });
      await pipeResponse(upstream, res, "application/json");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fireflies/live") {
      const meetingId = String(url.searchParams.get("meetingId") || "").trim();
      if (!providerAllowed(secrets, "fireflies")) { json(res, 403, { error: "Fireflies data processing is not approved" }); return; }
      if (!secrets.fireflies || !meetingId || meetingId.length > 240) { json(res, 400, { error: "invalid live meeting request" }); return; }
      const socket = await realtime(meetingId, secrets.fireflies);
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", Connection: "keep-alive" });
      let closed = false;
      const send = (value) => { if (!closed && !res.destroyed) res.write(`${JSON.stringify(value)}\n`); };
      const finish = () => { if (closed) return; closed = true; try { socket.disconnect(); } catch { /* already gone */ } if (!res.destroyed) res.end(); };
      res.on("close", finish);
      socket.on("auth.failed", () => { send({ type: "status", status: "error" }); finish(); });
      socket.on("connection.established", () => send({ type: "status", status: "connected" }));
      socket.on("connection.error", () => { send({ type: "status", status: "error" }); finish(); });
      socket.on("transcription.broadcast", (data) => {
        const payload = data?.payload ?? data;
        const text = String(payload?.text || "");
        if (!text) return;
        send({ type: "line", speaker: String(payload?.speaker_name || "Speaker"), text, final: true, key: `c${String(payload?.chunk_id || "")}` });
      });
      socket.on("disconnect", () => { send({ type: "status", status: "disconnected" }); finish(); });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/ai/chat" || url.pathname === "/api/ai/stream")) {
      if (!providerAllowed(secrets, "openrouter")) { json(res, 403, { error: { message: "OpenRouter data processing is not approved" } }); return; }
      if (!secrets.openRouter) { json(res, 503, { error: { message: "OpenRouter unavailable" } }); return; }
      const body = await readJson(req);
      const stream = url.pathname.endsWith("/stream");
      const providerBody = {
        model: safeModel(body.model),
        messages: safeMessages(body.messages),
        max_tokens: Math.max(1, Math.min(Number(body.maxTokens) || 400, 4000)),
        temperature: Math.max(0, Math.min(Number(body.temperature) || 0.7, 1.5)),
        ...(stream ? { stream: true } : {}),
      };
      const upstream = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${secrets.openRouter}`, "Content-Type": "application/json", "HTTP-Referer": "https://fireflies-live.thrivbe.local", "X-Title": "Fireflies Live" },
        body: JSON.stringify(providerBody),
        signal: responseSignal(res, stream ? 120_000 : 45_000),
      });
      await pipeResponse(upstream, res, stream ? "text/event-stream" : "application/json");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/health") { await bridge(req, res, "health"); return; }
    if (req.method === "POST" && url.pathname === "/api/bridge/context") { await bridge(req, res, "context"); return; }
    if (req.method === "POST" && url.pathname === "/api/bridge/pi") { await bridge(req, res, "pi", true); return; }

    if (req.method === "POST" && url.pathname === "/api/meeting/checkpoint") {
      const body = await readJson(req);
      json(res, 200, await meetingStore.checkpoint({
        sessionId: body.sessionId,
        sequence: body.sequence,
        title: body.title,
        meetingId: body.meetingId,
        markdown: body.markdown,
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/meeting/finalize") {
      const body = await readJson(req);
      const result = await meetingStore.finalize({ sessionId: body.sessionId, title: body.title, meetingId: body.meetingId, markdown: body.markdown });
      json(res, 200, { ...result, path: result.path ? path.basename(result.path) : undefined });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/meeting/interrupted") {
      json(res, 200, { sessions: await meetingStore.listInterrupted() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/meeting/recover") {
      const body = await readJson(req);
      const result = await meetingStore.recover(body.sessionId);
      json(res, 200, { ...result, path: result.path ? path.basename(result.path) : undefined });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/meeting/discard") {
      const body = await readJson(req);
      json(res, 200, await meetingStore.discard(body.sessionId));
      return;
    }

    json(res, 404, { error: "not found" });
  }

  return (req, res) => {
    const url = new URL(req.url || "/", "http://fireflies-live.local");
    if (!url.pathname.startsWith("/api/")) return false;
    const fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") { json(res, 403, { error: "forbidden" }); return true; }
    if (req.method === "OPTIONS") { json(res, 403, { error: "forbidden" }); return true; }
    if (req.method === "POST" && !String(req.headers["content-type"] || "").includes("application/json")) { json(res, 415, { error: "json only" }); return true; }
    if (req.method === "GET" && url.pathname === "/api/auth/status") { json(res, 200, auth.status(req)); return true; }
    if (req.method === "POST" && url.pathname === "/api/auth/session") {
      const result = auth.bootstrap(req);
      if (result.cookie) res.setHeader("Set-Cookie", result.cookie);
      json(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const result = auth.logout(req);
      res.setHeader("Set-Cookie", result.cookie);
      json(res, result.status, result.body);
      return true;
    }
    const authState = auth.current(req);
    if (!authState.authenticated) {
      json(res, authState.configured ? 401 : 503, { error: authState.configured ? "authentication required" : "application auth is not configured" });
      return true;
    }
    route(req, res, url).catch(error => {
      if (res.headersSent) { if (!res.destroyed) res.end(); return; }
      json(res, error?.statusCode || 502, { error: error?.message || "request failed" });
    });
    return true;
  };
}

export const __test = { readKey, safeModel, safeMessages };
