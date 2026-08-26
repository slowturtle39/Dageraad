import { describe, expect, it } from 'vitest';
import type { RoleId } from '../engine/types.js';
import {
  DEFAULT_SCORING, canStartRound, seatingForNextRound, seedForJoiner, standings,
  type RoundRecord, type RoundResult, type SessionMember,
} from './session.js';

function member(uid: string, joined = 1, left: number | null = null): SessionMember {
  return { uid, joinedAtRound: joined, leftAtRound: left };
}

function result(
  uid: string,
  won: boolean,
  finalRole: RoleId = 'dorpeling',
): RoundResult {
  return {
    uid, seat: 0, originalRole: 'dorpeling', finalRole, won,
    voteOutcome: won ? 'correct' : 'incorrect', suspicionAccuracy: null,
  };
}

function round(n: number, results: RoundResult[], seatCount = results.length): RoundRecord {
  return {
    round: n,
    activeRoles: ['weerwolf', 'ziener', 'dorpeling'],
    seatCount,
    outcome: 'eliminated',
    results,
  };
}

describe('the evening scoreboard', () => {
  it('is rebuilt from the rounds rather than accumulated', () => {
    const members = [member('a'), member('b')];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', false), result('b', true)]),
    ];
    const table = standings(members, rounds, DEFAULT_SCORING);

    // 3 + 1 each. Recomputing twice must give the same answer — that is the
    // whole reason it is derived and not a counter anybody increments.
    expect(table.map((s) => s.points)).toEqual([4, 4]);
    expect(standings(members, rounds)).toEqual(table);
  });

  it('pays the Looier more for a solo win than a team win', () => {
    const members = [member('a'), member('b')];
    const rounds = [round(1, [result('a', true, 'looier'), result('b', true, 'ziener')])];
    const table = standings(members, rounds);

    expect(table.find((s) => s.uid === 'a')!.points).toBe(DEFAULT_SCORING.soloWin);
    expect(table.find((s) => s.uid === 'b')!.points).toBe(DEFAULT_SCORING.win);
  });

  it('still pays something for turning up and losing', () => {
    const table = standings([member('a')], [round(1, [result('a', false)])]);
    expect(table[0]!.points).toBe(DEFAULT_SCORING.loss);
  });

  it('keeps a departed player’s finished rounds in the record', () => {
    // They left, but the rounds they played still happened. Dropping the rows
    // would silently rewrite the evening.
    const members = [member('a'), member('b', 1, 3)];
    const rounds = [round(1, [result('a', false), result('b', true)])];
    const table = standings(members, rounds);

    const gone = table.find((s) => s.uid === 'b')!;
    expect(gone.wins).toBe(1);
    expect(gone.active).toBe(false);
  });
});

describe('seeding a player who joins late', () => {
  it('starts them level with whoever is currently last', () => {
    const members = [member('a'), member('b')];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),   // a:3  b:1
      round(2, [result('a', true), result('b', false)]),   // a:6  b:2
    ];
    const before = standings(members, rounds);
    expect(seedForJoiner(before)).toBe(2);
  });

  it('gives zero when nobody has played yet', () => {
    expect(seedForJoiner([])).toBe(0);
    expect(seedForJoiner(standings([member('a')], []))).toBe(0);
  });

  it('ignores players who have already left when finding the floor', () => {
    // Somebody who went home on 1 point should not drag a newcomer's seed
    // down to a scoreboard position that no longer exists.
    const members = [member('a'), member('b', 1, 2)];
    const rounds = [round(1, [result('a', true), result('b', false)])];
    const table = standings(members, rounds);
    expect(seedForJoiner(table)).toBe(3);   // only 'a' is still here
  });

  it('leaves the newcomer last but not hopeless, and honest about it', () => {
    const started = [member('a'), member('b')];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', true), result('b', false)]),
    ];
    const withLatecomer = [...started, member('c', 3)];
    const table = standings(withLatecomer, rounds);

    // The preview the lobby shows and the number the scoreboard derives are
    // the same rule; if they ever disagree the lobby is lying to the joiner.
    expect(seedForJoiner(standings(started, rounds))).toBe(2);

    const c = table.find((s) => s.uid === 'c')!;
    expect(c.points).toBe(2);          // level with the player in last place
    expect(c.roundsPlayed).toBe(0);    // ...but credited with nothing they didn't play
    expect(c.wins).toBe(0);
    expect(c.seeded).toBe(2);          // and the seed stays visible, not laundered
  });

  it('only ever counts rounds the latecomer actually played', () => {
    const members = [member('a'), member('b'), member('c', 2)];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', false), result('b', false), result('c', true)]),
    ];
    const c = standings(members, rounds).find((s) => s.uid === 'c')!;
    expect(c.roundsPlayed).toBe(1);
    expect(c.points).toBe(1 + DEFAULT_SCORING.win);
  });
});

