import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROLES } from '../engine/roles.js';
import { hasArt, registerRoleImages } from './art.js';
import { DEFAULT_ACTIVE_ROLES } from '../engine/presets.js';
import type { RoleId } from '../engine/types.js';

const src = readFileSync('src/ui/art.ts', 'utf8');

describe('role emblems', () => {
  it('covers every role in the default set', () => {
    // These are the ones that appear on a card every single game.
    for (const role of DEFAULT_ACTIVE_ROLES) {
      expect(hasArt(role), `no emblem for ${role}`).toBe(true);
    }
  });

  it('covers the whole library', () => {
    const missing = (Object.keys(ROLES) as RoleId[]).filter((r) => !hasArt(r));
    expect(missing).toEqual([]);
  });

  it('uses currentColor only, so one file serves both card faces', () => {
    // A revealed card is bone with dark ink; a suspicion guess is dark with dim
    // gold. Baking a colour in would mean needing two assets per role.
    expect(src).not.toMatch(/fill="#|stroke="#|fill="rgb|stroke="rgb/);
    expect(src).toMatch(/stroke="currentColor"/);
  });

  it('registers drop-in images explicitly rather than probing for files', () => {
    // A missing file probed at runtime shows as a broken-image icon on
    // somebody's card mid-game. A placeholder is a much better failure.
    registerRoleImages(['heks']);
    expect(hasArt('heks')).toBe(true);
    registerRoleImages([]);
    expect(hasArt('heks')).toBe(true);   // falls back to its placeholder
  });

  it('says out loud that these are not the published artwork', () => {
    // Line-agnostic: the sentence wraps across a comment line.
    const prose = src.replace(/\s*\n\s*\*\s*/g, ' ');
    expect(prose).toMatch(/NOT the printed game's artwork/);
    expect(prose).toMatch(/not ours to copy/);
  });
});
