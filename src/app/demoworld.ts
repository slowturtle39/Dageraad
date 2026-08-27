import { randomBot } from '../engine/bot.js';
import { MemoryWorld } from './memorybackend.js';
import type { Backend } from './backend.js';
import type { BotSeats } from './refereeRunner.js';
import type { SeatIndex } from '../engine/types.js';

/**
 * A whole table in one browser tab.
 *
 * `?demo` exists so the app can be walked through with nobody else and no
 * Firebase project — before a deploy, on a train, or when a config is broken
 * and somebody still needs to see the screens. It is the same MemoryWorld
 * every test runs against, so what happens here is what happens for real,
 * minus the network.
 *
 * The people around you are bots. They are NOT the referee writing on their
 * behalf: each has its own Backend, so its vote meets exactly the same
 * refusals yours does — no self-vote, no target before voting opens. A
 * shortcut there would make the demo stop exercising the thing it exists to
 * exercise.
 */

const DEMO_NAMES = ['Sanne', 'Joris', 'Fleur', 'Daan', 'Noor', 'Bram', 'Eva'];

export interface DemoTable {
  /** This browser tab's own device. */
  me: Backend;
  /** Everyone else, by uid, in the order they joined. */
  bots: Backend[];
}

/**
 * One world, one human, and enough company to deal a round.
 *
 * Seven bots plus you is eight, which is the table §5.1 works through — and
 * three is the floor anyway, since the deal needs seatCount + 3 cards.
 */
export function demoTable(random: () => number, botCount = DEMO_NAMES.length): DemoTable {
  const world = new MemoryWorld(random);
  const me = world.device(`demo:you`);
  const bots = DEMO_NAMES.slice(0, botCount).map((name) => world.device(`demo:${name}`));
  return { me, bots };
}

/** Sit the bots down in a room this device has created. */
export async function seatDemoBots(table: DemoTable, roomId: string): Promise<void> {
  for (let i = 0; i < table.bots.length; i++) {
    await table.bots[i]!.joinRoom(roomId, DEMO_NAMES[i]!);
  }
}

/**
 * Which seats the bots hold, given the seating the deal produced.
 *
 * Derived from the seating rather than remembered, because the round boundary
 * re-seats the table: somebody who left is gone and a newcomer is on the end,
 * so last round's seat numbers are not this round's.
 */
export function botSeatsFor(
  table: DemoTable,
  seating: string[],
  seed: number,
): BotSeats {
  const byUid = new Map(table.bots.map((b) => [b.uid, b]));
  const seats = new Set<SeatIndex>();
  seating.forEach((uid, seat) => {
    if (byUid.has(uid)) seats.add(seat as SeatIndex);
  });

  return {
    seats,
    bot: randomBot(seed),
    device(seat: SeatIndex): Backend {
      const uid = seating[seat];
      const device = uid === undefined ? undefined : byUid.get(uid);
      if (!device) throw new Error(`seat ${seat} is not a demo bot`);
      return device;
    },
  };
}
