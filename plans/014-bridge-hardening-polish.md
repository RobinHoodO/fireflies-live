# Plan 014: Two bridge hardening fixes — fail-closed key gate, symlink-safe path rooting

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/vite.config.ts server/bridge.mjs`. Mismatch on an excerpt = STOP for that fix.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (realpath may reject a legitimately-symlinked corpus — verify none is relied on)
- **Depends on**: plans/002-bridge-guard-tests.md (add the symlink-escape test there)
- **Category**: security
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

Two defense-in-depth gaps, both LOW severity under the single-operator model but
cheap to close:
1. The `/api/fireflies-key` same-origin gate treats a **missing** `sec-fetch-site`
   header as allowed — it reads as same-origin enforcement but silently passes
   header-less requests (practical exfil is still blocked by the absent CORS
   header, so this is hardening, not an open leak).
2. `rootedPath` uses a lexical `startsWith` prefix check that does not resolve
   symlinks, so a symlink placed inside `content/` or `clients/` pointing outside
   the root would pass and be read (up to the 2MB cap). Requires a pre-existing
   symlink, hence low severity.

## Current state

**Fix 1** — `v2/vite.config.ts:22-24`:
```js
const sfs = req.headers["sec-fetch-site"];
const crossOrigin = sfs && sfs !== "same-origin" && sfs !== "none";
if (!loopbackHost || crossOrigin) { res.statusCode = 403; ... }
```
When `sfs` is undefined, `crossOrigin` is `false` → only the loopback Host check
remains. This endpoint returns the Fireflies + OpenRouter keys and the bridge
token (line ~30).

**Fix 2** — `server/bridge.mjs:68-71`:
```js
const rootedPath = (root, target) => {
  const resolved = path.resolve(root, target);
  return resolved.startsWith(`${root}/`) ? resolved : "";
};
```
Consumed at `:244/:249` (meeting files under `CONTENT_ROOT`) and `:272/:281/:286`
(client `.md` under `CLIENTS_ROOT`). `path.resolve` normalizes `..` and the
trailing `/` blocks sibling-prefix escapes — the only residual gap is symlinks
(no `realpath`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Syntax | `node --check server/bridge.mjs` | exit 0 |
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Bridge tests | `node --test server/bridge.test.mjs` | all pass |
| Verify | `npm run verify` | exit 0 |

## Scope

**In scope**: `v2/vite.config.ts` (the gate), `server/bridge.mjs` (`rootedPath` +
its call sites, which must become async), `server/bridge.test.mjs` (symlink test).
**Out of scope**: the folder-*matching* logic (plan 005), the network posture
(already solid).

## Steps

### Step 1: Fail closed on a missing `sec-fetch-site`

Change the gate so an absent header is treated as cross-origin (deny) unless it is
explicitly `same-origin` or `none`:

```js
const sfs = req.headers["sec-fetch-site"];
const sameOrigin = sfs === "same-origin" || sfs === "none";
if (!loopbackHost || !sameOrigin) { res.statusCode = 403; res.end("forbidden"); return; }
```

Keep the loopback Host check as the second factor.

**Verify**: `npm run typecheck:v2` → exit 0. Live: `npm run dev:v2`, open
`http://localhost:5173`, confirm the app still boots and the AI is not stuck
"offline" (the app's own same-origin fetch sends `sec-fetch-site: same-origin`, so
it must still pass). Stop the server. If the app breaks (its fetch lacks the
header in this browser), STOP and report — the gate can't fail-closed without
breaking the legit path; keep the old behavior and note it.

### Step 2: Make `rootedPath` symlink-safe

Convert `rootedPath` to resolve the real path and re-check the prefix. Because
`fs.realpath` is async, the helper becomes async and its call sites must `await`:

```js
import { realpath } from "node:fs/promises";
const rootedPath = async (root, target) => {
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(`${root}/`)) return "";
  try { const real = await realpath(resolved); return real.startsWith(`${root}/`) ? real : ""; }
  catch { return ""; } // nonexistent path — caller already tolerates ""
};
```

Update every call site (`:244,249,272,281,286`) to `await rootedPath(...)`. They
are already inside `async` request handlers, so `await` is available. Verify the
`realpath` of a nonexistent candidate rejecting → `""` matches the existing
"skip this hit" behavior (the callers already treat `""`/throw as skip).

**Verify**: `node --check server/bridge.mjs` → exit 0.

### Step 3: Symlink-escape test

In `server/bridge.test.mjs` (using the temp `BRIDGE_CLIENTS_ROOT` from plan 005,
or a temp `BRIDGE_CONTENT_ROOT` if you add one), create a client folder containing
a symlink pointing outside the root, then assert `/context` does not include that
symlinked file's content in the bundle. If neither root is env-overridable yet, add
a `BRIDGE_CONTENT_ROOT` fallback on line 26 (single-line change, in scope).

**Verify**: `node --test server/bridge.test.mjs` → all pass including the symlink test.

## Done criteria

- [ ] `/api/fireflies-key` denies requests with an absent/foreign `sec-fetch-site` and still serves the app's own same-origin fetch
- [ ] `rootedPath` resolves the real path and re-checks the root prefix; all call sites `await` it
- [ ] A symlink inside a corpus root pointing outside is not read (test passes)
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

- Step 1 breaks the app's own key fetch (the browser omits `sec-fetch-site`) —
  revert Step 1, keep the old gate, report.
- A legitimately symlinked corpus is relied upon (Step 2 makes a real folder stop
  resolving) — report the symlink; the realpath check may need an allowlist.

## Maintenance notes

- These are interim hardening on a local dev tool; the roadmap's Phase 6.3/7.4
  server-side move is the real fix (keys never reach the browser; retrieval runs
  server-side). Note as such.
- A reviewer should confirm the async `rootedPath` conversion didn't miss a call
  site (an un-awaited call now returns a Promise, which `startsWith` on would
  throw — grep `rootedPath(` and confirm each is awaited).
