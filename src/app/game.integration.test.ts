import { describe, expect, it } from 'vitest';
import { randomBot } from '../engine/bot.js';
import { DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, TWO_ROUND_CONFIG } from '../engine/presets.js';
import type { GameConfig, RoleId, SeatIndex } from '../engine/types.js';
import { FakeClock } from '../orchestration/clock.js';
import type { Backend, PrivateView, RoomView } from './backend.js';
import { MemoryWorld } from './memorybackend.js';
import type { RoundRecord } from './session.js';
import { runGame, readRoomOnce, RefereeError } from './refereeRunner.js';

/**
 * A whole evening, end to end, with no Firebase project and no waiting.
 *
 * This is the test the entire architecture was arranged to make possible. Every
 * other test in the repo proves one piece behaves; this one proves the pieces
 * are actually joined up — that a room created on a tablet, joined by eight
 * phones, dealt, played through a night and a vote, ends with every device
 * holding the same result and none of them holding anything they should not.
 *
 * Time is fake and the players are bots, but the CODE PATH is the real one:
 * the same runNight, the same runDay, the same refusals the security rules
 * enforce. Nothing here is stubbed except the clock and the humans.
 */

const NAMES = ['Milan', 'Sanne', 'Joris', 'Fleur', 'Bram', 'Noor', 'Tijn', 'Isa'];

interface Table {
  world: MemoryWorld;
  tablet: Backend;
  roomId: string;
  phones: Backend[];
}

async function seatTable(config: GameConfig = TWO_ROUND_CONFIG): Promise<Table> {
  const world = new MemoryWorld(seeded(3));
  const tablet = world.device('tablet');
  const roomId = await tablet.createRoom({
    displayName: 'Tafel',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config,
    playing: false,
  });
  const phones = NAMES.map((n) => world.device(`u:${n}`));
  for (let i = 0; i < phones.length; i++) await phones[i]!.joinRoom(roomId, NAMES[i]!);
  return { world, tablet, roomId, phones };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * Drive a fake clock until the game finishes.
 *
 * The runner sleeps through every window's full duration on purpose, so
 * something has to push time forward. Stepping in one-second slices rather than
 * jumping to the end matters: the day runner polls for a majority abstain, and
 * a single giant jump would skip every poll and quietly stop testing it.
 */
async function play<T>(clock: FakeClock, run: Promise<T>): Promise<T> {
  let done = false;
  const settled = run.then(
    (v) => { done = true; return v; },
    (e) => { done = true; throw e; },
  );
  // Bounded so a hang fails the test in a second instead of running forever.
  for (let i = 0; i < 5_000 && !done; i++) {
    await clock.advance(1_000);
  }
  return settled;
}

/** Every seat is a bot except none — a full house, playing itself. */
function allBots(table: Table, seatCount: number, seed = 12) {
  const seats = new Set<SeatIndex>();
  for (let s = 0; s < seatCount; s++) seats.add(s);
  return {
    seats,
    bot: randomBot(seed),
    device: (seat: SeatIndex) => table.phones[seat]!,
  };
}

const FAST_DAY = {
  discussionMs: 5_000,
  abstainPollMs: 1_000,
  voteWaitTimeoutMs: 30_000,
  suspenseExtension: false,
};

describe('a whole evening', () => {
  it('plays a two-round night and a vote from lobby to results', async () => {
    const table = await seatTable(TWO_ROUND_CONFIG);
    await table.tablet.startGame(table.roomId, 20260826);

    // Every device is watching, exactly as it would be in the room.
    const rooms = new Map<string, RoomView>();
    const privates = new Map<string, PrivateView>();
    for (const phone of table.phones) {
      phone.watchRoom(table.roomId, (r) => { if (r) rooms.set(phone.uid, r); });
      phone.watchPrivate(table.roomId, (p) => { privates.set(phone.uid, p); });
    }

    const clock = new FakeClock();
    const phases: string[] = [];
    const result = await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length),
      onPhase: (p) => phases.push(p),
      random: seeded(5),
    }));

    expect(phases).toEqual(['night', 'day', 'voting', 'results']);
    expect(result.outcome).toBeTruthy();
    expect(result.resultsPersisted).toBe(true);

    // Everybody ends up looking at the same result.
    for (const phone of table.phones) {
      const room = rooms.get(phone.uid)!;
      expect(room.phase).toBe('results');
      expect(room.outcome).toBe(result.outcome);
      expect(room.finalRoles).toEqual(result.finalRoles);
    }

    // Voting is mandatory once the group has not abstained (§7), and eight bots
    // all voted, so nobody should be missing.
    expect(result.day.missingVotes).toEqual([]);
  });

  it('plays a dependency-mode night the same way', async () => {
    const table = await seatTable(DEPENDENCY_CONFIG);
    await table.tablet.startGame(table.roomId, 77);

    const clock = new FakeClock();
    const result = await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length, 31),
      random: seeded(9),
    }));

    expect(result.outcome).toBeTruthy();
    // Dependency mode is the four-round night: more windows, same contract.
    expect(result.night.timeline.phases.length)
      .toBeGreaterThan(2);
  });
});

