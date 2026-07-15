# Plan 015: Housekeeping — gitignore artifacts, surface dead-model errors

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- .gitignore v2/backend.ts v2/App.tsx`.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

Two unrelated small cleanups: (1) a stray binary screenshot is committed and the
`.playwright-mcp/` snapshot dir is un-gitignored (one snapshot already leaked into
tracking, more will follow); (2) when a hardcoded OpenRouter model slug goes stale,
`callAI` returns a generic "Couldn't generate a response." with no signal about
which model died — the operator can't tell a dead slug from a real failure.

## Current state

- Tracked junk: `after-spacing.png` (root screenshot) and one
  `.playwright-mcp/page-*.yml` are tracked (`git ls-files`); `.gitignore` has no
  `.playwright-mcp/` entry.
- `callAI` (`v2/backend.ts:106-114`): on any non-2xx / missing `choices`, returns
  the string `"Couldn't generate a response."` — no status code, no model name.
- Model roster hardcoded in `v2/data.ts:17-53`; default at `v2/App.tsx:93`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Verify | `npm run verify` | exit 0 |

## Scope

**In scope**: `.gitignore`, remove the two tracked artifacts from git,
`v2/backend.ts` (`callAI` error surfacing only).
**Out of scope**: auto-fetching the model list from OpenRouter's `/models`
endpoint (a larger feature — note it deferred); the design-artifact zip/jpeg/HTML
at root (leave per audit scope).

## Steps

### Step 1: Gitignore and untrack the artifacts

Add to `.gitignore`:
```
.playwright-mcp/
after-spacing.png
```
Then untrack (keep the working-tree files): `git rm --cached after-spacing.png`
and `git rm --cached` the tracked `.playwright-mcp/page-*.yml` file (find it with
`git ls-files .playwright-mcp`).

**Verify**: `git ls-files after-spacing.png .playwright-mcp` → no output.

### Step 2: Surface a clear error when a model call fails

In `callAI` (`v2/backend.ts:106-114`), when the response is not ok or has no
`choices`, return a message that names the HTTP status and the model slug, so a
stale slug is diagnosable — without throwing (callers render the string):

```ts
const d = await r.json().catch(() => null);
const content = d?.choices?.[0]?.message?.content;
if (content) return content;
const detail = d?.error?.message ? `: ${String(d.error.message).slice(0, 120)}` : "";
return `⚠ Model "${model}" returned no response (HTTP ${r.status})${detail}. It may be an invalid slug.`;
```

Keep the function's signature and return type (`Promise<string>`) unchanged so all
callers keep working. Do not change the streaming path or the pulse validators
(they parse the returned string and tolerate non-JSON → null already).

**Verify**: `npm run typecheck:v2` → exit 0.

### Step 3: Verify

**Verify**: `npm run verify` → exit 0.

## Done criteria

- [ ] `.playwright-mcp/` and `after-spacing.png` are gitignored and untracked (working files remain)
- [ ] `callAI` returns a diagnostic message naming the model slug + HTTP status on failure
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

- A pulse validator (`fetchSentiment`, `fetchSuggestions`, etc.) starts
  mis-behaving because the new error string is longer / contains characters its
  slice/parse assumes away — the validators return null on non-JSON, so this
  shouldn't happen; if it does, report which validator.

## Maintenance notes

- Deferred (worth a roadmap "Known follow-ups" line): populate/validate the model
  roster from OpenRouter's `/models` endpoint so slugs can't silently rot.
- The design-artifact files at root (`Fireflies Live (standalone).html`, the zip,
  the jpeg) are intentionally left tracked/untracked per the audit — don't touch
  them here.
