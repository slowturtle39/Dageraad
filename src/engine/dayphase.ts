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

export type DayOutcome =
  | 'eliminated'
  | 'tie'
  | 'no-vote'
  | 'bodyguard-void';

export interface DayResult {
  outcome: DayOutcome;
  eliminated: SeatIndex[];
  tally: Record<SeatIndex, number>;
  /** Which teams achieved their win condition. */
  teamsWon: Record<Team, boolean>;
  /** seat -> did this player win, judged on their FINAL card (§6.0). */
  seatWon: Record<SeatIndex, boolean>;
  /** Votes discarded and why — useful for the results screen. */
  discarded: { voter: SeatIndex; reason: 'self-vote' | 'looier' | 'no-target' }[];
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
    return finish(state, 'no-vote', [], tally, discarded);
  }

  for (const vote of votes) {
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
    tally[vote.target] = (tally[vote.target] ?? 0) + 1;
  }

  const max = Math.max(0, ...seats.map((s) => tally[s] ?? 0));
  if (max === 0) return finish(state, 'tie', [], tally, discarded);

  const top = seats.filter((s) => (tally[s] ?? 0) === max);
  if (top.length > 1) return finish(state, 'tie', [], tally, discarded);

  const victim = top[0]!;

  // §6.1: if the Bodyguard themself is the top target, the vote is voided and
  // nobody dies. (Deliberately differs from the printed rulebook.)
  if (finalRole(victim) === 'bodyguard') {
    return finish(state, 'bodyguard-void', [], tally, discarded);
  }

  const eliminated: SeatIndex[] = [victim];

  // Jager: if voted out, whoever they voted for dies too.
  if (finalRole(victim) === 'jager') {
    const shot = votes.find((v) => v.voter === victim)?.target;
    if (shot !== null && shot !== undefined && !eliminated.includes(shot)) {
      eliminated.push(shot);
    }
  }

  return finish(state, 'eliminated', eliminated, tally, discarded);
}

function finish(
  state: NightState,
  outcome: DayOutcome,
  eliminated: SeatIndex[],
  tally: Record<SeatIndex, number>,
  discarded: DayResult['discarded'],
): DayResult {
  const seats = Array.from({ length: state.seatCount }, (_, i) => i);
  const finalRole = (seat: SeatIndex) => finalRoleOf(state, seat);

  const wolfDied = eliminated.some((s) => isWolfRole(finalRole(s)));
  const looierDied = eliminated.some((s) => finalRole(s) === 'looier');
  const anyWolfAmongPlayers = seats.some((s) => isWolfRole(finalRole(s)));

  // §8, RULED 2026-08-25.
  //
  // A Looier win beats everything: if the Looier is lynched they win ALONE and
  // both other teams lose, even if a wolf died in the same vote (which the
  // Jager can cause). This is checked first because it short-circuits the rest.
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
    villageWon = wolfDied;
    wolvesWon = !wolfDied;
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

  return { outcome, eliminated, tally, teamsWon, seatWon, discarded };
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
 * The Bodyguard is scored by CONSEQUENCE rather than by target, because their
 * power is defensive and doesn't attach to a vote target (Milan, 2026-08-25):
 *   - target wasn't lynched            -> 'inconsequential'
 *   - target was lynched, village won  -> 'correct'
 *   - target was lynched, village lost -> 'caused-village-loss'
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
      if (!result.eliminated.includes(vote.target)) {
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
