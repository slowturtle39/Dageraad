import { describe, expect, it } from 'vitest';
import { isMajorityReadyToVote, readyToVoteCount, type Vote } from '../engine/dayphase.js';
import { runDay, DEFAULT_DAY_CONFIG, type DayStore } from './dayrunner.js';
import { FakeClock } from './clock.js';
import { createNightState } from '../engine/state.js';
import type { RoleId, SeatIndex } from '../engine/types.js';

/**
 * "We are done arguing — open the ballot."
 *
 * A DIFFERENT question from abstaining, and the difference is the whole
 * feature. Abstaining is about the OUTCOME: nobody hangs, the round ends.
 * This is about the CLOCK: we have finished, start the vote. A table that
 * worked it out twelve minutes early should not have to choose between
 * sitting out the timer and throwing the round away.
 */

const ROLES: RoleId[] = ['weerwolf', 'ziener', 'dorpeling', 'dorpeling', 'jager'];

function votes(entries: Array<Partial<Vote> & { voter: number }>): Map<SeatIndex, Vote> {
  const map = new Map<SeatIndex, Vote>();
  for (const e of entries) {
    map.set(e.voter as SeatIndex, {
      voter: e.voter as SeatIndex, target: e.target ?? null,
      abstain: e.abstain ?? false, readyToVote: e.readyToVote ?? false,
    });
  }
  return map;
}

describe('the majority that opens the ballot', () => {
  it('needs strictly more than half', () => {
    // Exactly half is a table split down the middle. It has not agreed on
    // anything, and letting it cut the discussion short would let one half
    // take the clock away from the other.
    expect(isMajorityReadyToVote(votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
    ]), 4)).toBe(false);

    expect(isMajorityReadyToVote(votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
      { voter: 2, readyToVote: true },
    ]), 4)).toBe(true);
  });

  it('works the same way for an odd table', () => {
    expect(isMajorityReadyToVote(votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
    ]), 5)).toBe(false);
    expect(isMajorityReadyToVote(votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
      { voter: 2, readyToVote: true },
    ]), 5)).toBe(true);
  });

  it('is not the same thing as abstaining', () => {
    // Three abstainers are not three people asking to vote, and vice versa.
    expect(isMajorityReadyToVote(votes([
      { voter: 0, abstain: true }, { voter: 1, abstain: true },
      { voter: 2, abstain: true },
    ]), 5)).toBe(false);
  });

  it('counts hands, and says nothing about whose', () => {
    expect(readyToVoteCount(votes([
      { voter: 0, readyToVote: true }, { voter: 1 }, { voter: 3, readyToVote: true },
    ]))).toBe(2);
  });
});

/** A store whose votes a test can change while the discussion is running. */
class ScriptedStore implements DayStore {
  current = new Map<SeatIndex, Vote>();
  readonly phases: string[] = [];
  extensions = 0;

  async readVotes() { return this.current; }
  async setPhase(phase: 'day' | 'voting' | 'results') { this.phases.push(phase); }
  async announceExtension() { this.extensions += 1; }
}

function state() {
  return createNightState({
    seatCount: 5, seatRoles: ROLES,
    centerRoles: ['dorpeling', 'dorpeling', 'dorpeling'],
  });
}

const CONFIG = {
  ...DEFAULT_DAY_CONFIG,
  discussionMs: 10_000,
  abstainPollMs: 1_000,
  voteWaitTimeoutMs: 10_000,
  seatCount: 5,
  suspenseExtension: false,
};

/** Drive the clock, letting a script rewrite the votes as time passes. */
async function play(
  store: ScriptedStore,
  script: (elapsedMs: number) => void,
) {
  const clock = new FakeClock();
  const running = runDay({ state: state(), store, clock, config: CONFIG });

  let elapsed = 0;
  for (let i = 0; i < 200; i++) {
    for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
    script(elapsed);
    await clock.advance(1_000);
    elapsed += 1_000;
  }
  for (let y = 0; y < 8; y++) await new Promise((r) => setImmediate(r));
  return running;
}

