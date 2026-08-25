import { APPLIERS, type Ctx } from './appliers.js';
import { defaultNightOrder, roleDef } from './roles.js';
import { cloneNightState } from './state.js';
import type {
  Choice, DecisionRequest, GameConfig, NightEvent, NightResult, NightState,
  PrivateInfo, RoleId, SeatIndex,
} from './types.js';

/**
 * Answers a decision the engine pauses on. Supplied by the orchestration layer:
 *   - 'dependency' mode -> a live player's tap
 *   - 'tworound'   mode -> a stored submission, or a pre-commit rule evaluated
 *                          server-side for roles in config.precommitRoles
 */
export type AnswerProvider = (request: DecisionRequest) => Choice;

/**
 * Replay the night in canonical order.
 *
 * §6.0 is the load-bearing rule here: a seat's position in the order and the
 * action it performs come from `originalRole` (fixed at deal time), never from
 * whatever card it is currently holding. Cards move; turns do not.
 *
 * This function is pure with respect to `state` — it clones first — and
 * contains no timing of any kind. When results are shown to players is entirely
 * the orchestrator's business; this just computes what is true and when.
 */
export function resolveNight(
  initial: NightState,
  nightOrder: RoleId[],
  config: GameConfig,
  answer: AnswerProvider,
): NightResult {
  const state = cloneNightState(initial);
  const events: NightEvent[] = [];
  const privateInfo: Record<SeatIndex, PrivateInfo[]> = {};
  const decisions: DecisionRequest[] = [];

  for (let seat = 0; seat < state.seatCount; seat++) privateInfo[seat] = [];

  const info = (seat: SeatIndex, i: PrivateInfo) => {
    (privateInfo[seat] ??= []).push(i);
  };
  const event = (e: NightEvent) => { events.push(e); };

  let step = 0;
  for (const role of nightOrder) {
    step++;
    const applier = APPLIERS[role];
    if (!applier) continue;

    // §6.0: whoever was DEALT this role acts now, whatever they hold by now.
    // If the card is in the center, nobody acts — but the step is still spent,
    // which is what keeps the schedule independent of the hidden deal.
    const actors: SeatIndex[] = [];
    for (let seat = 0; seat < state.seatCount; seat++) {
      if (state.originalRole[seat] === role) actors.push(seat);
    }

    for (const actor of actors) {
      const ctx: Ctx = { state, actor, actingAs: role, config, step, info, event };
      const gen = applier(ctx);
      let next = gen.next();
      while (!next.done) {
        const request = next.value;
        decisions.push(request);
        next = gen.next(answer(request));
      }
    }
  }

  return { state, events, privateInfo, decisions };
}

/** Convenience: resolve using the default night order for the active set. */
export function resolveWithDefaultOrder(
  initial: NightState,
  activeRoles: RoleId[],
  config: GameConfig,
  answer: AnswerProvider,
): NightResult {
  return resolveNight(initial, defaultNightOrder(activeRoles), config, answer);
}

/** Roles in the active set that genuinely need a live follow-up decision. */
export function liveFollowupRoles(activeRoles: RoleId[], config: GameConfig): RoleId[] {
  return activeRoles.filter(
    (r) => roleDef(r).revealThenDecide && !config.precommitRoles.includes(r),
  );
}
