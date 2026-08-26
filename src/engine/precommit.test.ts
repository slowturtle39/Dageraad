import { describe, expect, it } from 'vitest';
import {
  heksBranchFor, heksTargetFor, resolvePrecommit,
  type HeksPolicy,
} from './precommit.js';
import { ROLES } from './roles.js';
import type { DecisionRequest, PrivateInfo, RoleId } from './types.js';

/**
 * The Heks's pre-committed rule.
 *
 * The branch that carries the weight is the Looier one. Everything else here
 * is bookkeeping; that one is a rule about a card that wins by being lynched.
 */

const policy: HeksPolicy = { wolf: 1, looier: 2, village: 3 };

function request(seen?: PrivateInfo): DecisionRequest {
  return {
    seat: 0,
    actingAs: 'heks',
    step: 4,
    key: 'heks-target',
    prompt: { kind: 'seat', exclude: [], optional: false },
    dependsOnReveal: seen !== undefined,
    seen,
  };
}

const sawCenter = (role: RoleId): PrivateInfo =>
  ({ kind: 'saw-center', step: 4, centerIndex: 0, role });

describe('which branch a card falls under', () => {
  it('sorts the Looier into its own branch, never into village', () => {
    // A two-way wolf/not-wolf rule would file him under village and silently
    // arm him while she thought she was helping. He wins by being lynched, so
    // handing him a village card is the one outcome she would never choose.
    expect(heksBranchFor('looier')).toBe('looier');
    expect(heksTargetFor(policy, 'looier')).toBe(2);
    expect(heksTargetFor(policy, 'looier')).not.toBe(policy.village);
  });

  it('sorts real wolves into the wolf branch', () => {
    for (const role of ['weerwolf', 'alphawolf', 'mystiekewolf', 'droomwolf'] as RoleId[]) {
      expect(heksBranchFor(role)).toBe('wolf');
    }
  });

  it('counts the Volgeling as wolf-side, though he is not a wolf', () => {
    // team: 'wolf', isWolf: false — on their side without being one. A Heks
    // saying "if I see a wolf card" means the side, and passing the
    // Volgeling's card around is a wolf-side act.
    expect(ROLES.volgeling!.isWolf).toBe(false);
    expect(ROLES.volgeling!.team).toBe('wolf');
    expect(heksBranchFor('volgeling')).toBe('wolf');
  });

  it('sorts everything else into village', () => {
    for (const role of ['ziener', 'dorpeling', 'bodyguard', 'dorpsgek'] as RoleId[]) {
      expect(heksBranchFor(role)).toBe('village');
    }
  });

  it('classifies every role in the library into exactly one branch', () => {
    // A role added later must not fall through into an undefined target.
    for (const role of Object.keys(ROLES) as RoleId[]) {
      expect(['wolf', 'looier', 'village']).toContain(heksBranchFor(role));
      expect(typeof heksTargetFor(policy, role)).toBe('number');
    }
  });
});

describe('turning a stored rule into an answer', () => {
  it('answers a flat pre-commit without needing to see anything', () => {
    const choice = resolvePrecommit(request(), { kind: 'flat', seat: 5 });
    expect(choice).toEqual({ kind: 'seat', seat: 5 });
  });

  it('answers a policy from the card she actually turned over', () => {
    expect(resolvePrecommit(request(sawCenter('weerwolf')), { kind: 'heks-policy', policy }))
      .toEqual({ kind: 'seat', seat: 1 });
    expect(resolvePrecommit(request(sawCenter('looier')), { kind: 'heks-policy', policy }))
      .toEqual({ kind: 'seat', seat: 2 });
    expect(resolvePrecommit(request(sawCenter('ziener')), { kind: 'heks-policy', policy }))
      .toEqual({ kind: 'seat', seat: 3 });
  });

  it('declines rather than guesses when the rule cannot answer', () => {
    // A pre-commit that fires on the wrong decision is worse than one that
    // does not fire: the referee already treats no answer as a decline, which
    // is a decision she can live with. A wrong swap is not.
    expect(resolvePrecommit(request(), { kind: 'heks-policy', policy })).toBeUndefined();
    expect(resolvePrecommit(
      request({ kind: 'judged', step: 4 }),
      { kind: 'heks-policy', policy },
    )).toBeUndefined();
  });

  it('also reads a seen card, not only a centre card', () => {
    // The engine hands out whatever the role saw. Binding this to 'saw-center'
    // alone would break the moment a policy is offered to another role.
    const seen: PrivateInfo = { kind: 'saw-card', step: 4, slot: 2, role: 'looier' };
    expect(resolvePrecommit(request(seen), { kind: 'heks-policy', policy }))
      .toEqual({ kind: 'seat', seat: 2 });
  });

  it('is a pure function of the rule and the card', () => {
    const once = resolvePrecommit(request(sawCenter('weerwolf')), { kind: 'heks-policy', policy });
    const twice = resolvePrecommit(request(sawCenter('weerwolf')), { kind: 'heks-policy', policy });
    expect(twice).toEqual(once);
  });
});
