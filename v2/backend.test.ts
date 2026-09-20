// Pins the pure LLM-output parsers and the shell escaper in v2/backend.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test, connectLive, fetchFeed, fetchKeys, fetchTurnProbability } from "./backend.ts";

const { modelJsonArray, modelJsonObject, shq } = __test;

test("modelJsonArray parses fenced json", () => {
  assert.deepEqual(modelJsonArray('```json\n[1,2]\n```'), [1, 2]);
});

test("modelJsonArray extracts array from surrounding prose", () => {
  assert.deepEqual(modelJsonArray('prose then [{"a":1}] trailing'), [{ a: 1 }]);
});

test("modelJsonArray returns null on garbage", () => {
  assert.equal(modelJsonArray("not json at all"), null);
});

test("modelJsonArray rejects a bare object", () => {
  assert.equal(modelJsonArray('{"a":1}'), null);
});

test("modelJsonObject parses fenced object", () => {
  assert.deepEqual(modelJsonObject('```\n{"x":1}\n```'), { x: 1 });
});

test("modelJsonObject rejects an array", () => {
  assert.equal(modelJsonObject("[1,2]"), null);
});

test("modelJsonObject returns null on garbage", () => {
  assert.equal(modelJsonObject("garbage"), null);
});

test("shq single-quote escapes for shell argv", () => {
  assert.equal(shq("it's"), "'it'\\''s'");
});

test("fetchKeys returns capability sentinels, never server credential fields", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ firefliesAvailable: true, openRouterAvailable: true, bridgeAvailable: true, ffKey: "secret" }));
  try {
    assert.deepEqual(await fetchKeys(), { ffKey: "server", orKey: "server", bridgeToken: "server", jevAvailable: false, providerPolicyError: "" });
  } finally { globalThis.fetch = original; }
});

test("fetchKeys makes a blocked provider policy observable without exposing details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ firefliesAvailable: false, openRouterAvailable: false, bridgeAvailable: true, blockedProviders: ["fireflies", "openrouter"] }));
  try {
    const result = await fetchKeys();
    assert.equal(result.providerPolicyError, "Provider processing is locked pending explicit approval: fireflies, openrouter.");
    assert.equal(result.ffKey, "");
  } finally { globalThis.fetch = original; }
});

test("disabled command suggestions are filtered even if a model invents one", async () => {
  const original = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_url, init) => {
    body = String(init?.body || "");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [
      { id: null, type: "command", text: "rm something" },
      { id: null, type: "note", text: "Keep listening" },
    ] }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await fetchFeed("Robin: hello", "server", { context: "", goal: "", bundleHint: "", meetingTitle: "Test", meetingType: "neutral", hostName: "Robin", agenda: false, commands: false }, "model/test", []);
    assert.deepEqual(result?.items.map(item => item.type), ["note"]);
    const request = JSON.parse(body);
    assert.ok(!request.messages[0].content.includes('"command": an exact single runnable'));
  } finally { globalThis.fetch = original; }
});

test("fetchTurnProbability returns the server's probability", async () => {
  const original = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_url, init) => { body = String(init?.body || ""); return new Response(JSON.stringify({ ok: true, p: 0.87 })); };
  try {
    assert.equal(await fetchTurnProbability("[Robin]: hi"), 0.87);
    assert.deepEqual(JSON.parse(body), { transcript: "[Robin]: hi" });
  } finally { globalThis.fetch = original; }
});

test("fetchTurnProbability degrades to null on ok:false, a non-2xx, or a network error", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }));
    assert.equal(await fetchTurnProbability("ctx"), null);
    globalThis.fetch = async () => new Response("", { status: 503 });
    assert.equal(await fetchTurnProbability("ctx"), null);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await fetchTurnProbability("ctx"), null);
  } finally { globalThis.fetch = original; }
});

test("connectLive consumes the same-origin relay without browser authorization", async () => {
  const original = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url); requestInit = init;
    const body = [
      JSON.stringify({ type: "status", status: "connected" }),
      JSON.stringify({ type: "line", speaker: "Robin", text: "hello", final: true, key: "c1" }),
      JSON.stringify({ type: "status", status: "disconnected" }),
      "",
    ].join("\n");
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  };
  const statuses: string[] = [];
  const lines: unknown[][] = [];
  try {
    const connection = connectLive((...args) => lines.push(args), status => statuses.push(status), "server", "meeting/id");
    await connection.connect();
    assert.equal(requestUrl, "/api/fireflies/live?meetingId=meeting%2Fid");
    assert.equal((requestInit?.headers as Record<string, string> | undefined)?.Authorization, undefined);
    assert.deepEqual(lines, [["Robin", "hello", true, "c1"]]);
    assert.deepEqual(statuses, ["connecting", "connected", "disconnected", "disconnected"]);
  } finally { globalThis.fetch = original; }
});

test("connectLive disconnect aborts an in-flight transcript stream", async () => {
  const original = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => { aborted = true; controller.close(); }, { once: true });
    },
  }), { status: 200 });
  const statuses: string[] = [];
  try {
    const connection = connectLive(() => {}, status => statuses.push(status), "server", "meeting");
    const connecting = connection.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    connection.disconnect();
    await connecting;
    assert.equal(aborted, true);
    assert.equal(statuses.at(-1), "disconnected");
  } finally { globalThis.fetch = original; }
});
