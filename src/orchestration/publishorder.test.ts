import { describe, expect, it } from 'vitest';
import { createNightState } from '../engine/state.js';
import { DEPENDENCY_CONFIG, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { buildTimeline } from '../engine/timeline.js';
import { FakeClock } from './clock.js';
import { runNight } from './referee.js';
import { InMemoryRoomStore } from './store.js';
import type { PublicNightView } from '../engine/publicview.js';
import type { DecisionRequest, RoleId, SeatIndex } from '../engine/types.js';

/**
 * WHEN things become visible, as opposed to what they say.
 *
 * Two orderings have to hold, and neither is checkable from the content of
 * anything published:
 *
 *  1. A window's result is published when the window RESOLVES, never when
 *     somebody taps. Publishing on a tap would leak that a decision had been
 *     made, and from the timing, roughly which one.
 *  2. A player who acts later is prompted only AFTER the public state they are
 *     supposed to be looking at has been published. The Heks choosing against
 *     a table she cannot see yet is the same bug as her not being able to see
 *     it at all.
 */

const ROLES: RoleId[] = [
  'droomwolf', 'alphawolf', 'mystiekewolf', 'dubbelganger',
  'heks', 'leerlingziener', 'dorpsgek', 'medium',
];

type Entry =
  | { kind: 'published'; view: PublicNightView }
  | { kind: 'prompted'; seat: SeatIndex; count: number }
  | { kind: 'window'; index: number };

/** A store that remembers the ORDER it was called in. */
class RecordingStore extends InMemoryRoomStore {
  readonly log: Entry[] = [];

  override async publishPublicView(view: PublicNightView): Promise<void> {
    await super.publishPublicView(view);
    this.log.push({
      kind: 'published',
      view: { revealed: { ...view.revealed }, shielded: [...view.shielded] },
    });
  }

  override async releaseDecisions(
    seat: SeatIndex,
    requests: DecisionRequest[],
  ): Promise<void> {
    await super.releaseDecisions(seat, requests);
    this.log.push({ kind: 'prompted', seat, count: requests.length });
  }

  override async setWindowIndex(index: number): Promise<void> {
    await super.setWindowIndex(index);
    this.log.push({ kind: 'window', index });
  }
}

async function night(config = DEPENDENCY_CONFIG) {
  const state = createNightState({
    seatCount: ROLES.length,
    seatRoles: ROLES,
    centerRoles: ['dorpeling', 'looier', 'jager'],
    alphaWolfCardRole: 'weerwolf',
  });
  const store = new RecordingStore();
  const clock = new FakeClock();
  const timeline = buildTimeline(ROLES, config);

  const running = runNight({
    state, activeRoles: ROLES, config, store, clock,
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

  await running;
  return { store, timeline };
}

describe('a window publishes when it resolves', () => {
  it('publishes once per window, and once more at the end', async () => {
    // Every window, not only the ones where something happened: "nothing was
    // revealed" and "this window did not run" must look identical from
    // outside, for the same reason a window sleeps its full length whether or
    // not anybody is in it.
    const { store, timeline } = await night();
    const published = store.log.filter((e) => e.kind === 'published');
    expect(published).toHaveLength(timeline.phases.length + 1);
  });

  it('never publishes before its window has opened', async () => {
    const { store } = await night();
    expect(store.log[0]!.kind).toBe('window');
  });
});

describe('a later role is prompted only after it can see the table', () => {
  it('publishes the previous window before prompting for the next', async () => {
    // The Heks acts in a later window than the Dubbelganger. Whatever the
    // Dubbelganger's window resolved to has to be on the table before she is
    // handed her question.
    const { store, timeline } = await night();
    const log = store.log;

    for (let phase = 1; phase < timeline.phases.length; phase++) {
      const windowAt = log.findIndex(
        (e) => e.kind === 'window' && e.index === phase,
      );
      expect(windowAt).toBeGreaterThan(-1);

      // Something was published before this window opened...
      const publishedBefore = log
        .slice(0, windowAt)
        .filter((e) => e.kind === 'published').length;
      expect(publishedBefore).toBe(phase);

      // ...and every prompt for this window comes after that.
      const firstPromptAfter = log
        .slice(windowAt)
        .findIndex((e) => e.kind === 'prompted');
      expect(firstPromptAfter).toBeGreaterThan(-1);
    }
  });

  it('prompts every seat each window, including those with nothing to do', async () => {
    // An empty list is what clears the previous question. A seat that is
    // simply not written to would keep showing a stale one — and a seat that
    // is written to ONLY when it has something would announce, by the write
    // itself, that it has something.
    const { store, timeline } = await night();
    const perWindow = new Map<number, Set<SeatIndex>>();
    let current = -1;
    for (const entry of store.log) {
      if (entry.kind === 'window') {
        current = entry.index;
        perWindow.set(current, new Set());
      }
      if (entry.kind === 'prompted') perWindow.get(current)?.add(entry.seat);
    }
    for (const phase of timeline.phases) {
      expect(perWindow.get(phase.index)?.size).toBe(ROLES.length);
    }
  });
});

describe('two-round mode is left alone', () => {
  it('keeps its phase count and its length', async () => {
    // The faster, simplified variant. Nothing about publishing may add a
    // window or any waiting to it.
    const two = buildTimeline(ROLES, TWO_ROUND_CONFIG);
    const dependency = buildTimeline(ROLES, DEPENDENCY_CONFIG);
    expect(two.phases).toHaveLength(2);
    expect(two.totalMs).toBeLessThan(dependency.totalMs);

    const { store, timeline } = await night(TWO_ROUND_CONFIG);
    expect(timeline.phases).toHaveLength(2);
    expect(store.log.filter((e) => e.kind === 'window').map((e) => e.index))
      .toEqual([0, 1]);
  });
});
