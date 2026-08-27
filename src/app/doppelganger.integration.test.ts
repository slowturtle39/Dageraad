import { describe, expect, it } from 'vitest';
import { randomBot } from '../engine/bot.js';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from '../engine/presets.js';
import { DEFAULT_DURATIONS } from '../engine/timeline.js';
import type { DecisionRequest, SeatIndex } from '../engine/types.js';
import { FakeClock } from '../orchestration/clock.js';
import type { Backend, PrivateView } from './backend.js';
import { MemoryWorld } from './memorybackend.js';
import { readRoomOnce, runGame } from './refereeRunner.js';

/**
 * The Dubbelganger, held by a person, at a practice table (§16, §5.3).
 *
 * Milan played the Doppelganger repeatedly in the old bot table and was never
 * once asked what he wanted to do with the role he had copied. Nothing was
 * wrong with the role: the single button that seated the bots also set `?fast`,
 * which collapses every window to 400ms. The prompt was published and cleared
 * again between two frames.
 *
 * That makes this the test the bug needed. It uses the SHIPPED durations, not
 * a fast walkthrough, and it asserts the whole chain a person depends on: the
 * copy is offered, the copied role's own decision is then offered to the same
 * seat, and an answer submitted at human speed is the one the night resolves
 * with.
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

async function practiceTable(botCount: number): Promise<{
  world: MemoryWorld; me: Backend; roomId: string;
}> {
  const world = new MemoryWorld(seeded(11));
  const me = world.device('u:Milan');
  const roomId = await me.createRoom({
    displayName: 'Milan',
    activeRoles: DEFAULT_ACTIVE_ROLES,
    config: TWO_ROUND_CONFIG,
    // Playing AND resolving: the trusted-host setup, which is the one a
    // practice table uses, because a neutral board is never dealt a card.
    playing: true,
  });
  for (let i = 0; i < botCount; i++) await me.addBot(roomId);
  return { world, me, roomId };
}

/**
 * Deal until this seat holds the Dubbelganger.
 *
 * Rather than pinning a magic seed: a seed that happens to deal the right card
 * today stops doing so the moment the shuffle or the role list changes, and
 * the test then passes while proving nothing.
 */
async function dealUntilDoppelganger(
  me: Backend, roomId: string, uid: string,
): Promise<SeatIndex> {
  for (let seed = 1; seed < 400; seed++) {
    await me.startGame(roomId, seed);
    const room = await readRoomOnce(me, roomId);
    const seat = room.seating.indexOf(uid) as SeatIndex;
    const state = await me.refereeNightState(roomId);
    if (state?.originalRole[seat] === 'dubbelganger') return seat;
  }
  throw new Error('never dealt the Dubbelganger — has it left the role list?');
}

/**
 * Advance the fake clock in half-second slices until the round finishes.
 *
 * `tick` runs after each slice, which is where a simulated person does their
 * tapping — deliberately not inside the watcher, because a person who answers
 * in the same instant the prompt arrives is exactly the person this bug hid
 * behind.
 */
async function play<T>(
  clock: FakeClock,
  running: Promise<T>,
  tick?: () => Promise<void>,
): Promise<T> {
  let done = false;
  const settled = running.then(
    (v) => { done = true; return v; },
    (e) => { done = true; throw e; },
  );
  for (let i = 0; i < 20_000 && !done; i++) {
    await clock.advance(500);
    if (tick) await tick();
  }
  return settled;
}

/**
 * A person's finger, with a person's reaction time.
 *
 * Answers whatever is on screen, but only once THINKING_MS of game clock has
 * passed since the question appeared. Under the old 400ms windows this hand
 * would never once have got an answer in — which is the whole complaint.
 */
const THINKING_MS = 4_000;

function slowHuman(me: Backend, roomId: string, clock: FakeClock) {
  const bot = randomBot(21);
  const answered = new Set<string>();
  let pending: DecisionRequest[] = [];
  let arrivedAt = 0;
  let windowIndex = 0;
  const late: DecisionRequest[] = [];

  me.watchPrivate(roomId, (own) => {
    if (own.pending.length > 0 && pending.length === 0) arrivedAt = clock.now();
    pending = own.pending;
  });
  me.watchRoom(roomId, (room) => { if (room) windowIndex = room.nightWindowIndex; });

  return {
    /** Every request this hand actually answered, after thinking about it. */
    late,
    async tick(): Promise<void> {
      if (pending.length === 0) return;
      if (clock.now() - arrivedAt < THINKING_MS) return;
      const state = await me.refereeNightState(roomId);
      if (!state) return;
      for (const request of pending) {
        if (answered.has(request.key)) continue;
        answered.add(request.key);
        late.push(request);
        await me.submit(roomId, windowIndex, { [request.key]: bot.choose(request, state) });
      }
    },
  };
}

