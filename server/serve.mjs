// Production server: serves the built v2 app and owns the same-origin provider,
// meeting-store, and narrowly routed bridge API. It boots the localhost bridge
// as a child, like the Vite plugin does in dev. Meant to run on Thrivbe-1 behind
// Tailscale, NOT on the public net.
//
// Env: SERVE_PORT (default 3017), SERVE_HOST (bind addr, default 127.0.0.1),
//      SERVE_HOSTS (allowed Host headers, comma-separated, required),
//      SERVE_ENV_FILE (keys file, default /opt/Thrivbe-AI/.env),
//      FIREFLIES_APP_SECRET (required Robin-only login secret).

import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createAppApi } from "./app-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../v2/dist");
const PORT = Number(process.env.SERVE_PORT) || 3017;
const HOST = process.env.SERVE_HOST || "127.0.0.1";
const ENV_FILE = process.env.SERVE_ENV_FILE || "/opt/Thrivbe-AI/.env";
const ALLOWED_HOSTS = (process.env.SERVE_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".map": "application/json" };

// ── pure helpers (tested in serve.test.mjs) ─────────────────────────────────
export function hostAllowed(host, allowed) {
  return !!host && allowed.includes(host);
}
// Resolve a URL path inside DIST; "" when it would escape the root or the
// encoding is malformed (a lone "%" must 400, not throw and kill the server).
export function safeDistPath(urlPath, dist = DIST) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); } catch { return ""; }
  const clean = path.normalize(decoded).replace(/^\/+/, "");
  const full = path.resolve(dist, clean === "" ? "index.html" : clean);
  return full === dist || full.startsWith(`${dist}${path.sep}`) ? full : "";
}

// ── main (skipped when imported by tests) ───────────────────────────────────
if (process.env.SERVE_TEST !== "1") {
  if (ALLOWED_HOSTS.length === 0) { console.error("[serve] SERVE_HOSTS is required"); process.exit(1); }

  // Per-boot shared secret between the server API and bridge, same as dev.
  const bridgeToken = randomUUID();
  const bridge = spawn("node", [path.resolve(__dirname, "bridge.mjs")], { stdio: "inherit", env: { ...process.env, BRIDGE_TOKEN: bridgeToken } });
  const api = createAppApi({
    envFile: ENV_FILE,
    bridgeToken,
    recordsDir: process.env.BRIDGE_FILE_DIR || path.resolve(__dirname, "../../../content/meetings/transcripts"),
    requireAuth: true,
    secureCookie: process.env.FIREFLIES_APP_COOKIE_SECURE === "1",
    sessionTtlMs: Math.max(1, Math.min(Number(process.env.FIREFLIES_APP_SESSION_HOURS) || 12, 168)) * 60 * 60 * 1000,
  });
  // Bridge died → exit; systemd restarts the pair and OnFailure pings Telegram.
  bridge.on("close", (code) => { console.error(`[serve] bridge exited (${code})`); process.exit(1); });
  const kill = () => { try { bridge.kill(); } catch { /* already gone */ } };
  process.on("exit", kill); process.on("SIGINT", () => { kill(); process.exit(); }); process.on("SIGTERM", () => { kill(); process.exit(); });

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host, ALLOWED_HOSTS)) { res.writeHead(403); res.end("bad host"); return; }

    // Provider credentials and the broad bridge token stay server-side. The
    // browser receives only capability booleans and narrowly routed responses.
    if (api(req, res)) return;

    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    let file = safeDistPath(req.url || "/");
    if (!file) { res.writeHead(400); res.end(); return; }
    if (!existsSync(file)) file = path.join(DIST, "index.html"); // SPA fallback
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=86400" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });

  server.listen(PORT, HOST, () => console.log(`[serve] ${HOST}:${PORT} → ${DIST} (bridge :8787)`));
}
