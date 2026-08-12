# Fireflies Live

Robin's during-meeting copilot: capture a Fireflies call, keep one calm human-prioritized cue visible, and prepare a durable record for post-call work. The current deployment is intentionally single-operator; the code does not assume a future tenancy model.

## Architecture

- `v2/` — React/Vite client. It receives capability flags and same-origin streams, never provider keys or the bridge bearer token.
- `server/serve.mjs` — production static server and API boundary. Production API routes require a Robin-only session.
- `server/app-api.mjs` — fixed-destination Fireflies/OpenRouter relays, narrow bridge routes, auth enforcement, and meeting-record endpoints.
- `server/meeting-store.mjs` — fsynced append-only checkpoints, atomic final records, interrupted-session recovery, and terminal-record lifecycle controls.
- `server/bridge.mjs` — loopback-only, token-gated workspace bridge. Suggested commands remain staged for human review before execution.

Transcript text and model output are untrusted data. They must never become system instructions or bypass the existing reviewed command flow.

## Local development

```bash
npm ci
npm run dev
```

The Vite server runs on `http://127.0.0.1:5173` and starts the bridge. Local auth is optional unless `FIREFLIES_APP_AUTH_REQUIRED=1` or `FIREFLIES_APP_SECRET` is configured. Production additionally requires an allowed Tailscale login. Provider processing is always explicit: add the approved processors to the env file before those capabilities turn on.

## Required production configuration

`server/serve.mjs` requires `SERVE_HOSTS` and always fails closed when application auth is absent. Put secrets in `SERVE_ENV_FILE` (default `/opt/Thrivbe-AI/.env`), not in browser code:

```dotenv
FIREFLIES_APP_SECRET=<unique high-entropy server-side session secret>
FIREFLIES_ALLOWED_TAILSCALE_LOGINS=robin@thrivbe.com
FIREFLY_API_KEY=<Fireflies API token>
OPENROUTER_API=<OpenRouter API token>
FIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies
FIREFLIES_FINAL_RETENTION_DAYS=90
```

`FIREFLIES_APP_SECRET` never enters the browser. Tailscale Serve strips spoofed identity headers and supplies the authenticated login; only an explicitly allowed login can exchange that identity for the short-lived application session. The processor allowlist is an operational acknowledgement, not a vendor-policy decision made by this repository. Omit a provider until Robin has accepted its data handling; the UI will show the blocked capability. `FIREFLIES_APP_COOKIE_SECURE=1` is mandatory for the approved HTTPS production path; a plain-HTTP deployment cannot use the production policy.

The approved production path is `https://hetzner.tail9908c7.ts.net:8453/`, terminated by Tailscale Serve and available only inside Robin's tailnet. The application backend binds `127.0.0.1:3017`; direct tailnet-IP HTTP access is intentionally removed. The current processor policy is `fireflies` only: Fireflies remains the inbound transcript source, while OpenRouter and every external AI transcript processor remain blocked.

The checked-in service template binds the Node server to loopback and expects Tailscale Serve to provide private HTTPS. Deployment still requires an explicit service install/restart and Tailscale Serve configuration; the service-user and firewall posture remain separate infrastructure follow-ups.

## Retention and cleanup

Defaults protect recovery while reducing stale checkpoint copies:

- `FIREFLIES_CHECKPOINT_COMPACT_AFTER_HOURS=24` — terminal journals are compacted to terminal metadata; interrupted journals are untouched.
- `FIREFLIES_CHECKPOINT_RETENTION_DAYS=30` — terminal journals expire; interrupted/recoverable journals are untouched.
- `FIREFLIES_FINAL_RETENTION_DAYS=90` — finalized Markdown records are eligible for cleanup after 90 days, reflecting Robin's retention decision. The setting remains configurable.

Preview lifecycle work first:

```bash
npm run cleanup:meetings
npm run cleanup:meetings:apply
```

The command reads the same env file, reports basenames only, and never deletes a session that lacks a terminal final/discard event. No schedule is installed by this project.

## Verification

```bash
npm run verify
```

The gate runs lint, the recovery/auth/retention/stream tests, the production build/typecheck, and a production-dependency audit. `socket.io-parser` is locked to the compatible patched `4.2.7` through `package-lock.json`.

See [docs/RELIABILITY-SECURITY-FOUNDATION.md](docs/RELIABILITY-SECURITY-FOUNDATION.md) for operational detail and [docs/ROADMAP.md](docs/ROADMAP.md) for product decisions that remain open.
