import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionAuth, SESSION_COOKIE, __test } from "./session-auth.mjs";

const request = (cookie = "", login = "") => ({
  headers: { cookie, ...(login ? { "tailscale-user-login": login } : {}) },
  socket: { remoteAddress: "127.0.0.1" },
});

test("session auth is open only when explicitly optional and unconfigured", () => {
  const optional = createSessionAuth({ loadSecret: () => "" });
  assert.deepEqual(optional.status(request()), { required: false, configured: false, authenticated: true });
  const required = createSessionAuth({ loadSecret: () => "", required: true });
  assert.deepEqual(required.status(request()), { required: true, configured: false, authenticated: false });
  assert.equal(required.bootstrap(request()).status, 503);
  assert.equal(required.login(request(), "anything").status, 503);
});

test("legacy optional auth still mints an HttpOnly same-site session", () => {
  let time = 1000;
  const auth = createSessionAuth({ loadSecret: () => "correct horse", now: () => time, token: () => "session-token", sessionTtlMs: 5000 });
  assert.equal(auth.login(request(), "wrong").status, 401);
  const login = auth.login(request(), "correct horse");
  assert.equal(login.status, 200);
  assert.match(login.cookie, new RegExp(`^${SESSION_COOKIE}=session-token`));
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Strict/);
  assert.equal(auth.status(request(`${SESSION_COOKIE}=session-token`)).authenticated, true);
  const logout = auth.logout(request(`${SESSION_COOKIE}=session-token`));
  assert.match(logout.cookie, /Max-Age=0/);
  assert.equal(auth.status(request(`${SESSION_COOKIE}=session-token`)).authenticated, false);
});

test("Robin's Tailscale identity mints a Secure session without exposing the app secret", () => {
  const auth = createSessionAuth({
    loadSecret: () => "server-only-secret",
    loadAllowedLogins: () => new Set(["robin@thrivbe.com"]),
    required: true,
    secureCookie: true,
    token: () => "tailnet-session",
  });
  assert.equal(auth.bootstrap(request()).status, 403);
  assert.equal(auth.bootstrap(request("", "someone@example.com")).status, 403);
  const session = auth.bootstrap(request("", "Robin@Thrivbe.com"));
  assert.equal(session.status, 200);
  assert.match(session.cookie, new RegExp(`^${SESSION_COOKIE}=tailnet-session`));
  assert.match(session.cookie, /HttpOnly/);
  assert.match(session.cookie, /SameSite=Strict/);
  assert.match(session.cookie, /Secure/);
  assert.ok(!session.cookie.includes("server-only-secret"));
  assert.equal(auth.status(request(`${SESSION_COOKIE}=tailnet-session`)).authenticated, true);
});

test("sessions expire and are invalidated when the deploy secret rotates", () => {
  let secret = "first";
  let time = 0;
  const auth = createSessionAuth({ loadSecret: () => secret, now: () => time, token: () => "token", sessionTtlMs: 10 });
  auth.login(request(), secret);
  assert.equal(auth.status(request(`${SESSION_COOKIE}=token`)).authenticated, true);
  secret = "second";
  assert.equal(auth.status(request(`${SESSION_COOKIE}=token`)).authenticated, false);
  auth.login(request(), secret);
  time = 11;
  assert.equal(auth.status(request(`${SESSION_COOKIE}=token`)).authenticated, false);
});

test("removing a Tailscale login from the allowlist revokes its session", () => {
  let allowed = new Set(["robin@thrivbe.com"]);
  const auth = createSessionAuth({ loadSecret: () => "secret", loadAllowedLogins: () => allowed, required: true, token: () => "identity-token" });
  auth.bootstrap(request("", "robin@thrivbe.com"));
  assert.equal(auth.status(request(`${SESSION_COOKIE}=identity-token`)).authenticated, true);
  allowed = new Set();
  assert.deepEqual(auth.status(request(`${SESSION_COOKIE}=identity-token`)), { required: true, configured: false, authenticated: false });
});

test("credential comparison and cookie parsing do not use partial matches", () => {
  assert.equal(__test.sameSecret("abc", "abc"), true);
  assert.equal(__test.sameSecret("abc", "abcd"), false);
  assert.deepEqual(__test.parseCookies("a=1; fireflies_live_session=xyz"), { a: "1", fireflies_live_session: "xyz" });
  assert.equal(__test.normalizeLogin(" Robin@Thrivbe.com "), "robin@thrivbe.com");
});
