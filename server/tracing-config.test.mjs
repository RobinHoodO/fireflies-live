import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { DEFAULT_TRACE_SAMPLE_RATE, isSentryEnabled, sampleTrace } from "./tracing-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Sentry is enabled only on the production host", () => {
  assert.equal(isSentryEnabled("thrivbe-1"), true);
  assert.equal(isSentryEnabled("localhost"), false);
  assert.equal(isSentryEnabled("thrivbe-10"), false);
});

test("timer and health routes are not traced", () => {
  const rate = 0.25;
  for (const route of ["/api/bridge/health", "/api/auth/status", "/api/fireflies/live", "/api/meeting/checkpoint"]) {
    assert.equal(sampleTrace(`GET ${route}`, { "url.path": route }, rate), 0, route);
  }
  assert.equal(sampleTrace("GET /api/fireflies/live", { "url.path": "/api/fireflies/live?meetingId=abc" }, rate), 0);
});

test("other routes keep the configured rate", () => {
  assert.equal(DEFAULT_TRACE_SAMPLE_RATE, 0.1);
  assert.equal(sampleTrace("GET /api/fireflies/meetings", { "url.path": "/api/fireflies/meetings" }, 0.25), 0.25);
  assert.equal(sampleTrace("POST /api/ai/chat", {}, 0.25), 0.25);
});

test("only the server preloader imports @sentry/node", () => {
  const imports = [];
  const importsSentryNode = source => /(?:\b(?:import|export)\s+(?:[^"'`;]*?\sfrom\s*)?|\b(?:import|require)\s*\()\s*["']@sentry\/node["']/.test(source);
  const sentryModule = "@sentry/" + "node";
  assert.equal(importsSentryNode(`import "${sentryModule}";`), true);
  assert.equal(importsSentryNode(`export * from "${sentryModule}";`), true);
  assert.equal(importsSentryNode(`const Sentry = await import("${sentryModule}");`), true);
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      if (importsSentryNode(source)) imports.push(path.relative(ROOT, full));
    }
  };
  visit(ROOT);
  assert.deepEqual(imports, ["server/instrument.mjs"]);
});
