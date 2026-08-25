import { describe, expect, it } from 'vitest';
import { createNightState } from '../engine/state.js';
import { DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { buildTimeline } from '../engine/timeline.js';
import type { RoleId } from '../engine/types.js';
import { FakeClock, PausableClock } from './clock.js';
import { runNight, type WindowInfo } from './referee.js';
import { InMemoryRoomStore } from './store.js';

/** Eight seats holding the default preset, plus three centre cards. */
function standardDeal(seatRoles?: RoleId[]) {
  const seats: RoleId[] = seatRoles ?? [
    'droomwolf', 'alphawolf', 'mystiekewolf', 'dubbelganger',
    'heks', 'leerlingziener', 'dorpsgek', 'medium',
  ];
  return createNightState({
    seatCount: seats.length,
    seatRoles: seats,
    centerRoles: ['dorpeling', 'looier', 'jager'],
    alphaWolfCardRole: 'weerwolf',
  });
}

/** Drive a night to completion, letting a script answer windows as they open. */
async function play(
  state: ReturnType<typeof standardDeal>,
  config = TWO_ROUND_CONFIG,
  script: (w: WindowInfo, store: InMemoryRoomStore) => void = () => {},
) {
  const store = new InMemoryRoomStore();
  const clock = new FakeClock();
  const timeline = buildTimeline(DEFAULT_ACTIVE_ROLES, config);

  const running = runNight({
    state, activeRoles: DEFAULT_ACTIVE_ROLES, config, store, clock,
    onWindowOpen: (w) => script(w, store),
  });

  // Let the referee reach its first sleep before moving time, then step the
  // clock past each window in turn. Without the yields the advance fires
  // before a waiter is registered and the run hangs.
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

  return { out: await running, store, timeline };
}

describe('the referee runs every window for its full duration', () => {
  it('opens exactly the windows the timeline declares', async () => {
    const opened: WindowInfo[] = [];
    await play(standardDeal(), TWO_ROUND_CONFIG, (w) => { opened.push(w); });
    expect(opened.map((w) => w.role)).toEqual([null, 'dubbelganger']);
  });

  it('opens a follow-up window even when that role is sitting in the CENTRE', async () => {
    // The single most important behaviour in this file. No player was dealt the
    // Dubbelganger, so nobody has anything to do in window 1 — but the window
    // must still open and still run its full length, or its absence tells the
    // table exactly where the Dubbelganger card is.
    const noDoppel = standardDeal([
      'droomwolf', 'alphawolf', 'mystiekewolf', 'dorpeling',
      'heks', 'leerlingziener', 'dorpsgek', 'medium',
    ]);
    const opened: WindowInfo[] = [];
    const { timeline } = await play(noDoppel, TWO_ROUND_CONFIG, (w) => { opened.push(w); });

    expect(opened.map((w) => w.role)).toEqual([null, 'dubbelganger']);
    // Nobody is asked anything in it...
    expect(opened[1]!.requests).toEqual([]);
    // ...and it still occupies its full slot in the timeline.
    expect(timeline.phases[1]!.endMs - timeline.phases[1]!.startMs).toBeGreaterThan(0);
  });

  it('produces an identical window shape however the deal falls', async () => {
    const a: WindowInfo[] = [];
    const b: WindowInfo[] = [];
    await play(standardDeal(), TWO_ROUND_CONFIG, (w) => { a.push(w); });
    await play(
      standardDeal([
        'medium', 'dorpsgek', 'leerlingziener', 'heks',
        'dubbelganger', 'mystiekewolf', 'alphawolf', 'droomwolf',
      ]),
      TWO_ROUND_CONFIG,
      (w) => { b.push(w); },
    );
    expect(b.map((w) => ({ i: w.index, kind: w.kind, role: w.role, at: w.closesAtMs })))
      .toEqual(a.map((w) => ({ i: w.index, kind: w.kind, role: w.role, at: w.closesAtMs })));
  });

  it('gives mode 1 a window each for Dubbelganger, Heks and Medium', async () => {
    const opened: WindowInfo[] = [];
    await play(standardDeal(), DEPENDENCY_CONFIG, (w) => { opened.push(w); });
    expect(opened.map((w) => w.role)).toEqual([null, 'dubbelganger', 'heks', 'medium']);
  });
});

describe('reveals are released only when due', () => {
  it('releases the Droomwolf and Mystieke Wolf after the opening window', async () => {
    const { store } = await play(standardDeal(), TWO_ROUND_CONFIG, (w, s) => {
      if (w.kind !== 'open') return;
      s.submit(w.index, 1, { 'alpha-target': { kind: 'seat', seat: 2 } });
      s.submit(w.index, 2, { 'mystic-view': { kind: 'seat', seat: 0 } });
      s.submit(w.index, 3, { 'doppel-view': { kind: 'seat', seat: 5 } });
    });
    expect(store.released.get(0)?.length).toBeGreaterThan(0);   // droomwolf
    expect(store.released.get(2)?.length).toBeGreaterThan(0);   // mystieke wolf
  });

  it('never writes a provisional result for a seat that still owes a decision', async () => {
    // Seat 3 (Dubbelganger) never submits its follow-up. Its own resolution is
    // downstream of a placeholder, so nothing may be shown to it mid-night.
    const seen: number[] = [];
    const { store } = await play(standardDeal(), TWO_ROUND_CONFIG, (w, s) => {
      if (w.kind === 'open') {
        s.submit(w.index, 3, { 'doppel-view': { kind: 'seat', seat: 4 } });
      }
      seen.push(s.released.get(3)?.length ?? 0);
    });
    // Window 0 opens before anything is resolved, so nothing is out yet.
    expect(seen[0]).toBe(0);
    // By the end it does get its info; the point is it wasn't written early
    // with a guessed answer standing in.
    expect(store.released.get(3)).toBeDefined();
  });

  it('holds the Medium back until the very end', async () => {
    const atWindow: Record<number, number> = {};
    const { store } = await play(standardDeal(), TWO_ROUND_CONFIG, (w, s) => {
      atWindow[w.index] = s.released.get(7)?.length ?? 0;
      if (w.kind === 'open') {
        s.submit(w.index, 7, { 'medium-target': { kind: 'seat', seat: 0 } });
      }
    });
    // Nothing for the Medium while windows 0 and 1 are still open.
    expect(atWindow[0]).toBe(0);
    expect(atWindow[1]).toBe(0);
    expect(store.released.get(7)?.length).toBeGreaterThan(0);
  });
});

describe('submissions', () => {
  it('records a latency sample per decision', async () => {
    const { store } = await play(standardDeal(), TWO_ROUND_CONFIG, (w, s) => {
      if (w.kind === 'open') {
        for (const r of w.requests) {
          s.submit(w.index, r.seat, { [r.key]: { kind: 'seat', seat: 0 } });
        }
      }
    });
    expect(store.latency.length).toBeGreaterThan(0);
    expect(store.latency.every((x) => x.sessionId === 'local')).toBe(true);
  });

  it('marks unsubmitted decisions as timed-out rather than wrong', async () => {
    const { out, store } = await play(standardDeal(), TWO_ROUND_CONFIG);
    expect(out.timedOut.length).toBeGreaterThan(0);
    // Timed-out samples are recorded but must never feed calibration as latency.
    expect(store.latency.some((s) => s.outcome === 'timed-out')).toBe(true);
  });

  it('rejects a submission for a window that has already closed', async () => {
    const store = new InMemoryRoomStore();
    await store.setWindowIndex(1);
    expect(store.submit(0, 3, { 'doppel-view': { kind: 'seat', seat: 1 } })).toBe(false);
    expect(store.submit(1, 3, { 'doppel-view': { kind: 'seat', seat: 1 } })).toBe(true);
  });
});

describe('the Dubbelganger window is matched by DEALT role, not actingAs', () => {
  it("files a copied role's follow-up under the Dubbelganger's window", async () => {
    // Seat 3 is the Dubbelganger and copies the Mystieke Wolf at seat 2. Its
    // follow-up request carries actingAs:'mystiekewolf' — matching on that
    // would file it under the wrong window, or none at all.
    const state = standardDeal();
    let followup: WindowInfo | undefined;
    await play(state, TWO_ROUND_CONFIG, (w, s) => {
      if (w.kind === 'open') {
        s.submit(w.index, 3, { 'doppel-view': { kind: 'seat', seat: 2 } });
      } else if (w.role === 'dubbelganger') {
        followup = w;
      }
    });
    expect(followup).toBeDefined();
    expect(followup!.requests.map((r) => r.seat)).toEqual([3]);
    expect(followup!.requests[0]!.actingAs).toBe('mystiekewolf');
  });
});

describe('host pause', () => {
  it('stops the countdown for everyone and flags the window as unusable for calibration', async () => {
    const inner = new FakeClock();
    const clock = new PausableClock(inner);
    expect(clock.isPaused).toBe(false);

    clock.pause();
    expect(clock.isPaused).toBe(true);
    await inner.advance(10_000);   // real time passes...
    expect(clock.now()).toBe(0);   // ...but the game's clock does not move

    clock.resume();
    await inner.advance(5_000);
    expect(clock.now()).toBe(5_000);

    // The window that overlapped the pause is discarded from telemetry,
    // otherwise one toilet break inflates every future window.
    expect(clock.consumeDirty()).toBe(true);
    expect(clock.consumeDirty()).toBe(false);
  });
});
