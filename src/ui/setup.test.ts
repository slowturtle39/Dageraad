// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTROLLER_MODES, controllerModeFromPlaying, controllerModeIsPlaying,
  renderRoomSetup, type ControllerMode,
} from './setup.js';
import { t } from './i18n.js';

/**
 * The screen where a group decides whose browser holds everybody's cards.
 *
 * The tests that matter here are not about layout. They are about the two
 * things that would make this screen a lie: a table device being dealt a card,
 * and the honest warning going missing from the convenient option.
 */

function setup(over: Partial<Parameters<typeof renderRoomSetup>[0]> = {}) {
  return renderRoomSetup({ lang: 'nl', mode: 'table-device', ...over });
}

// Array.from rather than spread: the tsconfig's lib does not include
// dom.iterable, and a NodeList is not iterable without it.
const cards = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('.setup__mode'));

beforeEach(() => { document.body.innerHTML = ''; });

describe('which device runs the game', () => {
  it('offers exactly the two modes, table device first', () => {
    // Order is the recommendation. The safe option should not need hunting for.
    expect(CONTROLLER_MODES).toEqual(['table-device', 'trusted-host']);
    expect(cards(setup()).map((c) => c.dataset.mode))
      .toEqual(['table-device', 'trusted-host']);
  });

  it('defaults to the table device', () => {
    const el = setup();
    const first = cards(el)[0]!;
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(first.classList.contains('setup__mode--selected')).toBe(true);
  });

  it('reports the chosen mode back when the room is created', () => {
    let created: ControllerMode | null = null;
    const el = setup({ mode: 'trusted-host', onCreate: (m) => { created = m; } });
    el.querySelector<HTMLButtonElement>('.btn--primary')!.click();
    expect(created).toBe('trusted-host');
  });

  it('changes mode when a card is tapped', () => {
    let picked: ControllerMode | null = null;
    const el = setup({ onModeChange: (m) => { picked = m; } });
    cards(el)[1]!.click();
    expect(picked).toBe('trusted-host');
  });

  it('will not create while the caller says it cannot', () => {
    const el = setup({ canCreate: false });
    expect(el.querySelector<HTMLButtonElement>('.btn--primary')!.disabled).toBe(true);
  });
});

describe('the choice becomes the technical one exactly once', () => {
  it('never deals the table device a card', () => {
    // It can read every card in the game. Dealing it one would be dealing a
    // card to the person who can see everybody's — the whole reason the
    // referee/player split exists.
    expect(controllerModeIsPlaying('table-device')).toBe(false);
  });

  it('does seat a trusted host, who is playing like anyone else', () => {
    expect(controllerModeIsPlaying('trusted-host')).toBe(true);
  });

  it('round-trips, so an existing room can show its own mode back', () => {
    for (const mode of CONTROLLER_MODES) {
      expect(controllerModeFromPlaying(controllerModeIsPlaying(mode))).toBe(mode);
    }
  });
});

describe('the screen says the uncomfortable part out loud', () => {
  for (const lang of ['nl', 'en'] as const) {
    it(`admits in ${lang} that the host's phone can see every card`, () => {
      // Softening this is the one genuinely dishonest thing this app could do.
      // A group that picked the convenient option without being told was
      // misled, and they find out when somebody wonders aloud how the host
      // always guesses right.
      const body = t(lang, 'setup.trustedHost.body').toLowerCase();
      expect(body).toMatch(lang === 'nl' ? /technisch gezien/ : /technically/);
      expect(body).toMatch(lang === 'nl' ? /vertrouw/ : /trust/);
    });

    it(`explains in ${lang} why the table device takes no seat`, () => {
      const body = t(lang, 'setup.tableDevice.body').toLowerCase();
      expect(body).toMatch(lang === 'nl' ? /technisch gezien/ : /technically/);
      expect(body).toMatch(lang === 'nl' ? /speelt.*niet mee/ : /no seat/);
    });

    it(`explains in ${lang} that recovery is a conscious takeover`, () => {
      expect(t(lang, 'setup.permanent')).toMatch(/referee/);
    });
  }

  it('puts the permanence warning BEFORE the button, not after it', () => {
    // A consequence you read having already committed is not a choice you
    // were offered.
    const el = setup();
    const kids = Array.from(el.children);
    const warn = kids.findIndex((k) => k.classList.contains('setup__permanent'));
    const button = kids.findIndex((k) => k.classList.contains('btn--primary'));
    expect(warn).toBeGreaterThan(-1);
    expect(warn).toBeLessThan(button);
  });

  it('marks the trusted-host option as the one needing thought', () => {
    const el = setup();
    const badge = cards(el)[1]!.querySelector('.setup__badge')!;
    expect(badge.classList.contains('setup__badge--caution')).toBe(true);
    expect(cards(el)[0]!.querySelector('.setup__badge')!
      .classList.contains('setup__badge--caution')).toBe(false);
  });
});

describe('reachable without a mouse', () => {
  it('is one radiogroup, so it reads as one question with two answers', () => {
    const el = setup();
    expect(el.querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(cards(el).every((c) => c.getAttribute('role') === 'radio')).toBe(true);
  });

  it('keeps only the chosen card in the tab order', () => {
    const el = setup();
    expect(cards(el).map((c) => c.tabIndex)).toEqual([0, -1]);
  });

  it('moves between options with the arrow keys', () => {
    let picked: ControllerMode | null = null;
    const el = setup({ onModeChange: (m) => { picked = m; } });
    cards(el)[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(picked).toBe('trusted-host');
  });

  it('wraps around rather than dead-ending', () => {
    let picked: ControllerMode | null = null;
    const el = setup({ onModeChange: (m) => { picked = m; } });
    cards(el)[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(picked).toBe('trusted-host');
  });
});
