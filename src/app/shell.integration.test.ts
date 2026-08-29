import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import type { Backend, PlayerView, RoomView } from './backend.js';
import { MemoryWorld } from './memorybackend.js';
import { readRoomOnce } from './refereeRunner.js';
import { screenFor, nextRoundRoster } from './shell.js';

/**
 * Routing against a real backend playing a real evening.
 *
 * shell.test.ts checks the routing against hand-built RoomViews, which proves
 * the logic but not the ASSUMPTIONS — every one of those objects was written
 * by the same person who wrote the code reading it. This one asks an actual
 * backend for actual views, so a change to what `round` or `seating` mean at a
 * round boundary fails here rather than at the table.
 *
 * MemoryBackend and FirestoreBackend implement the same interface, so what
 * passes here is what the Firestore one has to produce.
 */

const NAMES = ['Milan', 'Sanne', 'Joris', 'Fleur'];

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
 * The player list, once.
 *
 * Both backends fire the callback synchronously on subscribe, so `stop` is not
 * assigned yet when it runs — capture the value and unsubscribe afterwards
 * rather than from inside. readRoomOnce does the same dance for the same
 * reason; every screen in the app is live, so a one-shot read is the special
 * case rather than the norm.
 */
async function players(backend: Backend, roomId: string): Promise<PlayerView[]> {
  let seen: PlayerView[] = [];
  const stop = backend.watchPlayers(roomId, (p) => { seen = p; });
  stop();
  return seen;
}

async function table(playing = false) {
  const world = new MemoryWorld(seeded(7));
  const tablet = world.device('tablet');
  const roomId = await tablet.createRoom({
    displayName: 'Tafel',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    playing,
  });
  const phones = NAMES.map((n) => world.device(`u:${n}`));
  for (let i = 0; i < phones.length; i++) await phones[i]!.joinRoom(roomId, NAMES[i]!);
  return { world, tablet, roomId, phones };
}

const kindFor = (room: RoomView, uid: string) =>
  screenFor({ uid, room, players: [] }).kind;

/**
 * End the round without playing the night out.
 *
 * game.integration.test.ts drives whole rounds with bots and a fake clock;
 * that is not what is under test here. A round may only start from a settled
 * room, so this is the smallest honest way to reach the next boundary — it
 * goes through the referee's own store, the same call runDay makes.
 */
async function endRound(tablet: Backend, roomId: string): Promise<void> {
  await tablet.refereeStore(roomId).setPhase('results');
}

describe('a real room routes every device correctly', () => {
  it('sends every device to the public lobby before the deal', async () => {
    const { tablet, roomId, phones } = await table();
    const room = await readRoomOnce(phones[0]!, roomId);

    expect(kindFor(room, tablet.uid)).toBe('lobby');
    for (const phone of phones) expect(kindFor(room, phone.uid)).toBe('lobby');
  });

  it('keeps the tablet on the neutral display once the deal happens', async () => {
    const { tablet, roomId, phones } = await table();
    await tablet.startGame(roomId, 42);
    const room = await readRoomOnce(phones[0]!, roomId);

    expect(kindFor(room, tablet.uid)).toBe('tablet');
    expect(kindFor(room, phones[0]!.uid)).toBe('table');
  });

  it('gives a trusted host a seat and a player screen', async () => {
    // playing: true is the mode where one player runs the game on their own
    // phone. Routing them to the neutral display would leave them unable to
    // play the game they are hosting.
    const { tablet, roomId } = await table(true);
    await tablet.startGame(roomId, 42);
    const room = await readRoomOnce(tablet, roomId);

    expect(room.seating).toContain(tablet.uid);
    expect(kindFor(room, tablet.uid)).toBe('table');
  });
});

describe('somebody arrives after the deal', () => {
  it('waits them out of the running round and seats them at the next', async () => {
    const { world, tablet, roomId, phones } = await table();
    await tablet.startGame(roomId, 1);

    const late = world.device('u:Laat');
    await late.joinRoom(roomId, 'Laat');

    const during = await readRoomOnce(phones[0]!, roomId);
    const waiting = screenFor({ uid: late.uid, room: during, players: [] });
    expect(waiting.kind).toBe('waiting');
    // The promise made on screen must be the round they are actually dealt in.
    expect(waiting).toEqual({ kind: 'waiting', joinsAtRound: during.round + 1 });

    // ...and the roster the lobby shows already counts them.
    const roster = nextRoundRoster(during, await players(phones[0]!, roomId));
    expect(roster.map((p) => p.uid)).toContain(late.uid);

    await endRound(tablet, roomId);
    await tablet.startGame(roomId, 2);
    const after = await readRoomOnce(phones[0]!, roomId);
    expect(after.seating).toContain(late.uid);
    expect(kindFor(after, late.uid)).toBe('table');
  });
});

describe('somebody goes home', () => {
  it('finishes the round they are in, then leaves the table', async () => {
    const { tablet, roomId, phones } = await table();
    await tablet.startGame(roomId, 3);

    const leaver = phones[1]!;
    await leaver.leaveRoom(roomId);

    // Still in the deal for the round now running — their card is already on
    // the table and the evening does not stop for one person.
    const during = await readRoomOnce(phones[0]!, roomId);
    expect(during.seating).toContain(leaver.uid);
    expect(kindFor(during, leaver.uid)).toBe('table');

    // Gone at the boundary, and the ring closed up behind them.
    await endRound(tablet, roomId);
    await tablet.startGame(roomId, 4);
    const after = await readRoomOnce(phones[0]!, roomId);
    expect(after.seating).not.toContain(leaver.uid);
    expect(kindFor(after, leaver.uid)).toBe('departed');
    expect(nextRoundRoster(after, await players(phones[0]!, roomId))
      .map((p) => p.uid)).not.toContain(leaver.uid);
  });

  it('never routes a leaver to a screen promising a round that is not coming', async () => {
    const { tablet, roomId, phones } = await table();
    await tablet.startGame(roomId, 5);
    await phones[1]!.leaveRoom(roomId);
    await endRound(tablet, roomId);
    await tablet.startGame(roomId, 6);
    await endRound(tablet, roomId);
    await tablet.startGame(roomId, 7);

    const room = await readRoomOnce(phones[0]!, roomId);
    expect(kindFor(room, phones[1]!.uid)).not.toBe('waiting');
    expect(kindFor(room, phones[1]!.uid)).toBe('departed');
  });
});

describe('somebody who only has the link', () => {
  it('is asked to join rather than shown anybody else\'s table', async () => {
    const { world, roomId, phones } = await table();
    const stranger = world.device('u:Vreemde');
    const room = await readRoomOnce(phones[0]!, roomId);
    expect(kindFor(room, stranger.uid)).toBe('join');
  });
});
