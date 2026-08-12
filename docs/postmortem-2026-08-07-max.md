# Post-mortem: the Max call, 7 Aug 2026

Robin reported "notes are disappearing." Comparing the saved live record
(`content/meetings/transcripts/2026-08-07-robin-sverd-and-max-semenchuk-live.md`)
against the final Fireflies transcript for the same meeting
(`01KZ923BV4SWH22QC42BV7JZEH`, 59:04, 713 sentences) turned up three separate
faults, one of which is much worse than disappearing notes.

## 1. The copilot never heard Robin — the whole call

Fireflies' realtime ASR locked Robin's channel to the wrong language. Measured
over the window the live record kept (31:03 → end):

| Speaker | Live stream | Final transcript |
|---|---|---|
| Max | 2111 words, 0 Cyrillic | 1980 words |
| Robin | 264 words, **736 Cyrillic chars** | 1616 words |

Max came through at ~100%. Robin came through as Ukrainian/Russian fragments —
"Я. Мм. На дачу. Майн Змі." — carrying no recoverable meaning. The final
transcript has Robin in clean English throughout, so this is purely a realtime
stream defect, not audio.

Consequences, all visible in the record:

- 26 of the 60 saved feed items are **Ask** items aimed at Max, many re-asking
  things Robin had already asked. The model never saw him ask them.
- The Navigator read "Robin gathering product understanding" for an hour — it
  had no evidence of Robin at all.
- The chat AI actually diagnosed it live ("The transcript is too garbled (mixed
  Ukrainian fragments, audio dropout)") and nothing surfaced that to Robin.

**Fixed:** `garbledSpeakers` in `v2/feed.ts` flags any speaker whose recent
lines are ≥30% non-Latin script, and the transcript pane shows a banner naming
them while there is still time to restart the bot. The stream itself can't be
fixed client-side — check the Fireflies workspace language setting too.

