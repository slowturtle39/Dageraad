import { describe, expect, it } from 'vitest';
import type { ConfirmedAction, PrivateInfo } from '../engine/types.js';
import { describeReveal } from './sheet.js';

const name = (seat: number) => ['Milan', 'Sanne', 'Joris'][seat] ?? `seat ${seat}`;
const role = (id: string) => id === 'ziener' ? 'Seer' : id === 'looier' ? 'Tanner' : id;

const actions: ConfirmedAction[] = [
  { kind: 'shielded', seat: 1 },
  { kind: 'alpha-placed', seat: 1 },
  { kind: 'judged', seat: 1 },
  { kind: 'heks-swapped', centerIndex: 0, seat: 1 },
  { kind: 'players-swapped', seats: [1, 2] },
  { kind: 'drank', centerIndex: 2 },
  { kind: 'shifted', count: 6, direction: 'left' },
  { kind: 'shifted', count: 6, direction: 'right' },
  { kind: 'took-looier', seat: 1 },
];

describe('private night results', () => {
  it('renders every information shape in both languages', () => {
    const info: PrivateInfo[] = [
      { kind: 'saw-card', step: 1, slot: 1, role: 'ziener' },
      { kind: 'saw-center', step: 1, centerIndex: 0, role: 'ziener' },
      { kind: 'saw-wolves', step: 1, seats: [1] },
      { kind: 'saw-wolves', step: 1, seats: [] },
      { kind: 'saw-masons', step: 1, seats: [1] },
      { kind: 'saw-masons', step: 1, seats: [] },
      { kind: 'copied-role', step: 1, fromSeat: 1, role: 'ziener' },
      { kind: 'judged', step: 1 },
      { kind: 'card-locked', step: 1 },
      { kind: 'own-final-card', step: 1, role: 'ziener' },
      { kind: 'became-role', step: 1, role: 'looier' },
      { kind: 'action-blocked', step: 1, reason: 'shielded' },
      { kind: 'action-blocked', step: 1, reason: 'no-legal-target' },
      { kind: 'no-action', step: 1 },
      ...actions.map((action): PrivateInfo => ({ kind: 'action-confirmed', step: 1, action })),
    ];

    for (const item of info) {
      expect(describeReveal('nl', item, name, role), item.kind).not.toBe('');
      expect(describeReveal('en', item, name, role), item.kind).not.toBe('');
    }
  });

  it('actually changes language instead of leaving Dutch receipts behind', () => {
    const item: PrivateInfo = { kind: 'saw-card', step: 1, slot: 1, role: 'ziener' };
    expect(describeReveal('nl', item, name, role)).toBe('Bij jouw beurt had Sanne de Seer.');
    expect(describeReveal('en', item, name, role)).toBe('At your turn, Sanne held the Seer.');
  });

  it('renders old stored confirmations safely after an app update', () => {
    const old = { kind: 'action-confirmed', step: 1, detail: 'old-debug-text' };
    expect(describeReveal('en', old, name, role)).toBe('Your action was completed.');
  });
});
