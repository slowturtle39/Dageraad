import { describe, expect, it } from 'vitest';
import { mayArrangeSeats, reorderForSwap } from './seating.js';
import type { PlayerView, RoomView } from './backend.js';
import type { SeatIndex } from '../engine/types.js';

/**
 * Rearranging the ring before a round starts.
 *
 * Not cosmetic: the Dorpsgek shifts every card one seat, so the on-screen ring
 * has to match where people are actually sitting or that role stops meaning
 * anything (§13). A wrong order looks exactly like a working screen.
 */

const A = 'a-uid', B = 'b-uid', C = 'c-uid', LATE = 'late-uid';

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    roomId: 'ROOM1', hostUid: A, refereeUid: 'tablet', phase: 'lobby', round: 0,
    nightWindowIndex: 0, activeRoles: [], config: {} as RoomView['config'],
    timeline: null, seating: [A, B, C],
    members: [A, B, C].map((uid) => ({ uid, joinedAtRound: 1, leftAtRound: null })),
    standings: [], publicEvents: [], shieldedSeats: [], revealedSlots: {},
    abstainCount: 0, votesCast: 0, pausedAt: null, discussionExtendedByMs: 0,
    finalRoles: null, outcome: null, ...over,
  };
}

const players = (uids: string[]): PlayerView[] => uids.map((uid) => ({
  uid, displayName: uid[0]!.toUpperCase(), seatIndex: null, playing: true, departed: false,
}));

describe('swapping two seats', () => {
  it('swaps them and leaves everybody else where they were', () => {
    const order = reorderForSwap(room(), players([A, B, C]), 0 as SeatIndex, 2 as SeatIndex);
    expect(order).toEqual([C, B, A]);
  });

  it('is its own undo', () => {
    const r = room();
    const once = reorderForSwap(r, players([A, B, C]), 0 as SeatIndex, 2 as SeatIndex);
    const twice = reorderForSwap(room({ seating: once }), players(once), 0 as SeatIndex, 2 as SeatIndex);
    expect(twice).toEqual([A, B, C]);
  });

  it('always returns a permutation of the seated players', () => {
    // Dropping or duplicating a uid would be refused by the backend as a
    // confusing error rather than as the bug it is.
    for (const [x, y] of [[0, 1], [1, 2], [0, 2], [2, 0]] as Array<[number, number]>) {
      const order = reorderForSwap(room(), players([A, B, C]), x as SeatIndex, y as SeatIndex);
      expect([...order].sort()).toEqual([A, B, C].sort());
    }
  });

  it('never writes a seat for somebody who has not been dealt in yet', () => {
    // The lobby shows the NEXT round's roster, which includes a mid-evening
    // arrival. The backend arranges SEATED players only, so the newcomer is
    // visible on screen and absent from the write.
    const r = room({
      round: 1, phase: 'lobby', seating: [A, B, C],
      members: [
        ...[A, B, C].map((uid) => ({ uid, joinedAtRound: 1, leftAtRound: null })),
        { uid: LATE, joinedAtRound: 2, leftAtRound: null },
      ],
    });
    const order = reorderForSwap(r, players([A, B, C, LATE]), 0 as SeatIndex, 1 as SeatIndex);
    expect(order).not.toContain(LATE);
    expect([...order].sort()).toEqual([A, B, C].sort());
  });

  it('drops somebody who has gone home', () => {
    const r = room({
      seating: [A, B, C],
      members: [
        { uid: A, joinedAtRound: 1, leftAtRound: null },
        { uid: B, joinedAtRound: 1, leftAtRound: 0 },
        { uid: C, joinedAtRound: 1, leftAtRound: null },
      ],
    });
    expect(reorderForSwap(r, players([A, B, C]), 0 as SeatIndex, 1 as SeatIndex))
      .not.toContain(B);
  });
});

describe('who may rearrange', () => {
  it('is every present member, not only the host', () => {
    // At a real table the person who moved the chairs is the one who knows.
    expect(mayArrangeSeats(room(), A)).toBe(true);
    expect(mayArrangeSeats(room(), B)).toBe(true);
    expect(mayArrangeSeats(room(), C)).toBe(true);
  });

  it('is nobody once play begins', () => {
    // The Dorpsgek's shift depends on a stable adjacency, so the order locks.
    for (const phase of ['night', 'day', 'voting', 'results'] as const) {
      expect(mayArrangeSeats(room({ phase }), A)).toBe(false);
    }
  });

  it('is not somebody who only has the link', () => {
    expect(mayArrangeSeats(room(), 'stranger')).toBe(false);
  });

  it('is not somebody who has gone home', () => {
    const r = room({
      members: [
        { uid: A, joinedAtRound: 1, leftAtRound: 0 },
        { uid: B, joinedAtRound: 1, leftAtRound: null },
      ],
    });
    expect(mayArrangeSeats(r, A)).toBe(false);
    expect(mayArrangeSeats(r, B)).toBe(true);
  });
});
