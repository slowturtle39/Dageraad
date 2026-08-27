import { describe, expect, it } from 'vitest';
import { allTimeStandings, eveningsFor, pointsFor, type HistoryRecord } from './alltime.js';
import { DEFAULT_SCORING } from '../app/session.js';
import type { RoleId } from '../engine/types.js';

/**
 * The group's history across every evening.
 *
 * The two things worth defending here are WHO a row belongs to and WHAT gets
 * counted. Both were decided because the obvious alternative quietly loses
 * somebody's history: keying by uid loses them when they change phone, and
 * keying by display name loses them when they rename.
 */

let clock = 0;
function record(over: Partial<HistoryRecord> = {}): HistoryRecord {
  clock += 1;
  return {
    roomId: 'EVE01', round: 1, friendId: 'f:milan', name: 'Milan', seat: 0,
    originalRole: 'dorpeling', finalRole: 'dorpeling', won: false,
    voteOutcome: 'incorrect', suspicionAccuracy: null, recordedAt: clock,
    ...over,
  };
}

const find = (rows: ReturnType<typeof allTimeStandings>, id: string) =>
  rows.find((r) => r.friendId === id)!;

describe('what a round was worth', () => {
  it('pays a win, and pays the Looier more for a solo one', () => {
    expect(pointsFor({ won: true, finalRole: 'dorpeling' as RoleId }))
      .toBe(DEFAULT_SCORING.win);
    expect(pointsFor({ won: true, finalRole: 'looier' as RoleId }))
      .toBe(DEFAULT_SCORING.soloWin);
  });

  it('still pays something for turning up and losing', () => {
    expect(pointsFor({ won: false, finalRole: 'dorpeling' as RoleId }))
      .toBe(DEFAULT_SCORING.loss);
  });
});

describe('a friend is the same person across evenings and devices', () => {
  it('adds up one friend over two separate evenings', () => {
    const rows = allTimeStandings([
      record({ roomId: 'EVE01', round: 1, won: true }),
      record({ roomId: 'EVE01', round: 2, won: false }),
      record({ roomId: 'EVE02', round: 1, won: true }),
    ]);
    const milan = find(rows, 'f:milan');
    expect(milan.rounds).toBe(3);
    expect(milan.wins).toBe(2);
    expect(milan.evenings).toBe(2);
    expect(milan.points).toBe(DEFAULT_SCORING.win * 2 + DEFAULT_SCORING.loss);
  });

  it('follows the person, not the device', () => {
    // The whole reason this is keyed by a chosen profile. Anonymous auth hands
    // out a new uid whenever somebody clears their browser or turns up on a
    // different phone; the history must not fork underneath them.
    const rows = allTimeStandings([
      record({ roomId: 'EVE01', friendId: 'f:milan', won: true }),
      record({ roomId: 'EVE02', friendId: 'f:milan', won: true }),
    ]);
    expect(rows).toHaveLength(1);
    expect(find(rows, 'f:milan').rounds).toBe(2);
  });

  it('follows the person through a rename, and shows the newest name', () => {
    const rows = allTimeStandings([
      record({ friendId: 'f:sanne', name: 'Sanne', roomId: 'EVE01', recordedAt: 10 }),
      record({ friendId: 'f:sanne', name: 'Sanne B', roomId: 'EVE02', recordedAt: 20 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(find(rows, 'f:sanne').name).toBe('Sanne B');
  });

  it('does not merge two different people who share a name', () => {
    // Names are a label, not an identity. Two Sannes are two Sannes.
    const rows = allTimeStandings([
      record({ friendId: 'f:sanne1', name: 'Sanne' }),
      record({ friendId: 'f:sanne2', name: 'Sanne' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('keeps an old evening readable under the name used at the time', () => {
    // The snapshot is per record, so history does not get retconned.
    const rows = allTimeStandings([
      record({ friendId: 'f:a', name: 'Oud', recordedAt: 5 }),
    ]);
    expect(find(rows, 'f:a').name).toBe('Oud');
  });
});

describe('the table itself', () => {
  it('orders by points, then wins, then stably', () => {
    const rows = allTimeStandings([
      record({ friendId: 'f:a', won: false }),
      record({ friendId: 'f:b', won: true }),
      record({ friendId: 'f:c', won: true, finalRole: 'looier' as RoleId }),
    ]);
    expect(rows.map((r) => r.friendId)).toEqual(['f:c', 'f:b', 'f:a']);
  });

  it('counts a solo win separately, because it is the hardest one', () => {
    const rows = allTimeStandings([
      record({ friendId: 'f:a', won: true, finalRole: 'looier' as RoleId }),
      record({ friendId: 'f:a', won: true, finalRole: 'ziener' as RoleId }),
    ]);
    expect(find(rows, 'f:a').wins).toBe(2);
    expect(find(rows, 'f:a').soloWins).toBe(1);
  });

  it('counts an evening once however many rounds were played in it', () => {
    const rows = allTimeStandings([
      record({ roomId: 'EVE01', round: 1 }),
      record({ roomId: 'EVE01', round: 2 }),
      record({ roomId: 'EVE01', round: 3 }),
    ]);
    expect(find(rows, 'f:milan').evenings).toBe(1);
    expect(find(rows, 'f:milan').rounds).toBe(3);
  });

  it('is empty for no history rather than throwing', () => {
    expect(allTimeStandings([])).toEqual([]);
  });

  it('is a pure function of its input', () => {
    const rows = [record({ won: true }), record({ friendId: 'f:b' })];
    expect(allTimeStandings(rows)).toEqual(allTimeStandings(rows));
    expect(allTimeStandings([...rows].reverse()))
      .toEqual(allTimeStandings(rows));
  });
});

describe('a latecomer\'s seed does not follow them into all-time', () => {
  it('counts only rounds actually played', () => {
    // The seed exists so somebody joining at round four is not bottom of THAT
    // EVENING through no fault of their own. It is a courtesy about one
    // night's ordering, not points anybody earned — carrying it here would
    // make arriving late a way to farm points, which is the opposite of the
    // point of it. Nothing in a HistoryRecord can express a seed, by design.
    const rows = allTimeStandings([
      record({ friendId: 'f:late', roomId: 'EVE09', won: false }),
    ]);
    expect(find(rows, 'f:late').points).toBe(DEFAULT_SCORING.loss);
    expect(find(rows, 'f:late').rounds).toBe(1);
  });
});

describe('which evenings somebody was at', () => {
  it('lists them most recent first, once each', () => {
    const evenings = eveningsFor([
      record({ roomId: 'EVE01', recordedAt: 1 }),
      record({ roomId: 'EVE01', recordedAt: 2 }),
      record({ roomId: 'EVE03', recordedAt: 9 }),
      record({ roomId: 'EVE02', recordedAt: 5 }),
      record({ friendId: 'f:other', roomId: 'EVE07', recordedAt: 99 }),
    ], 'f:milan');
    expect(evenings).toEqual(['EVE03', 'EVE02', 'EVE01']);
  });
});
