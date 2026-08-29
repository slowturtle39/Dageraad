import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { MemoryWorld } from './memorybackend.js';
import { AppController } from './controller.js';
import type { Backend } from './backend.js';

/**
 * Subscription lifecycle, which is where the leaks are.
 *
 * A leaked listener does not throw. It keeps firing, so a previous room's
 * snapshots race the current one's and the screen flickers between two
 * evenings — and against Firestore it goes on costing reads all night. None of
 * that shows up in a screenshot, so it has to show up here.
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

async function world() {
  const w = new MemoryWorld(seeded(11));
  const tablet = w.device('tablet');
  const roomId = await tablet.createRoom({
    displayName: 'Tafel',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    playing: false,
  });
  return { w, tablet, roomId };
}

/** Count how many times the controller told anybody anything. */
function counter(c: AppController) {
  const box = { n: 0 };
  c.onChange(() => { box.n += 1; });
  return box;
}

describe('watching a room', () => {
  it('reports the room once its first snapshot lands', async () => {
    const { w, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');

    const c = new AppController(phone);
    c.watch(roomId);

    expect(c.current().loading).toBe(false);
    expect(c.current().room?.roomId).toBe(roomId);
    expect(c.current().players.map((p) => p.uid)).toContain(phone.uid);
  });

  it('routes to a screen using the room it is watching', async () => {
    const { w, tablet, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');

    const seat = new AppController(phone);
    seat.watch(roomId);
    expect(seat.screen().kind).toBe('lobby');

    // It gets the public lobby first, so it can deal without becoming a player.
    const table = new AppController(tablet);
    table.watch(roomId);
    expect(table.screen().kind).toBe('lobby');
  });

  it('starts on the setup screen with no room at all', () => {
    const c = new AppController({ uid: 'x' } as Backend);
    expect(c.screen().kind).toBe('setup');
    c.setJoining(true);
    expect(c.screen().kind).toBe('join');
  });
});

describe('stopping', () => {
  it('goes quiet after detach, however much the room changes', async () => {
    const { w, tablet, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');

    const c = new AppController(phone);
    c.watch(roomId);
    const seen = counter(c);

    c.detach();
    const after = seen.n;

    // Everything that would normally produce a snapshot.
    await w.device('u:Sanne').joinRoom(roomId, 'Sanne');
    await w.device('u:Joris').joinRoom(roomId, 'Joris');
    await tablet.setPaused(roomId, true);

    expect(seen.n).toBe(after);
  });

  it('is safe to detach twice', async () => {
    const { w, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');
    const c = new AppController(phone);
    c.watch(roomId);
    c.detach();
    expect(() => c.detach()).not.toThrow();
  });

  it('forgets the room on reset, so the screen goes back to the start', async () => {
    const { w, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');
    const c = new AppController(phone);
    c.watch(roomId);
    c.reset();

    expect(c.current().room).toBeNull();
    expect(c.current().roomId).toBeNull();
    expect(c.screen().kind).toBe('setup');
  });
});

describe('not leaking a room when moving to another', () => {
  it('detaches the old room before watching a new one', async () => {
    // The mistyped-code case: somebody joins the wrong room, then the right
    // one. If the first subscription survives, both rooms' snapshots land on
    // the same screen and it flickers between two evenings.
    const { w, roomId: roomA } = await world();
    // A SECOND room in the SAME world — that is the real case (one device,
    // one backend, two rooms), and two worlds would have handed out the same
    // code anyway, since the code generator is seeded.
    const roomB = await w.device('tablet2').createRoom({
      displayName: 'Andere tafel',
      activeRoles: DEFAULT_ACTIVE_ROLES,
      config: TWO_ROUND_CONFIG,
      playing: false,
    });
    expect(roomB).not.toBe(roomA);

    const phone = w.device('u:Milan');
    await phone.joinRoom(roomA, 'Milan');
    await phone.joinRoom(roomB, 'Milan');

    const c = new AppController(phone);
    c.watch(roomA);
    c.watch(roomB);
    expect(c.current().roomId).toBe(roomB);

    const seen = counter(c);
    // Churn the OLD room. Nothing about it may reach this controller now.
    await w.device('u:Sanne').joinRoom(roomA, 'Sanne');
    await w.device('u:Joris').joinRoom(roomA, 'Joris');
    expect(seen.n).toBe(0);
  });

  it('does not double its listeners when asked to watch the same room twice', async () => {
    // A re-render calling watch() again must not add a second set. Doubling
    // is invisible until it is sixteen.
    const { w, tablet, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');

    const c = new AppController(phone);
    c.watch(roomId);
    const once = counter(c);
    await tablet.setPaused(roomId, true);
    const single = once.n;

    c.watch(roomId);
    c.watch(roomId);
    const twice = counter(c);
    await tablet.setPaused(roomId, false);

    expect(twice.n).toBe(single);
  });
});

describe('listeners', () => {
  it('lets a listener unsubscribe itself while being called', async () => {
    // A re-rendering UI does this routinely; mutating the set mid-iteration
    // would throw or silently skip the next listener.
    const { w, tablet, roomId } = await world();
    const phone = w.device('u:Milan');
    await phone.joinRoom(roomId, 'Milan');

    const c = new AppController(phone);
    c.watch(roomId);

    let calls = 0;
    const stop = c.onChange(() => { calls += 1; stop(); });
    const other = counter(c);

    await tablet.setPaused(roomId, true);
    await tablet.setPaused(roomId, false);

    expect(calls).toBe(1);
    expect(other.n).toBeGreaterThan(0);
  });
});
