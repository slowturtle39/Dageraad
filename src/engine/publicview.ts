import { cardAt, roleAt } from './state.js';
import type { NightState, RoleId, SlotIndex } from './types.js';

/**
 * What the table can see, right now.
 *
 * A card turned face up STAYS face up, and it belongs to the CARD, not to the
 * seat. At a physical table that is not a rule anybody states — you flipped a
 * card, it is lying there face up, and if somebody later slides it somewhere
 * else it is still lying there face up in its new place. The app has to match
 * that or it is showing a different game.
 *
 * This is why it is recomputed rather than accumulated. The old published
 * shape was a seat -> role map built up from reveal events as they happened,
 * which is correct exactly until something moves — and the roles that move
 * cards (Dorpsgek, Onrustoker, Heks, Alpha Wolf, Dronkaard, and a Dubbelganger
 * copying any of them) act after the Medium, so it was correct exactly until
 * the interesting part of the night. Deriving it from the card identities
 * instead makes following the card the only thing it can do.
 *
 * NOTHING HERE IS A LEAK. `revealedCards` holds only cards that were flipped
 * in front of everybody; the role comes from the card that is lying face up.
 * A card nobody turned over never appears, wherever it has been moved to.
 */

export interface PublicNightView {
  /**
   * Slot -> the role lying face up there. Slots, not seats, because a revealed
   * card can be swapped into the centre and is still face up when it lands.
   */
  revealed: Record<SlotIndex, RoleId>;
  /**
   * Shielded slots. Deliberately NOT card-following: the Schildwacht's shield
   * is a physical token placed on a position at the table, and it stays on
   * that position while cards move under it.
   */
  shielded: SlotIndex[];
}

export function publicView(state: NightState): PublicNightView {
  const revealed: Record<SlotIndex, RoleId> = {};

  for (let slot = 0; slot < state.slots.length; slot++) {
    if (!state.revealedCards.has(cardAt(state, slot))) continue;
    revealed[slot] = roleAt(state, slot);
  }

  return { revealed, shielded: [...state.shieldedSlots].sort((a, b) => a - b) };
}
