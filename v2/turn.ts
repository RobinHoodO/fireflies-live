// Jev (TypeSafe System One) turn-trigger gating. The "Say this" draft is on a
// fixed floor (SAY_MIN_GAP_MS, App.tsx) — a timer is a guess; the moment a
// question lands is a judgment. Jev judges that moment; this module decides
// whether to spend a call on it and whether the answer clears the bar to
// bypass the floor. Jev never writes text — the draft stays OpenRouter.
// Pure helpers only — the React wiring lives in App.tsx.
// .ts extension: this module is also loaded directly by `node --test`.

export const JEV_TURN_THRESHOLD = 0.8;
// Jev is a fast trigger, not a poll loop — never spend more than one call per
// this many ms, however often the effect re-runs.
export const JEV_MIN_INTERVAL_MS = 2500;

export interface TurnGateInput {
  // A genuinely new final transcript line since the last check — there is
  // nothing fresh to judge otherwise.
  hasNewFinalLine: boolean;
  // Never redraft while the host is mid-turn: the draft is for when the other
  // side hands the turn back.
  lastSpeakerIsHost: boolean;
  now: number;
  lastJevCallAt: number;
}

// Should we spend a Jev call right now?
export function shouldConsultJev({ hasNewFinalLine, lastSpeakerIsHost, now, lastJevCallAt }: TurnGateInput): boolean {
  if (!hasNewFinalLine || lastSpeakerIsHost) return false;
  return now - lastJevCallAt >= JEV_MIN_INTERVAL_MS;
}

// Does the probability Jev returned clear the bar to bypass the 25s floor?
// null/NaN means Jev didn't answer (disabled, timeout, error, garbage body) —
// never treated as a yes; the caller falls back to the existing timer.
export function clearsTurnBar(p: number | null): boolean {
  return typeof p === "number" && Number.isFinite(p) && p >= JEV_TURN_THRESHOLD;
}
