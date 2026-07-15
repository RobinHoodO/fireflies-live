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
import { appendFile, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT) || 8787;
const AUDIT = path.resolve(process.cwd(), "server", "audit.log");
const MAX_OUTPUT = 200_000; // bytes per run, then truncate
const MAX_MS = 120_000;     // hard timeout per command
const FILE_DIR = process.env.BRIDGE_FILE_DIR || "/Users/robinsverd/Thrivbe-AI/content/meetings/transcripts";
const SEM = "http://127.0.0.1:3015/search";
const CONTENT_ROOT = "/Users/robinsverd/Thrivbe-AI/content";
const CLIENTS_ROOT = "/Users/robinsverd/Thrivbe-AI/clients";

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

async function semsearch(query, k, corpus) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(SEM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, k, corpus }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`semsearch ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.results) ? data.results : [];
  } finally {
    clearTimeout(timer);
  }
}

const scored = (rows) => rows.filter((row) => typeof row?.score === "number" && row.score >= 0.35);
const rootedPath = (root, target) => {
  const resolved = path.resolve(root, target);
  return resolved.startsWith(`${root}/`) ? resolved : "";
};

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

  // Assemble a compact, on-demand context bundle from Robin's local corpora.
  // Body: { goal?, counterpart?, topic? }.
  if (req.method === "POST" && req.url === "/context") {
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "json only" })); return;
    }
    let body = "", bytes = 0;
    req.on("data", (c) => { body += c; bytes += c.length; if (bytes > 20_000) req.destroy(); });
    req.on("end", async () => {
      let goal = "", counterpart = "", topic = "";
      try {
        const j = JSON.parse(body);
        goal = typeof j.goal === "string" ? j.goal.trim() : "";
        counterpart = typeof j.counterpart === "string" ? j.counterpart.trim() : "";
        topic = typeof j.topic === "string" ? j.topic.trim() : "";
      } catch { /* invalid JSON is an empty request */ }
      if (!goal && !counterpart && !topic) {
        res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "empty request" })); return;
      }

      const searches = [];
      if (counterpart) searches.push(["people", semsearch(counterpart, 3, "people")]);
      const meetingQuery = [counterpart, topic || goal].filter(Boolean).join(" ");
      if (meetingQuery) searches.push(["meetings", semsearch(meetingQuery, 6, "meetings")]);
      const topicQuery = topic || goal;
      if (topicQuery) {
        searches.push(["wiki", semsearch(topicQuery, 6, "wiki_skills")]);
        searches.push(["notion", semsearch(topicQuery, 4, "notion")]);
      }
      const settled = await Promise.allSettled(searches.map(([, search]) => search));
      const hits = {};
      settled.forEach((result, i) => { if (result.status === "fulfilled") hits[searches[i][0]] = scored(result.value); });

      const meetingPaths = [];
      const seenPaths = new Set();
      for (const hit of hits.meetings || []) {
        if (typeof hit.path !== "string" || seenPaths.has(hit.path)) continue;
        seenPaths.add(hit.path);
        meetingPaths.push(hit.path);
        if (meetingPaths.length >= 2) break;
      }
      const meetingFiles = [];
      for (const hitPath of meetingPaths) {
        const fullPath = rootedPath(CONTENT_ROOT, hitPath);
        if (!fullPath) continue;
        try {
          const st = await stat(fullPath);
          if (st.size > 2_000_000) continue;
          const content = await readFile(fullPath, "utf8");
          meetingFiles.push({ path: hitPath, excerpt: content.length > 2500 ? `${content.slice(0, 2500)}\n…[truncated]` : content });
        } catch { /* stale or unreadable search hit */ }
      }

      let client = null;
      {
        try {
          // Match against counterpart, topic, AND goal — a client name typed only into
          // the goal field (e.g. "Toniic website creation…") should still resolve.
          const words = [counterpart, topic, goal].join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 3) || [];
          const folders = await readdir(CLIENTS_ROOT, { withFileTypes: true });
          const folder = folders.find((entry) => entry.isDirectory() && words.some((word) => entry.name.toLowerCase().includes(word)));
          if (folder) {
            const dirPath = rootedPath(CLIENTS_ROOT, folder.name);
            if (dirPath) {
              const entries = await readdir(dirPath, { withFileTypes: true });
              const names = entries.slice(0, 15).map((entry) => entry.name);

              // Every top-level .md, plus one level into each subfolder (e.g. meetings/, research/).
              const mdPaths = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => path.join(folder.name, e.name));
              for (const sub of entries.filter((e) => e.isDirectory())) {
                try {
                  const subEntries = await readdir(rootedPath(CLIENTS_ROOT, path.join(folder.name, sub.name)), { withFileTypes: true });
                  for (const e of subEntries.filter((e) => e.isFile() && e.name.endsWith(".md"))) {
                    mdPaths.push(path.join(folder.name, sub.name, e.name));
                  }
                } catch { /* unreadable subfolder */ }
              }

              const files = [];
              for (const relPath of mdPaths.slice(0, 8)) {
                const fullPath = rootedPath(CLIENTS_ROOT, relPath);
                if (!fullPath) continue;
                try {
                  const st = await stat(fullPath);
                  if (st.size > 2_000_000) continue;
                  const content = await readFile(fullPath, "utf8");
                  files.push({ path: relPath, excerpt: content.length > 1200 ? `${content.slice(0, 1200)}\n…[truncated]` : content });
                } catch { /* stale entry */ }
              }
              client = { dirname: folder.name, names, files };
            }
          }
        } catch { /* client corpus is optional */ }
      }

      const sections = [];
      const sourceFor = [];
      // Client folder first: it's the operator's own curated prep for this exact
      // counterpart, so it must never lose the size budget to semsearch hits.
      if (client) {
        const fileBlock = client.files.map((f) => `### ${f.path}\n${f.excerpt}`).join("\n\n");
        sections.push(`## 📁 Client folder\n${client.dirname}: ${client.names.join(", ")}${fileBlock ? `\n\n${fileBlock}` : ""}`);
        sourceFor.push({ kind: "client", label: "client folder", n: client.files.length || 1 });
      }
      const people = hits.people || [];
      if (people.length) {
        sections.push(`## 🧑 People\n${people.map((hit) => `- ${hit.name || "Unknown"} — ${hit.headline || ""} · ${hit.company || ""} · ${hit.location || ""} (score ${hit.score.toFixed(2)})`).join("\n")}`);
        sourceFor.push({ kind: "people", label: "network", n: people.length });
      }
      if (meetingFiles.length) {
        sections.push(`## 📜 Meeting history\n${meetingFiles.map((file) => `### ${file.path}\n${file.excerpt}`).join("\n\n")}`);
        sourceFor.push({ kind: "meetings", label: "meetings", n: meetingFiles.length });
      }
      const wiki = (hits.wiki || []).filter((hit) => typeof hit.title === "string" && hit.title);
      if (wiki.length) {
        sections.push(`## 📚 Playbook signals\n${wiki.map((hit) => `- ${hit.title}`).join("\n")}`);
        sourceFor.push({ kind: "wiki", label: "playbooks", n: wiki.length });
      }
      const notion = (hits.notion || []).filter((hit) => typeof hit.title === "string" && hit.title);
      if (notion.length) {
        sections.push(`## 🧠 Knowledge base\n${notion.map((hit) => `- ${hit.title}`).join("\n")}`);
        sourceFor.push({ kind: "notion", label: "knowledge", n: notion.length });
      }
      let bundle = "";
      const sources = [];
      for (let i = 0; i < sections.length; i++) {
        const next = bundle ? `${bundle}\n\n${sections[i]}` : sections[i];
        if (next.length > 8000) continue; // skip oversized sections, smaller later ones may still fit
        bundle = next;
        sources.push(sourceFor[i]);
      }
      await appendFile(AUDIT, `${new Date().toISOString()} CTX ${counterpart || "-"} | ${(topic || goal || "").slice(0, 60)} | sources=${sources.map((source) => `${source.kind}:${source.n}`).join(",")}\n`).catch(() => {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sources.length ? { ok: true, bundle, sources } : { ok: false, error: "no sources reachable or no matches" }));
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
