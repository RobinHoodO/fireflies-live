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
  const calls = { query: [], update: [], create: [], windowUpdate: [], errors: [], panelBehavior: [] };
  const chrome = {
    action: { onClicked: { addListener: callback => { events.clicked = callback; } } },
    sidePanel: { setPanelBehavior: async options => { calls.panelBehavior.push(options); } },
    runtime: {
      onInstalled: { addListener: callback => { events.installed = callback; } },
      onStartup: { addListener: callback => { events.startup = callback; } },
      onMessage: { addListener: callback => { events.message = callback; } },
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

// The panel asks for the app; the toolbar click itself now opens the panel.
async function openApp(events) {
  const replies = [];
  const handled = events.message({ type: "open-app" }, {}, reply => replies.push(reply));
  assert.equal(handled, true, "an open-app message must be answered asynchronously");
  await new Promise(resolve => setImmediate(resolve));
  return replies;
}

test("the panel's Join Live focuses an existing private HTTPS tab", async () => {
  const { events, calls } = launcher([{ id: 7, windowId: 3, url: `${CURRENT_URL}meeting` }]);
  assert.deepEqual(plain(await openApp(events)), [{ ok: true }]);
  assert.deepEqual(plain(calls.update), [{ id: 7, options: { active: true } }]);
  assert.deepEqual(plain(calls.windowUpdate), [{ id: 3, options: { focused: true } }]);
  assert.deepEqual(calls.create, []);
  assert.deepEqual(calls.errors, []);
});

test("the panel's Join Live repairs a tab left on the retired direct-IP address", async () => {
  const { events, calls } = launcher([{ id: 8, windowId: 4, url: LEGACY_URL }]);
  await openApp(events);
  assert.deepEqual(plain(calls.update), [{ id: 8, options: { url: CURRENT_URL, active: true } }]);
  assert.deepEqual(plain(calls.windowUpdate), [{ id: 4, options: { focused: true } }]);
  assert.deepEqual(calls.create, []);
});

test("the panel's Join Live opens the private app when no app tab exists", async () => {
  const { events, calls } = launcher([{ id: 2, windowId: 1, url: "https://example.com/" }]);
  await openApp(events);
  assert.deepEqual(plain(calls.create), [{ url: CURRENT_URL }]);
  assert.deepEqual(calls.update, []);
});

test("messages the panel never sends are ignored, not answered", () => {
  const { events, calls } = launcher();
  assert.equal(events.message({ type: "something-else" }, {}, () => { throw new Error("must not reply"); }), false);
  assert.equal(events.message(undefined, {}, () => { throw new Error("must not reply"); }), false);
  assert.deepEqual(calls.query, []);
});

test("extension startup docks the panel and migrates every legacy tab without touching other tabs", async () => {
  const { events, calls } = launcher([
    { id: 1, url: LEGACY_URL },
    { id: 2, url: `${LEGACY_URL}old-path` },
    { id: 3, url: CURRENT_URL },
  ]);
  await events.startup();
  assert.deepEqual(plain(calls.panelBehavior), [{ openPanelOnActionClick: true }]);
  assert.deepEqual(plain(calls.update), [
    { id: 1, options: { url: CURRENT_URL } },
    { id: 2, options: { url: CURRENT_URL } },
  ]);
});

test("install docks the panel too, so a fresh load has a working toolbar button", async () => {
  const { events, calls } = launcher();
  await events.installed();
  assert.deepEqual(plain(calls.panelBehavior), [{ openPanelOnActionClick: true }]);
});
