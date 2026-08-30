import { describe, expect, it } from 'vitest';
import { APPLIERS } from './appliers.js';
import { DEPENDENCY_CONFIG, TWO_ROUND_CONFIG } from './presets.js';
import { resolveNight } from './resolve.js';
import { defaultNightOrder, ROLES } from './roles.js';
import { createNightState } from './state.js';
import type { Choice, DecisionRequest, GameConfig, RoleId, SeatIndex } from './types.js';

function answer(request: DecisionRequest): Choice {
  switch (request.prompt.kind) {
    case 'seat':
    case 'seat-or-center': {
      const excluded = request.prompt.exclude;
      const seat = [0, 1, 2].find((candidate) => !excluded.includes(candidate));
      return seat === undefined ? { kind: 'none' } : { kind: 'seat', seat: seat as SeatIndex };
    }
    case 'two-seats': {
      const excluded = request.prompt.exclude;
      const seats = [0, 1, 2]
        .filter((candidate) => !excluded.includes(candidate))
        .slice(0, 2) as SeatIndex[];
      return seats.length === 2 ? { kind: 'seats', seats } : { kind: 'none' };
    }
    case 'center':
      return {
        kind: 'center',
        centerIndices: Array.from({ length: request.prompt.count }, (_, index) => index),
      };
    case 'dorpsgek':
      return { kind: 'dorpsgek', direction: 'right' };
    case 'confirm':
      return { kind: 'bool', value: true };
  }
}

function play(role: RoleId, config: GameConfig) {
  const state = createNightState({
    seatCount: 3,
    seatRoles: [role, 'dorpeling', 'ziener'],
    centerRoles: ['looier', 'jager', 'weerwolf'],
    ...(role === 'alphawolf' ? { alphaWolfCardRole: 'weerwolf' as RoleId } : {}),
  });
  return resolveNight(state, defaultNightOrder([role]), config, answer);
}

describe('every implemented night role gives the player feedback', () => {
  for (const config of [TWO_ROUND_CONFIG, DEPENDENCY_CONFIG]) {
    for (const role of Object.keys(ROLES) as RoleId[]) {
      if (!ROLES[role].hasNightAction) continue;

      it(`${config.mode}: ${role}`, () => {
        expect(APPLIERS[role], `${role} claims a night action but has no applier`).toBeDefined();
        const result = play(role, config);
        expect(result.privateInfo[0]?.length, `${role} leaves its player with no result`).toBeGreaterThan(0);
      });
    }
  }
});
