import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, TWO_ROUND_CONFIG,
  centerSlot, computeRoundSchedule, createNightState, defaultNightOrder,
  resolveDay, resolveNight, roleAt, voteAccuracy, voteOutcomes, finalRoleOf,
  roleDef,
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

  it('is FORCED to take the Looier, and it is never flipped face up', () => {
    // Milan, 2026-08-26: she has no say. She turns over the Looier and it is
    // hers, and the player she looked at is the Medium and is never told.
    const state = deal(['medium', 'looier'], ['jager', 'jager', 'jager']);
    const res = run(state, ['medium'], answers({ '0:medium-target': seat(1) }));

    expect(roleAt(res.state, 0)).toBe('looier');
    expect(roleAt(res.state, 1)).toBe('medium');

    // NOT flipped face up — this is the load-bearing half of the rule. A
    // publicly known Looier is one nobody will ever lynch, so revealing it
    // would turn the forced swap from a risk into a guaranteed loss.
    expect(res.state.revealedCards.size).toBe(0);
    expect(res.events.some((e) => e.kind === 'card-publicly-revealed')).toBe(false);
  });

  it('still flips anything that is neither a wolf nor the Looier', () => {
    const state = deal(['medium', 'ziener'], ['jager', 'jager', 'jager']);
    const res = run(state, ['medium'], answers({ '0:medium-target': seat(1) }));

    expect(roleAt(res.state, 0)).toBe('medium');
    expect(res.state.revealedCards.has(res.state.slots[1]!)).toBe(true);
  });

  it('has no follow-up decision left to make', () => {
    // The Looier swap was her only reveal-dependent choice. With it forced,
    // she needs no second round in either mode — which is why she is out of
    // precommitRoles and the Heks is the only role that pre-commits.
    expect(roleDef('medium').revealThenDecide).toBe(false);
    expect(TWO_ROUND_CONFIG.precommitRoles).toEqual(['heks']);
  });
});

