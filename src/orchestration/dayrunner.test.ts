import { describe, expect, it } from 'vitest';
import { createNightState } from '../engine/state.js';
import type { Vote } from '../engine/dayphase.js';
import type { RoleId, SeatIndex } from '../engine/types.js';
import { FakeClock } from './clock.js';
import {
  DEFAULT_DAY_CONFIG, isMajorityAbstaining, runDay, type DayConfig, type DayStore,
} from './dayrunner.js';

class TestDayStore implements DayStore {
  votes = new Map<SeatIndex, Vote>();
  phases: string[] = [];
  extensions: number[] = [];

  async readVotes() {
    return new Map(this.votes);
  }
  async setPhase(p: 'day' | 'voting' | 'results') {
    this.phases.push(p);
  }
  async announceExtension(ms: number) {
    this.extensions.push(ms);
  }
  cast(seat: SeatIndex, target: SeatIndex | null, abstain = false) {
    this.votes.set(seat, { voter: seat, target, abstain });
  }
}

function table(seatRoles: RoleId[]) {
  return createNightState({
    seatCount: seatRoles.length,
    seatRoles,
    centerRoles: ['jager', 'jager', 'jager'],
  });
}

const FAST: DayConfig = {
  ...DEFAULT_DAY_CONFIG,
  discussionMs: 10_000,
  suspenseExtensionMs: 4_000,
  voteWindowMs: 6_000,
  finalMinuteMs: 3_000,
  abstainPollMs: 1_000,
  seatCount: 5,
};

async function drive(clock: FakeClock, totalMs: number) {
  const tick = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  };
  for (let t = 0; t < totalMs; t += 500) {
    await tick();
    await clock.advance(500);
  }
  await tick();
}

describe('the suspense extension', () => {
  const state = table(['weerwolf', 'dorpeling', 'ziener', 'jager', 'medium']);

  it('never fires when the toggle is off, however the coin lands', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    const run = runDay({
      state, store, clock,
      config: { ...FAST, suspenseExtension: false },
      random: () => 0,          // would fire if it were consulted
    });
    await drive(clock, 40_000);
    const out = await run;
    expect(out.extended).toBe(false);
    expect(store.extensions).toEqual([]);
  });

  it('fires on a low roll and announces it publicly', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    const run = runDay({
      state, store, clock,
      config: { ...FAST, suspenseExtension: true },
      random: () => 0.2,
    });
    await drive(clock, 40_000);
    const out = await run;
    expect(out.extended).toBe(true);
    // Everyone sees the extension land — it is not a secret, it is the point.
    expect(store.extensions).toEqual([4_000]);
  });

  it('does not fire on a high roll', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    const run = runDay({
      state, store, clock,
      config: { ...FAST, suspenseExtension: true },
      random: () => 0.9,
    });
    await drive(clock, 40_000);
    expect((await run).extended).toBe(false);
  });

  it('is skipped entirely when playing without a discussion timer', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    const run = runDay({
      state, store, clock,
      config: { ...FAST, discussionEnabled: false, suspenseExtension: true },
      random: () => 0,
    });
    await drive(clock, 40_000);
    expect((await run).extended).toBe(false);
  });
});

describe('the majority-abstain threshold', () => {
  const v = (seat: number, abstain: boolean): [number, Vote] =>
    [seat, { voter: seat, target: null, abstain }];

  it('measures against everyone at the table, not against who has voted yet', () => {
    // Two abstentions among the first three people to tap. If the denominator
    // were the submissions, this would end the vote before most of an
    // eight-player table had touched their phone.
    const early = new Map([v(0, true), v(1, true), v(2, false)]);
    expect(isMajorityAbstaining(early, 8)).toBe(false);
    expect(isMajorityAbstaining(early, 3)).toBe(true);
  });

  it('needs strictly more than half — an exact half is not enough', () => {
    const half = new Map([v(0, true), v(1, true), v(2, false), v(3, false)]);
    expect(isMajorityAbstaining(half, 4)).toBe(false);
  });

  it('lets somebody switching back off undo it — it is a simultaneous show of hands', () => {
    const on = new Map([v(0, true), v(1, true), v(2, true)]);
    expect(isMajorityAbstaining(on, 5)).toBe(true);
    on.set(1, { voter: 1, target: null, abstain: false });
    expect(isMajorityAbstaining(on, 5)).toBe(false);
  });
});

describe('the vote window', () => {
  const state = table(['weerwolf', 'dorpeling', 'ziener', 'jager', 'medium']);

  it('ends early when a majority abstains during the final minute', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(0, null, true);
    store.cast(1, null, true);
    store.cast(2, null, true);   // 3 of 5
    store.cast(3, 0);
    store.cast(4, 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    const out = await run;

    expect(out.endedByAbstain).toBe(true);
    // §7/§8: wolves win on a deliberate no-vote, and nobody is lynched.
    expect(out.result.outcome).toBe('no-vote');
    expect(out.result.teamsWon.wolf).toBe(true);
  });

  it('runs to the end and tallies normally when nobody abstains', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(1, 0);
    store.cast(2, 0);
    store.cast(3, 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    const out = await run;

    expect(out.endedByAbstain).toBe(false);
    expect(out.result.eliminated).toEqual([0]);   // the wolf
    expect(out.result.teamsWon.village).toBe(true);
  });

  it('walks the phases in order', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    await run;
    expect(store.phases).toEqual(['day', 'voting', 'results']);
  });

  it('returns per-seat vote outcomes for the stats', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(1, 0);
    store.cast(2, 0);
    store.cast(3, 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    const out = await run;

    // Seat 1 is a Dorpeling who correctly pointed at the wolf.
    expect(out.outcomes[1]).toBe('correct');
  });
});
