import { describe, expect, it } from 'vitest';
import { randomBot } from '../engine/bot.js';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import type { SeatIndex } from '../engine/types.js';
import { FakeClock } from '../orchestration/clock.js';
import type { Backend, PlayerView, RoomView } from './backend.js';
import { MemoryWorld } from './memorybackend.js';
import { runGame } from './refereeRunner.js';

/**
 * AI players at a real table (§16).
 *
 * The point of these is playtesting a mixed table before the first evening —
 * three friends and four bots, in a room that behaves exactly like the one the
 * group will play in. So the interesting assertions here are not "the bot
 * votes"; they are the boundaries: a bot exists only in a practice room, only
 * the controlling browser can make one or answer for one, and a bot never
 * becomes a way to cast a vote on behalf of a human.
 */

const OFFICIAL = { mode: 'official' as const };

async function practiceRoom(): Promise<{
  world: MemoryWorld; tablet: Backend; roomId: string;
}> {
  const world = new MemoryWorld(seeded(7));
  const tablet = world.device('tablet');
  const roomId = await tablet.createRoom({
    displayName: 'Oefentafel',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    playing: false,
  });
  return { world, tablet, roomId };
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

function room(backend: Backend, roomId: string): Promise<RoomView> {
  return new Promise((resolve) => {
    const off = backend.watchRoom(roomId, (r) => {
      if (!r) return;
      queueMicrotask(() => off());
      resolve(r);
    });
  });
}

/** The roster, as any device in the room sees it. */
function players(backend: Backend, roomId: string): Promise<PlayerView[]> {
  return new Promise((resolve) => {
    const off = backend.watchPlayers(roomId, (p) => {
      queueMicrotask(() => off());
      resolve(p);
    });
  });
}

describe('adding and removing AI players', () => {
  it('adds them one at a time, each clearly labelled AI', async () => {
    const { tablet, roomId } = await practiceRoom();
    await tablet.addBot(roomId);
    await tablet.addBot(roomId);

    const view = await room(tablet, roomId);
    expect(view.seating).toHaveLength(2);
    const bots = (await players(tablet, roomId)).filter((p) => p.isBot);
    expect(bots).toHaveLength(2);
    // Not a name a person could plausibly have. Somebody joining the room has
    // to be able to tell at a glance which seats are not people.
    for (const bot of bots) expect(bot.displayName).toMatch(/^AI /);
  });

  it('mixes with humans in any combination, up to the same twelve', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    for (const name of ['Milan', 'Sanne', 'Joris']) {
      await world.device(`u:${name}`).joinRoom(roomId, name);
    }
    for (let i = 0; i < 4; i++) await tablet.addBot(roomId);

    const view = await room(tablet, roomId);
    expect(view.seating).toHaveLength(7);
    const roster = await players(tablet, roomId);
    expect(roster.filter((p) => p.isBot)).toHaveLength(4);
    expect(roster.filter((p) => !p.isBot)).toHaveLength(3);
  });

  it('refuses a thirteenth seat, bot or not', async () => {
    const { tablet, roomId } = await practiceRoom();
    for (let i = 0; i < 12; i++) await tablet.addBot(roomId);
    await expect(tablet.addBot(roomId)).rejects.toThrow(/12/);
  });

  it('removes one, leaving no trace on the roster or the seating', async () => {
    const { tablet, roomId } = await practiceRoom();
    await tablet.addBot(roomId);
    await tablet.addBot(roomId);
    const victim = (await players(tablet, roomId)).find((p) => p.isBot)!.uid;

    await tablet.removeBot(roomId, victim);

    const after = await room(tablet, roomId);
    expect(after.seating).not.toContain(victim);
    expect((await players(tablet, roomId)).map((p) => p.uid)).not.toContain(victim);
    // The membership is what seats a player at the next round boundary. A bot
    // whose membership outlived it would come back for round two.
    expect(after.members.map((m) => m.uid)).not.toContain(victim);
    expect(after.seating).toHaveLength(1);
  });

  it('will not remove a human under the name of removing a bot', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    await world.device('u:Milan').joinRoom(roomId, 'Milan');
    await expect(tablet.removeBot(roomId, 'u:Milan')).rejects.toThrow(/not a bot/);

    const view = await room(tablet, roomId);
    expect(view.seating).toContain('u:Milan');
  });
});

