import { finalRoleOf } from './state.js';
import type { NightState, RoleId, SeatIndex } from './types.js';

/**
 * The suspicion tracker (§9).
 *
 * A private memory aid: you tag other players with the role you think they
 * have. Entirely optional — nobody is made to fill it in — and scored for
 * accuracy at the end only if they used it.
 *
 * Because it is private and per-device it never touches the engine's
 * resolution. It only exists to be scored here.
 */

export interface Suspicion {
  by: SeatIndex;
  about: SeatIndex;
  role: RoleId;
  /** Night-order step or timestamp it was last changed. Kept for a future
   *  "when did you work it out" stat; not scored today. */
  at?: number;
}

/**
 * Which role a suspicion is checked against.
 *
 * 'final' is the default and is the same rule everything else in the app
 * follows (§6.0): what matters is the card someone ends the night holding,
 * because that is what they win or lose as, and it is what the table is
 * actually arguing about during the day.
 *
 * 'original' is offered because there is a real counter-argument — a player who
 * correctly worked out that Sanne was DEALT the Ziener was not wrong just
 * because the Dorpsgek moved her card afterwards. If the group finds 'final'
 * unfairly punishes good deduction, switch this.
 */
export type SuspicionBasis = 'final' | 'original';

export interface SuspicionScore {
  /** Correct out of tagged, or null when this player didn't use the tracker. */
  accuracy: number | null;
  tagged: number;
  correct: number;
}

export function scoreSuspicions(
  state: NightState,
  suspicions: Suspicion[],
  basis: SuspicionBasis = 'final',
): Record<SeatIndex, SuspicionScore> {
  const out: Record<SeatIndex, SuspicionScore> = {};

  for (let seat = 0; seat < state.seatCount; seat++) {
    out[seat] = { accuracy: null, tagged: 0, correct: 0 };
  }

  // Only the LAST tag per (by, about) pair counts. Changing your mind as the
  // night unfolds is the entire point of a memory aid; scoring every revision
  // would punish exactly the players using it properly.
  const latest = new Map<string, Suspicion>();
  for (const s of suspicions) {
    if (s.by === s.about) continue; // tagging yourself isn't deduction
    latest.set(`${s.by}:${s.about}`, s);
  }

  for (const s of latest.values()) {
    const score = out[s.by];
    if (!score) continue;
    const actual =
      basis === 'final' ? finalRoleOf(state, s.about) : state.originalRole[s.about];
    score.tagged++;
    if (actual === s.role) score.correct++;
  }

  for (const score of Object.values(out)) {
    score.accuracy = score.tagged === 0 ? null : score.correct / score.tagged;
  }

  return out;
}
