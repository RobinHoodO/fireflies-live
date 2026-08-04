// The live feed: suggestions (ask/do/note/command) and agenda points
// (topic/clarify/branch) are ONE list with one priority ladder.
// Pure helpers only — the React state lives in App.tsx.
// .ts extension: this module is also loaded directly by `node --test`.
import { type FeedType } from "./backend.ts";

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
