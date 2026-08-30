import type { PlayerView, RoomView } from '../app/backend.js';
import type { RoleId, SeatIndex } from '../engine/types.js';
import type { SeatView } from './table.js';
import type { SuspicionMap } from './suspicionpicker.js';

/**
 * Turning a live room into the seats one device may draw.
 *
 * This function is a privacy boundary, not a formatting helper. It is the last
 * place a role can be attached to somebody else's seat before it reaches a
 * screen, so the rule is stated as narrowly as it can be:
 *
 *   A ROLE MAY APPEAR ON ANOTHER SEAT ONLY IF THE ROOM SAYS THAT CARD WAS
 *   TURNED FACE UP, or the game is over and every card is public.
 *
 * Everything else a device knows about other seats — a suspicion, a hunch —
 * is the viewer's own note and is marked as such. `revealedSeats` is written
 * by the referee and is already public on the shared tablet (§12); the deal
 * itself never leaves the referee.
 *
 * The reason this is its own file with its own tests: a leak here looks
 * exactly like a working screen. Nothing throws, nobody sees an error, and one
 * player simply knows something they should not.
 */

export interface SeatsInput {
  room: RoomView;
  players: PlayerView[];
  uid: string;
  /** This device's own dealt role, from its own private document. */
  ownRole: RoleId | null;
  /** The viewer's private guesses (§9). Never anybody else's. */
  suspicions?: SuspicionMap;
  /** Seat the viewer has picked during a night prompt. */
  selected?: SeatIndex | null;
  /** True while a night prompt is open, which disables the suspicion gesture. */
  prompting?: boolean;
  /** Present only while a private seat-selection prompt is open. */
  legalTargetSeats?: SeatIndex[];
}

export function seatViews(input: SeatsInput): SeatView[] {
  const { room, players, uid } = input;
  const nameByUid = new Map(players.map((p) => [p.uid, p.displayName]));

  return room.seating.map((seatUid, seat) => {
    const isSelf = seatUid === uid;
    const suspicion = input.suspicions?.get(seat);

    const view: SeatView = {
      seat,
      // A uid on screen is a bug, not a fallback — but it beats a blank seat
      // at a table, and it is visibly wrong rather than quietly wrong.
      name: nameByUid.get(seatUid) ?? seatUid,
      isSelf,
      shielded: room.shieldedSeats.includes(seat),
      selected: input.selected === seat,
    };
    if (input.legalTargetSeats) {
      view.targetable = input.legalTargetSeats.includes(seat);
    }

    const revealed = revealedRoleFor(room, seat, isSelf, input.ownRole);
    if (revealed) view.revealedRole = revealed;

    // Your own note about somebody else. Never shown on your own seat, where
    // it would sit next to your real card and read as a second opinion about
    // it, and never while a night prompt is open, because during a prompt the
    // card tap means "target this seat" instead.
    if (!isSelf && suspicion && !input.prompting) {
      view.suspectedRole = suspicion.role;
      view.suspicionVisible = suspicion.visible;
    }

    return view;
  });
}

/**
 * The only role this seat is allowed to show, or undefined.
 *
 * Three sources, in order, and no fourth:
 *   1. the game is over  — finalRoles is published once, and then every card
 *      is public. This is the one moment roles become public, by design.
 *   2. a card was genuinely turned face up in play — the Medium's flip (§12),
 *      written by the referee into the public room document.
 *   3. it is your own seat and your own private document said so.
 */
function revealedRoleFor(
  room: RoomView,
  seat: SeatIndex,
  isSelf: boolean,
  ownRole: RoleId | null,
): RoleId | undefined {
  if (room.finalRoles) return room.finalRoles[seat];
  const flipped = room.revealedSlots[seat];
  if (flipped) return flipped;
  if (isSelf && ownRole) return ownRole;
  return undefined;
}

/**
 * Whether the viewer may tap seats to pick a target right now.
 *
 * A seat that has gone home is still dealt in for the round it is finishing,
 * so it stays targetable — its decisions decline like an AFK player's, but it
 * is still at the table and still holds a card.
 */
export function seatIsTargetable(
  room: RoomView,
  seat: SeatIndex,
  uid: string,
): boolean {
  const seatUid = room.seating[seat];
  if (!seatUid) return false;
  // §7 forbids voting for yourself, and no night action targets your own seat
  // either — the ones that look like they do (Dronkaard) target the centre.
  return seatUid !== uid;
}
