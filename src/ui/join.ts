import { isValidRoomCode, normaliseRoomCode } from '../app/backend.js';
import { t, type Lang } from './i18n.js';

/**
 * Entering a room code, and your name.
 *
 * The code is read aloud across a table and typed by somebody holding a beer,
 * which is the entire design brief. Its alphabet already excludes 0/O/1/I/L
 * (see backend.ts); this screen does the rest of the work — it normalises as
 * you type, so lower case, stray spaces and a pasted "room ABC-DE" all land on
 * the same five characters, and it never rejects input for being the wrong
 * shape while you are still in the middle of typing it.
 */

export interface JoinView {
  lang: Lang;
  code: string;
  displayName: string;
  /** Set when a join was attempted and refused, e.g. no such room. */
  error?: string | null;
  /** True while the join is in flight. */
  busy?: boolean;
  onCodeChange?: (code: string) => void;
  onNameChange?: (name: string) => void;
  onJoin?: (code: string, displayName: string) => void;
  onBack?: () => void;
}

/** Everything a join needs before the button means anything. */
export function joinIsReady(code: string, displayName: string): boolean {
  return isValidRoomCode(code) && displayName.trim().length > 0;
}

export function renderJoin(view: JoinView): HTMLElement {
  const { lang } = view;
  const el = document.createElement('div');
  el.className = 'join';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(lang, 'join.title');
  el.append(title);

  const instructions = document.createElement('p');
  instructions.className = 'sheet__sub';
  instructions.textContent = t(lang, 'join.instructions');
  el.append(instructions);

  const codeField = document.createElement('input');
  codeField.className = 'join__code';
  codeField.type = 'text';
  codeField.value = view.code;
  codeField.maxLength = 5;
  codeField.placeholder = t(lang, 'join.codePlaceholder');
  codeField.setAttribute('aria-label', t(lang, 'join.code'));
  // A code is five characters from a fixed alphabet — nothing about it wants a
  // keyboard that autocapitalises, autocorrects or offers a previous address.
  codeField.autocapitalize = 'characters';
  codeField.autocomplete = 'off';
  codeField.spellcheck = false;
  codeField.addEventListener('input', () => {
    // Normalise on the way in rather than on submit, so the field always shows
    // exactly what will be sent. Someone who typed a lower-case o should see
    // it become an O, not discover at the end that it was never allowed.
    const cleaned = normaliseRoomCode(codeField.value);
    codeField.value = cleaned;
    view.onCodeChange?.(cleaned);
  });
  el.append(codeField);

  const nameField = document.createElement('input');
  nameField.className = 'join__name';
  nameField.type = 'text';
  nameField.value = view.displayName;
  nameField.maxLength = 24;
  nameField.placeholder = t(lang, 'join.namePlaceholder');
  nameField.setAttribute('aria-label', t(lang, 'join.name'));
  nameField.addEventListener('input', () => view.onNameChange?.(nameField.value));
  el.append(nameField);

  if (view.error) {
    const err = document.createElement('p');
    err.className = 'join__error';
    // Announced, not just coloured: a message only conveyed by colour is a
    // message some people never receive.
    err.setAttribute('role', 'alert');
    err.textContent = view.error;
    el.append(err);
  }

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn--primary';
  go.textContent = view.busy ? t(lang, 'join.joining') : t(lang, 'join.join');
  go.disabled = view.busy === true || !joinIsReady(view.code, view.displayName);
  go.addEventListener('click', () =>
    view.onJoin?.(normaliseRoomCode(view.code), view.displayName.trim()));
  el.append(go);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn';
  back.textContent = t(lang, 'join.back');
  back.addEventListener('click', () => view.onBack?.());
  el.append(back);

  return el;
}

export interface WaitingView {
  lang: Lang;
  /** The round they will actually be dealt into. */
  joinsAtRound: number;
  onLeave?: () => void;
}

/**
 * You are here, but not in the round being played.
 *
 * Deliberately names a ROUND rather than counting down a time. A countdown
 * would be a lie: a round ends when the table stops arguing, and the app does
 * not know when that is. It also says why, because "waiting" with no reason
 * reads as the app having failed rather than as the rule it is.
 */
export function renderWaiting(view: WaitingView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'waiting';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(view.lang, 'waiting.title', { n: view.joinsAtRound });
  el.append(title);

  const why = document.createElement('p');
  why.className = 'sheet__sub';
  why.textContent = t(view.lang, 'waiting.why');
  el.append(why);

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'btn';
  leave.textContent = t(view.lang, 'waiting.leave');
  leave.addEventListener('click', () => view.onLeave?.());
  el.append(leave);

  return el;
}

export interface DepartedView {
  lang: Lang;
  onRejoin?: () => void;
}

/**
 * You went home, and the evening carried on without you — which is the point.
 *
 * Rejoining is offered because leaving is not meant to be a punishment, and
 * because coming back re-uses the original joinedAtRound and therefore the
 * original seed: stepping out for a round is not a way to top your score up
 * off the bottom of the table.
 */
export function renderDeparted(view: DepartedView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'departed';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(view.lang, 'departed.title');
  el.append(title);

  const note = document.createElement('p');
  note.className = 'sheet__sub';
  note.textContent = t(view.lang, 'departed.kept');
  el.append(note);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn--primary';
  back.textContent = t(view.lang, 'departed.rejoin');
  back.addEventListener('click', () => view.onRejoin?.());
  el.append(back);

  return el;
}
