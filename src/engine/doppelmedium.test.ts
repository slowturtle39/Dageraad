import { describe, expect, it } from 'vitest';
import { buildTimeline } from './timeline.js';
import { publicView } from './publicview.js';
import { probe } from '../orchestration/replay.js';
import { defaultNightOrder } from './roles.js';
import { createNightState } from './state.js';
import { DEPENDENCY_CONFIG, TWO_ROUND_CONFIG } from './presets.js';
import type {
  Choice, DecisionRequest, GameConfig, NightState, RoleId, SeatIndex,
} from './types.js';

/**
 * The Dubbelganger copying the Medium.
 *
 * She is a SECOND Medium that night, not a replacement: she looks in her own
 * scheduled place in the order, the real Medium still looks later, and if
 * either turns over an eligible card the table sees it face up before anyone
 * who acts afterwards chooses anything.
 *
 * The reason this needs its own tests rather than riding on the Medium's is
 * the ORDER. Copying happens early; every role that moves cards comes after.
 * So this is where "the reveal follows the card" stops being a nicety.
 */

// Dubbelganger acts at 50, Heks at 60, Dorpsgek at 80, Medium at 90 — so the
// copied Medium's flip lands before the Heks chooses, and before the shuffle.
const ROLES: RoleId[] = [
  'dubbelganger', 'heks', 'dorpsgek', 'medium', 'ziener', 'weerwolf',
];

interface Table {
  state: NightState;
  config: GameConfig;
}

function table(seatRoles: RoleId[], config: GameConfig = DEPENDENCY_CONFIG): Table {
  return {
    state: createNightState({
      seatCount: seatRoles.length,
      seatRoles,
      centerRoles: ['dorpeling', 'dorpeling', 'looier'],
    }),
    config,
  };
}

/** Replay with a fixed set of answers, as the referee does. */
function run(t: Table, answers: Map<string, Choice>) {
  return probe(t.state, defaultNightOrder(ROLES), t.config, answers);
}

const key = (seat: number, k: string) => `${seat}:${k}`;

describe('the Dubbelganger looks as a second Medium', () => {
  // Seat 0 Dubbelganger copies seat 3 (the real Medium), then looks at seat 4
  // (the Ziener) — an ordinary village card, so it is flipped face up.
  const answers = () => new Map<string, Choice>([
    [key(0, 'doppel-view'), { kind: 'seat', seat: 3 as SeatIndex }],
    [key(0, 'medium-target'), { kind: 'seat', seat: 4 as SeatIndex }],
  ]);

  it('turns an eligible card face up for the whole table', () => {
    const t = table(ROLES);
    const result = run(t, answers());
    const seen = publicView(result.result.state).revealed;
    expect(seen[4]).toBe('ziener');
  });

  it('leaves the real Medium her own look, later', () => {
    // A second Medium, not a replacement. If copying consumed her turn she
    // would silently lose her action whenever somebody copied her.
    const t = table(ROLES);
    const result = run(t, answers());
    const mediumsOwn = result.requests.filter(
      (r) => r.seat === 3 && r.key === 'medium-target',
    );
    expect(mediumsOwn).toHaveLength(1);
  });

  it('asks the copy before the Heks is asked anything', () => {
    // The Heks must choose against a table she can already see. Order of the
    // engine's questions is the order of the night.
    const t = table(ROLES);
    const result = run(t, answers());
    const order = result.requests.map((r) => `${r.seat}:${r.key}`);
    expect(order.indexOf(key(0, 'medium-target')))
      .toBeLessThan(order.indexOf(key(1, 'heks-center')));
  });
});

describe('what is never turned over', () => {
  const lookAt = (seat: number) => new Map<string, Choice>([
    [key(0, 'doppel-view'), { kind: 'seat', seat: 3 as SeatIndex }],
    [key(0, 'medium-target'), { kind: 'seat', seat: seat as SeatIndex }],
  ]);

  it('keeps a wolf hidden', () => {
    // House rule: a wolf is not flipped. Seat 5 is the Weerwolf.
    const t = table(ROLES);
    const result = run(t, lookAt(5));
    expect(publicView(result.result.state).revealed[5]).toBeUndefined();
  });

  it('keeps the Looier hidden', () => {
    // The load-bearing half of the forced swap: a publicly known Looier is one
    // nobody will ever lynch, which would turn a risk into a guaranteed loss.
    const withLooier: RoleId[] = [
      'dubbelganger', 'heks', 'dorpsgek', 'medium', 'looier', 'weerwolf',
    ];
    const t = table(withLooier);
    const result = run(t, lookAt(4));
    expect(publicView(result.result.state).revealed[4]).toBeUndefined();
  });

  it('reveals nothing at all when the copy declines to look', () => {
    const t = table(ROLES);
    const result = run(t, new Map<string, Choice>([
      [key(0, 'doppel-view'), { kind: 'seat', seat: 3 as SeatIndex }],
      [key(0, 'medium-target'), { kind: 'none' }],
    ]));
    expect(publicView(result.result.state).revealed).toEqual({});
  });
});

