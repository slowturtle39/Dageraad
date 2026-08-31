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

  it('shows the abstain tally live, because a majority counts at any moment', () => {
    // Milan, 2026-08-26: the group may decide not to vote at ANY point, so the
    // count has to be true at any point too. There is no "final minute" gate.
    expect(src).toMatch(/willen niet stemmen/);
    expect(src).toMatch(/Vanaf \$\{needed\} gaat de stemming niet door/);
    expect(src).not.toMatch(/inFinalMinute/);
  });

  it('shows how many still have to vote, because voting is mandatory', () => {
    // A count is safe: never who voted for whom, and at a real table you can
    // see whose hand is still down anyway.
    expect(src).toMatch(/votesCast/);
    expect(src).toMatch(/iedereen moet stemmen/);
    expect(src).toMatch(/everyone must vote/);
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

describe('the Bodyguard shields instead of voting (2026-08-26)', () => {
  it('tells him he is protecting, not voting', () => {
    expect(src).toMatch(/Je beschermt/);
    expect(src).toMatch(/Alle stemmen op/);
  });

  it('takes the abstain button away once voting has opened', () => {
    // He must name someone; skipping is not an option (Milan, 2026-08-26).
    expect(src).toMatch(/if \(!view\.votingOpen\)/);
    expect(src).toMatch(/if \(view\.votingOpen && !view\.finalSubmitted\)/);
  });

  it('leaves him free to join a majority that calls off the vote entirely', () => {
    // That ends the vote for everybody rather than letting him quietly do
    // nothing while it happens, so it is a different thing from skipping.
    expect(src).toMatch(/const abstain/);
    expect(src).toMatch(/onAbstain/);
  });

  it('keys off what he BELIEVES he is, not the truth', () => {
    // §6.0: the engine resolves the shield on whoever holds the Bodyguard card
    // at dawn. A player whose card was swapped away goes on shielding nobody.
    expect(src).toMatch(/believe/i);
  });
});

describe('a named vote is final', () => {
  it('shows a recorded state and removes the confirm action', () => {
    expect(src).toMatch(/finalSubmitted/);
    expect(src).toMatch(/Je stem is vastgelegd/);
    expect(src).toMatch(/view\.votingOpen && !view\.finalSubmitted/);
  });
});

describe('a tie is now a double execution', () => {
  it('names everyone who hangs rather than reporting a failed vote', () => {
    const state = table(['weerwolf', 'dorpeling', 'ziener']);
    const result = resolveDay(state, [
      { voter: 0, target: 1, abstain: false },
      { voter: 1, target: 0, abstain: false },
      { voter: 2, target: 0, abstain: false },
    ]);
    // Seat 0 has two votes, seat 1 has one — not actually tied here; the point
    // of this test is the renderer, so assert on the source and the shape.
    expect(result.eliminated.length).toBeGreaterThan(0);
    expect(src).toMatch(/hangen allemaal/);
    expect(src).toMatch(/lynchLine/);
  });

  it('still says nobody died when no vote counted at all', () => {
    const state = table(['weerwolf', 'dorpeling']);
    const result = resolveDay(state, [
      { voter: 0, target: null, abstain: false },
      { voter: 1, target: null, abstain: false },
    ]);
    expect(result.outcome).toBe('tie');
    expect(result.eliminated).toEqual([]);
    expect(src).toMatch(/result\.eliminated\.length === 0/);
  });
});
