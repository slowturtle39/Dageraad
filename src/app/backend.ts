import type {
  GameConfig, PrivateInfo, RoleId, SeatIndex, Choice, NightEvent, NightState,
} from '../engine/types.js';
import type { Timeline } from '../engine/timeline.js';
import type { DayStore } from '../orchestration/dayrunner.js';
import type { RoomStore } from '../orchestration/store.js';

/**
 * Everything the app needs from the network, behind one interface.
 *
 * Two implementations: `FirestoreBackend` for real play, and `MemoryBackend`
 * which runs the whole thing in-process. The memory one is not a test double
 * bolted on afterwards — it is what lets a complete night be played in a unit
 * test and in the browser without a Firebase project, which is the only honest
 * way to know the shell works before it ever touches a live database.
 *
 * The referee's own reads and writes keep going through the existing
 * `RoomStore`/`DayStore` interfaces, so `runNight` and `runDay` are untouched.
 */

/** Public room state, readable by anyone with the link. */
export interface RoomView {
  roomId: string;
  hostUid: string;
  /**
   * The device that computes the night. Set at creation and IMMUTABLE — the
   * security rules refuse to let it move, because whoever holds it can read
   * every card in the game.
   *
   * In practice this means: CREATE THE ROOM ON THE TABLET. There is no way to
   * hand the role over afterwards, by design.
   */
  refereeUid: string;
  phase: RoomPhase;
  nightWindowIndex: number;
  activeRoles: RoleId[];
  config: GameConfig;
  timeline: Timeline | null;
  /** Seat order as uids, index = seat. Frozen once the game starts. */
  seating: string[];
  publicEvents: NightEvent[];
  shieldedSeats: SeatIndex[];
  /** seat -> role, only for cards genuinely turned face up in play. */
  revealedSeats: Record<SeatIndex, RoleId>;
  /** Live counts, published by the referee. Never who voted for whom. */
  abstainCount: number;
  votesCast: number;
  pausedAt: number | null;
  /** Set when the 50/50 suspense extension fires (§7). Public on purpose. */
  discussionExtendedByMs: number;
  /** Set when the game is over, so every device can show the same result. */
  finalRoles: Record<SeatIndex, RoleId> | null;
  outcome: string | null;
}

export type RoomPhase = 'lobby' | 'night' | 'day' | 'voting' | 'results';

export interface PlayerView {
  uid: string;
  displayName: string;
  seatIndex: SeatIndex;
}

/** What one device may know about its own seat. Never about anyone else's. */
export interface PrivateView {
  originalRole: RoleId | null;
  privateInfo: PrivateInfo[];
}

export type Unsubscribe = () => void;

export interface CreateRoomOptions {
  displayName: string;
  activeRoles: RoleId[];
  config: GameConfig;
  /**
   * Whether the creating device also takes a seat.
   *
   * A neutral tablet passes false: it is the referee, it holds every card, and
   * it must not be dealt one. Someone's phone hosting a small game passes true
   * and plays like everyone else — with the caveat that the host then knows the
   * whole deal, which the group has to be fine with. Defaults to true because
   * that is the commoner case; the tablet flow is the one that says so.
   */
  playing?: boolean;
}

export interface Backend {
  /** This device's stable id. Every security rule keys off it. */
  readonly uid: string;

  createRoom(options: CreateRoomOptions): Promise<string>;
  joinRoom(roomId: string, displayName: string): Promise<void>;

  /** Host only, lobby only. Order is uids, index = seat. */
  setSeating(roomId: string, seating: string[]): Promise<void>;
  setActiveRoles(roomId: string, roles: RoleId[], config: GameConfig): Promise<void>;

  /**
   * Deal and begin. Referee only — it is the one device allowed to write the
   * private documents, and the only one that ever sees the whole deal.
   */
  startGame(roomId: string, seed: number): Promise<void>;

  watchRoom(roomId: string, cb: (room: RoomView | null) => void): Unsubscribe;
  watchPlayers(roomId: string, cb: (players: PlayerView[]) => void): Unsubscribe;
  watchPrivate(roomId: string, cb: (own: PrivateView) => void): Unsubscribe;

  /** A player writing their own night choices for the current window. */
  submit(roomId: string, windowIndex: number, choices: Record<string, Choice>): Promise<void>;

  /**
   * A player's vote. `target` is a uid, or null for an abstain.
   *
   * Note the security rules accept an abstain during the discussion but a named
   * target only once voting is open (§7) — the group may decide not to vote at
   * any moment, but nobody may lock in a target early.
   */
  vote(roomId: string, target: string | null, abstain: boolean): Promise<void>;

  /** The referee's own view of the room, for runNight/runDay. */
  refereeStore(roomId: string): RoomStore & DayStore;

  /**
   * The referee's copy of the deal.
   *
   * Referee only, and it never leaves that device during play — it is the whole
   * game state, every card and every slot. It is here rather than on RoomStore
   * because the engine never needs to fetch it: the referee already has it.
   */
  refereeNightState(roomId: string): Promise<NightState | null>;

  /**
   * Publish the outcome once the day resolves, so every device shows the same
   * thing. This is the ONE moment roles become public — the game is over.
   *
   * `persist` separates two things that look alike and are not. The room's own
   * result is shown to the table either way, including in test mode — you still
   * want to see who won. The append-only per-player result documents are what
   * profile stats aggregate from, and a test game must never write one: there
   * is no delete path by design, so a bot game would inflate somebody's record
   * permanently (§16).
   */
  publishResults(
    roomId: string,
    finalRoles: Record<SeatIndex, RoleId>,
    outcome: string,
    persist: boolean,
  ): Promise<void>;

  /** Host: pause/resume for an absent player. Public and manual (§5.3). */
  setPaused(roomId: string, paused: boolean): Promise<void>;
}

/**
 * Room codes.
 *
 * Five characters from an alphabet with no 0/O/1/I/L, because these get read
 * aloud across a table and typed by someone holding a beer. 32^5 is about 33
 * million — collisions are not a real concern for one group, and a collision
 * would fail loudly on create rather than silently join the wrong room.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normaliseRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(input: string): boolean {
  const code = normaliseRoomCode(input);
  return code.length === 5 && [...code].every((c) => CODE_ALPHABET.includes(c));
}
