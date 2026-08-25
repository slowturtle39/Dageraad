import { roleDef } from './roles.js';
import { createNightState, type DealInput } from './state.js';
import type { NightState, RoleId } from './types.js';

/**
 * Dealing.
 *
 * As in the physical game there are always **three more cards than players**,
 * and those three go to the centre. That is what makes the whole game work: you
 * can never be sure a role is in play just because it is on the table.
 *
 * The Alpha Wolf's wolf card is EXTRA, on top of that. It is not one of the
 * three and is never dealt to a seat — see §6.1 #3 and `NightState.alphaWolfSlot`.
 */

export class DealError extends Error {}

/**
 * A seeded shuffle, so a game can be replayed exactly from its seed.
 *
 * Deliberately not `Math.random`: the whole engine is otherwise deterministic,
 * and being able to reproduce a night from (seed + choices) is what makes a
 * disputed result checkable rather than an argument.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0 || 0x9e3779b9;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32 — small, fast, and good enough for dealing cards.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface DealOptions {
  /** Every card in the game, INCLUDING the three that will go to the centre. */
  cards: RoleId[];
  seatCount: number;
  seed: number;
}

/**
 * Validate a card list before anything is dealt.
 *
 * Checked up front rather than at deal time because the host is choosing roles
 * in the lobby with everyone watching, and "you need one more card" is useful
 * then; a thrown error after the deal is not.
 */
export function validateCards(cards: RoleId[], seatCount: number): string[] {
  const problems: string[] = [];
  const needed = seatCount + 3;

  if (cards.length !== needed) {
    problems.push(
      `${seatCount} spelers hebben ${needed} kaarten nodig (3 in het midden); ` +
      `er zijn er ${cards.length}.`,
    );
  }
  for (const card of cards) {
    try {
      roleDef(card);
    } catch {
      problems.push(`Onbekende rol: ${card}`);
    }
  }
  // A Dubbelganger with nothing to copy, or a Vrijmetselaar alone, is legal but
  // usually a mistake, so it is worth saying — without blocking it.
  if (cards.filter((c) => c === 'vrijmetselaar').length === 1) {
    problems.push('Let op: één Vrijmetselaar heeft niemand om te herkennen.');
  }
  return problems;
}

export interface DealtGame {
  state: NightState;
  seed: number;
  /** What went where, for the referee's own records. Never sent to players. */
  seatRoles: RoleId[];
  centerRoles: RoleId[];
}

export function deal(options: DealOptions): DealtGame {
  const problems = validateCards(options.cards, options.seatCount);
  const fatal = problems.filter((p) => !p.startsWith('Let op'));
  if (fatal.length > 0) throw new DealError(fatal.join(' '));

  const shuffled = seededShuffle(options.cards, options.seed);
  const seatRoles = shuffled.slice(0, options.seatCount);
  const centerRoles = shuffled.slice(options.seatCount);

  // The Alpha Wolf's card exists only when the Alpha Wolf herself is in the
  // game — she is the only role that can touch it, so otherwise it would sit
  // there unreachable and inflate the centre.
  const hasAlphaWolf = options.cards.includes('alphawolf');

  const input: DealInput = {
    seatCount: options.seatCount,
    seatRoles,
    centerRoles,
    ...(hasAlphaWolf ? { alphaWolfCardRole: 'weerwolf' as RoleId } : {}),
  };

  return {
    state: createNightState(input),
    seed: options.seed,
    seatRoles,
    centerRoles,
  };
}

/** The cards for a standard game: the active roles, padded with Dorpelingen. */
export function cardsForRoles(activeRoles: RoleId[], seatCount: number): RoleId[] {
  const needed = seatCount + 3;
  const cards = [...activeRoles];
  while (cards.length < needed) cards.push('dorpeling');
  return cards.slice(0, needed);
}
