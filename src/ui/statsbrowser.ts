import { ROLES } from '../engine/roles.js';
import type { RoleId, Team } from '../engine/types.js';
import type { RoundRecord } from '../app/session.js';
import type { SessionStanding } from '../app/session.js';
import {
  aggregateCombos, aggregatePlayer, aggregateRoles, aggregateTableSizes,
  aggregateTeams, filterRounds, observedRoles, observedTableSizes,
  type StatsFilter, type WinRecord,
} from '../stats/aggregate.js';
import { roleName, type Lang } from './i18n.js';

/**
 * The stats browser — the screen you can sit and read.
 *
 * Deliberately NOT the same thing as the stats sheet you get by tapping
 * somebody at the table. That one is night-phase cover traffic (§5.4): it has
 * to be glanceable, it is about one player, and it appears while a game is
 * running. This is the opposite — reachable BEFORE you join anything, with
 * every breakdown at once and no clock ticking (Milan, 2026-08-26).
 *
 * Splitting them matters because the constraints genuinely conflict. Cover
 * traffic must be quick to read and identical for everyone; a browser wants
 * filters, tabs and depth. Trying to serve both from one screen would make the
 * cover worse, and the cover is a privacy mechanism.
 *
 * ABSOLUTE RULE, inherited: historical only. Nothing here may reflect a game in
 * progress. It is reachable during one, so this is not theoretical — the caller
 * passes finished rounds and nothing else can get in.
 */

export type StatsTab = 'players' | 'roles' | 'teams' | 'tables' | 'combos';

export interface StatsBrowserView {
  lang: Lang;
  /** FINISHED rounds only. A round in progress must never reach this. */
  rounds: RoundRecord[];
  /** uid -> display name, for everyone who appears in those rounds. */
  names: Record<string, string>;
  /** Tonight's scoreboard, when there is a session. Omitted when browsing cold. */
  standings?: SessionStanding[];
  tab: StatsTab;
  filter: StatsFilter;
  onTab: (tab: StatsTab) => void;
  onFilter: (filter: StatsFilter) => void;
}

const pct = (x: number | null): string =>
  x === null ? '—' : `${Math.round(x * 100)}%`;

const teamLabel: Record<Team, { nl: string; en: string }> = {
  village: { nl: 'Dorp', en: 'Village' },
  wolf: { nl: 'Weerwolven', en: 'Wolves' },
  solo: { nl: 'Looier', en: 'Tanner' },
};

const TAB_LABEL: Record<StatsTab, { nl: string; en: string }> = {
  players: { nl: 'Spelers', en: 'Players' },
  roles: { nl: 'Rollen', en: 'Roles' },
  teams: { nl: 'Teams', en: 'Teams' },
  tables: { nl: 'Tafelgrootte', en: 'Table size' },
  combos: { nl: 'Combinaties', en: 'Combinations' },
};

export function renderStatsBrowser(view: StatsBrowserView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'browser';

  el.append(renderTabs(view), renderFilters(view));

  const rounds = filterRounds(view.rounds, view.filter);

  if (rounds.length === 0) {
    el.append(empty(view.lang));
    return el;
  }

  // A line of honesty at the top of every tab. Small samples are the normal
  // case for one group of friends, and a percentage over four rounds looks
  // exactly as authoritative as one over four hundred unless you say so.
  el.append(sampleNote(view.lang, rounds.length, view.rounds.length));

  switch (view.tab) {
    case 'players': el.append(renderPlayers(view, rounds)); break;
    case 'roles': el.append(renderRoles(view, rounds)); break;
    case 'teams': el.append(renderTeams(view, rounds)); break;
    case 'tables': el.append(renderTables(view, rounds)); break;
    case 'combos': el.append(renderCombos(view, rounds)); break;
  }
  return el;
}

/* ------------------------------------------------------------------ */
/* chrome                                                              */
/* ------------------------------------------------------------------ */

function renderTabs(view: StatsBrowserView): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'browser__tabs';
  for (const tab of Object.keys(TAB_LABEL) as StatsTab[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = tab === view.tab ? 'browser__tab browser__tab--on' : 'browser__tab';
    b.textContent = TAB_LABEL[tab][view.lang];
    b.addEventListener('click', () => view.onTab(tab));
    bar.append(b);
  }
  return bar;
}

