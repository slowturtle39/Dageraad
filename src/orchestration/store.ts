import type {
  Choice, DecisionRequest, NightEvent, PrivateInfo, SeatIndex,
} from '../engine/types.js';
import type { PublicNightView } from '../engine/publicview.js';
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

  /**
   * Tell one seat what it is being asked, for the window now open.
   *
   * A player device cannot work this out for itself. The decisions come from
   * the DEAL, and the deal only ever exists on the referee — that is the whole
   * arrangement. So the referee, which already knows because it just asked,
   * writes each seat's own request into that seat's private document.
   *
   * It leaks nothing: a request carries the asking seat's own role and its own
   * reveal, both of which that player already has. What it must never do is
   * carry somebody ELSE's request, which is why this is per-seat rather than a
   * broadcast the client filters.
   */
  releaseDecisions(seat: SeatIndex, requests: DecisionRequest[]): Promise<void>;

  /** Spoiler-free events for the shared tablet (§12). */
  appendPublicEvents(events: NightEvent[]): Promise<void>;

  /**
   * Publish what the table can currently SEE, derived fresh from the resolved
   * state (see engine/publicview.ts).
   *
   * Replaces wholesale rather than accumulating, and that is the entire point.
   * A face-up card belongs to the CARD, not to the seat it was flipped at, and
   * every role that moves cards acts after the Medium — so a map built up from
   * old reveal events is right until the interesting part of the night and
   * quietly wrong afterwards.
   *
   * Called only when a scheduled window RESOLVES, never when somebody taps.
   * Publishing on a tap would leak the fact that a decision had been made, and
   * to anyone watching the timing, roughly what it was.
   */
  publishPublicView(view: PublicNightView): Promise<void>;

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

  published: PublicNightView = { revealed: {}, shielded: [] };

  async publishPublicView(view: PublicNightView): Promise<void> {
    this.published = { revealed: { ...view.revealed }, shielded: [...view.shielded] };
  }

  readonly prompts = new Map<SeatIndex, DecisionRequest[]>();

  async releaseDecisions(seat: SeatIndex, requests: DecisionRequest[]): Promise<void> {
    this.prompts.set(seat, requests);
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
