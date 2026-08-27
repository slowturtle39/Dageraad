import { t, type Lang } from './i18n.js';
import { sortedProfiles, type FriendProfile } from '../app/friend.js';
import type { AllTimeStanding } from '../stats/alltime.js';
import type { RoomMode } from '../app/backend.js';

/**
 * Who you are, whether tonight counts, and how the year has gone.
 *
 * Three small screens that share one idea: the group's history is only worth
 * having if it is honest about what is in it. So a practice evening says so
 * while it is being played rather than afterwards, and the all-time table is
 * visibly a different thing from tonight's scoreboard.
 */

/* ------------------------------ who are you ------------------------------ */

export interface FriendPickerView {
  lang: Lang;
  profiles: FriendProfile[];
  /** Whoever this browser used last, offered as the one-tap path. */
  rememberedId?: string | null;
  typed: string;
  busy?: boolean;
  onTyped?: (value: string) => void;
  onPick?: (profile: FriendProfile) => void;
  onCreate?: (displayName: string) => void;
}

export function renderFriendPicker(view: FriendPickerView): HTMLElement {
  const { lang } = view;
  const el = document.createElement('div');
  el.className = 'friends';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(lang, 'friend.title');

  const sub = document.createElement('p');
  sub.className = 'sheet__sub';
  // Says WHY it is being asked. "Who are you" with no reason reads as an
  // account signup, which is exactly what this is not.
  sub.textContent = t(lang, 'friend.sub');
  el.append(title, sub);

  const list = document.createElement('div');
  list.className = 'friends__list';

  // A LIST first, a text field second. Somebody typing their own name from
  // scratch every evening will eventually mistype it, and a mistyped name
  // with a fresh id is a silently forked history.
  for (const profile of sortedProfiles(view.profiles)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn friends__friend';
    b.dataset.friendId = profile.id;
    if (profile.id === view.rememberedId) b.classList.add('friends__friend--last');
    b.textContent = profile.id === view.rememberedId
      ? t(lang, 'friend.continueAs', { name: profile.displayName })
      : profile.displayName;
    b.addEventListener('click', () => view.onPick?.(profile));
    list.append(b);
  }
  el.append(list);

  const field = document.createElement('input');
  field.className = 'join__name';
  field.type = 'text';
  field.maxLength = 40;
  field.value = view.typed;
  field.placeholder = t(lang, 'friend.newName');
  field.setAttribute('aria-label', t(lang, 'friend.newName'));
  el.append(field);

  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn btn--primary';
  create.textContent = t(lang, 'friend.create');
  create.disabled = view.busy === true || view.typed.trim().length === 0;
  create.addEventListener('click', () => view.onCreate?.(view.typed.trim()));
  // Replacing the whole app on every key loses focus after the first letter.
  // Keep this field and its button in sync locally instead.
  field.addEventListener('input', () => {
    view.onTyped?.(field.value);
    create.disabled = view.busy === true || field.value.trim().length === 0;
  });
  el.append(create);

  return el;
}

/* --------------------------- does tonight count --------------------------- */

export interface ModePickerView {
  lang: Lang;
  mode: RoomMode;
  onModeChange?: (mode: RoomMode) => void;
}

export const ROOM_MODES: RoomMode[] = ['practice', 'official'];

/**
 * Practice first, and selected by default.
 *
 * Order is the recommendation, as on the table-device screen. The failure we
 * can afford is a real evening accidentally not counting; the one we cannot is
 * a test round in a record that has no delete path.
 */
export function renderModePicker(view: ModePickerView): HTMLElement {
  const { lang } = view;
  const el = document.createElement('div');
  el.className = 'setup__modes';
  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', t(lang, 'mode.pick'));

  for (const mode of ROOM_MODES) {
    const selected = view.mode === mode;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'setup__mode';
    card.dataset.roomMode = mode;
    if (selected) card.classList.add('setup__mode--selected');
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(selected));
    card.tabIndex = selected ? 0 : -1;

    const head = document.createElement('span');
    head.className = 'setup__mode-head';
    const name = document.createElement('span');
    name.className = 'setup__mode-name';
    name.textContent = t(lang, `mode.${mode}`);
    head.append(name);

    const body = document.createElement('span');
    body.className = 'setup__mode-body';
    body.textContent = t(lang, `mode.${mode}.explain`);

    card.append(head, body);
    card.addEventListener('click', () => view.onModeChange?.(mode));
    el.append(card);
  }
  return el;
}

/** The badge shown all evening on a room that will not count. */
export function renderPracticeBadge(lang: Lang): HTMLElement {
  const el = document.createElement('div');
  el.className = 'practicebadge';
  el.setAttribute('role', 'status');
  el.textContent = t(lang, 'mode.practice.badge');
  return el;
}

/* ------------------------------- the table ------------------------------- */

export interface AllTimeView {
  lang: Lang;
  rows: AllTimeStanding[];
  /** Highlighted, so you can find yourself without reading every line. */
  ownFriendId?: string | null;
  /**
   * Draw the heading here. False when the caller already supplies one — a
   * sheet does, and two identical titles stacked on a phone is just noise.
   */
  heading?: boolean;
}

export function renderAllTime(view: AllTimeView): HTMLElement {
  const { lang } = view;
  const el = document.createElement('div');
  el.className = 'alltime';

  if (view.heading !== false) {
    const title = document.createElement('h2');
    title.className = 'setup__title';
    title.textContent = t(lang, 'alltime.title');
    el.append(title);
  }

  if (view.rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sheet__sub';
    // An honest empty state. Before the first official evening this is the
    // correct thing to say, and it is not an error.
    empty.textContent = t(lang, 'alltime.empty');
    el.append(empty);
    return el;
  }

  for (const row of view.rows) {
    const line = document.createElement('div');
    line.className = 'alltime__row';
    line.dataset.friendId = row.friendId;
    if (row.friendId === view.ownFriendId) line.classList.add('alltime__row--own');

    const name = document.createElement('span');
    name.className = 'alltime__name';
    name.textContent = row.name;

    const points = document.createElement('span');
    points.className = 'alltime__points';
    points.textContent = String(row.points);

    const detail = document.createElement('span');
    detail.className = 'alltime__detail';
    const bits = [
      `${row.rounds} ${t(lang, 'alltime.rounds')}`,
      `${row.evenings} ${t(lang, 'alltime.evenings')}`,
      `${row.wins} ${t(lang, 'alltime.wins')}`,
    ];
    // Only mentioned when it happened. A column of zeroes says nothing.
    if (row.soloWins > 0) bits.push(`${row.soloWins} ${t(lang, 'alltime.solo')}`);
    detail.textContent = bits.join(' · ');

    line.append(name, points, detail);
    el.append(line);
  }
  return el;
}
