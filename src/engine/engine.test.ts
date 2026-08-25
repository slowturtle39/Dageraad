import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, TWO_ROUND_CONFIG,
  centerSlot, computeRoundSchedule, createNightState, defaultNightOrder,
  resolveDay, resolveNight, roleAt,
} from './index.js';
import type { AnswerProvider } from './resolve.js';
import type { Choice, GameConfig, RoleId } from './types.js';

/** Answers keyed by "<seat>:<decision key>"; anything unlisted declines. */
function answers(map: Record<string, Choice>): AnswerProvider {
  return (req) => map[`${req.seat}:${req.key}`] ?? { kind: 'none' };
}

const seat = (s: number): Choice => ({ kind: 'seat', seat: s });
const center = (...i: number[]): Choice => ({ kind: 'center', centerIndices: i });

function deal(seatRoles: RoleId[], centerRoles: RoleId[], alphaWolfCardRole?: RoleId) {
  return createNightState({
    seatCount: seatRoles.length,
    seatRoles,
    centerRoles,
    ...(alphaWolfCardRole ? { alphaWolfCardRole } : {}),
  });
}

function run(
  state: ReturnType<typeof deal>,
  active: RoleId[],
  a: AnswerProvider,
  config: GameConfig = TWO_ROUND_CONFIG,
) {
  return resolveNight(state, defaultNightOrder(active), config, a);
}

describe('§6.0 — original role acts, final card wins', () => {
  it('a player still acts as their DEALT role after their card is swapped away', () => {
    const state = deal(
      ['alphawolf', 'mystiekewolf', 'dorpeling'],
      ['dorpeling', 'dorpeling', 'dorpeling'],
      'weerwolf',
    );
    const res = run(state, ['alphawolf', 'mystiekewolf'], answers({
      '0:alpha-target': seat(1),   // Alpha Wolf makes seat 1 a wolf
      '1:mystic-view': seat(2),
    }));

    // Seat 1 is now holding a Weerwolf card...
    expect(roleAt(res.state, 1)).toBe('weerwolf');
    // ...but still took the Mystieke Wolf's turn, because that is what it was dealt.
    const acted = res.decisions.filter((d) => d.seat === 1);
    expect(acted.map((d) => d.actingAs)).toEqual(['mystiekewolf']);
  });
});

describe('three centre cards + one separate wolf card', () => {
  it('the wolf card is not one of the three, before or after the Alpha Wolf acts', () => {
    const state = deal(
      ['alphawolf', 'heks', 'dorpeling'],
      ['ziener', 'jager', 'bodyguard'],
      'weerwolf',
    );
    expect(state.centerCount).toBe(3);
    expect(state.alphaWolfSlot).toBe(6);
    expect(() => centerSlot(state, 3)).toThrow();

    const res = run(state, ['alphawolf', 'heks'], answers({
      '0:alpha-target': seat(2),      // seat 2's dorpeling goes to the 4th slot
      '1:heks-center': center(0),
      '1:heks-target': seat(2),
    }));

    // The displaced card sits in the 4th slot and never becomes selectable.
    expect(roleAt(res.state, res.state.alphaWolfSlot!)).toBe('dorpeling');
    expect(res.state.centerCount).toBe(3);

    // The Heks saw one of the original three, not the displaced card.
    const seen = res.privateInfo[1]!.find((i) => i.kind === 'saw-center');
    expect(seen).toMatchObject({ kind: 'saw-center', role: 'ziener' });
  });
});

describe('Heks', () => {
  it('gets a real receipt for the card she looked at, having pre-committed blind', () => {
    const state = deal(['heks', 'dorpeling'], ['looier', 'jager', 'bodyguard']);
    const res = run(state, ['heks'], answers({
      '0:heks-center': center(0),
      '0:heks-target': seat(1),
    }));

    expect(res.privateInfo[0]!).toContainEqual(
      expect.objectContaining({ kind: 'saw-center', role: 'looier' }),
    );
    // She really did arm seat 1 with the Looier — the third-team case.
    expect(roleAt(res.state, 1)).toBe('looier');
  });

  it('her target decision is flagged reveal-dependent, which is why she pre-commits', () => {
    const state = deal(['heks', 'dorpeling'], ['jager', 'jager', 'jager']);
    const res = run(state, ['heks'], answers({
      '0:heks-center': center(0),
      '0:heks-target': seat(1),
    }));
    const target = res.decisions.find((d) => d.key === 'heks-target')!;
    expect(target.dependsOnReveal).toBe(true);
    expect(target.seen).toMatchObject({ kind: 'saw-center' });
  });
});

