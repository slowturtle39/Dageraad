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
  deadlines: Array<number | null> = [];
  forceVote = false;

  async readVotes() {
    return new Map(this.votes);
  }
  async setPhase(p: 'day' | 'voting' | 'results') {
    this.phases.push(p);
  }
  async announceExtension(ms: number) {
    this.extensions.push(ms);
  }
  async setDiscussionDeadline(endsAt: number | null) {
    this.deadlines.push(endsAt);
  }
  async practiceForceVoteRequested() {
    return this.forceVote;
  }
  cast(seat: SeatIndex, target: SeatIndex | null, abstain = false) {
    this.votes.set(seat, { voter: seat, target, abstain });
  }
}

describe('the shared discussion timer', () => {
  const state = table(['weerwolf', 'dorpeling', 'ziener', 'jager', 'medium']);

  it('publishes one deadline and clears it when voting opens', async () => {
    const store = new TestDayStore();
    for (let seat = 0; seat < 5; seat++) store.cast(seat as SeatIndex, (seat + 1) % 5 as SeatIndex);
    const clock = new FakeClock();
    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 20_000);
    await run;
    expect(store.deadlines).toEqual([10_000, null]);
  });

  it('lets the referee shortcut only the discussion, not the actual vote', async () => {
    const store = new TestDayStore();
    for (let seat = 0; seat < 5; seat++) store.cast(seat as SeatIndex, (seat + 1) % 5 as SeatIndex);
    store.forceVote = true;
    const clock = new FakeClock();
    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 2_000);
    await run;
    expect(store.phases).toEqual(['day', 'voting', 'results']);
    expect(store.deadlines).toEqual([10_000, null]);
  });
});

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
  voteWaitTimeoutMs: 8_000,
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

describe('voting is mandatory (Milan, 2026-08-26)', () => {
  const state = table(['weerwolf', 'dorpeling', 'ziener', 'jager', 'medium']);

  it('waits for every player rather than resolving without the slow one', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    // Only three of five have voted when the discussion timer expires.
    store.cast(1, 0);
    store.cast(2, 0);
    store.cast(3, 0);

    const progress: [number, number][] = [];
    const run = runDay({
      state, store, clock, config: FAST,
      hooks: { onVoteProgress: (cast, total) => progress.push([cast, total]) },
    });
    // Discussion is 10s and the safety bound is 8s, so 13s in we are inside
    // the voting phase with the vote still open.
    await drive(clock, 13_000);
    // Seats 0 and 4 arrive late — the vote must still be open for them.
    store.cast(0, 1);
    store.cast(4, 0);
    await drive(clock, 10_000);
    const out = await run;

    expect(out.missingVotes).toEqual([]);
    expect(progress.some(([cast]) => cast === 3)).toBe(true);
    expect(out.result.eliminated).toEqual([0]);
  });

  it('reports who is missing rather than silently resolving without them', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(1, 0);
    store.cast(2, 0);   // seats 0, 3, 4 never vote

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 60_000);
    const out = await run;

    // Reaching the safety bound means something is wrong and the host should
    // look — not that the game quietly went ahead.
    expect(out.missingVotes).toEqual([0, 3, 4]);
  });

  it('counts an explicit abstain as having voted — silence is not an answer', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(0, null, true);
    store.cast(1, 0);
    store.cast(2, 0);
    store.cast(3, 0);
    store.cast(4, 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    expect((await run).missingVotes).toEqual([]);
  });

  it('ends the discussion the moment a majority wants to skip the vote', async () => {
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

  it('tallies normally when everybody votes and nobody abstains', async () => {
    const store = new TestDayStore();
    const clock = new FakeClock();
    for (const seat of [0, 1, 2, 3, 4]) store.cast(seat, seat === 0 ? 1 : 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    const out = await run;

    expect(out.endedByAbstain).toBe(false);
    expect(out.result.eliminated).toEqual([0]);   // the wolf
    expect(out.result.teamsWon.village).toBe(true);
  });

  it('counts a majority from the very first seconds, not only near the end', async () => {
    // Milan, 2026-08-26: the group may decide not to vote AT ANY MOMENT. A
    // table that works out early that there is nothing to gain should be able
    // to stop, rather than sitting out a timer they have all given up on.
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(0, null, true);
    store.cast(1, null, true);
    store.cast(2, null, true);   // 3 of 5, before the discussion has run
    store.cast(3, 0);
    store.cast(4, 0);

    const run = runDay({ state, store, clock, config: FAST });
    // Only 2s of a 10s discussion — well before any "final minute" would start.
    await drive(clock, 2_500);
    await drive(clock, 20_000);
    const out = await run;

    expect(out.endedByAbstain).toBe(true);
    expect(out.result.outcome).toBe('no-vote');
    // The vote never opened, so nobody was asked to cast one.
    expect(store.phases).not.toContain('voting');
  });

  it('lets the group change its mind — a majority that lapses does not hold', async () => {
    // It is a simultaneous show of hands, so switching back off genuinely
    // undoes it. That is what keeps an early majority from being irreversible.
    const store = new TestDayStore();
    const clock = new FakeClock();
    store.cast(0, null, true);
    store.cast(1, null, true);
    store.cast(2, 0);
    store.cast(3, 0);
    store.cast(4, 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    const out = await run;
    expect(out.endedByAbstain).toBe(false);   // only 2 of 5 ever held it
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
    for (const seat of [0, 1, 2, 3, 4]) store.cast(seat, seat === 0 ? 1 : 0);

    const run = runDay({ state, store, clock, config: FAST });
    await drive(clock, 40_000);
    const out = await run;

    // Seat 1 is a Dorpeling who correctly pointed at the wolf.
    expect(out.outcomes[1]).toBe('correct');
  });
});
