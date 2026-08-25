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

  // §8. NOTE: the doc does not cover the case where every wolf card ended up in
  // the centre, so no player is a wolf. Standard One Night handling is applied
  // here — the village wins only if nobody is lynched — and this is flagged in
  // the README as an open rule to confirm with the group.
  const villageWon = anyWolfAmongPlayers ? wolfDied : eliminated.length === 0;
  const wolvesWon = anyWolfAmongPlayers && !wolfDied;

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
 * §10 vote accuracy, scored against the voter's OWN win condition rather than
 * "did you point at a wolf" — a wolf voting for a fellow wolf scores as wrong.
 *
 * The Bodyguard is deliberately absent: §10 flags what "correct" even means for
 * them as an open question, so they score null rather than a guessed value.
 */
export function voteAccuracy(
  state: NightState,
  votes: Vote[],
): Record<SeatIndex, boolean | null> {
  const out: Record<SeatIndex, boolean | null> = {};
  for (const vote of votes) {
    const own = finalRoleOf(state, vote.voter);
    if (own === 'bodyguard' || vote.target === null) {
      out[vote.voter] = null;
      continue;
    }
    const targetRole = finalRoleOf(state, vote.target);
    switch (teamOf(own)) {
      case 'village':
        out[vote.voter] = isWolfRole(targetRole);
        break;
      case 'wolf':
        out[vote.voter] = !isWolfRole(targetRole) && targetRole !== 'looier';
        break;
      case 'solo':
        // The Looier's only correct play is getting themself voted out, which
        // their own vote cannot achieve. Not scoreable.
        out[vote.voter] = null;
        break;
    }
  }
  return out;
}
