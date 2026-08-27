import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { FakeClock } from '../orchestration/clock.js';
import { botSeatsFor, demoTable, seatDemoBots } from './demoworld.js';
import { readRoomOnce, runGame } from './refereeRunner.js';
import { screenFor } from './shell.js';
import type { PrivateView } from './backend.js';
import type { SeatIndex } from '../engine/types.js';

/**
 * One whole round, driven the way the app drives it.
 *
 * game.integration.test.ts already proves the referee can play a night. This
 * one proves the APP's path through it: the same demo table `?demo` builds,
 * the same runGame call main.ts makes, and — the part that was missing until
 * now — that a player device is actually told what it is being asked.
 *
 * That last piece is the one that cannot be checked from the referee's side.
 * A player cannot work out its own decisions: they come from the deal, and the
 * deal never leaves the referee. If the prompts stop being published, every
 * test about the night still passes and nobody at the table can do anything.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

const FAST = {
  openWindowMs: 400, resolvePadMs: 100,
  followupMs: {}, defaultFollowupMs: 400,
};
const FAST_DAY = { discussionMs: 500, voteWaitTimeoutMs: 2_000, abstainPollMs: 100 };

/** Drive the fake clock until the round finishes. */
async function play<T>(clock: FakeClock, running: Promise<T>): Promise<T> {
  let done = false;
  const settled = running.then((v) => { done = true; return v; });
  for (let i = 0; i < 4000 && !done; i++) {
    clock.advance(200);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  return settled;
}

async function dealtTable() {
  const table = demoTable(seeded(5), 7);
  const roomId = await table.me.createRoom({
    displayName: 'Milan',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    playing: true,
  });
  await seatDemoBots(table, roomId);
  return { table, roomId };
}

describe('the app can play a whole round', () => {
  it('deals, runs the night and the day, and publishes a result', async () => {
    const { table, roomId } = await dealtTable();
    const clock = new FakeClock();

    await table.me.startGame(roomId, 99);
    const dealt = await readRoomOnce(table.me, roomId);
    expect(dealt.phase).toBe('night');
    expect(dealt.seating).toHaveLength(8);

    // Every seat but this one is a bot, exactly as ?demo does it.
    const bots = botSeatsFor(table, dealt.seating, 3);
    const mySeat = dealt.seating.indexOf(table.me.uid) as SeatIndex;
    expect(bots.seats.has(mySeat)).toBe(false);

    const outcome = await play(clock, runGame({
      backend: table.me,
      roomId,
      clock,
      durations: FAST,
      dayConfig: FAST_DAY,
      bots: { ...bots, seats: new Set([...bots.seats, mySeat]) },
      random: seeded(7),
    }));

    expect(outcome.outcome).toBeTruthy();
    expect(Object.keys(outcome.finalRoles)).toHaveLength(8);

    const after = await readRoomOnce(table.me, roomId);
    expect(after.phase).toBe('results');
    expect(after.finalRoles).not.toBeNull();
    expect(after.outcome).toBeTruthy();
  }, 30_000);

  it('records the round on the evening scoreboard', async () => {
    const { table, roomId } = await dealtTable();
    const clock = new FakeClock();
    await table.me.startGame(roomId, 21);
    const dealt = await readRoomOnce(table.me, roomId);
    const bots = botSeatsFor(table, dealt.seating, 4);
    const mySeat = dealt.seating.indexOf(table.me.uid) as SeatIndex;

    await play(clock, runGame({
      backend: table.me, roomId, clock, durations: FAST, dayConfig: FAST_DAY,
      bots: { ...bots, seats: new Set([...bots.seats, mySeat]) },
      random: seeded(8),
    }));

    const room = await readRoomOnce(table.me, roomId);
    // Everybody played one round, and the scoreboard is rebuilt from it.
    expect(room.standings).toHaveLength(8);
    for (const s of room.standings) expect(s.roundsPlayed).toBe(1);
    expect(Math.max(...room.standings.map((s) => s.points))).toBeGreaterThan(0);
  }, 30_000);
});

describe('a player is told what it is being asked', () => {
  // Not checkable from the referee's side, and invisible to every other test:
  // if prompts stop being published, the night still resolves and nobody at
  // the table can do anything.
  it('publishes each seat its own decisions, and nobody else\'s', async () => {
    const { table, roomId } = await dealtTable();
    const clock = new FakeClock();
    await table.me.startGame(roomId, 77);
    const dealt = await readRoomOnce(table.me, roomId);
    const mySeat = dealt.seating.indexOf(table.me.uid) as SeatIndex;

    const seen: PrivateView[] = [];
    table.me.watchPrivate(roomId, (own) => { seen.push(own) });

    const bots = botSeatsFor(table, dealt.seating, 5);
    await play(clock, runGame({
      backend: table.me, roomId, clock, durations: FAST, dayConfig: FAST_DAY,
      // This seat is NOT a bot, so its prompts have to be published for a
      // human to answer — which is the thing under test.
      bots,
      random: seeded(9),
    }));

    const everyRequest = seen.flatMap((v) => v.pending);
    expect(everyRequest.length).toBeGreaterThan(0);
    for (const request of everyRequest) {
      expect(request.seat).toBe(mySeat);
    }
  }, 30_000);

  it('clears the prompt when a window has nothing for this seat', async () => {
    // Silence would leave the previous window's question sitting on the table.
    const { table, roomId } = await dealtTable();
    const clock = new FakeClock();
    await table.me.startGame(roomId, 31);
    const dealt = await readRoomOnce(table.me, roomId);

    const lengths: number[] = [];
    table.me.watchPrivate(roomId, (own) => { lengths.push(own.pending.length) });

    const bots = botSeatsFor(table, dealt.seating, 6);
    await play(clock, runGame({
      backend: table.me, roomId, clock, durations: FAST, dayConfig: FAST_DAY,
      bots, random: seeded(10),
    }));

    expect(lengths.some((n) => n === 0)).toBe(true);
  }, 30_000);
});

describe('the screen follows the round', () => {
  it('keeps a seated player on the table, and the result at the end', async () => {
    const { table, roomId } = await dealtTable();
    const clock = new FakeClock();
    await table.me.startGame(roomId, 12);

    const during = await readRoomOnce(table.me, roomId);
    expect(screenFor({ uid: table.me.uid, room: during, players: [] }).kind).toBe('table');

    const bots = botSeatsFor(table, during.seating, 11);
    const mySeat = during.seating.indexOf(table.me.uid) as SeatIndex;
    await play(clock, runGame({
      backend: table.me, roomId, clock, durations: FAST, dayConfig: FAST_DAY,
      bots: { ...bots, seats: new Set([...bots.seats, mySeat]) },
      random: seeded(13),
    }));

    const ended = await readRoomOnce(table.me, roomId);
    expect(screenFor({ uid: table.me.uid, room: ended, players: [] }).kind).toBe('results');
  }, 30_000);
});
