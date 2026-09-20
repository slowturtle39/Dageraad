import { teamOf } from '../engine/roles.js';
import type { PrivateInfo, RoleId, SeatIndex, Team } from '../engine/types.js';
import type { DiscardReason } from '../engine/dayphase.js';
import { roleName, t, type Lang } from './i18n.js';
import { describeReveal } from './sheet.js';

export interface ResultsView {
  lang: Lang;
  outcome: string;
  finalRoles: Record<SeatIndex, RoleId>;
  originalRoles?: Record<SeatIndex, RoleId>;
  names: Record<SeatIndex, string>;
  ownSeat: SeatIndex | null;
  eliminatedSeats?: SeatIndex[];
  winningTeams?: Team[];
  finalVotes?: Record<SeatIndex, SeatIndex | null>;
  discardedVotes?: Partial<Record<SeatIndex, DiscardReason>>;
  finalTally?: Record<SeatIndex, number>;
  finalCenterRoles?: RoleId[];
  nightInfo?: Record<SeatIndex, PrivateInfo[]>;
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
  if (view.winningTeams?.length === 0) return t(view.lang, 'results.everyoneLost');
  if (view.eliminatedSeats.length === 0) return t(view.lang, 'results.noneEliminated');
  if (view.eliminatedSeats.length === 1) {
    return t(view.lang, 'results.oneEliminated', { who: names });
  }
  return t(view.lang, 'results.tieEliminated', { who: names });
}

function winnersText(view: ResultsView): string | null {
  const { lang, winningTeams: teams } = view;
  if (!teams) return null;
  if (teams.length === 0) return t(lang, 'results.winner.none');
  if (teams.length === 1) {
    if (teams[0] === 'wolf') {
      const winners = Object.entries(view.finalRoles)
        .filter(([, role]) => teamOf(role) === 'wolf')
        .map(([seat, role]) =>
          `${seatName(view, Number(seat) as SeatIndex)} (${roleName(lang, role)})`);
      if (winners.length > 0) {
        return t(lang, 'results.winner.wolvesNamed', { who: winners.join(', ') });
      }
    }
    return t(lang, `results.winner.${teams[0]}`);
  }
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

  const winners = winnersText(view);
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
    const original = view.originalRoles?.[seat];
    const roleText = original
      ? t(view.lang, 'results.roleJourney', {
          original: roleName(view.lang, original), final: roleName(view.lang, role),
        })
      : roleName(view.lang, role);
    row.textContent = `${seatName(view, seat)}: ${roleText}${status}${won}`;
    roles.append(row);
  }
  panel.append(roles);

  if (view.finalCenterRoles?.length) {
    const centerHeading = document.createElement('h3');
    centerHeading.className = 'resultpanel__heading';
    centerHeading.textContent = t(view.lang, 'results.centerCards');
    panel.append(centerHeading);
    const centers = document.createElement('div');
    centers.className = 'results__seats';
    view.finalCenterRoles.forEach((role, index) => {
      const row = document.createElement('p');
      row.className = 'results__row';
      row.textContent = `${index + 1}: ${roleName(view.lang, role)}`;
      centers.append(row);
    });
    panel.append(centers);
  }

  const nightEntries = Object.entries(view.nightInfo ?? {})
    .flatMap(([seat, info]) => info.map((item, order) => ({
      seat: Number(seat) as SeatIndex, item, order,
    })))
    .sort((a, b) => a.item.step - b.item.step || a.order - b.order || a.seat - b.seat);
  if (nightEntries.length > 0) {
    const nightHeading = document.createElement('h3');
    nightHeading.className = 'resultpanel__heading';
    nightHeading.textContent = t(view.lang, 'results.nightLog');
    panel.append(nightHeading);
    const log = document.createElement('div');
    log.className = 'results__votes';
    for (const { seat, item } of nightEntries) {
      const row = document.createElement('p');
      row.className = 'results__vote';
      row.textContent = `${seatName(view, seat)}: ${describeReveal(
        view.lang,
        item,
        (target) => seatName(view, target as SeatIndex),
        (role) => roleName(view.lang, role as RoleId),
      )}`;
      log.append(row);
    }
    panel.append(log);
  }

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
