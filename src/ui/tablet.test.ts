import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSpoilerFree, type TabletView } from './tablet.js';

const raw = readFileSync('src/ui/tablet.ts', 'utf8');

/**
 * Strip comments before grepping. The guards below look for forbidden CODE;
 * without this they trip over the prose explaining why it is forbidden, which
 * would teach the next person to delete the explanation rather than keep the
 * rule.
 */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const base: TabletView = {
  lang: 'nl',
  phase: 'night',
  activeRole: 'dubbelganger',
  roundLabel: 'ronde 2',
  timer: '0:12',
  paused: false,
  seats: [
    { seat: 0, displayName: 'Milan', shielded: false },
    { seat: 1, displayName: 'Sanne', shielded: true },
  ],
  centerCount: 3,
  hasAlphaWolfCard: true,
};

describe('the tablet stays spoiler-free (§12)', () => {
  it('accepts a view carrying only public fields', () => {
    expect(() => assertSpoilerFree(base)).not.toThrow();
  });

  it('rejects a seat that has picked up private state', () => {
    const leaky = {
      ...base,
      seats: [{ ...base.seats[0]!, currentRole: 'weerwolf' } as never],
    };
    expect(() => assertSpoilerFree(leaky)).toThrow(/non-public/);
  });

  it('has no concept of who has submitted or who is still to act', () => {
    // "Waiting for 1 player" during the Dubbelganger's window would identify
    // the Dubbelganger to the entire room — the exact leak the stats-on-tap
    // cover exists to prevent. There must be no field that could render it.
    expect(src).not.toMatch(/waiting|submitted|pending|remaining|stillToAct/i);
  });

  it('never renders a role except a publicly revealed card', () => {
    const roleRenders = src.match(/roleName\(/g) ?? [];
    // Once for the active window's role (public, from the public timeline) and
    // once for a face-up card. Any third site needs justifying.
    expect(roleRenders.length).toBeLessThanOrEqual(2);
  });

  it('has no access to originalRole, assumedRole or privateInfo', () => {
    expect(src).not.toMatch(/originalRole|assumedRole|privateInfo|cardRole/);
  });
});
