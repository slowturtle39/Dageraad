// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoleId } from '../engine/types.js';
import type { RoundRecord, RoundResult, SessionStanding } from '../app/session.js';
import { renderStandings, renderStatsBrowser, type StatsBrowserView } from './statsbrowser.js';

const src = readFileSync('src/ui/statsbrowser.ts', 'utf8');
const css = readFileSync('src/ui/theme.css', 'utf8');

function row(uid: string, dealt: RoleId, final: RoleId, won: boolean): RoundResult {
  return {
    uid, seat: 0, originalRole: dealt, finalRole: final, won,
    voteOutcome: won ? 'correct' : 'incorrect', suspicionAccuracy: null,
  };
}

function round(n: number, roles: RoleId[], results: RoundResult[], seatCount = 4): RoundRecord {
  return { round: n, activeRoles: roles, seatCount, outcome: 'eliminated', results };
}

const ROUNDS: RoundRecord[] = [
  round(1, ['weerwolf', 'ziener', 'heks'], [
    row('a', 'ziener', 'ziener', true),
    row('b', 'weerwolf', 'weerwolf', false),
  ], 6),
  round(2, ['weerwolf', 'ziener', 'heks'], [
    row('a', 'ziener', 'weerwolf', false),
    row('b', 'weerwolf', 'ziener', true),
  ], 6),
  round(3, ['weerwolf', 'medium'], [
    row('a', 'medium', 'medium', true),
    row('b', 'weerwolf', 'weerwolf', false),
  ], 8),
];

function view(over: Partial<StatsBrowserView> = {}): StatsBrowserView {
  return {
    lang: 'nl',
    rounds: ROUNDS,
    names: { a: 'Milan', b: 'Sanne' },
    tab: 'players',
    filter: {},
    onTab: () => {},
    onFilter: () => {},
    ...over,
  };
}

const text = (el: HTMLElement) => el.textContent ?? '';

describe('the stats browser', () => {
  it('is a separate screen from the tap-a-player sheet, on purpose', () => {
    // The sheet is night-phase cover traffic and must stay glanceable and
    // identical for everyone; this one wants filters, tabs and depth. Serving
    // both from one screen would make the cover worse, and the cover is a
    // privacy mechanism.
    expect(src).toMatch(/cover traffic/);
    expect(src).toMatch(/reachable BEFORE/i);
  });

  it('renders every breakdown Milan asked for', () => {
    for (const tab of ['players', 'roles', 'teams', 'tables', 'combos'] as const) {
      const el = renderStatsBrowser(view({ tab }));
      expect(el.querySelectorAll('.grid').length).toBeGreaterThan(0);
    }
  });

  it('shows raw counts next to every percentage', () => {
    // "38%" over eight games and over eight hundred look identical without it.
    const el = renderStatsBrowser(view({ tab: 'players' }));
    expect(text(el)).toMatch(/\d+\/\d+ · \d+%/);
  });

  it('says how big the sample is, every tab', () => {
    const el = renderStatsBrowser(view({ tab: 'roles' }));
    expect(text(el)).toMatch(/3 partijen/);
    expect(text(el)).toMatch(/percentages zeggen weinig|zeggen percentages weinig/);
  });

  it('shows a role as dealt AND as a final card', () => {
    // A role can be a fine card to be dealt and a terrible one to hold at
    // dawn. One number cannot say that.
    const el = renderStatsBrowser(view({ tab: 'roles' }));
    expect(text(el)).toMatch(/Gedeeld/);
    expect(text(el)).toMatch(/Eindkaart/);
  });

  it('explains that team rates are per game, not per player', () => {
    const el = renderStatsBrowser(view({ tab: 'teams' }));
    expect(text(el)).toMatch(/Per partij geteld, niet per speler/);
  });

  it('hides role combinations seen only once', () => {
    // One round is not a pattern, and showing it as one is how a group talks
    // itself into believing a pairing is broken.
    const el = renderStatsBrowser(view({ tab: 'combos' }));
    const body = text(el);
    expect(body).toMatch(/anekdotes, geen statistiek/);
    // heks+weerwolf appears in rounds 1 and 2; medium+weerwolf only in round 3.
    expect(body).toMatch(/Heks/);
    expect(body).not.toMatch(/Medium \+ /);
  });
});

