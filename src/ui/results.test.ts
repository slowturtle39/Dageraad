// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderResults } from './results.js';

describe('the public result panel', () => {
  it('explains a tie, every ballot, the tally, deaths, winners, and final cards', () => {
    const panel = renderResults({
      lang: 'nl',
      outcome: 'tie',
      ownSeat: 0,
      names: {
        0: 'Speler', 1: 'AI Bram', 2: 'AI Fleur', 3: 'AI Joris', 4: 'AI Noor',
      },
      finalRoles: {
        0: 'leerlingziener', 1: 'alphawolf', 2: 'medium', 3: 'dorpsgek', 4: 'heks',
      },
      originalRoles: {
        0: 'leerlingziener', 1: 'dubbelganger', 2: 'medium', 3: 'dorpsgek', 4: 'heks',
      },
      finalVotes: { 0: 1, 1: 2, 2: 1, 3: 2, 4: 0 },
      discardedVotes: {},
      finalTally: { 0: 1, 1: 2, 2: 2, 3: 0, 4: 0 },
      eliminatedSeats: [1, 2],
      winningTeams: ['wolf'],
    });

    expect(panel.textContent).toContain('Gelijkspel: AI Bram, AI Fleur zijn gelyncht.');
    expect(panel.textContent).toContain('De wolven winnen: AI Bram (Alfawolf).');
    expect(panel.textContent).toContain('Speler stemt op AI Bram');
    expect(panel.textContent).toContain('AI Bram stemt op AI Fleur');
    expect(panel.textContent).toContain('Eindtelling: Speler 1 · AI Bram 2 · AI Fleur 2');
    expect(panel.textContent).toContain(
      'AI Bram: begon als Dubbelganger · eindigde als Alfawolf · gelyncht · gewonnen',
    );
    expect(panel.textContent).toContain(
      'AI Fleur: begon als Medium · eindigde als Medium · gelyncht · verloren',
    );
  });

  it('shows one lynched player in the singular', () => {
    const panel = renderResults({
      lang: 'nl', outcome: 'eliminated', ownSeat: 0,
      names: { 0: 'Milan', 1: 'Noor' },
      finalRoles: { 0: 'dorpeling', 1: 'weerwolf' },
      eliminatedSeats: [1], winningTeams: ['village'],
    });
    expect(panel.textContent).toContain('Noor is gelyncht.');
    expect(panel.textContent).not.toContain('Noor zijn gelyncht.');
  });

  it('shows centre cards and the full night log only on the result panel', () => {
    const panel = renderResults({
      lang: 'nl', outcome: 'eliminated', ownSeat: 0,
      names: { 0: 'Milan', 1: 'Noor' },
      finalRoles: { 0: 'leerlingziener', 1: 'medium' },
      finalCenterRoles: ['jager', 'looier', 'dorpeling'],
      nightInfo: {
        0: [{ kind: 'saw-center', step: 1, centerIndex: 1, role: 'looier' }],
        1: [{ kind: 'saw-card', step: 2, slot: 0, role: 'leerlingziener' }],
      },
    });
    expect(panel.textContent).toContain('Middenkaarten bij zonsopgang');
    expect(panel.textContent).toContain('1: Jager');
    expect(panel.textContent).toContain('2: Looier');
    expect(panel.textContent).toContain('Wat er in de nacht gebeurde');
    expect(panel.textContent).toContain('Milan: Bij jouw beurt lag de Looier op middenkaart 2.');
    expect(panel.textContent).toContain('Noor: Bij jouw beurt had Milan de Leerlingziener.');
  });

  it('orders the public night account chronologically rather than by seat', () => {
    const panel = renderResults({
      lang: 'nl', outcome: 'eliminated', ownSeat: 0,
      names: { 0: 'Laat', 1: 'Vroeg' },
      finalRoles: { 0: 'medium', 1: 'ziener' },
      nightInfo: {
        0: [{ kind: 'no-action', step: 9 }],
        1: [{ kind: 'no-action', step: 2 }],
      },
    });
    const log = Array.from(panel.querySelectorAll('.results__vote')).map((row) => row.textContent);
    expect(log[0]).toMatch(/^Vroeg:/);
    expect(log[1]).toMatch(/^Laat:/);
  });

  it('says everyone loses instead of calling a no-winner result a tie', () => {
    const panel = renderResults({
      lang: 'nl', outcome: 'tie', ownSeat: 0,
      names: { 0: 'A', 1: 'B' },
      finalRoles: { 0: 'dorpeling', 1: 'ziener' },
      eliminatedSeats: [0, 1], winningTeams: [],
    });
    expect(panel.textContent).toContain('Iedereen verliest.');
    expect(panel.textContent).not.toContain('Gelijkspel');
  });

  it('makes the Bodyguard and Tanner exceptions visible', () => {
    const panel = renderResults({
      lang: 'nl', outcome: 'eliminated', ownSeat: 0,
      names: { 0: 'Wacht', 1: 'Looier', 2: 'Wolf' },
      finalRoles: { 0: 'bodyguard', 1: 'looier', 2: 'weerwolf' },
      finalVotes: { 0: 2, 1: 2, 2: 1 },
      discardedVotes: { 0: 'bodyguard-protects', 1: 'looier', 2: 'protected' },
      finalTally: { 0: 0, 1: 0, 2: 0 },
      eliminatedSeats: [], winningTeams: ['wolf'],
    });

    expect(panel.textContent).toContain('Wacht beschermt Wolf · geen stem');
    expect(panel.textContent).toContain('Looier → Wolf · Looierstem telt niet');
    expect(panel.textContent).toContain('Wolf → Looier · vervalt door bescherming');
    expect(panel.textContent).toContain('Geen enkele stem telde mee.');
  });

  it('does not repeat the old false claim that a tie kills nobody', () => {
    const panel = renderResults({
      lang: 'nl', outcome: 'tie', ownSeat: 0,
      names: { 0: 'A', 1: 'B' },
      finalRoles: { 0: 'dorpeling', 1: 'weerwolf' },
    });

    expect(panel.textContent).toContain('iedereen met de hoogste stemstand is gelyncht');
    expect(panel.textContent).not.toContain('niemand gelyncht');
  });
});
