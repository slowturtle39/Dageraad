// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderLobby, seatingIsValid, swapSeats, type LobbyPlayer } from './lobby.js';

const players: LobbyPlayer[] = [
  { uid: 'a', displayName: 'Milan', seatIndex: 0 },
  { uid: 'b', displayName: 'Sanne', seatIndex: 1 },
  { uid: 'c', displayName: 'Joris', seatIndex: 2 },
];

describe('seating arrangement (§13)', () => {
  it('swaps two seats and leaves everyone else alone', () => {
    const after = swapSeats(players, 0, 2);
    expect(after.find((p) => p.uid === 'a')!.seatIndex).toBe(2);
    expect(after.find((p) => p.uid === 'c')!.seatIndex).toBe(0);
    expect(after.find((p) => p.uid === 'b')!.seatIndex).toBe(1);
  });

  it('is its own undo', () => {
    expect(swapSeats(swapSeats(players, 0, 2), 0, 2)).toEqual(players);
  });

  it('requires a contiguous ring with no gaps', () => {
    // A hole in the seating means the Dorpsgek's rotation has a hole in it.
    expect(seatingIsValid(players)).toBe(true);
    expect(seatingIsValid([
      { uid: 'a', displayName: 'A', seatIndex: 0 },
      { uid: 'b', displayName: 'B', seatIndex: 2 },
    ])).toBe(false);
  });

  it('rejects duplicate seats', () => {
    expect(seatingIsValid([
      { uid: 'a', displayName: 'A', seatIndex: 0 },
      { uid: 'b', displayName: 'B', seatIndex: 0 },
    ])).toBe(false);
  });
});

it('translates the live lobby, not just the setup screen', () => {
  const el = renderLobby({
    lang: 'en', players, canArrange: true, pendingSwap: null, canStart: true,
  });
  expect(el.textContent).toContain('Start game (3 players)');
  expect(el.textContent).toContain('Village Idiot');
});

describe('the AI roster', () => {
  const mixed: LobbyPlayer[] = [
    { uid: 'a', displayName: 'Milan', seatIndex: 0 },
    { uid: 'bot-1', displayName: 'AI Bram', seatIndex: 1, isBot: true },
    { uid: 'bot-2', displayName: 'AI Fleur', seatIndex: 2, isBot: true },
  ];

  function lobby(over: Partial<Parameters<typeof renderLobby>[0]> = {}) {
    return renderLobby({
      lang: 'nl', players: mixed, canArrange: true, pendingSwap: null,
      canStart: true, canManageBots: true, ...over,
    });
  }

  it('labels a bot on its own seat, not only in a list somewhere', () => {
    // The label has to be where the name is: this is what somebody reads
    // while deciding whether to believe what that seat just said.
    const el = lobby();
    const seats = Array.from(el.querySelectorAll('.seat'));
    expect(seats.filter((s) => (s as HTMLElement).dataset.bot === 'true')).toHaveLength(2);
    expect(el.textContent).toContain('AI Bram');
  });

  it('adds one at a time, never a fixed table of seven', () => {
    const added: number[] = [];
    const el = lobby({ onAddBot: () => added.push(1) });
    const add = el.querySelector<HTMLButtonElement>('[data-add-bot]')!;
    add.click();
    add.click();
    // Two taps, two bots. The path this replaces could only ever produce
    // exactly seven, which is why a mixed table was impossible.
    expect(added).toHaveLength(2);
  });

  it('removes exactly the bot whose button was pressed', () => {
    const removed: string[] = [];
    const el = lobby({ onRemoveBot: (uid) => removed.push(uid) });
    el.querySelector<HTMLButtonElement>('[data-remove-bot="bot-2"]')!.click();
    expect(removed).toEqual(['bot-2']);
  });

  it('offers no remove button for a human', () => {
    const el = lobby();
    expect(el.querySelector('[data-remove-bot="a"]')).toBeNull();
  });

  it('stops at twelve, the same as for people', () => {
    const full: LobbyPlayer[] = Array.from({ length: 12 }, (_, i) => ({
      uid: `bot-${i}`, displayName: `AI ${i}`, seatIndex: i, isBot: true,
    }));
    const el = lobby({ players: full });
    expect(el.querySelector<HTMLButtonElement>('[data-add-bot]')!.disabled).toBe(true);
  });

  it('shows no roster at all on a browser that may not manage it', () => {
    // Everybody else still SEES the bots on the ring, labelled. What they do
    // not get is a control whose tap the rules would refuse.
    const el = lobby({ canManageBots: false });
    expect(el.querySelector('[data-bots]')).toBeNull();
    expect(el.querySelector('[data-add-bot]')).toBeNull();
    const seats = Array.from(el.querySelectorAll('.seat'));
    expect(seats.filter((s) => (s as HTMLElement).dataset.bot === 'true')).toHaveLength(2);
  });

  it('says out loud that a practice game never counts', () => {
    expect(lobby().textContent).toContain('telt nooit mee');
  });
});
