import { describe, expect, it } from 'vitest';
import { seatIsTargetable, seatViews } from './seats.js';
import type { PlayerView, RoomView } from '../app/backend.js';
import type { RoleId } from '../engine/types.js';
import type { SuspicionMap } from './suspicionpicker.js';

/**
 * A privacy boundary, tested as one.
 *
 * A leak here looks exactly like a working screen: nothing throws, nobody sees
 * an error, and one player simply knows something they should not. So these
 * tests are written as "what must NOT appear", and the happy paths are the
 * short ones.
 */

const ME = 'me-uid';
const OTHER = 'other-uid';
const THIRD = 'third-uid';

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    roomId: 'ROOM1',
    hostUid: 'tablet',
    refereeUid: 'tablet',
    phase: 'night',
    round: 1,
    nightWindowIndex: 0,
    activeRoles: [],
    config: {} as RoomView['config'],
    timeline: null,
    seating: [ME, OTHER, THIRD],
    members: [],
    standings: [],
    publicEvents: [],
    shieldedSeats: [],
    revealedSeats: {},
    abstainCount: 0,
    votesCast: 0,
    pausedAt: null,
    discussionExtendedByMs: 0,
    finalRoles: null,
    outcome: null,
    ...over,
  };
}

const players: PlayerView[] = [ME, OTHER, THIRD].map((uid) => ({
  uid, displayName: uid.split('-')[0]!, seatIndex: null, playing: true, departed: false,
}));

const views = (over: Partial<Parameters<typeof seatViews>[0]> = {}) =>
  seatViews({ room: room(), players, uid: ME, ownRole: 'ziener', ...over });

describe('what may never appear on somebody else\'s seat', () => {
  it('shows no role at all on other seats during the night', () => {
    const seats = views();
    expect(seats[1]!.revealedRole).toBeUndefined();
    expect(seats[2]!.revealedRole).toBeUndefined();
  });

  it('shows your own role only on your own seat', () => {
    const seats = views();
    expect(seats[0]!.revealedRole).toBe('ziener');
    expect(seats[0]!.isSelf).toBe(true);
    expect(seats[1]!.isSelf).toBeFalsy();
  });

  it('never leaks a role through the day or the vote either', () => {
    // The night is the obvious case. These are the phases where a careless
    // "the game is basically over" shortcut would get written.
    for (const phase of ['day', 'voting'] as const) {
      const seats = seatViews({
        room: room({ phase }), players, uid: ME, ownRole: 'ziener',
      });
      expect(seats.slice(1).every((s) => s.revealedRole === undefined)).toBe(true);
    }
  });

  it('shows a card that was genuinely turned face up, and only that one', () => {
    // The Medium's flip (§12). Written by the referee into the public room
    // document, so it is already on the shared tablet.
    const seats = seatViews({
      room: room({ revealedSeats: { 1: 'weerwolf' as RoleId } }),
      players, uid: ME, ownRole: 'ziener',
    });
    expect(seats[1]!.revealedRole).toBe('weerwolf');
    expect(seats[2]!.revealedRole).toBeUndefined();
  });

  it('opens every card once the game is over, and not a moment before', () => {
    const finished = room({
      phase: 'results',
      finalRoles: { 0: 'ziener', 1: 'weerwolf', 2: 'dorpeling' } as Record<number, RoleId>,
    });
    const seats = seatViews({ room: finished, players, uid: ME, ownRole: 'ziener' });
    expect(seats.map((s) => s.revealedRole)).toEqual(['ziener', 'weerwolf', 'dorpeling']);

    // ...and the same room without finalRoles published stays shut.
    const notYet = seatViews({
      room: room({ phase: 'results' }), players, uid: ME, ownRole: 'ziener',
    });
    expect(notYet.slice(1).every((s) => s.revealedRole === undefined)).toBe(true);
  });
});

describe('your own notes are yours, and look like notes', () => {
  const suspicions: SuspicionMap = new Map([
    [1, { role: 'weerwolf' as RoleId, visible: true }],
  ]);

  it('marks a guess as a guess, not as a revealed card', () => {
    // Confusing your own hunch with a fact is the one way a memory aid makes
    // you play worse than having no notes at all (§9).
    const seats = views({ suspicions });
    expect(seats[1]!.suspectedRole).toBe('weerwolf');
    expect(seats[1]!.revealedRole).toBeUndefined();
  });

  it('never puts a guess on your own seat', () => {
    // Next to your real card it would read as a second opinion about it.
    const mine: SuspicionMap = new Map([[0, { role: 'heks' as RoleId, visible: true }]]);
    expect(views({ suspicions: mine })[0]!.suspectedRole).toBeUndefined();
  });

  it('hides guesses while a night prompt is open', () => {
    // During a prompt the card tap means "target this seat", so a guess shown
    // under your finger is an invitation to tap the wrong thing.
    expect(views({ suspicions, prompting: true })[1]!.suspectedRole).toBeUndefined();
  });

  it('remembers a guess that has been tapped face-down', () => {
    const hidden: SuspicionMap = new Map([[1, { role: 'heks' as RoleId, visible: false }]]);
    const seat = views({ suspicions: hidden })[1]!;
    expect(seat.suspectedRole).toBe('heks');
    expect(seat.suspicionVisible).toBe(false);
  });
});

describe('the rest of the seat', () => {
  it('carries the shield, which is a physical token on the table', () => {
    const seats = seatViews({
      room: room({ shieldedSeats: [2] }), players, uid: ME, ownRole: 'ziener',
    });
    expect(seats[2]!.shielded).toBe(true);
    expect(seats[0]!.shielded).toBe(false);
  });

  it('follows the seating order, not the player list order', () => {
    const seats = seatViews({
      room: room({ seating: [THIRD, ME, OTHER] }),
      players, uid: ME, ownRole: 'ziener',
    });
    expect(seats.map((s) => s.seat)).toEqual([0, 1, 2]);
    expect(seats[1]!.isSelf).toBe(true);
  });

  it('shows a visibly wrong name rather than a blank seat', () => {
    // A uid on screen is a bug. A blank seat at a table is a bug nobody can
    // describe, which is worse.
    const seats = seatViews({ room: room(), players: [], uid: ME, ownRole: null });
    expect(seats[0]!.name).toBe(ME);
  });

  it('marks the seat the viewer has picked', () => {
    expect(views({ selected: 2 })[2]!.selected).toBe(true);
    expect(views({ selected: 2 })[1]!.selected).toBe(false);
  });
});

describe('who can be targeted', () => {
  it('is anybody but yourself', () => {
    // §7 forbids voting for yourself, and no night action targets your own
    // seat either — the ones that look like they do target the centre.
    expect(seatIsTargetable(room(), 0, ME)).toBe(false);
    expect(seatIsTargetable(room(), 1, ME)).toBe(true);
  });

  it('still includes somebody who has gone home mid-round', () => {
    // Their card is in the deal for the round they are finishing. They are at
    // the table whether or not they are looking at their phone.
    const r = room({ seating: [ME, OTHER] });
    expect(seatIsTargetable(r, 1, ME)).toBe(true);
  });

  it('is false for a seat that does not exist', () => {
    expect(seatIsTargetable(room(), 9, ME)).toBe(false);
  });
});
