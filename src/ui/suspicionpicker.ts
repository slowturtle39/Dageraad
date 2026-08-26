import { roleName, t, type Lang } from './i18n.js';
import type { RoleId, SeatIndex } from '../engine/types.js';

/**
 * The suspicion picker (§9).
 *
 * WHERE THE TAP GOES. Tapping a seat already opens that player's history, and
 * that tap is the night phase's cover traffic (§5.4) — if tapping stopped
 * opening a sheet, the thing that makes everyone look busy would go with it. So
 * the picker lives INSIDE the sheet rather than taking the tap for itself:
 *
 *   - tap a seat                  -> sheet: their history, with the picker on top
 *   - tap a card showing a guess  -> hides it immediately, no sheet
 *   - tap a hidden guess          -> sheet again, where it can be re-shown
 *
 * The one asymmetry is deliberate. Hiding is a single tap because it is the
 * gesture you want when somebody leans over your shoulder; un-hiding costs a
 * sheet because nobody is ever in a hurry to reveal their own notes.
 *
 * ONLY ROLES IN THIS GAME ARE OFFERED. The active role list is public, so
 * showing it leaks nothing — and offering roles that aren't in the deck would
 * make the tracker actively misleading.
 */

export interface SuspicionPickerView {
  lang: Lang;
  about: SeatIndex;
  aboutName: string;
  /** Public: the host's chosen role list for this game. */
  rolesInGame: RoleId[];
  current: RoleId | null;
  visible: boolean;
  onPick: (role: RoleId | null) => void;
  onToggleVisible: (visible: boolean) => void;
}

export function renderSuspicionPicker(view: SuspicionPickerView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'suspicion';

  const label = document.createElement('p');
  label.className = 'sheet__sub';
  label.textContent = view.current
    ? `Je denkt dat ${view.aboutName} de ${roleName(view.lang, view.current)} is.`
    : `Wat denk je dat ${view.aboutName} is?`;
  el.append(label);

  const grid = document.createElement('div');
  grid.className = 'suspicion__grid';

  // De-duplicated: a deck with two Dorpelingen should offer "Dorpeling" once.
  const unique = [...new Set(view.rolesInGame)];
  for (const role of unique) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className =
      role === view.current ? 'suspicion__chip suspicion__chip--on' : 'suspicion__chip';
    chip.textContent = roleName(view.lang, role);
    chip.addEventListener('click', () =>
      view.onPick(role === view.current ? null : role),
    );
    grid.append(chip);
  }
  el.append(grid);

  if (view.current) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn';
    toggle.textContent = view.visible
      ? 'Verberg op tafel (blijft onthouden)'
      : 'Laat weer zien op tafel';
    toggle.addEventListener('click', () => view.onToggleVisible(!view.visible));
    el.append(toggle);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn--ghost';
    clear.textContent = 'Wis verdenking';
    clear.addEventListener('click', () => view.onPick(null));
    el.append(clear);
  }

  const note = document.createElement('p');
  note.className = 'sheet__note';
  note.textContent =
    'Alleen jij ziet dit. Het is een geheugensteun — het verandert niets aan ' +
    'het spel.';
  el.append(note);

  return el;
}

/** Suspicions held on this device, keyed by the seat they are about. */
export type SuspicionMap = Map<SeatIndex, { role: RoleId; visible: boolean }>;

const STORAGE_PREFIX = 'dageraad.suspicions.';

/**
 * Suspicions live on the device, not in Firestore.
 *
 * They are a private memory aid that changes nothing about resolution, so
 * syncing them would add a document per player per game whose only purpose is
 * to be a thing that could leak. Losing them costs a memory aid, which is why
 * `localStorage` is acceptable here and nowhere else in the app.
 */
export function loadSuspicions(roomId: string): SuspicionMap {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + roomId);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as [number, { role: RoleId; visible: boolean }][];
    return new Map(parsed);
  } catch {
    return new Map();
  }
}

export function saveSuspicions(roomId: string, suspicions: SuspicionMap): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify([...suspicions]));
  } catch {
    // Private browsing or blocked storage. A lost memory aid is survivable.
  }
}

/** Convert to the engine's scoring shape (§9). */
export function toScorable(
  by: SeatIndex,
  suspicions: SuspicionMap,
): { by: SeatIndex; about: SeatIndex; role: RoleId }[] {
  return [...suspicions].map(([about, s]) => ({ by, about, role: s.role }));
}
