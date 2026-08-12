# Reliability, privacy, and security foundation (2026-08-12)

This implementation protects the current Robin-only, during-meeting workflow while keeping future tenancy, product positioning, and vendor choices reversible.

## Application authorization

Production `server/serve.mjs` sets `requireAuth: true`. All non-auth `/api/*` routes fail closed with 503 until `FIREFLIES_APP_SECRET` is present in `SERVE_ENV_FILE`. A correct login creates a random, in-memory session and returns only an `HttpOnly; SameSite=Strict` cookie. Sessions expire after 12 hours by default (`FIREFLIES_APP_SESSION_HOURS`, bounded to 1–168), disappear on restart, and are invalidated by secret rotation. Login attempts are rate-limited per remote address.

The Host allowlist and `Sec-Fetch-Site` checks remain defense in depth; neither is treated as identity. `Secure` cookies can be enabled with `FIREFLIES_APP_COOKIE_SECURE=1` after HTTPS exists. No systemd, TLS, service-user, firewall, or host configuration was changed in this worktree.

## Provider boundary and deliberate data handling

`server/app-api.mjs` owns Fireflies, OpenRouter, and bridge credentials. Browser JavaScript receives capability booleans and same-origin results, never raw keys or the broad bridge token.

External processing is disabled unless `FIREFLIES_ALLOWED_DATA_PROCESSORS` explicitly contains the provider name:

```dotenv
FIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies
```

This is a technical acknowledgement surface, not legal or policy approval. Robin still needs to decide which providers may receive transcript data. Fireflies meeting discovery/live relay requires `fireflies`; AI/chat/feed processing requires `openrouter`. Missing approval is observable in the UI and produces a 403 at the server boundary.

**Production decision (2026-08-12):** the allowlist contains only `fireflies`, the inbound transcript source. `openrouter` is not approved, so outbound transcript processing by external AI providers is server-blocked. The private application endpoint is Tailscale Serve HTTPS on `hetzner.tail9908c7.ts.net:8453`; the Node server binds loopback and uses Secure cookies.

Transcript text remains untrusted. Prompts label it as conversation data, generated command suggestions are off by default, and a command is only staged in the reviewed low-privilege workflow—it is never executed from model output alone.

## Durable records and recovery

- The browser sends a complete Markdown checkpoint when content first appears, every 30 seconds, and via `sendBeacon` on page hide.
- Each checkpoint is appended as a private JSONL event and fsynced.
- Finalization fsyncs a private temporary file and atomically publishes it without overwriting collisions.
- A checkpoint with no later terminal event appears in `/api/meeting/interrupted`; the idle UI can recover the latest highest-sequence checkpoint or explicitly discard it.
- Client credential-shaped fields are ignored and infrastructure paths are reduced to basenames in browser responses.

## Retention and lifecycle

`server/cleanup-meetings.mjs` defaults to a read-only preview. `--apply` performs only the listed terminal-session work:

| Setting | Default | Effect |
|---|---:|---|
| `FIREFLIES_CHECKPOINT_COMPACT_AFTER_HOURS` | `24` | Replace a terminal multi-event journal with its terminal metadata event, removing its duplicate transcript content. |
| `FIREFLIES_CHECKPOINT_RETENTION_DAYS` | `30` | Delete terminal journals. |
| `FIREFLIES_FINAL_RETENTION_DAYS` | `90` | Delete finalized Markdown records after 90 days, Robin's chosen completed-session retention policy. |

Interrupted/recoverable journals are always preserved regardless of age. Per-session serialization prevents cleanup from racing a checkpoint/finalize operation. Final-file deletion is restricted to Markdown files directly inside the configured records directory. The repository installs no timer or service schedule.

Robin chose a 90-day retention period for completed session records on 2026-08-12. This does not apply to interrupted/recoverable sessions, which remain preserved regardless of age until Robin explicitly recovers or discards them.

## Human-first live behavior

Meeting setup now explicitly records the host speaker label and meeting type. Neutral conversation is the default; sales, discovery, facilitation, interview, standup, negotiation, and 1:1 remain choices rather than assumptions. The calm cue has one dismissible slot and may stay empty. It only surfaces a live non-command item Robin authored or upvoted.

## Verification and remaining infrastructure decisions

`npm run verify` covers auth fail-closed behavior, credential non-disclosure, provider policy guards, replay/recovery completeness, retention dry-run/application safety, stream/client cancellation, lint, typecheck/build, and production dependency audit. The vulnerable nested `socket.io-parser@4.2.6` was minimally updated to `4.2.7`.

Deployment prerequisites that are intentionally not applied here:

1. Generate a unique high-entropy `FIREFLIES_APP_SECRET` directly in the production secret file; never print or copy it into the repository.
2. Keep `FIREFLIES_ALLOWED_DATA_PROCESSORS=fireflies` until Robin explicitly approves another processor.
3. Keep the app behind the tailnet-only Tailscale Serve HTTPS endpoint with Secure cookies; do not enable Funnel for this port.
4. Preview lifecycle output before scheduling `npm run cleanup:meetings:apply` externally.
5. Separately review the existing root service user; this deployment does not broaden its access or claim that the command bridge is sandboxed.
