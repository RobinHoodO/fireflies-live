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
import { appendFile, writeFile, readFile, readdir, stat, realpath } from "node:fs/promises";
import { existsSync, statSync, renameSync, readFileSync } from "node:fs";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT) || 8787;
const AUDIT = process.env.BRIDGE_AUDIT_FILE || path.resolve(process.cwd(), "server", "audit.log");
// Audit metadata only by default — the log otherwise accumulates meeting content
// and operator queries at rest. Opt into body logging for debugging.
const AUDIT_BODIES = process.env.BRIDGE_AUDIT_BODIES === "1";
// Rotate at boot: one .1 rollover caps disk growth (bridge restarts with every
// dev-server boot, so boot-time-only is enough; no per-write stat cost).
const AUDIT_MAX = Number(process.env.BRIDGE_AUDIT_MAX_BYTES) || 5_000_000;
try { if (statSync(AUDIT).size > AUDIT_MAX) renameSync(AUDIT, `${AUDIT}.1`); } catch { /* no log yet */ }
const MAX_OUTPUT = 200_000; // bytes per run, then truncate
const MAX_MS = 120_000;     // hard timeout per command
const FILE_DIR = process.env.BRIDGE_FILE_DIR || "/Users/robinsverd/Thrivbe-AI/content/meetings/transcripts";
const SEM = "http://127.0.0.1:3015/search";
const CONTENT_ROOT = process.env.BRIDGE_CONTENT_ROOT || "/Users/robinsverd/Thrivbe-AI/content";
const CLIENTS_ROOT = process.env.BRIDGE_CLIENTS_ROOT || "/Users/robinsverd/Thrivbe-AI/clients";

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
// Symlink-safe path rooting. First-level entries under a root may themselves be
// operator-curated symlinks (e.g. clients/Katapult Future Fest -> ~/Katapult…),
// so the check is: the target's REAL path must live inside the REAL path of its
// first-level folder. A symlink planted deeper that points outside is rejected.
const rootedPath = async (root, target) => {
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(`${root}/`)) return "";
  const firstSegment = resolved.slice(root.length + 1).split("/")[0];
  try {
    const baseReal = await realpath(path.join(root, firstSegment));
    const real = await realpath(resolved);
    return real === baseReal || real.startsWith(`${baseReal}/`) ? resolved : "";
  } catch { return ""; } // nonexistent path — callers already treat "" as skip
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

