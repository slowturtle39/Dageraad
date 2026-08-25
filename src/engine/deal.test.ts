import { describe, expect, it } from 'vitest';
import { cardsForRoles, deal, DealError, seededShuffle, validateCards } from './deal.js';
import { DEFAULT_ACTIVE_ROLES } from './presets.js';
import { roleAt } from './state.js';
import type { RoleId } from './types.js';

describe('the deal', () => {
  it('always leaves exactly three cards in the centre', () => {
    // The whole game rests on this: you can never be sure a role is in play
    // just because it is on the table.
    const cards = cardsForRoles(DEFAULT_ACTIVE_ROLES, 5);
    const g = deal({ cards, seatCount: 5, seed: 42 });
    expect(g.seatRoles).toHaveLength(5);
    expect(g.centerRoles).toHaveLength(3);
    expect(g.state.centerCount).toBe(3);
  });

  it('refuses a card count that does not match the table', () => {
    expect(() => deal({ cards: ['weerwolf', 'dorpeling'], seatCount: 5, seed: 1 }))
      .toThrow(DealError);
  });

  it('says what is wrong before anything is dealt', () => {
    // The host is picking roles in the lobby with everyone watching; "you need
    // one more card" is useful then, an exception afterwards is not.
    const problems = validateCards(['weerwolf'], 5);
    expect(problems[0]).toMatch(/8 kaarten nodig/);
  });

  it('adds the Alpha Wolf card only when she is in the game', () => {
    const withHer = deal({
      cards: cardsForRoles(['alphawolf', 'ziener'], 4), seatCount: 4, seed: 7,
    });
    expect(withHer.state.alphaWolfSlot).not.toBeNull();

    const withoutHer = deal({
      cards: cardsForRoles(['ziener', 'heks'], 4), seatCount: 4, seed: 7,
    });
    // Otherwise it sits there unreachable and quietly inflates the centre.
    expect(withoutHer.state.alphaWolfSlot).toBeNull();
  });

  it('is reproducible from its seed, so a disputed night can be replayed', () => {
    const cards = cardsForRoles(DEFAULT_ACTIVE_ROLES, 5);
    const a = deal({ cards, seatCount: 5, seed: 12345 });
    const b = deal({ cards, seatCount: 5, seed: 12345 });
    expect(b.seatRoles).toEqual(a.seatRoles);
    expect(b.centerRoles).toEqual(a.centerRoles);
  });

  it('actually shuffles', () => {
    const cards = cardsForRoles(DEFAULT_ACTIVE_ROLES, 5);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      seen.add(deal({ cards, seatCount: 5, seed }).seatRoles.join(','));
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('loses no cards and invents none', () => {
    const cards = cardsForRoles(DEFAULT_ACTIVE_ROLES, 6);
    const g = deal({ cards, seatCount: 6, seed: 99 });
    expect([...g.seatRoles, ...g.centerRoles].sort()).toEqual([...cards].sort());
  });

  it('deals every card to a real slot', () => {
    const g = deal({ cards: cardsForRoles(DEFAULT_ACTIVE_ROLES, 5), seatCount: 5, seed: 3 });
    for (let seat = 0; seat < 5; seat++) {
      expect(roleAt(g.state, seat)).toBe(g.seatRoles[seat]);
    }
  });

  it('warns about a lone Vrijmetselaar without blocking it', () => {
    const problems = validateCards(
      ['vrijmetselaar', 'weerwolf', 'ziener', 'dorpeling'] as RoleId[], 1,
    );
    expect(problems.some((p) => p.startsWith('Let op'))).toBe(true);
    // Legal, just usually a mistake — so it must still deal.
    expect(() => deal({
      cards: ['vrijmetselaar', 'weerwolf', 'ziener', 'dorpeling'] as RoleId[],
      seatCount: 1, seed: 1,
    })).not.toThrow();
  });
});

describe('seededShuffle', () => {
  it('is a permutation', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(src, 5).sort((a, b) => a - b)).toEqual(src);
  });

  it('does not mutate its input', () => {
    const src = [1, 2, 3];
    seededShuffle(src, 1);
    expect(src).toEqual([1, 2, 3]);
  });
});
