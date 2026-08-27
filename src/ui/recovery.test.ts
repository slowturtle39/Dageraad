// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  RECOVERY_PHRASE, recoveryPhraseAccepted, renderRecovery,
} from './recovery.js';
import { t } from './i18n.js';

/**
 * The takeover dialog.
 *
 * The group approved a trusted takeover by any active member. The phrase is
 * conscious friction, NOT a secret — it is in the source and printed on this
 * very screen. So the tests here are not about security. They are about the
 * two things this dialog genuinely owes the person using it: that they cannot
 * do it by accident, and that they were told what it costs before they did.
 */

const el = (over: Partial<Parameters<typeof renderRecovery>[0]> = {}) =>
  renderRecovery({ lang: 'nl', typed: '', ...over });

const confirm = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('.btn--danger')!;

describe('you cannot do it by accident', () => {
  it('keeps the button dead until the word is exact', () => {
    expect(confirm(el()).disabled).toBe(true);
    expect(confirm(el({ typed: 'ref' })).disabled).toBe(true);
    expect(confirm(el({ typed: 'referee' })).disabled).toBe(false);
  });

  it('accepts surrounding whitespace but not a different word', () => {
    // Somebody typing on a phone gets a trailing space for free; somebody
    // typing REFEREE meant something slightly different and can retype it.
    expect(recoveryPhraseAccepted('  referee  ')).toBe(true);
    expect(recoveryPhraseAccepted('REFEREE')).toBe(false);
    expect(recoveryPhraseAccepted('scheidsrechter')).toBe(false);
    expect(recoveryPhraseAccepted('')).toBe(false);
  });

  it('stays dead while a takeover is already in flight', () => {
    expect(confirm(el({ typed: 'referee', busy: true })).disabled).toBe(true);
  });

  it('offers a way out that is not the dangerous button', () => {
    let cancelled = false;
    const root = el({ onCancel: () => { cancelled = true; } });
    root.querySelectorAll<HTMLButtonElement>('.btn')[1]!.click();
    expect(cancelled).toBe(true);
  });

  it('fires the takeover only on the confirm button', () => {
    let confirmed = 0;
    const root = el({ typed: 'referee', onConfirm: () => { confirmed += 1; } });
    confirm(root).click();
    expect(confirmed).toBe(1);
  });
});

describe('you were told what it costs, before you decided', () => {
  for (const lang of ['nl', 'en'] as const) {
    it(`says in ${lang} that this device will see every card`, () => {
      // Softening this would make the group's agreement stop being an
      // agreement. They said yes to a known cost, not to a menu item.
      const cost = t(lang, 'recover.cost').toLowerCase();
      expect(cost).toMatch(lang === 'nl' ? /alle kaarten/ : /every card/);
      expect(cost).toMatch(lang === 'nl' ? /ook die van jou/ : /including yours/);
    });

    it(`tells them in ${lang} that the table should know first`, () => {
      const cost = t(lang, 'recover.cost').toLowerCase();
      expect(cost).toMatch(lang === 'nl' ? /iedereen aan tafel/ : /everyone at the table/);
    });

    it(`says in ${lang} what it is for, so it is not used casually`, () => {
      const why = t(lang, 'recover.why').toLowerCase();
      expect(why).toMatch(lang === 'nl' ? /gestopt/ : /stopped/);
    });
  }

  it('puts the cost above the input, not under the button', () => {
    // Somebody who reads the consequence after typing has already decided.
    const root = el();
    const kids = Array.from(root.children);
    const cost = kids.findIndex((k) => k.classList.contains('recover__cost'));
    const label = kids.findIndex((k) => k.classList.contains('recover__label'));
    const button = kids.findIndex((k) => k.classList.contains('btn--danger'));
    expect(cost).toBeGreaterThan(-1);
    expect(cost).toBeLessThan(label);
    expect(label).toBeLessThan(button);
  });

  it('prints the required word rather than making them guess it', () => {
    // It is not a password. Hiding it would only make the friction annoying
    // instead of deliberate.
    expect(el().textContent).toContain(RECOVERY_PHRASE);
  });

  it('announces a failure rather than only colouring it', () => {
    const root = el({ typed: 'referee', error: t('nl', 'recover.failed') });
    expect(root.querySelector('.join__error')!.getAttribute('role')).toBe('alert');
  });
});
