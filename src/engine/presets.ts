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
  // Exactly the roles whose live follow-up we trade away to hold the night at
  // two rounds. Empty this and the same game becomes a four-round night.
  precommitRoles: ['heks', 'medium'],
};

export const DEPENDENCY_CONFIG: GameConfig = {
  mode: 'dependency',
  heksVariant: 'flat',
  dorpsgekVariant: 'standard',
  heksMaySwapSelf: true,
  // Nothing pre-commits: everyone who needs to see something acts live.
  precommitRoles: [],
};
