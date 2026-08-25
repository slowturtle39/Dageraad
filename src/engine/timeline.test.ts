import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, TWO_ROUND_CONFIG,
  createNightState, defaultNightOrder, resolveNight,
} from './index.js';
import { DEFAULT_DURATIONS, buildTimeline, revealGateStep } from './timeline.js';
import {
  DEFAULT_CALIBRATION, applyCalibration, calibrate, cleanSamples, percentile,
  type LatencySample,
} from './telemetry.js';
import type { RoleId } from './types.js';

const s = (ms: number) => ms / 1000;

describe('reveal gates', () => {
  const order = defaultNightOrder(DEFAULT_ACTIVE_ROLES);

  it('the Droomwolf is gated on nothing and sees the wolves immediately', () => {
    expect(revealGateStep('droomwolf', order)).toBe(0);
  });

  it('the Mystieke Wolf is gated on the Alpha Wolf alone', () => {
    // Alpha Wolf is step 2; nothing else before her mutates anything.
    expect(revealGateStep('mystiekewolf', order)).toBe(2);
  });

  it("a role's own mutation does not gate its own reveal", () => {
    // The Heks views the table as it stands when her turn arrives, so her gate
    // is the Dubbelganger before her (step 4), not her own swap (step 5).
    expect(revealGateStep('heks', order)).toBe(4);
  });

  it('the Leerlingziener waits for the Heks, and the Medium for the Dorpsgek', () => {
    expect(revealGateStep('leerlingziener', order)).toBe(5); // heks
    expect(revealGateStep('medium', order)).toBe(7);         // dorpsgek
  });
});

describe('mode 1 timeline (dependency)', () => {
  const t = buildTimeline(DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG);

  it('gives a window to each of the three live follow-up roles', () => {
    expect(t.phases.map((p) => p.role)).toEqual([
      null, 'dubbelganger', 'heks', 'medium',
    ]);
  });

  it('has the Mystieke Wolf finished within about nine seconds', () => {
    expect(s(t.revealAtMs['mystiekewolf']!)).toBe(9);
    expect(s(t.revealAtMs['droomwolf']!)).toBe(9);
  });

  it('staggers the later reveals rather than dumping them at the end', () => {
    expect(s(t.revealAtMs['heks']!)).toBe(22);
    expect(s(t.revealAtMs['leerlingziener']!)).toBe(33);
    expect(s(t.revealAtMs['medium']!)).toBe(33);
    // Nobody waits for the whole night just to learn their own result.
    expect(t.revealAtMs['mystiekewolf']!).toBeLessThan(t.totalMs);
  });

  it('runs about forty seconds', () => {
    expect(s(t.totalMs)).toBe(40);
  });
});

describe('mode 2 timeline (tworound)', () => {
  const t = buildTimeline(DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG);

  it('collapses the Heks and Medium windows, leaving only the Dubbelganger', () => {
    expect(t.phases.map((p) => p.role)).toEqual([null, 'dubbelganger']);
  });

  it('releases every gated reveal once round 2 closes', () => {
    // §5.1: "Heks, Leerlingziener, Dorpsgek and Medium all get revealed
    // together once round 2 closes."
    for (const role of ['heks', 'leerlingziener', 'dorpsgek', 'medium'] as RoleId[]) {
      expect(s(t.revealAtMs[role]!)).toBe(22);
    }
    // The Mystieke Wolf still doesn't wait for round 2 — she never depended on it.
    expect(s(t.revealAtMs['mystiekewolf']!)).toBe(9);
  });

  it('runs roughly half as long as mode 1', () => {
    const mode1 = buildTimeline(DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG);
    expect(s(t.totalMs)).toBe(22);
    expect(t.totalMs).toBeLessThan(mode1.totalMs * 0.6);
  });
});

/* ------------------------------------------------------------------ */
/* THE LEAK AUDIT                                                      */
/* ------------------------------------------------------------------ */

