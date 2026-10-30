import os from "node:os";
import * as Sentry from "@sentry/node";
import { DEFAULT_TRACE_SAMPLE_RATE, isSentryEnabled, sampleTrace } from "./tracing-config.mjs";

const configuredRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
const rate = Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 1
  ? configuredRate
  : DEFAULT_TRACE_SAMPLE_RATE;

Sentry.init({
  dsn: "https://2ae22659701f7e2e82ea2704fc1a0a70@o4511115127750656.ingest.de.sentry.io/4512347006304336",
  enabled: isSentryEnabled(os.hostname()),
  environment: "production",
  tracesSampleRate: rate,
  tracesSampler: ({ name, attributes, inheritOrSampleWith }) => {
    const sampledRate = sampleTrace(name, attributes, rate);
    return sampledRate === 0 ? 0 : inheritOrSampleWith(sampledRate);
  },
});
