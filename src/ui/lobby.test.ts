import { describe, expect, it } from 'vitest';
import { seatingIsValid, swapSeats, type LobbyPlayer } from './lobby.js';

const players: LobbyPlayer[] = [
  { uid: 'a', displayName: 'Milan', seatIndex: 0 },
  { uid: 'b', displayName: 'Sanne', seatIndex: 1 },
  { uid: 'c', displayName: 'Joris', seatIndex: 2 },
];

describe('seating arrangement (§13)', () => {
  it('swaps two seats and leaves everyone else alone', () => {
    const after = swapSeats(players, 0, 2);
    expect(after.find((p) => p.uid === 'a')!.seatIndex).toBe(2);
    expect(after.find((p) => p.uid === 'c')!.seatIndex).toBe(0);
    expect(after.find((p) => p.uid === 'b')!.seatIndex).toBe(1);
  });

  it('is its own undo', () => {
    expect(swapSeats(swapSeats(players, 0, 2), 0, 2)).toEqual(players);
  });

  it('requires a contiguous ring with no gaps', () => {
    // A hole in the seating means the Dorpsgek's rotation has a hole in it.
    expect(seatingIsValid(players)).toBe(true);
    expect(seatingIsValid([
      { uid: 'a', displayName: 'A', seatIndex: 0 },
      { uid: 'b', displayName: 'B', seatIndex: 2 },
    ])).toBe(false);
  });

  it('rejects duplicate seats', () => {
    expect(seatingIsValid([
      { uid: 'a', displayName: 'A', seatIndex: 0 },
      { uid: 'b', displayName: 'B', seatIndex: 0 },
    ])).toBe(false);
  });
});
