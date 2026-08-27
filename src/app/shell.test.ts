import { describe, expect, it } from 'vitest';
import { canDeal, mayManageBots, nextRoundRoster, roundsUntilSeated, screenFor } from './shell.js';
import type { PlayerView, RoomView } from './backend.js';
import type { SessionMember } from './session.js';

/**
 * Routing, which is where the interesting mistakes live and none of them are
 * visual. Two devices in one room are in genuinely different situations, and
 * getting that wrong shows somebody a screen that lies to them or leaks.
 */

const TABLET = 'tablet-uid';
const ALICE = 'alice-uid';
const BOB = 'bob-uid';

function member(uid: string, joined = 1, left: number | null = null): SessionMember {
  return { uid, joinedAtRound: joined, leftAtRound: left };
}

function player(uid: string): PlayerView {
  return { uid, displayName: uid, seatIndex: null, playing: false, departed: false };
}

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    roomId: 'ROOM1',
    hostUid: TABLET,
    refereeUid: TABLET,
    phase: 'night',
    mode: 'practice',
    round: 1,
    nightWindowIndex: 0,
    activeRoles: [],
    config: {} as RoomView['config'],
    timeline: null,
    seating: [ALICE, BOB],
    members: [member(ALICE), member(BOB)],
    standings: [],
    publicEvents: [],
    shieldedSeats: [],
    revealedSlots: {},
    abstainCount: 0,
    earlyVoteCount: 0,
    votesCast: 0,
    pausedAt: null,
    discussionExtendedByMs: 0,
    finalRoles: null,
    outcome: null,
    ...over,
  };
}

describe('the table device never lands on a player screen', () => {
  it('routes a seatless referee to the tablet, in every phase', () => {
    // It has every card in memory. The tablet view is spoiler-free by
    // construction; the player views are not, because they show you your card.
    for (const phase of ['lobby', 'night', 'day', 'voting', 'results'] as const) {
      expect(screenFor({ uid: TABLET, room: room({ phase }), players: [] }))
        .toEqual({ kind: 'tablet' });
    }
  });

  it('still routes it to the tablet when it is not even a member', () => {
    const r = room({ members: [member(ALICE), member(BOB)] });
    expect(screenFor({ uid: TABLET, room: r, players: [] }).kind).toBe('tablet');
  });

  it('but a trusted host who took a seat plays like anybody else', () => {
    // Same person is referee AND seated: that is the trusted-host mode, and
    // routing them to the neutral display would leave them unable to play.
    const r = room({
      refereeUid: ALICE,
      hostUid: ALICE,
      seating: [ALICE, BOB],
    });
    expect(screenFor({ uid: ALICE, room: r, players: [] }))
      .toEqual({ kind: 'table', seat: 0 });
  });
});

describe('before there is a room', () => {
  it('starts at the setup screen, where the table device is chosen', () => {
    expect(screenFor({ uid: ALICE, room: null, players: [] }))
      .toEqual({ kind: 'setup' });
  });

  it('goes to the join screen when this device is joining one', () => {
    expect(screenFor({ uid: ALICE, room: null, players: [], joining: true }))
      .toEqual({ kind: 'join' });
  });

  it('asks somebody with the link but no membership to join', () => {
    const r = room({ seating: [BOB], members: [member(BOB)] });
    expect(screenFor({ uid: ALICE, room: r, players: [] })).toEqual({ kind: 'join' });
  });
});

describe('arriving in the middle of an evening', () => {
  it('waits somebody who joined after the deal', () => {
    // There is no card to hand somebody who walks in at second twenty.
    const r = room({
      round: 3,
      seating: [ALICE],
      members: [member(ALICE), member(BOB, 4)],
    });
    expect(screenFor({ uid: BOB, room: r, players: [] }))
      .toEqual({ kind: 'waiting', joinsAtRound: 4 });
  });

  it('promises the round they will actually be dealt into', () => {
    const r = room({ round: 3 });
    expect(roundsUntilSeated(r, 4)).toBe(1);
    // Never negative, even if a snapshot arrives out of order.
    expect(roundsUntilSeated(r, 2)).toBe(0);
  });

  it('seats them once the boundary has passed', () => {
    const r = room({
      round: 4,
      seating: [ALICE, BOB],
      members: [member(ALICE), member(BOB, 4)],
    });
    expect(screenFor({ uid: BOB, room: r, players: [] }))
      .toEqual({ kind: 'table', seat: 1 });
  });
});

