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
  'action.pickChoiceFirst': 'Maak eerst een keuze',
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
  'reveal.sawMasons': 'Je medevrijmetselaars zijn: {who}.',
  'reveal.noMasons': 'Je bent de enige Vrijmetselaar.',
  'reveal.copiedRole': 'Je kopieerde {who}: de {role}.',
  'reveal.becameRole': 'Je bent nu zelf de {role}.',
  'reveal.judged':
    'De Rechter heeft jou gekozen. Je eerste uitspraak vandaag moet waar zijn.',
  // Says only that it happened. Not who did it, and not whether it was the
  // Dorpsgek Alt or a Dubbelganger copying them — either would be a free read
  // on somebody's role.
  'reveal.cardLocked':
    'Jouw kaart bleef liggen terwijl de rest opschoof. Verder weet je niets: ' +
    'niet wie dat deed, en niet welke kant de kaarten op gingen.',
  'reveal.ownFinal': 'Je eindigt de nacht als de {role}.',
  'reveal.shielded':
    'Die kaart was beschermd door de Schildwacht. Er is niets gebeurd.',
  'reveal.noLegalTarget': 'Er was geen geldig doelwit.',
  'reveal.completed': 'Je actie is uitgevoerd.',
  'reveal.action.shielded': 'Je hebt de kaart van {who} beschermd.',
  'reveal.action.alphaPlaced': 'Je hebt de extra wolfkaart bij {who} gelegd.',
  'reveal.action.judged': 'Je hebt {who} gekozen. Die speler is privé ingelicht.',
  'reveal.action.heksSwapped': 'Middenkaart {n} is geruild met de kaart van {who}.',
  'reveal.action.playersSwapped': 'De kaarten van {first} en {second} zijn geruild.',
  'reveal.action.drank': 'Je kaart is blind geruild met middenkaart {n}.',
  'reveal.action.shiftedLeft': '{n} kaarten zijn naar links geschoven.',
  'reveal.action.shiftedRight': '{n} kaarten zijn naar rechts geschoven.',
  'reveal.action.tookLooier': 'Je zag de Looier bij {who} en hebt die kaart verplicht overgenomen.',
  'reveal.nothing': 'Je hebt deze nacht niets gedaan.',
  'reveal.staleWarning':
    'Let op: dit was zo bij jouw beurt. Kaarten kunnen daarna verschoven zijn.',

  'day.extended': 'Nog 2 minuten! De spanning wordt opgerekt.',
  'day.noVote': 'De groep heeft besloten niet te stemmen.',
  'day.tie': 'Gelijkspel — er wordt niemand gelyncht.',

  // Which device runs the game. A later recovery handover is deliberately
  // phrase-confirmed because the receiving device can read every card.
  'setup.title': 'Wie leidt het spel?',
  'setup.sub':
    'Eén apparaat deelt de kaarten en rekent de nacht uit. Dat apparaat heet ' +
    'hier het tafelapparaat.',
  'setup.tableDevice': 'Los tafelapparaat',
  'setup.tableDevice.badge': 'Aanbevolen',
  'setup.tableDevice.body':
    'Een aparte tablet, laptop of oude telefoon maakt de kamer aan en leidt ' +
    'het spel. Dat apparaat deelt de kaarten en kan ze technisch gezien ' +
    'allemaal inzien — daarom speelt het zelf niet mee. Op het scherm staat ' +
    'alleen wat iedereen mag weten, dus je kunt het gerust midden op tafel ' +
    'laten liggen.',
  'setup.trustedHost': 'Eigen telefoon',
  'setup.trustedHost.badge': 'Vertrouwde groep',
  'setup.trustedHost.body':
    'Eén speler maakt de kamer aan op zijn eigen telefoon en speelt gewoon ' +
    'mee. Je hebt geen extra apparaat nodig. Maar die telefoon deelt de ' +
    'kaarten en kan ze technisch gezien allemaal inzien, ook die van jou. ' +
    'Kies dit alleen in een groep die elkaar vertrouwt.',
  'setup.permanent':
    'Dit apparaat leidt normaal de hele avond. Valt het uit, dan kan een ' +
    'aanwezige speler de rol bewust overnemen door `referee` te bevestigen.',
  'setup.create': 'Maak de kamer aan',
  'timer.setupTitle': 'Overlegtimer',
  'timer.setupBody': 'Kies voor de hele avond hoe lang het overleg duurt. Standaard is 15 minuten.',
  'timer.minutes': 'minuten',
  'timer.invalid': 'Kies een overlegtijd tussen 1 en 120 minuten.',
  'setup.createOnThisDevice':
    'Je maakt de kamer aan op DIT apparaat. Zit je zelf mee te spelen? Kies ' +
    'dan Eigen telefoon.',

  'join.title': 'Meedoen',
  'join.code': 'Kamercode',
  'join.codePlaceholder': 'ABCDE',
  'join.name': 'Je naam',
  'join.namePlaceholder': 'Hoe heet je aan tafel?',
  'join.join': 'Doe mee',
  'join.joining': 'Bezig…',
  'join.back': 'Terug',
  'join.open': 'Doe mee met een bestaande kamer',
  'join.instructions': 'Open bij voorkeur de link die de host deelt. Heb je alleen de code, vul die dan hieronder in.',
  'join.noSuchRoom': 'Die kamer bestaat niet. Klopt de code?',
  'join.refereeCannotPlay':
    'Dit apparaat leidt het spel en speelt niet mee — het kan alle kaarten ' +
    'inzien. Doe mee op je eigen telefoon.',

  'waiting.title': 'Je zit erin vanaf ronde {n}',
  'waiting.why':
    'Er loopt nu een potje. De kaarten liggen al, dus je schuift aan zodra ' +
    'dit potje klaar is — niemand hoeft iets voor je te onderbreken.',
  'waiting.leave': 'Toch weggaan',

  'departed.title': 'Je bent weggegaan',
  'departed.kept':
    'De potjes die je gespeeld hebt tellen gewoon mee. Kom je terug, dan pak ' +
    'je je eigen stand weer op.',
  'departed.rejoin': 'Toch weer meedoen',

  'menu.title': 'Menu',
  'menu.forceVote': 'Open nu de stemming',
  'menu.forceVoteNote': 'Alleen voor oefenpotjes. AI-spelers stemmen daarna automatisch willekeurig.',
  'menu.close': 'Sluiten',
  'menu.share': 'Deel de link',
  'menu.copied': 'Gekopieerd',
  'menu.home': 'Naar beginscherm',
  'menu.leave': 'Weggaan',
  'menu.recover': 'Spelleiding overnemen',

  'lobby.arrange': 'Zet iedereen in de volgorde waarin jullie echt zitten. Tik twee spelers aan om ze te wisselen.',
  'lobby.swap': 'Tik nu de speler aan waarmee je wilt wisselen.',
  'lobby.locked': 'De stoelvolgorde is vastgezet zodra het spel begint.',
  'lobby.start': 'Start het spel ({n} spelers)',
  'lobby.adjacency': 'De volgorde moet kloppen met de echte tafel - de Dorpsgek schuift kaarten een stoel op, en dat betekent alleen iets als de buren kloppen.',
  'lobby.addBot': 'AI-speler erbij',
  'lobby.removeBot': 'Weg',
  'lobby.botsTitle': 'AI-spelers',
  'lobby.botsNote': 'Alleen om te oefenen. Een potje met AI-spelers telt nooit mee voor de statistieken.',
  'lobby.botTag': 'AI',
  'lobby.rolesTitle': 'Kaarten in dit potje',
  'lobby.rolesReady': '{selected} kaarten voor {players} spelers en 3 middenkaarten — klaar om te delen.',
  'lobby.rolesMissing': 'Voeg nog {n} kaart(en) toe ({selected} van {needed}).',
  'lobby.rolesExtra': 'Haal nog {n} kaart(en) weg ({selected} van {needed}).',

  'table.alphaWolfCard': 'Alfawolf-kaart',
  'table.shielded': 'Beschermd door de Schildwacht',

  'demo.start': 'Begin een oefenpotje',
  'demo.explain': 'Een gewone tafel om mee te oefenen: nodig vrienden uit met de link en zet er zoveel AI-spelers bij als je wilt. Een oefenpotje telt nooit mee voor de statistieken.',

  // The wording does not soften this. The group agreed to a trusted takeover;
  // that only stays a real agreement if the screen says what it costs.
  'recover.title': 'Spelleiding overnemen',
  'recover.why':
    'Doe dit alleen als het apparaat dat het spel leidde ermee gestopt is — ' +
    'leeg, vast, of naar huis. Daarna leidt dit apparaat de avond verder.',
  'recover.cost':
    'Let op: het apparaat dat het spel leidt kan alle kaarten inzien, ook die ' +
    'van jou. Door over te nemen krijgt dít apparaat dat. Iedereen aan tafel ' +
    'hoort dit te weten voor je het doet.',
  'recover.typeToConfirm': 'Typ {word} om te bevestigen',
  'recover.confirm': 'Neem de spelleiding over',
  'recover.cancel': 'Laat maar',
  'recover.failed': 'Overnemen lukte niet. Klopt het woord?',

  'prompt.youAre': 'Je bent de {role}',
  'prompt.pickSeat': 'Tik iemand aan de tafel aan.',
  'prompt.pickSeatOrCenter': 'Tik één speler aan, of kies {n} middenkaarten.',
  'prompt.pickTwoSeats': 'Tik twee spelers aan; hun kaarten wisselen.',
  'prompt.pickCenter': 'Kies {n} van de middenkaarten.',
  'prompt.heksPrecommit':
    'Kies nu alvast met wie je de kaart ruilt. Daarna kies je een middenkaart; pas na de nacht zie je wat erop lag.',
  'prompt.confirm': 'Bevestig je actie.',
  // Only the Dorpsgek ever sees a direction. Niemand anders hoort welke kant
  // de kaarten op gingen, dus dit is het enige scherm dat er een noemt.
  'prompt.dorpsgek': 'Welke kant schuiven de kaarten op? Alleen jij weet dit.',
  'prompt.shiftLeft': 'Naar links',
  'prompt.shiftRight': 'Naar rechts',
  'prompt.waiting': 'Wacht op de anderen…',
  'prompt.nothingToDo': 'Je hoeft nu niets te doen.',

  'day.voteNow': 'Stemmen',
  // A decision about the CLOCK, not the uitslag. Het scherm zegt dat erbij,
  // anders leest het als een tweede manier om af te zien van stemmen.
  'day.readyToVote': 'Ik ben klaar — laten we stemmen',
  'day.readyToVoteOn': 'Je wacht op de rest ({n}/{needed})',
  'day.readyExplain':
    'Dit is niet hetzelfde als afzien van stemmen. Zodra meer dan de helft ' +
    'dit tegelijk aan heeft, gaat de stemming meteen open.',
  'day.discussing': 'Overleg',
  'results.title': 'Uitslag',
  'results.nextRound': 'Volgende ronde',

  // Practice is never hidden. A round that does not count has to say so while
  // it is being played, not afterwards.
  'mode.practice': 'Oefenpotje',
  'mode.official': 'Telt mee',
  'mode.practice.badge': 'Telt niet mee',
  'mode.practice.explain':
    'Dit is een oefenavond. Alles werkt gewoon, maar de uitslagen tellen niet ' +
    'mee voor de eeuwige stand. Zo kun je rustig testen zonder de echte ' +
    'geschiedenis te vervuilen.',
  'mode.official.explain':
    'Deze avond telt mee voor de eeuwige stand van de groep. Dat ligt vast ' +
    'zodra de kamer bestaat — je kunt het later niet meer omzetten.',
  'mode.pick': 'Telt deze avond mee?',

  'friend.title': 'Wie ben je?',
  'friend.sub':
    'Dit is geen account. Kies je eigen naam uit de lijst, zodat de eeuwige ' +
    'stand jou ook op een andere telefoon herkent.',
  'friend.newName': 'Voeg jezelf eenmalig toe',
  'friend.create': 'Voeg mijn naam toe',
  'friend.continueAs': 'Ga door als {name}',
  'friend.profiles': 'Profielen',

  'alltime.title': 'Eeuwige stand',
  'alltime.empty': 'Nog geen enkele avond die meetelt.',
  'alltime.rounds': 'potjes',
  'alltime.evenings': 'avonden',
  'alltime.wins': 'gewonnen',
  'alltime.solo': 'solo',
  'alltime.tonight': 'Vanavond',
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
  'action.pickChoiceFirst': 'Make a choice first',
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
  'reveal.sawMasons': 'Your fellow Masons were: {who}.',
  'reveal.noMasons': 'You are the only Mason.',
  'reveal.copiedRole': 'You copied {who}: the {role}.',
  'reveal.becameRole': 'You are now the {role} yourself.',
  'reveal.judged':
    'The Judge picked you. Your first statement today must be true.',
  'reveal.cardLocked':
    'Your card stayed put while the rest shifted. That is all you know: not ' +
    'who did it, and not which way the cards went.',
  'reveal.ownFinal': 'You end the night as the {role}.',
  'reveal.shielded': 'That card was shielded by the Sentinel. Nothing happened.',
  'reveal.noLegalTarget': 'There was no legal target.',
  'reveal.completed': 'Your action was completed.',
  'reveal.action.shielded': 'You protected {who}\u2019s card.',
  'reveal.action.alphaPlaced': 'You placed the extra wolf card with {who}.',
  'reveal.action.judged': 'You picked {who}. That player was notified privately.',
  'reveal.action.heksSwapped': 'Centre card {n} was exchanged with {who}\u2019s card.',
  'reveal.action.playersSwapped': '{first}\u2019s and {second}\u2019s cards were exchanged.',
  'reveal.action.drank': 'You blindly exchanged your card with centre card {n}.',
  'reveal.action.shiftedLeft': '{n} cards shifted to the left.',
  'reveal.action.shiftedRight': '{n} cards shifted to the right.',
  'reveal.action.tookLooier': 'You saw the Tanner with {who} and were forced to take that card.',
  'reveal.nothing': 'You did nothing this night.',
  'reveal.staleWarning':
    'Note: this was true at your turn. Cards may have moved since.',

  'day.extended': 'Two more minutes! The tension is stretched.',
  'day.noVote': 'The group decided not to vote.',
  'day.tie': 'A tie — nobody is lynched.',

  'setup.title': 'Which device runs the game?',
  'setup.sub':
    'One device deals the cards and works out the night. Here that device is ' +
    'called the table device.',
  'setup.tableDevice': 'Separate table device',
  'setup.tableDevice.badge': 'Recommended',
  'setup.tableDevice.body':
    'A separate tablet, laptop or spare phone creates the room and runs the ' +
    'game. That device deals the cards and can technically see all of them — ' +
    'which is why it takes no seat itself. Its screen shows only what ' +
    'everyone is allowed to know, so you can leave it face-up on the table.',
  'setup.trustedHost': 'A player\u2019s own phone',
  'setup.trustedHost.badge': 'Trusted group',
  'setup.trustedHost.body':
    'One player creates the room on their own phone and plays along. No ' +
    'extra device needed. But that phone deals the cards and can technically ' +
    'see all of them, including yours. Only choose this in a group that ' +
    'trusts each other.',
  'setup.permanent':
    'This device normally leads the whole evening. If it fails, a present ' +
    'player can consciously take over by confirming `referee`.',
  'setup.create': 'Create the room',
  'timer.setupTitle': 'Discussion timer',
  'timer.setupBody': 'Choose the discussion length for the whole evening. The default is 15 minutes.',
  'timer.minutes': 'minutes',
  'timer.invalid': 'Choose a discussion time between 1 and 120 minutes.',
  'setup.createOnThisDevice':
    'You are creating the room on THIS device. Playing yourself? Choose a ' +
    'player\u2019s own phone instead.',

  'join.title': 'Join',
  'join.code': 'Room code',
  'join.codePlaceholder': 'ABCDE',
  'join.name': 'Your name',
  'join.namePlaceholder': 'What do they call you at the table?',
  'join.join': 'Join',
  'join.joining': 'Joining\u2026',
  'join.back': 'Back',
  'join.open': 'Join an existing room',
  'join.instructions': 'Prefer opening the link shared by the host. If you only have the code, enter it below.',
  'join.noSuchRoom': 'No such room. Is the code right?',
  'join.refereeCannotPlay':
    'This device runs the game and does not play — it can see every card. ' +
    'Join on your own phone instead.',

  'waiting.title': 'You are in from round {n}',
  'waiting.why':
    'A game is running. The cards are already dealt, so you join as soon as ' +
    'this one finishes — nobody has to interrupt anything for you.',
  'waiting.leave': 'Leave after all',

  'departed.title': 'You left',
  'departed.kept':
    'The games you played still count. Come back and you pick your own score ' +
    'up where it was.',
  'departed.rejoin': 'Join again',

  'menu.title': 'Menu',
  'menu.forceVote': 'Open voting now',
  'menu.forceVoteNote': 'Practice rooms only. AI players then vote randomly automatically.',
  'menu.close': 'Close',
  'menu.share': 'Share the link',
  'menu.copied': 'Copied',
  'menu.home': 'Home',
  'menu.leave': 'Leave',
  'menu.recover': 'Take over running the game',

  'lobby.arrange': 'Put everyone in the order in which you are really sitting. Tap two players to swap them.',
  'lobby.swap': 'Now tap the player you want to swap with.',
  'lobby.locked': 'The seating order is locked as soon as the game starts.',
  'lobby.start': 'Start game ({n} players)',
  'lobby.adjacency': 'The order must match the real table - the Village Idiot shifts cards one seat, so the neighbours have to be right.',
  'lobby.addBot': 'Add an AI player',
  'lobby.removeBot': 'Remove',
  'lobby.botsTitle': 'AI players',
  'lobby.botsNote': 'For practice only. A game with AI players never counts towards the statistics.',
  'lobby.botTag': 'AI',
  'lobby.rolesTitle': 'Cards in this game',
  'lobby.rolesReady': '{selected} cards for {players} players and 3 centre cards — ready to deal.',
  'lobby.rolesMissing': 'Add {n} more card(s) ({selected} of {needed}).',
  'lobby.rolesExtra': 'Remove {n} card(s) ({selected} of {needed}).',

  'table.alphaWolfCard': 'Alpha Wolf card',
  'table.shielded': 'Shielded by the Bodyguard',

  'demo.start': 'Start a practice game',
  'demo.explain': 'An ordinary table to practise on: invite friends with the link and add as many AI players as you like. A practice game never counts towards the statistics.',

  'recover.title': 'Take over running the game',
  'recover.why':
    'Only do this if the device that was running the game has stopped — flat, ' +
    'frozen, or gone home. This device will run the rest of the evening.',
  'recover.cost':
    'Note: the device running the game can see every card, including yours. ' +
    'Taking over gives THIS device that. Everyone at the table should know ' +
    'before you do it.',
  'recover.typeToConfirm': 'Type {word} to confirm',
  'recover.confirm': 'Take over',
  'recover.cancel': 'Never mind',
  'recover.failed': 'Takeover did not work. Is the word right?',

  'prompt.youAre': 'You are the {role}',
  'prompt.pickSeat': 'Tap somebody at the table.',
  'prompt.pickSeatOrCenter': 'Tap one player, or choose {n} centre cards.',
  'prompt.pickTwoSeats': 'Tap two players; their cards swap.',
  'prompt.pickCenter': 'Choose {n} of the centre cards.',
  'prompt.heksPrecommit':
    'Choose who will receive the card first. Then choose a centre card; you will see what it was after the night.',
  'prompt.confirm': 'Confirm your action.',
  'prompt.dorpsgek': 'Which way do the cards shift? Only you know this.',
  'prompt.shiftLeft': 'To the left',
  'prompt.shiftRight': 'To the right',
  'prompt.waiting': 'Waiting for the others\u2026',
  'prompt.nothingToDo': 'Nothing for you to do right now.',

  'day.voteNow': 'Vote',
  'day.readyToVote': 'I\u2019m ready \u2014 let\u2019s vote',
  'day.readyToVoteOn': 'Waiting for the others ({n}/{needed})',
  'day.readyExplain':
    'This is not the same as voting not to vote. The moment more than half ' +
    'hold this at once, the ballot opens.',
  'day.discussing': 'Discussion',
  'results.title': 'Result',
  'results.nextRound': 'Next round',

  'mode.practice': 'Practice game',
  'mode.official': 'Counts',
  'mode.practice.badge': 'Does not count',
  'mode.practice.explain':
    'This is a practice evening. Everything works normally, but the results ' +
    'do not count toward the all-time table. Test as much as you like without ' +
    'polluting the real history.',
  'mode.official.explain':
    'This evening counts toward the group\u2019s all-time table. That is fixed ' +
    'the moment the room exists \u2014 you cannot switch it later.',
  'mode.pick': 'Does this evening count?',

  'friend.title': 'Who are you?',
  'friend.sub':
    'This is not an account. Pick your own name from the list so the all-time ' +
    'table recognises you on a different phone too.',
  'friend.newName': 'Add yourself once',
  'friend.create': 'Add my name',
  'friend.continueAs': 'Continue as {name}',
  'friend.profiles': 'Profiles',

  'alltime.title': 'All-time',
  'alltime.empty': 'No evening has counted yet.',
  'alltime.rounds': 'games',
  'alltime.evenings': 'evenings',
  'alltime.wins': 'won',
  'alltime.solo': 'solo',
  'alltime.tonight': 'Tonight',
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
