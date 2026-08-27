import { DEFAULT_SCORING, type ScoringRules } from '../app/session.js';
import type { RoleId } from '../engine/types.js';
import type { VoteOutcome } from '../engine/dayphase.js';

/**
 * The group's history, across every evening.
 *
 * TWO THINGS MAKE THIS DIFFERENT FROM THE EVENING SCOREBOARD.
 *
 * First, WHO. An evening is keyed by uid, which is a device: anonymous auth
 * hands out a fresh one when somebody clears their browser or turns up on a
 * different phone. That is fine for one night and useless across a year — the
 * same person would accumulate a new history every time they changed handset.
 * So all-time is keyed by a FRIEND PROFILE the player picks, and the display
 * name is carried alongside as a snapshot rather than used as the key. People
 * rename themselves; they are still the same person, and a history that
 * forgets that is not a history.
 *
 * Second, WHAT COUNTS. A practice room writes its rounds like any other, and
 * they are never counted here. That is deliberately a filter at read time
 * rather than a decision at write time: the raw record stays complete and
 * append-only, and "what counts" stays a question we can answer differently
 * later without ever having deleted anything.
 *
 * The totals are DERIVED on every read, never stored. A stored total is a
 * number somebody has to be trusted to have incremented correctly, and this
 * codebase has already been bitten once by exactly that (see session.ts on the
 * latecomer's seed).
 */

/** One player's line in one finished official round. Only dawn-public facts. */
export interface HistoryRecord {
  /** Which evening. Distinct rooms are distinct evenings. */
  roomId: string;
  round: number;
  /** The durable human identity. NOT a uid, and not the display name. */
  friendId: string;
  /** What they were called at the time, so old evenings stay readable. */
  name: string;
  seat: number;
  originalRole: RoleId;
  finalRole: RoleId;
  won: boolean;
  voteOutcome: VoteOutcome;
  suspicionAccuracy: number | null;
  recordedAt: number;
}

export interface AllTimeStanding {
  friendId: string;
  /** The most recent name they went by. */
  name: string;
  points: number;
  rounds: number;
  wins: number;
  /** Distinct evenings they turned up to. */
  evenings: number;
  /** Rounds won as the Looier, which is the hardest way to win. */
  soloWins: number;
}

/**
 * What one round was worth.
 *
 * Derived rather than stored, for the same reason the evening's scoreboard is:
 * a points field in a document is a field somebody could be wrong about, and a
 * rule the group changes later should restate the record rather than leave it
 * disagreeing with itself. Losing still pays — turning up is worth something.
 */
export function pointsFor(
  record: Pick<HistoryRecord, 'won' | 'finalRole'>,
  rules: ScoringRules = DEFAULT_SCORING,
): number {
  if (!record.won) return rules.loss;
  return record.finalRole === 'looier' ? rules.soloWin : rules.win;
}

/**
 * The all-time table, rebuilt from the records every time.
 *
 * NOTE WHAT IS ABSENT: a latecomer's seed. The seed exists so somebody joining
 * at round four is not bottom of THAT EVENING's scoreboard through no fault of
 * their own — it is a courtesy about one night's ordering, not points anybody
 * earned. Carrying it into the all-time table would make arriving late a way
 * to farm points, which is the opposite of what it is for. The evening view
 * still shows it, and still shows it as its own number.
 */
export function allTimeStandings(
  records: HistoryRecord[],
  rules: ScoringRules = DEFAULT_SCORING,
): AllTimeStanding[] {
  // Evenings counted as a Set while accumulating, flattened to a count on the
  // way out — the same friend turns up to one evening many times.
  interface Accumulator extends Omit<AllTimeStanding, 'evenings'> {
    evenings: Set<string>;
    seenAt: number;
  }
  const byFriend = new Map<string, Accumulator>();

  for (const record of records) {
    const existing = byFriend.get(record.friendId);
    const entry: Accumulator = existing ?? {
      friendId: record.friendId,
      name: record.name,
      points: 0, rounds: 0, wins: 0, soloWins: 0,
      evenings: new Set<string>(),
      seenAt: -1,
    };

    // Latest snapshot wins, so a rename shows up everywhere without rewriting
    // a single stored row.
    if (record.recordedAt >= entry.seenAt) {
      entry.name = record.name;
      entry.seenAt = record.recordedAt;
    }

    entry.points += pointsFor(record, rules);
    entry.rounds += 1;
    if (record.won) {
      entry.wins += 1;
      if (record.finalRole === 'looier') entry.soloWins += 1;
    }
    entry.evenings.add(record.roomId);
    byFriend.set(record.friendId, entry);
  }

  return [...byFriend.values()]
    .map(({ evenings, seenAt: _seenAt, ...rest }) => ({ ...rest, evenings: evenings.size }))
    .sort((a, b) =>
      b.points - a.points
      || b.wins - a.wins
      || a.friendId.localeCompare(b.friendId));
}

/** Every evening a friend has turned up to, most recent first. */
export function eveningsFor(records: HistoryRecord[], friendId: string): string[] {
  const seen = new Map<string, number>();
  for (const r of records) {
    if (r.friendId !== friendId) continue;
    seen.set(r.roomId, Math.max(seen.get(r.roomId) ?? 0, r.recordedAt));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([roomId]) => roomId);
}
