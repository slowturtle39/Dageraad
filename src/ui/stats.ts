import type { RoleId } from '../engine/types.js';
import { roleName, t, type Lang } from './i18n.js';

/**
 * The stats sheet — what you get when you tap somebody at the table.
 *
 * This is the night phase's cover traffic (§5.4). If only the Dubbelganger is
 * tapping their phone at second 20, anyone glancing round the table has their
 * identity for free. Making stats the thing you land on by default means
 * tapping is what everybody is doing anyway.
 *
 * For that to work it has to be worth reading, which is why this shows per-role
 * form and a vote-accuracy breakdown rather than a single win count.
 *
 * ABSOLUTE RULE: historical only. Nothing here may reflect the game in
 * progress. The moment this can show anything about tonight it stops being
 * cover and becomes the biggest leak in the app.
 */

export interface RoleRecord {
  role: RoleId;
  played: number;
  won: number;
}

export interface PlayerStats {
  displayName: string;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  /** Share of scoreable votes that were correct (§10). */
  voteAccuracy: number | null;
  /** Bodyguard-only: votes that got an innocent lynched and cost the village. */
  votesCausingVillageLoss: number;
  suspicionAccuracy: number | null;
  byRole: RoleRecord[];
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function renderStats(stats: PlayerStats, lang: Lang = 'nl'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stats';

  const head = document.createElement('div');
  head.className = 'stats__head';
  const avatar = document.createElement('div');
  avatar.className = 'stats__avatar';
  avatar.textContent = stats.displayName.slice(0, 1).toUpperCase();
  // The name is already the sheet's title — repeating it here just wastes a
  // line on a phone.
  const meta = document.createElement('div');
  meta.className = 'stats__meta';
  meta.textContent = t(lang, 'stats.played', { n: stats.gamesPlayed });
  head.append(avatar, meta);
  el.append(head);

  const grid = document.createElement('div');
  grid.className = 'stats__grid';
  grid.append(
    stat(
      stats.gamesPlayed === 0 ? '—' : pct(stats.gamesWon / stats.gamesPlayed),
      t(lang, 'stats.won'),
    ),
    stat(pct(stats.voteAccuracy), t(lang, 'stats.voteAccuracy')),
    stat(pct(stats.suspicionAccuracy), t(lang, 'stats.suspicion')),
  );
  el.append(grid);

  // Only shown when it has ever happened — an empty row would read as an
  // accusation rather than a statistic.
  if (stats.votesCausingVillageLoss > 0) {
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = t(lang, 'stats.causedLoss', { n: stats.votesCausingVillageLoss });
    el.append(note);
  }

  const ranked = [...stats.byRole]
    .filter((r) => r.played > 0)
    .sort((a, b) => b.played - a.played)
    .slice(0, 6);

  for (const r of ranked) {
    const row = document.createElement('div');
    row.className = 'rolerow';

    const label = document.createElement('span');
    label.className = 'rolerow__name';
    label.textContent = roleName(lang, r.role);

    const bar = document.createElement('span');
    bar.className = 'rolerow__bar';
    const fill = document.createElement('span');
    fill.className = 'rolerow__fill';
    fill.style.width = `${Math.round((r.won / r.played) * 100)}%`;
    bar.append(fill);

    const n = document.createElement('span');
    n.className = 'rolerow__n';
    n.textContent = `${r.won}/${r.played}`;

    row.append(label, bar, n);
    el.append(row);
  }

  return el;
}

function stat(value: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stat';
  const v = document.createElement('div');
  v.className = 'stat__value';
  v.textContent = value;
  const l = document.createElement('div');
  l.className = 'stat__label';
  l.textContent = label;
  el.append(v, l);
  return el;
}

/**
 * Aggregate a player's stats from their append-only result documents.
 *
 * There are no stored counters to read — per §14 and the Firestore schema, the
 * results docs ARE the stats. That is what removes "who is allowed to increment
 * my win count" as a question on a plan with no server.
 */
export interface ResultRow {
  finalRole: RoleId;
  won: boolean;
  voteOutcome:
    | 'correct'
    | 'incorrect'
    | 'caused-village-loss'
    | 'inconsequential'
    | 'not-scored';
  suspicionAccuracy: number | null;
}

export function aggregate(displayName: string, rows: ResultRow[]): PlayerStats {
  const byRole = new Map<RoleId, RoleRecord>();
  let won = 0;
  let scoredVotes = 0;
  let correctVotes = 0;
  let causedLoss = 0;
  const suspicions: number[] = [];

  for (const row of rows) {
    if (row.won) won++;
    const rec = byRole.get(row.finalRole) ?? { role: row.finalRole, played: 0, won: 0 };
    rec.played++;
    if (row.won) rec.won++;
    byRole.set(row.finalRole, rec);

    // 'inconsequential' and 'not-scored' are excluded from the denominator on
    // purpose: a timed-out window is not a wrong answer (§10), and neither is a
    // Bodyguard vote for somebody who was never lynched.
    if (row.voteOutcome === 'correct') { scoredVotes++; correctVotes++; }
    else if (row.voteOutcome === 'incorrect') { scoredVotes++; }
    else if (row.voteOutcome === 'caused-village-loss') { scoredVotes++; causedLoss++; }

    if (row.suspicionAccuracy !== null) suspicions.push(row.suspicionAccuracy);
  }

  return {
    displayName,
    avatar: null,
    gamesPlayed: rows.length,
    gamesWon: won,
    voteAccuracy: scoredVotes === 0 ? null : correctVotes / scoredVotes,
    votesCausingVillageLoss: causedLoss,
    suspicionAccuracy:
      suspicions.length === 0
        ? null
        : suspicions.reduce((a, b) => a + b, 0) / suspicions.length,
    byRole: [...byRole.values()],
  };
}
