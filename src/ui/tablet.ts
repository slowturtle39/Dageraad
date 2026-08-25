import { roleName, t, type Lang } from './i18n.js';
import type { CardId, RoleId, SeatIndex } from '../engine/types.js';

/**
 * The neutral shared display (§12).
 *
 * A tablet in the middle of the table showing a spoiler-free game state
 * everyone can point at. It is also, in the free-plan trust model, the device
 * we want acting as referee — precisely because nobody is holding it.
 *
 * WHAT IT MAY SHOW: seating in real physical order, face-down cards, the phase,
 * timers, which role's window is currently open, and any card genuinely turned
 * face-up in play (the Medium's flip).
 *
 * WHAT IT MAY NEVER SHOW: anybody's role or current card, the Rechter's pick,
 * suspicion entries, who has submitted, or who is still to act. The last two
 * matter more than they look — "waiting for 1 player" during the Dubbelganger's
 * window would identify the Dubbelganger to the whole room, which is the exact
 * leak the stats-on-tap cover exists to prevent.
 */

export interface TabletSeat {
  seat: SeatIndex;
  displayName: string;
  shielded: boolean;
  /** Set only for a card publicly revealed in play. */
  revealedRole?: RoleId;
  /** Face-up card identity, so a revealed card follows a later swap. */
  revealedCard?: CardId;
}

export interface TabletView {
  lang: Lang;
  phase: 'lobby' | 'night' | 'day' | 'voting' | 'results';
  /** Which role's window is open. Public — it comes from the public timeline. */
  activeRole: RoleId | null;
  roundLabel: string | null;
  /** Remaining time in the current window/phase, already formatted. */
  timer: string | null;
  paused: boolean;
  seats: TabletSeat[];
  centerCount: number;
  hasAlphaWolfCard: boolean;
}

export function renderTablet(view: TabletView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tablet';

  const head = document.createElement('div');
  head.className = 'tablet__head';

  const phase = document.createElement('div');
  phase.className = 'tablet__phase';
  phase.textContent = t(view.lang, `phase.${view.phase}`);

  const sub = document.createElement('div');
  sub.className = 'tablet__sub';
  // The active role is safe to name: the role list and the timeline are both
  // public, so everyone already knows this window exists and how long it lasts.
  sub.textContent = view.paused
    ? t(view.lang, 'phase.paused')
    : [view.roundLabel, view.activeRole ? roleName(view.lang, view.activeRole) : null]
        .filter(Boolean)
        .join(' · ');

  const timer = document.createElement('div');
  timer.className = view.paused ? 'tablet__timer tablet__timer--paused' : 'tablet__timer';
  timer.textContent = view.timer ?? '';

  const left = document.createElement('div');
  left.append(phase, sub);
  head.append(left, timer);
  el.append(head);

  const ring = document.createElement('div');
  ring.className = 'table tablet__table';
  const ringLine = document.createElement('div');
  ringLine.className = 'table__ring';
  ring.append(ringLine);

  const center = document.createElement('div');
  center.className = 'table__center';
  for (let i = 0; i < view.centerCount; i++) {
    const c = document.createElement('div');
    c.className = 'centercard';
    center.append(c);
  }
  if (view.hasAlphaWolfCard) {
    const w = document.createElement('div');
    w.className = 'centercard centercard--wolf';
    center.append(w);
  }
  ring.append(center);

  const n = Math.max(view.seats.length, 1);
  view.seats.forEach((s, i) => {
    const angle = Math.PI / 2 + (i / n) * Math.PI * 2;
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = `${50 + Math.cos(angle) * 39}%`;
    seat.style.top = `${50 + Math.sin(angle) * 39}%`;

    const card = document.createElement('div');
    card.className = 'seat__card';
    if (s.revealedRole) {
      card.classList.add('seat__card--revealed');
      const label = document.createElement('span');
      label.className = 'seat__role';
      label.textContent = roleName(view.lang, s.revealedRole);
      card.append(label);
    }
    if (s.shielded) {
      card.classList.add('seat__card--shielded');
      const badge = document.createElement('span');
      badge.className = 'seat__badge';
      card.append(badge);
    }

    const name = document.createElement('span');
    name.className = 'seat__name';
    name.textContent = s.displayName;

    seat.append(card, name);
    ring.append(seat);
  });

  el.append(ring);
  return el;
}

/**
 * Guard used by the tablet's tests: nothing in a TabletView may carry private
 * state. Kept as a runtime check as well as a type, because the tempting bug is
 * to widen this interface later "just for a debug overlay".
 */
export function assertSpoilerFree(view: TabletView): void {
  for (const seat of view.seats) {
    const extras = Object.keys(seat).filter(
      (k) => !['seat', 'displayName', 'shielded', 'revealedRole', 'revealedCard'].includes(k),
    );
    if (extras.length > 0) {
      throw new Error(`tablet seat carries non-public fields: ${extras.join(', ')}`);
    }
  }
}