describe('where a bot may not exist', () => {
  it('refuses an official evening outright', async () => {
    const world = new MemoryWorld(seeded(2));
    const tablet = world.device('tablet');
    const roomId = await tablet.createRoom({
      displayName: 'Echte avond',
      activeRoles: DEFAULT_ACTIVE_ROLES,
      config: TWO_ROUND_CONFIG,
      playing: false,
      ...OFFICIAL,
    });
    // Not "discouraged" — impossible. Official rounds are the append-only
    // input to every all-time statistic, and there is no delete path.
    await expect(tablet.addBot(roomId)).rejects.toThrow(/practice/);
  });

  it('refuses anybody but the controlling browser', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    await world.device('u:Milan').joinRoom(roomId, 'Milan');
    await expect(world.device('u:Milan').addBot(roomId)).rejects.toThrow();
    expect((await players(tablet, roomId)).filter((p) => p.isBot)).toHaveLength(0);
  });

  it('refuses a bot added after the deal', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    for (const n of ['A', 'B', 'C']) await world.device(`u:${n}`).joinRoom(roomId, n);
    await tablet.startGame(roomId, 1);
    await expect(tablet.addBot(roomId)).rejects.toThrow(/lobby/);
  });
});

describe('voting for a bot is a capability, not a loophole', () => {
  it('refuses to vote for a human, even from the controlling browser', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    for (const n of ['A', 'B', 'C']) await world.device(`u:${n}`).joinRoom(roomId, n);
    await tablet.addBot(roomId);

    // THE test in this file. If this ever passes, the referee can decide the
    // vote of every player at the table while they are still arguing.
    await expect(
      tablet.voteAsBot(roomId, 'u:A', 'u:B', false),
    ).rejects.toThrow(/not a bot/);
  });

  it('refuses a bot naming itself', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    for (const n of ['A', 'B']) await world.device(`u:${n}`).joinRoom(roomId, n);
    await tablet.addBot(roomId);
    const bot = (await players(tablet, roomId)).find((p) => p.isBot)!.uid;
    await expect(tablet.voteAsBot(roomId, bot, bot, false)).rejects.toThrow(/self/);
  });

  it('refuses a named target before the ballot is open', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    for (const n of ['A', 'B'] as const) await world.device(`u:${n}`).joinRoom(roomId, n);
    await tablet.addBot(roomId);
    const bot = (await players(tablet, roomId)).find((p) => p.isBot)!.uid;
    await tablet.startGame(roomId, 1);
    // Still 'night'. A vote locked in before the ballot opens would turn a
    // simultaneous vote into a first-mover one.
    await expect(tablet.voteAsBot(roomId, bot, 'u:A', false)).rejects.toThrow(/phase/);
  });
});

describe('a mixed table plays a whole round', () => {
  it('runs from lobby to results with humans and bots in the same seating', async () => {
    const { world, tablet, roomId } = await practiceRoom();
    const humans = ['Milan', 'Sanne', 'Joris'];
    const humanDevices = humans.map((n) => world.device(`u:${n}`));
    for (let i = 0; i < humans.length; i++) {
      await humanDevices[i]!.joinRoom(roomId, humans[i]!);
    }
    for (let i = 0; i < 4; i++) await tablet.addBot(roomId);

    const view = await room(tablet, roomId);
    const roster = await players(tablet, roomId);
    const botSeats = new Set<SeatIndex>();
    view.seating.forEach((uid, seat) => {
      if (roster.find((p) => p.uid === uid)?.isBot) botSeats.add(seat);
    });
    expect(botSeats.size).toBe(4);

    await tablet.startGame(roomId, 20260827);

    // Humans and bots both have to answer. The humans here answer by not
    // answering: the day still has to end, which is what makes a half-empty
    // playtest table useful rather than a hang.
    const clock = new FakeClock();
    const run = runGame({
      backend: tablet,
      roomId,
      mode: 'test',
      clock,
      dayConfig: {
        discussionMs: 5_000, abstainPollMs: 1_000,
        voteWaitTimeoutMs: 10_000, suspenseExtension: false,
      },
      // No `device`: these bots have no login and no browser, so every vote
      // goes through the narrow `voteAsBot`. That is the real path.
      bots: { seats: botSeats, bot: randomBot(4) },
      random: seeded(9),
      onPhase: (phase) => {
        if (phase !== 'voting') return;
        void Promise.all(humanDevices.map((device, seat) => {
          const target = view.seating[(seat + 1) % view.seating.length]!;
          return device.vote(roomId, target, false);
        }));
      },
    });
    let done = false;
    const settled = run.then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
    for (let i = 0; i < 5_000 && !done; i++) await clock.advance(1_000);
    const result = await settled;

    expect(result.outcome).toBeTruthy();
    // Practice writes nothing permanent — that is the whole reason bots are
    // confined to it.
    expect(result.resultsPersisted).toBe(false);
    // Bots and humans all vote once the ballot opens. The day cannot resolve
    // with a missing seat.
    expect(result.day.missingVotes).toEqual([]);
  });
});
