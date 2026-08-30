// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  choiceFor, nextPendingRequest, renderPrompt, seatSelectable, toggleCenterPick,
  type PromptView,
} from './prompt.js';
import type { Choice, DecisionRequest, Prompt, SeatIndex } from '../engine/types.js';

/**
 * The question one seat is being asked.
 *
 * The prompt is this device's own, published by the referee into this device's
 * own private document, so nothing here can leak. What it can do is refuse to
 * send an answer the engine cannot use, or send one the player did not mean.
 */

function request(prompt: Prompt, over: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    seat: 0 as SeatIndex, actingAs: 'ziener', step: 1, key: 'k',
    prompt, dependsOnReveal: false, ...over,
  };
}

function view(prompt: Prompt, over: Partial<PromptView> = {}): PromptView {
  return {
    lang: 'nl',
    request: request(prompt),
    names: { 0: 'Milan', 1: 'Sanne', 2: 'Joris' } as Record<SeatIndex, string>,
    ownSeat: 0 as SeatIndex,
    picked: [], pickedCenters: [], centerCount: 3,
    onPickSeat: () => {}, onPickCenter: () => {},
    onConfirm: () => {}, onDecline: () => {},
    ...over,
  };
}

// By its marker, not its styling: the direction buttons are primary-looking
// and are not confirms.
const confirm = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-confirm]');

describe('an incomplete answer is never sent', () => {
  it('waits for a seat', () => {
    const v = view({ kind: 'seat', exclude: [], optional: false });
    expect(choiceFor(v)).toBeNull();
    expect(confirm(renderPrompt(v))!.disabled).toBe(true);
  });

  it('waits for BOTH seats of a two-seat swap', () => {
    const p: Prompt = { kind: 'two-seats', exclude: [] };
    expect(choiceFor(view(p, { picked: [1 as SeatIndex] }))).toBeNull();
    expect(choiceFor(view(p, { picked: [1, 2] as SeatIndex[] })))
      .toEqual({ kind: 'seats', seats: [1, 2] });
  });

  it('waits for the right NUMBER of centre cards', () => {
    const p: Prompt = { kind: 'center', count: 2 };
    expect(choiceFor(view(p, { pickedCenters: [0] }))).toBeNull();
    expect(choiceFor(view(p, { pickedCenters: [0, 2] })))
      .toEqual({ kind: 'center', centerIndices: [0, 2] });
  });

  it('lets the Ziener choose either one player or two centre cards', () => {
    const p: Prompt = { kind: 'seat-or-center', exclude: [0], centerCount: 2 };
    expect(choiceFor(view(p, { picked: [1 as SeatIndex] })))
      .toEqual({ kind: 'seat', seat: 1 });
    expect(choiceFor(view(p, { pickedCenters: [0, 2] })))
      .toEqual({ kind: 'center', centerIndices: [0, 2] });
    expect(renderPrompt(view(p)).querySelectorAll('.prompt__center')).toHaveLength(3);
  });
});

describe('centre-card selection', () => {
  it('replaces the old card when exactly one is allowed', () => {
    expect(toggleCenterPick([0], 2, 1)).toEqual([2]);
  });

  it('keeps at most the requested number for a multi-card prompt', () => {
    expect(toggleCenterPick([0, 1], 2, 2)).toEqual([1, 2]);
    expect(toggleCenterPick([0, 2], 2, 2)).toEqual([0]);
  });
});

describe('prompt lifetime', () => {
  const pending = [request({ kind: 'center', count: 1 }, { key: 'heks-center' })];

  it('shows an unanswered request only during the night', () => {
    expect(nextPendingRequest(pending, [], 'night')?.key).toBe('heks-center');
    expect(nextPendingRequest(pending, [], 'day')).toBeUndefined();
  });

  it('moves to the next request after the first is submitted', () => {
    const requests = [
      request({ kind: 'seat', exclude: [], optional: false }, { key: 'heks-precommit-target' }),
      ...pending,
    ];
    expect(nextPendingRequest(requests, ['heks-precommit-target'], 'night')?.key)
      .toBe('heks-center');
  });
});

