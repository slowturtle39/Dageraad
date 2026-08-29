import { describe, expect, it } from 'vitest';
import {
  TWO_ROUND_CONFIG, centerSlot, createNightState, defaultNightOrder,
  finalRoleOf, resolveDay, resolveNight, roleAt, voteOutcomes,
} from './index.js';
import type { AnswerProvider } from './resolve.js';
import type { Choice, RoleId } from './types.js';

/** Answers keyed by "<seat>:<decision key>"; an omitted answer declines. */
function answers(map: Record<string, Choice>): AnswerProvider {
  return (request) => map[`${request.seat}:${request.key}`] ?? { kind: 'none' };
}

const seat = (value: number): Choice => ({ kind: 'seat', seat: value });
const center = (value: number): Choice => ({ kind: 'center', centerIndices: [value] });

function state(seatRoles: RoleId[], centerRoles: RoleId[], alphaWolfCardRole?: RoleId) {
  return createNightState({
    seatCount: seatRoles.length,
    seatRoles,
    centerRoles,
    ...(alphaWolfCardRole ? { alphaWolfCardRole } : {}),
  });
}

function night(
  initial: ReturnType<typeof state>,
  activeRoles: RoleId[],
  answer: AnswerProvider,
) {
  return resolveNight(initial, defaultNightOrder(activeRoles), TWO_ROUND_CONFIG, answer);
}

