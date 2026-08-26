import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deal, cardsForRoles } from '../engine/deal.js';
import { engineStateFromDoc, engineStateToDoc } from './schema.js';
import type { RoleId } from '../engine/types.js';

/**
 * The two backends must stay interchangeable.
 *
 * Every one of the tests in this repository runs against MemoryBackend; the
 * real game runs against FirestoreBackend. If the two drift, the suite keeps
 * passing while the app breaks — the worst failure mode available to us.
 * TypeScript catches a missing method. It does not catch a method that exists
 * on both and behaves differently, which is the drift that actually happens,
 * so the interesting checks here are about shape and serialisation.
 */

const firestore = readFileSync('src/firestore/backend.ts', 'utf8');
const memory = readFileSync('src/app/memorybackend.ts', 'utf8');
const iface = readFileSync('src/app/backend.ts', 'utf8');
const schema = readFileSync('src/firestore/schema.ts', 'utf8');

/** Method names declared on the Backend interface. */
function backendMethods(): string[] {
  const start = iface.indexOf('export interface Backend {');
  const body = iface.slice(start, iface.indexOf('\n}', start));
  return [...body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    .matchAll(/^\s{2}(\w+)\s*\(/gm)].map((m) => m[1]!);
}

describe('FirestoreBackend implements the whole Backend interface', () => {
  const methods = backendMethods();

  it('found the interface, so the rest of this file means something', () => {
    expect(methods.length).toBeGreaterThan(10);
    expect(methods).toContain('createRoom');
    expect(methods).toContain('recordRound');
  });

  it('implements every method, and so does the memory one', () => {
    for (const m of methods) {
      expect(firestore, `FirestoreBackend is missing ${m}`)
        .toMatch(new RegExp(`\\b(async )?${m}\\s*[(<]`));
      expect(memory, `MemoryBackend is missing ${m}`)
        .toMatch(new RegExp(`\\b(async )?${m}\\s*[(<]`));
    }
  });

  it('never writes a seat number onto a player document', () => {
    // Seating is the room's ordered uid list. A seatIndex on a document its
    // own player can write is a seat that player can choose, and no rule can
    // tell that write from an honest one. Reading a seat back out to render it
    // is fine and happens in watchPlayers; this is about what gets WRITTEN.
    const start = firestore.indexOf('private async writePlayer(');
    expect(start).toBeGreaterThan(-1);
    const body = firestore.slice(start, firestore.indexOf('\n  }', start));
    expect(body).not.toMatch(/seatIndex/);
    expect(schema).not.toMatch(/^\s+seatIndex/m);
  });

  it('never writes points, wins or a seed', () => {
    const code = firestore.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/\bseeded\b/);
    expect(code).not.toMatch(/\bpoints\s*:/);
  });

  it('deals every seat and the phase turn in one batch', () => {
    // A table that observes seats without cards behind them, or a phase that
    // has turned over before the private documents exist, is a round that
    // looks broken to everybody at it.
    const start = firestore.indexOf('async startGame(');
    const body = firestore.slice(start, firestore.indexOf('\n  }', start));
    expect(body).toMatch(/writeBatch\(this\.db\)/);
    expect(body).toMatch(/batch\.commit\(\)/);
    expect(body).not.toMatch(/await (setDoc|updateDoc)\(/);
  });

  it('refuses to start a round the table is too small for', () => {
    // Three centre cards means the deal needs seatCount + 3, so this is a real
    // constraint. Failing here beats failing inside the dealer.
    expect(firestore).toMatch(/canStartRound\(seating\.length\)/);
  });
});

describe('the night state survives a trip through Firestore', () => {
  // NightState uses Sets. Firestore cannot store a Set — it arrives back as an
  // empty object, and an empty shield set is a Bodyguard who silently stopped
  // working. None of that throws, which is exactly why it is tested.
  const roles: RoleId[] = [
    'weerwolf', 'weerwolf', 'ziener', 'dorpeling', 'dorpeling', 'onderzoeker',
    'bodyguard', 'dorpsgek',
  ];

  function freshState() {
    const cards = cardsForRoles(roles, 5);
    return deal({ cards, seatCount: 5, seed: 42 }).state;
  }

  it('round-trips unchanged', () => {
    const before = freshState();
    const after = engineStateFromDoc(engineStateToDoc(before));
    expect(after).toEqual(before);
  });

  it('keeps the shielded slots as a working Set', () => {
    const state = freshState();
    state.shieldedSlots.add(2);
    state.shieldedSlots.add(4);
    const after = engineStateFromDoc(engineStateToDoc(state));
    expect(after.shieldedSlots).toBeInstanceOf(Set);
    expect(after.shieldedSlots.has(2)).toBe(true);
    expect(after.shieldedSlots.has(4)).toBe(true);
    expect(after.shieldedSlots.size).toBe(2);
  });

  it('keeps revealed cards as a working Set', () => {
    const state = freshState();
    const card = state.slots[0]!;
    state.revealedCards.add(card);
    const after = engineStateFromDoc(engineStateToDoc(state));
    expect(after.revealedCards).toBeInstanceOf(Set);
    expect(after.revealedCards.has(card)).toBe(true);
  });

  it('keeps assumedRole, which would otherwise vanish without throwing', () => {
    // The Onderzoeker who saw a Weerwolf card IS a Weerwolf at dawn, without
    // their card having changed. Lose this and the night still resolves —
    // one player is just quietly on the wrong team.
    const state = freshState();
    state.assumedRole[3] = 'weerwolf';
    const after = engineStateFromDoc(engineStateToDoc(state));
    expect(after.assumedRole[3]).toBe('weerwolf');
  });

  it('survives a document missing the optional collections', () => {
    // An older document, or one written before a field existed. Better an
    // empty Set than a crash at the table.
    const state = engineStateFromDoc({
      seatCount: 3, centerCount: 3, slots: ['c0'], cardRole: {},
      originalRole: [], alphaWolfSlot: null,
    } as never);
    expect(state.shieldedSlots.size).toBe(0);
    expect(state.revealedCards.size).toBe(0);
    expect(state.assumedRole).toEqual({});
  });
});
