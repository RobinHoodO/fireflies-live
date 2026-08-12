import { useCallback, useEffect, useState, type ReactNode } from "react";

type AuthStatus = { required: boolean; configured: boolean; authenticated: boolean };

async function readStatus(): Promise<AuthStatus> {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Authorization service unavailable");
  return await response.json();
}

async function bootstrapSession(): Promise<AuthStatus> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Tailscale access unavailable");
  return { required: true, configured: true, authenticated: value.authenticated === true };
}

export default function AuthBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const current = await readStatus();
      setStatus(current.authenticated ? current : await bootstrapSession());
    } catch (cause) {
      setStatus({ required: true, configured: true, authenticated: false });
      setError(cause instanceof Error ? cause.message : "Tailscale access unavailable");
    }
  }, []);
  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(interval); };
  }, [refresh]);

  if (status?.authenticated) return children;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "oklch(0.975 0.006 250)", fontFamily: "Inter, system-ui, sans-serif" }}>
      <section style={{ width: "min(420px, 100%)", padding: 32, borderRadius: 18, border: "1px solid oklch(0.91 0.006 255)", background: "#fff", boxShadow: "0 18px 60px -36px rgba(16,24,40,.45)" }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "oklch(0.5 0.17 242)" }}>Fireflies Live</div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 24, color: "oklch(0.27 0.025 255)" }}>{status ? "Robin-only access" : "Checking access…"}</h1>
        {!status ? (
          <p style={{ color: "oklch(0.55 0.015 255)" }}>Confirming your private Tailscale identity.</p>
        ) : (
          <p role="alert" style={{ lineHeight: 1.55, color: "oklch(0.5 0.16 25)" }}>{error || "Open this page from a device signed in to Robin's Tailscale account."}</p>
        )}
      </section>
    </main>
  );
}
