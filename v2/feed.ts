// The live feed: suggestions (ask/do/note/command) and agenda points
// (topic/clarify/branch) are ONE list with one priority ladder.
// Pure helpers only — the React state lives in App.tsx.
// .ts extension: this module is also loaded directly by `node --test`.
import { type FeedType } from "./backend.ts";
import { hostNodeId, type GraphNode } from "./graph.ts";

// `live` only means something for possibilities (see below): true while the
// question could still naturally be asked, false once the moment has passed.
export type FeedItem = { id: number; type: FeedType; text: string; t: number; status?: "done"; outcome?: string; votes: number; source: "ai" | "you"; live?: boolean };
export type FeedSort = "priority" | "newest" | "oldest" | "type" | "open";

export const FEED_SORTS: FeedSort[] = ["priority", "newest", "oldest", "type", "open"];

// Priority is the blend of the two signals. Robin's votes are human intuition
// and win outright — an upvoted item floats back to the top through every later
// AI re-ranking. The AI's ranking (the incoming array order) only breaks ties.
// Handled items sink to the bottom.
export function prioritize(items: FeedItem[]) {
  return [...items].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.votes - a.votes);
}

// Re-seat items into the AI's ranking; anything it didn't rank keeps its
// relative place after the ranked ones (it is never dropped).
export function applyOrder(items: FeedItem[], order: number[]) {
  const seen = new Set<number>();
  const ranked = order.reduce<FeedItem[]>((acc, id) => {
    const item = items.find(x => x.id === id);
    if (item && !seen.has(id)) { seen.add(id); acc.push(item); }
    return acc;
  }, []);
  return [...ranked, ...items.filter(x => !seen.has(x.id))];
}

// The AI paraphrases its own live suggestions constantly — "map ZK model to
// Robin" and "map ZK-proof model to Robin" arrive minutes apart as separate
// items. Exact-match dedupe never catches those, and each paraphrase costs a
// feed slot, which is how a real note gets pushed off the end. Word overlap
// against the shorter item (containment, so a restatement with extra preamble
// still matches) is enough; same type only, since a Note recording what was
// said is not the Ask that prompted it.
// ponytail: bag-of-words, no stemming — 0.6 was tuned against the 2026-08-07
// Max feed (8/60 dropped, all genuine). Reach for embeddings only if it misses.
const feedWords = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export function isNearDupe(text: string, type: FeedType, items: FeedItem[], threshold = 0.6) {
  const a = feedWords(text);
  if (!a.size) return false;
  return items.some(item => {
    if (item.type !== type) return false;
    const b = feedWords(item.text);
    if (!b.size) return false;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / Math.min(a.size, b.size) >= threshold;
  });
}

// Fireflies' realtime ASR auto-detects language per chunk and can lock a
// speaker to the wrong one. On 2026-08-07 Robin's entire side came through as
// Cyrillic fragments — 264 garbage words where the final transcript had 1616
// of English — so the copilot spent an hour advising on a one-sided
// conversation and re-asking questions Robin had already asked. Nothing
// client-side can fix the stream; the fix is to say so, loudly, while there is
// still time to restart the bot.
export function garbledSpeakers(lines: { speaker: string; text: string }[], minLines = 6) {
  const stats = new Map<string, { lines: number; bad: number }>();
  for (const l of lines) {
    const s = stats.get(l.speaker) ?? { lines: 0, bad: 0 };
    s.lines++;
    // Non-Latin script where the rest of the call is Latin = wrong language lock.
    if (/[\p{sc=Cyrillic}\p{sc=Greek}\p{sc=Arabic}\p{sc=Hebrew}]/u.test(l.text)) s.bad++;
    stats.set(l.speaker, s);
  }
  return [...stats].filter(([, s]) => s.lines >= minLines && s.bad / s.lines >= 0.3).map(([speaker]) => speaker);
}

export function sortFeed(items: FeedItem[], sort: FeedSort) {
  if (sort === "priority") return items; // already in priority order
  return [...items].sort((a, b) => {
    if (sort === "oldest") return a.t - b.t;
    if (sort === "type") return a.type.localeCompare(b.type) || b.t - a.t;
    if (sort === "open") return Number(a.status === "done") - Number(b.status === "done") || b.t - a.t;
    return b.t - a.t;
  });
}

// Which item types each filter chip covers. "Agenda" groups the points to
// cover; "Branch" is its own chip because a direction worth steering into is a
// different decision from a point to get through.
export const FILTER_TYPES: Record<string, FeedType[]> = {
  ask: ["ask"], do: ["do"], note: ["note"], command: ["command"],
  agenda: ["topic", "clarify"], branch: ["branch"],
};

export function matchesFilter(type: FeedType, filter: string) {
  return (FILTER_TYPES[filter] ?? []).includes(type);
}

// Two kinds of item, and the map treats them differently:
//
//   RECORD      — notes, tasks, commands, anything done. These happened at a
//                 point in the conversation and stay nailed to it. History.
//   POSSIBILITY — asks, clarifies, branches. These are options still open, so
//                 while they're live they travel with the conversation and sit
//                 at wherever we are NOW. The moment we've talked past one, it
//                 falls back to where it first came up and becomes history too.
export const POSSIBILITY_TYPES: FeedType[] = ["ask", "clarify", "branch"];

export const isOpenPossibility = (item: FeedItem) =>
  item.status !== "done" && POSSIBILITY_TYPES.includes(item.type) && item.live !== false;

// Which topic an item hangs off right now.
export function anchorFor(item: FeedItem, nodes: GraphNode[], tipId: number | null): number | null {
  if (isOpenPossibility(item) && tipId != null && nodes.some(n => n.id === tipId)) return tipId;
  return hostNodeId(item.t, nodes);
}
