// Production server: serves the built v2 app, injects keys, proxies /bridge/*
// to the localhost bridge (which it boots as a child, like the Vite plugin does
// in dev). Meant to run on Thrivbe-1 behind Tailscale, NOT on the public net.
//
// Env: SERVE_PORT (default 3017), SERVE_HOST (bind addr, default 127.0.0.1),
//      SERVE_HOSTS (allowed Host headers, comma-separated, required),
//      SERVE_ENV_FILE (keys file, default /opt/Thrivbe-AI/.env).

import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../v2/dist");
const PORT = Number(process.env.SERVE_PORT) || 3017;
const HOST = process.env.SERVE_HOST || "127.0.0.1";
const ENV_FILE = process.env.SERVE_ENV_FILE || "/opt/Thrivbe-AI/.env";
const ALLOWED_HOSTS = (process.env.SERVE_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean);
const BRIDGE = "127.0.0.1:8787";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".map": "application/json" };

// ── pure helpers (tested in serve.test.mjs) ─────────────────────────────────
export function hostAllowed(host, allowed) {
  return !!host && allowed.includes(host);
}
// Resolve a URL path inside DIST; "" when it would escape the root.
export function safeDistPath(urlPath, dist = DIST) {
  const clean = path.normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^\/+/, "");
  const full = path.resolve(dist, clean === "" ? "index.html" : clean);
  return full === dist || full.startsWith(`${dist}${path.sep}`) ? full : "";
}

function readKey(env, name) {
  const m = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "").trim() : "";
}

// ── main (skipped when imported by tests) ───────────────────────────────────
if (process.env.SERVE_TEST !== "1") {
  if (ALLOWED_HOSTS.length === 0) { console.error("[serve] SERVE_HOSTS is required"); process.exit(1); }

  // Per-boot shared secret between frontend and bridge, same as the dev plugin.
  const bridgeToken = randomUUID();
  const bridge = spawn("node", [path.resolve(__dirname, "bridge.mjs")], { stdio: "inherit", env: { ...process.env, BRIDGE_TOKEN: bridgeToken } });
  // Bridge died → exit; systemd restarts the pair and OnFailure pings Telegram.
  bridge.on("close", (code) => { console.error(`[serve] bridge exited (${code})`); process.exit(1); });
  const kill = () => { try { bridge.kill(); } catch { /* already gone */ } };
  process.on("exit", kill); process.on("SIGINT", () => { kill(); process.exit(); }); process.on("SIGTERM", () => { kill(); process.exit(); });

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host, ALLOWED_HOSTS)) { res.writeHead(403); res.end("bad host"); return; }

    // Key injection — same-origin gate mirrors the dev middleware: only the
    // app's own fetch (or a direct navigation) may read the keys.
    if (req.method === "GET" && req.url === "/api/fireflies-key") {
      // Chrome only sends Sec-Fetch-Site to secure contexts (HTTPS/localhost);
      // this app is plain HTTP on the tailnet, so ABSENT is normal — enforce
      // only when present. Cross-origin reads stay blocked by CORS (no ACAO)
      // and the tailnet-only firewall.
      const sfs = req.headers["sec-fetch-site"];
      if (sfs && sfs !== "same-origin" && sfs !== "none") { res.writeHead(403); res.end("forbidden"); return; }
      let env = "";
      try { env = readFileSync(ENV_FILE, "utf-8"); } catch { /* missing env file → empty keys */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ffKey: readKey(env, "FIREFLY_API_KEY"), orKey: readKey(env, "OPENROUTER_API"), bridgeToken }));
      return;
    }

    // Same-machine proxy to the bridge; Host rewritten so the bridge's
    // loopback-only Host check keeps holding (bridge itself is unchanged).
    if (req.url && req.url.startsWith("/bridge/")) {
      const up = http.request(
        { host: "127.0.0.1", port: 8787, path: req.url.slice("/bridge".length) || "/", method: req.method, headers: { ...req.headers, host: BRIDGE } },
        (upRes) => { res.writeHead(upRes.statusCode || 502, upRes.headers); upRes.pipe(res); },
      );
      up.on("error", () => { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "bridge offline" })); });
      req.pipe(up);
      return;
    }

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
