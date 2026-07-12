# 🧭 Adaptive Navigator — Design (Phase 7)

> Fireflies Live stops being a *transcriber with tips* and becomes a **goal-conditioned
> conversation navigator**: it knows Robin's goal, tracks where the conversation *is*,
> pulls his own resources (wikis, meeting history, network) into the moment, and guides
> what to say, how to say it, and how to act — live.

Requested 2026-07-12: *"an adaptive constellation that emerges based on my request …
it finding the necessary context … supporting me with what I should say, how to say
it, how to act."*

---

## 1. 🧩 The three missing ingredients

Today's app sees only the transcript. The navigator adds three things it never held:

| Ingredient | What it is | Where it comes from |
|---|---|---|
| 🎯 **Goal** | What Robin wants out of *this* conversation (objective, red lines, desired next step) | Robin states it at connect (free text) |
| 🧭 **Situation** | Where the conversation is *right now* — phase, counterpart stance, goal distance, next best move | A slow AI loop over the live transcript |
| 🌌 **Constellation** | The resources that matter for *this* conversation — counterpart dossier, meeting history, playbooks | Assembled on demand from Robin's corpora |

**Constellation ≠ mode.** A mode is a static prompt template. A constellation is
assembled per conversation from Robin's request: entities resolved → dossier pulled,
topic understood → playbooks retrieved, history found → injected. The old mode chips
survive only as shorthand seeds.

## 2. 🔁 Architecture — three loops at three speeds

```
🎯 GOAL CARD (once, at connect — editable mid-call)
   "Renewal with Bianca — commit to 3 smoke tests, don't go below X, leave with a date"
        │
        ▼
🌌 CONSTELLATION (on demand, seconds)         bridge POST /context
   🧑 people dossier      ← semsearch corpus=people
   📜 meeting history     ← semsearch corpus=meetings → local analysis excerpts
   📚 playbooks           ← semsearch corpus=wiki_skills (titles)
   🧠 knowledge base      ← semsearch corpus=notion (titles)
   📁 client folder       ← clients/<match>/ *.md
        │  compact markdown bundle (≤8 KB) + source chips
        ▼
🧭 NAVIGATOR LOOP (~45 s pulse)               OpenRouter, JSON-only
   situation frame: { phase, stance, goal_progress, next_move, risk }
        │  ~300-token frame, shown as a strip + injected downstream
        ▼
⚡ FAST LOOP (8–12 s, pre-existing)           suggestions · "Say this" · chat
   every prompt now carries: GOAL + SITUATION + CONSTELLATION (capped)
```

Physics: the fast loop must stay fast → **no retrieval inside it**. Retrieval is
async and user-triggered; the navigator compresses everything into a small frame that
rides along in every fast-loop call.

## 3. 📊 Data contracts (verified 2026-07-12)

### semsearch (turbovec, Mac tunnel `127.0.0.1:3015`)
```
POST /search {"query": "...", "k": 6, "corpus": "meetings"|"wiki_skills"|"notion"|"people"|"documents"}
→ people:  {results:[{rowid, score, id, name, headline, company, location}]}
→ others:  {results:[{rowid, score, node_id, node_type, title, path, chunk_index}]}
Live corpora: documents 4154 · meetings 125 · notion 34174 · people 2019 · wiki_skills 10578
Scores: ~0.3 weak · ~0.5+ strong.
```
- `meetings` paths are relative to `/Users/robinsverd/Thrivbe-AI/content/` and **resolve
  locally** → full excerpts available.
- `wiki_skills` paths are absolute into `wiki/` which is only partially mirrored on the
  Mac → **titles only** (Hormozi-style titles carry the lesson). Full text = Phase 7.4.

### bridge `POST /context` (token-authed, loopback, same guard stack as /file)
```
in : { goal: string, counterpart?: string, topic?: string }
out: { ok, bundle: string (markdown ≤ 8 KB), sources: [{kind, label, n}] }
```
Fan-out with per-call timeout (Promise.allSettled — a dead tunnel degrades to fewer
sources, never an error). File reads are validated to stay under fixed roots
(`content/`, `clients/`) — semsearch-returned paths are resolved + prefix-checked.

### navigator frame (OpenRouter, JSON-only, ≤250 tokens)
```json
{ "phase": "opening|discovery|pitch|objections|negotiation|closing|smalltalk",
  "stance": "one line on the counterpart's current position/mood",
  "goal_progress": "short assessment vs. the goal card",
  "next_move": "the single best next move for Robin",
  "risk": "biggest live risk (or empty)" }
```

## 4. 🖥️ UI

- **Goal card**: textarea at the top of the config slide-over + a compact 🎯 pill in the
  sidebar summary row. Editable mid-call. Persisted (`fl-config`).
- **Constellation panel** (slide-over, under the goal): counterpart/topic inputs +
  *Assemble* button → source chips with counts (🧑3 · 📜2 · 📚6 · 🧠4 · 📁1), each with
  the bundle stored behind it. *Clear* resets. Persisted (`fl-session`).
- **Navigator strip**: one compact row pinned above the transcript when connected —
  `🧭 negotiation · 🌡 "cost-concerned but engaged" · 🎯 1/3 asks · ▶ reframe as pilot`
  — with a manual ↻ refresh. Hidden until the first frame arrives.

## 5. 🔐 Privacy ceiling

7.1–7.3 send goal + transcript + bundle to **OpenRouter** — same trust surface as the
existing chat, but the bundle can carry client data. Acceptable for the operator's own
dev tool; the real fix is **7.4: route retrieval + guidance through the thrivbe-os
kernel on Thrivbe-1** (merges with Phases 6.2/6.3), which also unlocks full wiki text
and Twenty/Notion enrichment server-side.

## 6. 🚀 Build phases

| Step | Scope | Infra |
|---|---|---|
| 🎯 **7.1 Goal card** | Intent composer; every prompt goal-conditioned | none — prompts + one textarea |
| 🧭 **7.2 Navigator strip** | 45 s situation-frame pulse + strip + downstream injection | none — one more OpenRouter call |
| 🌌 **7.3 Constellation** | bridge `/context` fan-out over semsearch corpora + local files; chips UI; bundle injection | bridge endpoint (pattern exists) |
| 🏢 **7.4 Kernel-native** | retrieval/guidance via Thrivbe-1 kernel; full wiki text; Twenty/Notion; private routing | merges with 6.2/6.3 |

Ship order = value order: 7.1 is ~80 % of the felt difference at zero infra.
