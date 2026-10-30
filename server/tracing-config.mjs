export const DEFAULT_TRACE_SAMPLE_RATE = 0.1;

const UNSAMPLED_ROUTES = new Set([
  "/api/auth/status",
  "/api/bridge/health",
  "/api/fireflies/live",
  "/api/meeting/checkpoint",
]);

export function isSentryEnabled(hostname) {
  return hostname === "thrivbe-1";
}

export function sampleTrace(name, attributes, rate) {
  const attributePath = attributes?.["url.path"];
  const namedPath = typeof name === "string" ? name.split(" ").at(-1) : "";
  const route = String(attributePath || namedPath || "").split("?")[0];
  return UNSAMPLED_ROUTES.has(route) ? 0 : rate;
}
