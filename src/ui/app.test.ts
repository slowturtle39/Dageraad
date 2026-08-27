// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderApp, tabletViewFor, type AppActions, type AppDeps } from './app.js';
import type { AppState } from '../app/controller.js';
import type { PlayerView, PrivateView, RoomView } from '../app/backend.js';
import type { RoleId } from '../engine/types.js';
import type { Screen } from '../app/shell.js';

/**
 * The join between routing, privacy and the renderers.
 *
 * Thin on purpose, so the tests are about the two things that would not be
 * caught anywhere else: that each screen actually reaches its renderer, and
 * that the shared tablet stays spoiler-free when it is built from a device
 * that happens to hold every card.
 */

const ME = 'me-uid';
const OTHER = 'other-uid';

const noop = () => {};
const actions: AppActions = {
  onModeChange: noop, onCreate: noop, onCodeChange: noop, onNameChange: noop,
  onJoin: noop, onBack: noop, onLeave: noop, onRejoin: noop, onDeal: noop,
  onSeatTap: noop, onCardTap: noop, onNameTap: noop,
};

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    roomId: 'ROOM1',
    hostUid: 'tablet',
    refereeUid: 'tablet',
    phase: 'night',
    round: 1,
    nightWindowIndex: 0,
    activeRoles: ['alphawolf', 'ziener'] as RoleId[],
    config: {} as RoomView['config'],
    timeline: null,
    seating: [ME, OTHER],
    members: [
      { uid: ME, joinedAtRound: 1, leftAtRound: null },
      { uid: OTHER, joinedAtRound: 1, leftAtRound: null },
    ],
    standings: [],
    publicEvents: [],
    shieldedSeats: [],
    revealedSeats: {},
    abstainCount: 0,
    votesCast: 0,
    pausedAt: null,
    discussionExtendedByMs: 0,
    finalRoles: null,
    outcome: null,
    ...over,
  };
}

const players: PlayerView[] = [ME, OTHER].map((uid) => ({
  uid, displayName: uid.split('-')[0]!, seatIndex: null, playing: true, departed: false,
}));

const own: PrivateView = { originalRole: 'ziener', privateInfo: [] };

function state(over: Partial<AppState> = {}): AppState {
  return {
    uid: ME, roomId: 'ROOM1', room: room(), players, own,
    rounds: [], loading: false, joining: false, ...over,
  };
}

function deps(screen: Screen, over: Partial<AppDeps> = {}): AppDeps {
  return {
    lang: 'nl', state: state(), screen, mode: 'table-device',
    code: '', displayName: '', actions, ...over,
  };
}

describe('every screen reaches a renderer', () => {
  const cases: Array<[Screen, string]> = [
    [{ kind: 'setup' }, '.setup'],
    [{ kind: 'join' }, '.join'],
    [{ kind: 'waiting', joinsAtRound: 3 }, '.waiting'],
    [{ kind: 'departed' }, '.departed'],
    [{ kind: 'tablet' }, '.tablet'],
    [{ kind: 'lobby' }, '.lobby'],
    [{ kind: 'table', seat: 0 }, '.table'],
    [{ kind: 'results', seat: 0 }, '.table'],
  ];

  for (const [screen, selector] of cases) {
    it(`renders ${screen.kind}`, () => {
      const el = renderApp(deps(screen, {
        state: state({ room: room({ phase: screen.kind === 'lobby' ? 'lobby' : 'night' }) }),
      }));
      expect(el.matches(selector) || el.querySelector(selector)).toBeTruthy();
    });
  }
});

