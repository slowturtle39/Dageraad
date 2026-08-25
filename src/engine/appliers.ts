import { isWolfRole, roleDef } from './roles.js';
import {
  cardAt, centerSlot, isShielded, roleAt, rotateSeats, swapSlots,
} from './state.js';
import type {
  Choice, DecisionRequest, NightEvent, NightState, PrivateInfo, RoleId,
  SeatIndex, GameConfig,
} from './types.js';

export interface Ctx {
  state: NightState;
  actor: SeatIndex;
  actingAs: RoleId;
  config: GameConfig;
  step: number;
  info(seat: SeatIndex, info: PrivateInfo): void;
  event(event: NightEvent): void;
}

/**
 * A role's night action, expressed as a generator that PAUSES whenever it needs
 * a decision. This is what lets both resolution modes share one set of rules:
 * in 'dependency' mode a live player answers each pause; in 'tworound' mode the
 * pre-commit resolver answers the reveal-dependent ones from a stored rule.
 */
export type Applier = (ctx: Ctx) => Generator<DecisionRequest, void, Choice>;

/* ---------------------------- helpers ---------------------------- */

function otherSeats(state: NightState, actor: SeatIndex): SeatIndex[] {
  const seats: SeatIndex[] = [];
  for (let s = 0; s < state.seatCount; s++) if (s !== actor) seats.push(s);
  return seats;
}

function ask(
  ctx: Ctx,
  key: string,
  prompt: DecisionRequest['prompt'],
  opts: { dependsOnReveal?: boolean; seen?: PrivateInfo } = {},
): DecisionRequest {
  const req: DecisionRequest = {
    seat: ctx.actor,
    actingAs: ctx.actingAs,
    step: ctx.step,
    key,
    prompt,
    dependsOnReveal: opts.dependsOnReveal ?? false,
  };
  if (opts.seen) req.seen = opts.seen;
  return req;
}

function seatOf(choice: Choice): SeatIndex | null {
  return choice.kind === 'seat' ? choice.seat : null;
}

function centersOf(choice: Choice): number[] {
  return choice.kind === 'center' ? choice.centerIndices : [];
}

/** View a card, respecting the Schildwacht's shield. */
function viewSlot(ctx: Ctx, slot: number): RoleId | null {
  if (isShielded(ctx.state, slot)) {
    ctx.info(ctx.actor, { kind: 'action-blocked', step: ctx.step, reason: 'shielded' });
    return null;
  }
  return roleAt(ctx.state, slot);
}

/* ---------------------------- appliers ---------------------------- */

/** §6.1 #1 — shields another player's card for the rest of the night. */
const schildwacht: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'shield', {
    kind: 'seat', exclude: [ctx.actor], optional: true,
  });
  const seat = seatOf(choice);
  if (seat === null) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  ctx.state.shieldedSlots.add(seat);
  ctx.event({ kind: 'shield-placed', step: ctx.step, slot: seat });
  ctx.info(ctx.actor, {
    kind: 'action-confirmed', step: ctx.step, detail: `shielded seat ${seat}`,
  });
};

/** §6.1 #2 — house rule: the Droomwolf SEES the other wolves. */
const droomwolf: Applier = function* (ctx) {
  const seats = otherSeats(ctx.state, ctx.actor)
    .filter((s) => isWolfRole(roleAt(ctx.state, s)));
  ctx.info(ctx.actor, { kind: 'saw-wolves', step: ctx.step, seats });
};

/** Plain wolves see each other; a lone wolf may peek at one center card. */
const weerwolf: Applier = function* (ctx) {
  const packmates = otherSeats(ctx.state, ctx.actor)
    .filter((s) => isWolfRole(roleAt(ctx.state, s)));
  ctx.info(ctx.actor, { kind: 'saw-wolves', step: ctx.step, seats: packmates });
  if (packmates.length > 0) return;

  const choice = yield ask(ctx, 'lone-wolf-center', { kind: 'center', count: 1 });
  const [centerIndex] = centersOf(choice);
  if (centerIndex === undefined) return;
  const slot = centerSlot(ctx.state, centerIndex);
  ctx.info(ctx.actor, {
    kind: 'saw-center', step: ctx.step, centerIndex, role: roleAt(ctx.state, slot),
  });
};

