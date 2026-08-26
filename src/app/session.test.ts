import { describe, expect, it } from 'vitest';
import type { RoleId } from '../engine/types.js';
import {
  DEFAULT_SCORING, canStartRound, seatingForNextRound, seedForJoiner, standings,
  type RoundRecord, type RoundResult, type SessionMember,
} from './session.js';

function member(uid: string, joined = 1, left: number | null = null, seeded = 0): SessionMember {
  return { uid, joinedAtRound: joined, leftAtRound: left, seeded };
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
    const seed = seedForJoiner(standings(started, rounds));
    const withLatecomer = [...started, member('c', 3, null, seed)];
    const table = standings(withLatecomer, rounds);

    const c = table.find((s) => s.uid === 'c')!;
    expect(c.points).toBe(2);          // level with the player in last place
    expect(c.roundsPlayed).toBe(0);    // ...but credited with nothing they didn't play
    expect(c.wins).toBe(0);
    expect(c.seeded).toBe(2);          // and the seed stays visible, not laundered
  });

  it('only ever counts rounds the latecomer actually played', () => {
    const members = [member('a'), member('b'), member('c', 2, null, 1)];
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
