import { isScored, type VoteOutcome } from '../engine/dayphase.js';
import { roleDef } from '../engine/roles.js';
import type { RoleId, Team } from '../engine/types.js';
import type { RoundRecord } from '../app/session.js';

/**
 * All the stats, aggregated from the append-only round records.
 *
 * NOTHING HERE IS A STORED COUNTER. Every number below is recomputed from the
 * per-round documents each time it is asked for, which is the same discipline
 * the Firestore schema follows and for the same three reasons: there is no
 * server to arbitrate who may increment what, history stays tamper-evident, and
 * a stat computed wrongly is fixed by changing this file rather than by finding
 * and repairing every counter it already polluted.
 *
 * It is also why new breakdowns are cheap. Per-role, per-team, sliced by table
 * size, sliced by which roles were in the game — none of these needed a schema
 * change or a migration, because the underlying rows were always there.
 *
 * At this group's volume (a few hundred rows a year) recomputing is instant.
 */

/* --------------------------------------------------------------------- */
/* Shared shapes                                                          */
/* --------------------------------------------------------------------- */

export interface WinRecord {
  played: number;
  won: number;
  /** null rather than 0 when nothing was played — an unplayed role has no
   *  win rate, and showing 0% for it is a lie people act on. */
  winRate: number | null;
}