function renderFilters(view: StatsBrowserView): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'browser__filters';

  // Filters are built from what ACTUALLY OCCURRED, never from the full role
  // list. Offering "at 11 players" in a group that has never had 11 is a
  // control that can only ever produce an empty screen.
  const sizes = observedTableSizes(view.rounds);
  if (sizes.length > 1) {
    wrap.append(chip(
      view.lang === 'nl' ? 'Alle tafels' : 'All tables',
      view.filter.seatCount === undefined,
      () => view.onFilter({ ...view.filter, seatCount: undefined }),
    ));
    for (const size of sizes) {
      wrap.append(chip(
        `${size}`,
        view.filter.seatCount === size,
        () => view.onFilter({ ...view.filter, seatCount: size }),
      ));
    }
  }

  const roles = observedRoles(view.rounds);
  if (roles.length > 0) {
    const select = document.createElement('select');
    select.className = 'browser__select';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = view.lang === 'nl' ? 'Met elke rol' : 'With any role';
    select.append(none);
    for (const role of roles) {
      const o = document.createElement('option');
      o.value = role;
      o.textContent = roleName(view.lang, role);
      o.selected = view.filter.withRoles?.[0] === role;
      select.append(o);
    }
    select.addEventListener('change', () => {
      const value = select.value as RoleId | '';
      view.onFilter({
        ...view.filter,
        ...(value === '' ? { withRoles: undefined } : { withRoles: [value] }),
      });
    });
    wrap.append(select);
  }
  return wrap;
}

function chip(label: string, on: boolean, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = on ? 'browser__chip browser__chip--on' : 'browser__chip';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function empty(lang: Lang): HTMLElement {
  const p = document.createElement('p');
  p.className = 'sheet__note';
  p.textContent = lang === 'nl'
    ? 'Nog geen partijen die hieraan voldoen.'
    : 'No games match this yet.';
  return p;
}

function sampleNote(lang: Lang, shown: number, total: number): HTMLElement {
  const p = document.createElement('p');
  p.className = 'browser__sample';
  const of = shown === total ? '' : ` ${lang === 'nl' ? 'van' : 'of'} ${total}`;
  p.textContent = lang === 'nl'
    ? `${shown}${of} partijen. Bij kleine aantallen zeggen percentages weinig.`
    : `${shown}${of} games. Percentages mean little at small counts.`;
  return p;
}

/* ------------------------------------------------------------------ */
/* tables of numbers                                                   */
/* ------------------------------------------------------------------ */

interface Column {
  label: string;
  /** Right-aligned when it is a number, which is most of them. */
  numeric?: boolean;
}

function grid(columns: Column[], rows: (string | HTMLElement)[][]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'grid';

  const head = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.numeric) th.className = 'grid__num';
    head.append(th);
  }
  table.append(head);

  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      if (typeof cell === 'string') td.textContent = cell;
      else td.append(cell);
      if (columns[i]?.numeric) td.className = 'grid__num';
      tr.append(td);
    });
    table.append(tr);
  }
  return table;
}

/** "3/8 · 38%" — the raw counts next to the percentage, always. */
function winCell(r: WinRecord | undefined): string {
  if (!r || r.played === 0) return '—';
  return `${r.won}/${r.played} · ${pct(r.winRate)}`;
}

/* ------------------------------------------------------------------ */
/* tabs                                                                */
/* ------------------------------------------------------------------ */

function renderPlayers(view: StatsBrowserView, rounds: RoundRecord[]): HTMLElement {
  const uids = [...new Set(rounds.flatMap((r) => r.results.map((x) => x.uid)))];
  const aggs = uids
    .map((uid) => aggregatePlayer(uid, rounds))
    .sort((a, b) =>
      (b.overall.winRate ?? -1) - (a.overall.winRate ?? -1)
      || b.overall.played - a.overall.played);

  const nl = view.lang === 'nl';
  return grid(
    [
      { label: nl ? 'Speler' : 'Player' },
      { label: nl ? 'Gewonnen' : 'Won', numeric: true },
      { label: nl ? 'Stem' : 'Vote', numeric: true },
      { label: nl ? 'Verwisseld' : 'Swapped', numeric: true },
    ],
    aggs.map((a) => [
      view.names[a.uid] ?? a.uid,
      winCell(a.overall),
      pct(a.voteAccuracy),
      `${a.timesSwapped}`,
    ]),
  );
}

function renderRoles(view: StatsBrowserView, rounds: RoundRecord[]): HTMLElement {
  const roles = [...aggregateRoles(rounds).values()]
    .filter((r) => r.asDealt.played > 0 || r.asFinal.played > 0)
    .sort((a, b) => b.asDealt.played - a.asDealt.played);

  const nl = view.lang === 'nl';
  return grid(
    [
      { label: nl ? 'Rol' : 'Role' },
      // Both columns, deliberately. A role can be a fine card to be dealt and
      // a terrible one to be holding at dawn, and one number cannot say that.
      { label: nl ? 'Gedeeld' : 'As dealt', numeric: true },
      { label: nl ? 'Eindkaart' : 'As final', numeric: true },
      { label: nl ? 'Afgepakt' : 'Lost it', numeric: true },
    ],
    roles.map((r) => [
      ROLES[r.role]?.[view.lang] ?? r.role,
      winCell(r.asDealt),
      winCell(r.asFinal),
      pct(r.swappedAwayRate),
    ]),
  );
}