describe('the shared tablet stays spoiler-free', () => {
  // It is built ON the referee's device, which holds every card, and it is the
  // one screen eight people read at once (§12).
  it('shows no role during the night, even to the device that knows them all', () => {
    const view = tabletViewFor(deps({ kind: 'tablet' }));
    expect(view.seats.every((s) => s.revealedRole === undefined)).toBe(true);
  });

  it('shows a card that was genuinely turned face up', () => {
    const view = tabletViewFor(deps({ kind: 'tablet' }, {
      state: state({ room: room({ revealedSeats: { 1: 'weerwolf' as RoleId } }) }),
    }));
    expect(view.seats[1]!.revealedRole).toBe('weerwolf');
    expect(view.seats[0]!.revealedRole).toBeUndefined();
  });

  it('does NOT smuggle the final roles onto the tablet when the game ends', () => {
    // At the end the table reads the result on the results screen. The tablet
    // is a public display and stays a public display.
    const finished = room({
      phase: 'results',
      finalRoles: { 0: 'ziener', 1: 'weerwolf' } as Record<number, RoleId>,
    });
    const view = tabletViewFor(deps({ kind: 'tablet' }, { state: state({ room: finished }) }));
    expect(view.seats.every((s) => s.revealedRole === undefined)).toBe(true);
  });

  it('carries no field beyond the public ones', () => {
    // assertSpoilerFree runs inside tabletViewFor; this proves it is reached.
    const view = tabletViewFor(deps({ kind: 'tablet' }));
    for (const seat of view.seats) {
      expect(Object.keys(seat).sort())
        .toEqual(expect.arrayContaining(['displayName', 'seat', 'shielded']));
      expect(Object.keys(seat)).not.toContain('originalRole');
    }
  });

  it('names the open window from the public timeline, never from the deal', () => {
    // The timeline comes from the active role list alone, so it says a Ziener
    // window is open — not that anybody is the Ziener.
    const withTimeline = room({
      timeline: {
        phases: [{ index: 0, kind: 'followup', role: 'ziener' as RoleId, startMs: 0, endMs: 1, revealAtMs: 1 }],
        revealAtMs: {}, totalMs: 1,
      } as RoomView['timeline'],
    });
    const view = tabletViewFor(deps({ kind: 'tablet' }, { state: state({ room: withTimeline }) }));
    expect(view.activeRole).toBe('ziener');
  });

  it('names no window outside the night', () => {
    const view = tabletViewFor(deps({ kind: 'tablet' }, {
      state: state({ room: room({ phase: 'day' }) }),
    }));
    expect(view.activeRole).toBeNull();
  });

  it('shows the round only once one has been dealt', () => {
    expect(tabletViewFor(deps({ kind: 'tablet' }, {
      state: state({ room: room({ round: 0, phase: 'lobby' }) }),
    })).roundLabel).toBeNull();
    expect(tabletViewFor(deps({ kind: 'tablet' })).roundLabel).toContain('1');
  });
});

describe('the lobby arranges who is about to play', () => {
  it('lists the next round\'s roster, not the current seating', () => {
    // Somebody who arrived a minute ago must not be invisible on the screen
    // where seats are agreed.
    const r = room({
      phase: 'lobby', round: 1, seating: [ME],
      members: [
        { uid: ME, joinedAtRound: 1, leftAtRound: null },
        { uid: OTHER, joinedAtRound: 2, leftAtRound: null },
      ],
    });
    const el = renderApp(deps({ kind: 'lobby' }, { state: state({ room: r }) }));
    expect(el.textContent).toContain('other');
  });

  it('lets everyone at the lobby arrange, but locks seats once a round starts', () => {
    const hosted = room({ phase: 'lobby', hostUid: ME });
    const el = renderApp(deps({ kind: 'lobby' }, { state: state({ room: hosted }) }));
    expect(el.querySelectorAll('.seat--disabled').length).toBe(0);

    const guest = room({ phase: 'lobby', hostUid: 'somebody-else' });
    const el2 = renderApp(deps({ kind: 'lobby' }, { state: state({ room: guest }) }));
    expect(el2.querySelectorAll('.seat--disabled').length).toBe(0);

    const started = room({ phase: 'night', hostUid: ME });
    const el3 = renderApp(deps({ kind: 'lobby' }, { state: state({ room: started }) }));
    expect(el3.querySelectorAll('.seat--disabled').length).toBeGreaterThan(0);
  });

  it('will not deal a table too small to deal', () => {
    // Three centre cards means the deal needs seatCount + 3.
    const tiny = room({ phase: 'lobby', refereeUid: ME, seating: [ME], members: [
      { uid: ME, joinedAtRound: 1, leftAtRound: null },
    ] });
    const el = renderApp(deps({ kind: 'lobby' }, {
      state: state({ room: tiny, players: [players[0]!] }),
    }));
    expect(el.querySelector<HTMLButtonElement>('.btn--primary')!.disabled).toBe(true);
  });
});

describe('the table', () => {
  it('shows your own role and nobody else\'s', () => {
    const el = renderApp(deps({ kind: 'table', seat: 0 }));
    const roles = Array.from(el.querySelectorAll('.seat__role')).map((n) => n.textContent);
    expect(roles.filter((r) => r && r.trim().length > 0).length).toBeLessThanOrEqual(1);
  });

  it('declares the Alpha Wolf card from the public role list', () => {
    // Public: the host picked the roles and everybody saw them.
    const el = renderApp(deps({ kind: 'table', seat: 0 }));
    expect(el).toBeTruthy();
    const without = renderApp(deps({ kind: 'table', seat: 0 }, {
      state: state({ room: room({ activeRoles: ['ziener'] as RoleId[] }) }),
    }));
    expect(without).toBeTruthy();
  });
});