describe('a majority ends the discussion early', () => {
  it('opens the ballot as soon as the hands are up', async () => {
    const store = new ScriptedStore();
    // Everyone votes normally once the ballot opens, so the round can finish.
    const result = await play(store, (elapsed) => {
      if (elapsed === 2_000) {
        store.current = votes([
          { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
          { voter: 2, readyToVote: true },
        ]);
      }
      if (elapsed >= 4_000) {
        store.current = votes([
          { voter: 0, target: 1 }, { voter: 1, target: 0 }, { voter: 2, target: 0 },
          { voter: 3, target: 0 }, { voter: 4, target: 0 },
        ]);
      }
    });

    expect(store.phases).toEqual(['day', 'voting', 'results']);
    // Ended by the ballot, NOT by everybody giving up.
    expect(result.endedByAbstain).toBe(false);
  });

  it('does not open on exactly half', async () => {
    // Four seated, two asking. The discussion runs its full length.
    const store = new ScriptedStore();
    const config = { ...CONFIG, seatCount: 4 };
    const clock = new FakeClock();
    const running = runDay({ state: state(), store, clock, config });

    store.current = votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
    ]);

    let openedEarly = false;
    for (let i = 0; i < 9; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
      if (store.phases.includes('voting')) openedEarly = true;
    }
    expect(openedEarly).toBe(false);

    // Let it finish so the test does not leak a pending run.
    store.current = votes([
      { voter: 0, target: 1 }, { voter: 1, target: 0 },
      { voter: 2, target: 0 }, { voter: 3, target: 0 },
    ]);
    for (let i = 0; i < 40; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    await running;
  });

  it('a withdrawn request stops it, right up to the moment it holds', async () => {
    // The reversibility is the point: it is a show of hands, so putting yours
    // back down genuinely undoes it.
    const store = new ScriptedStore();
    const clock = new FakeClock();
    const running = runDay({ state: state(), store, clock, config: CONFIG });

    const three = votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
      { voter: 2, readyToVote: true },
    ]);
    const two = votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
      { voter: 2, readyToVote: false },
    ]);

    // Raise three hands and lower one again BEFORE the next poll reads them.
    store.current = three;
    store.current = two;

    let openedEarly = false;
    for (let i = 0; i < 9; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
      if (store.phases.includes('voting')) openedEarly = true;
    }
    expect(openedEarly).toBe(false);

    store.current = votes([
      { voter: 0, target: 1 }, { voter: 1, target: 0 }, { voter: 2, target: 0 },
      { voter: 3, target: 0 }, { voter: 4, target: 0 },
    ]);
    for (let i = 0; i < 40; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    await running;
  });

  it('skips the suspense extension, because the table just said it is done', async () => {
    // Two more minutes handed to a group that has just asked to vote reads as
    // the app ignoring them.
    const store = new ScriptedStore();
    const clock = new FakeClock();
    const running = runDay({
      state: state(), store, clock,
      config: { ...CONFIG, suspenseExtension: true },
      random: () => 0,     // the extension would always fire
    });

    store.current = votes([
      { voter: 0, readyToVote: true }, { voter: 1, readyToVote: true },
      { voter: 2, readyToVote: true },
    ]);

    for (let i = 0; i < 6; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    store.current = votes([
      { voter: 0, target: 1 }, { voter: 1, target: 0 }, { voter: 2, target: 0 },
      { voter: 3, target: 0 }, { voter: 4, target: 0 },
    ]);
    for (let i = 0; i < 40; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    const result = await running;
    expect(result.extended).toBe(false);
    expect(store.extensions).toBe(0);
  });

  it('an abstain majority still wins over a vote-now majority', async () => {
    // A table saying both "let us vote" and "let us not" has said the second
    // more strongly: end the round rather than open a ballot nobody wanted.
    const store = new ScriptedStore();
    const clock = new FakeClock();
    const running = runDay({ state: state(), store, clock, config: CONFIG });

    store.current = votes([
      { voter: 0, abstain: true, readyToVote: true },
      { voter: 1, abstain: true, readyToVote: true },
      { voter: 2, abstain: true, readyToVote: true },
    ]);

    for (let i = 0; i < 6; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    const result = await running;
    expect(result.endedByAbstain).toBe(true);
    expect(store.phases).not.toContain('voting');
  });
});

describe('the count is published, the names are not', () => {
  it('reports how many, and how many are needed', async () => {
    const store = new ScriptedStore();
    const seen: Array<[number, number]> = [];
    const clock = new FakeClock();
    const running = runDay({
      state: state(), store, clock, config: CONFIG,
      hooks: { onEarlyVoteProgress: (ready, needed) => { seen.push([ready, needed]); } },
    });

    store.current = votes([{ voter: 0, readyToVote: true }]);
    for (let i = 0; i < 4; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    expect(seen.some(([ready, needed]) => ready === 1 && needed === 3)).toBe(true);

    store.current = votes([
      { voter: 0, target: 1 }, { voter: 1, target: 0 }, { voter: 2, target: 0 },
      { voter: 3, target: 0 }, { voter: 4, target: 0 },
    ]);
    for (let i = 0; i < 40; i++) {
      for (let y = 0; y < 6; y++) await new Promise((r) => setImmediate(r));
      await clock.advance(1_000);
    }
    await running;
  });
});