function record(played: number, won: number): WinRecord {
  return { played, won, winRate: played === 0 ? null : won / played };
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/* --------------------------------------------------------------------- */
/* Per player                                                             */
/* --------------------------------------------------------------------- */

export interface PlayerAggregate {
  uid: string;
  overall: WinRecord;
  /** Win record by the role they were DEALT. */
  byOriginalRole: Map<RoleId, WinRecord>;
  /** Win record by the card they FINISHED with (§6.0) — often a different story. */
  byFinalRole: Map<RoleId, WinRecord>;
  byTeam: Map<Team, WinRecord>;
  /** Win record sliced by how many people were at the table. */
  byTableSize: Map<number, WinRecord>;
  voteAccuracy: number | null;
  votesScored: number;
  /** Bodyguard: shields that cost the village the game (§10). */
  votesCausingVillageLoss: number;
  suspicionAccuracy: number | null;
  /** How often they ended the night holding a different card than they started. */
  timesSwapped: number;
}

export function aggregatePlayer(uid: string, rounds: RoundRecord[]): PlayerAggregate {
  const agg: PlayerAggregate = {
    uid,
    overall: record(0, 0),
    byOriginalRole: new Map(),
    byFinalRole: new Map(),
    byTeam: new Map(),
    byTableSize: new Map(),
    voteAccuracy: null,
    votesScored: 0,
    votesCausingVillageLoss: 0,
    suspicionAccuracy: null,
    timesSwapped: 0,
  };

  let played = 0;
  let won = 0;
  let votesScored = 0;
  let votesCorrect = 0;
  let suspicionSum = 0;
  let suspicionCount = 0;

  for (const round of rounds) {
    const row = round.results.find((r) => r.uid === uid);
    if (!row) continue;   // a round they were not in — see session.ts

    played += 1;
    if (row.won) won += 1;
    if (row.originalRole !== row.finalRole) agg.timesSwapped += 1;

    bump(agg.byOriginalRole, row.originalRole, row.won);
    bump(agg.byFinalRole, row.finalRole, row.won);
    bump(agg.byTeam, roleDef(row.finalRole).team, row.won);
    bump(agg.byTableSize, round.seatCount, row.won);

    if (isScored(row.voteOutcome)) {
      votesScored += 1;
      if (row.voteOutcome === 'correct') votesCorrect += 1;
    }
    if (row.voteOutcome === 'caused-village-loss') agg.votesCausingVillageLoss += 1;

    if (row.suspicionAccuracy !== null) {
      suspicionSum += row.suspicionAccuracy;
      suspicionCount += 1;
    }
  }

  agg.overall = record(played, won);
  agg.votesScored = votesScored;
  agg.voteAccuracy = rate(votesCorrect, votesScored);
  agg.suspicionAccuracy = suspicionCount === 0 ? null : suspicionSum / suspicionCount;
  return agg;
}

function bump<K>(map: Map<K, WinRecord>, key: K, won: boolean): void {
  const cur = map.get(key) ?? record(0, 0);
  map.set(key, record(cur.played + 1, cur.won + (won ? 1 : 0)));
}

/* --------------------------------------------------------------------- */
/* Per role, across everybody                                             */
/* --------------------------------------------------------------------- */

export interface RoleAggregate {
  role: RoleId;
  /** How the role does when somebody is DEALT it. */
  asDealt: WinRecord;
  /** How it does for whoever ENDS the night holding it. */
  asFinal: WinRecord;
  /**
   * How often a player dealt this role did not finish with it. High numbers
   * here mean the role is a magnet for swaps, which is a different kind of
   * fact about it than its win rate.
   */
  swappedAwayRate: number | null;
  byTableSize: Map<number, WinRecord>;
  /** Rounds this role was in the active list at all, played or centred. */
  timesInGame: number;
}

export function aggregateRoles(rounds: RoundRecord[]): Map<RoleId, RoleAggregate> {
  const out = new Map<RoleId, RoleAggregate>();

  const get = (role: RoleId): RoleAggregate => {
    let a = out.get(role);
    if (!a) {
      a = {
        role,
        asDealt: record(0, 0),
        asFinal: record(0, 0),
        swappedAwayRate: null,
        byTableSize: new Map(),
        timesInGame: 0,
      };
      out.set(role, a);
    }
    return a;
  };

  const swappedAway = new Map<RoleId, number>();

  for (const round of rounds) {
    // A role sitting in the centre is still "in this game" — that is exactly
    // what makes the deal uncertain, so it counts here even though nobody
    // played it. Without this, timesInGame would silently mean something else.
    for (const role of round.activeRoles) get(role).timesInGame += 1;

    for (const row of round.results) {
      const dealt = get(row.originalRole);
      dealt.asDealt = record(dealt.asDealt.played + 1, dealt.asDealt.won + (row.won ? 1 : 0));
      if (row.originalRole !== row.finalRole) {
        swappedAway.set(row.originalRole, (swappedAway.get(row.originalRole) ?? 0) + 1);
      }

      const fin = get(row.finalRole);
      fin.asFinal = record(fin.asFinal.played + 1, fin.asFinal.won + (row.won ? 1 : 0));
      bump(fin.byTableSize, round.seatCount, row.won);
    }
  }

  for (const a of out.values()) {
    a.swappedAwayRate = rate(swappedAway.get(a.role) ?? 0, a.asDealt.played);
  }
  return out;
}

/* --------------------------------------------------------------------- */
/* Per team                                                               */
/* --------------------------------------------------------------------- */

export interface TeamAggregate {
  team: Team;
  /** Rounds in which this team won, out of rounds in which it could have. */
  overall: WinRecord;
  byTableSize: Map<number, WinRecord>;
}

/**
 * Team win rates, counted PER ROUND rather than per player.
 *
 * Counting per player would make the village's win rate look enormous simply
 * because there are more villagers than wolves in every game. The question
 * anybody actually wants answered is "how often does the village win a round",
 * so a round is the unit.
 */
export function aggregateTeams(rounds: RoundRecord[]): Map<Team, TeamAggregate> {
  const out = new Map<Team, TeamAggregate>();
  const get = (team: Team): TeamAggregate => {
    let a = out.get(team);
    if (!a) {
      a = { team, overall: record(0, 0), byTableSize: new Map() };
      out.set(team, a);
    }
    return a;
  };

  for (const round of rounds) {
    // Which teams were actually represented, judged on final cards (§6.0). A
    // team with nobody on it cannot win and must not count as a loss either —
    // a wolfless game is not a game the wolves lost.
    const present = new Set<Team>();
    for (const row of round.results) present.add(roleDef(row.finalRole).team);

    for (const team of present) {
      const teamWon = round.results.some(
        (r) => roleDef(r.finalRole).team === team && r.won,
      );
      const a = get(team);
      a.overall = record(a.overall.played + 1, a.overall.won + (teamWon ? 1 : 0));
      bump(a.byTableSize, round.seatCount, teamWon);
    }
  }
  return out;
}

/* --------------------------------------------------------------------- */
/* Role combinations                                                      */
/* --------------------------------------------------------------------- */

export interface ComboAggregate {
  /** The roles in this combination, sorted so the key is stable. */
  roles: RoleId[];
  key: string;
  rounds: number;
  villageWins: number;
  wolfWins: number;
  soloWins: number;
  /** How balanced this combination is: 0 = one team always wins, 1 = even. */
  balance: number | null;
}

export interface ComboOptions {
  /** How many roles per combination. 2 is the readable default. */
  size?: number;
  /** Ignore combinations seen fewer times than this — noise, not signal. */
  minRounds?: number;
}

/**
 * Which role combinations produce which outcomes.
 *
 * The honest caveat, stated here rather than buried: at this group's volume
 * these numbers are ANECDOTES, not statistics. Eight rounds of "Heks plus
 * Dorpsgek" tells you what happened those eight times and very little about the
 * ninth. `minRounds` exists so the UI can refuse to show the tail, and
 * `balance` is deliberately a soft number rather than a p-value it has no right
 * to claim.
 *
 * They are still worth having: the group wants to know which combinations felt
 * lopsided, and "felt lopsided" is exactly the kind of question a small sample
 * can inform even when it cannot settle it.
 */
export function aggregateCombos(
  rounds: RoundRecord[],
  options: ComboOptions = {},
): ComboAggregate[] {
  const size = options.size ?? 2;
  const minRounds = options.minRounds ?? 1;
  const out = new Map<string, ComboAggregate>();

  for (const round of rounds) {
    const roles = [...new Set(round.activeRoles)].sort();
    const villageWon = round.results.some(
      (r) => roleDef(r.finalRole).team === 'village' && r.won,
    );
    const wolfWon = round.results.some(
      (r) => roleDef(r.finalRole).team === 'wolf' && r.won,
    );
    const soloWon = round.results.some(
      (r) => roleDef(r.finalRole).team === 'solo' && r.won,
    );

    for (const combo of combinations(roles, size)) {
      const key = combo.join('+');
      const a = out.get(key) ?? {
        roles: combo, key, rounds: 0, villageWins: 0, wolfWins: 0, soloWins: 0,
        balance: null,
      };
      a.rounds += 1;
      if (villageWon) a.villageWins += 1;
      if (wolfWon) a.wolfWins += 1;
      if (soloWon) a.soloWins += 1;
      out.set(key, a);
    }
  }

  const list = [...out.values()].filter((a) => a.rounds >= minRounds);
  for (const a of list) {
    const decided = a.villageWins + a.wolfWins;
    // 1 when the two sides split evenly, 0 when one of them takes everything.
    a.balance = decided === 0 ? null : 1 - Math.abs(a.villageWins - a.wolfWins) / decided;
  }
  return list.sort((a, b) => b.rounds - a.rounds || a.key.localeCompare(b.key));
}

/** Every k-sized combination of `items`, in order. */
export function combinations<T>(items: T[], k: number): T[][] {
  if (k <= 0 || k > items.length) return [];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]): void => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/* --------------------------------------------------------------------- */
