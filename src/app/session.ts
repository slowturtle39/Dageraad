import type { RoleId, SeatIndex } from '../engine/types.js';
import type { VoteOutcome } from '../engine/dayphase.js';

/**
 * A SESSION is an evening. A ROUND is one game.
 *
 * Until now a room was a single game, which quietly assumed the eight people
 * who sat down are the eight people who finish. Real evenings do not work like
 * that: somebody arrives at round three, somebody else has to drive home after
 * round five, and neither should end the night for everybody else (Milan,
 * 2026-08-26).
 *
 * Everything here is pure. The scoreboard is derived from the round records, it
 * is never a counter anybody increments — same discipline as the Firestore
 * schema, and for the same reason: an evening's score that can only be
 * recomputed is an evening's score nobody can quietly get wrong.
 */

/** One player's line in one finished round. */
export interface RoundResult {
  uid: string;
  seat: SeatIndex;
  originalRole: RoleId;
  finalRole: RoleId;
  won: boolean;
  voteOutcome: VoteOutcome;
  suspicionAccuracy: number | null;
}

export interface RoundRecord {
  round: number;
  /** Roles the host had switched on. Public, and what the stats slice by. */
  activeRoles: RoleId[];
  /** How many people actually sat down. Stats slice by this too. */
  seatCount: number;
  outcome: string;
  results: RoundResult[];
}

/**
 * Where a player stands in the evening.
 *
 * `seeded` is the crucial one. A player who joins at round four has played no
 * rounds, and a plain zero would drop them to the bottom of a scoreboard they
 * had no chance to climb. So they start level with whoever is currently LAST
 * (Milan, 2026-08-26): not rewarded for arriving late, not punished for it
 * either — they simply join at the back of the pack rather than below it.
 *
 * It is DERIVED here, never read off the member document. See `standings`.
 *
 * `points` is what the scoreboard shows. `roundsPlayed` and `wins` are the
 * honest record and count ONLY rounds they were actually dealt into, which is
 * why they are tracked separately rather than inferred from points.
 */
export interface SessionStanding {
  uid: string;
  points: number;
  seeded: number;
  roundsPlayed: number;
  wins: number;
  /** True while this player is seated in the next round. */
  active: boolean;
}

/**
 * Who is in the evening, and for which stretch of it.
 *
 * NOTE WHAT IS NOT HERE: a `seeded` field. It used to be one, written by the
 * joining client into a document that client owns — which made the number the
 * scoreboard starts you at a number you could type. `seeded: 9999` from
 * devtools was a first-place finish, and no security rule could tell that
 * write apart from an honest one, because the rules cannot replay an evening
 * to know what the floor was at round four.
 *
 * So the seed is no longer stored anywhere. It is recomputed from
 * `joinedAtRound` plus the append-only round records, both of which the joiner
 * cannot forge: the rules pin `joinedAtRound` to the room's current round at
 * the moment of the write, and round records are referee-written and
 * create-only. Same discipline as the results documents — the two fields a
 * player controls are which round they arrived and which round they left, and
 * neither of those is worth points.
 */
export interface SessionMember {
  uid: string;
  /** Round number at which they joined. 1 for everyone who started the evening. */
  joinedAtRound: number;
  /** Round at which they left, or null if still here. */
  leftAtRound: number | null;
}

/** The round a member arrived for, defended against a nonsense value. */
function joinedAt(m: SessionMember): number {
  return Math.max(1, Math.floor(m.joinedAtRound));
}

/** Is this member at the table for `round`? leftAtRound is their LAST round. */
function presentAt(m: SessionMember, round: number): boolean {
  return joinedAt(m) <= round
    && (m.leftAtRound === null || m.leftAtRound >= round);
}

/**
 * The seed a player joining before `round` should receive.
 *
 * The LOWEST current total, or zero when nobody has played yet. Deliberately
 * the minimum rather than the average or the leader: seeding at the average
 * would let a latecomer overtake people who sat through the rounds that built
 * that average, and seeding at zero makes joining late a punishment nobody
 * would accept twice.
 *
 * This is the PREVIEW — what the lobby shows somebody about to join. The
 * authoritative version is the same rule applied inside `standings`, walking
 * the rounds in order. Nothing persists what this returns.
 */
export function seedForJoiner(standings: SessionStanding[]): number {
  const active = standings.filter((s) => s.active);
  if (active.length === 0) return 0;
  return Math.min(...active.map((s) => s.points));
}

export interface ScoringRules {
  /** Points for winning a round. */
  win: number;
  /** Points for taking part and losing — participation is worth something. */
  loss: number;
  /**
   * Bonus for a Looier who pulled it off. A solo win against the whole table
   * is harder than being on the right team, and a flat `win` undersells it.
   */
  soloWin: number;
}

