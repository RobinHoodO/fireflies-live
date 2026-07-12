// Localhost-only command bridge: lets the Fireflies Live frontend delegate shell
// work (incl. "PI" tasks) to the backend, with guardrails. Bound to 127.0.0.1 ONLY.
//
// Protocol (same-origin via Vite proxy /bridge/* → here):
//   GET  /health                      -> { ok: true }
//   POST /run { cmd, cwd? }           -> streamed newline-delimited JSON:
//                                          {type:"start"} {type:"out",data} {type:"err",data} {type:"exit",code}
//
// Guardrails: denylist of catastrophic patterns, output cap, audit log, loopback bind.
// This is a developer tool for the operator's OWN machine; the frontend additionally
// requires explicit confirmation before any command is sent.

import http from "node:http";
import { spawn } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT) || 8787;
const AUDIT = path.resolve(process.cwd(), "server", "audit.log");
const MAX_OUTPUT = 200_000; // bytes per run, then truncate
const MAX_MS = 120_000;     // hard timeout per command
const FILE_DIR = "/Users/robinsverd/Thrivbe-AI/content/meetings/transcripts";

// Catastrophic patterns we refuse outright. Not a security boundary against a
// determined operator (it's their machine) — a guard against fat-finger disasters.
const DENY = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\$HOME|\.)(\s|$)/i, // rm -rf / ~ . $HOME
  /\bmkfs\b/i, /\bdd\s+if=/i, /:\(\)\s*\{.*\};:/, // fork bomb
  /\bshutdown\b/i, /\breboot\b/i, /\bhalt\b/i,
  /\bchmod\s+-R\s+0?777\s+\//i,
  /\bgit\s+push\s+.*--force/i,
  /\b(curl|wget)\b.*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i, // pipe-to-shell
  />\s*\/dev\/sd[a-z]/i,
];

function denied(cmd) {
  return DENY.find((re) => re.test(cmd));
}

function send(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

// Per-session shared secret, injected by the Vite bridge plugin. Fail closed if absent.
const TOKEN = process.env.BRIDGE_TOKEN || "";

// Only forward a minimal, explicit env to spawned commands — never the whole process
// env (which can carry API keys / secrets). The generic /run path gets NO secrets.
function childEnv() {
  const allow = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TZ", "PWD"];
  const env = {};
  for (const k of allow) if (process.env[k] != null) env[k] = process.env[k];
  return env;
}

// LLM provider credentials, injected ONLY for the dedicated /pi endpoint (fixed argv,
// no shell) so the in-app assistant can authenticate. Never reaches arbitrary /run
// commands, so a chained shell command can't read them.
const PI_ENV_KEYS = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_API", "DEEPSEEK_API_KEY",
  "MINIMAX_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "PI_API_KEY", "PI_OFFLINE",
];
function piEnv() {
  const env = childEnv();
  for (const k of PI_ENV_KEYS) if (process.env[k] != null) env[k] = process.env[k];
  return env;
}

// Stream a spawned child's stdout/stderr/exit to the NDJSON response, with an output
// cap and hard timeout. Shared by /run and /pi.
function streamChild(res, child) {
  let bytes = 0, killed = false;
  const cap = (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT && !killed) { killed = true; child.kill("SIGKILL"); return "\n[output truncated]\n"; }
    return chunk.toString();
  };
  const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, MAX_MS);
  child.stdout.on("data", (c) => { if (!killed) send(res, { type: "out", data: cap(c) }); });
  child.stderr.on("data", (c) => { if (!killed) send(res, { type: "err", data: cap(c) }); });
  child.on("close", (code) => { clearTimeout(timer); send(res, { type: "exit", code: killed ? 137 : code }); res.end(); });
  child.on("error", (e) => { clearTimeout(timer); send(res, { type: "err", data: String(e.message) }); send(res, { type: "exit", code: 1 }); res.end(); });
}