describe('going home', () => {
  it('keeps somebody in the round they are finishing', () => {
    // leftAtRound is the LAST round they play, not the first they miss: the
    // deal already has their card in it, and their decisions decline like an
    // AFK player's. The evening does not stop.
    const r = room({ round: 2, members: [member(ALICE), member(BOB, 1, 2)] });
    expect(screenFor({ uid: BOB, room: r, players: [] }))
      .toEqual({ kind: 'table', seat: 1 });
  });

  it('shows the departed screen only once that round is over', () => {
    const r = room({
      round: 3,
      seating: [ALICE],
      members: [member(ALICE), member(BOB, 1, 2)],
    });
    expect(screenFor({ uid: BOB, room: r, players: [] })).toEqual({ kind: 'departed' });
  });

  it('does not mistake a leaver for somebody waiting to be dealt in', () => {
    // Both are unseated. Routing a leaver to "waiting" would promise them a
    // round that is never coming.
    const r = room({
      round: 5,
      seating: [ALICE],
      members: [member(ALICE), member(BOB, 1, 3)],
    });
    expect(screenFor({ uid: BOB, room: r, players: [] }).kind).toBe('departed');
  });
});

describe('the lobby and the results', () => {
  it('puts everyone in the lobby before the first deal', () => {
    const r = room({ phase: 'lobby', round: 0 });
    expect(screenFor({ uid: ALICE, room: r, players: [] })).toEqual({ kind: 'lobby' });
  });

  it('shows the result to the seats that played it', () => {
    const r = room({ phase: 'results' });
    expect(screenFor({ uid: BOB, room: r, players: [] }))
      .toEqual({ kind: 'results', seat: 1 });
  });
});

describe('who may deal', () => {
  it('is the referee, and only from a settled room', () => {
    expect(canDeal(room({ phase: 'lobby' }), TABLET)).toBe(true);
    expect(canDeal(room({ phase: 'results' }), TABLET)).toBe(true);
    expect(canDeal(room({ phase: 'night' }), TABLET)).toBe(false);
    expect(canDeal(room({ phase: 'day' }), TABLET)).toBe(false);
  });

  it('is never a player, however settled the room', () => {
    expect(canDeal(room({ phase: 'lobby' }), ALICE)).toBe(false);
  });
});

describe('who may change the AI roster', () => {
  it('is the referee, in a practice lobby, and that is all three', () => {
    expect(mayManageBots(room({ phase: 'lobby' }), TABLET)).toBe(true);
  });

  it('is never anybody else, however practice the room', () => {
    // A player who could add a bot could add a seat the referee is then
    // allowed to vote for.
    expect(mayManageBots(room({ phase: 'lobby' }), ALICE)).toBe(false);
  });

  it('is never in an official evening', () => {
    // Official rounds are the append-only input to every all-time statistic,
    // and there is no delete path. An invented player in one is permanent.
    expect(mayManageBots(room({ phase: 'lobby', mode: 'official' }), TABLET)).toBe(false);
  });

  it('is never once the cards are dealt', () => {
    for (const phase of ['night', 'day', 'voting', 'results'] as const) {
      expect(mayManageBots(room({ phase }), TABLET)).toBe(false);
    }
  });
});

describe('who is at the table for the NEXT round', () => {
  it('includes the people currently waiting', () => {
    // The lobby and the results screen are both showing who is about to play,
    // not who just did.
    const r = room({
      round: 2,
      seating: [ALICE],
      members: [member(ALICE), member(BOB, 3)],
    });
    const roster = nextRoundRoster(r, [player(ALICE), player(BOB)]);
    expect(roster.map((p) => p.uid)).toEqual([ALICE, BOB]);
  });

  it('drops the people who have gone home', () => {
    const r = room({
      round: 2,
      seating: [ALICE, BOB],
      members: [member(ALICE), member(BOB, 1, 2)],
    });
    expect(nextRoundRoster(r, [player(ALICE), player(BOB)]).map((p) => p.uid))
      .toEqual([ALICE]);
  });

  it('keeps seated players in their seats and puts newcomers on the end', () => {
    // A newcomer sorted into the middle would reshuffle a table nobody moved.
    const r = room({
      round: 1,
      seating: [BOB, ALICE],
      members: [member(ALICE), member(BOB), member('zoe', 2)],
    });
    const roster = nextRoundRoster(r, [player(ALICE), player(BOB), player('zoe')]);
    expect(roster.map((p) => p.uid)).toEqual([BOB, ALICE, 'zoe']);
  });

  it('does not include somebody who joined for a much later round', () => {
    const r = room({ round: 1, members: [member(ALICE), member(BOB, 9)] });
    expect(nextRoundRoster(r, [player(ALICE), player(BOB)]).map((p) => p.uid))
      .toEqual([ALICE]);
  });
});