/**
 * §6.1 #3 — swaps a player's card with the extra center wolf card, WITHOUT
 * looking. She never learns what she took away; she only gets a confirmation
 * that the swap she chose executed. That blindness is the role's design, not
 * an artefact of our timing model, so we do not restore it.
 */
const alphawolf: Applier = function* (ctx) {
  if (ctx.state.alphaWolfSlot === null) {
    ctx.info(ctx.actor, { kind: 'action-blocked', step: ctx.step, reason: 'no-legal-target' });
    return;
  }
  const choice = yield ask(ctx, 'alpha-target', {
    kind: 'seat', exclude: [ctx.actor], optional: true,
  });
  const seat = seatOf(choice);
  if (seat === null) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const ok = swapSlots(ctx.state, seat, ctx.state.alphaWolfSlot);
  ctx.info(ctx.actor, ok
    ? { kind: 'action-confirmed', step: ctx.step, detail: `placed the wolf card on seat ${seat}` }
    : { kind: 'action-blocked', step: ctx.step, reason: 'shielded' });
};

/** §6.1 #4 — views one other player's card. */
const mystiekewolf: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'mystic-view', {
    kind: 'seat', exclude: [ctx.actor], optional: true,
  });
  const seat = seatOf(choice);
  if (seat === null) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const role = viewSlot(ctx, seat);
  if (role) ctx.info(ctx.actor, { kind: 'saw-card', step: ctx.step, slot: seat, role });
};

/** Sees who the wolves are; wins with them but is not one. */
const volgeling: Applier = function* (ctx) {
  const seats = otherSeats(ctx.state, ctx.actor)
    .filter((s) => isWolfRole(roleAt(ctx.state, s)));
  ctx.info(ctx.actor, { kind: 'saw-wolves', step: ctx.step, seats });
};

const vrijmetselaar: Applier = function* (ctx) {
  const seats = otherSeats(ctx.state, ctx.actor)
    .filter((s) => roleAt(ctx.state, s) === 'vrijmetselaar');
  ctx.info(ctx.actor, { kind: 'saw-masons', step: ctx.step, seats });
};

/** Views one player's card, or two of the three center cards. */
const ziener: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'seer', { kind: 'seat', exclude: [ctx.actor], optional: true });
  if (choice.kind === 'seat') {
    const role = viewSlot(ctx, choice.seat);
    if (role) ctx.info(ctx.actor, { kind: 'saw-card', step: ctx.step, slot: choice.seat, role });
    return;
  }
  if (choice.kind === 'center') {
    for (const centerIndex of choice.centerIndices.slice(0, 2)) {
      ctx.info(ctx.actor, {
        kind: 'saw-center', step: ctx.step, centerIndex,
        role: roleAt(ctx.state, centerSlot(ctx.state, centerIndex)),
      });
    }
    return;
  }
  ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
};

/** §6.1 #7 — views one of the THREE center cards (never the wolf card). */
const leerlingziener: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'apprentice-center', { kind: 'center', count: 1 });
  const [centerIndex] = centersOf(choice);
  if (centerIndex === undefined) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  ctx.info(ctx.actor, {
    kind: 'saw-center', step: ctx.step, centerIndex,
    role: roleAt(ctx.state, centerSlot(ctx.state, centerIndex)),
  });
};

/**
 * §6.1 #7 — picks one player whose first day statement must be true. Only that
 * player is told, privately (§12: never on the shared tablet).
 */
const rechter: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'judge', { kind: 'seat', exclude: [ctx.actor], optional: true });
  const seat = seatOf(choice);
  if (seat === null) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  ctx.info(seat, { kind: 'judged', step: ctx.step });
  ctx.info(ctx.actor, { kind: 'action-confirmed', step: ctx.step, detail: `judged seat ${seat}` });
};

