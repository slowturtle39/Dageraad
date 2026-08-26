import { describe, expect, it } from 'vitest';
import { createNightState } from '../engine/state.js';
import { randomBot } from '../engine/bot.js';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { buildTimeline } from '../engine/timeline.js';
import type { Prompt, RoleId, SeatIndex } from '../engine/types.js';
import { FakeClock } from './clock.js';
import { runNight } from './referee.js';
import { InMemoryRoomStore } from './store.js';
import { mayRecordResults, SandboxStore, TEST_MODE_BANNER } from './sandbox.js';

function standardDeal() {
  const seats: RoleId[] = [
    'droomwolf', 'alphawolf', 'mystiekewolf', 'dubbelganger',
    'heks', 'leerlingziener', 'dorpsgek', 'medium',
  ];
  return createNightState({
    seatCount: seats.length, seatRoles: seats,
    centerRoles: ['dorpeling', 'looier', 'jager'],
    alphaWolfCardRole: 'weerwolf',
  });
}

async function playTestGame(botSeats: SeatIndex[]) {
  const inner = new InMemoryRoomStore();
  const store = new SandboxStore(inner);
  const clock = new FakeClock();
  const timeline = buildTimeline(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);

  const running = runNight({
    state: standardDeal(),
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    store, clock,
    bots: { seats: new Set(botSeats), bot: randomBot(1234) },
  });

  const tick = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  };
  for (const phase of timeline.phases) {
    await tick();
    await clock.advance(phase.endMs - phase.startMs + 1);
  }
  await tick();
  await clock.advance(1000);
  await tick();

  return { out: await running, inner, store };
}

describe('test mode cannot touch anything permanent', () => {
  it('records no latency samples, however many the night generated', async () => {
    // THE DANGEROUS ONE. Bots answer instantly, so a test night's timings are
    // nonsense. Feeding them to calibration would drag every future window
    // towards zero and start costing real players their turns — weeks later,
    // at a real table, looking like a completely unrelated bug.
    const { inner, store } = await playTestGame([1, 2, 3, 4, 5, 6, 7]);
    expect(inner.latency).toEqual([]);
    expect(store.blocked.some((b) => b.method.startsWith('recordLatency'))).toBe(true);
  });

  it('refuses to write results to anyone permanent record', () => {
    // Stats aggregate from append-only documents, so a test game would inflate
    // somebody's record with games they never played — and there is no delete
    // path, by design.
    expect(mayRecordResults('test')).toBe(false);
    expect(mayRecordResults('live')).toBe(true);
  });

  it('still runs the parts you are actually testing', async () => {
    const { out, inner } = await playTestGame([1, 2, 3, 4, 5, 6, 7]);
    expect(out.result).toBeDefined();
    expect(inner.released.size).toBeGreaterThan(0);   // reveals were delivered
    expect(inner.phase).toBe('day');                  // the night completed
  });

  it('says out loud that it is a test', () => {
    expect(TEST_MODE_BANNER.nl).toMatch(/TESTMODUS/);
    expect(TEST_MODE_BANNER.en).toMatch(/TEST MODE/);
    for (const banner of Object.values(TEST_MODE_BANNER)) {
      expect(banner).toMatch(/bots?/i);
      expect(banner).toMatch(/stat/i);
    }
  });
});

describe('bots', () => {
  it('play every seat except the ones you keep', async () => {
    // Seat 0 is you: nothing is generated for it, so its decisions time out
    // rather than being answered on your behalf.
    const { out } = await playTestGame([1, 2, 3, 4, 5, 6, 7]);
    expect(out.timedOut.every((r) => r.seat === 0)).toBe(true);
  });

  it('do not shorten their window by answering instantly', async () => {
    // If a bot's microsecond answer collapsed the window, test mode would stop
    // testing the one property the whole timing design exists for.
    const { out } = await playTestGame([0, 1, 2, 3, 4, 5, 6, 7]);
    const expected = buildTimeline(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);
    expect(out.timeline.totalMs).toBe(expected.totalMs);
  });

  it('are reproducible from a seed, so a bug found can be chased', async () => {
    const a = await playTestGame([1, 2, 3, 4, 5, 6, 7]);
    const b = await playTestGame([1, 2, 3, 4, 5, 6, 7]);
    expect(b.out.result.state.slots).toEqual(a.out.result.state.slots);
  });

  it('produce legal choices for every prompt shape', async () => {
    const state = standardDeal();
    const bot = randomBot(7);
    const seats = [0, 1, 2];
    const prompts: Prompt[] = [
      { kind: 'seat', exclude: seats, optional: false },
      { kind: 'two-seats', exclude: [] },
      { kind: 'center', count: 1 },
      { kind: 'dorpsgek', variant: 'standard' },
      { kind: 'confirm' },
    ];
    for (const prompt of prompts) {
      const choice = bot.choose(
        { seat: 5, actingAs: 'ziener', step: 1, key: 'k', prompt, dependsOnReveal: false },
        state,
      );
      expect(choice.kind).toBeTruthy();
      if (choice.kind === 'seat') expect(seats).not.toContain(choice.seat);
      if (choice.kind === 'center') {
        for (const i of choice.centerIndices) expect(i).toBeLessThan(state.centerCount);
      }
    }
  });

  it('never vote for themselves', () => {
    const state = standardDeal();
    const bot = randomBot(3);
    for (let i = 0; i < 50; i++) {
      const v = bot.chooseVote(2, state);
      expect(v.target).not.toBe(2);
    }
  });
});