export const DEFAULT_SCORING: ScoringRules = { win: 3, loss: 1, soloWin: 5 };

/**
 * Rebuild the whole scoreboard from the round records.
 *
 * Recomputed rather than accumulated, always. A running counter would have to
 * be right at every single write; this only has to be right once, and it makes
 * a mis-scored round fixable by correcting the round rather than by hunting
 * down the counter it already polluted.
 *
 * The walk is round by round rather than member-then-round, and that ordering
 * is the point: a latecomer's seed is the floor of the table AT THE ROUND THEY
 * ARRIVED, which is only knowable with the rounds before it already applied.
 * Doing it this way is what lets the seed stop being a stored, forgeable field
 * — the evening's own history is the only input.
 */
export function standings(
  members: SessionMember[],
  rounds: RoundRecord[],
  rules: ScoringRules = DEFAULT_SCORING,
): SessionStanding[] {
  const out = new Map<string, SessionStanding>();

  const byRound = new Map<number, RoundRecord[]>();
  for (const rec of rounds) {
    const n = Math.floor(rec.round);
    const at = byRound.get(n);
    if (at) at.push(rec);
    else byRound.set(n, [rec]);
  }

  // Far enough to admit everyone, including somebody who joined for a round
  // that has not been played yet — they belong on the scoreboard on zero
  // rounds, not missing from it.
  const lastRound = Math.max(
    0,
    ...rounds.map((rec) => Math.floor(rec.round)),
    ...members.map(joinedAt),
  );

  /** The lowest total among people already at the table for `round`. */
  const floorAt = (round: number): number => {
    const seated = members
      .filter((m) => joinedAt(m) < round && presentAt(m, round))
      .map((m) => out.get(m.uid)?.points)
      .filter((p): p is number => p !== undefined);
    return seated.length === 0 ? 0 : Math.min(...seated);
  };

  for (let round = 1; round <= lastRound; round++) {
    // Everyone arriving for this round is seeded from the SAME floor, computed
    // before any of them is admitted — otherwise two people walking in together
    // would seed off each other and the second would land below the first.
    const arriving = members.filter(
      (m) => joinedAt(m) === round && !out.has(m.uid),
    );
    if (arriving.length > 0) {
      const seeded = floorAt(round);
      for (const m of arriving) {
        out.set(m.uid, {
          uid: m.uid,
          points: seeded,
          seeded,
          roundsPlayed: 0,
          wins: 0,
          active: m.leftAtRound === null,
        });
      }
    }

    for (const rec of byRound.get(round) ?? []) {
      for (const r of rec.results) {
        const standing = out.get(r.uid);
        // A result for somebody who is not a member is not a crash — a player
        // can leave and their finished rounds still happened, and dropping the
        // row here would silently rewrite the evening's history.
        if (!standing) continue;
        standing.roundsPlayed += 1;
        if (r.won) {
          standing.wins += 1;
          standing.points += r.finalRole === 'looier' ? rules.soloWin : rules.win;
        } else {
          standing.points += rules.loss;
        }
      }
    }
  }

  return [...out.values()].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.uid.localeCompare(b.uid),
  );
}

/**
 * Who sits down for the next round.
 *
 * Joins and departures land at a ROUND BOUNDARY and never mid-night, which is
 * not a limitation so much as the only coherent option: the deal is fixed the
 * moment the night starts, the Dorpsgek's shift depends on stable adjacency
 * (§13), and there is no card to hand somebody who walks in at second twenty.
 *
 * Seats are renumbered densely so the ring has no holes — a gap in the seating
 * is a gap in the Dorpsgek's rotation.
 */
export function seatingForNextRound(
  members: SessionMember[],
  currentSeating: string[],
  nextRound: number,
): string[] {
  const present = new Set(
    members.filter((m) => presentAt(m, nextRound)).map((m) => m.uid),
  );

  // Keep everyone who is staying in the seat they already had, so the table
  // does not reshuffle around people who never moved. Newcomers go on the end,
  // which is where a real person joining a real table sits.
  const kept = currentSeating.filter((uid) => present.has(uid));
  const added = [...present].filter((uid) => !kept.includes(uid));
  return [...kept, ...added];
}

/**
 * Can a round legally start?
 *
 * Three centre cards means the deal needs seatCount + 3 cards, so very small
 * tables are a real constraint rather than a nicety.
 */
export function canStartRound(seatCount: number): string | null {
  if (seatCount < 3) return 'Minimaal 3 spelers nodig.';
  if (seatCount > 12) return 'Maximaal 12 spelers.';
  return null;
}
