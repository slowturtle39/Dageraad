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
  /**
   * You believe you are the Bodyguard, so you shield instead of voting: every
   * vote against whoever you name is cancelled, your own included.
   *
   * Deliberately keyed to what you BELIEVE you are — your dealt role — and not
   * to the truth. The engine resolves the shield on whoever holds the Bodyguard
   * card at dawn (§6.0), so a player whose card was swapped away goes on
   * shielding nobody while somebody else shields without knowing it. Same shape
   * as the Looier, whose vote they think counts and does not.
   */
  isBodyguard?: boolean;
  onTarget: (seat: SeatIndex) => void;
  onAbstain: (next: boolean) => void;
  onConfirm: () => void;
  /**
   * "I am ready — let us vote now."
   *
   * A separate toggle from the abstain, and separate on purpose: abstaining is
   * a decision about the OUTCOME, this is one about the CLOCK. Collapsing them
   * into one control would make a table that has simply finished arguing look
   * like a table that has given up.
   */
  readyToVote?: boolean;
  earlyVoteCount?: number;
  onReadyToVote?: (next: boolean) => void;
}

export function renderVoting(view: VotingView): HTMLElement {
  const el = document.createElement('div');

  const chosen = view.target === null ? null : view.names[view.target];
  const line = document.createElement('p');
  line.className = 'sheet__sub';
  if (view.isBodyguard) {
    line.textContent = chosen
      ? `Je beschermt ${chosen}. Alle stemmen op ${chosen} vervallen.`
      : 'Tik iemand aan om te beschermen. Alle stemmen op die persoon vervallen.';
  } else {
    line.textContent = chosen
      ? `Je stemt op ${chosen}.`
      : 'Tik iemand aan de tafel aan om op te stemmen.';
  }
  el.append(line);

  // The Bodyguard MUST name someone once voting is open (Milan, 2026-08-26) —
  // shielding is not optional. He may still join a majority that decides not to
  // vote at all during the discussion, because that ends the vote for everybody
  // rather than letting him quietly do nothing while it happens.
  const mustProtect = view.isBodyguard === true && view.votingOpen;

  const abstain = document.createElement('button');
  abstain.type = 'button';
  abstain.className = view.abstain ? 'btn btn--primary' : 'btn';
  abstain.textContent = t(view.lang, 'action.abstain');
  abstain.disabled = mustProtect;
  if (!mustProtect) {
    abstain.addEventListener('click', () => view.onAbstain(!view.abstain));
  }
  el.append(abstain);

  if (mustProtect) {
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = 'Je moet iemand beschermen — overslaan kan niet.';
    el.append(note);
  }

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

  // Only during the discussion. Once the ballot is open there is nothing left
  // to ask for, and a button that does nothing is worse than no button.
  if (!view.votingOpen && view.onReadyToVote) {
    const ready = document.createElement('button');
    ready.type = 'button';
    ready.className = view.readyToVote ? 'btn btn--primary' : 'btn';
    ready.dataset.ready = 'true';
    ready.textContent = view.readyToVote
      ? t(view.lang, 'day.readyToVoteOn', {
          n: view.earlyVoteCount ?? 0, needed,
        })
      : t(view.lang, 'day.readyToVote');
    ready.addEventListener('click', () => view.onReadyToVote?.(!view.readyToVote));
    el.append(ready);

    // Said every time, because the two toggles sit next to each other and the
    // difference between them is the whole point.
    const explain = document.createElement('p');
    explain.className = 'sheet__note';
    explain.textContent = t(view.lang, 'day.readyExplain');
    el.append(explain);
  }

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

/** "Sanne (Weerwolf) en Joris (Dorpeling)" — who died and what they turned out to be. */
function lynchLine(view: ResultsView): string {
  return view.result.eliminated
    .map((s) => {
      const name = view.names[s] ?? s;
      const role = ROLES[view.finalRoles[s]!]?.nl;
      return role ? `${name} (${role})` : `${name}`;
    })
    .join(' en ');
}

function describeOutcome(view: ResultsView): string {
  const { result, lang } = view;
  switch (result.outcome) {
    case 'no-vote':
      return t(lang, 'day.noVote');
    case 'tie': {
      // A tie is no longer a reprieve: everyone on the top count hangs
      // (2026-08-26). It only means "nobody died" when no vote counted at all.
      if (result.eliminated.length === 0) return t(lang, 'day.tie');
      return `Gelijkspel — ${lynchLine(view)} hangen allebei.`;
    }
    case 'eliminated':
      return `${lynchLine(view)} werd gelyncht.`;
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