describe('Alpha Wolf stays blind', () => {
  it('never learns the card she displaced', () => {
    const state = deal(['alphawolf', 'ziener'], ['jager', 'jager', 'jager'], 'weerwolf');
    const res = run(state, ['alphawolf'], answers({ '0:alpha-target': seat(1) }));

    const info = res.privateInfo[0]!;
    expect(info.some((i) => i.kind === 'saw-card' || i.kind === 'saw-center')).toBe(false);
    expect(info).toContainEqual(
      expect.objectContaining({ kind: 'action-confirmed' }),
    );
  });
});

describe('Schildwacht shield vs Dorpsgek shift', () => {
  it('the shielded card stays put and the rest rotate around it', () => {
    const state = deal(
      ['schildwacht', 'dorpsgek', 'dorpeling', 'looier', 'jager'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['schildwacht', 'dorpsgek'], answers({
      '0:shield': seat(4),                                    // seat 4 shielded
      '1:dorpsgek': { kind: 'dorpsgek', direction: 'right' },
    }));

    // Exempt: seat 1 (acting Dorpsgek) and seat 4 (shielded).
    // Participating ring [0,2,3] rotates right.
    expect(roleAt(res.state, 4)).toBe('jager');        // shielded, unmoved
    expect(roleAt(res.state, 1)).toBe('dorpsgek');     // actor, unmoved
    expect(roleAt(res.state, 0)).toBe('looier');
    expect(roleAt(res.state, 2)).toBe('schildwacht');
    expect(roleAt(res.state, 3)).toBe('dorpeling');
  });
});

describe('Dubbelganger copying the Dorpsgek', () => {
  it("exempts the Dubbelganger's own card, and the real Dorpsgek's card moves", () => {
    const state = deal(
      ['dubbelganger', 'dorpsgek', 'dorpeling', 'looier'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['dubbelganger', 'dorpsgek'], answers({
      '0:doppel-view': seat(1),                                // copies Dorpsgek
      '0:dorpsgek': { kind: 'dorpsgek', direction: 'right' },
      '1:dorpsgek': { kind: 'dorpsgek', direction: 'right' },
    }));

    // First rotation (Dubbelganger acting): exempt {0}; ring [1,2,3] rotates.
    // Second rotation (real Dorpsgek):      exempt {1}; ring [0,2,3] rotates.
    expect(roleAt(res.state, 0)).toBe('dorpeling');
    expect(roleAt(res.state, 1)).toBe('looier');
    expect(roleAt(res.state, 2)).toBe('dubbelganger');
    expect(roleAt(res.state, 3)).toBe('dorpsgek');
  });

  it("its copied action's decisions are reveal-dependent — this is what earns round 2", () => {
    const state = deal(
      ['dubbelganger', 'mystiekewolf', 'dorpeling'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['dubbelganger', 'mystiekewolf'], answers({
      '0:doppel-view': seat(1),
      '0:mystic-view': seat(2),
      '1:mystic-view': seat(2),
    }));

    const view = res.decisions.find((d) => d.seat === 0 && d.key === 'doppel-view')!;
    const copied = res.decisions.find((d) => d.seat === 0 && d.key === 'mystic-view')!;
    expect(view.dependsOnReveal).toBe(false);   // round 1
    expect(copied.dependsOnReveal).toBe(true);  // round 2
    expect(copied.actingAs).toBe('mystiekewolf');
  });
});

describe('Medium', () => {
  it('does not flip a wolf face-up, but does flip anything else', () => {
    const wolf = deal(['medium', 'weerwolf'], ['jager', 'jager', 'jager']);
    const r1 = run(wolf, ['medium'], answers({ '0:medium-target': seat(1) }));
    expect(r1.events.filter((e) => e.kind === 'card-publicly-revealed')).toHaveLength(0);

    const villager = deal(['medium', 'ziener'], ['jager', 'jager', 'jager']);
    const r2 = run(villager, ['medium'], answers({ '0:medium-target': seat(1) }));
    expect(r2.events).toContainEqual(
      expect.objectContaining({ kind: 'card-publicly-revealed', role: 'ziener' }),
    );
  });

  it('may swap with the Looier, and the public reveal follows the card', () => {
    const state = deal(['medium', 'looier'], ['jager', 'jager', 'jager']);
    const res = run(state, ['medium'], answers({
      '0:medium-target': seat(1),
      '0:medium-looier-swap': { kind: 'bool', value: true },
    }));

    expect(roleAt(res.state, 0)).toBe('looier');
    expect(roleAt(res.state, 1)).toBe('medium');
    // The face-up card is tracked by card identity, so it travelled to seat 0.
    const looierCard = res.state.slots[0]!;
    expect(res.state.revealedCards.has(looierCard)).toBe(true);
  });
});

describe('round schedule (§5.1)', () => {
  it('the default preset resolves in exactly 2 rounds', () => {
    const s = computeRoundSchedule(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);
    expect(s.rounds).toBe(2);
    expect(s.roundRoles[1]).toEqual(['dubbelganger']);
  });

  it('dropping the Heks pre-commit is what would make it 3 — the whole reason she pre-commits', () => {
    const noPrecommit: GameConfig = { ...TWO_ROUND_CONFIG, precommitRoles: ['medium'] };
    expect(computeRoundSchedule(DEFAULT_ACTIVE_ROLES, noPrecommit).rounds).toBe(3);
  });

  it('is computed from the public role set alone — never from the deal', () => {
    // Same active roles, wildly different hidden assignments (including the
    // Alpha Wolf sitting in the centre) must give an identical schedule.
    const a = computeRoundSchedule(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);
    const b = computeRoundSchedule([...DEFAULT_ACTIVE_ROLES].reverse(), TWO_ROUND_CONFIG);
    expect(b).toEqual(a);
  });

  it('dependency mode needs no pre-commit at all', () => {
    expect(DEPENDENCY_CONFIG.precommitRoles).toEqual([]);
  });
});

describe('day phase (§7, §8)', () => {
  const votes = (...v: [number, number | null][]) =>
    v.map(([voter, target]) => ({ voter, target, abstain: false }));

  it("discards the Looier's own vote", () => {
    const state = deal(['looier', 'weerwolf', 'dorpeling'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, votes([0, 1], [1, 2], [2, 1]));
    expect(res.discarded).toContainEqual({ voter: 0, reason: 'looier' });
    expect(res.tally[1]).toBe(1);
  });

  it('voids the vote when the Bodyguard is the top target', () => {
    const state = deal(['bodyguard', 'weerwolf', 'dorpeling'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, votes([1, 0], [2, 0]));
    expect(res.outcome).toBe('bodyguard-void');
    expect(res.eliminated).toEqual([]);
  });

  it('treats a tie as a failed vote, and the wolves win', () => {
    const state = deal(['weerwolf', 'dorpeling', 'ziener'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, votes([1, 0], [0, 1]));
    expect(res.outcome).toBe('tie');
    expect(res.teamsWon.wolf).toBe(true);
    expect(res.teamsWon.village).toBe(false);
  });

  it('a majority abstain overrides the tally, and the Looier loses', () => {
    const state = deal(['looier', 'weerwolf', 'dorpeling'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, [
      { voter: 0, target: 1, abstain: true },
      { voter: 1, target: 2, abstain: true },
      { voter: 2, target: 1, abstain: false },
    ]);
    expect(res.outcome).toBe('no-vote');
    expect(res.teamsWon.wolf).toBe(true);
    expect(res.teamsWon.solo).toBe(false);
  });

  it('judges the win on the FINAL card, not the dealt one', () => {
    // Seat 1 was dealt a Dorpeling but ends the night holding the Looier card.
    const state = deal(['weerwolf', 'looier', 'dorpeling'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, votes([0, 1], [2, 1]));
    expect(res.eliminated).toEqual([1]);
    expect(res.teamsWon.solo).toBe(true);
    expect(res.seatWon[1]).toBe(true);
  });
});