/**
 * §6.1 #6 — looks at one of the THREE center cards, then MUST swap it with a
 * player's card.
 *
 * Both decisions are ordinary pauses. In 'dependency' mode a live player
 * answers them: she sees the card, then picks a target. In 'tworound' mode the
 * pre-commit resolver answers the second one from her stored rule — either a
 * flat target, or a per-team rule ("Wolf -> A, Looier -> B, village -> C").
 * The Looier branch matters: it is a third team, so a two-way wolf/not-wolf
 * rule would silently arm a Looier while she thought she was helping.
 *
 * She always receives a real 'saw-center' receipt, because the physical Heks
 * does look at the card — the pre-commit is our constraint, not her weakness.
 */
const heks: Applier = function* (ctx) {
  const pick = yield ask(ctx, 'heks-center', { kind: 'center', count: 1 });
  const [centerIndex] = centersOf(pick);
  if (centerIndex === undefined) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const slot = centerSlot(ctx.state, centerIndex);
  const seenRole = roleAt(ctx.state, slot);
  const seen: PrivateInfo = {
    kind: 'saw-center', step: ctx.step, centerIndex, role: seenRole,
  };
  ctx.info(ctx.actor, seen);

  const exclude = ctx.config.heksMaySwapSelf ? [] : [ctx.actor];
  const target = yield ask(ctx, 'heks-target', { kind: 'seat', exclude, optional: false },
    { dependsOnReveal: true, seen });

  const seat = seatOf(target);
  if (seat === null) return;
  const ok = swapSlots(ctx.state, slot, seat);
  ctx.info(ctx.actor, ok
    ? { kind: 'action-confirmed', step: ctx.step, detail: `swapped center ${centerIndex} with seat ${seat}` }
    : { kind: 'action-blocked', step: ctx.step, reason: 'shielded' });
};

/** Swaps two other players' cards, blind. */
const onrustoker: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'troublemaker', { kind: 'two-seats', exclude: [ctx.actor] });
  if (choice.kind !== 'seats' || choice.seats.length !== 2) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const [a, b] = choice.seats as [SeatIndex, SeatIndex];
  const ok = swapSlots(ctx.state, a, b);
  ctx.info(ctx.actor, ok
    ? { kind: 'action-confirmed', step: ctx.step, detail: `swapped seats ${a} and ${b}` }
    : { kind: 'action-blocked', step: ctx.step, reason: 'shielded' });
};

/** Swaps own card with one of the three center cards, blind. */
const dronkaard: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'drunk', { kind: 'center', count: 1 });
  const [centerIndex] = centersOf(choice);
  if (centerIndex === undefined) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const ok = swapSlots(ctx.state, ctx.actor, centerSlot(ctx.state, centerIndex));
  ctx.info(ctx.actor, ok
    ? { kind: 'action-confirmed', step: ctx.step, detail: `swapped your card with center ${centerIndex}` }
    : { kind: 'action-blocked', step: ctx.step, reason: 'shielded' });
};

/**
 * §6.1 #8 — shifts every player's card one seat, except:
 *   - the ACTING player's own card (so when the Dubbelganger copies this, the
 *     Dubbelganger's card is the exempt one and the real Dorpsgek's card moves
 *     normally — Milan's explicit ruling),
 *   - any shielded card (stays put, the rest rotate around it),
 *   - in the 'designate' variant, one further named player's card.
 */
const dorpsgek: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'dorpsgek', {
    kind: 'dorpsgek', variant: ctx.config.dorpsgekVariant,
  });
  if (choice.kind !== 'dorpsgek' || choice.direction === 'none') {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const exempt = new Set<SeatIndex>([ctx.actor]);
  for (const slot of ctx.state.shieldedSlots) {
    if (slot < ctx.state.seatCount) exempt.add(slot);
  }
  if (ctx.config.dorpsgekVariant === 'designate' && choice.designatedSeat !== undefined) {
    exempt.add(choice.designatedSeat);
  }
  const moved = rotateSeats(ctx.state, exempt, choice.direction);
  ctx.info(ctx.actor, {
    kind: 'action-confirmed', step: ctx.step,
    detail: `shifted ${moved.length} cards ${choice.direction}`,
  });
};

