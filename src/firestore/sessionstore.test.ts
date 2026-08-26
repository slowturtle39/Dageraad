import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoleId } from '../engine/types.js';
import { DEFAULT_SCORING, type RoundRecord, type SessionMember } from '../app/session.js';
import { sessionView } from './sessionstore.js';

/**
 * The session store must stay incapable of writing a score.
 *
 * Half of this is a real test of the derivation as the app actually calls it;
 * the other half reads the source, because the property that matters is an
 * ABSENCE — no method writes points — and an absence is not something a unit
 * test can observe by calling things.
 */

const src = readFileSync('src/firestore/sessionstore.ts', 'utf8');

function member(uid: string, joined = 1, left: number | null = null): SessionMember {
  return { uid, joinedAtRound: joined, leftAtRound: left };
}

function round(n: number, results: Array<[string, boolean]>): RoundRecord {
  return {
    round: n,
    activeRoles: ['weerwolf', 'ziener'] as RoleId[],
    seatCount: results.length,
    outcome: 'eliminated',
    results: results.map(([uid, won], i) => ({
      uid, seat: i, originalRole: 'dorpeling' as RoleId, finalRole: 'dorpeling' as RoleId,
      won, voteOutcome: won ? 'correct' as const : 'incorrect' as const,
      suspicionAccuracy: null,
    })),
  };
}

describe('the evening as every device sees it', () => {
  const members = [member('a'), member('b'), member('c', 3)];
  const rounds = [
    round(1, [['a', true], ['b', false]]),   // a:3  b:1
    round(2, [['a', true], ['b', false]]),   // a:6  b:2
  ];

  it('seeds the latecomer at the floor, from documents alone', () => {
    const { standings } = sessionView(members, rounds, ['a', 'b'], 3);
    const c = standings.find((s) => s.uid === 'c')!;
    expect(c.seeded).toBe(2);
    expect(c.points).toBe(2);
    expect(c.roundsPlayed).toBe(0);
  });

  it('does not care what order the member documents arrive in', () => {
    // Firestore snapshots have no meaningful order, so the scoreboard must not
    // depend on one. This is the bug that would only show up at the table.
    const forward = sessionView(members, rounds, ['a', 'b'], 3);
    const backward = sessionView([...members].reverse(), rounds, ['a', 'b'], 3);
    expect(backward.standings).toEqual(forward.standings);
  });

  it('does not care what order the round documents arrive in either', () => {
    const shuffled = sessionView(members, [...rounds].reverse(), ['a', 'b'], 3);
    expect(shuffled.standings).toEqual(sessionView(members, rounds, ['a', 'b'], 3).standings);
  });

  it('seats the newcomer for the next round, on the end', () => {
    const { seating } = sessionView(members, rounds, ['a', 'b'], 3);
    expect(seating).toEqual(['a', 'b', 'c']);
  });

  it('closes the ring around somebody who went home', () => {
    const gone = [member('a'), member('b', 1, 2), member('c', 3)];
    expect(sessionView(gone, rounds, ['a', 'b'], 3).seating).toEqual(['a', 'c']);
  });

  it('ignores a score smuggled onto a member document', () => {
    // What a player with devtools would write if the rules ever let them.
    const forged = members.map((m) =>
      m.uid === 'c' ? ({ ...m, seeded: 9999, points: 9999 } as SessionMember) : m,
    );
    const { standings } = sessionView(forged, rounds, ['a', 'b'], 3);
    expect(standings[0]!.uid).toBe('a');
    expect(standings.find((s) => s.uid === 'c')!.points).toBe(2);
  });

  it('pays a Looier for the solo win, through the same path', () => {
    const solo = [round(1, [['a', true]])];
    solo[0]!.results[0]!.finalRole = 'looier' as RoleId;
    const { standings } = sessionView([member('a')], solo, ['a'], 2);
    expect(standings[0]!.points).toBe(DEFAULT_SCORING.soloWin);
  });
});

describe('the store cannot write a score even by accident', () => {
  it('never mentions a points, wins or seed field', () => {
    // Not "does not today" — must not, ever. A method that wrote one would be
    // rejected by the rules anyway, but failing here says why.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/\bseeded\b/);
    expect(code).not.toMatch(/\bpoints\s*:/);
    expect(code).not.toMatch(/\bwins\s*:/);
  });

  it('takes joinedAtRound from the room document, never from its caller', () => {
    // The moment this becomes a parameter, the joining device picks its own
    // seed again and the rules are the only thing left standing.
    expect(src).toMatch(/joinedAtRound: await this\.currentRound\(\)/);
    expect(src).toMatch(/async join\(uid: string\): Promise<void>/);
  });

  it('files a round under its own number, so it can be recorded once', () => {
    expect(src).toMatch(/paths\.round\(this\.roomId, record\.round\)/);
  });

  it('reads a member id from the document, not from a field inside it', () => {
    // Same reasoning as the submissions store: a uid field is forgeable, the
    // document key is not.
    expect(src).toMatch(/uid: d\.id/);
  });
});
