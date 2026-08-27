import { t, type Lang } from './i18n.js';

/**
 * Choosing which device runs the game (§ trust model).
 *
 * There is exactly one device per room that deals the cards and resolves the
 * night, and it necessarily holds every player's role — we are on the free
 * Spark plan, so there are no Cloud Functions and the resolution has to run in
 * a browser at the table. No security rule can change that; see README.
 *
 * What the group CAN choose is whose browser. That is a social decision, not a
 * technical one, so it belongs on screen in plain language rather than buried
 * in SETUP.md:
 *
 *   TABLE DEVICE   a spare tablet/laptop/phone runs the game and takes no
 *                  seat. Nobody at the table is holding everyone's cards.
 *   TRUSTED HOST   a player runs it from their own phone. No extra hardware,
 *                  but that player's phone can technically read every card.
 *
 * The wording below says that second part out loud. Softening it would be the
 * one genuinely dishonest thing this app could do — a group that picked the
 * convenient option without being told is a group that was misled, and they
 * find out when somebody wonders aloud how the host always guesses right.
 *
 * INTERNALLY none of this is new: the choice sets `CreateRoomOptions.playing`,
 * and the room's `refereeUid` is the creating device either way. It normally
 * stays there, while the deliberate recovery route is available only if that
 * device fails and the group accepts that its replacement can read every card.
 */

export type ControllerMode = 'table-device' | 'trusted-host';

export const CONTROLLER_MODES: ControllerMode[] = ['table-device', 'trusted-host'];

/**
 * Does the creating device take a seat?
 *
 * The single point where the player-facing choice becomes the technical one.
 * A table device must NOT be dealt a card: it can read them all, so dealing it
 * one would be dealing a card to the person who can see everybody's.
 */
export function controllerModeIsPlaying(mode: ControllerMode): boolean {
  return mode === 'trusted-host';
}

/** The inverse, for showing an existing room's mode back to the table. */
export function controllerModeFromPlaying(playing: boolean): ControllerMode {
  return playing ? 'trusted-host' : 'table-device';
}

export interface RoomSetupView {
  lang: Lang;
  /** Which card is currently chosen. The table device is the default. */
  mode: ControllerMode;
  onModeChange?: (mode: ControllerMode) => void;
  onCreate?: (mode: ControllerMode) => void;
  /** False while a name is still missing, or a create is already in flight. */
  canCreate?: boolean;
}

export function renderRoomSetup(view: RoomSetupView): HTMLElement {
  const { lang } = view;

  const el = document.createElement('div');
  el.className = 'setup';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(lang, 'setup.title');

  const sub = document.createElement('p');
  sub.className = 'sheet__sub';
  sub.textContent = t(lang, 'setup.sub');
  el.append(title, sub);

  const list = document.createElement('div');
  list.className = 'setup__modes';
  // A radiogroup rather than a pair of buttons: this is one choice with two
  // answers, and a screen reader should say so. Arrow keys move between them
  // because that is what a radiogroup does everywhere else.
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', t(lang, 'setup.title'));

  for (const mode of CONTROLLER_MODES) {
    list.append(renderModeCard(view, mode));
  }
  el.append(list);

  // Stated before the button, not after it. A consequence you read having
  // already committed is not a choice you were offered.
  const permanent = document.createElement('p');
  permanent.className = 'setup__permanent';
  permanent.textContent = t(lang, 'setup.permanent');
  el.append(permanent);

  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn btn--primary';
  create.textContent = t(lang, 'setup.create');
  create.disabled = view.canCreate === false;
  create.addEventListener('click', () => view.onCreate?.(view.mode));
  el.append(create);

  // Only under the table-device option: it is the one where somebody might
  // reasonably be about to create the room on the phone they meant to play on.
  if (view.mode === 'table-device') {
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = t(lang, 'setup.createOnThisDevice');
    el.append(note);
  }

  return el;
}

function renderModeCard(view: RoomSetupView, mode: ControllerMode): HTMLElement {
  const { lang } = view;
  const selected = view.mode === mode;
  const key = mode === 'table-device' ? 'setup.tableDevice' : 'setup.trustedHost';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'setup__mode';
  card.dataset.mode = mode;
  if (selected) card.classList.add('setup__mode--selected');
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', String(selected));
  // Only the chosen card is in the tab order, so tabbing past the group is one
  // stop rather than one per option — again, standard radiogroup behaviour.
  card.tabIndex = selected ? 0 : -1;

  const head = document.createElement('span');
  head.className = 'setup__mode-head';

  const name = document.createElement('span');
  name.className = 'setup__mode-name';
  name.textContent = t(lang, key);

  const badge = document.createElement('span');
  badge.className = 'setup__badge';
  if (mode === 'trusted-host') badge.classList.add('setup__badge--caution');
  badge.textContent = t(lang, `${key}.badge`);

  head.append(name, badge);

  const body = document.createElement('span');
  body.className = 'setup__mode-body';
  body.textContent = t(lang, `${key}.body`);

  card.append(head, body);
  card.addEventListener('click', () => view.onModeChange?.(mode));
  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft'
      && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = CONTROLLER_MODES.indexOf(mode);
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = CONTROLLER_MODES[
      (i + (forward ? 1 : CONTROLLER_MODES.length - 1)) % CONTROLLER_MODES.length
    ]!;
    view.onModeChange?.(next);
  });

  return card;
}
