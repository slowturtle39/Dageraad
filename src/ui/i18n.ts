import { ROLES } from '../engine/roles.js';
import type { RoleId } from '../engine/types.js';

/**
 * Dutch by default, English available per player (§11).
 *
 * This is a PER-DEVICE setting, not a room setting: one guest switching to
 * English must not change what everyone else sees. It is the one piece of state
 * that is fine to keep in localStorage, because losing it costs nothing (§14).
 */

export type Lang = 'nl' | 'en';

type Dict = Record<string, string>;

const nl: Dict = {
  'phase.night': 'nacht',
  'phase.day': 'dag',
  'phase.voting': 'stemmen',
  'phase.results': 'uitslag',
  'phase.lobby': 'wachtruimte',
  'phase.round': 'ronde {n}',
  'phase.discussion': 'overleg',
  'phase.paused': 'gepauzeerd',

  'action.confirm': 'Bevestig',
  'action.skip': 'Sla over',
  'action.close': 'Sluiten',
  'action.pause': 'Pauze',
  'action.resume': 'Hervat',
  'action.myRole': 'Mijn rol',
  'action.pickPlayerFirst': 'Kies eerst een speler',
  'action.vote': 'Stem',
  'action.abstain': 'Stem om niet te stemmen',

  'stats.played': '{n} potjes gespeeld',
  'stats.won': 'gewonnen',
  'stats.voteAccuracy': 'stem juist',
  'stats.suspicion': 'verdenking',
  'stats.historicalOnly': 'Alleen eerdere potjes. Nooit iets over vanavond.',
  'stats.causedLoss':
    '{n}× een stem die het dorp de das omdeed — het doelwit werd echt ' +
    'gelyncht en het dorp verloor.',

  'role.yours': 'Je bent de {role}',
  'role.yoursExplain':
    'Dit is de rol die je aan het begin kreeg. Je actie hoort altijd bij deze ' +
    'rol, ook als je kaart later van tafel verwisseld is.',

  'reveal.sawCard': 'Bij jouw beurt had {who} de {role}.',
  'reveal.sawCenter': 'Bij jouw beurt lag de {role} op middenkaart {n}.',
  'reveal.sawWolves': 'Bij jouw beurt waren de andere wolven: {who}.',
  'reveal.noWolves': 'Je zag geen andere wolven.',
  'reveal.becameRole': 'Je bent nu zelf de {role}.',
  'reveal.judged':
    'De Rechter heeft jou gekozen. Je eerste uitspraak vandaag moet waar zijn.',
  'reveal.ownFinal': 'Je eindigt de nacht als de {role}.',
  'reveal.shielded':
    'Die kaart was beschermd door de Schildwacht. Er is niets gebeurd.',
  'reveal.nothing': 'Je hebt deze nacht niets gedaan.',
  'reveal.staleWarning':
    'Let op: dit was zo bij jouw beurt. Kaarten kunnen daarna verschoven zijn.',

  'day.extended': 'Nog 2 minuten! De spanning wordt opgerekt.',
  'day.noVote': 'De groep heeft besloten niet te stemmen.',
  'day.tie': 'Gelijkspel — er wordt niemand gelyncht.',
  'day.bodyguardVoid': 'De Bodyguard was het doelwit. De stemming vervalt.',
};

const en: Dict = {
  'phase.night': 'night',
  'phase.day': 'day',
  'phase.voting': 'voting',
  'phase.results': 'result',
  'phase.lobby': 'lobby',
  'phase.round': 'round {n}',
  'phase.discussion': 'discussion',
  'phase.paused': 'paused',

  'action.confirm': 'Confirm',
  'action.skip': 'Skip',
  'action.close': 'Close',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.myRole': 'My role',
  'action.pickPlayerFirst': 'Pick a player first',
  'action.vote': 'Vote',
  'action.abstain': 'Vote not to vote',

  'stats.played': '{n} games played',
  'stats.won': 'won',
  'stats.voteAccuracy': 'vote accuracy',
  'stats.suspicion': 'suspicion',
  'stats.historicalOnly': 'Past games only. Never anything about tonight.',
  'stats.causedLoss':
    '{n}× a vote that cost the village — the target really was lynched and ' +
    'the village lost.',

  'role.yours': 'You are the {role}',
  'role.yoursExplain':
    'This is the role you were dealt. Your action always follows this role, ' +
    'even if your card was swapped away later.',

  'reveal.sawCard': 'At your turn, {who} held the {role}.',
  'reveal.sawCenter': 'At your turn, centre card {n} was the {role}.',
  'reveal.sawWolves': 'At your turn the other wolves were: {who}.',
  'reveal.noWolves': 'You saw no other wolves.',
  'reveal.becameRole': 'You are now the {role} yourself.',
  'reveal.judged':
    'The Judge picked you. Your first statement today must be true.',
  'reveal.ownFinal': 'You end the night as the {role}.',
  'reveal.shielded': 'That card was shielded by the Sentinel. Nothing happened.',
  'reveal.nothing': 'You did nothing this night.',
  'reveal.staleWarning':
    'Note: this was true at your turn. Cards may have moved since.',

  'day.extended': 'Two more minutes! The tension is stretched.',
  'day.noVote': 'The group decided not to vote.',
  'day.tie': 'A tie — nobody is lynched.',
  'day.bodyguardVoid': 'The Bodyguard was the target. The vote is void.',
};

const DICTS: Record<Lang, Dict> = { nl, en };

const STORAGE_KEY = 'dageraad.lang';

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'nl' || saved === 'en') return saved;
  } catch {
    // Private browsing, blocked storage — the default is fine.
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('en')
    ? 'en'
    : 'nl';
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Losing this costs nothing (§14).
  }
}

/**
 * Look up a string, filling {placeholders}.
 *
 * Falls back to Dutch, then to the key itself, so a missing translation shows
 * up as visibly wrong in testing rather than as a blank line at the table.
 */
export function t(
  lang: Lang,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const raw = DICTS[lang]?.[key] ?? nl[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/** Role names come from the role registry, which already carries both. */
export function roleName(lang: Lang, role: RoleId): string {
  const def = ROLES[role];
  if (!def) return role;
  return lang === 'en' ? def.en : def.nl;
}

/** Every key must exist in both dictionaries — asserted in i18n.test.ts. */
export const ALL_KEYS = Object.keys(nl);
