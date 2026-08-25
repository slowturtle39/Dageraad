import { readFileSync } from 'node:fs';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/**
 * Security rules tests, written as ATTACKS rather than happy paths.
 *
 * The threat model is a player at the table with devtools open, not a stranger
 * on the internet. Every test below is something one of Milan's friends could
 * plausibly try, and the one that matters most is "make myself the referee".
 *
 * Run with:  npm run test:rules   (starts the emulator for you)
 */

const ROOM = 'room1';
const HOST = 'host-uid';
const REF = 'tablet-uid';    // the neutral tablet acts as referee
const ALICE = 'alice-uid';
const BOB = 'bob-uid';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dageraad-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await env?.cleanup(); });

/** Seed a room mid-night with Alice and Bob seated and dealt. */
async function seed(phase = 'night', nightWindowIndex = 0) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms', ROOM), {
      hostUid: HOST,
      refereeUid: REF,
      phase,
      nightWindowIndex,
      activeRoles: ['droomwolf', 'alphawolf', 'mystiekewolf', 'dubbelganger'],
    });
    for (const uid of [ALICE, BOB]) {
      await setDoc(doc(db, 'rooms', ROOM, 'players', uid), {
        displayName: uid, seatIndex: uid === ALICE ? 0 : 1,
      });
    }
    await setDoc(doc(db, 'rooms', ROOM, 'private', ALICE), {
      originalRole: 'alphawolf', currentCard: 'c0', privateInfo: [],
    });
    await setDoc(doc(db, 'rooms', ROOM, 'private', BOB), {
      originalRole: 'mystiekewolf', currentCard: 'c1', privateInfo: [],
    });
    await setDoc(doc(db, 'rooms', ROOM, 'engine', 'state'), {
      slots: ['c0', 'c1', 'c2', 'c3', 'c4'],
      cardRole: { c0: 'alphawolf', c1: 'mystiekewolf' },
    });
    await setDoc(doc(db, 'rooms', ROOM, 'submissions', ALICE), {
      windowIndex: 0, choice: { kind: 'seat', seat: 1 },
    });
  });
}

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeEach(async () => { await seed(); });

/* ==================================================================== */

describe('the load-bearing rule: nobody can become the referee', () => {
  it('a player cannot promote themselves to referee', async () => {
    // If this ever passes, every card in the game is readable by that player.
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM), { refereeUid: ALICE }),
    );
  });

  it('even the HOST cannot reassign the referee', async () => {
    await assertFails(
      updateDoc(doc(as(HOST), 'rooms', ROOM), { refereeUid: HOST }),
    );
  });

  it('the referee cannot hand the role to someone else mid-game', async () => {
    await assertFails(
      updateDoc(doc(as(REF), 'rooms', ROOM), { refereeUid: ALICE }),
    );
  });

  it('nobody can reassign the host either', async () => {
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM), { hostUid: ALICE }),
    );
  });

  it('the host can still advance the phase, which is the legitimate case', async () => {
    await assertSucceeds(
      updateDoc(doc(as(HOST), 'rooms', ROOM), { phase: 'voting' }),
    );
  });
});

describe('secret cards', () => {
  it('a player cannot read another player\'s card', async () => {
    await assertFails(getDoc(doc(as(BOB), 'rooms', ROOM, 'private', ALICE)));
  });

  it('a player CAN read their own', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'rooms', ROOM, 'private', ALICE)));
  });

  it('a player cannot rewrite their own role', async () => {
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'private', ALICE), {
        originalRole: 'dorpeling',
      }),
    );
  });

  it('a player cannot fabricate a reveal for themselves', async () => {
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'private', ALICE), {
        privateInfo: [{ kind: 'saw-card', slot: 1, role: 'weerwolf' }],
      }),
    );
  });

  it('the referee can read and write everyone, which it must to resolve', async () => {
    await assertSucceeds(getDoc(doc(as(REF), 'rooms', ROOM, 'private', ALICE)));
    await assertSucceeds(getDoc(doc(as(REF), 'rooms', ROOM, 'private', BOB)));
    await assertSucceeds(
      updateDoc(doc(as(REF), 'rooms', ROOM, 'private', BOB), { currentCard: 'c9' }),
    );
  });
});

describe('the full deal', () => {
  it('is unreadable by players', async () => {
    await assertFails(getDoc(doc(as(ALICE), 'rooms', ROOM, 'engine', 'state')));
    await assertFails(getDoc(doc(as(HOST), 'rooms', ROOM, 'engine', 'state')));
  });

  it('is readable by the referee', async () => {
    await assertSucceeds(getDoc(doc(as(REF), 'rooms', ROOM, 'engine', 'state')));
  });
});

