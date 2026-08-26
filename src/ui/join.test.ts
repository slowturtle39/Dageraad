// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { joinIsReady, renderDeparted, renderJoin, renderWaiting } from './join.js';
import { isValidRoomCode } from '../app/backend.js';
import { t } from './i18n.js';

/**
 * The screen where somebody types a code read aloud across a table, while
 * holding a beer. That is the actual design brief and these are its tests.
 */

const el = (over: Partial<Parameters<typeof renderJoin>[0]> = {}) =>
  renderJoin({ lang: 'nl', code: '', displayName: '', ...over });

const codeField = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('.join__code')!;
const button = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('.btn--primary')!;

function type(field: HTMLInputElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('typing a room code', () => {
  it('normalises as you type, so the field shows what will be sent', () => {
    // Someone who typed a lower-case o should watch it become an O, not find
    // out at the end that it was never allowed.
    let got = '';
    const root = el({ onCodeChange: (c) => { got = c; } });
    type(codeField(root), 'ab cde');
    expect(codeField(root).value).toBe('ABCDE');
    expect(got).toBe('ABCDE');
  });

  it('strips punctuation from a pasted code', () => {
    const root = el();
    type(codeField(root), 'abc-de');
    expect(codeField(root).value).toBe('ABCDE');
  });

  it('asks for a keyboard that does not fight the input', () => {
    // Autocorrect on a five-letter nonsense code is actively hostile.
    const field = codeField(el());
    expect(field.autocapitalize).toBe('characters');
    expect(field.autocomplete).toBe('off');
    expect(field.spellcheck).toBe(false);
    expect(field.maxLength).toBe(5);
  });
});

describe('when the join button means something', () => {
  it('needs a valid code AND a name', () => {
    expect(joinIsReady('ABCDE', 'Milan')).toBe(true);
    expect(joinIsReady('ABCDE', '')).toBe(false);
    expect(joinIsReady('ABCDE', '   ')).toBe(false);
    expect(joinIsReady('ABC', 'Milan')).toBe(false);
  });

  it('rejects the letters the alphabet deliberately excludes', () => {
    // 0/O/1/I/L are not in the alphabet precisely because they are misheard
    // and misread — the code is spoken across a table.
    expect(isValidRoomCode('ABCDO')).toBe(false);
    expect(isValidRoomCode('ABCD0')).toBe(false);
    expect(isValidRoomCode('ABCDL')).toBe(false);
  });

  it('is disabled until both are there, and while the join is in flight', () => {
    expect(button(el()).disabled).toBe(true);
    expect(button(el({ code: 'ABCDE', displayName: 'Milan' })).disabled).toBe(false);
    expect(button(el({ code: 'ABCDE', displayName: 'Milan', busy: true })).disabled)
      .toBe(true);
  });

  it('hands back a trimmed name and a normalised code', () => {
    let seen: [string, string] | null = null;
    const root = el({
      code: 'abcde', displayName: '  Milan ',
      onJoin: (c, n) => { seen = [c, n]; },
    });
    button(root).click();
    expect(seen).toEqual(['ABCDE', 'Milan']);
  });
});

describe('when it goes wrong', () => {
  it('announces the error rather than only colouring it', () => {
    // A message conveyed only by colour is a message some people never get.
    const root = el({ error: t('nl', 'join.noSuchRoom') });
    const err = root.querySelector('.join__error')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toMatch(/code/i);
  });

  it('says plainly why the table device cannot play', () => {
    for (const lang of ['nl', 'en'] as const) {
      const msg = t(lang, 'join.refereeCannotPlay').toLowerCase();
      expect(msg).toMatch(lang === 'nl' ? /alle kaarten/ : /every card/);
    }
  });
});

describe('waiting for the next round', () => {
  it('names the round rather than counting down a time', () => {
    // A countdown would be a lie: a round ends when the table stops arguing.
    const root = renderWaiting({ lang: 'nl', joinsAtRound: 4 });
    expect(root.textContent).toContain('4');
    expect(root.textContent).not.toMatch(/\d+:\d\d/);
  });

  it('says why, so it does not read as the app having failed', () => {
    const root = renderWaiting({ lang: 'nl', joinsAtRound: 2 });
    expect(root.textContent).toMatch(/kaarten liggen al/);
  });

  it('still lets somebody leave while waiting', () => {
    let left = false;
    const root = renderWaiting({ lang: 'nl', joinsAtRound: 2, onLeave: () => { left = true; } });
    root.querySelector<HTMLButtonElement>('.btn')!.click();
    expect(left).toBe(true);
  });
});

describe('after going home', () => {
  it('promises the finished rounds still count', () => {
    const root = renderDeparted({ lang: 'nl' });
    expect(root.textContent).toMatch(/tellen gewoon mee/);
  });

  it('offers the way back, because leaving is not a punishment', () => {
    let back = false;
    const root = renderDeparted({ lang: 'nl', onRejoin: () => { back = true; } });
    root.querySelector<HTMLButtonElement>('.btn--primary')!.click();
    expect(back).toBe(true);
  });
});
