import type { CardId, NightState, RoleId, SeatIndex, SlotIndex } from './types.js';

/** Slot helpers. Seats occupy 0..seatCount-1; center cards follow. */
export function centerSlot(state: NightState, centerIndex: number): SlotIndex {
  if (centerIndex < 0 || centerIndex >= state.centerCount) {
    throw new Error(`center index out of range: ${centerIndex}`);
  }
  return state.seatCount + centerIndex;
}

export function isSeatSlot(state: NightState, slot: SlotIndex): boolean {
  return slot >= 0 && slot < state.seatCount;
}

export function cardAt(state: NightState, slot: SlotIndex): CardId {
  const card = state.slots[slot];
  if (card === undefined) throw new Error(`no card at slot ${slot}`);
  return card;
}

export function roleAt(state: NightState, slot: SlotIndex): RoleId {
  const role = state.cardRole[cardAt(state, slot)];
  if (role === undefined) throw new Error(`card at slot ${slot} has no role`);
  return role;
}

export function isShielded(state: NightState, slot: SlotIndex): boolean {
  return state.shieldedSlots.has(slot);
}

/**
 * Swap the cards in two slots. Returns false and does nothing if either slot
 * is shielded (§6.1 #1: a shielded card can't be viewed or swapped all night).
 */
export function swapSlots(state: NightState, a: SlotIndex, b: SlotIndex): boolean {
  if (isShielded(state, a) || isShielded(state, b)) return false;
  const cardA = cardAt(state, a);
  const cardB = cardAt(state, b);
  state.slots[a] = cardB;
  state.slots[b] = cardA;
  return true;
}

/**
 * Dorpsgek rotation (§6.1 #8, house-ruled).
 *
 * Cards rotate one step among the *participating* seats only. A seat is exempt
 * when it is:
 *   - the acting player's own seat (always; and per Milan's ruling this means
 *     the DUBBELGANGER's seat when the Dubbelganger is the one copying this
 *     action, while the real Dorpsgek's card moves normally),
 *   - shielded by the Schildwacht (stays put, others rotate around it),
 *   - the extra designated seat in the 'designate' variant.
 *
 * Exempt seats are skipped over entirely: with seats [0,1,2,3,4,5] and 2 and 4
 * exempt, the participating ring is [0,1,3,5] and cards move 0->1->3->5->0
 * (direction 'right') or the reverse (direction 'left').
 */
export function rotateSeats(
  state: NightState,
  exempt: ReadonlySet<SeatIndex>,
  direction: 'left' | 'right',
): SeatIndex[] {
  const participating: SeatIndex[] = [];
  for (let seat = 0; seat < state.seatCount; seat++) {
    if (!exempt.has(seat)) participating.push(seat);
  }
  if (participating.length < 2) return [];

  const cards = participating.map((seat) => cardAt(state, seat));
  const rotated =
    direction === 'right'
      ? [cards[cards.length - 1]!, ...cards.slice(0, -1)]
      : [...cards.slice(1), cards[0]!];

  participating.forEach((seat, i) => {
    state.slots[seat] = rotated[i]!;
  });
  return participating;
}

export interface DealInput {
  seatCount: number;
  /** Roles dealt to seats, in seat order. */
  seatRoles: RoleId[];
  /** Roles placed in the center (normally 3). */
  centerRoles: RoleId[];
  /** The Alpha Wolf's extra center wolf card, when the Alpha Wolf is in play. */
  alphaWolfCardRole?: RoleId;
}

export function createNightState(deal: DealInput): NightState {
  if (deal.seatRoles.length !== deal.seatCount) {
    throw new Error('seatRoles length must equal seatCount');
  }

  const cardRole: Record<CardId, RoleId> = {};
  const slots: CardId[] = [];
  let n = 0;
  const push = (role: RoleId): CardId => {
    const id = `c${n++}`;
    cardRole[id] = role;
    slots.push(id);
    return id;
  };

  deal.seatRoles.forEach(push);
  deal.centerRoles.forEach(push);

  let alphaWolfSlot: SlotIndex | null = null;
  if (deal.alphaWolfCardRole) {
    alphaWolfSlot = slots.length;
    push(deal.alphaWolfCardRole);
  }

  return {
    seatCount: deal.seatCount,
    centerCount: deal.centerRoles.length,
    slots,
    cardRole,
    originalRole: [...deal.seatRoles],
    shieldedSlots: new Set(),
    revealedCards: new Set(),
    alphaWolfSlot,
  };
}

export function cloneNightState(state: NightState): NightState {
  return {
    ...state,
    slots: [...state.slots],
    cardRole: { ...state.cardRole },
    originalRole: [...state.originalRole],
    shieldedSlots: new Set(state.shieldedSlots),
    revealedCards: new Set(state.revealedCards),
  };
}

/**
 * §6.0: team membership is evaluated from the FINAL card a player holds,
 * never the role they were dealt.
 */
export function finalRoleOf(state: NightState, seat: SeatIndex): RoleId {
  return roleAt(state, seat);
}

/** Seats whose current card is an actual Weerwolf, as of right now. */
export function wolfSeats(
  state: NightState,
  isWolf: (role: RoleId) => boolean,
): SeatIndex[] {
  const seats: SeatIndex[] = [];
  for (let seat = 0; seat < state.seatCount; seat++) {
    if (isWolf(roleAt(state, seat))) seats.push(seat);
  }
  return seats;
}
