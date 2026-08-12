import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionAuth, SESSION_COOKIE, __test } from "./session-auth.mjs";

const request = (cookie = "") => ({ headers: { cookie }, socket: { remoteAddress: "100.64.0.1" } });

test("session auth is open only when explicitly optional and unconfigured", () => {
  const optional = createSessionAuth({ loadSecret: () => "" });
  assert.deepEqual(optional.status(request()), { required: false, configured: false, authenticated: true });
  const required = createSessionAuth({ loadSecret: () => "", required: true });
  assert.deepEqual(required.status(request()), { required: true, configured: false, authenticated: false });
  assert.equal(required.login(request(), "anything").status, 503);
});

test("valid login mints an HttpOnly same-site session and logout revokes it", () => {
  let time = 1000;
  const auth = createSessionAuth({ loadSecret: () => "correct horse", required: true, now: () => time, token: () => "session-token", sessionTtlMs: 5000 });
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

test("sessions expire and are invalidated when the deploy secret rotates", () => {
  let secret = "first";
  let time = 0;
  const auth = createSessionAuth({ loadSecret: () => secret, required: true, now: () => time, token: () => "token", sessionTtlMs: 10 });
  auth.login(request(), secret);
  assert.equal(auth.status(request(`${SESSION_COOKIE}=token`)).authenticated, true);
  secret = "second";
  assert.equal(auth.status(request(`${SESSION_COOKIE}=token`)).authenticated, false);
  auth.login(request(), secret);
  time = 11;
  assert.equal(auth.status(request(`${SESSION_COOKIE}=token`)).authenticated, false);
});

test("credential comparison and cookie parsing do not use partial matches", () => {
  assert.equal(__test.sameSecret("abc", "abc"), true);
  assert.equal(__test.sameSecret("abc", "abcd"), false);
  assert.deepEqual(__test.parseCookies("a=1; fireflies_live_session=xyz"), { a: "1", fireflies_live_session: "xyz" });
});
