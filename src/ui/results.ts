import { teamOf } from '../engine/roles.js';
import type { RoleId, SeatIndex, Team } from '../engine/types.js';
import type { DiscardReason } from '../engine/dayphase.js';
import { roleName, t, type Lang } from './i18n.js';

export interface ResultsView {
  lang: Lang;
  outcome: string;
  finalRoles: Record<SeatIndex, RoleId>;
  names: Record<SeatIndex, string>;
  ownSeat: SeatIndex;
  eliminatedSeats?: SeatIndex[];
  winningTeams?: Team[];
  finalVotes?: Record<SeatIndex, SeatIndex | null>;
  discardedVotes?: Partial<Record<SeatIndex, DiscardReason>>;
  finalTally?: Record<SeatIndex, number>;
  onNextRound?: () => void;
}

function seatName(view: ResultsView, seat: SeatIndex): string {
  return view.names[seat] ?? String(seat + 1);
}

function outcomeText(view: ResultsView): string {
  if (!view.eliminatedSeats) {
    return view.outcome === 'tie'
      ? t(view.lang, 'results.tieLegacy')
      : view.outcome === 'no-vote'
        ? t(view.lang, 'results.noneEliminated')
        : t(view.lang, 'results.finished');
  }
  const names = view.eliminatedSeats.map((seat) => seatName(view, seat)).join(', ');
  if (view.eliminatedSeats.length === 0) return t(view.lang, 'results.noneEliminated');
  if (view.eliminatedSeats.length === 1) {
    return t(view.lang, 'results.oneEliminated', { who: names });
  }
  return t(view.lang, 'results.tieEliminated', { who: names });
}

function winnersText(lang: Lang, teams: Team[] | undefined): string | null {
  if (!teams) return null;
  if (teams.length === 0) return t(lang, 'results.winner.none');
  if (teams.length === 1) return t(lang, `results.winner.${teams[0]}`);
  const labels = teams.map((team) => t(lang, `results.team.${team}`));
  return t(lang, 'results.winner.many', {
    who: labels.join(', '),
  });
}

function voteText(
  view: ResultsView,
  voter: SeatIndex,
  target: SeatIndex | null,
): string {
  const voterName = seatName(view, voter);
  const targetName = target === null ? '' : seatName(view, target);
  const reason = view.discardedVotes?.[voter];
  if (reason === 'bodyguard-protects') {
    return t(view.lang, 'results.vote.protects', { voter: voterName, target: targetName });
  }
  if (target === null) return t(view.lang, 'results.vote.none', { voter: voterName });
  if (reason === 'looier') {
    return t(view.lang, 'results.vote.looier', { voter: voterName, target: targetName });
  }
  if (reason === 'protected') {
    return t(view.lang, 'results.vote.protected', { voter: voterName, target: targetName });
  }
  if (reason) {
    return t(view.lang, 'results.vote.discarded', { voter: voterName, target: targetName });
  }
  return t(view.lang, 'results.vote.counted', { voter: voterName, target: targetName });
}

/** Public dawn panel: full ballot, deaths, winners, and every final card. */
export function renderResults(view: ResultsView): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'resultpanel';
  panel.setAttribute('aria-label', t(view.lang, 'results.title'));

  const title = document.createElement('h2');
  title.className = 'sheet__title';
  title.textContent = t(view.lang, 'results.title');
  panel.append(title);

  const outcome = document.createElement('p');
  outcome.className = 'resultpanel__outcome';
  outcome.textContent = outcomeText(view);
  panel.append(outcome);

  const winners = winnersText(view.lang, view.winningTeams);
  if (winners) {
    const winner = document.createElement('p');
    winner.className = 'resultpanel__winner';
    winner.textContent = winners;
    panel.append(winner);
  }

  if (view.finalVotes) {
    const heading = document.createElement('h3');
    heading.className = 'resultpanel__heading';
    heading.textContent = t(view.lang, 'results.votes');
    panel.append(heading);

    const ballots = document.createElement('div');
    ballots.className = 'results__votes';
    for (const [voterKey, target] of Object.entries(view.finalVotes)) {
      const voter = Number(voterKey) as SeatIndex;
      const row = document.createElement('p');
      row.className = 'results__vote';
      row.textContent = voteText(view, voter, target);
      ballots.append(row);
    }
    panel.append(ballots);

    const tally = Object.entries(view.finalTally ?? {})
      .filter(([, count]) => count > 0)
      .map(([seat, count]) => `${seatName(view, Number(seat) as SeatIndex)} ${count}`)
      .join(' · ');
    const tallyLine = document.createElement('p');
    tallyLine.className = 'resultpanel__tally';
    tallyLine.textContent = tally
      ? t(view.lang, 'results.tally', { tally })
      : t(view.lang, 'results.tally.empty');
    panel.append(tallyLine);
  }

  const rolesHeading = document.createElement('h3');
  rolesHeading.className = 'resultpanel__heading';
  rolesHeading.textContent = t(view.lang, 'results.finalCards');
  panel.append(rolesHeading);

  const roles = document.createElement('div');
  roles.className = 'results__seats';
  for (const [seatKey, role] of Object.entries(view.finalRoles)) {
    const seat = Number(seatKey) as SeatIndex;
    const row = document.createElement('p');
    row.className = 'results__row';
    if (seat === view.ownSeat) row.classList.add('results__row--own');
    if (view.eliminatedSeats?.includes(seat)) row.classList.add('results__row--eliminated');
    const status = view.eliminatedSeats?.includes(seat)
      ? ` · ${t(view.lang, 'results.eliminatedMark')}`
      : '';
    const won = view.winningTeams
      ? ` · ${t(view.lang, view.winningTeams.includes(teamOf(role))
        ? 'results.playerWon'
        : 'results.playerLost')}`
      : '';
    row.textContent = `${seatName(view, seat)}: ${roleName(view.lang, role)}${status}${won}`;
    roles.append(row);
  }
  panel.append(roles);

  if (view.onNextRound) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn--primary resultpanel__next';
    next.textContent = t(view.lang, 'results.nextRound');
    next.addEventListener('click', view.onNextRound);
    panel.append(next);
  }

  return panel;
}
