# Plan 003: Test the pure LLM-output validators and the markdown escaper

> **Executor instructions**: Follow step by step; run every verification command
> and confirm the expected result. On a STOP condition, stop and report. Update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/backend.ts v2/md.ts`
> On any change, compare the "Current state" excerpts against live code; mismatch
> = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

`v2/backend.ts` defends the UI against malformed LLM output: `modelJsonArray` /
`modelJsonObject` strip code fences and slice to bracket bounds before
`JSON.parse`, and the per-feature validators clamp/cap/reject bad shapes
(sentiment score, suggestion types, agenda order). `v2/md.ts` HTML-escapes model
and transcript text before it is rendered via `dangerouslySetInnerHTML`. These
are exactly the string→value functions whose regression would crash the live UI
or open an injection sink — and they are pure, so they are the cheapest possible
tests with real safety value. This plan pins their behavior.

## Current state

Relevant excerpts (from `v2/backend.ts`):

- Module-private helpers (lines 29-43):
  ```ts
  function modelJsonArray(raw: string): any[] | null {
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    try { const value = JSON.parse(clean.slice(clean.indexOf("["), clean.lastIndexOf("]") + 1)); return Array.isArray(value) ? value : null; } catch { return null; }
  }
  function modelJsonObject(raw: string): Record<string, any> | null { /* same shape, { } bounds */ }
  ```
- `fetchSentiment` validator core (line ~140): rejects when
  `typeof value.score !== "number" || !Number.isFinite(value.score) || typeof value.label !== "string"`; else returns `{ score: Math.max(-1, Math.min(1, value.score)), label: value.label.trim().slice(0, 24) }`.
- `shq` (line ~242): `return "'" + s.replace(/'/g, "'\\''") + "'";` — single-quote shell escaping.

`v2/md.ts` (whole file, ~27 lines): `esc()` replaces `&`, `<`, `>` with entities
across the whole string; `inl()` then adds `<strong>`/`<em>`/`<code>` around
captured groups; `mdToHtml()` builds the final HTML string.

**Key obstacle**: `modelJsonArray`, `modelJsonObject`, and `shq` are **not
exported**. You must add a test-only export barrel — do NOT change their
visibility inline in a way that pollutes the public surface. Use the pattern in
Step 1.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Run these tests | `node --test v2/backend.test.ts v2/md.test.ts` | all pass |
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Full verify | `npm run verify` | exit 0 |

**Note on running TS under `node --test`**: this repo's Node runs `.ts` via the
build, not natively. Before writing tests, check whether `node --test` can load
`.ts` here: run `node --test --experimental-strip-types v2/md.test.ts` on a
trivial test. If native TS stripping works (Node ≥22.6 with the flag, or ≥23.6
by default), use `.ts` test files and add `"test": "node --test --experimental-strip-types"`
adjustment. If it does NOT work, STOP and report — the fallback (compile-then-test
or add a `tsx` loader) is a decision for the operator, not an improvisation.

## Scope

**In scope**:
- `v2/backend.ts` — add a single `export` for the three private helpers (see Step 1), nothing else.
- `v2/backend.test.ts` (create)
- `v2/md.test.ts` (create)
- `package.json` — only if the `test` script needs the TS-strip flag (per the note above).

**Out of scope**:
- Any behavior change to the validators or `md.ts`. Tests characterize current
  behavior; if a test reveals a genuine bug, note it as a finding and STOP — do
  not fix it here (fixing changes behavior and belongs in its own plan).
- The network-calling wrappers (`fetchSuggestions`, `fetchAgenda`, etc.) beyond
  their pure validation core — do not stand up a fetch mock in this plan; test
  only the exported pure helpers and `fetchSentiment`'s clamp via a fetch stub if
  trivial, else skip it and note it.

## Steps

### Step 1: Export the pure helpers for testing

At the **end** of `v2/backend.ts`, add one line that re-exports the private
helpers under a clearly test-scoped name, so the public API is unchanged:

```ts
// Test-only surface — pure helpers exercised by v2/backend.test.ts.
export const __test = { modelJsonArray, modelJsonObject, shq };
```

**Verify**: `npm run typecheck:v2` → exit 0.

### Step 2: Write `v2/md.test.ts`

Import `mdToHtml` from `./md`. Assert:

- `mdToHtml("<script>alert(1)</script>")` output contains `&lt;script&gt;` and
  does NOT contain a literal `<script>`.
- `mdToHtml("a & b")` contains `&amp;`.
- `mdToHtml('<img src=x onerror=alert(1)>')` contains `&lt;img` (no literal `<img`).
- Formatting round-trips: `mdToHtml("**bold**")` contains `<strong>bold</strong>`;
  `mdToHtml("`code`")` contains `<code>` and the code text; a `- item` line
  produces a list item. (Match the exact tags `md.ts` emits — read the file first
  and assert against what it actually generates.)

**Verify**: `node --test ... v2/md.test.ts` → all pass.

### Step 3: Write `v2/backend.test.ts`

Import `{ __test }` from `./backend`. Assert:

- `modelJsonArray('```json\n[1,2]\n```')` → `[1,2]`.
- `modelJsonArray('prose then [{"a":1}] trailing')` → `[{a:1}]`.
- `modelJsonArray('not json at all')` → `null`.
- `modelJsonArray('{"a":1}')` → `null` (object, not array).
- `modelJsonObject('```\n{"x":1}\n```')` → `{x:1}`.
- `modelJsonObject('[1,2]')` → `null` (array rejected).
- `modelJsonObject('garbage')` → `null`.
- `__test.shq("it's")` → `'it'\''s'` (assert exact string — this is the shell-escape correctness that protects the `pi` argv).

**Verify**: `node --test v2/backend.test.ts` → all pass.

### Step 4: (Optional) sentiment clamp

If, and only if, `fetchSentiment` can be exercised without real network by
injecting a stub for `callAI` cheaply, add cases asserting: `score: 5` clamps to
`1`, `score: -5` clamps to `-1`, `score: "high"` (string) → `null`, a 40-char
label is truncated to 24. If wiring a stub requires refactoring `callAI` into an
injectable seam, DO NOT do it in this plan — note it as deferred and move on.

**Verify**: `node --test v2/backend.test.ts` → all pass (with or without Step 4).

## Test plan

- `v2/md.test.ts` (~5 cases), `v2/backend.test.ts` (~8 cases).
- No prior test to model after; use `node:test` + `node:assert/strict`.
- Verification: `npm run verify` → exit 0, new tests discovered and passing.

## Done criteria

- [ ] `node --test v2/backend.test.ts v2/md.test.ts` passes with ≥12 tests
- [ ] `v2/backend.ts` diff is exactly one added `export const __test = ...` line
- [ ] `npm run typecheck:v2` exits 0 (the new export typechecks)
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

- `node --test` cannot load `.ts` files in this environment and native
  type-stripping is unavailable — report the Node version and stop (loader choice
  is the operator's).
- Any test reveals the validator or escaper is actually *wrong* (e.g. `esc` misses
  a character) — report it as a security/correctness finding and stop; do not
  change behavior in a test-only plan.

## Maintenance notes

- If `md.ts` ever gains link/image syntax (`[text](url)`), this suite must add
  `javascript:`-URI and attribute-injection cases — the current escaper is safe
  precisely because there is no attribute sink.
- Keep the `__test` export marked test-only; if a future refactor makes these
  helpers genuinely public, move them to a named export and update the import.
