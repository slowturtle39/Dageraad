import { defaultNightOrder } from './roles.js';
import { liveFollowupRoles } from './resolve.js';
import { buildTimeline, type Timeline } from './timeline.js';
import type { GameConfig, RoleId } from './types.js';

/**
 * THE ANTI-LEAK INVARIANT (§5.1).
 *
 * Everything here is computed from the ACTIVE ROLE SET alone — public, chosen by
 * the host at setup, visible to everyone. Nothing may read the deal, who holds
 * what, where a card ended up, or what anyone chose.
 *
 * The dependency/gate logic lives in timeline.ts and is NOT duplicated here.
 * Two implementations of that would be free to drift, and drift in this
 * particular logic is a privacy bug rather than a visual one.
 */

export interface RoundSchedule {
  mode: 'tworound';
  /** Total rounds every player sits through, filler or not. */
  rounds: number;
  /** Which roles act live in each round (index 0 = round 1). */
  roundRoles: RoleId[][];
  /** Wall-clock timeline for those rounds. */
  timeline: Timeline;
}

/**
 * Round count for 'tworound' mode: one round for everybody's up-front
 * submissions, plus one for each active role that still needs a live follow-up.
 *
 * With the default preset (Droomwolf, Alpha Wolf, Mystieke Wolf, Dubbelganger,
 * Heks, Leerlingziener, Dorpsgek, Medium) that is exactly 2: the Dubbelganger is
 * the only reveal-then-decide role not pre-committing, because the Heks answers
 * from a stored rule. Dropping the Heks's pre-commit would make it 3 — which is
 * the entire reason she pre-commits.
 *
 * The Medium used to be the second pre-committer. Since her Looier swap became
 * forced (2026-08-26) she has no decision to defer, so she costs a round in
 * neither mode.
 */
export function computeRoundSchedule(
  activeRoles: RoleId[],
  config: GameConfig,
): RoundSchedule {
  const order = defaultNightOrder(activeRoles);
  const live = liveFollowupRoles(order, config);

  return {
    mode: 'tworound',
    rounds: 1 + live.length,
    roundRoles: [order, ...live.map((r) => [r])],
    timeline: buildTimeline(activeRoles, config),
  };
}

export type Schedule = RoundSchedule | Timeline;

export function computeSchedule(activeRoles: RoleId[], config: GameConfig): Schedule {
  return config.mode === 'tworound'
    ? computeRoundSchedule(activeRoles, config)
    : buildTimeline(activeRoles, config);
}