// The command interface runs `claude` headless IN the Thrivbe workspace, so it
// can see the repo it is being asked to act on. A fresh instance per message —
// the meeting context travels in the prompt, not in a resumed session.
const WORKSPACE = process.env.BRIDGE_WORKSPACE || path.dirname(CONTENT_ROOT);
const CLAUDE_MODEL = process.env.BRIDGE_CLAUDE_MODEL || "sonnet";
// bypassPermissions, by Robin's decision (2026-08-04): mid-meeting there is
// nobody to answer a permission prompt, and a headless `claude -p` that stops
// to ask is useless. The gate is human and upstream — every command is staged
// into the composer, read, and sent by hand. The denylist below still applies.
const CLAUDE_PERMISSION_MODE = process.env.BRIDGE_CLAUDE_PERMISSION_MODE || "bypassPermissions";
// Startup orientation for every Claude instance: what Fireflies Live is and
// where the workspace keeps its context. Edited as prose, not code.
const CLAUDE_CONTEXT_FILE = process.env.BRIDGE_CLAUDE_CONTEXT_FILE || path.resolve(process.cwd(), "server", "claude-context.md");
const CLAUDE_CONTEXT = (() => {
  try { return readFileSync(CLAUDE_CONTEXT_FILE, "utf8").replace(/^#.*$/gm, "").trim(); }
  catch { return ""; } // missing file just means no extra context, not a broken bridge
})();

// Stream a spawned child's stdout/stderr/exit to the NDJSON response, with an output
// cap and hard timeout. Shared by /run and /pi.
function streamChild(res, child) {
  let bytes = 0, killed = false, exited = false;
  const cap = (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT && !killed) { killed = true; child.kill("SIGKILL"); return "\n[output truncated]\n"; }
    return chunk.toString();
  };
  const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, MAX_MS);
  // Client gone (fetch aborted, tab closed): stop the child instead of streaming
  // into a dead socket for up to MAX_MS.
  res.on("close", () => { if (!exited && !killed) { killed = true; clearTimeout(timer); child.kill("SIGKILL"); } });
  child.stdout.on("data", (c) => { if (!killed) send(res, { type: "out", data: cap(c) }); });
  child.stderr.on("data", (c) => { if (!killed) send(res, { type: "err", data: cap(c) }); });
  child.on("close", (code) => { exited = true; clearTimeout(timer); send(res, { type: "exit", code: killed ? 137 : code }); res.end(); });
  child.on("error", (e) => { exited = true; clearTimeout(timer); send(res, { type: "err", data: String(e.message) }); send(res, { type: "exit", code: 1 }); res.end(); });
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
        await appendFile(AUDIT, `${new Date().toISOString()} BLOCKED pattern=${bad}${AUDIT_BODIES ? ` ${cmd}` : ""}\n`).catch(() => {});
        send(res, { type: "err", data: `Blocked by guardrail (${bad}). Refused.` });
        send(res, { type: "exit", code: 126 });
        res.end();
        return;
      }

      await appendFile(AUDIT, `${new Date().toISOString()} RUN ${AUDIT_BODIES ? cmd : `${Buffer.byteLength(cmd)} bytes`}\n`).catch(() => {});
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

      // Same catastrophic-pattern guard as /run: PI messages can carry
      // transcript-derived commands, so they get no weaker a gate.
      const bad = denied(message);
      if (bad) {
        await appendFile(AUDIT, `${new Date().toISOString()} PI-BLOCKED ${sessionId} pattern=${bad}${AUDIT_BODIES ? ` ${message.slice(0, 120).replace(/\n/g, " ")}` : ""}\n`).catch(() => {});
        send(res, { type: "err", data: `Blocked by guardrail (${bad}). Refused.` });
        send(res, { type: "exit", code: 126 });
        res.end();
        return;
      }

      await appendFile(AUDIT, `${new Date().toISOString()} CLAUDE ${sessionId} ${AUDIT_BODIES ? message.slice(0, 200).replace(/\n/g, " ") : `${Buffer.byteLength(message)} bytes`}\n`).catch(() => {});
      send(res, { type: "start", cmd: `claude (${CLAUDE_MODEL}) in ${WORKSPACE}` });
      // No shell: args are passed as argv, so the message can never break out to
      // the shell. A fresh instance per message, rooted in the workspace so it
      // can actually see the repo it is being asked to act on.
      const argv = ["-p", message, "--model", CLAUDE_MODEL, "--permission-mode", CLAUDE_PERMISSION_MODE];
      if (CLAUDE_CONTEXT) argv.push("--append-system-prompt", CLAUDE_CONTEXT);
      streamChild(res, spawn("claude", argv, { cwd: WORKSPACE, env: piEnv(), stdio: ["ignore", "pipe", "pipe"] }));
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
        const fullPath = await rootedPath(CONTENT_ROOT, hitPath);
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
          // Counterpart (who the call is with) is the primary match source; topic/goal
          // only fall back when it's empty. Whole-word token matches only — a generic
          // goal word like "website" must never pull an unrelated client's private
          // prep into this call's context. A lone goal word selects nothing: without
          // a counterpart, only a topic token may pick a folder.
          const norm = (s) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 3) || [];
          const idWords = norm(counterpart);
          const candidateWords = idWords.length ? idWords : [...norm(topic), ...norm(goal)];
          const counterpartLc = counterpart.toLowerCase();
          const folders = await readdir(CLIENTS_ROOT, { withFileTypes: true });
          const scoredFolders = folders
            .filter((entry) => entry.isDirectory())
            .map((entry) => {
              const folderTokens = new Set(norm(entry.name));
              const score = candidateWords.filter((word) => folderTokens.has(word)).length
                + (counterpartLc && counterpartLc.includes(entry.name.toLowerCase()) ? 1 : 0);
              return { entry, folderTokens, score };
            })
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score);
          const best = scoredFolders[0];
          const folder = best && (idWords.length || norm(topic).some((word) => best.folderTokens.has(word))) ? best.entry : undefined;
          if (folder) {
            const dirPath = await rootedPath(CLIENTS_ROOT, folder.name);
            if (dirPath) {
              const entries = await readdir(dirPath, { withFileTypes: true });
              const names = entries.slice(0, 15).map((entry) => entry.name);

              // Every top-level .md, plus one level into each subfolder (e.g. meetings/, research/).
              const mdPaths = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => path.join(folder.name, e.name));
              for (const sub of entries.filter((e) => e.isDirectory())) {
                try {
                  const subEntries = await readdir(await rootedPath(CLIENTS_ROOT, path.join(folder.name, sub.name)), { withFileTypes: true });
                  for (const e of subEntries.filter((e) => e.isFile() && e.name.endsWith(".md"))) {
                    mdPaths.push(path.join(folder.name, sub.name, e.name));
                  }
                } catch { /* unreadable subfolder */ }
              }

              const files = [];
              for (const relPath of mdPaths.slice(0, 8)) {
                const fullPath = await rootedPath(CLIENTS_ROOT, relPath);
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
      await appendFile(AUDIT, `${new Date().toISOString()} CTX ${AUDIT_BODIES ? `${counterpart || "-"} | ${(topic || goal || "").slice(0, 60)} | ` : ""}sources=${sources.map((source) => `${source.kind}:${source.n}`).join(",")}\n`).catch(() => {});
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