describe('written house-rule conformance', () => {
  it('§13 Dorpsgek: “de rest draait eromheen” rotates the stable ring with wrap-around', () => {
    const result = night(
      state(
        ['dorpsgek', 'dorpeling', 'ziener', 'jager', 'looier'],
        ['weerwolf', 'heks', 'medium'],
      ),
      ['dorpsgek'],
      answers({ '0:dorpsgek': { kind: 'dorpsgek', direction: 'right' } }),
    );

    // The actor is exempt. On the remaining ring, the card at seat 4 wraps to seat 1.
    expect(roleAt(result.state, 0)).toBe('dorpsgek');
    expect([1, 2, 3, 4].map((s) => roleAt(result.state, s)))
      .toEqual(['looier', 'dorpeling', 'ziener', 'jager']);
  });

  it('house rule Dubbelganger: copies at its own slot and “geen ketting” stops on another Doppelganger', () => {
    const copiedMedium = night(
      state(['dubbelganger', 'medium', 'ziener'], ['jager', 'jager', 'jager']),
      ['dubbelganger'],
      answers({ '0:doppel-view': seat(1), '0:medium-target': seat(2) }),
    );
    expect(copiedMedium.decisions.map((d) => [d.seat, d.actingAs, d.key]))
      .toEqual([[0, 'dubbelganger', 'doppel-view'], [0, 'medium', 'medium-target']]);
    expect(copiedMedium.privateInfo[0]).toContainEqual(
      expect.objectContaining({ kind: 'saw-card', slot: 2, role: 'ziener' }),
    );

    const noChain = night(
      state(['dubbelganger', 'dubbelganger', 'ziener'], ['jager', 'jager', 'jager']),
      ['dubbelganger'],
      answers({ '0:doppel-view': seat(1) }),
    );
    // Each real Doppelganger still gets its own turn. The first copy must not
    // create an extra chained action between those two normal turns.
    expect(noChain.decisions.map((d) => [d.seat, d.actingAs, d.key]))
      .toEqual([
        [0, 'dubbelganger', 'doppel-view'],
        [1, 'dubbelganger', 'doppel-view'],
      ]);
  });

  it('house rule Alpha Wolf / Drunk: both swaps confirm execution without revealing the displaced card', () => {
    const alpha = night(
      state(['alphawolf', 'dorpeling'], ['ziener', 'jager', 'heks'], 'weerwolf'),
      ['alphawolf'],
      answers({ '0:alpha-target': seat(1) }),
    );
    const drunk = night(
      state(['dronkaard', 'dorpeling'], ['ziener', 'jager', 'heks']),
      ['dronkaard'],
      answers({ '0:drunk': center(0) }),
    );

    for (const info of [alpha.privateInfo[0], drunk.privateInfo[0]]) {
      expect(info).toContainEqual(expect.objectContaining({ kind: 'action-confirmed' }));
      expect(info?.some((i) => i.kind === 'saw-card' || i.kind === 'saw-center')).toBe(false);
    }
  });

  it('house rule Heks: she can see and exchange only one of the three centre cards, including the Looier branch', () => {
    const initial = state(
      ['alphawolf', 'heks', 'dorpeling'],
      ['looier', 'ziener', 'jager'],
      'weerwolf',
    );
    expect(initial.centerCount).toBe(3);
    expect(() => centerSlot(initial, 3)).toThrow('center index out of range');

    const result = night(initial, ['heks'], answers({
      '1:heks-precommit-target': seat(2),
      '1:heks-center': center(0),
    }));
    expect(result.privateInfo[1]).toContainEqual(
      expect.objectContaining({ kind: 'saw-center', centerIndex: 0, role: 'looier' }),
    );
    expect(roleAt(result.state, 2)).toBe('looier');
  });

  it('CURRENT DIVERGENCE: PDF Bodyguard “top vote target voids the vote”; engine instead shields the chosen target', () => {
    const result = resolveDay(
      state(['bodyguard', 'weerwolf', 'dorpeling', 'ziener'], ['jager', 'jager', 'jager']),
      [
        { voter: 0, target: 1, abstain: false },
        { voter: 2, target: 1, abstain: false },
        { voter: 3, target: 1, abstain: false },
      ],
    );

    expect(result.protectedSeats).toEqual([1]);
    expect(result.eliminated).toEqual([]);
    expect(voteOutcomes(
      state(['bodyguard', 'weerwolf', 'dorpeling', 'ziener'], ['jager', 'jager', 'jager']),
      [
        { voter: 0, target: 1, abstain: false },
        { voter: 2, target: 1, abstain: false },
        { voter: 3, target: 1, abstain: false },
      ],
      result,
    )[0]).toBe('caused-village-loss');
  });

  it('house rule Onderzoeker: on a Wolf or Looier, stops and both players have that final role at dawn', () => {
    const result = night(
      state(['onderzoeker', 'weerwolf', 'ziener'], ['jager', 'jager', 'jager']),
      ['onderzoeker'],
      answers({ '0:pi-first': seat(1), '0:pi-second': seat(2) }),
    );

    expect(result.decisions.map((d) => d.key)).toEqual(['pi-first']);
    expect(finalRoleOf(result.state, 0)).toBe('weerwolf');
    expect(finalRoleOf(result.state, 1)).toBe('weerwolf');
  });

  it('house rule voting: tied top targets all hang, while a strict majority abstention ends the vote', () => {
    const tied = resolveDay(
      state(['weerwolf', 'dorpeling', 'ziener'], ['jager', 'jager', 'jager']),
      [
        { voter: 0, target: 1, abstain: false },
        { voter: 1, target: 0, abstain: false },
      ],
    );
    expect(tied.outcome).toBe('tie');
    expect(tied.eliminated.sort()).toEqual([0, 1]);

    const noVote = resolveDay(
      state(['weerwolf', 'dorpeling', 'ziener'], ['jager', 'jager', 'jager']),
      [
        { voter: 0, target: 1, abstain: true },
        { voter: 1, target: 0, abstain: true },
        { voter: 2, target: 0, abstain: false },
      ],
    );
    expect(noVote.outcome).toBe('no-vote');
    expect(noVote.eliminated).toEqual([]);
  });

  it('CURRENT DIVERGENCE: PDF Medium “mag ruilen”; engine forces the Looier swap', () => {
    const result = night(
      state(['medium', 'looier', 'dorpeling'], ['jager', 'ziener', 'heks']),
      ['medium'],
      answers({ '0:medium-target': seat(1) }),
    );

    expect(roleAt(result.state, 0)).toBe('looier');
    expect(roleAt(result.state, 1)).toBe('medium');
    expect(result.decisions.map((d) => d.key)).toEqual(['medium-target']);
  });
});
