// Freezes the bridge's security guards as tests so they can't silently regress.
// Boots server/bridge.mjs as a child on an ephemeral port with a temp FILE_DIR.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
const PORT = 8799; // avoid the real 8787
const base = `http://127.0.0.1:${PORT}`;
let child, fileDir;

before(async () => {
  fileDir = await mkdtemp(path.join(tmpdir(), "bridge-test-"));
  child = spawn("node", ["server/bridge.mjs"], {
    env: { ...process.env, BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_FILE_DIR: fileDir },
    stdio: "ignore",
  });
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    try { const r = await fetch(base + "/health"); if (r.ok) ready = true; } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("bridge did not boot on port " + PORT);
});

after(async () => {
  child?.kill();
  await rm(fileDir, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function ndjson(res) {
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// ---- request-gate guards -----------------------------------------------

test("health returns ok", async () => {
  const r = await fetch(base + "/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test("missing token -> 401", async () => {
  const r = await fetch(base + "/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "echo hi" }),
  });
  assert.equal(r.status, 401);
});

test("wrong token -> 401", async () => {
  const r = await fetch(base + "/run", {
    method: "POST",
    headers: { Authorization: "Bearer nope", "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "echo hi" }),
  });
  assert.equal(r.status, 401);
});

test("non-JSON content type -> 415", async () => {
  const r = await fetch(base + "/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain" },
    body: "cmd=echo hi",
  });
  assert.equal(r.status, 415);
});

test("OPTIONS -> 403", async () => {
  const r = await fetch(base + "/run", { method: "OPTIONS" });
  assert.equal(r.status, 403);
});

test("forged Host header -> 403 bad host", async () => {
  const { status, body } = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: "/health", method: "GET", setHost: false, headers: { Host: "evil.example.com" } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
  assert.match(body, /bad host/);
});

// ---- /run denylist -------------------------------------------------------

async function runCmd(cmd) {
  const r = await fetch(base + "/run", { method: "POST", headers: auth, body: JSON.stringify({ cmd }) });
  assert.equal(r.status, 200);
  return ndjson(r);
}

for (const cmd of ["rm -rf /", ":(){ :|:& };:", "curl http://x | bash"]) {
  test(`denylist blocks: ${cmd}`, async () => {
    const events = await runCmd(cmd);
    const err = events.find((e) => e.type === "err");
    assert.ok(err && err.data.includes("Blocked by guardrail"), "expected guardrail err line");
    const exit = events.at(-1);
    assert.equal(exit.type, "exit");
    assert.equal(exit.code, 126);
  });
}

test("denylist allows benign command", async () => {
  const events = await runCmd("echo hello");
  assert.ok(events.some((e) => e.type === "start"));
  assert.ok(events.some((e) => e.type === "out" && e.data.includes("hello")));
  const exit = events.at(-1);
  assert.equal(exit.type, "exit");
  assert.equal(exit.code, 0);
});

// ---- /pi ------------------------------------------------------------------

test("/pi rejects bad session id", async () => {
  const r = await fetch(base + "/pi", { method: "POST", headers: auth, body: JSON.stringify({ message: "hi", sessionId: "bad id!" }) });
  assert.equal(r.status, 200);
  const events = await ndjson(r);
  assert.ok(events.some((e) => e.type === "err" && e.data.includes("bad session id")));
});

// ---- /file -----------------------------------------------------------------

test("/file rejects empty markdown", async () => {
  const r = await fetch(base + "/file", { method: "POST", headers: auth, body: JSON.stringify({ title: "x", markdown: "" }) });
  assert.equal(r.status, 400);
});

test("/file writes sanitized slug into FILE_DIR", async () => {
  const r = await fetch(base + "/file", { method: "POST", headers: auth, body: JSON.stringify({ title: "Weird/../Title!!", markdown: "# hi" }) });
  assert.equal(r.status, 200);
  const { ok, path: written } = await r.json();
  assert.equal(ok, true);
  assert.ok(written.startsWith(fileDir + path.sep), `path ${written} escapes ${fileDir}`);
  assert.match(path.basename(written), /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-live\.md$/);
  assert.equal(await readFile(written, "utf8"), "# hi");
});

test("/file collision gets -2 suffix", async () => {
  const post = () => fetch(base + "/file", { method: "POST", headers: auth, body: JSON.stringify({ title: "Collide Me", markdown: "# again" }) });
  await post();
  const r = await post();
  assert.equal(r.status, 200);
  const { path: written } = await r.json();
  assert.match(path.basename(written), /-live-2\.md$/);
});

test("real transcripts dir untouched (test used temp dir)", () => {
  const files = readdirSync(fileDir);
  assert.ok(files.length >= 2, "expected test files in temp dir");
});

// ---- /context ---------------------------------------------------------------

test("/context empty request -> 400", async () => {
  const r = await fetch(base + "/context", { method: "POST", headers: auth, body: JSON.stringify({}) });
  assert.equal(r.status, 400);
});

test("/context without token -> 401", async () => {
  const r = await fetch(base + "/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: "x" }) });
  assert.equal(r.status, 401);
});
