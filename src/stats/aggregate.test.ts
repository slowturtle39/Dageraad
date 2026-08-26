import { describe, expect, it } from 'vitest';
import type { RoleId } from '../engine/types.js';
import type { RoundRecord, RoundResult } from '../app/session.js';
import {
  aggregateCombos, aggregatePlayer, aggregateRoles, aggregateTableSizes,
  aggregateTeams, combinations, filterRounds, observedRoles, observedTableSizes,
  voteBreakdown,
} from './aggregate.js';

function row(
  uid: string,
  originalRole: RoleId,
  finalRole: RoleId,
  won: boolean,
  voteOutcome: RoundResult['voteOutcome'] = 'incorrect',
  suspicionAccuracy: number | null = null,
): RoundResult {
  return { uid, seat: 0, originalRole, finalRole, won, voteOutcome, suspicionAccuracy };
}

function round(
  n: number,
  activeRoles: RoleId[],
  results: RoundResult[],
  seatCount = results.length,
): RoundRecord {
  return { round: n, activeRoles, seatCount, outcome: 'eliminated', results };
}

describe('per-player stats', () => {
  const rounds = [
    round(1, ['weerwolf', 'ziener'], [
      row('a', 'ziener', 'ziener', true, 'correct'),
      row('b', 'weerwolf', 'weerwolf', false),
      row('c', 'dorpeling', 'dorpeling', true, 'correct', 0.5),
    ]),
    round(2, ['weerwolf', 'heks'], [
      row('a', 'weerwolf', 'weerwolf', true, 'correct'),
      row('b', 'heks', 'weerwolf', false, 'incorrect'),
    ], 5),
  ];

  it('counts only the rounds a player was actually in', () => {
    expect(aggregatePlayer('c', rounds).overall).toEqual(
      { played: 1, won: 1, winRate: 1 },
    );
  });

  it('tracks the dealt role and the final card separately (§6.0)', () => {
    // b was dealt the Heks and finished as a Weerwolf. Both facts matter and
    // collapsing them would lose the more interesting one.
    const b = aggregatePlayer('b', rounds);
    expect(b.byOriginalRole.get('heks')).toEqual({ played: 1, won: 0, winRate: 0 });
    expect(b.byFinalRole.get('weerwolf')).toEqual({ played: 2, won: 0, winRate: 0 });
    expect(b.timesSwapped).toBe(1);
  });

  it('slices by table size', () => {
    const a = aggregatePlayer('a', rounds);
    expect(a.byTableSize.get(3)).toEqual({ played: 1, won: 1, winRate: 1 });
    expect(a.byTableSize.get(5)).toEqual({ played: 1, won: 1, winRate: 1 });
  });

  it('leaves an unplayed role with a null win rate, not zero', () => {
    // 0% and "never played" are different claims and people act on both.
    const a = aggregatePlayer('a', rounds);
    expect(a.byOriginalRole.get('dorpeling')).toBeUndefined();
    expect(aggregatePlayer('zz', rounds).overall.winRate).toBeNull();
  });

  it('scores vote accuracy over scoreable votes only', () => {
    const withUnscored = [
      round(1, ['weerwolf'], [
        row('a', 'ziener', 'ziener', true, 'correct'),
      ]),
      round(2, ['weerwolf'], [
        row('a', 'ziener', 'ziener', false, 'not-scored'),
      ]),
      round(3, ['weerwolf'], [
        row('a', 'ziener', 'ziener', false, 'inconsequential'),
      ]),
    ];
    const a = aggregatePlayer('a', withUnscored);
    // A timed-out window is not a wrong answer (§10), and neither is a shield
    // nobody was voting into.
    expect(a.votesScored).toBe(1);
    expect(a.voteAccuracy).toBe(1);
  });

  it('counts a shield that cost the village its own category', () => {
    const bad = [round(1, ['weerwolf'], [
      row('a', 'bodyguard', 'bodyguard', false, 'caused-village-loss'),
    ])];
    expect(aggregatePlayer('a', bad).votesCausingVillageLoss).toBe(1);
  });

  it('averages suspicion accuracy over the rounds it was used', () => {
    const a = aggregatePlayer('c', rounds);
    expect(a.suspicionAccuracy).toBe(0.5);
    // Never used it -> null, not zero.
    expect(aggregatePlayer('b', rounds).suspicionAccuracy).toBeNull();
  });

  it('breaks votes down by outcome', () => {
    expect(voteBreakdown('a', rounds)).toMatchObject({ correct: 2, incorrect: 0 });
  });
});

