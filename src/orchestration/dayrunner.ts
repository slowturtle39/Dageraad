import {
  isMajorityReadyToVote, readyToVoteCount, resolveDay, voteOutcomes,
  type DayOptions, type DayResult, type Vote, type VoteOutcome,
} from '../engine/dayphase.js';
import type { NightState, SeatIndex } from '../engine/types.js';
import type { Clock } from './clock.js';

/**
 * The day phase: discussion, the suspense extension, then the vote (§7).
 *
 * Like the night runner this is pure orchestration — all the actual rules live
 * in `engine/dayphase.ts`. What lives here is only *when* things happen.
 */

export interface DayConfig {
  /** Playing with no timer at all is supported, not an afterthought (§7). */
  discussionEnabled: boolean;
  discussionMs: number;
  /**
   * The 50/50 two-minute extension, OFF by default (§7). It exists to punish
   * dropping an accusation in the last five seconds hoping nobody can answer
   * it — with this on, there is a real chance the discussion keeps going.
   */
  suspenseExtension: boolean;
  suspenseExtensionMs: number;
  votingMode: 'in-app' | 'irl';
  /**
   * Retained for saved configurations and older callers. Mandatory voting no
   * longer times out; a failed device is resolved through emergency takeover.
   */
  voteWaitTimeoutMs: number;
  /** How often to check whether a majority wants to skip the vote. */
  abstainPollMs: number;
  /** Total players at the table. The abstain threshold is measured against
   *  THIS, never against the number who happen to have voted so far. */
  seatCount: number;
}

export const DEFAULT_DAY_CONFIG: DayConfig = {
  discussionEnabled: true,
  discussionMs: 15 * 60_000,
  suspenseExtension: false,
  suspenseExtensionMs: 2 * 60_000,
  votingMode: 'in-app',
  voteWaitTimeoutMs: 10 * 60_000,
  abstainPollMs: 1_000,
  seatCount: 0,
};

export interface DayStore {
  /** Current votes, keyed by seat. Read only by the referee until results. */
  readVotes(): Promise<Map<SeatIndex, Vote>>;
  setPhase(phase: 'day' | 'voting' | 'results'): Promise<void>;
  /** Public: everyone should see the extension land, it is not secret. */
  announceExtension(extraMs: number): Promise<void>;
  /** Publish one shared countdown instead of letting every phone guess. */
  setDiscussionDeadline?(endsAt: number | null): Promise<void>;
  /** Practice-only referee shortcut, checked on the same poll as early votes. */
  practiceForceVoteRequested?(): Promise<boolean>;
}

export interface DayRunnerHooks {
  /**
   * How many have voted, out of how many. Safe to show publicly: it is a count,
   * never who voted for whom, and in the physical game you can see perfectly
   * well whose hand is still down. Needed to chase the last player.
   */
  onVoteProgress?: (cast: number, total: number) => void;
  /** Live abstain count, for the same reason. Runs the whole discussion. */
  onAbstainProgress?: (abstaining: number, needed: number) => void;
  /**
   * How many have asked to start voting, and how many it would take.
   *
   * A count, like the others. Publishing WHO asked would turn a show of hands
   * into a record of who was impatient, and at a table that is information
   * about how confident somebody is.
   */
  onEarlyVoteProgress?: (ready: number, needed: number) => void;
}

export interface DayRunResult {
  result: DayResult;
  outcomes: Record<SeatIndex, VoteOutcome>;
  /** Whether the 50/50 extension fired. */
  extended: boolean;
  /** Whether the group decided not to vote at all. */
  endedByAbstain: boolean;
  /** Seats that never cast a vote. Should be empty — voting is mandatory. */
  missingVotes: SeatIndex[];
}

export interface DayRunnerOptions {
  state: NightState;
  store: DayStore;
  clock: Clock;
  config?: DayConfig;
  dayOptions?: DayOptions;
  hooks?: DayRunnerHooks;
  /**
   * Source of the suspense coin flip. Injected so a game can be replayed and a
   * test can be deterministic — and so it is obvious that this is the ONLY
   * random thing in the whole system.
   */
  random?: () => number;
}

