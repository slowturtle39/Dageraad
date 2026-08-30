import { defaultNightOrder } from '../engine/roles.js';
import { buildTimeline, DEFAULT_DURATIONS, type Durations, type Timeline } from '../engine/timeline.js';
import type { LatencySample } from '../engine/telemetry.js';
import type {
  Choice, DecisionRequest, GameConfig, NightResult, NightState, PrivateInfo,
  RoleId, SeatIndex,
} from '../engine/types.js';
import type { Bot } from '../engine/bot.js';
import type { Clock } from './clock.js';
import { PausableClock } from './clock.js';
import { answerKey, probe, requestsForWindow } from './replay.js';
import { publicView } from '../engine/publicview.js';
import { resolvePrecommit } from '../engine/precommit.js';
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
  /**
   * Seats played automatically (test mode, and later a bot filling an empty
   * chair). A bot seat's decisions are generated rather than read from the
   * store; everything else about the window is identical, including its full
   * fixed duration — a bot answering instantly must not shorten it.
   */
  bots?: { seats: ReadonlySet<SeatIndex>; bot: Bot };
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

    // Each seat is told what IT is being asked, and nothing about anyone else.
    // Published before the window's sleep, so a player has the whole window to
    // answer rather than the tail of it. A seat with nothing to do this window
    // is sent an empty list, which is what clears last window's prompt off
    // their screen — silence would leave a stale question on the table.
    const bySeat = new Map<SeatIndex, DecisionRequest[]>();
    for (const seat of everySeat(state)) bySeat.set(seat, []);
    for (const request of requests) {
      bySeat.get(request.seat)?.push(request);
    }
    for (const [seat, forSeat] of bySeat) {
      if (opts.bots?.seats.has(seat)) continue;   // a bot is not reading a screen
      await store.releaseDecisions(seat, forSeat);
    }

    const openedAt = clock.now();

    // RULE 1. Sleep the window's full duration unconditionally. Not "until
    // everyone has submitted" — an empty window and a busy one must look
    // identical from outside, and an empty one happens whenever the role for
    // this window turned out to be sitting in the centre.
    await clock.sleep(phase.endMs - phase.startMs);

    const submitted = await store.readSubmissions(phase.index);
    const paused = clock instanceof PausableClock ? clock.consumeDirty() : false;

    for (const request of requests) {
      // A bot decides instead of the store being consulted. Note this happens
      // AFTER the window has already run its full length, not instead of it: a
      // bot answering in a microsecond must not make its window shorter, or
      // test mode would stop testing the thing that matters most.
      if (opts.bots?.seats.has(request.seat)) {
        answers.set(answerKey(request), opts.bots.bot.choose(request, state));
        continue;
      }

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
      // A stored RULE is not an answer yet. In 'tworound' mode the Heks
      // commits one target per team before she has seen anything, and it is
      // resolved here against the card she actually turned over — the engine
      // handed us that in request.seen. A rule that cannot answer this
      // decision resolves to nothing, which the referee already treats as a
      // decline; firing a pre-commit on the wrong decision would be worse.
      answers.set(answerKey(request), resolveChoice(request, choice));
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

    // What the table can see, recomputed from the state this window resolved
    // to. AFTER the window, never on a tap: publishing when somebody answers
    // would leak that a decision had been made, and from the timing, roughly
    // which one.
    //
    // Published every window rather than only when something changed, because
    // "nothing was revealed this window" and "this window did not run" must
    // look identical from outside — the same reason a window sleeps its full
    // length whether or not anyone is in it.
    await store.publishPublicView(publicView(after.result.state));
  }

  // Final pass with every answer in hand.
  const final = probe(state, nightOrder, config, answers);
  await releaseDueReveals(
    store, final.result, timeline, Number.POSITIVE_INFINITY, releasedSoFar, final.settledSeats,
  );
  const tail = final.result.events.slice(publicEventsWritten);
  if (tail.length > 0) await store.appendPublicEvents(tail);
  await store.publishPublicView(publicView(final.result.state));

  await store.recordLatency(samples);
  // The last scheduled window has no next window to clear its questions.
  // Clear every human explicitly before opening the day; otherwise a timed-out
  // final prompt remains over the table and hides the private no-action/result
  // receipt that explains how the night actually resolved.
  for (const seat of everySeat(state)) {
    if (opts.bots?.seats.has(seat)) continue;
    await store.releaseDecisions(seat, []);
  }
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

/**
 * A submitted choice, or the answer a submitted RULE produces.
 *
 * Kept out of the engine on purpose: the engine's job is to say what it is
 * asking and what the asker has seen, not to hold anybody's stored policy.
 * The classification the rule needs — which team a card belongs to — is engine
 * logic and lives in precommit.ts, so this is only the join between them.
 */
function resolveChoice(request: DecisionRequest, choice: Choice): Choice {
  if (choice.kind !== 'heks-policy') return choice;
  const resolved = resolvePrecommit(request, {
    kind: 'heks-policy',
    policy: { wolf: choice.wolf, looier: choice.looier, village: choice.village },
  });
  return resolved ?? { kind: 'none' };
}

/** Every seat at the table, as indices. */
function everySeat(state: { seatCount: number }): SeatIndex[] {
  return Array.from({ length: state.seatCount }, (_, i) => i as SeatIndex);
}