describe('per-role stats', () => {
  const rounds = [
    round(1, ['weerwolf', 'ziener', 'heks'], [
      row('a', 'ziener', 'ziener', true),
      row('b', 'weerwolf', 'weerwolf', false),
    ]),
    round(2, ['weerwolf', 'ziener', 'heks'], [
      row('a', 'ziener', 'weerwolf', false),
      row('b', 'weerwolf', 'ziener', true),
    ]),
  ];
  const roles = aggregateRoles(rounds);

  it('separates how a role does as dealt from how it does as a final card', () => {
    // Dealt the Ziener twice, won once. But BOTH players who finished holding
    // a Ziener card won — the card is doing better than the seat, which is the
    // kind of thing collapsing these two would hide.
    expect(roles.get('ziener')!.asDealt).toEqual({ played: 2, won: 1, winRate: 0.5 });
    expect(roles.get('ziener')!.asFinal).toEqual({ played: 2, won: 2, winRate: 1 });
  });

  it('tracks how often a role gets swapped away from whoever was dealt it', () => {
    // Both Zieners in round 2 changed hands.
    expect(roles.get('ziener')!.swappedAwayRate).toBe(0.5);
  });

  it('counts a role as in the game even when it sat in the centre', () => {
    // That is exactly what makes the deal uncertain — the Heks was active in
    // both rounds and dealt to nobody.
    expect(roles.get('heks')!.timesInGame).toBe(2);
    expect(roles.get('heks')!.asDealt.played).toBe(0);
  });
});

describe('per-team stats', () => {
  it('counts a round once, not once per player on the team', () => {
    // Five villagers and one wolf must not make the village look five times
    // more successful than it is.
    const rounds = [round(1, ['weerwolf'], [
      row('a', 'ziener', 'ziener', true),
      row('b', 'dorpeling', 'dorpeling', true),
      row('c', 'dorpeling', 'dorpeling', true),
      row('d', 'weerwolf', 'weerwolf', false),
    ])];
    const teams = aggregateTeams(rounds);
    expect(teams.get('village')!.overall).toEqual({ played: 1, won: 1, winRate: 1 });
    expect(teams.get('wolf')!.overall).toEqual({ played: 1, won: 0, winRate: 0 });
  });

  it('does not record a loss for a team that was not in the game', () => {
    // A wolfless game is not a game the wolves lost.
    const rounds = [round(1, ['weerwolf'], [
      row('a', 'ziener', 'ziener', false),
      row('b', 'dorpeling', 'dorpeling', false),
      row('c', 'dorpeling', 'dorpeling', false),
    ])];
    expect(aggregateTeams(rounds).get('wolf')).toBeUndefined();
  });

  it('slices by table size', () => {
    const rounds = [
      round(1, ['weerwolf'], [
        row('a', 'ziener', 'ziener', true), row('b', 'weerwolf', 'weerwolf', false),
      ], 6),
      round(2, ['weerwolf'], [
        row('a', 'ziener', 'ziener', false), row('b', 'weerwolf', 'weerwolf', true),
      ], 6),
    ];
    expect(aggregateTeams(rounds).get('village')!.byTableSize.get(6))
      .toEqual({ played: 2, won: 1, winRate: 0.5 });
  });
});

describe('table-size stats', () => {
  it('reports outcomes per table size, smallest first', () => {
    const rounds = [
      round(1, ['weerwolf'], [
        row('a', 'ziener', 'ziener', true), row('b', 'weerwolf', 'weerwolf', false),
      ], 8),
      round(2, ['weerwolf'], [
        row('a', 'ziener', 'ziener', false), row('b', 'weerwolf', 'weerwolf', true),
      ], 5),
    ];
    const sizes = aggregateTableSizes(rounds);
    expect(sizes.map((s) => s.seatCount)).toEqual([5, 8]);
    expect(sizes[0]).toMatchObject({ wolfWins: 1, villageWins: 0 });
    expect(sizes[1]).toMatchObject({ villageWins: 1, wolfWins: 0 });
  });
});

