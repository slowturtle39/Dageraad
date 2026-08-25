import { resolveDay, voteOutcomes, type DayOptions, type DayResult, type Vote, type VoteOutcome } from '../engine/dayphase.js';
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
  voteWindowMs: number;
  /** The window in which a majority-abstain can end the vote early (§7). */
  finalMinuteMs: number;
  /** How often to check for a majority abstain during the final minute. */
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
  voteWindowMs: 60_000,
  finalMinuteMs: 60_000,
  abstainPollMs: 1_000,
  seatCount: 0,
};

export interface DayStore {
  /** Current votes, keyed by seat. Read only by the referee until results. */
  readVotes(): Promise<Map<SeatIndex, Vote>>;
  setPhase(phase: 'day' | 'voting' | 'results'): Promise<void>;
  /** Public: everyone should see the extension land, it is not secret. */
  announceExtension(extraMs: number): Promise<void>;
}

export interface DayRunResult {
  result: DayResult;
  outcomes: Record<SeatIndex, VoteOutcome>;
  /** Whether the 50/50 extension fired. */
  extended: boolean;
  /** Whether a majority-abstain ended the vote before the timer ran out. */
  endedByAbstain: boolean;
}

export interface DayRunnerOptions {
  state: NightState;
  store: DayStore;
  clock: Clock;
  config?: DayConfig;
  dayOptions?: DayOptions;
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

  let extended = false;

  await store.setPhase('day');

  if (config.discussionEnabled) {
    await clock.sleep(config.discussionMs);

    // Rolled only AFTER the timer expires, so nobody can time their accusation
    // around a known answer. The result is public the moment it happens.
    if (config.suspenseExtension && random() < 0.5) {
      extended = true;
      await store.announceExtension(config.suspenseExtensionMs);
      await clock.sleep(config.suspenseExtensionMs);
    }
  }

  await store.setPhase('voting');
  const endedByAbstain = await runVoteWindow(store, clock, config);

  const votes = [...(await store.readVotes()).values()];
  const result = resolveDay(opts.state, votes, opts.dayOptions);
  await store.setPhase('results');

  return {
    result,
    outcomes: voteOutcomes(opts.state, votes, result),
    extended,
    endedByAbstain,
  };
}

/**
 * Sit out the voting window, watching for a majority abstain in its final
 * minute (§7).
 *
 * The check is "more than 50% have the toggle on AT THE SAME TIME", not "more
 * than 50% have touched it at some point" — it is a simultaneous show of hands,
 * so somebody switching theirs back off genuinely undoes it.
 *
 * Polling is confined to the final minute on purpose. Watching from the start
 * would let the group discover the threshold had been met early and end the
 * vote before anyone had to commit in front of the others, which is the whole
 * tension the rule is trying to create.
 */
async function runVoteWindow(
  store: DayStore,
  clock: Clock,
  config: DayConfig,
): Promise<boolean> {
  const quietMs = Math.max(0, config.voteWindowMs - config.finalMinuteMs);
  if (quietMs > 0) await clock.sleep(quietMs);

  const watchMs = config.voteWindowMs - quietMs;
  let elapsed = 0;
  while (elapsed < watchMs) {
    const step = Math.min(config.abstainPollMs, watchMs - elapsed);
    await clock.sleep(step);
    elapsed += step;

    const votes = await store.readVotes();
    if (isMajorityAbstaining(votes, config.seatCount)) return true;
  }
  return false;
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