/**
 * §6.1 #9 — checks one player's card. A wolf stays hidden; anything else is
 * flipped face-up publicly. If it is the Looier, the Medium may swap with them.
 *
 * That swap is a reveal-dependent decision. In 'dependency' mode she decides
 * live; in 'tworound' mode the pre-commit resolver answers it from her stored
 * yes/no, so it costs no extra round and leaks nothing.
 */
const medium: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'medium-target', {
    kind: 'seat', exclude: [ctx.actor], optional: true,
  });
  const seat = seatOf(choice);
  if (seat === null) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const role = viewSlot(ctx, seat);
  if (!role) return;

  const seen: PrivateInfo = { kind: 'saw-card', step: ctx.step, slot: seat, role };
  ctx.info(ctx.actor, seen);

  // House rule: a wolf is NOT flipped face-up. Anything else is.
  if (!isWolfRole(role)) {
    ctx.state.revealedCards.add(cardAt(ctx.state, seat));
    ctx.event({ kind: 'card-publicly-revealed', step: ctx.step, slot: seat, role });
  }

  if (role !== 'looier') return;
  const swap = yield ask(ctx, 'medium-looier-swap', { kind: 'confirm' },
    { dependsOnReveal: true, seen });
  if (swap.kind === 'bool' && swap.value) {
    swapSlots(ctx.state, ctx.actor, seat);
  }
};

/** Sees their own final card. Both are the same action at different slots. */
const peekOwnFinalCard: Applier = function* (ctx) {
  ctx.info(ctx.actor, {
    kind: 'own-final-card', step: ctx.step, role: roleAt(ctx.state, ctx.actor),
  });
};

/**
 * §6.1 #5 — views another player's card, then immediately performs whatever
 * action that role would perform, AT THE DUBBELGANGER'S OWN SLOT (Milan's
 * ruling). Copying the Medium therefore peeks before the Heks and Dorpsgek have
 * moved anything, and copying the Schildwacht shields late.
 *
 * The view is an ordinary round-1 choice. Everything the copied role then asks
 * is flagged dependsOnReveal, which is precisely what earns the Dubbelganger
 * its own second round in 'tworound' mode.
 */
const dubbelganger: Applier = function* (ctx) {
  const choice = yield ask(ctx, 'doppel-view', {
    kind: 'seat', exclude: [ctx.actor], optional: false,
  });
  const seat = seatOf(choice);
  if (seat === null) {
    ctx.info(ctx.actor, { kind: 'no-action', step: ctx.step });
    return;
  }
  const copied = viewSlot(ctx, seat);
  if (!copied) return;

  ctx.info(ctx.actor, { kind: 'copied-role', step: ctx.step, fromSeat: seat, role: copied });

  // No chaining, and nothing to do for roles that never wake.
  if (copied === 'dubbelganger' || !roleDef(copied).hasNightAction) return;

  const inner = APPLIERS[copied];
  if (!inner) return;

  // Delegate, re-tagging every pause as reveal-dependent: the Dubbelganger
  // could not have pre-committed these without first knowing what it copied.
  const gen = inner({ ...ctx, actingAs: copied });
  let next = gen.next();
  while (!next.done) {
    const answer = yield { ...next.value, dependsOnReveal: true, actingAs: copied };
    next = gen.next(answer);
  }
};

export const APPLIERS: Partial<Record<RoleId, Applier>> = {
  schildwacht,
  droomwolf,
  weerwolf,
  alphawolf,
  mystiekewolf,
  volgeling,
  dubbelganger,
  vrijmetselaar,
  ziener,
  heks,
  rechter,
  leerlingziener,
  onrustoker,
  dorpsgek,
  dronkaard,
  medium,
  slapeloze: peekOwnFinalCard,
  schoneslaapster: peekOwnFinalCard,
  // onderzoeker: TODO — reveal-then-decide; adds a third round when active.
  // curator + artifacts: TODO — separate subsystem.
};
