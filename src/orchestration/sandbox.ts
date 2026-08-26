import type { LatencySample } from '../engine/telemetry.js';
import type { NightEvent, PrivateInfo, SeatIndex } from '../engine/types.js';
import type { Vote } from '../engine/dayphase.js';
import type { DayStore } from './dayrunner.js';
import type { RoomStore } from './store.js';

/**
 * TEST MODE (§16).
 *
 * A wrapper that makes it STRUCTURALLY impossible for a test game to touch
 * anything permanent. Not a boolean somebody has to remember to check at four
 * separate call sites — a store that physically cannot write those documents.
 *
 * What it blocks and why:
 *
 *  - **Latency samples.** A test night is played by bots that answer instantly,
 *    so its timings are nonsense. Feeding them to calibration (telemetry.ts)
 *    would drag every future window towards zero and start costing real players
 *    their turns. This is the dangerous one: the damage would show up weeks
 *    later, at a real table, looking like a completely unrelated bug.
 *  - **Results.** Stats aggregate from append-only result documents, so a test
 *    game would permanently inflate somebody's record with games they never
 *    played, and there is no delete path by design.
 *
 * What it deliberately still does: window advancement, submissions, reveal
 * release, public events. Those are what you are testing.
 */
export class SandboxStore implements RoomStore, DayStore {
  /** Everything that was blocked, so a test can assert nothing leaked out. */
  readonly blocked: { method: string; count: number }[] = [];

  constructor(private readonly inner: RoomStore & Partial<DayStore>) {}

  private block(method: string): void {
    const existing = this.blocked.find((b) => b.method === method);
    if (existing) existing.count++;
    else this.blocked.push({ method, count: 1 });
  }

  /* ----- blocked: anything that outlives the test game ----- */

  async recordLatency(samples: LatencySample[]): Promise<void> {
    // Silently dropping would be worse than useless — it would look like it
    // worked. The count is exposed on `blocked` and surfaced in the UI banner.
    this.block(`recordLatency(${samples.length})`);
  }

  /* ----- passed through: the things under test ----- */

  setWindowIndex(windowIndex: number) {
    return this.inner.setWindowIndex(windowIndex);
  }
  readSubmissions(windowIndex: number) {
    return this.inner.readSubmissions(windowIndex);
  }
  releasePrivateInfo(seat: SeatIndex, info: PrivateInfo[]) {
    return this.inner.releasePrivateInfo(seat, info);
  }
  appendPublicEvents(events: NightEvent[]) {
    return this.inner.appendPublicEvents(events);
  }
  setPhase(phase: 'lobby' | 'night' | 'day' | 'voting' | 'results') {
    return this.inner.setPhase(phase);
  }
  async readVotes(): Promise<Map<SeatIndex, Vote>> {
    return this.inner.readVotes?.() ?? new Map();
  }
  async announceExtension(extraMs: number): Promise<void> {
    await this.inner.announceExtension?.(extraMs);
  }
}

/**
 * Whether a finished game may be written to anyone's permanent record.
 *
 * Checked at the one place results are saved. A test game returns false and the
 * write never happens.
 */
export function mayRecordResults(mode: GameMode): boolean {
  return mode === 'live';
}

export type GameMode = 'live' | 'test';

/**
 * Banner text for test mode.
 *
 * Everywhere else in this app, looking identical is the safety rule (§13.1).
 * Here it is inverted: a test game must be UNMISTAKABLE, because the failure it
 * guards against is somebody playing a real evening on it and wondering why no
 * stats appeared. So test mode is allowed — required — to look wrong.
 */
export const TEST_MODE_BANNER = {
  nl: 'TESTMODUS — bots spelen mee, geen stats, geen kalibratie',
  en: 'TEST MODE — bots are playing, no stats, no calibration',
} as const;
