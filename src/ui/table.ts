import { ROLES } from '../engine/roles.js';
import type { RoleId, SeatIndex } from '../engine/types.js';

/**
 * The seating circle — the app's home screen, night AND day.
 *
 * It is deliberately the same view in every phase (§5.4). Players land here as
 * soon as they have made their choice, or immediately if they have no action,
 * so tapping around the table is the resting state rather than a signal. Any
 * prompt is drawn as a sheet OVER this, never instead of it.
 *
 * Nothing rendered here may depend on the viewer's own role, except their own
 * seat marker. If a future change makes the table look different for the
 * Dubbelganger than for a Dorpeling, that difference is visible across the
 * table and the whole cover story collapses.
 */

export interface SeatView {
  seat: SeatIndex;
  name: string;
  /** Only set for a card genuinely revealed in play — the Medium's flip (§12). */
  revealedRole?: RoleId;
  /**
   * YOUR OWN private guess about this player (§9). Rendered deliberately
   * unlike a real reveal — a scratched note, not a card face — because
   * confusing your own hunch with a fact is the one way a memory aid can make
   * you play worse than having no notes at all.
   */
  suspectedRole?: RoleId;
  /** False once you have tapped it away. The guess is remembered either way. */
  suspicionVisible?: boolean;
  shielded?: boolean;
  isSelf?: boolean;
  selected?: boolean;
  disabled?: boolean;
}

export interface TableView {
  seats: SeatView[];
  centerCount: number;
  /** Whether the Alpha Wolf's extra wolf card is in play — public information. */
  hasAlphaWolfCard: boolean;
  /**
   * Tapping the CARD. During a night prompt this picks your target; otherwise
   * it is the suspicion gesture (§9).
   */
  onCardTap?: (seat: SeatIndex) => void;
  /**
   * Tapping the NAME. Always opens that player's history.
   *
   * Card and name are separate targets on purpose (Milan, 2026-08-26). Routing
   * both through one tap meant suspicion and stats were fighting over the same
   * gesture, and one of them had to become a second-class citizen. Splitting
   * them keeps stats one tap away — which matters, because tapping around the
   * table is the night phase's cover traffic (§5.4).
   */
  onNameTap?: (seat: SeatIndex) => void;
}

const NL = (role: RoleId) => ROLES[role]?.nl ?? role;

export function renderTable(view: TableView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'table';

  const ring = document.createElement('div');
  ring.className = 'table__ring';
  el.append(ring);

  const center = document.createElement('div');
  center.className = 'table__center';

  const row = document.createElement('div');
  row.className = 'table__center-row';
  for (let i = 0; i < view.centerCount; i++) {
    const c = document.createElement('div');
    c.className = 'centercard';
    row.append(c);
  }
  center.append(row);

  if (view.hasAlphaWolfCard) {
    const wolf = document.createElement('div');
    // Laid out sideways beneath the three, because it IS a different thing:
    // the Heks and Leerlingziener choose among the three only, never this one,
    // even after the Alpha Wolf has parked somebody's old card here. Sitting it
    // in the row would invite exactly the mistake the engine forbids.
    wolf.className = 'centercard centercard--wolf';
    wolf.title = 'Alfawolf-kaart';
    center.append(wolf);
  }
  el.append(center);

  const n = view.seats.length;
  view.seats.forEach((s, i) => {
    // Seat 0 at the bottom (where you sit), going clockwise — so the on-screen
    // circle matches the real table you're looking at (§13).
    const angle = Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = 50 + Math.cos(angle) * 39;
    const y = 50 + Math.sin(angle) * 39;

    const btn = document.createElement('div');
    btn.className = 'seat';
    if (s.isSelf) btn.classList.add('seat--self');
    if (s.selected) btn.classList.add('seat--selected');
    if (s.disabled) btn.classList.add('seat--disabled');
    btn.style.left = `${x}%`;
    btn.style.top = `${y}%`;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'seat__card';
    if (s.revealedRole) {
      card.classList.add('seat__card--revealed');
      const label = document.createElement('span');
      label.className = 'seat__role';
      label.textContent = NL(s.revealedRole);
      card.append(label);
    } else if (s.suspectedRole && s.suspicionVisible !== false) {
      // A guess never takes the bone face of a real reveal. Same dark card,
      // dashed edge, dimmed text — legible to you, obviously not a fact.
      card.classList.add('seat__card--suspected');
      const label = document.createElement('span');
      label.className = 'seat__role seat__role--guess';
      label.textContent = NL(s.suspectedRole);
      card.append(label);
    }
    if (s.shielded) {
      card.classList.add('seat__card--shielded');
      const badge = document.createElement('span');
      badge.className = 'seat__badge';
      badge.title = 'Beschermd door de Schildwacht';
      card.append(badge);
    }

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'seat__name';
    name.textContent = s.name;

    card.addEventListener('click', () => view.onCardTap?.(s.seat));
    name.addEventListener('click', () => view.onNameTap?.(s.seat));

    btn.append(card, name);
    el.append(btn);
  });

  return el;
}
