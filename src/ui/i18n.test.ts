import { describe, expect, it } from 'vitest';
import { ALL_KEYS, roleName, t } from './i18n.js';
import { ROLES } from '../engine/roles.js';
import type { RoleId } from '../engine/types.js';

describe('translations', () => {
  /**
   * Words that are genuinely the same in both languages.
   *
   * Named explicitly rather than allowed for by a threshold. A count-based
   * check passes for the wrong reason the moment somebody adds a fourth
   * untranslated string, and says nothing about which three were fine.
   */
  const SAME_IN_BOTH = new Set([
    'join.codePlaceholder',   // a room code, not a word
    'menu.title',             // "Menu" is Dutch too
    'alltime.solo',           // as is "solo"
    'lobby.botTag',           // "AI" reads the same in both
  ]);

  it('has an English string for every Dutch one', () => {
    const untranslated = ALL_KEYS.filter(
      (k) => t('en', k) === t('nl', k) && !SAME_IN_BOTH.has(k),
    );
    expect(untranslated).toEqual([]);
  });

  it('does not carry an excuse for a key that no longer coincides', () => {
    // Otherwise the allowlist quietly becomes a place to hide things.
    for (const key of SAME_IN_BOTH) {
      expect(t('en', key), `${key} is translated now`).toBe(t('nl', key));
    }
  });

  it('never leaves a key showing through', () => {
    for (const key of ALL_KEYS) {
      expect(t('nl', key)).not.toBe(key);
      expect(t('en', key)).not.toBe(key);
    }
  });

  it('fills placeholders', () => {
    expect(t('nl', 'stats.played', { n: 12 })).toBe('12 potjes gespeeld');
    expect(t('en', 'stats.played', { n: 12 })).toBe('12 games played');
  });

  it('leaves an unfilled placeholder visible rather than blank', () => {
    // A blank at the table reads as a bug in the game; a visible {n} reads as a
    // bug in the app, which is the one we want to be told about.
    expect(t('nl', 'stats.played')).toContain('{n}');
  });

  it('falls back to Dutch rather than to nothing', () => {
    expect(t('en', 'phase.night')).toBe('night');
    expect(t('nl', 'nonexistent.key')).toBe('nonexistent.key');
  });
});

describe('role names', () => {
  it('resolves every role in both languages', () => {
    for (const role of Object.keys(ROLES) as RoleId[]) {
      expect(roleName('nl', role)).toBeTruthy();
      expect(roleName('en', role)).toBeTruthy();
    }
  });

  it('actually differs where the languages differ', () => {
    expect(roleName('nl', 'weerwolf')).toBe('Weerwolf');
    expect(roleName('en', 'weerwolf')).toBe('Werewolf');
    expect(roleName('en', 'schoneslaapster')).toBe('Sleeping Beauty');
  });
});
