import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./background.js", import.meta.url), "utf8");
const CURRENT_URL = "https://hetzner.tail9908c7.ts.net:8453/";
const LEGACY_URL = "http://100.114.219.63:3017/";
const plain = value => JSON.parse(JSON.stringify(value));

function launcher(tabs = []) {
  const events = {};
  const calls = { query: [], update: [], create: [], windowUpdate: [], errors: [] };
  const chrome = {
    action: { onClicked: { addListener: callback => { events.clicked = callback; } } },
    runtime: {
      onInstalled: { addListener: callback => { events.installed = callback; } },
      onStartup: { addListener: callback => { events.startup = callback; } },
    },
    tabs: {
      query: async options => { calls.query.push(options); return tabs; },
      update: async (id, options) => { calls.update.push({ id, options }); return { ...tabs.find(tab => tab.id === id), ...options }; },
      create: async options => { calls.create.push(options); return { id: 99, ...options }; },
    },
    windows: { update: async (id, options) => { calls.windowUpdate.push({ id, options }); } },
  };
  vm.runInNewContext(source, { chrome, console: { error: (...args) => calls.errors.push(args) }, Number, Promise });
  return { events, calls };
}

test("click focuses an existing private HTTPS tab", async () => {
  const { events, calls } = launcher([{ id: 7, windowId: 3, url: `${CURRENT_URL}meeting` }]);
  await events.clicked();
  assert.deepEqual(plain(calls.update), [{ id: 7, options: { active: true } }]);
  assert.deepEqual(plain(calls.windowUpdate), [{ id: 3, options: { focused: true } }]);
  assert.deepEqual(calls.create, []);
  assert.deepEqual(calls.errors, []);
});

test("click repairs a tab left on the retired direct-IP address", async () => {
  const { events, calls } = launcher([{ id: 8, windowId: 4, url: LEGACY_URL }]);
  await events.clicked();
  assert.deepEqual(plain(calls.update), [{ id: 8, options: { url: CURRENT_URL, active: true } }]);
  assert.deepEqual(plain(calls.windowUpdate), [{ id: 4, options: { focused: true } }]);
  assert.deepEqual(calls.create, []);
});

test("click opens the private app when no app tab exists", async () => {
  const { events, calls } = launcher([{ id: 2, windowId: 1, url: "https://example.com/" }]);
  await events.clicked();
  assert.deepEqual(plain(calls.create), [{ url: CURRENT_URL }]);
  assert.deepEqual(calls.update, []);
});

test("extension startup migrates every legacy tab without touching other tabs", async () => {
  const { events, calls } = launcher([
    { id: 1, url: LEGACY_URL },
    { id: 2, url: `${LEGACY_URL}old-path` },
    { id: 3, url: CURRENT_URL },
  ]);
  await events.startup();
  assert.deepEqual(plain(calls.update), [
    { id: 1, options: { url: CURRENT_URL } },
    { id: 2, options: { url: CURRENT_URL } },
  ]);
});