describe('anti-leak invariant: timing never depends on the deal', () => {
  const active = DEFAULT_ACTIVE_ROLES;
  const order = defaultNightOrder(active);

  /** Same active roles; the hidden assignment differs wildly between these. */
  function dealVariant(seatRoles: RoleId[], centerRoles: RoleId[]) {
    return createNightState({
      seatCount: seatRoles.length,
      seatRoles,
      centerRoles,
      alphaWolfCardRole: 'weerwolf',
    });
  }

  it('is identical whether the Alpha Wolf is dealt to a player or sits in the centre', () => {
    // This is THE case the padding exists for. If nobody plays the Alpha Wolf,
    // a naive implementation resolves that step instantly and the short wait
    // tells the Mystieke Wolf exactly where the card is.
    const dealtToPlayer = dealVariant(
      ['alphawolf', 'mystiekewolf', 'dubbelganger', 'heks', 'dorpsgek', 'medium'],
      ['droomwolf', 'leerlingziener', 'dorpeling'],
    );
    const sittingInCentre = dealVariant(
      ['droomwolf', 'mystiekewolf', 'dubbelganger', 'heks', 'dorpsgek', 'medium'],
      ['alphawolf', 'leerlingziener', 'dorpeling'],
    );

    const a = buildTimeline(active, DEPENDENCY_CONFIG);
    const b = buildTimeline(active, DEPENDENCY_CONFIG);
    expect(b).toEqual(a);

    // And resolving with either deal must not perturb the timeline afterwards.
    for (const state of [dealtToPlayer, sittingInCentre]) {
      resolveNight(state, order, DEPENDENCY_CONFIG, () => ({ kind: 'none' }));
      expect(buildTimeline(active, DEPENDENCY_CONFIG)).toEqual(a);
    }
  });

  it('is identical across many random deals of the same active role set', () => {
    const baseline = buildTimeline(active, DEPENDENCY_CONFIG);
    const pool: RoleId[] = [...active, 'dorpeling', 'looier', 'weerwolf'];

    for (let trial = 0; trial < 200; trial++) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const state = dealVariant(shuffled.slice(0, 8), shuffled.slice(8, 11));
      resolveNight(state, order, DEPENDENCY_CONFIG, () => ({ kind: 'none' }));
      // The timeline is a function of the PUBLIC role set only.
      expect(buildTimeline(active, DEPENDENCY_CONFIG)).toEqual(baseline);
    }
  });

  it('depends only on the active role set, not on the order it was listed in', () => {
    const a = buildTimeline(active, DEPENDENCY_CONFIG);
    const b = buildTimeline([...active].reverse(), DEPENDENCY_CONFIG);
    expect(b).toEqual(a);
  });

  it('changes when the PUBLIC role set changes — which is fine, everyone sees that', () => {
    const withSchildwacht = buildTimeline(
      [...active, 'schildwacht'], DEPENDENCY_CONFIG,
    );
    expect(withSchildwacht.revealAtMs['schildwacht']).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

describe('latency calibration', () => {
  const sample = (over: Partial<LatencySample> = {}): LatencySample => ({
    role: 'dubbelganger',
    key: 'doppel-view',
    latencyMs: 5_000,
    outcome: 'submitted',
    paused: false,
    sessionId: 'x',
    ...over,
  });

  it('computes percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([10], 90)).toBe(10);
  });

  it('discards paused windows and timed-out samples', () => {
    const all = [
      sample(),
      sample({ paused: true, latencyMs: 90_000 }),   // toilet break
      sample({ outcome: 'timed-out', latencyMs: 12_000 }),
    ];
    expect(cleanSamples(all)).toHaveLength(1);
  });

  it('one outlier does not drag the window out, because it calibrates on p90', () => {
    const samples = [
      ...Array.from({ length: 19 }, () => sample({ latencyMs: 5_000 })),
      sample({ latencyMs: 40_000 }), // one very slow player
    ];
    const [report] = calibrate(samples, DEFAULT_DURATIONS);
    // Mean would be ~6.75s and rising; p90 stays anchored near the typical tap.
    expect(report!.suggestedMs).toBeLessThan(12_000);
    expect(report!.applied).toBe(true);
  });

  it('refuses to move a window on too few clean samples', () => {
    const [report] = calibrate([sample(), sample()], DEFAULT_DURATIONS);
    expect(report!.applied).toBe(false);
    expect(report!.suggestedMs).toBe(report!.currentMs);
  });

  it('surfaces a timed-out rate, the signal that a window is too short', () => {
    const samples = [
      ...Array.from({ length: 5 }, () => sample()),
      ...Array.from({ length: 5 }, () => sample({ outcome: 'timed-out' })),
    ];
    const [report] = calibrate(samples, DEFAULT_DURATIONS);
    expect(report!.timedOutRate).toBe(0.5);
  });

  it('respects the floor and ceiling', () => {
    const fast = Array.from({ length: 20 }, () => sample({ latencyMs: 200 }));
    const slow = Array.from({ length: 20 }, () => sample({ latencyMs: 300_000 }));
    expect(calibrate(fast, DEFAULT_DURATIONS)[0]!.suggestedMs)
      .toBe(DEFAULT_CALIBRATION.floorMs);
    expect(calibrate(slow, DEFAULT_DURATIONS)[0]!.suggestedMs)
      .toBe(DEFAULT_CALIBRATION.ceilingMs);
  });

  it('calibration keeps durations public and per-role, so the timeline stays sound', () => {
    const samples = Array.from({ length: 20 }, () => sample({ latencyMs: 3_000 }));
    const tuned = applyCalibration(
      DEFAULT_DURATIONS, calibrate(samples, DEFAULT_DURATIONS),
    );
    const t = buildTimeline(DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, tuned);
    // Faster group, shorter night — but still a fixed timeline for everyone.
    expect(t.totalMs).toBeLessThan(
      buildTimeline(DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG).totalMs,
    );
    expect(buildTimeline(DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, tuned)).toEqual(t);
  });
});