describe('a seat the engine excluded is not offered', () => {
  it('refuses an excluded seat', () => {
    // The engine excludes for a reason — the Heks may not swap with herself
    // when the house rule says so, the Onrustoker never picks itself. A screen
    // that lets you tap it and then fails is a screen that lied.
    const r = request({ kind: 'seat', exclude: [0 as SeatIndex], optional: false });
    expect(seatSelectable(r, 0 as SeatIndex)).toBe(false);
    expect(seatSelectable(r, 1 as SeatIndex)).toBe(true);
  });

  it('offers nothing for a prompt that is not about seats', () => {
    const r = request({ kind: 'center', count: 1 });
    expect(seatSelectable(r, 1 as SeatIndex)).toBe(false);
  });

  it('offers legal player targets alongside centre cards to the Ziener', () => {
    const r = request({ kind: 'seat-or-center', exclude: [0 as SeatIndex], centerCount: 2 });
    expect(seatSelectable(r, 0 as SeatIndex)).toBe(false);
    expect(seatSelectable(r, 1 as SeatIndex)).toBe(true);
  });
});

describe('declining', () => {
  it('is always offered, because it is a real answer', () => {
    // A window that closes on somebody who meant to do nothing has to record
    // that, or their seat never settles and they receive no reveals at all.
    let declined = false;
    const el = renderPrompt(view(
      { kind: 'seat', exclude: [], optional: false },
      { onDecline: () => { declined = true; } },
    ));
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.btn'));
    buttons[buttons.length - 1]!.click();
    expect(declined).toBe(true);
  });
});

describe('the two-round Heks prompt', () => {
  it('explains that the exchange partner is chosen before the centre card', () => {
    const el = renderPrompt(view(
      { kind: 'seat', exclude: [], optional: false },
      { request: request({ kind: 'seat', exclude: [], optional: false }, { key: 'heks-precommit-target' }) },
    ));
    expect(el.textContent).toContain('Kies nu alvast met wie je de kaart ruilt');
  });
});

describe('the Dorpsgek picks a direction and nobody else learns it', () => {
  const p: Prompt = { kind: 'dorpsgek', variant: 'standard' };

  it('offers both directions as their own buttons', () => {
    const el = renderPrompt(view(p));
    const dirs = Array.from(el.querySelectorAll<HTMLElement>('[data-direction]'))
      .map((b) => b.dataset.direction);
    expect(dirs).toEqual(['left', 'right']);
  });

  it('sends the direction it was tapped with', () => {
    let sent: Choice | null = null;
    const el = renderPrompt(view(p, { onConfirm: (c) => { sent = c; } }));
    el.querySelector<HTMLButtonElement>('[data-direction="right"]')!.click();
    expect(sent).toEqual({ kind: 'dorpsgek', direction: 'right' });
  });

  it('carries a locked seat only in the designate variant', () => {
    let sent: Choice | null = null;
    const standard = renderPrompt(view(p, {
      picked: [2 as SeatIndex], onConfirm: (c) => { sent = c; },
    }));
    standard.querySelector<HTMLButtonElement>('[data-direction="left"]')!.click();
    expect(sent).toEqual({ kind: 'dorpsgek', direction: 'left' });

    const designate = renderPrompt(view(
      { kind: 'dorpsgek', variant: 'designate' },
      { picked: [2 as SeatIndex], onConfirm: (c) => { sent = c; } },
    ));
    designate.querySelector<HTMLButtonElement>('[data-direction="left"]')!.click();
    expect(sent).toEqual({ kind: 'dorpsgek', direction: 'left', designatedSeat: 2 });
  });

  it('has no confirm button — the direction IS the answer', () => {
    expect(confirm(renderPrompt(view(p)))).toBeNull();
  });
});
