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
async function seed(phase = 'night', nightWindowIndex = 0, currentRound = 1) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms', ROOM), {
      hostUid: HOST,
      refereeUid: REF,
      phase,
      nightWindowIndex,
      currentRound,
      activeRoles: ['droomwolf', 'alphawolf', 'mystiekewolf', 'dubbelganger'],
    });
    for (const uid of [ALICE, BOB]) {
      await setDoc(doc(db, 'rooms', ROOM, 'members', uid), {
        uid, joinedAtRound: 1, leftAtRound: null,
      });
    }
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

describe('the abstain toggle during the discussion (§7, revised 2026-08-26)', () => {
  beforeEach(async () => { await seed('day'); });

  it('accepts an abstain while the room is still discussing', async () => {
    // The toggle is live from the first second and a majority counts at ANY
    // moment — which happens in phase 'day'. A voting-only rule would silently
    // reject every abstain and the whole mechanic would appear to do nothing.
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: null, abstain: true,
      }),
    );
  });

  it('accepts switching the abstain back off — it is a show of hands', async () => {
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: null, abstain: false,
      }),
    );
  });

  it('still refuses a named target during the discussion', async () => {
    // Letting somebody lock a target in early would quietly turn a simultaneous
    // vote into a first-mover one, even though nobody can read it yet.
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: BOB, abstain: false,
      }),
    );
  });

  it('still refuses a self-vote, in either phase', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'votes', ALICE), {
        target: ALICE, abstain: true,
      }),
    );
  });

  it('keeps abstains unreadable by other players', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'votes', ALICE), {
        target: null, abstain: true,
      });
    });
    // The public count reaches the table via the room document, written by the
    // referee — never by players reading each other's votes.
    await assertFails(getDoc(doc(as(BOB), 'rooms', ROOM, 'votes', ALICE)));
    await assertSucceeds(getDoc(doc(as(REF), 'rooms', ROOM, 'votes', ALICE)));
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

/* ==================================================================== */

describe('the seed a latecomer starts on cannot be typed', () => {
  // THE GAP THIS CLOSES. A player arriving mid-evening starts level with
  // whoever is currently last, so they join at the back of the pack rather
  // than below it. That number used to live in a `seeded` field on their own
  // member document — a document they own and can write. `seeded: 9999` from
  // devtools won the evening outright, and no rule in this file could tell
  // that write apart from an honest one: rules answer "may you write this",
  // never "was 9999 the correct floor at round four", which needs the whole
  // evening replayed. So the field is gone; the seed is derived from
  // joinedAtRound plus the append-only rounds (session.ts).

  const CARL = 'carl-uid';

  it('refuses a member document carrying a seed at all', async () => {
    // If this ever passes, the scoreboard is decorative.
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 4, leftAtRound: null, seeded: 9999,
      }),
    );
  });

  it('refuses any field the schema does not name, seed-shaped or not', async () => {
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 4, leftAtRound: null, points: 9999,
      }),
    );
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 4, leftAtRound: null, wins: 12,
      }),
    );
  });

  it('accepts an honest join at the round actually being played', async () => {
    await seed('day', 0, 4);
    await assertSucceeds(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 4, leftAtRound: null,
      }),
    );
  });

  it('refuses a join claiming a round the evening has not reached', async () => {
    // joinedAtRound is now the ONLY input a joiner has to their own seed, so
    // claiming round 99 is the same attack as the old seeded: 9999 — it seeds
    // you against a floor that does not exist yet.
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 99, leftAtRound: null,
      }),
    );
  });

  it('refuses a join backdated to an earlier round', async () => {
    // The mirror image, and worth blocking too: backdating would credit
    // somebody with an evening they were not at.
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 1, leftAtRound: null,
      }),
    );
  });

  it('refuses a joinedAtRound that is not a whole number', async () => {
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 4.0001, leftAtRound: null,
      }),
    );
  });

  it('refuses a member document whose uid is not its own id', async () => {
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', CARL), {
        uid: ALICE, joinedAtRound: 4, leftAtRound: null,
      }),
    );
  });

  it('refuses joining on somebody else\'s behalf', async () => {
    await seed('day', 0, 4);
    await assertFails(
      setDoc(doc(as(CARL), 'rooms', ROOM, 'members', ALICE), {
        uid: ALICE, joinedAtRound: 4, leftAtRound: null,
      }),
    );
  });

  it('lets the host add somebody whose phone died', async () => {
    await seed('day', 0, 4);
    await assertSucceeds(
      setDoc(doc(as(HOST), 'rooms', ROOM, 'members', CARL), {
        uid: CARL, joinedAtRound: 4, leftAtRound: null,
      }),
    );
  });

  it('refuses to let an existing member re-seed themselves later', async () => {
    // Alice joined at round 1 on a floor of zero. Moving her joinedAtRound to
    // round 4 would re-seed her at the current floor — the same points-grab as
    // the old forgeable field, wearing a different hat.
    await seed('day', 0, 4);
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE), {
        joinedAtRound: 4,
      }),
    );
  });

  it('refuses to let a seed be smuggled in on an update', async () => {
    await seed('day', 0, 4);
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE), {
        seeded: 9999,
      }),
    );
  });

  it('refuses to let anyone delete a membership', async () => {
    // The rounds you played happened. Deleting the document that says you were
    // here is the tidiest way to rewrite an evening, so nobody may.
    await seed('day', 0, 4);
    await assertFails(deleteDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE)));
    await assertFails(deleteDoc(doc(as(HOST), 'rooms', ROOM, 'members', ALICE)));
    await assertFails(deleteDoc(doc(as(REF), 'rooms', ROOM, 'members', ALICE)));
  });
});