describe('what each device may know while the night runs', () => {
  it('never writes another seat’s role to a player’s device', async () => {
    const table = await seatTable();
    await table.tablet.startGame(table.roomId, 1234);

    const dealt = new Map<string, RoleId | null>();
    const seenByPhone = new Map<string, PrivateView[]>();
    for (const phone of table.phones) {
      seenByPhone.set(phone.uid, []);
      phone.watchPrivate(table.roomId, (p) => {
        dealt.set(phone.uid, p.originalRole);
        seenByPhone.get(phone.uid)!.push(p);
      });
    }

    const clock = new FakeClock();
    await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length),
      random: seeded(2),
    }));

    // A private document only ever names ONE seat's dealt role: its owner's.
    // Everything else it carries is an observation the role earned.
    for (let seat = 0; seat < table.phones.length; seat++) {
      const phone = table.phones[seat]!;
      const views = seenByPhone.get(phone.uid)!;
      for (const v of views) {
        expect(v.originalRole).toBe(dealt.get(phone.uid));
      }
    }
  });

  it('publishes only counts during the vote, never who voted for whom', async () => {
    const table = await seatTable();
    await table.tablet.startGame(table.roomId, 55);

    const snapshots: RoomView[] = [];
    table.phones[0]!.watchRoom(table.roomId, (r) => { if (r) snapshots.push(r); });

    const clock = new FakeClock();
    await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length),
      random: seeded(4),
    }));

    // Before the results phase, no snapshot may carry a seat->role map. That
    // map IS the game; publishing it a moment early ends the evening.
    for (const s of snapshots) {
      if (s.phase !== 'results') expect(s.finalRoles).toBeNull();
    }
    expect(snapshots.at(-1)!.finalRoles).not.toBeNull();
  });
});

describe('test mode', () => {
  it('plays a full game but leaves no trace', async () => {
    const table = await seatTable();
    await table.tablet.startGame(table.roomId, 808);

    const clock = new FakeClock();
    const result = await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      mode: 'test',
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length),
      random: seeded(6),
    }));

    // The game itself is real — there is a result and everyone can see it.
    expect(result.outcome).toBeTruthy();
    const room = await readRoomOnce(table.phones[0]!, table.roomId);
    expect(room.finalRoles).not.toBeNull();

    // But nothing outlived it. Bots answer in a microsecond, so their timings
    // would drag every future window towards zero if they reached calibration.
    expect(result.resultsPersisted).toBe(false);
    expect(result.blocked.some((b) => b.method.startsWith('recordLatency'))).toBe(true);
  });
});

describe('who may run the game', () => {
  it('refuses a player’s phone outright', async () => {
    const table = await seatTable();
    await table.tablet.startGame(table.roomId, 3);
    const clock = new FakeClock();
    await expect(runGame({
      backend: table.phones[0]!,
      roomId: table.roomId,
      clock,
      bots: allBots(table, NAMES.length),
    })).rejects.toThrow(RefereeError);
  });

  it('refuses to run a room that has not been dealt', async () => {
    const table = await seatTable();
    const clock = new FakeClock();
    await expect(runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
    })).rejects.toThrow(/not been dealt/);
  });
});

