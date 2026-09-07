import { describe, expect, it } from 'vitest';
import { DEPENDENCY_CONFIG } from './presets.js';
import { resolveNight } from './resolve.js';
import { defaultNightOrder } from './roles.js';
import { createNightState } from './state.js';
import type { Choice, RoleId } from './types.js';

const none: Choice = { kind: 'none' };

describe('private night information stays with the player it belongs to', () => {
  it('gives the Leerlingziener only the selected centre card', () => {
    const roles: RoleId[] = ['leerlingziener', 'medium'];
    const state = createNightState({
      seatCount: 2,
      seatRoles: roles,
      centerRoles: ['dorpeling', 'jager', 'looier'],
    });
    const result = resolveNight(
      state,
      defaultNightOrder(roles),
      DEPENDENCY_CONFIG,
      (request) => request.key === 'apprentice-center'
        ? { kind: 'center', centerIndices: [1] }
        : none,
    );

    expect(result.privateInfo[0]).toEqual([
      expect.objectContaining({
        kind: 'saw-center',
        centerIndex: 1,
        role: 'jager',
      }),
    ]);
    expect(result.privateInfo[0]?.some((info) =>
      info.kind === 'saw-card' || info.kind === 'own-final-card')).toBe(false);
  });

  it('never tells the Looier which Medium inspected their card', () => {
    const roles: RoleId[] = ['looier', 'medium'];
    const state = createNightState({
      seatCount: 2,
      seatRoles: roles,
      centerRoles: ['dorpeling', 'jager', 'ziener'],
    });
    const result = resolveNight(
      state,
      defaultNightOrder(roles),
      DEPENDENCY_CONFIG,
      (request) => request.key === 'medium-target'
        ? { kind: 'seat', seat: 0 }
        : none,
    );

    expect(result.privateInfo[0]).toEqual([]);
    expect(result.privateInfo[1]).toEqual([
      expect.objectContaining({ kind: 'saw-card', slot: 0, role: 'looier' }),
      expect.objectContaining({
        kind: 'action-confirmed',
        action: { kind: 'took-looier', seat: 0 },
      }),
    ]);
    // The Looier exception is not flipped for the whole table either.
    expect(result.events).toEqual([]);
  });
});
