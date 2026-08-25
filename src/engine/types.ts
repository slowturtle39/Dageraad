/**
 * Core engine types.
 *
 * DESIGN RULE: this directory must never import Firebase, `window`, timers, or
 * anything environment-specific. The engine is a pure function of
 * (deal + answers to decisions) -> (resolved state + per-seat private info).
 * That is what lets the same module run in a browser today and inside a Cloud
 * Function later without a rewrite. See README "Trust model".
 */

export type PlayerId = string;

/** Seat index around the table, 0..seatCount-1, in real physical seating order. */
export type SeatIndex = number;

/**
 * Slots are one flat index space:
 *   0 .. seatCount-1                     -> player seats
 *   seatCount .. seatCount+centerCount-1 -> the three center cards
 *   alphaWolfSlot (separate)             -> the Alpha Wolf's extra wolf card
 * The Alpha Wolf card is deliberately NOT part of centerCount: the Heks,
 * Leerlingziener, Ziener and Dronkaard choose among the three only, even after
 * the Alpha Wolf has parked a player's old card in the fourth slot.
 */
export type SlotIndex = number;

/**
 * Stable identity for a physical card. Cards are instances, not bare role ids,
 * because duplicates exist (two Dorpelingen, several Weerwolven) and because a
 * public face-up reveal has to follow the *card* as it is swapped around, not
 * the slot it happened to occupy when it was flipped.
 */
export type CardId = string;

export type Team = 'village' | 'wolf' | 'solo';

export type RoleId =
  | 'weerwolf' | 'alphawolf' | 'mystiekewolf' | 'droomwolf' | 'volgeling'
  | 'schildwacht' | 'ziener' | 'leerlingziener' | 'onderzoeker' | 'onrustoker'
  | 'dubbelganger' | 'heks' | 'rechter' | 'dorpsgek' | 'medium'
  | 'schoneslaapster' | 'slapeloze' | 'dronkaard' | 'vrijmetselaar'
  | 'bodyguard' | 'jager' | 'dorpeling' | 'looier';

export type DorpsgekVariant = 'standard' | 'designate';
export type HeksVariant = 'flat' | 'conditional';

/**
 * How the night is run. Both modes use the SAME role logic (see appliers.ts);
 * they differ only in who answers a decision and when results are shown.
 *
 * 'dependency' (mode 1): everyone chooses immediately; reveals are released as
 *   each seat's prerequisites clear. Reveal-then-decide roles act live.
 * 'tworound'   (mode 2): everyone submits up front; only roles that genuinely
 *   need a live follow-up get a second round. The Heks and the Medium's Looier
 *   swap are answered from a pre-committed rule instead, which is the only
 *   reason the night stays at two rounds rather than three.
 */
export type ResolutionMode = 'dependency' | 'tworound';

export interface GameConfig {
  mode: ResolutionMode;
  heksVariant: HeksVariant;
  dorpsgekVariant: DorpsgekVariant;
  /** Base rules let the Heks swap with her own card. */
  heksMaySwapSelf: boolean;
  /**
   * Roles whose reveal-then-decide step is answered from a stored rule rather
   * than by prompting the player. Empty in 'dependency' mode. In 'tworound'
   * mode this is what holds the night to two rounds.
   */
  precommitRoles: RoleId[];
}

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'tworound',
  heksVariant: 'flat',
  dorpsgekVariant: 'standard',
  heksMaySwapSelf: true,
  precommitRoles: ['heks', 'medium'],
};

export interface NightState {
  seatCount: number;
  centerCount: number;
  /** slot -> card currently physically in that slot */
  slots: CardId[];
  /** card -> the role printed on it (immutable for the card's lifetime) */
  cardRole: Record<CardId, RoleId>;
  /**
   * seat -> role dealt at the start of the night. NEVER changes. Per §6.0 this
   * drives night-order position and which action the player performs, even
   * after their card has been swapped out from under them.
   */
  originalRole: RoleId[];
  /** Publicly visible — the shield is a physical token on the table. */
  shieldedSlots: Set<SlotIndex>;
  /** Cards flipped face-up publicly. Follows the card, not the slot. */
  revealedCards: Set<CardId>;
  /** Extra center slot holding the Alpha Wolf's wolf card, if in play. */
  alphaWolfSlot: SlotIndex | null;
}

