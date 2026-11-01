const UNSAMPLED_ROUTES = new Set([
  "/api/auth/status",
  "/api/bridge/health",
  "/api/fireflies/live",
  "/api/meeting/checkpoint",
]);

export function shouldCreateSpanForRequest(url: string): boolean {
  try {
    return !UNSAMPLED_ROUTES.has(new URL(url, "http://localhost").pathname);
  } catch {
    return true;
  }
}