describe('the reveal survives the rest of the night', () => {
  it('follows the card when the Dorpsgek shifts everything', () => {
    // The Dorpsgek acts at 80, after both Mediums. This is the case an
    // accumulated seat -> role map gets wrong while still looking fine.
    const t = table(ROLES);
    const result = run(t, new Map<string, Choice>([
      [key(0, 'doppel-view'), { kind: 'seat', seat: 3 as SeatIndex }],
      [key(0, 'medium-target'), { kind: 'seat', seat: 4 as SeatIndex }],
      [key(2, 'dorpsgek'), { kind: 'dorpsgek', direction: 'right' }],
    ]));

    const after = result.result.state;
    const seen = publicView(after).revealed;
    const entries = Object.entries(seen);

    // Still exactly one face-up card, still the Ziener, and no longer at 4.
    expect(entries).toHaveLength(1);
    expect(entries[0]![1]).toBe('ziener');
    expect(Number(entries[0]![0])).not.toBe(4);
    // And it is genuinely where that card now is.
    expect(after.cardRole[after.slots[Number(entries[0]![0])]!]).toBe('ziener');
  });
});

describe('the schedule cannot be read for information', () => {
  it('is identical whatever the Dubbelganger copied', () => {
    // If the timeline changed shape based on the copy, the length of the night
    // would announce it. Built from the active role list alone.
    const base = buildTimeline(ROLES, DEPENDENCY_CONFIG);
    for (const copied of ['medium', 'ziener', 'weerwolf', 'dorpsgek'] as RoleId[]) {
      const t = table(ROLES);
      run(t, new Map<string, Choice>([
        [key(0, 'doppel-view'), { kind: 'seat', seat: ROLES.indexOf(copied) as SeatIndex }],
      ]));
      const again = buildTimeline(ROLES, DEPENDENCY_CONFIG);
      expect(again.phases.map((p) => [p.kind, p.role, p.startMs, p.endMs]))
        .toEqual(base.phases.map((p) => [p.kind, p.role, p.startMs, p.endMs]));
      expect(again.totalMs).toBe(base.totalMs);
    }
  });

  it('leaves two-round mode at two rounds and its own length', () => {
    // The faster, simplified variant. Nothing here may add a Heks follow-up
    // or any new waiting to it.
    const two = buildTimeline(ROLES, TWO_ROUND_CONFIG);
    const followups = two.phases.filter((p) => p.kind === 'followup');
    expect(two.phases.filter((p) => p.kind === 'open')).toHaveLength(1);
    expect(followups.map((p) => p.role)).toEqual(['dubbelganger']);
    expect(two.totalMs).toBeLessThan(buildTimeline(ROLES, DEPENDENCY_CONFIG).totalMs);
  });
});

describe('the public view carries nothing private', () => {
  it('names only cards that were turned over, and only where they are', () => {
    // A regression guard on the shape itself: no card identities, no targets,
    // no deal. Just slot -> the role lying face up there.
    const t = table(ROLES);
    const result = run(t, new Map<string, Choice>([
      [key(0, 'doppel-view'), { kind: 'seat', seat: 3 as SeatIndex }],
      [key(0, 'medium-target'), { kind: 'seat', seat: 4 as SeatIndex }],
    ]));
    const view = publicView(result.result.state);

    expect(Object.keys(view).sort()).toEqual(['revealed', 'shielded']);

    const state = result.result.state;
    for (const [slot, role] of Object.entries(view.revealed)) {
      const card = state.slots[Number(slot)]!;
      expect(state.revealedCards.has(card)).toBe(true);
      expect(state.cardRole[card]).toBe(role);
    }
    // Everything unflipped stays absent, however many cards are in play.
    const flipped = Object.keys(view.revealed).length;
    expect(flipped).toBeLessThan(state.slots.length);
  });

  it('says nothing about a decision that was made privately', () => {
    // Two different Dubbelganger targets, same public view: what she looked at
    // is hers, only what she flipped is the table's.
    const t1 = table(ROLES);
    const a = publicView(run(t1, new Map<string, Choice>([
      [key(0, 'doppel-view'), { kind: 'seat', seat: 3 as SeatIndex }],
      [key(0, 'medium-target'), { kind: 'none' }],
    ])).result.state);

    const t2 = table(ROLES);
    const b = publicView(run(t2, new Map<string, Choice>([
      [key(0, 'doppel-view'), { kind: 'seat', seat: 4 as SeatIndex }],
    ])).result.state);

    expect(a.revealed).toEqual(b.revealed);
  });
});
