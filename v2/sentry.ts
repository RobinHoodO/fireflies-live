import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "https://2ae22659701f7e2e82ea2704fc1a0a70@o4511115127750656.ingest.de.sentry.io/4512347006304336",
  enabled: location.hostname === "hetzner.tail9908c7.ts.net",
  environment: "production",
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  tracePropagationTargets: [/^\/api\//],
});