describe('role-combination stats', () => {
  it('enumerates every pair without repeats', () => {
    expect(combinations(['a', 'b', 'c'], 2)).toEqual([
      ['a', 'b'], ['a', 'c'], ['b', 'c'],
    ]);
    expect(combinations(['a', 'b'], 3)).toEqual([]);
  });

  it('counts outcomes for each combination that was in play', () => {
    const rounds = [
      round(1, ['heks', 'dorpsgek', 'weerwolf'], [
        row('a', 'ziener', 'ziener', true), row('b', 'weerwolf', 'weerwolf', false),
      ]),
      round(2, ['heks', 'dorpsgek', 'weerwolf'], [
        row('a', 'ziener', 'ziener', false), row('b', 'weerwolf', 'weerwolf', true),
      ]),
    ];
    const combos = aggregateCombos(rounds);
    const hd = combos.find((c) => c.key === 'dorpsgek+heks')!;
    expect(hd.rounds).toBe(2);
    expect(hd.villageWins).toBe(1);
    expect(hd.wolfWins).toBe(1);
    expect(hd.balance).toBe(1);            // a perfectly even split
  });

  it('scores a one-sided combination as unbalanced', () => {
    const rounds = [1, 2, 3].map((n) => round(n, ['heks', 'weerwolf'], [
      row('a', 'ziener', 'ziener', false), row('b', 'weerwolf', 'weerwolf', true),
    ]));
    const combo = aggregateCombos(rounds)[0]!;
    expect(combo.wolfWins).toBe(3);
    expect(combo.balance).toBe(0);
  });

  it('can hide the long tail, because a single round is an anecdote', () => {
    const rounds = [
      round(1, ['heks', 'weerwolf'], [row('a', 'ziener', 'ziener', true)]),
      round(2, ['medium', 'weerwolf'], [row('a', 'ziener', 'ziener', true)]),
      round(3, ['heks', 'weerwolf'], [row('a', 'ziener', 'ziener', true)]),
    ];
    const all = aggregateCombos(rounds);
    const common = aggregateCombos(rounds, { minRounds: 2 });
    expect(all.length).toBeGreaterThan(common.length);
    expect(common.every((c) => c.rounds >= 2)).toBe(true);
  });

  it('supports triples as well as pairs', () => {
    const rounds = [round(1, ['heks', 'dorpsgek', 'medium'], [
      row('a', 'ziener', 'ziener', true),
    ])];
    const triples = aggregateCombos(rounds, { size: 3 });
    expect(triples).toHaveLength(1);
    expect(triples[0]!.key).toBe('dorpsgek+heks+medium');
  });
});

describe('filtering, so a new breakdown is composition not a new function', () => {
  const rounds = [
    round(1, ['heks', 'weerwolf'], [row('a', 'ziener', 'ziener', true)], 6),
    round(2, ['medium', 'weerwolf'], [row('a', 'ziener', 'ziener', false)], 6),
    round(3, ['heks', 'weerwolf'], [row('a', 'ziener', 'ziener', false)], 8),
  ];

  it('narrows by table size', () => {
    expect(filterRounds(rounds, { seatCount: 6 })).toHaveLength(2);
  });

  it('narrows by which roles were in the game', () => {
    expect(filterRounds(rounds, { withRoles: ['heks'] })).toHaveLength(2);
    expect(filterRounds(rounds, { withRoles: ['heks', 'medium'] })).toHaveLength(0);
  });

  it('composes: "with the Heks, at six players" is filter-then-aggregate', () => {
    const slice = filterRounds(rounds, { seatCount: 6, withRoles: ['heks'] });
    expect(aggregatePlayer('a', slice).overall).toEqual(
      { played: 1, won: 1, winRate: 1 },
    );
  });

  it('offers the values a filter control should show', () => {
    expect(observedTableSizes(rounds)).toEqual([6, 8]);
    expect(observedRoles(rounds)).toEqual(['heks', 'medium', 'weerwolf']);
  });
});