describe('round schedule (§5.1)', () => {
  it('the default preset resolves in exactly 2 rounds', () => {
    const s = computeRoundSchedule(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);
    expect(s.rounds).toBe(2);
    expect(s.roundRoles[1]).toEqual(['dubbelganger']);
  });

  it('dropping the Heks pre-commit is what would make it 3 — the whole reason she pre-commits', () => {
    const noPrecommit: GameConfig = { ...TWO_ROUND_CONFIG, precommitRoles: [] };
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

  it('cancels every vote against whoever the Bodyguard shields', () => {
    // RULED 2026-08-26: he does not vote, he protects. Seats 2 and 3 both name
    // the wolf at seat 1, and the Bodyguard at seat 0 shields him.
    const state = deal(
      ['bodyguard', 'weerwolf', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const res = resolveDay(state, votes([0, 1], [2, 1], [3, 1]));

    expect(res.protectedSeats).toEqual([1]);
    expect(res.tally[1]).toBe(0);
    expect(res.eliminated).toEqual([]);
    // His own ballot is not a vote at all, and the other two were cancelled.
    expect(res.discarded).toContainEqual({ voter: 0, reason: 'bodyguard-protects' });
    expect(res.discarded.filter((d) => d.reason === 'protected')).toHaveLength(2);
  });

  it('does not save the Bodyguard himself — he cannot shield his own seat', () => {
    // He just dies now; the old "top target voids the vote" rule is gone.
    const state = deal(
      ['bodyguard', 'weerwolf', 'dorpeling'],
      ['jager', 'jager', 'jager'],
    );
    const res = resolveDay(state, votes([0, 1], [1, 0], [2, 0]));
    expect(res.eliminated).toEqual([0]);
    expect(res.outcome).toBe('eliminated');
  });

  it('shields on the FINAL card, so a swapped Bodyguard protects nobody', () => {
    // §6.0. Seat 0 was dealt the Bodyguard but ends holding a Dorpeling card;
    // seat 2 ends holding the Bodyguard card and shields without knowing it.
    const state = deal(
      ['dorpeling', 'weerwolf', 'bodyguard', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const res = resolveDay(state, votes([0, 1], [2, 1], [3, 1]));
    // Seat 2's ballot is the shield; seat 0's and seat 3's are real votes.
    expect(res.protectedSeats).toEqual([1]);
    expect(res.eliminated).toEqual([]);
  });

  it('hangs EVERYONE tied on the top count', () => {
    // Milan, 2026-08-26: a tie is a double execution, not a reprieve.
    const state = deal(['weerwolf', 'dorpeling', 'ziener'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, votes([1, 0], [0, 1]));
    expect(res.outcome).toBe('tie');
    expect(res.eliminated.sort()).toEqual([0, 1]);
    // A wolf AND an innocent hanged -> the wolves take it.
    expect(res.teamsWon.wolf).toBe(true);
    expect(res.teamsWon.village).toBe(false);
  });

  it('still reports a tie with nobody dead when no vote counted at all', () => {
    const state = deal(['weerwolf', 'dorpeling'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, [
      { voter: 0, target: null, abstain: false },
      { voter: 1, target: null, abstain: false },
    ]);
    expect(res.outcome).toBe('tie');
    expect(res.eliminated).toEqual([]);
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

describe('win conditions (§8, ruled 2026-08-25)', () => {
  const votes = (...v: [number, number | null][]) =>
    v.map(([voter, target]) => ({ voter, target, abstain: false }));

  it('a Looier win means everyone else loses — even a wolf who also died', () => {
    // Jager is lynched alongside the Looier and shoots a wolf: a wolf died, so
    // ordinarily the village would win. The Looier overrides that.
    const state = deal(['looier', 'jager', 'weerwolf'], ['jager', 'jager', 'jager']);
    const res = resolveDay(state, [
      { voter: 1, target: 0, abstain: false },
      { voter: 2, target: 0, abstain: false },
    ]);
    expect(res.eliminated).toEqual([0]);
    expect(res.teamsWon).toEqual({ village: false, wolf: false, solo: true });
  });

  it('with every wolf in the centre, the village wins only by lynching nobody', () => {
    const state = deal(
      ['dorpeling', 'ziener', 'jager'],
      ['weerwolf', 'weerwolf', 'alphawolf'],
    );
    // Both tied players now hang, so this is no longer a bloodless tie: two
    // innocents died in a game with no wolves and nobody wins.
    const tied = resolveDay(state, votes([0, 1], [1, 0]));
    expect(tied.outcome).toBe('tie');
    expect(tied.eliminated.sort()).toEqual([0, 1]);
    expect(tied.teamsWon).toEqual({ village: false, wolf: false, solo: false });

    // Lynching nobody is the only way the village wins such a game.
    const abstained = resolveDay(state, [
      { voter: 0, target: null, abstain: true },
      { voter: 1, target: null, abstain: true },
      { voter: 2, target: null, abstain: true },
    ]);
    expect(abstained.teamsWon.village).toBe(true);
  });

  it('lynching an innocent with no wolves in play means nobody wins', () => {
    const state = deal(
      ['dorpeling', 'ziener', 'jager'],
      ['weerwolf', 'weerwolf', 'alphawolf'],
    );
    const res = resolveDay(state, votes([0, 1], [2, 1]));
    expect(res.eliminated).toContain(1);
    expect(res.teamsWon).toEqual({ village: false, wolf: false, solo: false });
  });

  it('wolves can never win a game where no player holds a wolf card', () => {
    const state = deal(['dorpeling', 'ziener'], ['weerwolf', 'jager', 'jager']);
    expect(resolveDay(state, votes([0, 1], [1, 0])).teamsWon.wolf).toBe(false);
  });

  it('village wins only if it hanged wolves and nobody else', () => {
    // The one sentence the 2026-08-26 revision collapses to. Four seats, two
    // wolves, so every combination below is reachable in one game.
    const state = deal(
      ['weerwolf', 'alphawolf', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );

    // two wolves tied -> village
    const twoWolves = resolveDay(state, votes([2, 0], [3, 1], [0, 1], [1, 0]));
    expect(twoWolves.eliminated.sort()).toEqual([0, 1]);
    expect(twoWolves.teamsWon.village).toBe(true);

    // wolf + innocent tied -> wolves
    const mixed = resolveDay(state, votes([2, 0], [3, 2], [0, 2], [1, 0]));
    expect(mixed.eliminated.sort()).toEqual([0, 2]);
    expect(mixed.teamsWon.village).toBe(false);
    expect(mixed.teamsWon.wolf).toBe(true);

    // two innocents tied -> wolves
    const twoInnocents = resolveDay(state, votes([0, 2], [1, 3], [2, 3], [3, 2]));
    expect(twoInnocents.eliminated.sort()).toEqual([2, 3]);
    expect(twoInnocents.teamsWon.wolf).toBe(true);
  });

  it('lets the Looier win by being one of the tied', () => {
    // Milan, 2026-08-26: being tied is enough, and it beats everything — even
    // a wolf hanging in the same vote.
    const state = deal(
      ['looier', 'weerwolf', 'dorpeling', 'ziener', 'jager'],
      ['dorpeling', 'dorpeling', 'dorpeling'],
    );
    // The Looier's own ballot never counts, so the tie is made by the other
    // four: two for the Looier at seat 0, two for the wolf at seat 1.
    const res = resolveDay(state, votes([2, 1], [3, 1], [1, 0], [4, 0], [0, 3]));
    expect(res.eliminated.sort()).toEqual([0, 1]);
    expect(res.teamsWon).toEqual({ village: false, wolf: false, solo: true });
  });
});

describe('Bodyguard scoring — by consequence, now that he shields (§10)', () => {
  it("scores 'caused-village-loss' when he shields the wolf who was about to hang", () => {
    // The sharpest version of the case Milan asked to track separately: two
    // villagers had the wolf dead to rights and the Bodyguard called it off.
    const state = deal(
      ['bodyguard', 'weerwolf', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const cast = [
      { voter: 0, target: 1, abstain: false },   // shields the wolf
      { voter: 2, target: 1, abstain: false },
      { voter: 3, target: 1, abstain: false },
    ];
    const res = resolveDay(state, cast);

    expect(res.eliminated).toEqual([]);
    expect(res.teamsWon.village).toBe(false);
    // The distinction a boolean cannot carry, and these documents are
    // append-only — collapse it once and it is gone for good.
    expect(voteOutcomes(state, cast, res)[0]).toBe('caused-village-loss');
    expect(voteAccuracy(state, cast, res)[0]).toBe(false);
  });

  it("scores 'correct' when the shield held and the village still won", () => {
    // He saves an innocent from a wrongful lynch; the wolf hangs anyway.
    const state = deal(
      ['bodyguard', 'weerwolf', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const cast = [
      { voter: 0, target: 3, abstain: false },   // shields the Ziener
      { voter: 1, target: 3, abstain: false },   // the wolf tries for her
      { voter: 2, target: 1, abstain: false },
      { voter: 3, target: 1, abstain: false },
    ];
    const res = resolveDay(state, cast);

    expect(res.eliminated).toEqual([1]);
    expect(res.teamsWon.village).toBe(true);
    expect(voteOutcomes(state, cast, res)[0]).toBe('correct');
  });

  it("scores 'inconsequential' when nobody was voting for the person he shielded", () => {
    const state = deal(
      ['bodyguard', 'weerwolf', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const cast = [
      { voter: 0, target: 2, abstain: false },   // shields someone nobody named
      { voter: 1, target: 3, abstain: false },
      { voter: 2, target: 1, abstain: false },
      { voter: 3, target: 1, abstain: false },
    ];
    const res = resolveDay(state, cast);

    expect(res.eliminated).toEqual([1]);
    expect(voteOutcomes(state, cast, res)[0]).toBe('inconsequential');
    expect(voteAccuracy(state, cast, res)[0]).toBeNull();
  });
});

describe('vote scoring for everyone else', () => {
  it('a normal villager still scores by target, not consequence', () => {
    const state = deal(['ziener', 'weerwolf', 'dorpeling'], ['jager', 'jager', 'jager']);
    const cast = [
      { voter: 0, target: 2, abstain: false },
      { voter: 2, target: 1, abstain: false },
    ];
    const res = resolveDay(state, cast);
    // Pointed at a villager -> plain 'incorrect', never 'caused-village-loss'.
    expect(voteOutcomes(state, cast, res)[0]).toBe('incorrect');
  });
});

describe('Onderzoeker (§6.0 assumed roles)', () => {
  it('stops on a wolf and becomes one, while the target keeps it too', () => {
    const state = deal(
      ['onderzoeker', 'weerwolf', 'dorpeling'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['onderzoeker'], answers({
      '0:pi-first': seat(1),
      '0:pi-second': seat(2),   // should never be asked
    }));

    expect(res.privateInfo[0]!).toContainEqual(
      expect.objectContaining({ kind: 'became-role', role: 'weerwolf' }),
    );
    // Must stop looking — the second decision is never reached.
    expect(res.decisions.some((d) => d.key === 'pi-second')).toBe(false);

    // Their CARD is untouched; they simply count as a wolf now. Both are wolves.
    expect(roleAt(res.state, 0)).toBe('onderzoeker');
    expect(finalRoleOf(res.state, 0)).toBe('weerwolf');
    expect(finalRoleOf(res.state, 1)).toBe('weerwolf');
  });

  it('becoming the Looier means they win only by being lynched', () => {
    const state = deal(
      ['onderzoeker', 'looier', 'weerwolf'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['onderzoeker'], answers({ '0:pi-first': seat(1) }));
    expect(finalRoleOf(res.state, 0)).toBe('looier');

    // Lynching the assumed-Looier triggers the full Looier ruling: they win
    // alone and everybody else loses.
    const day = resolveDay(res.state, [
      { voter: 1, target: 0, abstain: false },
      { voter: 2, target: 0, abstain: false },
    ]);
    expect(day.teamsWon).toEqual({ village: false, wolf: false, solo: true });
  });

  it('may look at a second card when the first is harmless', () => {
    const state = deal(
      ['onderzoeker', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['onderzoeker'], answers({
      '0:pi-first': seat(1),
      '0:pi-second': seat(2),
    }));
    const cards = res.privateInfo[0]!.filter((i) => i.kind === 'saw-card');
    expect(cards).toHaveLength(2);
    expect(res.state.assumedRole[0]).toBeUndefined();
  });

  it('its second look is reveal-dependent, so it earns its own window', () => {
    const state = deal(
      ['onderzoeker', 'dorpeling', 'ziener'],
      ['jager', 'jager', 'jager'],
    );
    const res = run(state, ['onderzoeker'], answers({
      '0:pi-first': seat(1), '0:pi-second': seat(2),
    }));
    expect(res.decisions.find((d) => d.key === 'pi-second')!.dependsOnReveal).toBe(true);
  });

  it('adds a third window to the default set when active', () => {
    const withPI = [...DEFAULT_ACTIVE_ROLES, 'onderzoeker'] as RoleId[];
    expect(computeRoundSchedule(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG).rounds).toBe(2);
    expect(computeRoundSchedule(withPI, TWO_ROUND_CONFIG).rounds).toBe(3);
  });
});
