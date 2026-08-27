import { nextRoundRoster } from './shell.js';
import { swapSeats, type LobbyPlayer } from '../ui/lobby.js';
import type { PlayerView, RoomView } from './backend.js';
import type { SeatIndex } from '../engine/types.js';

/**
 * Turning "tap seat A, tap seat B" into the order to store.
 *
 * Extracted from the click handler because it is the one piece of real logic
 * in it, and because getting it wrong is not a cosmetic bug: the Dorpsgek
 * shifts every card one seat, so the on-screen ring has to match where people
 * are actually sitting or that role stops meaning anything (§13). A silently
 * wrong order looks like a working screen.
 *
 * Two things it has to get right that are easy to miss:
 *
 *  - The LOBBY shows the next round's roster, which includes people who
 *    arrived mid-evening and are not seated yet. The BACKEND arranges seated
 *    players only. So the swap happens against what the person can see, and
 *    the result is filtered down to what may actually be written.
 *  - The stored order must stay a permutation of the current seating. Dropping
 *    or duplicating a uid here would be rejected by the backend, but it would
 *    be rejected as a confusing error rather than as the bug it is.
 */
export function reorderForSwap(
  room: RoomView,
  players: PlayerView[],
  a: SeatIndex,
  b: SeatIndex,
): string[] {
  const roster = nextRoundRoster(room, players);
  const asLobby: LobbyPlayer[] = roster.map((p, i) => ({
    uid: p.uid,
    displayName: p.displayName,
    seatIndex: i as SeatIndex,
  }));

  const seated = new Set(room.seating);
  return [...swapSeats(asLobby, a, b)]
    .sort((x, y) => x.seatIndex - y.seatIndex)
    .map((p) => p.uid)
    .filter((uid) => seated.has(uid));
}

/**
 * May this device rearrange the seats right now?
 *
 * Every present member may, not just the host (Milan, 2026-08-26): at a real
 * table the person who moved the chairs is the one who knows, and routing that
 * through whoever happens to hold `hostUid` is friction with no benefit. It
 * locks the moment play begins, and the rules enforce that lock rather than
 * trusting this check.
 */
export function mayArrangeSeats(room: RoomView, uid: string): boolean {
  if (room.phase !== 'lobby') return false;
  const member = room.members.find((m) => m.uid === uid);
  return member !== undefined && member.leftAtRound === null;
}
