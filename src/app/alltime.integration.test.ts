import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { FakeClock } from '../orchestration/clock.js';
import { MemoryWorld } from './memorybackend.js';
import { botSeatsFor, demoTable, seatDemoBots } from './demoworld.js';
import { readRoomOnce, runGame } from './refereeRunner.js';
import { allTimeStandings, type HistoryRecord } from '../stats/alltime.js';
import type { Backend } from './backend.js';
import type { SeatIndex } from '../engine/types.js';

/**
 * The group's history, across evenings and across devices.
 *
 * The behaviours worth proving are the ones that only show up on the SECOND
 * evening, or on somebody's new phone — which is to say, months after anybody
 * would have noticed the bug in a single sitting.
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

const FAST = { openWindowMs: 200, resolvePadMs: 50, followupMs: {}, defaultFollowupMs: 200 };
const FAST_DAY = { discussionMs: 300, voteWaitTimeoutMs: 1_000, abstainPollMs: 50 };

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

function history(world: MemoryWorld): HistoryRecord[] {
  let seen: HistoryRecord[] = [];
  const stop = world.device('reader').watchHistory((h) => { seen = h; });
  stop();
  return seen;
}

/**
 * Play one whole evening of one round.
 *
 * `host` lets a later evening be run from a DIFFERENT device for the same
 * person, which is the case the friend profile exists for.
 */
async function evening(
  world: MemoryWorld,
  opts: {
    mode: 'practice' | 'official';
    friendId: string;
    friendName?: string;
    hostUid?: string;
    seed?: number;
  },
): Promise<string> {
  const me: Backend = world.device(opts.hostUid ?? `dev:${opts.friendId}`);
  const roomId = await me.createRoom({
    displayName: opts.friendName ?? 'Milan',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    playing: true,
    mode: opts.mode,
    friend: { friendId: opts.friendId, friendName: opts.friendName ?? 'Milan' },
  });

  // Company, so a round can be dealt at all.
  const table = { me, bots: [] as Backend[] };
  const names = ['Sanne', 'Joris', 'Fleur', 'Daan', 'Noor', 'Bram'];
  for (const name of names) {
    const bot = world.device(`bot:${roomId}:${name}`);
    await bot.joinRoom(roomId, name, { friendId: `f:${name}`, friendName: name });
    table.bots.push(bot);
  }

  const clock = new FakeClock();
  await me.startGame(roomId, opts.seed ?? 11);
  const dealt = await readRoomOnce(me, roomId);
  const bots = botSeatsFor(table as ReturnType<typeof demoTable>, dealt.seating, 3);
  const mySeat = dealt.seating.indexOf(me.uid) as SeatIndex;

  await play(clock, runGame({
    backend: me, roomId, clock, durations: FAST, dayConfig: FAST_DAY,
    bots,
    random: seeded(9),
    onPhase: (phase) => {
      if (phase === 'voting') {
        void me.vote(roomId, dealt.seating[(mySeat + 1) % dealt.seating.length]!, false);
      }
    },
  }));
  return roomId;
}

describe('one friend, two official evenings', () => {
  it('adds up across both, as one person', async () => {
    const world = new MemoryWorld(seeded(3));
    await evening(world, { mode: 'official', friendId: 'f:milan' });
    await evening(world, { mode: 'official', friendId: 'f:milan', seed: 22 });

    const rows = allTimeStandings(history(world));
    const milan = rows.find((r) => r.friendId === 'f:milan')!;
    expect(milan.rounds).toBe(2);
    expect(milan.evenings).toBe(2);
  });

  it('follows the person onto a different device', async () => {
    // The case this whole identity exists for: a new phone means a new
    // anonymous uid, and history must not fork underneath somebody.
    const world = new MemoryWorld(seeded(4));
    await evening(world, {
      mode: 'official', friendId: 'f:milan', hostUid: 'phone:old',
    });
    await evening(world, {
      mode: 'official', friendId: 'f:milan', hostUid: 'phone:new', seed: 33,
    });

    const rows = allTimeStandings(history(world));
    expect(rows.filter((r) => r.friendId === 'f:milan')).toHaveLength(1);
    expect(rows.find((r) => r.friendId === 'f:milan')!.evenings).toBe(2);
  });
});

