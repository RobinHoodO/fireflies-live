// Session persistence: survive a page reload (tab discard, server restart)
// without losing the live meeting. Content is saved continuously and restored
// on boot only while fresh — a next-day boot still opens clean by design.

export const SESSION_MAX_AGE_MS = 6 * 3600_000; // restore content up to 6h old
export const RESUME_MAX_AGE_MS = 10 * 60_000;   // auto-reconnect only within 10min

export function packSession(state: Record<string, unknown>, now: number): string {
  return JSON.stringify({ ...state, savedAt: now });
}

// Returns the parsed session blob, or {} when absent, invalid, or stale.
export function unpackSession(raw: string | null, now: number, maxAgeMs: number = SESSION_MAX_AGE_MS): Record<string, any> {
  if (!raw) return {};
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object" || Array.isArray(s)) return {};
    if (typeof s.savedAt !== "number" || now - s.savedAt > maxAgeMs || s.savedAt > now + 60_000) return {};
    return s;
  } catch { return {}; }
}

// A reload mid-meeting should pick the call back up without a click: the saved
// session must be seconds-to-minutes old and have been live when it was saved.
export function shouldAutoResume(session: Record<string, any>, now: number): boolean {
  return session.status === "connected"
    && !!session.selectedMeeting && typeof session.selectedMeeting.id === "string"
    && typeof session.savedAt === "number" && now - session.savedAt <= RESUME_MAX_AGE_MS;
}