describe('filters', () => {
  it('offers only table sizes that actually occurred', () => {
    // Offering "at 11 players" to a group that has never had 11 is a control
    // that can only ever produce an empty screen.
    const el = renderStatsBrowser(view());
    const chips = Array.from(el.querySelectorAll('.browser__chip'), (c) => c.textContent);
    expect(chips).toContain('6');
    expect(chips).toContain('8');
    expect(chips).not.toContain('11');
  });

  it('narrows the numbers when a table size is picked', () => {
    const all = text(renderStatsBrowser(view({ tab: 'tables' })));
    const six = text(renderStatsBrowser(view({ tab: 'tables', filter: { seatCount: 6 } })));
    expect(all).toMatch(/8/);
    expect(six).not.toMatch(/\b8\b/);
  });

  it('reports honestly when a filter matches nothing', () => {
    const el = renderStatsBrowser(view({ filter: { seatCount: 99 } }));
    expect(text(el)).toMatch(/Nog geen partijen/);
  });

  it('says how many of the total are being shown', () => {
    const el = renderStatsBrowser(view({ tab: 'players', filter: { seatCount: 6 } }));
    expect(text(el)).toMatch(/2 van 3 partijen/);
  });

  it('lets a role be picked from the ones that have been played', () => {
    const el = renderStatsBrowser(view());
    const options = Array.from(el.querySelectorAll('option'), (o) => o.textContent);
    expect(options).toContain('Heks');
    expect(options).toContain('Medium');
    // Never played, never offered.
    expect(options).not.toContain('Dronkaard');
  });
});

describe('the evening scoreboard', () => {
  const standings: SessionStanding[] = [
    { uid: 'a', points: 9, seeded: 0, roundsPlayed: 3, wins: 3, active: true },
    { uid: 'c', points: 4, seeded: 3, roundsPlayed: 1, wins: 0, active: true },
    { uid: 'b', points: 3, seeded: 0, roundsPlayed: 3, wins: 0, active: false },
  ];

  it('shows a late joiner’s seed as its own number, not folded into the total', () => {
    // Somebody who joined at round four on three points did not earn those
    // three, and hiding it is the first thing anyone will argue about.
    const el = renderStandings('nl', standings, { a: 'Milan', b: 'Sanne', c: 'Laat' });
    expect(text(el)).toMatch(/\+3/);
    expect(text(el)).toMatch(/begint gelijk met de laatste plek/);
  });

  it('marks who has gone home without dropping their record', () => {
    const el = renderStandings('nl', standings, { a: 'Milan', b: 'Sanne', c: 'Laat' });
    expect(text(el)).toMatch(/Sanne \(weg\)/);
  });

  it('omits the seed note when nobody joined late', () => {
    const clean = standings.map((s) => ({ ...s, seeded: 0 }));
    const el = renderStandings('nl', clean, { a: 'Milan', b: 'Sanne', c: 'Laat' });
    expect(text(el)).not.toMatch(/begint gelijk/);
  });
});

describe('it obeys the same visual rules as everything else', () => {
  it('never introduces a second palette', () => {
    // It is reachable DURING a game, so a screen that lights up differently is
    // the exact tell §5.4 exists to prevent.
    const block = css.slice(css.indexOf('.browser {'));
    expect(block).not.toMatch(/prefers-color-scheme/);
    expect(block).not.toMatch(/#[0-9a-f]{6}/i);   // tokens only, no raw colours
  });

  it('scrolls a wide table inside itself rather than the page', () => {
    expect(css).toMatch(/\.grid \{[^}]*overflow-x: auto/s);
  });
});
