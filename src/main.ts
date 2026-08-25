import { ROLES } from './engine/roles.js';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from './engine/presets.js';
import { buildTimeline } from './engine/timeline.js';
import type { RoleId, SeatIndex } from './engine/types.js';
import { renderTable, type SeatView } from './ui/table.js';
import { renderSheet } from './ui/sheet.js';
import { aggregate, renderStats, type ResultRow } from './ui/stats.js';

/**
 * Demo harness for the table view.
 *
 * Not the real app — there is no Firebase yet. This renders the seating circle
 * with plausible data so the layout, palette and the stats-on-tap flow can be
 * looked at and argued about before any of it is wired to a live room.
 *
 * What it is meant to demonstrate, and what to check when looking at it:
 *   1. The table looks IDENTICAL in night and day. Toggle the phase and watch
 *      the screen's brightness not change (§13.1).
 *   2. A decision prompt is drawn OVER the table, not instead of it — so from
 *      across the room, deciding and idly browsing look the same.
 *   3. Tapping anyone opens their history, in any phase. That is the cover.
 */

const NAMES = ['Milan', 'Sanne', 'Joris', 'Fleur', 'Daan', 'Noor', 'Bram', 'Eva'];

type Phase = 'nacht' | 'dag';

const state = {
  phase: 'nacht' as Phase,
  selected: null as SeatIndex | null,
  openStats: null as SeatIndex | null,
  prompting: true,
  paused: false,
};

/** Deterministic filler so the demo looks the same every reload. */
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
    const k = (seed * 13 + i * 5) % roles.length;
    rows.push({
      finalRole: roles[k]!,
      won: (seed + i) % 3 !== 0,
      voteOutcome: outcomes[(seed * 3 + i) % outcomes.length]!,
      suspicionAccuracy: i % 4 === 0 ? null : ((seed + i) % 10) / 10,
    });
  }
  return rows;
}

function seats(): SeatView[] {
  return NAMES.map((name, i) => ({
    seat: i,
    name,
    isSelf: i === 0,
    selected: state.selected === i,
    // Only a genuinely public flip shows a face — the Medium's (§12).
    revealedRole: state.phase === 'dag' && i === 4 ? ('ziener' as RoleId) : undefined,
    shielded: i === 6,
  }));
}

function render(): void {
  const app = document.getElementById('app')!;
  app.replaceChildren();

  const timeline = buildTimeline(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);

  /* -- top bar: text changes between phases, luminance does not -- */
  const top = document.createElement('div');
  top.className = 'topbar';
  const phase = document.createElement('span');
  phase.className = 'topbar__phase';
  phase.textContent = state.phase === 'nacht' ? 'nacht — ronde 1' : 'dag — overleg';
  const timer = document.createElement('span');
  timer.className = state.paused ? 'topbar__timer topbar__timer--paused' : 'topbar__timer';
  timer.textContent = state.paused
    ? 'gepauzeerd'
    : state.phase === 'nacht'
      ? `0:0${Math.round(timeline.phases[0]!.endMs / 1000)}`
      : '14:22';
  top.append(phase, timer);
  app.append(top);

  /* -- the table: the same component in every phase -- */
  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  const sheetOpen = state.openStats !== null || (state.prompting && state.phase === 'nacht');
  if (sheetOpen) wrap.classList.add('tablewrap--sheet');
  wrap.append(
    renderTable({
      seats: seats(),
      centerCount: 3,
      hasAlphaWolfCard: true,
      onSeatTap: (seat) => {
        if (state.prompting && state.phase === 'nacht') {
          state.selected = seat;
        } else {
          state.openStats = seat;
        }
        render();
      },
    }),
  );
  app.append(wrap);

  /* -- bottom bar -- */
  const bottom = document.createElement('div');
  bottom.className = 'bottombar';
  bottom.append(
    button(state.phase === 'nacht' ? 'Toon dag' : 'Toon nacht', () => {
      state.phase = state.phase === 'nacht' ? 'dag' : 'nacht';
      state.prompting = state.phase === 'nacht';
      state.openStats = null;
      render();
    }),
    button('Mijn rol', () => {
      state.openStats = null;
      state.prompting = false;
      showOwnRole();
    }),
    button(state.paused ? 'Hervat' : 'Pauze', () => {
      state.paused = !state.paused;
      render();
    }),
  );
  app.append(bottom);

  /* -- sheets, drawn over the table -- */
  if (state.openStats !== null) {
    const seat = state.openStats;
    app.append(
      renderSheet({
        title: NAMES[seat]!,
        body: renderStats(aggregate(NAMES[seat]!, fakeResults(seat + 1))),
        note: 'Alleen eerdere potjes. Nooit iets over vanavond.',
        onDismiss: () => {
          state.openStats = null;
          render();
        },
      }),
    );
    return;
  }

  if (state.prompting && state.phase === 'nacht') {
    app.append(
      renderSheet({
        title: 'Alfawolf',
        subtitle:
          'Kies een speler. Je legt de wolvenkaart uit het midden voor die ' +
          'speler neer — zonder te kijken wat je wegneemt.',
        actions: [
          {
            label:
              state.selected === null
                ? 'Kies eerst een speler'
                : `Bevestig: ${NAMES[state.selected]!}`,
            primary: state.selected !== null,
            onSelect: () => {
              if (state.selected === null) return;
              state.prompting = false;
              render();
            },
          },
          {
            label: 'Sla over',
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

function showOwnRole(): void {
  const app = document.getElementById('app')!;
  app.append(
    renderSheet({
      title: `Je bent de ${ROLES.alphawolf.nl}`,
      subtitle:
        'Dit is de rol die je aan het begin kreeg. Je actie hoort altijd bij ' +
        'deze rol, ook als je kaart later van tafel verwisseld is.',
      actions: [{ label: 'Sluiten', onSelect: () => render() }],
      onDismiss: () => render(),
    }),
  );
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
