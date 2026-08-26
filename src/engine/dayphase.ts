import { isWolfRole, teamOf } from './roles.js';
import { finalRoleOf } from './state.js';
import type { NightState, SeatIndex, Team } from './types.js';

export interface Vote {
  voter: SeatIndex;
  /** null = no target selected. Self-votes are rejected (§7). */
  target: SeatIndex | null;
  /** The "vote not to vote" toggle (§7). */
  abstain: boolean;
}

/**
 * How the ballot ended.
 *
 * 'tie' no longer means "nobody dies" — since 2026-08-26 EVERYONE on the top
 * count is lynched, so a tie is a multiple execution and `eliminated` holds all
 * of them. It stays a distinct outcome from 'eliminated' because the results
 * screen wants to say "the village could not decide, so both hang".
 *
 * 'tie' with an empty `eliminated` still happens when no vote counted at all —
 * every ballot discarded, or every one cancelled by the Bodyguard.
 */
export type DayOutcome =
  | 'eliminated'
  | 'tie'
  | 'no-vote';

/**
 * Why a ballot did not reach the tally.
 *
 * `bodyguard-protects` is not really a discarded vote — it is the Bodyguard
 * doing his job, and the results screen should say so rather than reporting it
 * as a wasted ballot. `protected` is everyone else's vote that he cancelled.
 */
export type DiscardReason =
  | 'self-vote'
  | 'looier'
  | 'no-target'
  | 'bodyguard-protects'
  | 'protected';

export interface DayResult {
  outcome: DayOutcome;
  eliminated: SeatIndex[];
  tally: Record<SeatIndex, number>;
  /** Which teams achieved their win condition. */
  teamsWon: Record<Team, boolean>;
  /** seat -> did this player win, judged on their FINAL card (§6.0). */
  seatWon: Record<SeatIndex, boolean>;
  /** Votes discarded and why — useful for the results screen. */
  discarded: { voter: SeatIndex; reason: DiscardReason }[];
  /**
   * Seats the Bodyguard shielded. Every vote against them was cancelled.
   * Public once the game is over — it is most of the story of the vote.
   */
  protectedSeats: SeatIndex[];
}

export interface DayOptions {
  /**
   * §7 flags tie handling as tentative. 'wolves-win' matches the doc as
   * written; 'nobody-dies' is the alternative if it plays badly.
   */
  tieRule: 'wolves-win';
}

export const DEFAULT_DAY_OPTIONS: DayOptions = { tieRule: 'wolves-win' };

/**
 * Resolve the day phase.
 *
 * Every role judgement below uses the player's FINAL card per §6.0 — the Looier
 * whose vote is discarded is whoever *ends* the night holding the Looier card,
 * not whoever was dealt it.
 */
