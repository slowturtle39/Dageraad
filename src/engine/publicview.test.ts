import { describe, expect, it } from 'vitest';
import { publicView } from './publicview.js';
import { createNightState, rotateSeats, swapSlots } from './state.js';
import type { NightState, RoleId, SeatIndex, SlotIndex } from './types.js';

/**
 * A face-up card stays face up, and it belongs to the card rather than to the
 * seat it was flipped at.
 *
 * The failure this exists to prevent is subtle and would look exactly like a
 * working screen: the reveal shown against the seat where it happened, while
 * the card itself has since been moved somewhere else. Every role that moves
 * cards acts AFTER the Medium, so the old accumulate-from-events shape was
 * right until the interesting part of the night and wrong afterwards.
 */

const ROLES: RoleId[] = ['medium', 'ziener', 'dorpeling', 'weerwolf', 'dorpsgek'];

function fresh(): NightState {
  return createNightState({
    seatCount: 5,
    seatRoles: ROLES,
    centerRoles: ['dorpeling', 'looier', 'dorpeling'],
  });
}

/** Flip the card currently at `slot`, as the Medium does. */
function flip(state: NightState, slot: SlotIndex): void {
  state.revealedCards.add(state.slots[slot]!);
}

describe('nothing is public until it is turned over', () => {
  it('shows nothing on a fresh deal', () => {
    expect(publicView(fresh()).revealed).toEqual({});
  });

  it('never names a card nobody flipped, wherever it ends up', () => {
    const state = fresh();
    flip(state, 1 as SlotIndex);
    swapSlots(state, 3 as SlotIndex, 4 as SlotIndex);   // two unflipped cards
    expect(Object.keys(publicView(state).revealed)).toEqual(['1']);
  });
});

describe('the reveal follows the card', () => {
  it('moves with it when two seats swap', () => {
    const state = fresh();
    const roleAtOne = state.cardRole[state.slots[1]!]!;
    flip(state, 1 as SlotIndex);
    expect(publicView(state).revealed[1 as SlotIndex]).toBe(roleAtOne);

    swapSlots(state, 1 as SlotIndex, 4 as SlotIndex);

    const after = publicView(state).revealed;
    // The seat it was flipped at is no longer showing anything...
    expect(after[1 as SlotIndex]).toBeUndefined();
    // ...and the card is face up where it actually is.
    expect(after[4 as SlotIndex]).toBe(roleAtOne);
  });

  it('follows a card swapped into the centre and stays face up there', () => {
    // Physically obvious and easy to miss in code: a face-up card slid into
    // the middle is still face up. Keyed by SLOT, not seat, for this reason.
    const state = fresh();
    const role = state.cardRole[state.slots[0]!]!;
    flip(state, 0 as SlotIndex);
    const centre = 5 as SlotIndex;

    swapSlots(state, 0 as SlotIndex, centre);

    const after = publicView(state).revealed;
    expect(after[0 as SlotIndex]).toBeUndefined();
    expect(after[centre]).toBe(role);
  });

  it('follows the card through a Dorpsgek rotation', () => {
    // The role most likely to break this: it moves every card at once, and it
    // acts after the Medium in the night order.
    const state = fresh();
    const role = state.cardRole[state.slots[1]!]!;
    const card = state.slots[1]!;
    flip(state, 1 as SlotIndex);

    rotateSeats(state, new Set<SeatIndex>([0 as SeatIndex]), 'right');

    const landedAt = state.slots.indexOf(card) as SlotIndex;
    const after = publicView(state).revealed;
    expect(landedAt).not.toBe(1);
    expect(after[landedAt]).toBe(role);
    expect(Object.keys(after)).toHaveLength(1);
  });

  it('keeps showing the same ROLE, because the role is on the card', () => {
    const state = fresh();
    const card = state.slots[2]!;
    const role = state.cardRole[card]!;
    flip(state, 2 as SlotIndex);

    swapSlots(state, 2 as SlotIndex, 0 as SlotIndex);
    swapSlots(state, 0 as SlotIndex, 6 as SlotIndex);

    const landedAt = state.slots.indexOf(card) as SlotIndex;
    expect(publicView(state).revealed[landedAt]).toBe(role);
  });
});

describe('the shield does not follow the card', () => {
  it('stays on the position it was placed on', () => {
    // A physical token on the table. Cards move under it; it does not travel
    // with whatever happened to be there when it was put down.
    const state = fresh();
    state.shieldedSlots.add(2 as SlotIndex);
    swapSlots(state, 2 as SlotIndex, 3 as SlotIndex);
    expect(publicView(state).shielded).toEqual([2]);
  });

  it('reports them in a stable order', () => {
    const state = fresh();
    state.shieldedSlots.add(4 as SlotIndex);
    state.shieldedSlots.add(1 as SlotIndex);
    expect(publicView(state).shielded).toEqual([1, 4]);
  });
});
