import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const raw = readFileSync('src/ui/table.ts', 'utf8');
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('card and name are separate tap targets (Milan, 2026-08-26)', () => {
  it('wires the card and the name to different handlers', () => {
    // Routing both through one tap meant suspicion and stats were fighting over
    // the same gesture and one had to become second-class.
    expect(src).toMatch(/card\.addEventListener\('click', \(\) => view\.onCardTap/);
    expect(src).toMatch(/name\.addEventListener\('click', \(\) => view\.onNameTap/);
  });

  it('makes both of them real buttons, not a div with a listener', () => {
    expect(src).toMatch(/const card = document\.createElement\('button'\)/);
    expect(src).toMatch(/const name = document\.createElement\('button'\)/);
  });

  it('leaves no whole-seat click handler behind', () => {
    // A container-level handler would swallow one of the two.
    expect(src).not.toMatch(/onSeatTap/);
    expect(src).not.toMatch(/btn\.addEventListener/);
  });
});

describe('the name is a usable target, not a strip of text', () => {
  const css = readFileSync('src/ui/theme.css', 'utf8');
  it('has padding of its own', () => {
    const block = css.slice(css.indexOf('.seat__name {'));
    expect(block.slice(0, block.indexOf('}'))).toMatch(/padding:/);
  });
});
