import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

type AuthStatus = { required: boolean; configured: boolean; authenticated: boolean };

async function readStatus(): Promise<AuthStatus> {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Authorization service unavailable");
  return await response.json();
}

export default function AuthBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => readStatus().then(setStatus).catch(() => setStatus({ required: true, configured: false, authenticated: false })), []);
  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(interval); };
  }, [refresh]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || "Login failed");
      setPassword("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    } finally { setSubmitting(false); }
  };

  if (status?.authenticated) return children;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "oklch(0.975 0.006 250)", fontFamily: "Inter, system-ui, sans-serif" }}>
      <form onSubmit={login} style={{ width: "min(420px, 100%)", padding: 32, borderRadius: 18, border: "1px solid oklch(0.91 0.006 255)", background: "#fff", boxShadow: "0 18px 60px -36px rgba(16,24,40,.45)" }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "oklch(0.5 0.17 242)" }}>Fireflies Live</div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 24, color: "oklch(0.27 0.025 255)" }}>{status ? "Robin-only access" : "Checking access…"}</h1>
        {!status ? <p style={{ color: "oklch(0.55 0.015 255)" }}>Opening a secure session.</p> : !status.configured ? (
          <p role="alert" style={{ lineHeight: 1.55, color: "oklch(0.5 0.16 25)" }}>Application access is locked because the deploy-time secret is missing. Set <code>FIREFLIES_APP_SECRET</code> on the server, then restart the service.</p>
        ) : (
          <>
            <p style={{ margin: "0 0 18px", lineHeight: 1.55, color: "oklch(0.55 0.015 255)" }}>Enter the private application secret. It is exchanged once for an HttpOnly session cookie.</p>
            <label htmlFor="app-password" style={{ display: "block", marginBottom: 7, fontSize: 13, fontWeight: 700, color: "oklch(0.34 0.02 255)" }}>Application secret</label>
            <input id="app-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={event => setPassword(event.target.value)} style={{ boxSizing: "border-box", width: "100%", padding: "12px 14px", border: "1px solid oklch(0.85 0.01 255)", borderRadius: 10, font: "inherit" }} />
            {error && <p role="alert" style={{ margin: "10px 0 0", color: "oklch(0.5 0.16 25)", fontSize: 13 }}>{error}</p>}
            <button disabled={submitting || !password} style={{ width: "100%", marginTop: 18, padding: 12, border: 0, borderRadius: 10, background: "oklch(0.585 0.16 242)", color: "#fff", font: "inherit", fontWeight: 750, cursor: "pointer", opacity: submitting || !password ? .55 : 1 }}>{submitting ? "Opening…" : "Open Fireflies Live"}</button>
          </>
        )}
      </form>
    </main>
  );
}
