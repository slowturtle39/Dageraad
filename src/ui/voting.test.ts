import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNightState } from '../engine/state.js';
import { resolveDay, voteOutcomes } from '../engine/dayphase.js';
import type { RoleId } from '../engine/types.js';

const src = readFileSync('src/ui/voting.ts', 'utf8');

function table(seatRoles: RoleId[]) {
  return createNightState({
    seatCount: seatRoles.length, seatRoles,
    centerRoles: ['jager', 'jager', 'jager'],
  });
}

describe('the voting sheet', () => {
  it('shows the abstain tally, because the mechanic is a show of hands', () => {
    // Knowing how close it is IS the rule (§7). It reveals intention, never
    // role, so it is safe to make public and pointless to hide.
    expect(src).toMatch(/abstainCount/);
    expect(src).toMatch(/Vanaf \$\{needed\}/);
  });

  it('offers the abstain toggle the whole time, not only at the end', () => {
    // People work out there is nothing to gain long before the last minute.
    // Hiding the button until then would mean they had decided but couldn't
    // say so.
    expect(src).toMatch(/Je kunt dit nu al aanzetten/);
    expect(src).toMatch(/inFinalMinute/);
  });

  it('shows how many still have to vote, because voting is mandatory', () => {
    // A count is safe: never who voted for whom, and at a real table you can
    // see whose hand is still down anyway.
    expect(src).toMatch(/votesCast/);
    expect(src).toMatch(/iedereen moet stemmen/);
  });

  it('needs strictly more than half to end the vote', () => {
    expect(src).toMatch(/Math\.floor\(view\.seatCount \/ 2\) \+ 1/);
  });
});

describe('the results sheet', () => {
  const state = table(['looier', 'weerwolf', 'dorpeling']);
  const votes = [
    { voter: 0, target: 1, abstain: false },
    { voter: 1, target: 0, abstain: false },
    { voter: 2, target: 0, abstain: false },
  ];

  it("explains a discarded Looier vote instead of silently dropping it", () => {
    // "Why didn't my vote count?" is otherwise the first argument of the night.
    const result = resolveDay(state, votes);
    expect(result.discarded.some((d) => d.reason === 'looier')).toBe(true);
    expect(src).toMatch(/de Looier stemt nooit mee/);
  });

  it('reports a timed-out vote as not counted rather than as a wrong vote', () => {
    const result = resolveDay(state, votes);
    const outcomes = voteOutcomes(state, votes, result);
    expect(outcomes[0]).toBe('not-scored');   // the Looier's own vote
    expect(src).toMatch(/telt niet als een foute stem/);
  });

  it('is the only place roles are shown for other players', () => {
    // Everywhere else in the UI, another player's role is unavailable by
    // construction. Here the game is over.
    expect(src).toMatch(/the game is over/);
    expect(src).toMatch(/finalRoles/);
  });
});