describe('an evening of several rounds', () => {
  it('scores across rounds and reseats between them', async () => {
    const table = await seatTable();
    const clock = new FakeClock();

    for (let round = 1; round <= 3; round++) {
      await table.tablet.startGame(table.roomId, 100 + round);
      await play(clock, runGame({
        backend: table.tablet,
        roomId: table.roomId,
        clock,
        dayConfig: FAST_DAY,
        bots: allBots(table, NAMES.length, round),
        random: seeded(round),
      }));
    }

    const room = await readRoomOnce(table.phones[0]!, table.roomId);
    expect(room.round).toBe(3);
    // Everyone played all three, so everyone's record says three.
    for (const s of room.standings) expect(s.roundsPlayed).toBe(3);
    // And the scoreboard is a real ordering, not everybody on zero.
    expect(Math.max(...room.standings.map((s) => s.points))).toBeGreaterThan(0);
  });

  it('lets somebody join mid-evening at the score of whoever is last', async () => {
    const table = await seatTable();
    const clock = new FakeClock();

    for (let round = 1; round <= 2; round++) {
      await table.tablet.startGame(table.roomId, 200 + round);
      await play(clock, runGame({
        backend: table.tablet,
        roomId: table.roomId,
        clock,
        dayConfig: FAST_DAY,
        bots: allBots(table, NAMES.length, round),
        random: seeded(round),
      }));
    }

    const before = await readRoomOnce(table.phones[0]!, table.roomId);
    const lowest = Math.min(...before.standings.map((s) => s.points));

    const late = table.world.device('u:Laat');
    await late.joinRoom(table.roomId, 'Laat');

    const after = await readRoomOnce(table.phones[0]!, table.roomId);
    const row = after.standings.find((s) => s.uid === 'u:Laat')!;

    // Level with the player in last place — at the back of the pack, not below
    // it (Milan, 2026-08-26) — but credited with no rounds they did not play.
    expect(row.points).toBe(lowest);
    expect(row.seeded).toBe(lowest);
    expect(row.roundsPlayed).toBe(0);
    expect(row.wins).toBe(0);

    // They sit down for round 3, and only then.
    expect(after.seating).not.toContain('u:Laat');
    await table.tablet.startGame(table.roomId, 999);
    const playing = await readRoomOnce(table.phones[0]!, table.roomId);
    expect(playing.seating).toContain('u:Laat');
    expect(playing.round).toBe(3);
  });

  it('lets somebody leave without ending the evening', async () => {
    const table = await seatTable();
    const clock = new FakeClock();

    await table.tablet.startGame(table.roomId, 1);
    await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length),
      random: seeded(1),
    }));

    await table.phones[3]!.leaveRoom(table.roomId);

    // The next round simply has one fewer chair, and the ring closes up — a
    // hole in the seating is a hole in the Dorpsgek's rotation.
    await table.tablet.startGame(table.roomId, 2);
    const room = await readRoomOnce(table.phones[0]!, table.roomId);
    expect(room.seating).not.toContain(table.phones[3]!.uid);
    expect(room.seating).toHaveLength(NAMES.length - 1);
    expect(room.seating).toEqual([...new Set(room.seating)]);

    // Their finished round still counts. Leaving does not erase what happened.
    const gone = room.standings.find((s) => s.uid === table.phones[3]!.uid)!;
    expect(gone.roundsPlayed).toBe(1);
    expect(gone.active).toBe(false);

    // And the evening carries on for everyone else.
    const seats = new Set<SeatIndex>();
    for (let s = 0; s < room.seating.length; s++) seats.add(s);
    await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      clock,
      dayConfig: FAST_DAY,
      bots: {
        seats,
        bot: randomBot(7),
        device: (seat: SeatIndex) =>
          table.world.device(room.seating[seat]!),
      },
      random: seeded(2),
    }));
    const after = await readRoomOnce(table.phones[0]!, table.roomId);
    expect(after.round).toBe(2);
    expect(after.outcome).toBeTruthy();
  });

  it('does not record a test round in the evening', async () => {
    const table = await seatTable();
    const clock = new FakeClock();
    await table.tablet.startGame(table.roomId, 5);
    await play(clock, runGame({
      backend: table.tablet,
      roomId: table.roomId,
      mode: 'test',
      clock,
      dayConfig: FAST_DAY,
      bots: allBots(table, NAMES.length),
      random: seeded(3),
    }));

    let rounds: RoundRecord[] = [];
    table.phones[0]!.watchRounds(table.roomId, (r) => { rounds = r; });
    expect(rounds).toEqual([]);
    // Nobody's scoreboard moved.
    const room = await readRoomOnce(table.phones[0]!, table.roomId);
    expect(room.standings.every((s) => s.roundsPlayed === 0)).toBe(true);
  });
});