describe('night submissions', () => {
  it('cannot be read by another player — a target often reveals a role', async () => {
    await assertFails(getDoc(doc(as(BOB), 'rooms', ROOM, 'submissions', ALICE)));
  });

  it('can be written for the current window', async () => {
    await assertSucceeds(
      setDoc(doc(as(BOB), 'rooms', ROOM, 'submissions', BOB), {
        windowIndex: 0, choice: { kind: 'seat', seat: 0 },
      }),
    );
  });

  it('cannot be written for a window that has already closed', async () => {
    await seed('night', 1); // room has moved on to window 1
    await assertFails(
      setDoc(doc(as(BOB), 'rooms', ROOM, 'submissions', BOB), {
        windowIndex: 0, choice: { kind: 'seat', seat: 0 },
      }),
    );
  });

  it('cannot be submitted on somebody else\'s behalf', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'rooms', ROOM, 'submissions', ALICE), {
        windowIndex: 0, choice: { kind: 'seat', seat: 0 },
      }),
    );
  });

  it('cannot be deleted to hide what you did', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'rooms', ROOM, 'submissions', ALICE)));
  });
});

describe('voting', () => {
  beforeEach(async () => { await seed('voting'); });

  it('rejects a self-vote at the rules level, not just in the UI', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: ALICE, abstain: false,
      }),
    );
  });

  it('accepts a normal vote', async () => {
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: BOB, abstain: false,
      }),
    );
  });

  it('keeps votes hidden from other players while voting is open', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'votes', ALICE), {
        target: BOB, abstain: false,
      });
    });
    // Otherwise the last person to vote sees the tally before deciding.
    await assertFails(getDoc(doc(as(BOB), 'rooms', ROOM, 'votes', ALICE)));
  });

  it('opens votes to everyone once the results are in', async () => {
    await seed('results');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'votes', ALICE), {
        target: BOB, abstain: false,
      });
    });
    await assertSucceeds(getDoc(doc(as(BOB), 'rooms', ROOM, 'votes', ALICE)));
  });

  it('cannot be cast before the voting phase', async () => {
    await seed('night');
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: BOB, abstain: false,
      }),
    );
  });
});

describe('results are append-only, so history is tamper-evident', () => {
  beforeEach(async () => { await seed('results'); });

  it('the referee can record a result once', async () => {
    await assertSucceeds(
      setDoc(doc(as(REF), 'rooms', ROOM, 'results', ALICE), {
        finalRole: 'alphawolf', won: false,
      }),
    );
  });

  it('a player cannot record their own result', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'results', ALICE), {
        finalRole: 'dorpeling', won: true,
      }),
    );
  });

  it('nobody can edit a recorded result — not even the referee', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'results', ALICE), {
        finalRole: 'alphawolf', won: false,
      });
    });
    await assertFails(
      updateDoc(doc(as(REF), 'rooms', ROOM, 'results', ALICE), { won: true }),
    );
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'results', ALICE), { won: true }),
    );
    await assertFails(deleteDoc(doc(as(REF), 'rooms', ROOM, 'results', ALICE)));
  });
});

describe('profiles', () => {
  it('are readable by everyone — the stats-on-tap cover traffic needs it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'profiles', ALICE), { displayName: 'Alice' });
    });
    await assertSucceeds(getDoc(doc(as(BOB), 'profiles', ALICE)));
  });

  it('can only be edited by their owner', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'profiles', ALICE), { displayName: 'hacked' }),
    );
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'profiles', ALICE), { displayName: 'Alice' }),
    );
  });

  it('reject smuggled-in stats fields — stats live only in results docs', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'profiles', ALICE), {
        displayName: 'Alice', wins: 999,
      }),
    );
  });
});

describe('calibration telemetry', () => {
  it('accepts a timing sample', async () => {
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'calibration', 's1'), {
        role: 'dubbelganger', key: 'doppel-view', latencyMs: 4200,
        outcome: 'submitted', paused: false, sessionId: 'abc',
      }),
    );
  });

  it('rejects a sample carrying who was playing the role', async () => {
    // Samples are keyed by role NAME only. Attaching a uid would turn the
    // calibration collection into a public record of who played what.
    await assertFails(
      setDoc(doc(as(ALICE), 'calibration', 's2'), {
        role: 'dubbelganger', key: 'doppel-view', latencyMs: 4200,
        outcome: 'submitted', paused: false, sessionId: 'abc', playerUid: ALICE,
      }),
    );
  });

  it('is append-only', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'calibration', 's3'), {
        role: 'heks', key: 'heks-target', latencyMs: 1,
        outcome: 'submitted', paused: false, sessionId: 'x',
      });
    });
    await assertFails(
      updateDoc(doc(as(ALICE), 'calibration', 's3'), { latencyMs: 99999 }),
    );
  });
});

describe('signed-out access', () => {
  it('is denied everywhere', async () => {
    await assertFails(getDoc(doc(anon(), 'rooms', ROOM)));
    await assertFails(getDoc(doc(anon(), 'rooms', ROOM, 'private', ALICE)));
    await assertFails(getDoc(doc(anon(), 'profiles', ALICE)));
  });
});

describe('unknown collections are denied by default', () => {
  it('rejects writes to a path the rules never mention', async () => {
    await assertFails(setDoc(doc(as(ALICE), 'anything', 'x'), { a: 1 }));
    await assertFails(
      setDoc(doc(as(REF), 'rooms', ROOM, 'somethingNew', 'x'), { a: 1 }),
    );
  });
});
