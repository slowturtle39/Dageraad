import { describe, expect, it } from 'vitest';
import { resolveWithDefaultOrder } from './resolve.js';
import { createNightState } from './state.js';
import type {
  Choice, DecisionRequest, GameConfig, PrivateInfo, RoleId, SeatIndex,
} from './types.js';
import type { AnswerProvider } from './resolve.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * The Dorpsgek Alt's lock, and what the locked player is allowed to learn.
 *
 * Milan's ruling (2026-08-26): the locked player IS told, and told nothing
 * else. Not who locked it, and not whether the actor was the Dorpsgek Alt or a
 * Dubbelganger copying them — either would hand them a read on somebody's
 * role, which is the opposite of what a shift in the dark is for.
 */

const SEATS = 5;

function config(over: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, dorpsgekVariant: 'designate', precommitRoles: [], ...over };
}

function run(roles: RoleId[], answer: AnswerProvider) {
  const state = createNightState({
    seatCount: SEATS,
    seatRoles: roles,
    centerRoles: ['dorpeling', 'dorpeling', 'dorpeling'],
  });
  return resolveWithDefaultOrder(state, roles, config(), answer);
}

const ROLES_WITH_IDIOT: RoleId[] = [
  'dorpsgek', 'dorpeling', 'ziener', 'dorpeling', 'weerwolf',
];

/** Answer the Dorpsgek with a direction and a locked seat; decline everything else. */
const idiotLocks = (seat: SeatIndex): AnswerProvider =>
  (request: DecisionRequest): Choice => {
    if (request.prompt.kind === 'dorpsgek') {
      return { kind: 'dorpsgek', direction: 'right', designatedSeat: seat };
    }
    return { kind: 'none' };
  };

const infoFor = (
  result: ReturnType<typeof run>,
  seat: SeatIndex,
): PrivateInfo[] => result.privateInfo[seat] ?? [];

describe('the locked player is told, and told only that', () => {
  it('tells the seat whose card was held still', () => {
    const result = run(ROLES_WITH_IDIOT, idiotLocks(3));
    expect(infoFor(result, 3).some((i) => i.kind === 'card-locked')).toBe(true);
  });

  it('tells nobody else — not even the seats whose cards moved', () => {
    const result = run(ROLES_WITH_IDIOT, idiotLocks(3));
    for (const seat of [0, 1, 2, 4] as SeatIndex[]) {
      expect(infoFor(result, seat).some((i) => i.kind === 'card-locked')).toBe(false);
    }
  });

  it('carries no direction, no actor and no role', () => {
    // The whole payload is the fact and the step. If a field is ever added
    // here, it is a field the locked player can reason backwards from.
    const result = run(ROLES_WITH_IDIOT, idiotLocks(2));
    const locked = infoFor(result, 2).find((i) => i.kind === 'card-locked')!;
    expect(Object.keys(locked).sort()).toEqual(['kind', 'step']);
  });

  it('says nothing publicly — the shared tablet must not show a lock', () => {
    // §12: the tablet is spoiler-free. A public lock would tell the table
    // which seat the Dorpsgek singled out.
    const result = run(ROLES_WITH_IDIOT, idiotLocks(3));
    expect(result.events.some((e) => e.kind === 'card-publicly-revealed')).toBe(false);
  });

  it('does not fire when no lock was chosen', () => {
    const result = run(ROLES_WITH_IDIOT, (request: DecisionRequest): Choice =>
      request.prompt.kind === 'dorpsgek'
        ? { kind: 'dorpsgek', direction: 'left' }
        : { kind: 'none' });
    for (let seat = 0; seat < SEATS; seat++) {
      expect(infoFor(result, seat as SeatIndex)
        .some((i) => i.kind === 'card-locked')).toBe(false);
    }
  });

  it('does not fire when the Dorpsgek declined to shift at all', () => {
    const result = run(ROLES_WITH_IDIOT, (request: DecisionRequest): Choice =>
      request.prompt.kind === 'dorpsgek'
        ? { kind: 'dorpsgek', direction: 'none', designatedSeat: 3 }
        : { kind: 'none' });
    expect(infoFor(result, 3).some((i) => i.kind === 'card-locked')).toBe(false);
  });
});
