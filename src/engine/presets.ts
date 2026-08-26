import type { GameConfig, RoleId } from './types.js';

/**
 * The group's default role set. This is a STARTING POINT, not a fixed core —
 * the host can add any other role from the library and can remove any of these.
 *
 * It is also exactly the set worked through in §5.1, so `computeRoundSchedule`
 * must return 2 rounds for it. There is a test asserting that.
 */
export const DEFAULT_ACTIVE_ROLES: RoleId[] = [
  'droomwolf',
  'alphawolf',
  'mystiekewolf',
  'dubbelganger',
  'heks',
  'leerlingziener',
  'dorpsgek',
  'medium',
];

/** Everything else in the library, offered as "add a role". */
export const OPTIONAL_ROLES: RoleId[] = [
  'schildwacht', 'weerwolf', 'volgeling', 'vrijmetselaar', 'ziener',
  'rechter', 'onrustoker', 'dronkaard', 'slapeloze', 'schoneslaapster',
  'bodyguard', 'jager', 'dorpeling', 'looier', 'onderzoeker',
];

export const TWO_ROUND_CONFIG: GameConfig = {
  mode: 'tworound',
  heksVariant: 'flat',
  dorpsgekVariant: 'standard',
  heksMaySwapSelf: true,
  // The only role whose live follow-up we trade away to hold the night at two
  // rounds. The Medium was here until her Looier swap became forced
  // (2026-08-26) — with no decision left there is nothing to pre-commit.
  // Empty this and the same game becomes a three-round night.
  precommitRoles: ['heks'],
};

export const DEPENDENCY_CONFIG: GameConfig = {
  mode: 'dependency',
  heksVariant: 'flat',
  dorpsgekVariant: 'standard',
  heksMaySwapSelf: true,
  // Nothing pre-commits: everyone who needs to see something acts live.
  precommitRoles: [],
};