export function resolveDay(
  state: NightState,
  votes: Vote[],
  options: DayOptions = DEFAULT_DAY_OPTIONS,
): DayResult {
  const seats = Array.from({ length: state.seatCount }, (_, i) => i);
  const finalRole = (seat: SeatIndex) => finalRoleOf(state, seat);

  const tally: Record<SeatIndex, number> = {};
  for (const seat of seats) tally[seat] = 0;
  const discarded: DayResult['discarded'] = [];

  // §7: a simultaneous majority to abstain overrides the tally entirely.
  const abstaining = votes.filter((v) => v.abstain).length;
  if (abstaining * 2 > state.seatCount) {
    return finish(state, 'no-vote', [], tally, discarded, []);
  }

  // ---- pass 1: the Bodyguard shields, he does not vote --------------------
  //
  // RULED 2026-08-26. The Bodyguard names somebody and every vote against that
  // person is cancelled — his own included, because he is not casting one. He
  // cannot name himself (§7 forbids it and the rules reject it), which is what
  // keeps him killable: if he is lynched, he is lynched, and there is no
  // special void any more.
  //
  // Whoever ENDS the night holding the Bodyguard card does this (§6.0), so a
  // player whose card was swapped away is shielding nobody while the player who
  // received it shields without knowing they did.
  const protectedSeats = new Set<SeatIndex>();
  for (const vote of votes) {
    if (finalRole(vote.voter) !== 'bodyguard') continue;
    discarded.push({ voter: vote.voter, reason: 'bodyguard-protects' });
    if (vote.target !== null && vote.target !== vote.voter) {
      protectedSeats.add(vote.target);
    }
  }

  // ---- pass 2: the tally --------------------------------------------------
  for (const vote of votes) {
    if (finalRole(vote.voter) === 'bodyguard') continue; // already accounted for
    if (vote.target === null) {
      discarded.push({ voter: vote.voter, reason: 'no-target' });
      continue;
    }
    if (vote.target === vote.voter) {
      // The UI must make this unselectable; belt and braces.
      discarded.push({ voter: vote.voter, reason: 'self-vote' });
      continue;
    }
    if (finalRole(vote.voter) === 'looier') {
      // §7: the Looier may vote for flavour, but it never counts.
      discarded.push({ voter: vote.voter, reason: 'looier' });
      continue;
    }
    if (protectedSeats.has(vote.target)) {
      discarded.push({ voter: vote.voter, reason: 'protected' });
      continue;
    }
    tally[vote.target] = (tally[vote.target] ?? 0) + 1;
  }

  const protectedList = [...protectedSeats];

  const max = Math.max(0, ...seats.map((s) => tally[s] ?? 0));
  if (max === 0) return finish(state, 'tie', [], tally, discarded, protectedList);

  // EVERYONE on the top count hangs (Milan, 2026-08-26). A tie is no longer a
  // reprieve — it is a double execution, and it is how the Looier most often
  // sneaks a win: being tied is enough.
  const top = seats.filter((s) => (tally[s] ?? 0) === max);
  const eliminated: SeatIndex[] = [...top];

  // Jager: if voted out, whoever they voted for dies too. With ties this can
  // now kill three people. The shot is NOT a vote, so the Bodyguard's shield
  // does not stop it — he cancels ballots, not bullets.
  for (const seat of top) {
    if (finalRole(seat) !== 'jager') continue;
    const shot = votes.find((v) => v.voter === seat)?.target;
    if (shot !== null && shot !== undefined && !eliminated.includes(shot)) {
      eliminated.push(shot);
    }
  }

  return finish(
    state,
    top.length > 1 ? 'tie' : 'eliminated',
    eliminated,
    tally,
    discarded,
    protectedList,
  );
}

function finish(
  state: NightState,
  outcome: DayOutcome,
  eliminated: SeatIndex[],
  tally: Record<SeatIndex, number>,
  discarded: DayResult['discarded'],
  protectedSeats: SeatIndex[],
): DayResult {
  const seats = Array.from({ length: state.seatCount }, (_, i) => i);
  const finalRole = (seat: SeatIndex) => finalRoleOf(state, seat);

  const wolfDied = eliminated.some((s) => isWolfRole(finalRole(s)));
  const innocentDied = eliminated.some((s) => !isWolfRole(finalRole(s)));
  const looierDied = eliminated.some((s) => finalRole(s) === 'looier');
  const anyWolfAmongPlayers = seats.some((s) => isWolfRole(finalRole(s)));

  // §8, RULED 2026-08-25, REVISED 2026-08-26 for multiple deaths.
  //
  // A Looier win beats everything: if the Looier is lynched they win ALONE and
  // both other teams lose, even if a wolf died in the same vote. This is
  // checked first because it short-circuits the rest.
  //
  // Otherwise THE VILLAGE WINS ONLY IF IT HANGED WOLVES AND NOBODY ELSE. That
  // one sentence covers every case Milan set out: a wolf and a villager tied
  // together is a wolf win; two wolves is a village win; two villagers is a
  // wolf win. It also leaves the single-victim cases exactly as they were, and
  // it reads the same whether the extra death came from a tie or the Jager's
  // shot — which is the point of stating it as a rule rather than a table.
  //
  // If every wolf card ended up in the centre, no player is a wolf: the wolves
  // cannot win at all, and the village wins only if nobody is lynched — so a
  // village that lynches an innocent loses a game containing no wolves, and
  // nobody wins that round. That makes the abstain mechanic load-bearing.
  //
  // All of this is judged on FINAL cards (§6.0); dealt roles are irrelevant.
  let villageWon: boolean;
  let wolvesWon: boolean;

  if (looierDied) {
    villageWon = false;
    wolvesWon = false;
  } else if (anyWolfAmongPlayers) {
    villageWon = wolfDied && !innocentDied;
    wolvesWon = !villageWon;
  } else {
    villageWon = eliminated.length === 0;
    wolvesWon = false;
  }

  const teamsWon: Record<Team, boolean> = {
    village: villageWon,
    wolf: wolvesWon,
    solo: looierDied,
  };

  const seatWon: Record<SeatIndex, boolean> = {};
  for (const seat of seats) {
    seatWon[seat] = teamsWon[teamOf(finalRole(seat))];
  }

  return { outcome, eliminated, tally, teamsWon, seatWon, discarded, protectedSeats };
}

