import { ROLES } from './engine/roles.js';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from './engine/presets.js';
import { buildTimeline } from './engine/timeline.js';
import type { RoleId, SeatIndex } from './engine/types.js';
import { renderTable, type SeatView } from './ui/table.js';
import { renderSheet } from './ui/sheet.js';
import { aggregate, renderStats, type ResultRow } from './ui/stats.js';
import { renderTablet } from './ui/tablet.js';
import { renderLobby, swapSeats, seatingIsValid, type LobbyPlayer } from './ui/lobby.js';
import { detectLang, t, type Lang } from './ui/i18n.js';

/**
 * Demo harness.
 *
 * Not the real app — there is no Firebase yet, so nothing here is synced and
 * the data is invented. It exists so the three surfaces can be looked at and
 * argued about before any of them are wired to a live room.
 *
 * What to check when looking at it:
 *   1. Switch phone night -> phone day. The screen's brightness must not
 *      change. That is the §13.1 constraint, and it is a privacy rule rather
 *      than a taste one.
 *   2. A decision prompt is drawn OVER the table, never instead of it, so from
 *      across the room deciding and idly browsing look the same.
 *   3. Tapping anyone opens their history, in any phase. That is the cover.
 *   4. The tablet never names a role except the open window's and a card that
 *      was genuinely flipped face-up.
 */

const NAMES = ['Milan', 'Sanne', 'Joris', 'Fleur', 'Daan', 'Noor', 'Bram', 'Eva'];

type View = 'phone' | 'tablet' | 'lobby';
type Phase = 'night' | 'day';

const state = {
  view: 'phone' as View,
  phase: 'night' as Phase,
  lang: detectLang() as Lang,
  selected: null as SeatIndex | null,
  openStats: null as SeatIndex | null,
  prompting: true,
  paused: false,
  pendingSwap: null as SeatIndex | null,
  players: NAMES.map((displayName, i) => ({
    uid: `u${i}`,
    displayName,
    seatIndex: i,
  })) as LobbyPlayer[],
};

/** Deterministic filler so the demo looks the same on every reload. */
function fakeResults(seed: number): ResultRow[] {
  const roles: RoleId[] = [
    'dorpeling', 'weerwolf', 'ziener', 'heks', 'medium',
    'dorpsgek', 'looier', 'bodyguard', 'mystiekewolf', 'dubbelganger',
  ];
  const outcomes = [
    'correct', 'incorrect', 'inconsequential', 'correct', 'not-scored',
    'correct', 'incorrect', 'caused-village-loss',
  ] as const;
  const rows: ResultRow[] = [];
  const n = 14 + ((seed * 7) % 11);
  for (let i = 0; i < n; i++) {
    rows.push({
      finalRole: roles[(seed * 13 + i * 5) % roles.length]!,
      won: (seed + i) % 3 !== 0,
      voteOutcome: outcomes[(seed * 3 + i) % outcomes.length]!,
      suspicionAccuracy: i % 4 === 0 ? null : ((seed + i) % 10) / 10,
    });
  }
  return rows;
}

const ordered = () => [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);

function seats(): SeatView[] {
  return ordered().map((p, i) => ({
    seat: p.seatIndex,
    name: p.displayName,
    isSelf: i === 0,
    selected: state.selected === p.seatIndex,
    // Only a genuinely public flip shows a face — the Medium's (§12).
    revealedRole: state.phase === 'day' && i === 4 ? ('ziener' as RoleId) : undefined,
    shielded: i === 6,
  }));
}

function render(): void {
  const app = document.getElementById('app')!;
  app.replaceChildren();

  if (state.view === 'tablet') return renderTabletView(app);
  if (state.view === 'lobby') return renderLobbyView(app);
  return renderPhoneView(app);
}

/* ------------------------------------------------------------------ */

