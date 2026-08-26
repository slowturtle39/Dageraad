import type { DayResult, VoteOutcome } from '../engine/dayphase.js';
import { ROLES } from '../engine/roles.js';
import { t, roleName, type Lang } from './i18n.js';
import type { RoleId, SeatIndex } from '../engine/types.js';

/**
 * Voting and results (§7, §8).
 *
 * The vote is a sheet over the same table, like everything else — you pick by
 * tapping the ring, not from a list, so the thing you look at while deciding is
 * the same thing you look at the rest of the game.
 */

export interface VotingView {
  lang: Lang;
  /** Your own seat. Never selectable — §7, and the rules reject it too. */
  ownSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  target: SeatIndex | null;
  abstain: boolean;
  /** How many are currently abstaining, and how many it would take. */
  abstainCount: number;
  seatCount: number;
  /** How many have cast a vote. Voting is mandatory, so this chases stragglers. */
  votesCast: number;
  /** True once the discussion has ended and voting is open. */
  votingOpen: boolean;
  onTarget: (seat: SeatIndex) => void;
  onAbstain: (next: boolean) => void;
  onConfirm: () => void;
}

export function renderVoting(view: VotingView): HTMLElement {
  const el = document.createElement('div');

  const chosen = view.target === null ? null : view.names[view.target];
  const line = document.createElement('p');
  line.className = 'sheet__sub';
  line.textContent = chosen
    ? `Je stemt op ${chosen}.`
    : 'Tik iemand aan de tafel aan om op te stemmen.';
  el.append(line);

  const abstain = document.createElement('button');
  abstain.type = 'button';
  abstain.className = view.abstain ? 'btn btn--primary' : 'btn';
  abstain.textContent = t(view.lang, 'action.abstain');
  abstain.addEventListener('click', () => view.onAbstain(!view.abstain));
  el.append(abstain);

  // The count is shown to everyone because the rule is a simultaneous show of
  // hands — knowing how close it is IS the mechanic. It reveals nothing about
  // anyone's role, only their current intention.
  const needed = Math.floor(view.seatCount / 2) + 1;
  const tally = document.createElement('p');
  tally.className = 'sheet__note';
  // Live from the first second: the group may decide not to vote at any moment,
  // so the count has to be true at any moment too. Showing how close it is IS
  // the mechanic — and it reveals intention, never anybody's role.
  tally.textContent =
    `${view.abstainCount} van de ${view.seatCount} willen niet stemmen. ` +
    `Vanaf ${needed} gaat de stemming niet door.`;
  el.append(tally);

  if (view.votingOpen) {
    // Voting is MANDATORY once the timer has expired and the group did not
    // abstain, so the game is genuinely waiting for these people. A count is
    // safe to show — it is never who voted for whom, and at a real table you
    // can see perfectly well whose hand is still down.
    const progress = document.createElement('p');
    progress.className = 'sheet__note';
    progress.textContent =
      view.votesCast >= view.seatCount
        ? 'Iedereen heeft gestemd.'
        : `${view.votesCast} van de ${view.seatCount} hebben gestemd. ` +
          `Er wordt op de rest gewacht — iedereen moet stemmen.`;
    el.append(progress);
  }

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn--primary';
  confirm.textContent = t(view.lang, 'action.vote');
  confirm.disabled = view.target === null && !view.abstain;
  confirm.addEventListener('click', () => view.onConfirm());
  el.append(confirm);

  return el;
}

export interface ResultsView {
  lang: Lang;
  result: DayResult;
  outcomes: Record<SeatIndex, VoteOutcome>;
  names: Record<SeatIndex, string>;
  finalRoles: Record<SeatIndex, RoleId>;
  ownSeat: SeatIndex;
}

export function renderResults(view: ResultsView): HTMLElement {
  const el = document.createElement('div');
  const { result } = view;

  const headline = document.createElement('p');
  headline.className = 'sheet__sub';
  headline.textContent = describeOutcome(view);
  el.append(headline);

  // Teams, then everyone's real card. This is the only screen in the app where
  // roles are shown for players other than yourself — the game is over.
  const teams = document.createElement('div');
  teams.className = 'stats__grid';
  teams.append(
    teamTile('Dorp', result.teamsWon.village),
    teamTile('Wolven', result.teamsWon.wolf),
    teamTile('Looier', result.teamsWon.solo),
  );
  el.append(teams);

  for (const [seatKey, role] of Object.entries(view.finalRoles)) {
    const seat = Number(seatKey);
    const row = document.createElement('div');
    row.className = 'rolerow';

    const name = document.createElement('span');
    name.className = 'rolerow__name';
    name.textContent =
      `${view.names[seat] ?? seat}` +
      (result.eliminated.includes(seat) ? ' — gelyncht' : '');

    const roleEl = document.createElement('span');
    roleEl.className = 'rolerow__n';
    roleEl.style.width = 'auto';
    roleEl.textContent = roleName(view.lang, role);

    row.append(name, roleEl);
    el.append(row);
  }

  const note = document.createElement('p');
  note.className = 'sheet__note';
  note.textContent = summariseVotes(view);
  el.append(note);

  return el;
}

function teamTile(label: string, won: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stat';
  const v = document.createElement('div');
  v.className = 'stat__value';
  v.textContent = won ? 'wint' : '—';
  const l = document.createElement('div');
  l.className = 'stat__label';
  l.textContent = label;
  el.append(v, l);
  return el;
}

function describeOutcome(view: ResultsView): string {
  const { result, lang } = view;
  switch (result.outcome) {
    case 'no-vote':
      return t(lang, 'day.noVote');
    case 'tie':
      return t(lang, 'day.tie');
    case 'bodyguard-void':
      return t(lang, 'day.bodyguardVoid');
    case 'eliminated': {
      const who = result.eliminated.map((s) => view.names[s] ?? s).join(' en ');
      const roles = result.eliminated
        .map((s) => ROLES[view.finalRoles[s]!]?.nl ?? '')
        .join(' en ');
      return `${who} werd gelyncht — ${roles}.`;
    }
  }
}

/**
 * A plain-language note about discarded votes.
 *
 * Worth surfacing rather than hiding: "why didn't my vote count?" is otherwise
 * the first argument of the evening, and the Looier's discarded vote in
 * particular looks like a bug if it is never explained.
 */
function summariseVotes(view: ResultsView): string {
  const parts: string[] = [];
  const looier = view.result.discarded.filter((d) => d.reason === 'looier');
  if (looier.length > 0) {
    const who = looier.map((d) => view.names[d.voter] ?? d.voter).join(', ');
    parts.push(`De stem van ${who} telde niet mee — de Looier stemt nooit mee.`);
  }
  const timedOut = Object.entries(view.outcomes).filter(
    ([, o]) => o === 'not-scored',
  ).length;
  if (timedOut > 0) {
    parts.push(`${timedOut}× geen stem uitgebracht; dat telt niet als een foute stem.`);
  }
  return parts.join(' ');
}
