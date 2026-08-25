import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the one UI rule that is a privacy constraint rather than taste
 * (§13.1): the night table view and the day table view must look the SAME.
 *
 * The glow off somebody's face changes even if they never look at their screen.
 * A palette that shifts on a phase change announces the phase change; worse, a
 * screen that lights up during a follow-up window announces WHO is acting, and
 * the whole stats-on-tap cover story collapses with it.
 *
 * These are cheap greps rather than a rendering test on purpose — they run in
 * the normal suite and catch the regression at the moment somebody writes it,
 * which is the only time it is easy to fix.
 */

const css = readFileSync('src/ui/theme.css', 'utf8');
const ui = ['table.ts', 'sheet.ts', 'stats.ts']
  .map((f) => readFileSync(`src/ui/${f}`, 'utf8'))
  .join('\n');

describe('the palette does not move', () => {
  it('defines no phase-specific colour tokens', () => {
    // --bg-day / --night-accent / etc. If you need one, you have misread §13.1.
    const phaseTokens = css.match(/--[a-z-]*(day|night|nacht|dag)[a-z-]*\s*:/gi);
    expect(phaseTokens).toBeNull();
  });

  it('has no light mode and no colour-scheme switching', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/\[data-theme/);
    expect(css).not.toMatch(/\.light\b/);
  });

  it('never restyles the table by phase', () => {
    // A `.table--dag` or `.phase-night .seat` would be exactly the leak.
    expect(css).not.toMatch(/\.(table|seat|topbar)[^{]*--?(dag|nacht|day|night)/i);
  });

  it('does not set inline colours or backgrounds from TypeScript', () => {
    // Positions are set inline (the seating circle needs it); colour must not
    // be, or it escapes review by living outside the stylesheet.
    expect(ui).not.toMatch(/style\.(background|backgroundColor|color|filter|opacity)\s*=/);
  });
});

describe('the table stays the same for every viewer', () => {
  it('reveals a card face only when it was publicly revealed in play', () => {
    // §12: face-down by default; the sole exception is the Medium's flip. If
    // `seat__card--revealed` ever gets applied from anything other than
    // `revealedRole`, a player's own screen starts differing from everyone
    // else's and can be read across the table.
    const table = readFileSync('src/ui/table.ts', 'utf8');
    const revealSites = table.match(/seat__card--revealed/g) ?? [];
    expect(revealSites).toHaveLength(1);
    expect(table).toMatch(/if \(s\.revealedRole\)/);
  });

  it('marks selection with a border rather than brightness', () => {
    const block = css.slice(css.indexOf('.seat--selected'), css.indexOf('.seat--disabled'));
    expect(block).toMatch(/border-color/);
    expect(block).not.toMatch(/background|box-shadow|filter|opacity/);
  });
});
