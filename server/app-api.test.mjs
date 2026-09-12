import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createAppApi } from "./app-api.mjs";

const FIREFLIES_SECRET = "ff-secret-canary";
const OPENROUTER_SECRET = "or-secret-canary";
const BRIDGE_SECRET = "bridge-secret-canary";
let dir;
let envFile;
let server;
let base;
const upstreamCalls = [];
const liveCalls = [];
let piAbortObserved = false;
const meetingStoreCalls = [];
// app-api prefers process.env over the env file, by design. A developer shell
// that exports a real provider key would therefore silently replace the canary
// and the "no credential reaches the browser" assertions would test the wrong
// secret. Own the environment for the duration of the run.
const OWNED_ENV = ["FIREFLY_API_KEY", "OPENROUTER_API", "OPENROUTER_API_KEY", "FIREFLIES_APP_SECRET", "FIREFLIES_ALLOWED_TAILSCALE_LOGINS", "FIREFLIES_ALLOWED_DATA_PROCESSORS"];
const savedEnv = new Map();

const meetingStore = {
  checkpoint: async () => ({ ok: true }),
  finalize: async (value) => { meetingStoreCalls.push(value); return { ok: true, path: "/private/meeting.md" }; },
  recover: async () => ({ ok: true, path: "/private/recovered.md" }),
  discard: async () => ({ ok: true }),
  listInterrupted: async () => [],
};

before(async () => {
  for (const name of OWNED_ENV) { savedEnv.set(name, process.env[name]); delete process.env[name]; }
  dir = await mkdtemp(path.join(tmpdir(), "fireflies-app-api-"));
  envFile = path.join(dir, ".env");
  await writeFile(envFile, `FIREFLY_API_KEY=${FIREFLIES_SECRET}\nOPENROUTER_API=${OPENROUTER_SECRET}\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n`);
  const fetchImpl = async (url, options = {}) => {
    upstreamCalls.push({ url: String(url), options });
    if (String(url).includes("fireflies.ai/graphql")) return new Response(JSON.stringify({ data: { active_meetings: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).includes("openrouter.ai")) return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/context")) return new Response(JSON.stringify({ ok: true, bundle: "safe" }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/health")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/pi")) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "out", data: "started" })}\n`));
          options.signal.addEventListener("abort", () => { piAbortObserved = true; controller.close(); }, { once: true });
        },
      }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  const realtime = async (meetingId, token) => {
    liveCalls.push({ meetingId, token });
    const socket = new EventEmitter();
    socket.disconnect = () => {};
    setTimeout(() => {
      socket.emit("connection.established");
      socket.emit("transcription.broadcast", { payload: { chunk_id: "7", speaker_name: "Robin", text: "Stay present" } });
      socket.emit("disconnect");
    }, 5);
    return socket;
  };
  const api = createAppApi({ envFile, bridgeToken: BRIDGE_SECRET, recordsDir: dir, fetchImpl, realtime, meetingStore });
  server = http.createServer((req, res) => { if (!api(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
  for (const [name, value] of savedEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});

test("browser config exposes capabilities, never raw credentials", async () => {
  const response = await fetch(`${base}/api/config`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { firefliesAvailable: true, openRouterAvailable: true, bridgeAvailable: true, providerPolicyConfigured: true, blockedProviders: [] });
  for (const secret of [FIREFLIES_SECRET, OPENROUTER_SECRET, BRIDGE_SECRET]) assert.ok(!text.includes(secret));
});

test("provider credentials are injected only on the server-side hop", async () => {
  const meetings = await fetch(`${base}/api/fireflies/meetings`);
  assert.equal(meetings.status, 200);
  assert.ok(!(await meetings.text()).includes(FIREFLIES_SECRET));
  const firefliesCall = upstreamCalls.find(call => call.url.includes("fireflies.ai/graphql"));
  assert.equal(firefliesCall.options.headers.Authorization, `Bearer ${FIREFLIES_SECRET}`);

  const ai = await fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "anthropic/test", messages: [{ role: "user", content: "hello" }], maxTokens: 12, rawProviderKey: "browser-smuggled-key" }),
  });
  assert.equal(ai.status, 200);
  assert.ok(!(await ai.text()).includes(OPENROUTER_SECRET));
  const aiCall = upstreamCalls.find(call => call.url.includes("openrouter.ai"));
  assert.equal(aiCall.options.headers.Authorization, `Bearer ${OPENROUTER_SECRET}`);
  assert.ok(!aiCall.options.body.includes("browser-smuggled-key"));
});

test("live transcript relay authenticates upstream without exposing its token", async () => {
  const response = await fetch(`${base}/api/fireflies/live?meetingId=meeting-7`);
  assert.equal(response.status, 200);
  const body = await response.text();
  const events = body.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(liveCalls.at(-1), { meetingId: "meeting-7", token: FIREFLIES_SECRET });
  assert.ok(events.some(event => event.type === "status" && event.status === "connected"));
  assert.ok(events.some(event => event.type === "line" && event.text === "Stay present" && event.key === "c7"));
  assert.ok(!body.includes(FIREFLIES_SECRET));
});

test("bridge token is injected internally and client authorization is ignored", async () => {
  const response = await fetch(`${base}/api/bridge/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer browser-controlled" },
    body: JSON.stringify({ goal: "listen" }),
  });
  assert.equal(response.status, 200);
  const bridgeCall = upstreamCalls.find(call => call.url.endsWith("/context"));
  assert.equal(bridgeCall.options.headers.Authorization, `Bearer ${BRIDGE_SECRET}`);
  assert.ok(!(await response.text()).includes(BRIDGE_SECRET));
});

test("client abort propagates through the server API to a streamed bridge request", async () => {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/bridge/pi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "wait", sessionId: "session1" }),
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await reader.read().catch(() => {});
  for (let i = 0; i < 20 && !piAbortObserved; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(piAbortObserved, true);
});

test("cross-site and simple-content mutation attempts fail before proxying", async () => {
  const beforeCount = upstreamCalls.length;
  const crossSite = await fetch(`${base}/api/bridge/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    body: JSON.stringify({ goal: "x" }),
  });
  assert.equal(crossSite.status, 403);
  const simple = await fetch(`${base}/api/bridge/context`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ goal: "x" }) });
  assert.equal(simple.status, 415);
  assert.equal(upstreamCalls.length, beforeCount);
});

