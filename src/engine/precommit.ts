import { ROLES } from './roles.js';
import type { Choice, DecisionRequest, RoleId, SeatIndex } from './types.js';

/**
 * Pre-committed answers: deciding in advance what you will do with something
 * you have not seen yet.
 *
 * WHY THIS EXISTS. In 'tworound' mode everybody submits up front and the night
 * resolves in two passes. A decision that depends on a reveal cannot work that
 * way — the Heks must look at a centre card BEFORE choosing who to swap it
 * with — so either she gets a live follow-up window, which makes the night
 * three rounds, or she says beforehand what she will do. `precommitRoles` is
 * the list of roles that take the second deal, and the Heks is the only one
 * left on it since the Medium's Looier swap became forced.
 *
 * WHAT WAS MISSING. A flat pre-commit is "swap with seat 4, whatever I see",
 * which means she looks at a card and the information does nothing. That is a
 * much weaker Heks than the one in mode 1, for a reason that is an artefact of
 * our scheduling rather than anything about the role.
 *
 * So a conditional pre-commit is a rule per team, and the LOOIER GETS ITS OWN
 * BRANCH. A two-way wolf/not-wolf rule would file the Looier under "village"
 * and silently arm him while she thought she was helping — the Looier wins by
 * being lynched, so handing him a village card is the one outcome she would
 * never choose on purpose.
 *
 * This lives in the engine, and is pure, because it is game logic: which team
 * a card belongs to is not something a UI should be deciding. The engine still
 * does not execute it — it hands out a DecisionRequest carrying what was seen,
 * and the referee resolves the stored rule against it before answering.
 */

export type HeksBranch = 'wolf' | 'looier' | 'village';

/** Her rule, committed before the night: one target per team. */
export interface HeksPolicy {
  wolf: SeatIndex;
  looier: SeatIndex;
  village: SeatIndex;
}

/**
 * Which branch a seen card falls under.
 *
 * Three teams, not two. `isWolf` is the flag the rest of the engine uses for
 * wolf-ness, and the Looier is `team: 'solo'` precisely because he is neither
 * side — which is exactly why he cannot be folded into "village" here.
 *
 * The Volgeling is a deliberate edge: `team: 'wolf'` but `isWolf: false`,
 * because he is on their side without being one. He counts as a wolf for this
 * rule, since a Heks who says "if I see a wolf card, do X" means the wolf
 * side, and handing the Volgeling's card around is a wolf-side act.
 */
export function heksBranchFor(role: RoleId): HeksBranch {
  const def = ROLES[role];
  if (!def) return 'village';
  if (def.team === 'solo') return 'looier';
  if (def.isWolf || def.team === 'wolf') return 'wolf';
  return 'village';
}

/** The seat her stored rule names, given what she actually turned over. */
export function heksTargetFor(policy: HeksPolicy, seenRole: RoleId): SeatIndex {
  return policy[heksBranchFor(seenRole)];
}

/**
 * A stored pre-commit, as it travels in a player's submission.
 *
 * `flat` is the old behaviour and stays the default: one seat, whatever turns
 * up. Both are kept because the variant is a host setting, and a room halfway
 * through an evening must not change shape under the players.
 */
export type Precommit =
  | { kind: 'flat'; seat: SeatIndex }
  | { kind: 'heks-policy'; policy: HeksPolicy };

/**
 * Turn a stored rule into the answer this request needs.
 *
 * Returns undefined when the rule cannot answer the request — a policy against
 * a decision that reveals nothing, or a request whose reveal is not a card.
 * Undefined means "no answer", which the referee already treats as a decline,
 * rather than a guess: a pre-commit that fires on the wrong decision is worse
 * than one that does not fire at all.
 */
export function resolvePrecommit(
  request: DecisionRequest,
  stored: Precommit,
): Choice | undefined {
  if (stored.kind === 'flat') return { kind: 'seat', seat: stored.seat };

  // A per-team rule needs to know which team, so it needs the reveal.
  if (!request.dependsOnReveal || !request.seen) return undefined;
  const seen = request.seen;
  const role =
    seen.kind === 'saw-center' ? seen.role
      : seen.kind === 'saw-card' ? seen.role
        : null;
  if (role === null) return undefined;

  return { kind: 'seat', seat: heksTargetFor(stored.policy, role) };
}
