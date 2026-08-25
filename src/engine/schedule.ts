import { defaultNightOrder, roleDef } from './roles.js';
import { liveFollowupRoles } from './resolve.js';
import type { GameConfig, RoleId } from './types.js';

/**
 * THE ANTI-LEAK INVARIANT (§5.1).
 *
 * Everything in this file is computed from the ACTIVE ROLE SET alone — which is
 * public, chosen by the host at setup and visible to everyone. Nothing here may
 * ever read the deal, who holds what, where a card ended up, or what anyone
 * chose. Two games with the same active roles must take exactly the same shape
 * and duration, so nobody can infer anything from timing.
 *
 * The subtle case this protects: if the Alpha Wolf is in the active set but its
 * card happens to sit in the centre, nobody performs that action. The step is
 * still spent and still takes the same wall-clock time. Otherwise a short wait
 * would tell the Mystieke Wolf the Alpha Wolf is in the centre.
 */

export interface RoundSchedule {
  mode: 'tworound';
  /** Total rounds every player sits through, filler or not. */
  rounds: number;
  /** Which roles act live in each round (index 0 = round 1). */
  roundRoles: RoleId[][];
}

export interface DependencySchedule {
  mode: 'dependency';
  /** Ordered steps; each is padded to a fixed duration regardless of the deal. */
  steps: { step: number; role: RoleId }[];
  /**
   * role -> the step index its reveal must wait for. A role may CHOOSE
   * immediately; this gates only when it is shown the answer.
   */
  revealGate: Record<string, number>;
}

export type Schedule = RoundSchedule | DependencySchedule;

/**
 * Round count for 'tworound' mode: one round for everybody's up-front
 * submissions, plus one for each active role that still needs a live follow-up.
 *
 * With the default preset (Droomwolf, Alpha Wolf, Mystieke Wolf, Dubbelganger,
 * Heks, Leerlingziener, Dorpsgek, Medium) that is exactly 2: the Dubbelganger
 * is the only reveal-then-decide role not pre-committing, because the Heks and
 * the Medium's Looier swap are answered from stored rules. Dropping the Heks's
 * pre-commit would make it 3 — which is the entire reason she pre-commits.
 */
export function computeRoundSchedule(
  activeRoles: RoleId[],
  config: GameConfig,
): RoundSchedule {
  const order = defaultNightOrder(activeRoles);
  const live = liveFollowupRoles(order, config);
  const rounds = 1 + live.length;

  const roundRoles: RoleId[][] = [order];
  for (const role of live) roundRoles.push([role]);

  return { mode: 'tworound', rounds, roundRoles };
}

/**
 * Dependency mode. Everyone chooses at once; reveals are released as each
 * seat's prerequisites clear.
 *
 * A role's reveal must wait for every earlier active role that can MUTATE card
 * ownership. Note this is deliberately coarse: it asks whether a role *could*
 * have moved a card, never whether it actually did. A centre card looks static,
 * but the Dubbelganger might have copied the Alpha Wolf or the Heks and touched
 * it — so the possibility alone forces the wait, even in a game where nothing
 * moved. Narrowing this by inspecting what actually happened would reintroduce
 * exactly the leak the padding exists to prevent.
 */
const MUTATORS: ReadonlySet<RoleId> = new Set<RoleId>([
  'alphawolf', 'heks', 'dorpsgek', 'onrustoker', 'dronkaard', 'dubbelganger', 'medium',
]);

export function computeDependencySchedule(activeRoles: RoleId[]): DependencySchedule {
  const order = defaultNightOrder(activeRoles);
  const steps = order.map((role, i) => ({ step: i + 1, role }));

  const revealGate: Record<string, number> = {};
  for (const { step, role } of steps) {
    if (!roleDef(role).hasNightAction) continue;
    // Wait for the last mutator at or before this role's own slot.
    let gate = step;
    for (const s of steps) {
      if (s.step <= step && MUTATORS.has(s.role)) gate = Math.max(gate, s.step);
    }
    revealGate[role] = gate;
  }

  return { mode: 'dependency', steps, revealGate };
}

export function computeSchedule(activeRoles: RoleId[], config: GameConfig): Schedule {
  return config.mode === 'tworound'
    ? computeRoundSchedule(activeRoles, config)
    : computeDependencySchedule(activeRoles);
}
