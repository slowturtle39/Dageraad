import type { Choice, NightEvent, PrivateInfo, SeatIndex } from '../engine/types.js';
import type { LatencySample } from '../engine/telemetry.js';

/**
 * Everything the referee needs from storage, behind an interface.
 *
 * The point is that the referee loop never imports Firebase. Today it runs
 * against InMemoryRoomStore and is fully testable with no cloud account; a
 * FirestoreRoomStore drops in later implementing the same six methods. This is
 * the same discipline that keeps `src/engine/` portable.
 */
export interface RoomStore {
  /** Advance the room's window counter. Rejects late submissions server-side. */
  setWindowIndex(windowIndex: number): Promise<void>;

  /**
   * Submissions for a window, keyed by seat then by decision key.
   * Only ever read by the referee.
   */
  readSubmissions(windowIndex: number): Promise<Map<SeatIndex, Record<string, Choice>>>;

  /**
   * Release private info to one seat. The referee calls this only when the
   * seat's reveal is DUE per the timeline — writing early is the leak.
   */
  releasePrivateInfo(seat: SeatIndex, info: PrivateInfo[]): Promise<void>;

  /** Spoiler-free events for the shared tablet (§12). */
  appendPublicEvents(events: NightEvent[]): Promise<void>;

  /** Append-only timing samples (see telemetry.ts). */
  recordLatency(samples: LatencySample[]): Promise<void>;

  setPhase(phase: 'lobby' | 'night' | 'day' | 'voting' | 'results'): Promise<void>;
}

/** Test/dev implementation. Also what the referee runs against until Firebase exists. */
export class InMemoryRoomStore implements RoomStore {
  windowIndex = 0;
  phase: 'lobby' | 'night' | 'day' | 'voting' | 'results' = 'lobby';
  readonly submissions = new Map<number, Map<SeatIndex, Record<string, Choice>>>();
  readonly released = new Map<SeatIndex, PrivateInfo[]>();
  readonly publicEvents: NightEvent[] = [];
  readonly latency: LatencySample[] = [];

  async setWindowIndex(windowIndex: number): Promise<void> {
    this.windowIndex = windowIndex;
  }

  async readSubmissions(windowIndex: number) {
    return this.submissions.get(windowIndex) ?? new Map();
  }

  async releasePrivateInfo(seat: SeatIndex, info: PrivateInfo[]): Promise<void> {
    const existing = this.released.get(seat) ?? [];
    this.released.set(seat, [...existing, ...info]);
  }

  async appendPublicEvents(events: NightEvent[]): Promise<void> {
    this.publicEvents.push(...events);
  }

  async recordLatency(samples: LatencySample[]): Promise<void> {
    this.latency.push(...samples);
  }

  async setPhase(phase: InMemoryRoomStore['phase']): Promise<void> {
    this.phase = phase;
  }

  /* ----- test helpers, standing in for what a player's phone would write ----- */

  /**
   * Simulates a player submitting. Mirrors the security rule: a write is only
   * accepted while the room is still on the window it was made for.
   */
  submit(windowIndex: number, seat: SeatIndex, choices: Record<string, Choice>): boolean {
    if (windowIndex !== this.windowIndex) return false; // late write, rejected
    const forWindow = this.submissions.get(windowIndex) ?? new Map();
    forWindow.set(seat, { ...(forWindow.get(seat) ?? {}), ...choices });
    this.submissions.set(windowIndex, forWindow);
    return true;
  }
}
