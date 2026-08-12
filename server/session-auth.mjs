import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fireflies_live_session";

function parseCookies(header = "") {
  return String(header).split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function secretFingerprint(secret) {
  return createHash("sha256").update(String(secret)).digest("hex");
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

function clientKey(req) {
  return String(req.socket?.remoteAddress || "unknown");
}

function normalizeLogin(value) {
  return String(value || "").trim().toLowerCase();
}

export function createSessionAuth({
  loadSecret,
  loadAllowedLogins = () => [],
  required = false,
  secureCookie = false,
  sessionTtlMs = 12 * 60 * 60 * 1000,
  now = () => Date.now(),
  token = () => randomBytes(32).toString("base64url"),
  maxAttempts = 8,
  attemptWindowMs = 15 * 60 * 1000,
} = {}) {
  if (typeof loadSecret !== "function") throw new Error("loadSecret is required");
  const sessions = new Map();
  const attempts = new Map();

  const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? "; Secure" : ""}`;
  const sessionCookie = value => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secureCookie ? "; Secure" : ""}`;

  function configuration() {
    const secret = String(loadSecret() || "");
    const allowedLogins = new Set(Array.from(loadAllowedLogins() || [], normalizeLogin).filter(Boolean));
    const enabled = required || !!secret;
    const configured = !!secret && (!required || allowedLogins.size > 0);
    return { secret, allowedLogins, enabled, configured };
  }

  function current(req) {
    const { secret, allowedLogins, enabled, configured } = configuration();
    if (!enabled) return { required: false, configured: false, authenticated: true };
    if (!configured) return { required: true, configured: false, authenticated: false };

    const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.expiresAt <= now() || session.secretFingerprint !== secretFingerprint(secret) || (session.login && !allowedLogins.has(session.login))) {
      if (sessionId) sessions.delete(sessionId);
      return { required: true, configured: true, authenticated: false };
    }
    return { required: true, configured: true, authenticated: true, sessionId };
  }

  function status(req) {
    const state = current(req);
    return { required: state.required, configured: state.configured, authenticated: state.authenticated };
  }

  function bootstrap(req) {
    const { secret, allowedLogins, configured } = configuration();
    if (!configured) return { status: 503, body: { error: "Tailscale application access is not configured" } };
    const login = normalizeLogin(req.headers["tailscale-user-login"]);
    if (!login || !allowedLogins.has(login)) return { status: 403, body: { error: "Robin's Tailscale identity is required" } };

    const sessionId = token();
    sessions.set(sessionId, { expiresAt: now() + sessionTtlMs, secretFingerprint: secretFingerprint(secret), login });
    return { status: 200, body: { authenticated: true }, cookie: sessionCookie(sessionId) };
  }

  function login(req, suppliedSecret) {
    const secret = String(loadSecret() || "");
    if (!secret) return { status: required ? 503 : 400, body: { error: required ? "application auth is not configured" : "application auth is disabled" } };

    const key = clientKey(req);
    const cutoff = now() - attemptWindowMs;
    const recent = (attempts.get(key) || []).filter(at => at > cutoff);
    if (recent.length >= maxAttempts) return { status: 429, body: { error: "too many login attempts" } };

    if (!sameSecret(suppliedSecret, secret)) {
      recent.push(now());
      attempts.set(key, recent);
      return { status: 401, body: { error: "invalid credentials" } };
    }

    attempts.delete(key);
    const sessionId = token();
    sessions.set(sessionId, { expiresAt: now() + sessionTtlMs, secretFingerprint: secretFingerprint(secret) });
    return { status: 200, body: { authenticated: true }, cookie: sessionCookie(sessionId) };
  }

  function logout(req) {
    const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sessionId) sessions.delete(sessionId);
    return { status: 200, body: { authenticated: false }, cookie: clearCookie };
  }

  return { status, current, bootstrap, login, logout };
}

export const __test = { parseCookies, sameSecret, secretFingerprint, normalizeLogin };
