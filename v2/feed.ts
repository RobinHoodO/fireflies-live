// The live feed: suggestions (ask/do/note/command) and agenda points
// (topic/clarify/branch) are ONE list with one priority ladder.
// Pure helpers only — the React state lives in App.tsx.
// .ts extension: this module is also loaded directly by `node --test`.
import { AGENDA_TYPES, type FeedType } from "./backend.ts";

export type FeedItem = { id: number; type: FeedType; text: string; t: number; status?: "done"; outcome?: string; votes: number; source: "ai" | "you" };
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

export function sortFeed(items: FeedItem[], sort: FeedSort) {
  if (sort === "priority") return items; // already in priority order
  return [...items].sort((a, b) => {
    if (sort === "oldest") return a.t - b.t;
    if (sort === "type") return a.type.localeCompare(b.type) || b.t - a.t;
    if (sort === "open") return Number(a.status === "done") - Number(b.status === "done") || b.t - a.t;
    return b.t - a.t;
  });
}

// "agenda" is a group chip covering the three agenda kinds.
export function matchesFilter(type: FeedType, filter: string) {
  return filter === "agenda" ? (AGENDA_TYPES as string[]).includes(type) : type === filter;
}