/**
 * How a single vote scored (§10).
 *
 * `caused-village-loss` is deliberately its own category rather than being
 * folded into 'incorrect'. It is the Bodyguard case Milan asked to track
 * separately: their target actually WAS lynched and the village lost as a
 * result. That is a materially different event from an ordinary wrong guess —
 * the vote had consequences — and collapsing it into a boolean would make it
 * unrecoverable from the stored results.
 */
export type VoteOutcome =
  | 'correct'
  | 'incorrect'
  | 'caused-village-loss'
  | 'inconsequential'
  | 'not-scored';

/** Convenience for leaderboards: does this outcome count toward accuracy? */
export function isScored(outcome: VoteOutcome): boolean {
  return outcome === 'correct'
    || outcome === 'incorrect'
    || outcome === 'caused-village-loss';
}

export function isCorrect(outcome: VoteOutcome): boolean {
  return outcome === 'correct';
}

/**
 * §10 vote accuracy, scored against the voter's OWN win condition rather than
 * "did you point at a wolf" — a wolf voting for a fellow wolf scores as wrong.
 *
 * The Bodyguard is scored by CONSEQUENCE rather than by target, because his
 * power is defensive and does not attach to a guess (Milan, 2026-08-25;
 * rewritten 2026-08-26 when the shield replaced the vote):
 *   - nobody was voting for the person he shielded -> 'inconsequential'
 *   - he cancelled votes and the village won       -> 'correct'
 *   - he cancelled votes and the village lost      -> 'caused-village-loss'
 *
 * That middle case is the one Milan asked to keep separate, and the new rule
 * makes it sharper than it was: shielding a wolf who was about to hang is now
 * a specific, identifiable way to lose the village the game, and it stays
 * distinguishable from an ordinary bad guess forever.
 *
 * Needs the resolved day to know what actually happened, hence `result`.
 */
export function voteOutcomes(
  state: NightState,
  votes: Vote[],
  result: DayResult,
): Record<SeatIndex, VoteOutcome> {
  const out: Record<SeatIndex, VoteOutcome> = {};

  for (const vote of votes) {
    const own = finalRoleOf(state, vote.voter);

    if (vote.target === null) {
      out[vote.voter] = 'not-scored';
      continue;
    }

    if (own === 'bodyguard') {
      // Did the shield actually stop anything? Count the ballots it cancelled.
      const cancelled = result.discarded.filter(
        (d) => d.reason === 'protected'
          && votes.find((v) => v.voter === d.voter)?.target === vote.target,
      ).length;
      if (cancelled === 0) {
        out[vote.voter] = 'inconsequential';
      } else {
        out[vote.voter] = result.teamsWon.village
          ? 'correct'
          : 'caused-village-loss';
      }
      continue;
    }

    const targetRole = finalRoleOf(state, vote.target);
    switch (teamOf(own)) {
      case 'village':
        out[vote.voter] = isWolfRole(targetRole) ? 'correct' : 'incorrect';
        break;
      case 'wolf':
        out[vote.voter] =
          !isWolfRole(targetRole) && targetRole !== 'looier'
            ? 'correct'
            : 'incorrect';
        break;
      case 'solo':
        // The Looier's only correct play is getting themself voted out, which
        // their own vote cannot achieve. Not scoreable.
        out[vote.voter] = 'not-scored';
        break;
    }
  }
  return out;
}

/**
 * Boolean view of the above, for callers that only want accuracy.
 * `null` covers both 'inconsequential' and 'not-scored'; a
 * 'caused-village-loss' reads as false here, so use voteOutcomes() when you
 * need to tell the two apart.
 */
export function voteAccuracy(
  state: NightState,
  votes: Vote[],
  result: DayResult,
): Record<SeatIndex, boolean | null> {
  const outcomes = voteOutcomes(state, votes, result);
  const out: Record<SeatIndex, boolean | null> = {};
  for (const [seat, outcome] of Object.entries(outcomes)) {
    out[Number(seat)] = isScored(outcome) ? isCorrect(outcome) : null;
  }
  return out;
}