export async function runDay(opts: DayRunnerOptions): Promise<DayRunResult> {
  const config = {
    ...DEFAULT_DAY_CONFIG,
    seatCount: opts.state.seatCount,
    ...opts.config,
  };
  const random = opts.random ?? Math.random;
  const { store, clock } = opts;
  const hooks = opts.hooks ?? {};

  let extended = false;
  let endedByAbstain = false;

  await store.setPhase('day');
  await store.setDiscussionDeadline?.(
    config.discussionEnabled ? clock.now() + config.discussionMs : null,
  );

  // ---- discussion -------------------------------------------------------
  //
  // The group may decide not to vote AT ANY MOMENT (Milan, 2026-08-26). The
  // toggle is live from the first second, and the instant a majority holds it
  // the discussion ends — there is no window it has to survive until.
  //
  // This deliberately makes abstaining strong: a table that works out early
  // that there is nothing to gain can simply stop, rather than sitting out a
  // timer they have all already given up on.
  if (config.discussionEnabled) {
    let ending = await watchDiscussion(
      store, clock, config, config.discussionMs, hooks,
    );
    endedByAbstain = ending === 'abstain';

    // Rolled only AFTER the timer expires, so nobody can time their accusation
    // around a known answer. Public the moment it happens.
    //
    // Skipped entirely when the table ASKED to vote: the extension exists to
    // stretch a discussion nobody has finished, and a group that has just said
    // it is finished would read two more minutes as the app ignoring them.
    if (ending === 'expired' && config.suspenseExtension && random() < 0.5) {
      extended = true;
      await store.announceExtension(config.suspenseExtensionMs);
      await store.setDiscussionDeadline?.(clock.now() + config.suspenseExtensionMs);
      ending = await watchDiscussion(
        store, clock, config, config.suspenseExtensionMs, hooks,
      );
      endedByAbstain = ending === 'abstain';
    }
  }

  // ---- voting -----------------------------------------------------------
  let missingVotes: SeatIndex[] = [];
  if (!endedByAbstain) {
    await store.setDiscussionDeadline?.(null);
    await store.setPhase('voting');
    missingVotes = await waitForEveryVote(store, clock, config, hooks);

    // Once the ballot opens every seat names somebody. Abstaining belongs to
    // the discussion and cannot be introduced or changed here.
  }

  const votes = [...(await store.readVotes()).values()];
  const result = resolveDay(opts.state, votes, opts.dayOptions);
  await store.setPhase('results');

  return {
    result,
    outcomes: voteOutcomes(opts.state, votes, result),
    extended,
    endedByAbstain,
    missingVotes,
  };
}

/** Why the discussion stopped. */
type DiscussionEnd = 'abstain' | 'early' | 'expired';

/**
 * Watch the discussion, for the whole stretch handed to us.
 *
 * TWO majorities can end it, and they mean different things. A majority
 * ABSTAINING is a decision about the outcome: nobody hangs, and the round is
 * over. A majority READY TO VOTE is a decision about the clock: we have
 * finished arguing, open the ballot. Both are checked here because both are
 * simultaneous shows of hands with the same reversibility.
 *
 * The check is "more than half hold it AT THE SAME TIME", not "more than half
 * touched it at some point" — so putting your hand back down genuinely undoes
 * it, and the group can change its mind right up until the moment it holds.
 *
 * Abstain is tested first. If a table somehow reaches both at once it has said
 * both "let us vote" and "let us not"; the stronger statement wins, and it is
 * the one that ends the round rather than starting a ballot nobody wanted.
 */
async function watchDiscussion(
  store: DayStore,
  clock: Clock,
  config: DayConfig,
  durationMs: number,
  hooks: DayRunnerHooks,
): Promise<DiscussionEnd> {
  const needed = Math.floor(config.seatCount / 2) + 1;
  let elapsed = 0;
  while (elapsed < durationMs) {
    const step = Math.min(config.abstainPollMs, durationMs - elapsed);
    await clock.sleep(step);
    elapsed += step;

    const votes = await store.readVotes();
    const abstaining = [...votes.values()].filter((v) => v.abstain).length;
    hooks.onAbstainProgress?.(abstaining, needed);
    hooks.onEarlyVoteProgress?.(readyToVoteCount(votes), needed);

    if (isMajorityAbstaining(votes, config.seatCount)) return 'abstain';
    if (await store.practiceForceVoteRequested?.()) return 'early';
    if (isMajorityReadyToVote(votes, config.seatCount)) return 'early';
  }
  return 'expired';
}

/**
 * Wait until EVERY player has voted.
 *
 * Voting is mandatory once the timer has expired and the group did not abstain
 * (Milan, 2026-08-26). So this is not a race against a deadline: there is no
 * point at which a slow player is dropped and the tally resolves without them.
 * A vote counts as cast only when the player has named a target. Abstaining is
 * a discussion decision and is never a ballot response.
 *
 * There is deliberately no timeout resolution. A failed phone is handled by
 * the phrase-confirmed referee takeover; silently dropping that seat would
 * make a mandatory simultaneous ballot produce a result without everyone.
 */
async function waitForEveryVote(
  store: DayStore,
  clock: Clock,
  config: DayConfig,
  hooks: DayRunnerHooks,
): Promise<SeatIndex[]> {
  for (;;) {
    const votes = await store.readVotes();
    const cast = [...votes.values()].filter(
      (v) => v.target !== null,
    ).length;
    hooks.onVoteProgress?.(cast, config.seatCount);

    if (cast >= config.seatCount) return [];

    await clock.sleep(config.abstainPollMs);
  }
}

/**
 * Strictly more than half of EVERYONE AT THE TABLE (§7).
 *
 * The denominator is the seat count, not the number of vote documents written
 * so far. Measuring against submissions would mean two abstentions among the
 * first three people to tap counted as a majority of eight — the vote would end
 * before most of the table had touched their phone.
 */
export function isMajorityAbstaining(
  votes: Map<SeatIndex, Vote>,
  seatCount: number,
): boolean {
  if (seatCount <= 0) return false;
  const abstaining = [...votes.values()].filter((v) => v.abstain).length;
  return abstaining * 2 > seatCount;
}
