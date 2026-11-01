import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldCreateSpanForRequest } from "./sentry-routes.ts";

const unsampledRoutes = [
  "/api/auth/status",
  "/api/bridge/health",
  "/api/fireflies/live",
  "/api/meeting/checkpoint",
];

test("polling and health routes do not create browser spans", () => {
  for (const route of unsampledRoutes) {
    assert.equal(shouldCreateSpanForRequest(route), false);
    assert.equal(shouldCreateSpanForRequest(`https://hetzner.tail9908c7.ts.net:8453${route}`), false);
    assert.equal(shouldCreateSpanForRequest(`${route}?x=1`), false);
  }
});

test("other API routes create browser spans", () => {
  assert.equal(shouldCreateSpanForRequest("/api/config"), true);
  assert.equal(shouldCreateSpanForRequest("/api/fireflies/meetings"), true);
});