describe('who sits down next round', () => {
  it('keeps everyone in the seat they already had', () => {
    const members = [member('a'), member('b'), member('c')];
    expect(seatingForNextRound(members, ['a', 'b', 'c'], 2)).toEqual(['a', 'b', 'c']);
  });

  it('closes the ring when somebody leaves — no holes in the rotation', () => {
    // A gap in the seating is a gap in the Dorpsgek's shift.
    // b's last round was 2, so round 3 is the first they are not in.
    const members = [member('a'), member('b', 1, 2), member('c')];
    expect(seatingForNextRound(members, ['a', 'b', 'c'], 3)).toEqual(['a', 'c']);
  });

  it('seats a newcomer on the end, where a real person would sit', () => {
    const members = [member('a'), member('b'), member('c', 3)];
    expect(seatingForNextRound(members, ['a', 'b'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('does not seat somebody who joined for a later round', () => {
    const members = [member('a'), member('b'), member('c', 5)];
    expect(seatingForNextRound(members, ['a', 'b'], 3)).toEqual(['a', 'b']);
  });

  it('still seats a leaver for the round they leave AT', () => {
    // leftAtRound is the last round they play, not the first they miss.
    const members = [member('a'), member('b', 1, 3)];
    expect(seatingForNextRound(members, ['a', 'b'], 3)).toEqual(['a', 'b']);
    expect(seatingForNextRound(members, ['a', 'b'], 4)).toEqual(['a']);
  });
});

describe('whether a round can start at all', () => {
  it('needs three players, because the deal needs seatCount + 3 cards', () => {
    expect(canStartRound(2)).toMatch(/Minimaal 3/);
    expect(canStartRound(3)).toBeNull();
  });

  it('caps the table', () => {
    expect(canStartRound(12)).toBeNull();
    expect(canStartRound(13)).toMatch(/Maximaal 12/);
  });
});

describe('the seed is derived from the rounds, never stored', () => {
  // The bug this replaces: `seeded` used to be a field on the member document,
  // written by the joining client into a document that client owns. From
  // devtools, `seeded: 9999` was a first-place finish, and no security rule
  // could tell that write from an honest one — rules cannot replay an evening
  // to know what the floor was at round four.

  it('ignores a seed smuggled onto the member document', () => {
    const honest = [member('a'), member('b'), member('c', 3)];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),   // a:3  b:1
      round(2, [result('a', true), result('b', false)]),   // a:6  b:2
    ];

    // Exactly the write a player with devtools would attempt. The field is not
    // in the type any more, and it is not in the arithmetic either.
    const forged = honest.map((m) =>
      m.uid === 'c' ? ({ ...m, seeded: 9999, points: 9999 } as SessionMember) : m,
    );

    const table = standings(forged, rounds);
    const c = table.find((s) => s.uid === 'c')!;
    expect(c.seeded).toBe(2);
    expect(c.points).toBe(2);
    expect(table[0]!.uid).toBe('a');   // not the forger
    expect(standings(forged, rounds)).toEqual(standings(honest, rounds));
  });

  it('seeds at the floor of the round they arrived, not the floor now', () => {
    // c joins at round 3 when the floor is 2, then everyone plays round 3.
    // Recomputing later must still say 2 — the seed is a fact about round 3.
    const members = [member('a'), member('b'), member('c', 3)];
    const early = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', true), result('b', false)]),
    ];
    expect(standings(members, early).find((s) => s.uid === 'c')!.seeded).toBe(2);

    const later = [
      ...early,
      round(3, [result('a', false), result('b', false), result('c', true)]),
    ];
    const c = standings(members, later).find((s) => s.uid === 'c')!;
    expect(c.seeded).toBe(2);
    expect(c.points).toBe(2 + DEFAULT_SCORING.win);
  });

  it('seeds two people arriving together from the same floor', () => {
    // Computed before either is admitted. Otherwise the second would seed off
    // the first and land below somebody who walked in at the same moment.
    const members = [member('a'), member('b'), member('c', 3), member('d', 3)];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', true), result('b', false)]),
    ];
    const table = standings(members, rounds);
    expect(table.find((s) => s.uid === 'c')!.seeded).toBe(2);
    expect(table.find((s) => s.uid === 'd')!.seeded).toBe(2);
  });

  it('does not let a player who has gone home drag the floor down', () => {
    // b finished on 1 point and left after round 1. A newcomer at round 3
    // joins the table that is actually there, which is a alone on 6.
    const members = [member('a'), member('b', 1, 1), member('c', 3)];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', true)]),
    ];
    expect(standings(members, rounds).find((s) => s.uid === 'c')!.seeded).toBe(6);
  });

  it('starts the first round at zero for everyone', () => {
    const table = standings([member('a'), member('b')], []);
    expect(table.map((s) => s.seeded)).toEqual([0, 0]);
    expect(table.map((s) => s.points)).toEqual([0, 0]);
  });

  it('puts somebody who joined for a round not yet played on the board', () => {
    // They are here. A scoreboard that omits them until the deal happens
    // reads as "you are not in this evening", which is the opposite of true.
    const members = [member('a'), member('c', 4)];
    const rounds = [round(1, [result('a', true)])];
    const c = standings(members, rounds).find((s) => s.uid === 'c');
    expect(c).toBeDefined();
    expect(c!.roundsPlayed).toBe(0);
  });

  it('is stable under recomputation, which is the whole point', () => {
    const members = [member('a'), member('b'), member('c', 2), member('d', 3)];
    const rounds = [
      round(1, [result('a', true), result('b', false)]),
      round(2, [result('a', false), result('b', true), result('c', false)]),
      round(3, [result('a', true), result('c', true), result('d', false)]),
    ];
    const once = standings(members, rounds);
    expect(standings(members, rounds)).toEqual(once);
    // ...and independent of the order the members happen to arrive in.
    expect(standings([...members].reverse(), rounds)).toEqual(once);
  });
});
