import type { PlayerView, RoomView } from './backend.js';
import type { SeatIndex } from '../engine/types.js';

/**
 * Which screen this device should be showing.
 *
 * Pure, and separate from any rendering, because the routing is where the
 * interesting mistakes live and none of them are visual. Two devices in the
 * same room are in genuinely different situations — the table device is not
 * playing, somebody who arrived mid-round is not seated yet, somebody who has
 * gone home is neither — and getting that wrong shows a player a screen that
 * either lies to them or leaks something.
 *
 * THE ONE THAT MATTERS: a device that is the referee and holds no seat must
 * never be routed to a player screen. It has every card in memory. The tablet
 * view is spoiler-free by construction (see tablet.ts); the player views are
 * not, because they are supposed to show you your own card.
 */

export type Screen =
  /** No room yet: choosing the table device and creating one. */
  | { kind: 'setup' }
  /** Entering a room code. */
  | { kind: 'join' }
  /** The neutral shared display. This device is running the game. */
  | { kind: 'tablet' }
  /** Arranging seats before the first round. */
  | { kind: 'lobby' }
  /**
   * In the room, but not in the round now being played — they arrived after
   * the deal. A real state rather than a missing one: there is no card to hand
   * somebody who walks in at second twenty, so they sit out and are dealt in
   * at the next boundary.
   */
  | { kind: 'waiting'; joinsAtRound: number }
  /** Went home. Their finished rounds still count. */
  | { kind: 'departed' }
  /** Playing: night, day or voting, all the same screen by design (§13.1). */
  | { kind: 'table'; seat: SeatIndex }
  /** The round is over and everybody sees the same thing. */
  | { kind: 'results'; seat: SeatIndex | null };

export interface ShellInput {
  uid: string;
  room: RoomView | null;
  players: PlayerView[];
  /** Set once this device has asked to join but the write has not landed yet. */
  joining?: boolean;
}

/**
 * Route one device.
 *
 * Order matters here and is not arbitrary — each check is a state the ones
 * below it would misclassify.
 */
export function screenFor(input: ShellInput): Screen {
  const { uid, room } = input;

  // No room on this device yet. Creating one is the first screen; joining an
  // existing one is the other entry point.
  if (!room) return input.joining ? { kind: 'join' } : { kind: 'setup' };

  const seat = room.seating.indexOf(uid);

  // THE LOAD-BEARING CHECK. The referee holds every card. If it took a seat it
  // is a trusted host playing normally and falls through to the player
  // screens; if it did not, it is the table device and gets the neutral
  // display, in every phase, including the lobby and the results.
  if (room.refereeUid === uid && seat < 0) {
    // The neutral table device still needs the public lobby controls. They do
    // not reveal a card, and without them the device that must deal the round
    // cannot add a practice bot or start the game at all.
    if (room.phase === 'lobby') return { kind: 'lobby' };
    return { kind: 'tablet' };
  }

  const member = room.members.find((m) => m.uid === uid);

  // Not a member at all: they have the link but have not joined.
  if (!member) return { kind: 'join' };

  // Gone home. Checked before seating, because leaving mid-round leaves you in
  // the seating for the round you are finishing — and after it, in neither.
  if (member.leftAtRound !== null && member.leftAtRound < room.round) {
    return { kind: 'departed' };
  }

  if (room.phase === 'lobby') return { kind: 'lobby' };

  if (seat < 0) {
    // Arrived after the deal. joinedAtRound is already the round they will be
    // dealt into, so it is what to promise them.
    return { kind: 'waiting', joinsAtRound: member.joinedAtRound };
  }

  if (room.phase === 'results') return { kind: 'results', seat };

  return { kind: 'table', seat };
}

/**
 * What the waiting screen should say, in rounds rather than minutes.
 *
 * A countdown would be a lie: a round ends when the table stops arguing, and
 * that is not something the app knows. "Next round" is both true and the thing
 * they actually want to know.
 */
export function roundsUntilSeated(room: RoomView, joinsAtRound: number): number {
  return Math.max(0, joinsAtRound - room.round);
}

/**
 * Whether this device may start the next round.
 *
 * The referee deals, and only from a settled room — mid-round the answer is no
 * for everybody. Kept here rather than in the button's own handler so the
 * lobby and the results screen cannot disagree about it.
 */
export function canDeal(room: RoomView, uid: string): boolean {
  if (room.refereeUid !== uid) return false;
  return room.phase === 'lobby';
}

export function canPrepareNextRound(room: RoomView, uid: string): boolean {
  return room.refereeUid === uid && room.phase === 'results';
}

/**
 * Whether this device may change the AI roster.
 *
 * All three conditions, always together. Being the referee is not a game role
 * and not a mode — it is whichever browser resolves the room, and it is the
 * only one that can answer for a seat with no phone behind it. Practice is
 * checked because an official evening's rounds are the permanent record, and
 * lobby because a seat cannot appear or vanish half-way through a night.
 *
 * The rules enforce the same three independently; this is what stops the
 * button being drawn for somebody whose tap would be refused.
 */
export function mayManageBots(room: RoomView, uid: string): boolean {
  return room.refereeUid === uid
    && room.mode === 'practice'
    && room.phase === 'lobby';
}

/**
 * Everyone who will be at the table for the next round, in seat order.
 *
 * Includes people currently waiting, because that is what the lobby and the
 * results screen are both trying to show: not who just played, but who is
 * about to.
 */
export function nextRoundRoster(room: RoomView, players: PlayerView[]): PlayerView[] {
  const nextRound = room.round + 1;
  const coming = new Set(
    room.members
      .filter((m) => m.joinedAtRound <= nextRound)
      .filter((m) => m.leftAtRound === null || m.leftAtRound >= nextRound)
      .map((m) => m.uid),
  );
  return players
    .filter((p) => coming.has(p.uid))
    .sort((a, b) => {
      // Seated players keep their order; newcomers go on the end, which is
      // where a real person joining a real table sits.
      const sa = room.seating.indexOf(a.uid);
      const sb = room.seating.indexOf(b.uid);
      if (sa >= 0 && sb >= 0) return sa - sb;
      if (sa >= 0) return -1;
      if (sb >= 0) return 1;
      return a.uid.localeCompare(b.uid);
    });
}
