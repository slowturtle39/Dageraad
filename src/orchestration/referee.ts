import { defaultNightOrder } from '../engine/roles.js';
import { buildTimeline, DEFAULT_DURATIONS, type Durations, type Timeline } from '../engine/timeline.js';
import type { LatencySample } from '../engine/telemetry.js';
import type {
  Choice, DecisionRequest, GameConfig, NightResult, NightState, PrivateInfo,
  RoleId, SeatIndex,
} from '../engine/types.js';
import type { Clock } from './clock.js';
import { PausableClock } from './clock.js';
import { answerKey, probe, requestsForWindow } from './replay.js';
import type { RoomStore } from './store.js';

/**
 * The referee loop — the thing that actually runs a night.
 *
 * This is the device holding every player's card (see README "Trust model"),
 * so it is also the thing that must be careful about WHEN it writes. The two
 * rules it exists to enforce:
 *
 *  1. **Every window runs for its full fixed duration**, whether or not anybody
 *     in it has an action. A window that ends early because nobody was playing
 *     that role tells the table exactly where that card is.
 *
 *  2. **A seat's private info is written only when its reveal is due**, per the
 *     timeline. Writing a reveal early is the same leak by a different route.
 *
 * Neither rule ever consults the deal. The timeline is computed from the public
 * active-role list alone, and this loop just walks it.
 */

export interface RefereeOptions {
  state: NightState;
  activeRoles: RoleId[];
  config: GameConfig;
  store: RoomStore;
  clock: Clock;
  durations?: Durations;
  /** Optional: called when a window opens, so a UI can prompt. */
  onWindowOpen?: (window: WindowInfo) => void;
}

export interface WindowInfo {
  index: number;
  kind: 'open' | 'followup';
  role: RoleId | null;
  /** Who is actually being asked something. Referee-only knowledge. */
  requests: DecisionRequest[];
  closesAtMs: number;
}

export interface NightRunResult {
  result: NightResult;
  timeline: Timeline;
  /** Latency samples gathered, for calibration between sessions. */
  samples: LatencySample[];
  /** Decisions that were never submitted and defaulted to no action. */
  timedOut: DecisionRequest[];
}

/**
 * Run one night start to finish.
 *
 * Structure: walk the timeline's phases. For each, work out which outstanding
 * decisions belong to it, open it, wait out its FULL duration, collect whatever
 * arrived, then release the reveals that have come due. Repeat.
 */
export async function runNight(opts: RefereeOptions): Promise<NightRunResult> {
  const { state, activeRoles, config, store, clock } = opts;
  const durations = opts.durations ?? DEFAULT_DURATIONS;
  const nightOrder = defaultNightOrder(activeRoles);
  const timeline = buildTimeline(activeRoles, config, durations);

  const answers = new Map<string, Choice>();
  const samples: LatencySample[] = [];
  const timedOut: DecisionRequest[] = [];
  const releasedSoFar = new Map<SeatIndex, number>();
  let publicEventsWritten = 0;

  await store.setPhase('night');

  for (const phase of timeline.phases) {
    const current = probe(state, nightOrder, config, answers);
    const requests = requestsForWindow(current, state, phase);

    await store.setWindowIndex(phase.index);
    opts.onWindowOpen?.({
      index: phase.index,
      kind: phase.kind,
      role: phase.role,
      requests,
      closesAtMs: phase.endMs,
    });

    const openedAt = clock.now();

    // RULE 1. Sleep the window's full duration unconditionally. Not "until
    // everyone has submitted" — an empty window and a busy one must look
    // identical from outside, and an empty one happens whenever the role for
    // this window turned out to be sitting in the centre.
    await clock.sleep(phase.endMs - phase.startMs);

    const submitted = await store.readSubmissions(phase.index);
    const paused = clock instanceof PausableClock ? clock.consumeDirty() : false;

    for (const request of requests) {
      const choices = submitted.get(request.seat);
      const choice = choices?.[request.key];
      const latencyMs = clock.now() - openedAt;

      if (choice === undefined) {
        timedOut.push(request);
        samples.push({
          role: request.actingAs, key: request.key, latencyMs,
          outcome: 'timed-out', paused, sessionId: 'local',
        });
        // A missed deadline is a DECIDED decline, not a pending decision. Record
        // it as an answer, or the seat stays permanently "unsettled" and never
        // receives any of its reveals — one slow tap would black out a player's
        // whole night.
        answers.set(answerKey(request), { kind: 'none' });
        continue;
      }
      answers.set(answerKey(request), choice);
      samples.push({
        role: request.actingAs, key: request.key, latencyMs,
        outcome: 'submitted', paused, sessionId: 'local',
      });
    }

    // RULE 2. Release only what is due at this phase's reveal point.
    const after = probe(state, nightOrder, config, answers);
    await releaseDueReveals(
      store, after.result, timeline, phase.revealAtMs, releasedSoFar, after.settledSeats,
    );

    const events = after.result.events.slice(publicEventsWritten);
    if (events.length > 0) {
      await store.appendPublicEvents(events);
      publicEventsWritten = after.result.events.length;
    }
  }

  // Final pass with every answer in hand.
  const final = probe(state, nightOrder, config, answers);
  await releaseDueReveals(
    store, final.result, timeline, Number.POSITIVE_INFINITY, releasedSoFar, final.settledSeats,
  );
  const tail = final.result.events.slice(publicEventsWritten);
  if (tail.length > 0) await store.appendPublicEvents(tail);

  await store.recordLatency(samples);
  await store.setPhase('day');

  return { result: final.result, timeline, samples, timedOut };
}

/**
 * Write out each seat's private info that has come due, and no more.
 *
 * A seat's reveal time is looked up by the role it was DEALT, because that is
 * what determines its slot in the night order (§6.0) — not whatever card it may
 * be holding by now.
 *
 * `settledSeats` is the safety catch: a seat with an outstanding decision has a
 * provisional resolution downstream of a placeholder answer, and none of that
 * may be written. Without this check a slow player's own screen could show them
 * a result computed as if they had declined.
 */
async function releaseDueReveals(
  store: RoomStore,
  result: NightResult,
  timeline: Timeline,
  nowMs: number,
  releasedSoFar: Map<SeatIndex, number>,
  settledSeats: Set<SeatIndex>,
): Promise<void> {
  for (const [seatKey, info] of Object.entries(result.privateInfo)) {
    const seat = Number(seatKey);
    if (!settledSeats.has(seat)) continue;

    const dealt = result.state.originalRole[seat];
    const dueAt = dealt ? timeline.revealAtMs[dealt] : undefined;
    // A seat whose role has no reveal gate (no night action) still receives
    // anything addressed to it — the Rechter's private notice, for instance.
    if (dueAt !== undefined && dueAt > nowMs) continue;

    const already = releasedSoFar.get(seat) ?? 0;
    const fresh: PrivateInfo[] = info.slice(already);
    if (fresh.length === 0) continue;

    await store.releasePrivateInfo(seat, fresh);
    releasedSoFar.set(seat, info.length);
  }
}