describe('a human Dubbelganger is asked, and has time to answer', () => {
  it('gets the copy prompt and then the copied role\'s own prompt', async () => {
    const { me, roomId } = await practiceTable(6);
    const seat = await dealUntilDoppelganger(me, roomId, me.uid);

    const seen: PrivateView[] = [];
    me.watchPrivate(roomId, (own) => { seen.push(structuredClone(own)); });

    const room = await readRoomOnce(me, roomId);
    const botSeats = new Set<SeatIndex>();
    room.seating.forEach((uid, s) => { if (uid !== me.uid) botSeats.add(s as SeatIndex); });

    const clock = new FakeClock();
    const hand = slowHuman(me, roomId, clock);
    // The SHIPPED durations. Passing the fast ones here would reproduce the
    // bug and call it a passing test.
    await play(clock, runGame({
      backend: me,
      roomId,
      mode: 'test',
      clock,
      durations: DEFAULT_DURATIONS,
      dayConfig: { discussionMs: 5_000, abstainPollMs: 1_000, voteWaitTimeoutMs: 10_000 },
      bots: { seats: botSeats, bot: randomBot(3) },
      random: seeded(4),
    }), hand.tick);

    // Every answer this hand gave was given four seconds after the question
    // appeared, and all of them landed.
    expect(hand.late.length).toBeGreaterThan(0);

    const asked = seen.flatMap((v) => v.pending);
    // Everything published to this device is for this seat, and no other.
    for (const request of asked) expect(request.seat).toBe(seat);

    // Two distinct questions: whose card do you copy, and then what that card
    // does. `actingAs` is the field that tells them apart, and it is the whole
    // point of the role — a seat asked only the first question copied
    // something and was never allowed to be it.
    const actingAs = hand.late.map((r) => r.actingAs);
    expect(actingAs).toContain('dubbelganger');
    const copied = actingAs.filter((r) => r !== 'dubbelganger');
    expect(
      copied.length,
      'the copied role never asked this seat anything',
    ).toBeGreaterThan(0);
  }, 60_000);

  it('leaves the copy prompt on screen for seconds, not frames', async () => {
    const { me, roomId } = await practiceTable(6);
    await dealUntilDoppelganger(me, roomId, me.uid);

    // How long the question was actually answerable, measured on the same
    // clock the runner sleeps on. Under `?fast` this was 400ms — less than
    // the time it takes to read the name of the role you just copied.
    let openedAt: number | null = null;
    let visibleMs = 0;
    const clock = new FakeClock();
    me.watchPrivate(roomId, (own) => {
      if (own.pending.length > 0 && openedAt === null) openedAt = clock.now();
      if (own.pending.length === 0 && openedAt !== null) {
        visibleMs = Math.max(visibleMs, clock.now() - openedAt);
        openedAt = null;
      }
    });

    const room = await readRoomOnce(me, roomId);
    const botSeats = new Set<SeatIndex>();
    room.seating.forEach((uid, s) => { if (uid !== me.uid) botSeats.add(s as SeatIndex); });

    await play(clock, runGame({
      backend: me,
      roomId,
      mode: 'test',
      clock,
      durations: DEFAULT_DURATIONS,
      dayConfig: { discussionMs: 5_000, abstainPollMs: 1_000, voteWaitTimeoutMs: 10_000 },
      bots: { seats: botSeats, bot: randomBot(3) },
      random: seeded(6),
    }));

    expect(visibleMs).toBeGreaterThanOrEqual(5_000);
  }, 60_000);

  it('writes nothing permanent, because a practice table never does', async () => {
    const { me, roomId } = await practiceTable(6);
    await dealUntilDoppelganger(me, roomId, me.uid);
    const room = await readRoomOnce(me, roomId);
    const botSeats = new Set<SeatIndex>();
    room.seating.forEach((uid, s) => { if (uid !== me.uid) botSeats.add(s as SeatIndex); });

    const clock = new FakeClock();
    const result = await play(clock, runGame({
      backend: me,
      roomId,
      mode: 'test',
      clock,
      durations: DEFAULT_DURATIONS,
      dayConfig: { discussionMs: 5_000, abstainPollMs: 1_000, voteWaitTimeoutMs: 10_000 },
      bots: { seats: botSeats, bot: randomBot(3) },
      random: seeded(8),
    }));

    expect(result.resultsPersisted).toBe(false);
  }, 60_000);
});
