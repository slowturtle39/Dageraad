import { roleName, t, type Lang } from './i18n.js';
import type { Choice, DecisionRequest, SeatIndex } from '../engine/types.js';

/**
 * The question one seat is being asked, and the answer coming back.
 *
 * Rendered OVER the table rather than instead of it (§13.1) — from across the
 * room, deciding and idly browsing have to look the same, which is why the
 * caller draws this into a sheet on top of the seating rather than swapping
 * the screen out.
 *
 * The request is this device's own, published by the referee into this
 * device's own private document. Nothing here knows about anybody else's.
 */

export interface PromptView {
  lang: Lang;
  request: DecisionRequest;
  names: Record<SeatIndex, string>;
  ownSeat: SeatIndex;
  /** Seats picked so far. Two-seat prompts need both before confirming. */
  picked: SeatIndex[];
  pickedCenters: number[];
  centerCount: number;
  onPickSeat: (seat: SeatIndex) => void;
  onPickCenter: (index: number) => void;
  onConfirm: (choice: Choice) => void;
  onDecline: () => void;
}

/** The answer a set of picks amounts to, or null while it is incomplete. */
export function choiceFor(view: PromptView): Choice | null {
  const { prompt } = view.request;
  switch (prompt.kind) {
    case 'seat':
      return view.picked.length === 1
        ? { kind: 'seat', seat: view.picked[0]! }
        : null;
    case 'two-seats':
      return view.picked.length === 2
        ? { kind: 'seats', seats: [...view.picked] }
        : null;
    case 'center':
      return view.pickedCenters.length === prompt.count
        ? { kind: 'center', centerIndices: [...view.pickedCenters] }
        : null;
    case 'confirm':
      return { kind: 'bool', value: true };
    case 'dorpsgek':
      // Direction is chosen with its own buttons, below — there is no partial
      // state to derive here, and the direction is never shown to anyone else.
      return null;
  }
}

/** May this seat be picked for this prompt? */
export function seatSelectable(request: DecisionRequest, seat: SeatIndex): boolean {
  const { prompt } = request;
  if (prompt.kind !== 'seat' && prompt.kind !== 'two-seats') return false;
  return !prompt.exclude.includes(seat);
}

export function renderPrompt(view: PromptView): HTMLElement {
  const { lang, request } = view;
  const el = document.createElement('div');
  el.className = 'prompt';

  const title = document.createElement('p');
  title.className = 'prompt__title';
  title.textContent = t(lang, 'prompt.youAre', { role: roleName(lang, request.actingAs) });
  el.append(title);

  const ask = document.createElement('p');
  ask.className = 'sheet__sub';
  ask.textContent = promptText(view);
  el.append(ask);

  if (request.prompt.kind === 'center') {
    el.append(centerRow(view));
  }
  if (request.prompt.kind === 'dorpsgek') {
    el.append(directionRow(view));
  }

  const actions = document.createElement('div');
  actions.className = 'prompt__actions';

  const choice = choiceFor(view);
  if (request.prompt.kind !== 'dorpsgek') {
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn--primary';
    // Marked, not inferred from styling: the Dorpsgek's direction buttons look
    // the same and are not a confirm — they ARE the answer.
    confirm.dataset.confirm = '1';
    confirm.textContent = choice
      ? t(lang, 'action.confirm')
      : t(lang, 'action.pickPlayerFirst');
    confirm.disabled = choice === null;
    confirm.addEventListener('click', () => { if (choice) view.onConfirm(choice); });
    actions.append(confirm);
  }

  // Declining is always available and is a real answer, not a failure to
  // answer: a window that closes on somebody who wanted to do nothing must
  // record that, or their seat never settles and they get no reveals at all.
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn';
  skip.textContent = t(lang, 'action.skip');
  skip.addEventListener('click', () => view.onDecline());
  actions.append(skip);

  el.append(actions);
  return el;
}

function promptText(view: PromptView): string {
  const { lang, request } = view;
  switch (request.prompt.kind) {
    case 'seat':
      return t(lang, 'prompt.pickSeat');
    case 'two-seats':
      return t(lang, 'prompt.pickTwoSeats');
    case 'center':
      return t(lang, 'prompt.pickCenter', { n: request.prompt.count });
    case 'dorpsgek':
      return t(lang, 'prompt.dorpsgek');
    case 'confirm':
      return t(lang, 'prompt.confirm');
  }
}

function centerRow(view: PromptView): HTMLElement {
  const row = document.createElement('div');
  row.className = 'prompt__centers';
  for (let i = 0; i < view.centerCount; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prompt__center';
    b.dataset.index = String(i);
    if (view.pickedCenters.includes(i)) b.classList.add('prompt__center--picked');
    b.textContent = String(i + 1);
    b.addEventListener('click', () => view.onPickCenter(i));
    row.append(b);
  }
  return row;
}

/**
 * Left, right, or neither.
 *
 * The direction is the Dorpsgek's alone and nobody else is ever told it
 * (Milan, 2026-08-26), so this is the one place it appears on any screen — the
 * table view never names one.
 */
function directionRow(view: PromptView): HTMLElement {
  const row = document.createElement('div');
  row.className = 'prompt__actions';
  const options: Array<['left' | 'right' | 'none', string]> = [
    ['left', t(view.lang, 'prompt.shiftLeft')],
    ['right', t(view.lang, 'prompt.shiftRight')],
  ];
  for (const [direction, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--primary';
    b.dataset.direction = direction;
    b.addEventListener('click', () => {
      const choice: Choice = { kind: 'dorpsgek', direction };
      const designated = view.picked[0];
      if (view.request.prompt.kind === 'dorpsgek'
        && view.request.prompt.variant === 'designate'
        && designated !== undefined) {
        choice.designatedSeat = designated;
      }
      view.onConfirm(choice);
    });
    b.textContent = label;
    row.append(b);
  }
  return row;
}
