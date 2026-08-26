import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The written rules and the code must not drift apart again.
 *
 * They did. The Bodyguard stopped being a passive trap that voided a lynch and
 * became a player who shields somebody every vote; the Medium's Looier swap
 * stopped being optional and became forced. Both were ruled on 2026-08-26 and
 * both were implemented — and the README table and the status PDF went on
 * describing the old game for weeks afterwards.
 *
 * That is worse than a stale comment. The PDF is the document you hand
 * somebody at a table, so a wrong row in it teaches a group to play a rule
 * this app does not implement, and they find out mid-argument.
 *
 * These are greps rather than a rendering test, deliberately: they run in the
 * ordinary suite and fail at the moment somebody reintroduces the old wording,
 * which is the only time it is cheap to fix.
 */

const readme = readFileSync('README.md', 'utf8');
const pdf = readFileSync('tools/build_status_pdf.py', 'utf8');
const dayphase = readFileSync('src/engine/dayphase.ts', 'utf8');
const i18nSrc = readFileSync('src/ui/i18n.ts', 'utf8');

describe('the Bodyguard shields, and the documents say so', () => {
  it('no document still claims the vote is void when he is the top target', () => {
    // The superseded rule. If either of these matches, somebody is being told
    // to play a game this engine does not run.
    expect(readme).not.toMatch(/top vote target the vote is voided/i);
    expect(pdf).not.toMatch(/meeste stemmen, dan vervalt de stemming/i);
  });

  it('both documents describe the shield instead', () => {
    expect(readme).toMatch(/Shields instead of voting/i);
    expect(pdf).toMatch(/beschermt/i);
  });

  it('both say he may not shield himself, which is what keeps him killable', () => {
    expect(readme).toMatch(/may not shield himself/i);
    expect(pdf).toMatch(/Zichzelf beschermen mag niet/i);
  });

  it('both say he cancels ballots and not the Jaeger\'s shot', () => {
    // The distinction somebody will ask about at the table within one evening.
    expect(readme).toMatch(/ballots, not bullets/i);
    expect(pdf).toMatch(/geen kogels/i);
  });

  it('the translation for the old rule is gone, not merely unused', () => {
    // Nothing can trigger it any more. Leaving it is an invitation to wire it
    // back up to something.
    expect(i18nSrc).not.toMatch(/bodyguardVoid/);
  });

  it('the engine really does implement the shield', () => {
    // So these tests cannot pass by documenting a rule nobody coded.
    expect(dayphase).toMatch(/bodyguard/i);
    expect(dayphase).toMatch(/caused-village-loss/);
  });
});

describe('the Medium is forced, and the documents say so', () => {
  it('no document still calls the Looier swap optional', () => {
    expect(pdf).not.toMatch(/Mag ruilen met de Looier/i);
    expect(readme).not.toMatch(/May swap with the Looier/i);
  });

  it('both say it is forced', () => {
    expect(readme).toMatch(/\*\*forces\*\* the swap|forces the swap/i);
    expect(pdf).toMatch(/moet<\/b> ze die nemen|moet ze die nemen/i);
  });

  it('both explain why the Looier is not flipped face-up', () => {
    // The load-bearing half: a publicly revealed Looier is one nobody will
    // ever lynch, which turns the forced swap into a guaranteed loss.
    expect(readme).toMatch(/nobody will ever lynch/i);
    expect(pdf).toMatch(/niemand lyncht/i);
  });
});

describe('the Heks pre-commit is described as a mode-2 thing', () => {
  it('both documents say the rule branches three ways', () => {
    expect(readme).toMatch(/Wolf \/ Looier \/ village/);
    expect(pdf).toMatch(/Wolf, Looier, dorp/);
  });

  it('both say the Looier needs its own branch, and why', () => {
    expect(readme).toMatch(/silently arm/i);
    expect(pdf).toMatch(/ongemerkt bij/i);
  });

  it('neither implies she pre-commits in mode 1', () => {
    // Mode 1 is the one where everybody acts live and waits for each other.
    expect(readme).toMatch(/mode 1 she simply chooses live/i);
    expect(pdf).toMatch(/modus 1 kiest ze gewoon live/i);
  });
});