const server = http.createServer((req, res) => {
  // NO CORS headers on purpose: the frontend reaches us same-origin via the Vite
  // /bridge proxy, so the browser never calls us cross-origin. Omitting
  // Access-Control-Allow-Origin means any cross-origin request (incl. a drive-by
  // page or DNS-rebinding attack) is blocked by the browser before /run executes.
  if (req.method === "OPTIONS") { res.writeHead(403); res.end(); return; }

  // Defeat DNS rebinding: accept only loopback Host headers.
  const host = req.headers.host;
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) { res.writeHead(403); res.end("bad host"); return; }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  if (req.method === "POST" && req.url === "/run") {
    // Auth: the shared secret proves the caller is our frontend (not a random page).
    // Requiring this custom header also forces a CORS preflight cross-origin, which fails.
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    // Reject non-JSON (a "simple" text/plain POST could otherwise skip preflight).
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      res.writeHead(415); res.end("json only"); return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on("end", async () => {
      // Always run in the bridge's own cwd (the project root). No caller-supplied cwd.
      let cmd = "";
      try { const j = JSON.parse(body); cmd = String(j.cmd || "").trim(); } catch {}
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });

      if (!cmd) { send(res, { type: "exit", code: 1, error: "empty command" }); res.end(); return; }
      const bad = denied(cmd);
      if (bad) {
        await appendFile(AUDIT, `${new Date().toISOString()} BLOCKED ${cmd}\n`).catch(() => {});
        send(res, { type: "err", data: `Blocked by guardrail (${bad}). Refused.` });
        send(res, { type: "exit", code: 126 });
        res.end();
        return;
      }

      await appendFile(AUDIT, `${new Date().toISOString()} RUN ${cmd}\n`).catch(() => {});
      send(res, { type: "start", cmd });

      // Closed stdin ("ignore") so non-interactive tools get EOF instead of blocking
      // forever on a never-written pipe. childEnv() carries NO secrets.
      streamChild(res, spawn(cmd, { shell: true, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] }));
    });
    return;
  }

  // Dedicated, locked-down endpoint for the in-app assistant. Fixed argv, NO shell,
  // so the forwarded provider keys can't be re-read by a chained/injected command.
  // Body: { message, sessionId }.
  if (req.method === "POST" && req.url === "/pi") {
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      res.writeHead(415); res.end("json only"); return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 100_000) req.destroy(); });
    req.on("end", async () => {
      let message = "", sessionId = "";
      try { const j = JSON.parse(body); message = String(j.message || ""); sessionId = String(j.sessionId || ""); } catch {}
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
      if (!message.trim()) { send(res, { type: "exit", code: 1, error: "empty message" }); res.end(); return; }
      // Session id is the only value that lands in argv besides the message; keep it strict.
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(sessionId)) { send(res, { type: "err", data: "bad session id" }); send(res, { type: "exit", code: 1 }); res.end(); return; }

      await appendFile(AUDIT, `${new Date().toISOString()} PI ${sessionId} ${message.slice(0, 200).replace(/\n/g, " ")}\n`).catch(() => {});
      send(res, { type: "start", cmd: "pi" });
      // No shell: args are passed as argv, so the message can never break out to the shell.
      streamChild(res, spawn("pi", ["--print", "--offline", "--session-id", sessionId, message], { env: piEnv(), stdio: ["ignore", "pipe", "pipe"] }));
    });
    return;
  }

  // Fixed destination for meeting records. The caller supplies content only, never a path.
  // Body: { title, markdown }.
  if (req.method === "POST" && req.url === "/file") {
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "json only" })); return;
    }
    let body = "", bytes = 0;
    req.on("data", (c) => { body += c; bytes += c.length; if (bytes > 2_000_000) req.destroy(); });
    req.on("end", async () => {
      let title, markdown;
      try { const j = JSON.parse(body); title = j.title; markdown = j.markdown; } catch {}
      if (typeof title !== "string" || typeof markdown !== "string" || !markdown.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "title and non-empty markdown required" })); return;
      }
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/^-+|-+$/g, "") || "meeting";
      const date = new Date().toISOString().slice(0, 10);
      let filename = "";
      for (let n = 1; n <= 50; n++) {
        const candidate = `${date}-${slug}-live${n === 1 ? "" : `-${n}`}.md`;
        if (!existsSync(path.join(FILE_DIR, candidate))) { filename = candidate; break; }
      }
      if (!filename) {
        res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "filename conflict" })); return;
      }
      const filePath = path.join(FILE_DIR, filename);
      try {
        await writeFile(filePath, markdown);
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "file write failed" })); return;
      }
      const bytes = Buffer.byteLength(markdown);
      await appendFile(AUDIT, `${new Date().toISOString()} FILE ${filename} (${bytes} bytes)\n`).catch(() => {});
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, path: filePath }));
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT} (loopback only)`);
});

// ponytail: denylist is a fat-finger guard, not a sandbox — operator has full
// shell on their own box by design. Upgrade to an allowlist if this ever ships
// beyond a single trusted local user.
