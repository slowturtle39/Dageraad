import { t, type Lang } from './i18n.js';

/**
 * Taking over the running of the game after the controlling device has died.
 *
 * WHAT THIS IS AND IS NOT. Milan's group trusts each other and decided that a
 * dead tablet must not end the evening, so any active member may take control
 * (approved 2026-08-26). The `referee` phrase is CONSCIOUS FRICTION, not a
 * secret: it is in the source, it is on this screen, and a player with
 * devtools can send the same write without ever opening this dialog. Nobody
 * should describe it as a security control, here or anywhere else.
 *
 * What it does buy is that nobody takes over by accident, and that the person
 * who does has been told, in words, that they are about to be able to see
 * everybody's cards. That second part is the reason this screen exists at all
 * — the same reason the room-creation screen says the quiet part out loud.
 */

export const RECOVERY_PHRASE = 'referee';

export interface RecoveryView {
  lang: Lang;
  typed: string;
  error?: string | null;
  busy?: boolean;
  onTyped?: (value: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}

/** Exact match, trimmed. Deliberately not case-insensitive: it is one word. */
export function recoveryPhraseAccepted(typed: string): boolean {
  return typed.trim() === RECOVERY_PHRASE;
}

export function renderRecovery(view: RecoveryView): HTMLElement {
  const { lang } = view;
  const el = document.createElement('div');
  el.className = 'recover';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(lang, 'recover.title');

  const why = document.createElement('p');
  why.className = 'sheet__sub';
  why.textContent = t(lang, 'recover.why');

  // The cost, stated BEFORE the input rather than under the button. Somebody
  // who reads it after typing has already decided.
  const cost = document.createElement('p');
  cost.className = 'recover__cost';
  cost.textContent = t(lang, 'recover.cost');

  el.append(title, why, cost);

  const label = document.createElement('label');
  label.className = 'recover__label';
  label.textContent = t(lang, 'recover.typeToConfirm', { word: RECOVERY_PHRASE });

  const field = document.createElement('input');
  field.className = 'recover__input';
  field.type = 'text';
  field.value = view.typed;
  field.autocapitalize = 'none';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.setAttribute('aria-label', t(lang, 'recover.typeToConfirm', { word: RECOVERY_PHRASE }));
  field.addEventListener('input', () => view.onTyped?.(field.value));
  label.append(field);
  el.append(label);

  if (view.error) {
    const err = document.createElement('p');
    err.className = 'join__error';
    err.setAttribute('role', 'alert');
    err.textContent = view.error;
    el.append(err);
  }

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn--danger';
  confirm.textContent = t(lang, 'recover.confirm');
  confirm.disabled = view.busy === true || !recoveryPhraseAccepted(view.typed);
  confirm.addEventListener('click', () => view.onConfirm?.());

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = t(lang, 'recover.cancel');
  cancel.addEventListener('click', () => view.onCancel?.());

  el.append(confirm, cancel);
  return el;
}