function renderTeams(view: StatsBrowserView, rounds: RoundRecord[]): HTMLElement {
  const teams = [...aggregateTeams(rounds).values()];
  const nl = view.lang === 'nl';
  const el = document.createElement('div');

  el.append(grid(
    [
      { label: nl ? 'Team' : 'Team' },
      { label: nl ? 'Gewonnen' : 'Won', numeric: true },
    ],
    teams.map((t) => [teamLabel[t.team][view.lang], winCell(t.overall)]),
  ));

  const note = document.createElement('p');
  note.className = 'sheet__note';
  // Worth stating on the screen, not just in the source: this is the number
  // people misread most, and the misreading always favours the village.
  note.textContent = nl
    ? 'Per partij geteld, niet per speler — anders lijkt het dorp beter door aantallen.'
    : 'Counted per game, not per player — otherwise the village looks better just by numbers.';
  el.append(note);
  return el;
}

function renderTables(view: StatsBrowserView, rounds: RoundRecord[]): HTMLElement {
  const sizes = aggregateTableSizes(rounds);
  const nl = view.lang === 'nl';
  return grid(
    [
      { label: nl ? 'Spelers' : 'Players' },
      { label: nl ? 'Partijen' : 'Games', numeric: true },
      { label: nl ? 'Dorp' : 'Village', numeric: true },
      { label: nl ? 'Wolven' : 'Wolves', numeric: true },
      { label: nl ? 'Looier' : 'Tanner', numeric: true },
    ],
    sizes.map((s) => [
      `${s.seatCount}`,
      `${s.rounds}`,
      `${s.villageWins}`,
      `${s.wolfWins}`,
      `${s.soloWins}`,
    ]),
  );
}

function renderCombos(view: StatsBrowserView, rounds: RoundRecord[]): HTMLElement {
  // Two rounds minimum. One round is not a pattern, and showing it as one is
  // how a group talks itself into believing a role pairing is broken.
  const combos = aggregateCombos(rounds, { size: 2, minRounds: 2 }).slice(0, 25);
  const nl = view.lang === 'nl';
  const el = document.createElement('div');

  if (combos.length === 0) {
    el.append(empty(view.lang));
    return el;
  }

  el.append(grid(
    [
      { label: nl ? 'Combinatie' : 'Combination' },
      { label: nl ? 'Partijen' : 'Games', numeric: true },
      { label: nl ? 'Dorp' : 'Village', numeric: true },
      { label: nl ? 'Wolven' : 'Wolves', numeric: true },
      { label: nl ? 'Balans' : 'Balance', numeric: true },
    ],
    combos.map((c) => [
      c.roles.map((r) => roleName(view.lang, r)).join(' + '),
      `${c.rounds}`,
      `${c.villageWins}`,
      `${c.wolfWins}`,
      pct(c.balance),
    ]),
  ));

  const note = document.createElement('p');
  note.className = 'sheet__note';
  note.textContent = nl
    ? 'Combinaties met minder dan 2 partijen worden niet getoond. Dit zijn anekdotes, geen statistiek.'
    : 'Combinations with fewer than 2 games are hidden. These are anecdotes, not statistics.';
  el.append(note);
  return el;
}

/* ------------------------------------------------------------------ */
/* tonight's scoreboard                                                */
/* ------------------------------------------------------------------ */

/**
 * The evening's standings.
 *
 * Shows the seed as its own column rather than folding it into the total. A
 * player who joined at round four on six points did not earn those six, and a
 * scoreboard that hides that is the first thing somebody will argue about.
 */
export function renderStandings(
  lang: Lang,
  standings: SessionStanding[],
  names: Record<string, string>,
): HTMLElement {
  const nl = lang === 'nl';
  const el = document.createElement('div');
  el.className = 'browser';

  el.append(grid(
    [
      { label: nl ? 'Speler' : 'Player' },
      { label: nl ? 'Punten' : 'Points', numeric: true },
      { label: nl ? 'Partijen' : 'Games', numeric: true },
      { label: nl ? 'Gewonnen' : 'Won', numeric: true },
      { label: nl ? 'Startpunten' : 'Seeded', numeric: true },
    ],
    standings.map((s) => {
      const name = names[s.uid] ?? s.uid;
      return [
        s.active ? name : `${name} (${nl ? 'weg' : 'left'})`,
        `${s.points}`,
        `${s.roundsPlayed}`,
        `${s.wins}`,
        s.seeded > 0 ? `+${s.seeded}` : '—',
      ];
    }),
  ));

  if (standings.some((s) => s.seeded > 0)) {
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = nl
      ? 'Wie later instapt begint gelijk met de laatste plek, en telt alleen mee vanaf de partijen die hij speelde.'
      : 'A late joiner starts level with last place, and only counts from the games they played.';
    el.append(note);
  }
  return el;
}
