import type {
  CardId, GameConfig, PrivateInfo, RoleId, SeatIndex, Choice, NightEvent,
} from '../engine/types.js';
import type { Timeline } from '../engine/timeline.js';
import type { VoteOutcome } from '../engine/dayphase.js';

/**
 * Firestore document shapes. These mirror firestore.rules exactly — if you add
 * a field here, check whether a rule needs to know about it, especially in
 * `profiles` (which uses an explicit key allowlist) and `calibration`.
 *
 * Layout:
 *   /rooms/{roomId}                    public room state
 *   /rooms/{roomId}/players/{uid}      public: name, avatar, seat
 *   /rooms/{roomId}/private/{uid}      SECRET: dealt role, card, reveals
 *   /rooms/{roomId}/engine/state       SECRET: the entire deal (referee only)
 *   /rooms/{roomId}/submissions/{uid}  night choices (owner writes, referee reads)
 *   /rooms/{roomId}/votes/{uid}        day votes (hidden until results)
 *   /rooms/{roomId}/results/{uid}      append-only per-game outcome
 *   /profiles/{uid}                    persistent identity (NO stats — see below)
 *   /calibration/{sampleId}            append-only timing samples
 */

/** Room lifecycle. Several rules key off this, so the order matters. */
export type RoomPhase = 'lobby' | 'night' | 'day' | 'voting' | 'results';

export interface RoomDoc {
  /** Created the room. Can advance phase; can NEVER reassign the referee. */
  hostUid: string;
  /**
   * The device that computes resolution — ideally the neutral tablet, since it
   * necessarily holds every player's card (see README "Trust model").
   *
   * IMMUTABLE AFTER CREATION. This is the single most security-critical field
   * in the schema: a player who could write it would promote themselves and
   * read the entire deal.
   */
  refereeUid: string;
  phase: RoomPhase;
  /**
   * Advanced by the referee as each night window closes. A submission is only
   * accepted when its windowIndex matches this, which blocks a late write after
   * seeing a reveal without having to trust any client's clock.
   */
  nightWindowIndex: number;
  /** PUBLIC by design — the host picks these at setup and everyone sees them. */
  activeRoles: RoleId[];
  nightOrder: RoleId[];
  config: GameConfig;
  /** Seat order around the physical table. Frozen once the game starts. */
  seating: string[];
  /**
   * Safe to publish: derived from activeRoles alone, never from the deal
   * (see timeline.ts). Publishing it leaks nothing everyone doesn't have.
   */
  timeline: Timeline;
  /** Spoiler-free events for the shared tablet (§12). */
  publicEvents: NightEvent[];
  shieldedSlots: number[];
  revealedCards: CardId[];
  createdAt: number;
  /** Set while the host has paused for an absent player. Public by design. */
  pausedAt: number | null;
}

export interface PlayerDoc {
  displayName: string;
  avatar: string | null;
  seatIndex: SeatIndex;
  joinedAt: number;
}

/** SECRET. Readable only by its owner and the referee. */
export interface PrivateDoc {
  /** §6.0: fixed at deal time; drives night order and which action you take. */
  originalRole: RoleId;
  /** §6.0: mutable; drives your team and win condition at dawn. */
  currentCard: CardId;
  currentRole: RoleId;
  /**
   * Everything this seat has privately learned, each tagged with the night step
   * at which it was TRUE — the UI must render "at your turn, seat 3 held X",
   * never as a current fact, because the Dorpsgek may have moved it since.
   */
  privateInfo: PrivateInfo[];
  /** Released reveals only. The referee withholds later ones until due. */
  revealedThrough: number;
}

/** SECRET. Referee only. Nothing else in the app may read this. */
export interface EngineStateDoc {
  slots: CardId[];
  cardRole: Record<CardId, RoleId>;
  originalRole: RoleId[];
  shieldedSlots: number[];
  revealedCards: CardId[];
  alphaWolfSlot: number | null;
}

export interface SubmissionDoc {
  /** Must equal the room's current nightWindowIndex or the write is rejected. */
  windowIndex: number;
  /** Keyed by DecisionRequest.key, so one doc can hold a whole window. */
  choices: Record<string, Choice>;
  submittedAt: number;
}

export interface VoteDoc {
  /** null = abstained without naming anyone. Never equal to your own uid (§7). */
  target: string | null;
  abstain: boolean;
  castAt: number;
}

/**
 * Append-only per-game outcome. THESE ARE THE AUTHORITATIVE STATS.
 *
 * There are deliberately no mutable win counters anywhere in this schema.
 * Profile stats are aggregated client-side by reading these documents, which
 * removes "who is allowed to increment my win count" as a question and makes
 * game history tamper-evident. At this group's volume it is a few hundred tiny
 * documents a year.
 */
export interface ResultDoc {
  finalRole: RoleId;
  originalRole: RoleId;
  won: boolean;
  votedFor: string | null;
  /**
   * Full categorical outcome, NOT a boolean. `caused-village-loss` has to stay
   * distinguishable from an ordinary wrong guess — it is the Bodyguard case
   * Milan wants tracked — and once a boolean is written here that distinction
   * is gone for good. `inconsequential` and `not-scored` likewise must not be
   * stored as `false`: a timed-out window is not a wrong answer (§10).
   */
  voteOutcome: VoteOutcome;
  suspicionAccuracy: number | null;
  recordedAt: number;
}

/** Persistent identity. The rules allowlist these keys exactly — no stats here. */
export interface ProfileDoc {
  displayName: string;
  avatar: string | null;
  language: 'nl' | 'en';
  createdAt: number;
  updatedAt: number;
}

/**
 * Append-only timing sample. Keyed by role NAME and never by who was playing
 * it — attaching a uid would turn this collection into a public record of who
 * played what. The rules enforce the key allowlist.
 */
export interface CalibrationDoc {
  role: RoleId;
  key: string;
  latencyMs: number;
  outcome: 'submitted' | 'timed-out';
  paused: boolean;
  sessionId: string;
  createdAt: number;
}

/* ------------------------------ path helpers ------------------------------ */

export const paths = {
  room: (roomId: string) => `rooms/${roomId}`,
  players: (roomId: string) => `rooms/${roomId}/players`,
  player: (roomId: string, uid: string) => `rooms/${roomId}/players/${uid}`,
  private: (roomId: string, uid: string) => `rooms/${roomId}/private/${uid}`,
  engineState: (roomId: string) => `rooms/${roomId}/engine/state`,
  submission: (roomId: string, uid: string) => `rooms/${roomId}/submissions/${uid}`,
  vote: (roomId: string, uid: string) => `rooms/${roomId}/votes/${uid}`,
  results: (roomId: string) => `rooms/${roomId}/results`,
  result: (roomId: string, uid: string) => `rooms/${roomId}/results/${uid}`,
  profile: (uid: string) => `profiles/${uid}`,
  calibration: () => 'calibration',
} as const;
