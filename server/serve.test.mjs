import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SERVE_TEST = "1";
const { hostAllowed, safeDistPath, bridgeEnv } = await import("./serve.mjs");

const DIST = "/srv/app/dist";

test("host allowlist", () => {
  assert.equal(hostAllowed("100.114.219.63:3017", ["100.114.219.63:3017"]), true);
  assert.equal(hostAllowed("evil.com", ["100.114.219.63:3017"]), false);
  assert.equal(hostAllowed(undefined, ["100.114.219.63:3017"]), false);
  assert.equal(hostAllowed("100.114.219.63:3017", []), false);
});

test("static paths stay inside dist", () => {
  assert.equal(safeDistPath("/", DIST), `${DIST}/index.html`);
  assert.equal(safeDistPath("/assets/app.js", DIST), `${DIST}/assets/app.js`);
  assert.equal(safeDistPath("/assets/app.js?v=1", DIST), `${DIST}/assets/app.js`);
  // Traversal attempts must never escape dist: either rejected ("") or
  // neutralized to a path still inside it (where the file lookup 404s).
  // Malformed percent-encoding must be rejected, never thrown (crash-DoS).
  assert.equal(safeDistPath("/%", DIST), "");
  assert.equal(safeDistPath("/%zz/app.js", DIST), "");
  for (const attack of ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/assets/../../secret", "/..%2f..%2fetc/passwd"]) {
    const resolved = safeDistPath(attack, DIST);
    assert.ok(resolved === "" || resolved.startsWith(`${DIST}/`), `${attack} → ${resolved}`);
  }
});

test("provider secrets resolved by oprun never reach the bridge child's environment", () => {
  const env = {
    PATH: "/usr/bin", HOME: "/root", BRIDGE_FILE_DIR: "/srv/transcripts", BRIDGE_TOKEN: "stale",
    FIREFLY_API_KEY: "ff-canary", OPENROUTER_API: "or-canary-1", OPENROUTER_API_KEY: "or-canary-2", FIREFLIES_APP_SECRET: "app-canary",
  };
  assert.deepEqual(bridgeEnv(env, "boot-token"), { PATH: "/usr/bin", HOME: "/root", BRIDGE_FILE_DIR: "/srv/transcripts", BRIDGE_TOKEN: "boot-token" });
  assert.equal(env.FIREFLY_API_KEY, "ff-canary"); // the server's own environment is not mutated
});