/**
 * Private information delivered to exactly one seat, tagged with the
 * night-order step at which it was TRUE. The step matters: the Mystieke Wolf
 * views seat 3 at step 4, but the Dorpsgek may rotate the table at step 8, so
 * what she saw is a fact about the past. The UI must render it as "at your
 * turn, seat 3 held X" and never as a current fact.
 */
export type PrivateInfo =
  | { kind: 'saw-card'; step: number; slot: SlotIndex; role: RoleId }
  | { kind: 'saw-center'; step: number; centerIndex: number; role: RoleId }
  | { kind: 'saw-wolves'; step: number; seats: SeatIndex[] }
  | { kind: 'saw-masons'; step: number; seats: SeatIndex[] }
  | { kind: 'copied-role'; step: number; fromSeat: SeatIndex; role: RoleId }
  /** Told they were picked by the Rechter; first day statement must be true. */
  | { kind: 'judged'; step: number }
  | { kind: 'own-final-card'; step: number; role: RoleId }
  /**
   * Confirms an action executed, WITHOUT revealing card faces. Used for roles
   * the physical game keeps blind (Alpha Wolf, Dronkaard): they already chose
   * the targets, so this leaks nothing and only tells them the app registered
   * it. The Heks does NOT use this — she gets a real 'saw-center' receipt,
   * because her blindness is an artefact of our pre-commit, not her design.
   */
  | { kind: 'action-confirmed'; step: number; detail: string }
  | { kind: 'action-blocked'; step: number; reason: 'shielded' | 'no-legal-target' }
  | { kind: 'no-action'; step: number };

/** Public, spoiler-free events for the shared tablet display (§12). */
export type NightEvent =
  | { kind: 'shield-placed'; step: number; slot: SlotIndex }
  | { kind: 'card-publicly-revealed'; step: number; slot: SlotIndex; role: RoleId };

/* ------------------------------------------------------------------ */
/* Decision protocol                                                   */
/* ------------------------------------------------------------------ */

export type Prompt =
  | { kind: 'seat'; exclude: SeatIndex[]; optional: boolean }
  | { kind: 'two-seats'; exclude: SeatIndex[] }
  | { kind: 'center'; count: number }
  | { kind: 'dorpsgek'; variant: DorpsgekVariant }
  | { kind: 'confirm' };

export type Choice =
  | { kind: 'none' }
  | { kind: 'seat'; seat: SeatIndex }
  | { kind: 'seats'; seats: SeatIndex[] }
  | { kind: 'center'; centerIndices: number[] }
  | { kind: 'dorpsgek'; direction: 'left' | 'right' | 'none'; designatedSeat?: SeatIndex }
  | { kind: 'bool'; value: boolean };

/**
 * The engine pauses here and asks somebody to decide. Who answers depends on
 * the mode — a live player, or a stored pre-commit rule.
 */
export interface DecisionRequest {
  seat: SeatIndex;
  /** The role whose action is being performed. Differs from the seat's own
   *  original role when the Dubbelganger is acting as something it copied. */
  actingAs: RoleId;
  step: number;
  /** Stable key for matching a stored pre-committed answer. */
  key: string;
  prompt: Prompt;
  /**
   * True when this decision cannot be made until the player has seen something
   * (`seen` below). These are the decisions that force an extra round in
   * 'tworound' mode unless the role is listed in config.precommitRoles.
   */
  dependsOnReveal: boolean;
  /** What the player has learned at this point. Present iff dependsOnReveal. */
  seen?: PrivateInfo;
}

export type EngineYield =
  | { type: 'decision'; request: DecisionRequest }
  | { type: 'info'; seat: SeatIndex; info: PrivateInfo }
  | { type: 'event'; event: NightEvent };

export interface NightResult {
  state: NightState;
  events: NightEvent[];
  privateInfo: Record<SeatIndex, PrivateInfo[]>;
  decisions: DecisionRequest[];
}
