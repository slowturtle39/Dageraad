import type { RoleId, Team } from './types.js';

export interface RoleDef {
  id: RoleId;
  /** Dutch display name (default language, §11). */
  nl: string;
  en: string;
  team: Team;
  /**
   * True for cards that count as an actual Weerwolf for (a) "did a wolf die"
   * win checks and (b) the Medium's no-public-flip rule. The Volgeling wins
   * WITH the wolves but is not one, so it is team:'wolf' + isWolf:false.
   */
  isWolf: boolean;
  hasNightAction: boolean;
  /**
   * True if the role cannot fully specify its action until it has seen
   * something. These are the roles that force an extra round in simultaneous
   * mode (§5.1). In sequential mode they simply act live and this is ignored.
   */
  revealThenDecide: boolean;
  /** Default position in the night order (§6.2). Host may reorder freely. */
  defaultOrder: number;
}

/**
 * Default night order per §6.2:
 *   Schildwacht -> Droomwolf -> Alpha Wolf -> Mystieke Wolf -> Dubbelganger
 *   -> Heks -> Rechter/Leerlingziener -> Dorpsgek -> Medium -> Schone Slaapster
 * Base-library roles without a house-ruled slot use their rulebook position,
 * interleaved here with gaps so the host can drag anything anywhere.
 */
export const ROLES: Record<RoleId, RoleDef> = {
  schildwacht: { id: 'schildwacht', nl: 'Schildwacht', en: 'Sentinel', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 10 },
  droomwolf: { id: 'droomwolf', nl: 'Droomwolf', en: 'Dream Wolf', team: 'wolf', isWolf: true, hasNightAction: true, revealThenDecide: false, defaultOrder: 20 },
  weerwolf: { id: 'weerwolf', nl: 'Weerwolf', en: 'Werewolf', team: 'wolf', isWolf: true, hasNightAction: true, revealThenDecide: false, defaultOrder: 25 },
  alphawolf: { id: 'alphawolf', nl: 'Alfawolf', en: 'Alpha Wolf', team: 'wolf', isWolf: true, hasNightAction: true, revealThenDecide: false, defaultOrder: 30 },
  mystiekewolf: { id: 'mystiekewolf', nl: 'Mystieke Wolf', en: 'Mystic Wolf', team: 'wolf', isWolf: true, hasNightAction: true, revealThenDecide: false, defaultOrder: 40 },
  volgeling: { id: 'volgeling', nl: 'Volgeling', en: 'Minion', team: 'wolf', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 45 },
  dubbelganger: { id: 'dubbelganger', nl: 'Dubbelganger', en: 'Doppelganger', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: true, defaultOrder: 50 },
  vrijmetselaar: { id: 'vrijmetselaar', nl: 'Vrijmetselaar', en: 'Mason', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 55 },
  ziener: { id: 'ziener', nl: 'Ziener', en: 'Seer', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 58 },
  heks: { id: 'heks', nl: 'Heks', en: 'Witch', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: true, defaultOrder: 60 },
  onderzoeker: { id: 'onderzoeker', nl: 'Onderzoeker', en: 'Paranormal Investigator', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: true, defaultOrder: 65 },
  rechter: { id: 'rechter', nl: 'Rechter', en: 'Judge', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 70 },
  leerlingziener: { id: 'leerlingziener', nl: 'Leerlingziener', en: 'Apprentice Seer', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 72 },
  onrustoker: { id: 'onrustoker', nl: 'Onrustoker', en: 'Troublemaker', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 75 },
  dorpsgek: { id: 'dorpsgek', nl: 'Dorpsgek', en: 'Village Idiot', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 80 },
  dronkaard: { id: 'dronkaard', nl: 'Dronkaard', en: 'Drunk', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 85 },
  medium: { id: 'medium', nl: 'Medium', en: 'Medium', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: true, defaultOrder: 90 },
  slapeloze: { id: 'slapeloze', nl: 'Slapeloze', en: 'Insomniac', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 95 },
  schoneslaapster: { id: 'schoneslaapster', nl: 'Schone Slaapster', en: 'Sleeping Beauty', team: 'village', isWolf: false, hasNightAction: true, revealThenDecide: false, defaultOrder: 100 },
  // No night action, but they matter for the day phase / win conditions (§6.1).
  bodyguard: { id: 'bodyguard', nl: 'Bodyguard', en: 'Bodyguard', team: 'village', isWolf: false, hasNightAction: false, revealThenDecide: false, defaultOrder: 900 },
  jager: { id: 'jager', nl: 'Jager', en: 'Hunter', team: 'village', isWolf: false, hasNightAction: false, revealThenDecide: false, defaultOrder: 901 },
  dorpeling: { id: 'dorpeling', nl: 'Dorpeling', en: 'Villager', team: 'village', isWolf: false, hasNightAction: false, revealThenDecide: false, defaultOrder: 902 },
  looier: { id: 'looier', nl: 'Looier', en: 'Tanner', team: 'solo', isWolf: false, hasNightAction: false, revealThenDecide: false, defaultOrder: 903 },
};

export function roleDef(id: RoleId): RoleDef {
  const def = ROLES[id];
  if (!def) throw new Error(`Unknown role: ${id}`);
  return def;
}

export function isWolfRole(id: RoleId): boolean {
  return roleDef(id).isWolf;
}

export function teamOf(id: RoleId): Team {
  return roleDef(id).team;
}

/** Default night order for a chosen set of active roles. */
export function defaultNightOrder(active: RoleId[]): RoleId[] {
  return [...active]
    .filter((r) => roleDef(r).hasNightAction)
    .sort((a, b) => roleDef(a).defaultOrder - roleDef(b).defaultOrder);
}
