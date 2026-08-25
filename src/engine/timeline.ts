import { defaultNightOrder, roleDef } from './roles.js';
import { liveFollowupRoles } from './resolve.js';
import type { GameConfig, RoleId } from './types.js';

/**
 * THE FIXED NIGHT TIMELINE.
 *
 * Everything here is computed from the ACTIVE ROLE SET alone, which is public.
 * Nothing may read the deal, who holds what, where a card ended up, or what
 * anyone chose. Two games with the same active roles must produce a byte-for-byte
 * identical timeline. `timeline.leak.test.ts` enforces this.
 *
 * Why it matters: the active role *set* is public — everyone knows whether the
 * Alpha Wolf is in this game. What is secret is whether her card was dealt to a
 * player or is sitting in the centre. If nobody is playing her, a naive
 * implementation resolves that step instantly, and the short wait tells the
 * Mystieke Wolf exactly where the card is.
 *
 * A fixed-length window IS the padding. No time is added, because the window is
 * needed anyway; a window whose role turned out to be in the centre simply
 * passes with nobody tapping and looks identical from outside.
 */

export interface Durations {
  /** Round 1: everyone reads their role and makes their first tap, in parallel. */
  openWindowMs: number;
  /** Pad after a phase closes, before dependent reveals are released. */
  resolvePadMs: number;
  /** Second-decision window per role. Falls back to defaultFollowupMs. */
  followupMs: Partial<Record<RoleId, number>>;
  defaultFollowupMs: number;
}

/**
 * Starting values, deliberately short — these are one-tap actions. The Alpha
 * Wolf in particular only picks a player; the card is always the centre wolf
 * card, so there is nothing else to choose.
 *
 * These are STARTING ESTIMATES. They self-calibrate from measured submission
 * latency (see telemetry.ts), but must always remain public per-role constants
 * frozen at room creation — never per-player, never adapted mid-night.
 */
export const DEFAULT_DURATIONS: Durations = {
  openWindowMs: 8_000,
  resolvePadMs: 1_000,
  followupMs: {
    dubbelganger: 12_000, // see what you copied, then act as it
    heks: 10_000,         // see the centre card, then pick a target
    medium: 6_000,        // Looier swap: yes/no
  },
  defaultFollowupMs: 10_000,
};

export interface TimelinePhase {
  index: number;
  kind: 'open' | 'followup';
  /** Whose decision this window is for. Empty for the open window (everyone). */
  role: RoleId | null;
  startMs: number;
  endMs: number;
  /** When reveals gated on this phase are released. */
  revealAtMs: number;
}

export interface Timeline {
  phases: TimelinePhase[];
  /** role -> ms at which that role's own reveal is released. */
  revealAtMs: Record<string, number>;
  totalMs: number;
}

/**
 * Roles that can MUTATE card ownership. Deliberately coarse: this asks whether a
 * role *could* have moved a card, never whether it actually did. A centre card
 * looks static, but the Dubbelganger may have copied the Alpha Wolf or the Heks
 * and touched it — so the possibility alone forces the wait, even in a game
 * where nothing moved. Narrowing this by inspecting what actually happened would
 * reintroduce exactly the leak the padding exists to prevent.
 */
const MUTATORS: ReadonlySet<RoleId> = new Set<RoleId>([
  'alphawolf', 'heks', 'dorpsgek', 'onrustoker', 'dronkaard', 'dubbelganger', 'medium',
]);

/**
 * The night-order step whose resolution a role's own reveal must wait for.
 *
 * Strictly BEFORE the role's own step: a role views the table as it stands when
 * its turn arrives, so its own mutation does not gate its own reveal. 0 means
 * nothing gates it and the reveal can land immediately (the Droomwolf).
 */
export function revealGateStep(role: RoleId, order: RoleId[]): number {
  const own = order.indexOf(role) + 1;
  if (own === 0) return 0;
  let gate = 0;
  order.forEach((r, i) => {
    const step = i + 1;
    if (step < own && MUTATORS.has(r)) gate = Math.max(gate, step);
  });
  return gate;
}

/**
 * Build the fixed timeline for an active role set.
 *
 * Structure: one open window where everybody taps in parallel, then one window
 * per role that genuinely needs a live follow-up decision, in canonical order.
 * Each role's reveal is released at the end of the last phase its gate depends
 * on — NOT at the end of the night. That is what keeps the night short: nothing
 * before the Mystieke Wolf mutates anything except the Alpha Wolf, so she has
 * her card seconds in and is finished.
 */
export function buildTimeline(
  activeRoles: RoleId[],
  config: GameConfig,
  durations: Durations = DEFAULT_DURATIONS,
): Timeline {
  const order = defaultNightOrder(activeRoles);

  // Live follow-ups, in canonical order. In 'tworound' mode the Heks and the
  // Medium pre-commit, so only the Dubbelganger remains — which is exactly why
  // that mode is two rounds and roughly half the wall-clock time.
  const followups = order.filter((r) => liveFollowupRoles([r], config).length > 0);
  const followupSteps = followups.map((r) => order.indexOf(r) + 1);

  const phases: TimelinePhase[] = [];
  let cursor = 0;

  const open: TimelinePhase = {
    index: 0,
    kind: 'open',
    role: null,
    startMs: 0,
    endMs: durations.openWindowMs,
    revealAtMs: durations.openWindowMs + durations.resolvePadMs,
  };
  phases.push(open);
  cursor = open.revealAtMs;

  followups.forEach((role, i) => {
    const dur = durations.followupMs[role] ?? durations.defaultFollowupMs;
    const phase: TimelinePhase = {
      index: i + 1,
      kind: 'followup',
      role,
      startMs: cursor,
      endMs: cursor + dur,
      revealAtMs: cursor + dur + durations.resolvePadMs,
    };
    phases.push(phase);
    cursor = phase.revealAtMs;
  });

  // A role's wave is the number of live follow-ups that must close before its
  // gate can have resolved.
  const revealAtMs: Record<string, number> = {};
  for (const role of order) {
    if (!roleDef(role).hasNightAction) continue;
    const gate = revealGateStep(role, order);
    const wave = followupSteps.filter((s) => s <= gate).length;
    revealAtMs[role] = phases[wave]!.revealAtMs;
  }

  return { phases, revealAtMs, totalMs: cursor };
}

/** Human-readable timeline, for the docs and for sanity-checking a role set. */
export function describeTimeline(t: Timeline): string {
  const lines = t.phases.map((p) => {
    const who = p.role ?? 'everyone taps';
    return `  ${(p.startMs / 1000).toFixed(0)}s→${(p.endMs / 1000).toFixed(0)}s  ${who}`
      + `  (reveals at ${(p.revealAtMs / 1000).toFixed(0)}s)`;
  });
  const reveals = Object.entries(t.revealAtMs)
    .sort((a, b) => a[1] - b[1])
    .map(([role, ms]) => `  ${(ms / 1000).toFixed(0)}s  ${role}`);
  return [
    `total ${(t.totalMs / 1000).toFixed(0)}s`,
    'phases:', ...lines,
    'reveals:', ...reveals,
  ].join('\n');
}