test("meeting finalization returns a basename rather than an infrastructure path", async () => {
  const response = await fetch(`${base}/api/meeting/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "session-12345", title: "Meeting", markdown: "# record", ffKey: FIREFLIES_SECRET }),
  });
  assert.deepEqual(await response.json(), { ok: true, path: "meeting.md" });
  assert.equal("ffKey" in meetingStoreCalls.at(-1), false);
});

test("Robin's Tailscale identity protects every non-auth API with a Secure session", async () => {
  const authEnv = path.join(dir, "auth.env");
  await writeFile(authEnv, "FIREFLIES_APP_SECRET=private-robin-secret\nFIREFLIES_ALLOWED_TAILSCALE_LOGINS=robin@thrivbe.com\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n");
  const authApi = createAppApi({ envFile: authEnv, bridgeToken: "", recordsDir: dir, requireAuth: true, secureCookie: true, meetingStore });
  const authServer = http.createServer((req, res) => { if (!authApi(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => authServer.listen(0, "127.0.0.1", resolve));
  const authBase = `http://127.0.0.1:${authServer.address().port}`;
  try {
    assert.equal((await fetch(`${authBase}/api/config`)).status, 401);
    assert.deepEqual(await (await fetch(`${authBase}/api/auth/status`)).json(), { required: true, configured: true, authenticated: false });
    assert.equal((await fetch(`${authBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "private-robin-secret" }) })).status, 401);
    assert.equal((await fetch(`${authBase}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${authBase}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json", "Tailscale-User-Login": "someone@example.com" }, body: "{}" })).status, 403);
    const bootstrap = await fetch(`${authBase}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json", "Tailscale-User-Login": "robin@thrivbe.com" }, body: "{}" });
    assert.equal(bootstrap.status, 200);
    const cookie = bootstrap.headers.get("set-cookie");
    assert.match(cookie, /fireflies_live_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.ok(!cookie.includes("private-robin-secret"));
    assert.equal((await fetch(`${authBase}/api/config`, { headers: { Cookie: cookie } })).status, 200);
    const logout = await fetch(`${authBase}/api/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  } finally { await new Promise(resolve => authServer.close(resolve)); }
});

test("production auth and provider policy fail closed when deployment config is absent", async () => {
  const lockedEnv = path.join(dir, "locked.env");
  await writeFile(lockedEnv, `FIREFLY_API_KEY=${FIREFLIES_SECRET}\nOPENROUTER_API=${OPENROUTER_SECRET}\n`);
  const lockedApi = createAppApi({ envFile: lockedEnv, bridgeToken: "", recordsDir: dir, requireAuth: true, meetingStore });
  const lockedServer = http.createServer((req, res) => { if (!lockedApi(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => lockedServer.listen(0, "127.0.0.1", resolve));
  const lockedBase = `http://127.0.0.1:${lockedServer.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${lockedBase}/api/auth/status`)).json(), { required: true, configured: false, authenticated: false });
    assert.equal((await fetch(`${lockedBase}/api/config`)).status, 503);
  } finally { await new Promise(resolve => lockedServer.close(resolve)); }

  const policyApi = createAppApi({ envFile: lockedEnv, bridgeToken: "", recordsDir: dir, meetingStore });
  const policyServer = http.createServer((req, res) => { if (!policyApi(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => policyServer.listen(0, "127.0.0.1", resolve));
  const policyBase = `http://127.0.0.1:${policyServer.address().port}`;
  try {
    const config = await (await fetch(`${policyBase}/api/config`)).json();
    assert.equal(config.providerPolicyConfigured, false);
    assert.deepEqual(config.blockedProviders, ["fireflies", "openrouter"]);
    assert.equal((await fetch(`${policyBase}/api/fireflies/meetings`)).status, 403);
    assert.equal((await fetch(`${policyBase}/api/ai/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "anthropic/test", messages: [{ role: "user", content: "no" }] }) })).status, 403);
  } finally { await new Promise(resolve => policyServer.close(resolve)); }
});

// ── 1Password Phase 6: secrets from the environment (oprun), op:// never a value,
//    policy lists re-read from the file on every request ──────────────────────

async function withApi(options, fn) {
  const api = createAppApi({ bridgeToken: "", recordsDir: dir, meetingStore, ...options });
  const srv = http.createServer((req, res) => { if (!api(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); }
  finally { await new Promise(resolve => srv.close(resolve)); }
}

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  try { return await fn(); }
  finally { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

function recordingFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const chat = (base, headers = {}) => fetch(`${base}/api/ai/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ model: "anthropic/test", messages: [{ role: "user", content: "hi" }] }) });
const robinSession = async base => (await fetch(`${base}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json", "Tailscale-User-Login": "robin@thrivbe.com" }, body: "{}" }));

test("op:// addresses in the keys file are never used as credentials", async () => {
  const opEnv = path.join(dir, "op-addresses.env");
  await writeFile(opEnv, "FIREFLY_API_KEY=op://Vault/Fireflies/credential\nOPENROUTER_API_KEY=\"op://Vault/OpenRouter/credential\"\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n");
  const { calls, fetchImpl } = recordingFetch();
  const realtimeCalls = [];
  await withApi({ envFile: opEnv, fetchImpl, realtime: async (...args) => { realtimeCalls.push(args); throw new Error("must not connect"); } }, async base => {
    assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { firefliesAvailable: false, openRouterAvailable: false, bridgeAvailable: false, providerPolicyConfigured: true, blockedProviders: [] });
    assert.equal((await fetch(`${base}/api/fireflies/meetings`)).status, 503);
    assert.equal((await fetch(`${base}/api/fireflies/live?meetingId=meeting-1`)).status, 400);
    assert.equal((await chat(base)).status, 503);
  });
  assert.equal(calls.length, 0);
  assert.equal(realtimeCalls.length, 0);
});

test("an unresolved op:// value in the environment is never used either", async () => {
  const plainEnv = path.join(dir, "plain-with-op-env.env");
  await writeFile(plainEnv, `FIREFLY_API_KEY=${FIREFLIES_SECRET}\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n`);
  const { calls, fetchImpl } = recordingFetch();
  await withEnv({ FIREFLY_API_KEY: "op://Vault/Fireflies/credential", OPENROUTER_API_KEY: "op://Vault/OpenRouter/credential" }, () =>
    withApi({ envFile: plainEnv, fetchImpl }, async base => {
      const config = await (await fetch(`${base}/api/config`)).json();
      assert.equal(config.firefliesAvailable, true); // falls back to the plaintext file value
      assert.equal(config.openRouterAvailable, false); // no real value anywhere
      assert.equal((await fetch(`${base}/api/fireflies/meetings`)).status, 200);
      assert.equal((await chat(base)).status, 503);
    }));
  assert.deepEqual(calls.map(call => call.options.headers.Authorization), [`Bearer ${FIREFLIES_SECRET}`]);
});

test("an op:// app secret with nothing resolved leaves production auth unconfigured", async () => {
  const opEnv = path.join(dir, "op-app-secret.env");
  await writeFile(opEnv, "FIREFLIES_APP_SECRET=op://Vault/AppSecret/credential\nFIREFLIES_ALLOWED_TAILSCALE_LOGINS=robin@thrivbe.com\n");
  await withApi({ envFile: opEnv, requireAuth: true }, async base => {
    assert.deepEqual(await (await fetch(`${base}/api/auth/status`)).json(), { required: true, configured: false, authenticated: false });
    assert.equal((await robinSession(base)).status, 503);
    assert.equal((await fetch(`${base}/api/config`)).status, 503);
  });
});

test("secrets resolved into the environment (oprun) win over op:// addresses in the file", async () => {
  const opEnv = path.join(dir, "op-switched.env");
  await writeFile(opEnv, "FIREFLY_API_KEY=op://Vault/Fireflies/credential\nOPENROUTER_API_KEY=op://Vault/OpenRouter/credential\nFIREFLIES_APP_SECRET=op://Vault/AppSecret/credential\nFIREFLIES_ALLOWED_TAILSCALE_LOGINS=robin@thrivbe.com\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n");
  const { calls, fetchImpl } = recordingFetch();
  await withEnv({ FIREFLY_API_KEY: "ff-env-canary", OPENROUTER_API_KEY: "or-env-canary", FIREFLIES_APP_SECRET: "app-env-canary" }, () =>
    withApi({ envFile: opEnv, fetchImpl, requireAuth: true }, async base => {
      assert.deepEqual(await (await fetch(`${base}/api/auth/status`)).json(), { required: true, configured: true, authenticated: false });
      const session = await robinSession(base);
      assert.equal(session.status, 200);
      const cookie = session.headers.get("set-cookie");
      const config = await fetch(`${base}/api/config`, { headers: { Cookie: cookie } });
      const text = await config.text();
      assert.equal(JSON.parse(text).firefliesAvailable, true);
      assert.equal(JSON.parse(text).openRouterAvailable, true);
      for (const secret of ["ff-env-canary", "or-env-canary", "app-env-canary"]) assert.ok(!text.includes(secret));
      assert.equal((await fetch(`${base}/api/fireflies/meetings`, { headers: { Cookie: cookie } })).status, 200);
      assert.equal((await chat(base, { Cookie: cookie })).status, 200);
    }));
  assert.deepEqual(calls.map(call => call.options.headers.Authorization), ["Bearer ff-env-canary", "Bearer or-env-canary"]);
});

test("a real secret in the environment wins over a real one in the file (unchanged precedence)", async () => {
  const plainEnv = path.join(dir, "both-real.env");
  await writeFile(plainEnv, "FIREFLY_API_KEY=ff-file-canary\nOPENROUTER_API_KEY=or-file-canary\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n");
  const { calls, fetchImpl } = recordingFetch();
  await withEnv({ FIREFLY_API_KEY: "ff-env-canary", OPENROUTER_API_KEY: "or-env-canary" }, () =>
    withApi({ envFile: plainEnv, fetchImpl }, async base => {
      assert.equal((await fetch(`${base}/api/fireflies/meetings`)).status, 200);
      assert.equal((await chat(base)).status, 200);
    }));
  assert.deepEqual(calls.map(call => call.options.headers.Authorization), ["Bearer ff-env-canary", "Bearer or-env-canary"]);
});

test("provider policy is re-read from the file on every request, even when the environment also holds it", async () => {
  const policyEnv = path.join(dir, "policy-reload.env");
  const writePolicy = line => writeFile(policyEnv, `FIREFLY_API_KEY=${FIREFLIES_SECRET}\nOPENROUTER_API=${OPENROUTER_SECRET}\n${line}`);
  const blocked = async base => (await (await fetch(`${base}/api/config`)).json()).blockedProviders;
  const { fetchImpl } = recordingFetch();
  await writePolicy("FIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n");
  // oprun exports plaintext lines into the environment at start; that copy must not freeze the policy.
  await withEnv({ FIREFLIES_ALLOWED_DATA_PROCESSORS: "fireflies,openrouter" }, () =>
    withApi({ envFile: policyEnv, fetchImpl }, async base => {
      assert.deepEqual(await blocked(base), []);
      await writePolicy("FIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies\n");
      assert.deepEqual(await blocked(base), ["openrouter"]);
      assert.equal((await chat(base)).status, 403);
      await writePolicy(""); // line removed: everything is blocked, the environment copy does not re-grant
      assert.deepEqual(await blocked(base), ["fireflies", "openrouter"]);
      await writePolicy("FIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies,openrouter\n");
      assert.deepEqual(await blocked(base), []);
    }));
});

test("the Tailscale login allowlist is re-read from the file: removing a login revokes its live session", async () => {
  const authEnv = path.join(dir, "login-reload.env");
  const writeLogins = logins => writeFile(authEnv, `FIREFLIES_APP_SECRET=private-robin-secret\nFIREFLIES_ALLOWED_TAILSCALE_LOGINS=${logins}\nFIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies\n`);
  await writeLogins("robin@thrivbe.com");
  await withEnv({ FIREFLIES_ALLOWED_TAILSCALE_LOGINS: "robin@thrivbe.com" }, () =>
    withApi({ envFile: authEnv, requireAuth: true }, async base => {
      const cookie = (await robinSession(base)).headers.get("set-cookie");
      assert.equal((await fetch(`${base}/api/config`, { headers: { Cookie: cookie } })).status, 200);
      await writeLogins("someone-else@thrivbe.com");
      assert.equal((await fetch(`${base}/api/config`, { headers: { Cookie: cookie } })).status, 401);
      assert.equal((await robinSession(base)).status, 403);
    }));
});

test("policy comes from the environment only when the keys file is unreadable", async () => {
  const { fetchImpl } = recordingFetch();
  await withEnv({ FIREFLY_API_KEY: "ff-env-canary", FIREFLIES_ALLOWED_DATA_PROCESSORS: "fireflies" }, () =>
    withApi({ envFile: path.join(dir, "does-not-exist.env"), fetchImpl }, async base => {
      const config = await (await fetch(`${base}/api/config`)).json();
      assert.equal(config.firefliesAvailable, true);
      assert.equal(config.providerPolicyConfigured, true);
    }));
});
