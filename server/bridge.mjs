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
import { appendFile } from "node:fs/promises";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT) || 8787;
const AUDIT = path.resolve(process.cwd(), "server", "audit.log");
const MAX_OUTPUT = 200_000; // bytes per run, then truncate
const MAX_MS = 120_000;     // hard timeout per command

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

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on("end", async () => {
      let cmd = "", cwd = process.cwd();
      try { const j = JSON.parse(body); cmd = String(j.cmd || "").trim(); if (j.cwd) cwd = String(j.cwd); } catch {}
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

      const child = spawn(cmd, { shell: true, cwd, env: process.env });
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