**Update 2026-08-08 — root cause found, and it is not ours.** See
[the language investigation](#the-language-lock-2026-08-08) below.

## 2. The feed cap was silently deleting items

`FEED_CAP` was 60, applied as a hard `.slice(0, 60)` **after** `prioritize()`
sorts done-items to the bottom. The saved record holds exactly 60 items spanning
13:45:29 → 14:01:09 — the last 16 minutes of a 59-minute call, and exactly one
`done` item.

The eviction chain:

1. New AI items `unshift` onto the feed every 12s.
2. Only the top 24 are ever shown to the model, so anything below 24 can never
   be re-ranked upward — it only sinks.
3. `prioritize` puts handled items dead last.
4. `.slice(0, 60)` deletes the tail — handled notes first.

So the items most likely to be destroyed were the ones Robin had already acted
on. That is the disappearing-notes report, exactly.

**Fixed:** `FEED_CAP` 60 → 400. Nothing downstream wanted it small; the model
reads the top 24 and the UI has filters and sorts.

## 3. Half the transcript never made it into the record

`lines` was capped at 500. The saved transcript starts at **31:03 of 59:04** —
400 of 713 sentences, **53% of the words**, gone. Lost content includes Max on
chaos theory, his Binance/Ukraine AI work, Macha's video-analysis framework,
and — a real buying signal — running out of tokens mid-study and weighing
whether to buy a bigger plan.

**Fixed:** `LINES_CAP` 500 → 3000 (~3h of talk). Both caps are now documented as
runaway backstops, not working limits.

## 4. A fifth of the feed was the AI paraphrasing itself

Dedupe was exact-lowercase-match only, so restatements each claimed a slot:

- "Robin: map ZK model to Robin—each party proves specific facts…"
- "Robin: map ZK-proof model to Robin—each party proves facts without exposing…"

8 of the 60 saved items are near-duplicates of another. Those 8 slots evicted 8
real ones.

**Fixed:** `isNearDupe` in `v2/feed.ts` — word-overlap against the shorter item,
same type only (a Note recording what was said is never merged into the Ask that
prompted it). Threshold 0.6, tuned against this exact feed: 8 dropped, all
genuine, 0 false positives.

## 5. Map: spacing and broken filaments (same root cause)

Rings were evenly spaced at 260px. This conversation nested 20 deep, so the
outer ring sat at a 5200px radius that was almost entirely empty. Worse, the
grow-in animation used a hardcoded `strokeDasharray: 900`, so any filament
longer than 900 user units rendered 900-on/900-off — a line with a hole in it.
At depth 20 a single wedge step is over 1000px of tangential travel, which is
why edges looked disconnected specifically on the outer rings.

**Fixed:** ring radius is now `230 · depth^0.72` (depth 20: 1989px instead of
5200, still ~70px between the outermost rings), and edges use `pathLength={1}`
so the dash always matches the curve it's drawn on.

## Verification

`npm run verify` — exit 0, 91 tests pass. Seven new tests in `v2/feed.test.ts`
pin the dedupe and the wrong-language detector against the real strings from
this call.

## The language lock, 2026-08-08

The first lead was that a workspace/account language setting reaches the
realtime path differently than the batch path. **It doesn't. That hypothesis is
dead**, and so is any fix on our side of the wire.

What was checked:

| Question | Answer |
|---|---|
| Fireflies **Personal** meeting language | `English (Global)` — explicit, not `Auto-detect` |
| Fireflies **Team** meeting language | `English (Global)` — same |
| Language param on the realtime socket | **None exists.** Auth is `{token, transcriptId}`, full stop |
| Language field on `transcription.broadcast` | **None.** `transcript_id, chunk_id, text, speaker_name, start_time, end_time` |
| Language anywhere else in the API | Only `addToLiveMeeting(language:)` and `uploadAudio(custom_language:)` — neither is on the realtime path, and we call neither |
| Does our code pass language differently per path? | No. We pass none, on either path — there is no asymmetry to fix |

The dropdown does offer `Auto-detect` and `Multi-Language (Auto Detect) (Beta)`.
Robin's account is on neither. Fireflies' realtime beta is ignoring the pinned
language and running its own detection.

It is also not per-speaker, which is what the first read of this call suggested.
On **2026-07-31**, the previous call with Max, *both* speakers came through
Cyrillic (Robin 17/17 turns, Max 17/17). On 2026-08-07 only Robin did (70/70,
Max 0/70). It is a whole-stream mis-detection that Max's clearer audio partly
escaped the second time — not a channel locked to one person. Both meetings were
Max's Zoom room; the Google Meet calls either side of them are clean.

**What can't be fixed here:** the lock. No API surface reaches it. The one
untried lever is joining the bot ourselves with
`addToLiveMeeting(meeting_link, language: "en")` instead of letting the calendar
auto-join it — but the bot is already in the room by then, so calling it risks a
second notetaker in a live call, and nothing says that argument feeds the
realtime pass rather than the batch pass that is already correct. Not worth
firing blind during a real meeting.

**What was fixed instead — keeping the garbage out of the copilot.** The banner
told Robin; it did nothing to stop the model being fed noise. Every transcript
handed to a model now goes through `transcriptContext` (`v2/feed.ts`), which
drops garbled speakers' lines and replaces them with an explicit
`[TRANSCRIPTION FAILING]` header naming them. That matters because Cyrillic
fragments read to a model *both* as Robin being silent and as Robin having said
something — which is how one hour produced 26 Asks re-asking his own questions.
It filters before windowing, so losing 70% of the turns no longer starves the
context.

**And made the diff automatic.** `node server/langcheck.mjs` diffs every live
record against its final Fireflies transcript and exits 1 on any speaker garbled
live but clean in final. The standing rule was already "always diff live against
final" — it was a manual ritual, so nobody ran it, which is why 31 Jul went by
unnoticed and it took Max saying it out loud on 7 Aug.

## Still open

- **The lock itself**, upstream in Fireflies' realtime beta. Worth a support
  report with these two transcript ids.
- The live record is written once, at export. A mid-call crash still loses the
  meeting — the caps no longer do.