describe('practice never reaches the record', () => {
  it('writes nothing at all to all-time', async () => {
    const world = new MemoryWorld(seeded(5));
    await evening(world, { mode: 'practice', friendId: 'f:milan' });
    expect(history(world)).toHaveLength(0);
    expect(allTimeStandings(history(world))).toEqual([]);
  });

  it('still plays and still scores the evening itself', async () => {
    // Practice is a real round, not a simulation. It simply does not count.
    const world = new MemoryWorld(seeded(6));
    const roomId = await evening(world, { mode: 'practice', friendId: 'f:milan' });
    const room = await readRoomOnce(world.device('dev:f:milan'), roomId);
    expect(room.standings).toHaveLength(7);
    for (const s of room.standings) expect(s.roundsPlayed).toBe(1);
  });

  it('leaves an official evening untouched beside it', async () => {
    // The actual worry: an evening of testing before the real one starts.
    const world = new MemoryWorld(seeded(7));
    await evening(world, { mode: 'practice', friendId: 'f:milan' });
    await evening(world, { mode: 'practice', friendId: 'f:milan', seed: 44 });
    await evening(world, { mode: 'official', friendId: 'f:milan', seed: 55 });

    const rows = allTimeStandings(history(world));
    const milan = rows.find((r) => r.friendId === 'f:milan')!;
    expect(milan.rounds).toBe(1);
    expect(milan.evenings).toBe(1);
  });
});

describe('the evening scoreboard is untouched by any of this', () => {
  it('still seeds a latecomer at the floor, and all-time does not', async () => {
    // Two separate questions with two separate answers: the seed is about one
    // night's ordering, and carrying it into all-time would make arriving late
    // a way to farm points.
    const world = new MemoryWorld(seeded(8));
    const roomId = await evening(world, { mode: 'official', friendId: 'f:milan' });

    const late = world.device('phone:late');
    await late.joinRoom(roomId, 'Laat', { friendId: 'f:laat', friendName: 'Laat' });

    const room = await readRoomOnce(late, roomId);
    const lowest = Math.min(...room.standings
      .filter((s) => s.uid !== late.uid && s.active)
      .map((s) => s.points));
    const row = room.standings.find((s) => s.uid === late.uid)!;
    expect(row.seeded).toBe(lowest);
    expect(row.roundsPlayed).toBe(0);

    // ...and they are simply not in the all-time table, having played nothing.
    const rows = allTimeStandings(history(world));
    expect(rows.find((r) => r.friendId === 'f:laat')).toBeUndefined();
  });
});

describe('somebody who never picked a profile', () => {
  it('plays the evening but does not appear in all-time', async () => {
    // We do not know who they were. Inventing an identity would put a stranger
    // in the group's history permanently, and the record has no delete path.
    const world = new MemoryWorld(seeded(9));
    const roomId = await evening(world, { mode: 'official', friendId: 'f:milan' });
    const anon = world.device('phone:anon');
    await anon.joinRoom(roomId, 'Anoniem');

    const room = await readRoomOnce(anon, roomId);
    expect(room.members.some((m) => m.uid === anon.uid)).toBe(true);
    expect(history(world).some((h) => h.name === 'Anoniem')).toBe(false);
  });
});

describe('the record is append-only in practice, not only in the rules', () => {
  it('does not double-count a round if it is recorded twice', async () => {
    const world = new MemoryWorld(seeded(10));
    const roomId = await evening(world, { mode: 'official', friendId: 'f:milan' });
    const me = world.device('dev:f:milan');
    const before = history(world).length;

    const room = await readRoomOnce(me, roomId);
    const rounds = await new Promise<Parameters<Parameters<Backend['watchRounds']>[1]>[0]>(
      (resolve) => {
        let seen: never[] = [] as never[];
        const stop = me.watchRounds(roomId, (r) => { seen = r as never[]; });
        stop();
        resolve(seen);
      },
    );
    await me.recordRound(roomId, rounds[0]!);

    expect(history(world)).toHaveLength(before);
    expect(room.round).toBe(1);
  });
});
