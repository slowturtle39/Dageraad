import { t, type Lang } from './i18n.js';
import type { ConfirmedAction } from '../engine/types.js';

/**
 * The sheet — everything that isn't the table.
 *
 * Prompts, stats and results all appear as a sheet drawn OVER the seating
 * circle, never instead of it (§13.1). The table stays visible behind, so from
 * across the room a player being asked to make a decision looks the same as a
 * player idly reading somebody's stats.
 *
 * The scrim is deliberately mild for the same reason: a heavy blackout would
 * change how much light the phone throws.
 */

export interface SheetOptions {
  title: string;
  subtitle?: string;
  body?: HTMLElement;
  actions?: { label: string; primary?: boolean; onSelect: () => void }[];
  note?: string;
  onDismiss?: () => void;
  /** A prompt with a deadline can't be dismissed by tapping away. */
  dismissable?: boolean;
  /** A lightweight control panel that should not eclipse the table. */
  variant?: 'vote' | 'night' | 'receipt' | 'result';
  /** Let a live table selection reach the card under this sheet. */
  passiveScrim?: boolean;
}

export function renderSheet(opts: SheetOptions): HTMLElement {
  const wrap = document.createElement('div');

  const scrim = document.createElement('div');
  scrim.className = opts.passiveScrim ? 'scrim scrim--passive' : 'scrim';
  if (opts.dismissable !== false) {
    scrim.addEventListener('click', () => opts.onDismiss?.());
  }

  const sheet = document.createElement('div');
  sheet.className = opts.variant ? `sheet sheet--${opts.variant}` : 'sheet';

  const grip = document.createElement('div');
  grip.className = 'sheet__grip';
  sheet.append(grip);

  const title = document.createElement('h2');
  title.className = 'sheet__title';
  title.textContent = opts.title;
  sheet.append(title);

  if (opts.subtitle) {
    const sub = document.createElement('p');
    sub.className = 'sheet__sub';
    sub.textContent = opts.subtitle;
    sheet.append(sub);
  }

  if (opts.body) sheet.append(opts.body);

  for (const action of opts.actions ?? []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = action.primary ? 'btn btn--primary' : 'btn';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onSelect);
    sheet.append(btn);
  }

  if (opts.note) {
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = opts.note;
    sheet.append(note);
  }

  wrap.append(scrim, sheet);
  return wrap;
}

/**
 * Format a private reveal for display.
 *
 * ALWAYS phrased in the past tense, tagged to the viewer's own turn. What the
 * Mystieke Wolf saw at step 4 may have been moved by the Dorpsgek at step 8, so
 * rendering it as a present fact ("seat 3 is the Ziener") would actively
 * mislead in exactly the games where somebody did something interesting.
 */
export function describeReveal(
  lang: Lang,
  info: { kind: string; [k: string]: unknown },
  seatName: (seat: number) => string,
  roleName: (role: string) => string,
): string {
  switch (info.kind) {
    case 'saw-card':
      return t(lang, 'reveal.sawCard', {
        who: seatName(info.slot as number), role: roleName(info.role as string),
      });
    case 'saw-center':
      return t(lang, 'reveal.sawCenter', {
        role: roleName(info.role as string), n: (info.centerIndex as number) + 1,
      });
    case 'saw-wolves': {
      const seats = info.seats as number[];
      if (seats.length === 0) return t(lang, 'reveal.noWolves');
      return t(lang, 'reveal.sawWolves', { who: seats.map(seatName).join(', ') });
    }
    case 'saw-masons': {
      const seats = info.seats as number[];
      return seats.length === 0
        ? t(lang, 'reveal.noMasons')
        : t(lang, 'reveal.sawMasons', { who: seats.map(seatName).join(', ') });
    }
    case 'copied-role':
      return t(lang, 'reveal.copiedRole', {
        who: seatName(info.fromSeat as number), role: roleName(info.role as string),
      });
    case 'became-role':
      return t(lang, 'reveal.becameRole', { role: roleName(info.role as string) });
    case 'judged':
      return t(lang, 'reveal.judged');
    case 'card-locked':
      return t(lang, 'reveal.cardLocked');
    case 'own-final-card':
      return t(lang, 'reveal.ownFinal', { role: roleName(info.role as string) });
    case 'action-confirmed':
      return describeConfirmedAction(lang, info.action as ConfirmedAction | undefined, seatName);
    case 'action-blocked':
      return info.reason === 'shielded'
        ? t(lang, 'reveal.shielded')
        : t(lang, 'reveal.noLegalTarget');
    case 'no-action':
      return t(lang, 'reveal.nothing');
    default:
      return '';
  }
}

function describeConfirmedAction(
  lang: Lang,
  action: ConfirmedAction | undefined,
  seatName: (seat: number) => string,
): string {
  if (!action) return t(lang, 'reveal.completed');
  switch (action.kind) {
    case 'shielded':
      return t(lang, 'reveal.action.shielded', { who: seatName(action.seat) });
    case 'alpha-placed':
      return t(lang, 'reveal.action.alphaPlaced', { who: seatName(action.seat) });
    case 'judged':
      return t(lang, 'reveal.action.judged', { who: seatName(action.seat) });
    case 'heks-swapped':
      return t(lang, 'reveal.action.heksSwapped', {
        n: action.centerIndex + 1, who: seatName(action.seat),
      });
    case 'players-swapped':
      return t(lang, 'reveal.action.playersSwapped', {
        first: seatName(action.seats[0]), second: seatName(action.seats[1]),
      });
    case 'drank':
      return t(lang, 'reveal.action.drank', { n: action.centerIndex + 1 });
    case 'shifted':
      return t(lang, action.direction === 'left'
        ? 'reveal.action.shiftedLeft'
        : 'reveal.action.shiftedRight', { n: action.count });
    case 'took-looier':
      return t(lang, 'reveal.action.tookLooier', { who: seatName(action.seat) });
  }
}
