import { resolveNight } from '../engine/resolve.js';
import type {
  Choice, DecisionRequest, GameConfig, NightResult, NightState, RoleId, SeatIndex,
} from '../engine/types.js';

/**
 * Replaying the night to find out what still needs deciding.
 *
 * The engine is synchronous and pure: it takes an AnswerProvider and runs
 * straight through. Orchestration is not — it has to stop and wait for a human
 * to tap something. Rather than making the engine async (and losing the
 * property that lets it move into a Cloud Function untouched), we replay it
 * from the start each time, feeding in every answer collected so far.
 *
 * Replay is cheap (microseconds) and exactly deterministic, so "run it again
 * with one more answer" is a legitimate strategy rather than a hack. It is also
 * the same trick the pre-commit resolver already relies on.
 */

/** Answers are keyed by seat and decision key: two seats can share a role. */
export function answerKey(request: DecisionRequest): string {
  return `${request.seat}:${request.key}`;
}

export type AnswerMap = ReadonlyMap<string, Choice>;

export interface ProbeResult {
  /** Every decision the engine asked for, in the order it asked. */
  requests: DecisionRequest[];
  /** Those we have no answer for yet. */
  unanswered: DecisionRequest[];
  /**
   * The resolution reached using the answers we have, with `{kind:'none'}`
   * standing in for anything unanswered.
   *
   * SAFE TO READ ONLY FOR SEATS WHOSE DECISIONS ARE ALL ANSWERED. Anything
   * downstream of a placeholder is provisional and must not be shown to
   * anyone — releasing it early is exactly the leak this whole design is
   * built to prevent. `settledSeats` below is the guard.
   */
  result: NightResult;
  /**
   * Seats with no outstanding decisions of their own. Their private info in
   * `result` is final as far as their own actions go.
   */
  settledSeats: Set<SeatIndex>;
}

const DECLINE: Choice = { kind: 'none' };

/**
 * Run the night with what we know, recording everything it asked for.
 *
 * Unanswered decisions are answered with "decline" rather than throwing, so a
 * single pass sees the whole night rather than stopping at the first gap. That
 * matters for the opening window, where every seat submits in parallel and we
 * need the full list up front to know what to prompt for.
 */
export function probe(
  state: NightState,
  nightOrder: RoleId[],
  config: GameConfig,
  answers: AnswerMap,
): ProbeResult {
  const requests: DecisionRequest[] = [];
  const unanswered: DecisionRequest[] = [];

  const result = resolveNight(state, nightOrder, config, (request) => {
    requests.push(request);
    const stored = answers.get(answerKey(request));
    if (stored === undefined) {
      unanswered.push(request);
      return DECLINE;
    }
    return stored;
  });

  const blocked = new Set(unanswered.map((r) => r.seat));
  const settledSeats = new Set<SeatIndex>();
  for (let seat = 0; seat < state.seatCount; seat++) {
    if (!blocked.has(seat)) settledSeats.add(seat);
  }

  return { requests, unanswered, result, settledSeats };
}

/**
 * Which outstanding decisions belong to a given window.
 *
 * The opening window takes everything that does not depend on a reveal —
 * everyone taps at once (§5.3).
 *
 * A follow-up window belongs to one role, and we match on the SEAT that was
 * DEALT that role, not on the request's `actingAs`. That distinction is load
 * bearing: when the Dubbelganger copies the Mystieke Wolf, its follow-up
 * request carries `actingAs: 'mystiekewolf'`, and matching on that would file
 * the Dubbelganger's decision under the wrong window — or no window at all.
 */
export function requestsForWindow(
  probeResult: ProbeResult,
  state: NightState,
  phase: { kind: 'open' | 'followup'; role: RoleId | null },
): DecisionRequest[] {
  if (phase.kind === 'open') {
    return probeResult.unanswered.filter((r) => !r.dependsOnReveal);
  }
  return probeResult.unanswered.filter(
    (r) => r.dependsOnReveal && state.originalRole[r.seat] === phase.role,
  );
}