function renderPhoneView(app: HTMLElement): void {
  const timeline = buildTimeline(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);

  const top = document.createElement('div');
  top.className = 'topbar';
  const phase = document.createElement('span');
  phase.className = 'topbar__phase';
  phase.textContent =
    state.phase === 'night'
      ? `${t(state.lang, 'phase.night')} — ${t(state.lang, 'phase.round', { n: 1 })}`
      : `${t(state.lang, 'phase.day')} — ${t(state.lang, 'phase.discussion')}`;
  const timer = document.createElement('span');
  timer.className = state.paused ? 'topbar__timer topbar__timer--paused' : 'topbar__timer';
  timer.textContent = state.paused
    ? t(state.lang, 'phase.paused')
    : state.phase === 'night'
      ? `0:0${Math.round(timeline.phases[0]!.endMs / 1000)}`
      : '14:22';
  top.append(phase, timer);
  app.append(top);

  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  const sheetOpen = state.openStats !== null || (state.prompting && state.phase === 'night');
  if (sheetOpen) wrap.classList.add('tablewrap--sheet');
  wrap.append(
    renderTable({
      seats: seats(),
      centerCount: 3,
      hasAlphaWolfCard: true,
      onSeatTap: (seat) => {
        if (state.prompting && state.phase === 'night') state.selected = seat;
        else state.openStats = seat;
        render();
      },
    }),
  );
  app.append(wrap);
  app.append(bottomBar());

  if (state.openStats !== null) {
    const seat = state.openStats;
    const name = ordered().find((p) => p.seatIndex === seat)!.displayName;
    app.append(
      renderSheet({
        title: name,
        body: renderStats(aggregate(name, fakeResults(seat + 1))),
        note: t(state.lang, 'stats.historicalOnly'),
        onDismiss: () => {
          state.openStats = null;
          render();
        },
      }),
    );
    return;
  }

  if (state.prompting && state.phase === 'night') {
    const chosen =
      state.selected === null
        ? null
        : ordered().find((p) => p.seatIndex === state.selected)!.displayName;
    app.append(
      renderSheet({
        title: ROLES.alphawolf.nl,
        subtitle:
          'Kies een speler. Je legt de wolvenkaart uit het midden voor die ' +
          'speler neer — zonder te kijken wat je wegneemt.',
        actions: [
          {
            label: chosen ? `${t(state.lang, 'action.confirm')}: ${chosen}` : t(state.lang, 'action.pickPlayerFirst'),
            primary: chosen !== null,
            onSelect: () => {
              if (chosen === null) return;
              state.prompting = false;
              render();
            },
          },
          {
            label: t(state.lang, 'action.skip'),
            onSelect: () => {
              state.prompting = false;
              render();
            },
          },
        ],
        note:
          'Je komt er niet achter welke kaart je weghaalt. Dat hoort bij de rol ' +
          'en is geen bug.',
        dismissable: false,
      }),
    );
  }
}

function renderTabletView(app: HTMLElement): void {
  app.append(
    renderTablet({
      lang: state.lang,
      phase: state.phase,
      activeRole: state.phase === 'night' ? 'dubbelganger' : null,
      roundLabel: state.phase === 'night' ? t(state.lang, 'phase.round', { n: 2 }) : null,
      timer: state.paused ? '—' : state.phase === 'night' ? '0:12' : '14:22',
      paused: state.paused,
      seats: ordered().map((p, i) => ({
        seat: p.seatIndex,
        displayName: p.displayName,
        shielded: i === 6,
        revealedRole: state.phase === 'day' && i === 4 ? ('ziener' as RoleId) : undefined,
      })),
      centerCount: 3,
      hasAlphaWolfCard: true,
    }),
  );
  app.append(bottomBar());
}

function renderLobbyView(app: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'lobbywrap';
  wrap.append(
    renderLobby({
      players: state.players,
      canArrange: true,
      pendingSwap: state.pendingSwap,
      canStart: seatingIsValid(state.players) && state.players.length >= 3,
      onSeatTap: (seat) => {
        if (state.pendingSwap === null) state.pendingSwap = seat;
        else if (state.pendingSwap === seat) state.pendingSwap = null;
        else {
          state.players = swapSeats(state.players, state.pendingSwap, seat);
          state.pendingSwap = null;
        }
        render();
      },
      onStart: () => {
        state.view = 'phone';
        render();
      },
    }),
  );
  app.append(wrap);
  app.append(bottomBar());
}

function bottomBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'bottombar';
  bar.append(
    button(
      state.view === 'phone' ? 'Telefoon' : state.view === 'tablet' ? 'Tablet' : 'Stoelen',
      () => {
        state.view =
          state.view === 'phone' ? 'tablet' : state.view === 'tablet' ? 'lobby' : 'phone';
        state.openStats = null;
        render();
      },
    ),
    button(state.phase === 'night' ? 'Toon dag' : 'Toon nacht', () => {
      state.phase = state.phase === 'night' ? 'day' : 'night';
      state.prompting = state.phase === 'night';
      state.openStats = null;
      render();
    }),
    button(state.lang === 'nl' ? 'EN' : 'NL', () => {
      state.lang = state.lang === 'nl' ? 'en' : 'nl';
      render();
    }),
    button(
      state.paused ? t(state.lang, 'action.resume') : t(state.lang, 'action.pause'),
      () => {
        state.paused = !state.paused;
        render();
      },
    ),
  );
  return bar;
}

function button(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--ghost';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

render();
