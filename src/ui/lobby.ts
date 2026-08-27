import type { SeatIndex } from '../engine/types.js';
import { t, type Lang } from './i18n.js';

/**
 * Seating arrangement (§13).
 *
 * This is FUNCTIONALLY REQUIRED, not decoration: the Dorpsgek shifts every
 * card one seat left or right, which is meaningless without a real, agreed
 * adjacency. If the on-screen ring doesn't match where people are actually
 * sitting, that role stops making sense at the table.
 *
 * Interaction is tap-A-then-tap-B to swap two seats, rather than drag. Dragging
 * a small target around a circle on a phone, at a table, with eight people
 * waiting, is exactly the kind of fiddly the concept doc worried about (§15).
 * Two taps is unambiguous, works with cold fingers, and is trivially undoable.
 */

export interface LobbyPlayer {
  uid: string;
  displayName: string;
  seatIndex: SeatIndex;
}

export interface LobbyView {
  lang: Lang;
  players: LobbyPlayer[];
  /** Everyone present may agree and arrange the physical order before a deal. */
  canArrange: boolean;
  /** First tap of a pending swap, if any. */
  pendingSwap: SeatIndex | null;
  onSeatTap?: (seat: SeatIndex) => void;
  onStart?: () => void;
  canStart: boolean;
}

export function renderLobby(view: LobbyView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lobby';

  const hint = document.createElement('p');
  hint.className = 'sheet__sub';
  hint.textContent = view.canArrange
    ? view.pendingSwap === null
      ? t(view.lang, 'lobby.arrange')
      : t(view.lang, 'lobby.swap')
    : t(view.lang, 'lobby.locked');
  el.append(hint);

  const ring = document.createElement('div');
  ring.className = 'table';

  const ringLine = document.createElement('div');
  ringLine.className = 'table__ring';
  ring.append(ringLine);

  const seated = [...view.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const n = Math.max(seated.length, 1);

  seated.forEach((p, i) => {
    const angle = Math.PI / 2 + (i / n) * Math.PI * 2;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seat';
    if (view.pendingSwap === p.seatIndex) btn.classList.add('seat--selected');
    if (!view.canArrange) btn.classList.add('seat--disabled');
    btn.style.left = `${50 + Math.cos(angle) * 39}%`;
    btn.style.top = `${50 + Math.sin(angle) * 39}%`;

    const card = document.createElement('div');
    card.className = 'seat__card';
    const num = document.createElement('span');
    num.className = 'seat__role';
    num.textContent = String(i + 1);
    card.append(num);

    const name = document.createElement('span');
    name.className = 'seat__name';
    name.textContent = p.displayName;

    btn.append(card, name);
    btn.addEventListener('click', () => view.onSeatTap?.(p.seatIndex));
    ring.append(btn);
  });

  el.append(ring);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn btn--primary';
  start.textContent = t(view.lang, 'lobby.start', { n: seated.length });
  start.disabled = !view.canStart;
  start.addEventListener('click', () => view.onStart?.());
  el.append(start);

  const note = document.createElement('p');
  note.className = 'sheet__note';
  note.textContent = t(view.lang, 'lobby.adjacency');
  el.append(note);

  return el;
}

/** Swap two players' seats. Pure, so the caller can undo by calling it again. */
export function swapSeats(
  players: LobbyPlayer[],
  a: SeatIndex,
  b: SeatIndex,
): LobbyPlayer[] {
  return players.map((p) => {
    if (p.seatIndex === a) return { ...p, seatIndex: b };
    if (p.seatIndex === b) return { ...p, seatIndex: a };
    return p;
  });
}

/**
 * Seat numbers must be a contiguous 0..n-1 with no gaps or duplicates, or the
 * Dorpsgek's rotation has holes in it. Called before the game can start.
 */
export function seatingIsValid(players: LobbyPlayer[]): boolean {
  const seats = players.map((p) => p.seatIndex).sort((x, y) => x - y);
  return seats.every((s, i) => s === i);
}
