import { describe, expect, it } from 'vitest';
import { createNightState } from './state.js';
import { scoreSuspicions, type Suspicion } from './suspicion.js';
import type { RoleId } from './types.js';

function table(seatRoles: RoleId[]) {
  return createNightState({
    seatCount: seatRoles.length,
    seatRoles,
    centerRoles: ['jager', 'jager', 'jager'],
  });
}

describe('suspicion scoring (§9)', () => {
  const state = table(['weerwolf', 'ziener', 'dorpeling', 'heks']);

  it('scores null for a player who never used the tracker', () => {
    const scores = scoreSuspicions(state, []);
    expect(scores[0]!.accuracy).toBeNull();
    expect(scores[0]!.tagged).toBe(0);
  });

  it('scores accuracy over the tags a player actually made', () => {
    const s: Suspicion[] = [
      { by: 1, about: 0, role: 'weerwolf' },   // right
      { by: 1, about: 2, role: 'heks' },       // wrong
    ];
    expect(scoreSuspicions(state, s)[1]!.accuracy).toBe(0.5);
  });

  it('counts only the latest tag per player, so changing your mind is free', () => {
    // Revising as the night unfolds is the point of a memory aid. Scoring every
    // revision would punish exactly the players using it properly.
    const s: Suspicion[] = [
      { by: 1, about: 0, role: 'dorpeling' },  // early guess, wrong
      { by: 1, about: 0, role: 'weerwolf' },   // worked it out
    ];
    const score = scoreSuspicions(state, s)[1]!;
    expect(score.tagged).toBe(1);
    expect(score.accuracy).toBe(1);
  });

  it('ignores tagging yourself', () => {
    expect(scoreSuspicions(state, [{ by: 1, about: 1, role: 'ziener' }])[1]!.tagged).toBe(0);
  });

  it('checks against the FINAL card by default, per §6.0', () => {
    const swapped = table(['weerwolf', 'ziener']);
    // Physically swap seats 0 and 1 as a Dorpsgek or Heks would have.
    const a = swapped.slots[0]!;
    swapped.slots[0] = swapped.slots[1]!;
    swapped.slots[1] = a;

    const s: Suspicion[] = [{ by: 1, about: 0, role: 'ziener' }];
    expect(scoreSuspicions(swapped, s, 'final')[1]!.accuracy).toBe(1);
    // The counter-argument the option exists for: they were dealt the Weerwolf.
    expect(scoreSuspicions(swapped, s, 'original')[1]!.accuracy).toBe(0);
  });
});