/* Table sizes                                                            */
/* --------------------------------------------------------------------- */

export interface TableSizeAggregate {
  seatCount: number;
  rounds: number;
  villageWins: number;
  wolfWins: number;
  soloWins: number;
}

/**
 * How the game itself behaves at each table size.
 *
 * The one breakdown most likely to change how the group plays: if the village
 * never wins at five players, that is an argument for a different role set at
 * five players rather than for anybody playing better.
 */
export function aggregateTableSizes(rounds: RoundRecord[]): TableSizeAggregate[] {
  const out = new Map<number, TableSizeAggregate>();

  for (const round of rounds) {
    const a = out.get(round.seatCount) ?? {
      seatCount: round.seatCount, rounds: 0, villageWins: 0, wolfWins: 0, soloWins: 0,
    };
    a.rounds += 1;
    for (const team of ['village', 'wolf', 'solo'] as Team[]) {
      const won = round.results.some(
        (r) => roleDef(r.finalRole).team === team && r.won,
      );
      if (!won) continue;
      if (team === 'village') a.villageWins += 1;
      else if (team === 'wolf') a.wolfWins += 1;
      else a.soloWins += 1;
    }
    out.set(round.seatCount, a);
  }
  return [...out.values()].sort((a, b) => a.seatCount - b.seatCount);
}

/* --------------------------------------------------------------------- */
/* Filtering                                                              */
/* --------------------------------------------------------------------- */

export interface StatsFilter {
  seatCount?: number;
  /** Only rounds where every one of these roles was in the game. */
  withRoles?: RoleId[];
  /** Only rounds from this session. */
  sessionRounds?: number[];
}

/**
 * Narrow the rounds before aggregating.
 *
 * Every aggregate above takes a plain array, so slicing is composition rather
 * than a parameter threaded through nine functions: filter, then aggregate.
 * That is what makes "village win rate at six players with the Heks in" a
 * one-liner instead of a tenth breakdown nobody anticipated.
 */
export function filterRounds(rounds: RoundRecord[], filter: StatsFilter): RoundRecord[] {
  return rounds.filter((r) => {
    if (filter.seatCount !== undefined && r.seatCount !== filter.seatCount) return false;
    if (filter.withRoles?.some((role) => !r.activeRoles.includes(role))) return false;
    if (filter.sessionRounds && !filter.sessionRounds.includes(r.round)) return false;
    return true;
  });
}

/** Every table size that actually occurred, for building a filter control. */
export function observedTableSizes(rounds: RoundRecord[]): number[] {
  return [...new Set(rounds.map((r) => r.seatCount))].sort((a, b) => a - b);
}

/** Every role that has ever been switched on, for the same reason. */
export function observedRoles(rounds: RoundRecord[]): RoleId[] {
  const seen = new Set<RoleId>();
  for (const r of rounds) for (const role of r.activeRoles) seen.add(role);
  return [...seen].sort();
}

/** A `VoteOutcome` breakdown for one player, for the accuracy panel. */
export function voteBreakdown(
  uid: string,
  rounds: RoundRecord[],
): Record<VoteOutcome, number> {
  const out: Record<VoteOutcome, number> = {
    correct: 0, incorrect: 0, 'caused-village-loss': 0,
    inconsequential: 0, 'not-scored': 0,
  };
  for (const round of rounds) {
    const row = round.results.find((r) => r.uid === uid);
    if (row) out[row.voteOutcome] += 1;
  }
  return out;
}