describe('going home, and coming back', () => {
  it('accepts leaving at the round now being played', async () => {
    await seed('day', 0, 4);
    await assertSucceeds(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE), {
        leftAtRound: 4,
      }),
    );
  });

  it('refuses backdating a departure to erase rounds you played', async () => {
    await seed('day', 0, 4);
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE), {
        leftAtRound: 2,
      }),
    );
  });

  it('lets somebody come back without changing what they joined on', async () => {
    await seed('day', 0, 4);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'members', ALICE), {
        uid: ALICE, joinedAtRound: 1, leftAtRound: 3,
      });
    });
    await assertSucceeds(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE), {
        leftAtRound: null,
      }),
    );
  });

  it('refuses a return that also moves the join round', async () => {
    // Coming back must re-use the original joinedAtRound, or stepping out for
    // one round becomes a way to top your score up off the bottom of the table.
    await seed('day', 0, 4);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'members', ALICE), {
        uid: ALICE, joinedAtRound: 1, leftAtRound: 3,
      });
    });
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'members', ALICE), {
        uid: ALICE, joinedAtRound: 4, leftAtRound: null,
      }),
    );
  });

  it('refuses to send somebody else home', async () => {
    await seed('day', 0, 4);
    await assertFails(
      updateDoc(doc(as(BOB), 'rooms', ROOM, 'members', ALICE), {
        leftAtRound: 4,
      }),
    );
  });
});

describe('round records are the scoreboard, so they are append-only', () => {
  const ROUND = { round: 4, activeRoles: ['weerwolf'], seatCount: 4,
    outcome: 'eliminated', results: [], recordedAt: 1 };

  it('the referee can record the round that was just played', async () => {
    await seed('results', 0, 4);
    await assertSucceeds(
      setDoc(doc(as(REF), 'rooms', ROOM, 'rounds', '4'), ROUND),
    );
  });

  it('a player cannot record a round — that is writing your own score', async () => {
    await seed('results', 0, 4);
    await assertFails(
      setDoc(doc(as(ALICE), 'rooms', ROOM, 'rounds', '4'), ROUND),
    );
  });

  it('not even the host can', async () => {
    await seed('results', 0, 4);
    await assertFails(
      setDoc(doc(as(HOST), 'rooms', ROOM, 'rounds', '4'), ROUND),
    );
  });

  it('refuses a record filed under an id that is not its round number', async () => {
    // Create-only stops a round being overwritten; binding the id is what
    // stops the same round being recorded twice under a second name.
    await seed('results', 0, 4);
    await assertFails(
      setDoc(doc(as(REF), 'rooms', ROOM, 'rounds', 'extra'), ROUND),
    );
    await assertFails(
      setDoc(doc(as(REF), 'rooms', ROOM, 'rounds', '5'), ROUND),
    );
  });

  it('refuses a record for a round the evening is not on', async () => {
    await seed('results', 0, 4);
    await assertFails(
      setDoc(doc(as(REF), 'rooms', ROOM, 'rounds', '9'), { ...ROUND, round: 9 }),
    );
  });

  it('refuses extra fields — a round carries results, not totals', async () => {
    await seed('results', 0, 4);
    await assertFails(
      setDoc(doc(as(REF), 'rooms', ROOM, 'rounds', '4'), { ...ROUND, points: 99 }),
    );
  });

  it('cannot be edited or deleted afterwards, by anyone', async () => {
    await seed('results', 0, 4);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'rounds', '4'), ROUND);
    });
    await assertFails(
      updateDoc(doc(as(REF), 'rooms', ROOM, 'rounds', '4'), { outcome: 'won' }),
    );
    await assertFails(
      updateDoc(doc(as(ALICE), 'rooms', ROOM, 'rounds', '4'), { outcome: 'won' }),
    );
    await assertFails(deleteDoc(doc(as(REF), 'rooms', ROOM, 'rounds', '4')));
    await assertFails(deleteDoc(doc(as(HOST), 'rooms', ROOM, 'rounds', '4')));
  });

  it('is readable by everyone — the scoreboard is built from it client-side', async () => {
    await seed('results', 0, 4);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'rounds', '4'), ROUND);
    });
    await assertSucceeds(getDoc(doc(as(ALICE), 'rooms', ROOM, 'rounds', '4')));
    await assertSucceeds(getDoc(doc(as(BOB), 'rooms', ROOM, 'members', ALICE)));
  });
});

describe('the round counter only ever goes forward', () => {
  it('the referee can advance it, which is the legitimate case', async () => {
    await seed('results', 0, 4);
    await assertSucceeds(
      updateDoc(doc(as(REF), 'rooms', ROOM), { currentRound: 5 }),
    );
  });

  it('nobody can wind it back', async () => {
    // Rewinding would let a member be admitted again against a floor the
    // evening has already moved past — the derived seed's one soft spot.
    await seed('results', 0, 4);
    await assertFails(
      updateDoc(doc(as(REF), 'rooms', ROOM), { currentRound: 2 }),
    );
    await assertFails(
      updateDoc(doc(as(HOST), 'rooms', ROOM), { currentRound: 2 }),
    );
  });
});
