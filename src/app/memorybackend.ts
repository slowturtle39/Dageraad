import { cardsForRoles, deal } from '../engine/deal.js';
import { buildTimeline } from '../engine/timeline.js';
import type { LatencySample } from '../engine/telemetry.js';
import type { Vote } from '../engine/dayphase.js';
import type {
  Choice, GameConfig, NightEvent, NightState, PrivateInfo, RoleId, SeatIndex,
} from '../engine/types.js';
import type { DayStore } from '../orchestration/dayrunner.js';
import type { RoomStore } from '../orchestration/store.js';
import {
  generateRoomCode, type Backend, type CreateRoomOptions, type GameResults,
  type PlayerView, type PrivateView, type RoomPhase, type RoomView,
  type SeatResult, type Unsubscribe,
} from './backend.js';

/**
 * A whole Dageraad server, in memory.
 *
 * `world.device(uid)` hands back a `Backend` for one phone, all sharing this
 * state — so eight devices round a table are eight `device()` calls, and a test
 * can play a complete night without a Firebase project in sight.
 *
 * IT DELIBERATELY ENFORCES THE SECURITY RULES. Not because anything here is
 * exposed, but because a local backend that is more permissive than the real
 * one is worse than useless: it would let a shell be written that works
 * perfectly in tests and is rejected by Firestore the first time it is played
 * for real. Every refusal below mirrors a rule in `firestore.rules`.
 */
export class MemoryWorld {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  device(uid: string): Backend {
    return new MemoryBackend(this, uid);
  }

  /* ------------------------------------------------------------------ */

  room(roomId: string): RoomRecord {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`no such room: ${roomId}`);
    return room;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  create(uid: string, options: CreateRoomOptions): string {
    let roomId = generateRoomCode(this.random);
    while (this.rooms.has(roomId)) roomId = generateRoomCode(this.random);

    // A neutral tablet is the referee and takes no seat — it holds every card,
    // so dealing it one would be dealing a card to the person who can read
    // them all. A phone hosting its own game does take a seat.
    const playing = options.playing !== false;

    this.rooms.set(roomId, {
      view: {
        roomId,
        hostUid: uid,
        // The creator becomes the referee, and it can never move afterwards
        // (see backend.ts). In practice: create the room on the tablet.
        refereeUid: uid,
        phase: 'lobby',
        nightWindowIndex: 0,
        activeRoles: options.activeRoles,
        config: options.config,
        timeline: null,
        seating: playing ? [uid] : [],
        publicEvents: [],
        shieldedSeats: [],
        revealedSeats: {},
        abstainCount: 0,
        votesCast: 0,
        pausedAt: null,
        discussionExtendedByMs: 0,
        finalRoles: null,
        outcome: null,
      },
      players: playing
        ? new Map([[uid, { uid, displayName: options.displayName, seatIndex: 0 }]])
        : new Map(),
      privates: new Map(),
      submissions: new Map(),
      votes: new Map(),
      results: new Map(),
      latency: [],
      state: null,
      watchers: { room: new Set(), players: new Set(), private: new Map() },
    });
    return roomId;
  }

  notify(roomId: string): void {
    const r = this.room(roomId);
    for (const cb of r.watchers.room) cb({ ...r.view });
    const players = [...r.players.values()].sort((a, b) => a.seatIndex - b.seatIndex);
    for (const cb of r.watchers.players) cb(players.map((p) => ({ ...p })));
    for (const [uid, cbs] of r.watchers.private) {
      const own = r.privates.get(uid) ?? { originalRole: null, privateInfo: [] };
      for (const cb of cbs) cb({ ...own, privateInfo: [...own.privateInfo] });
    }
  }
}

interface RoomRecord {
  view: RoomView;
  players: Map<string, PlayerView>;
  privates: Map<string, PrivateView>;
  submissions: Map<string, { windowIndex: number; choices: Record<string, Choice> }>;
  votes: Map<string, { target: string | null; abstain: boolean }>;
  /** Append-only, live games only. What profile stats aggregate from. */
  results: Map<string, SeatResult>;
  latency: LatencySample[];
  state: NightState | null;
  watchers: {
    room: Set<(r: RoomView | null) => void>;
    players: Set<(p: PlayerView[]) => void>;
    private: Map<string, Set<(p: PrivateView) => void>>;
  };
}

class MemoryBackend implements Backend {
  constructor(private readonly world: MemoryWorld, readonly uid: string) {}

  async createRoom(options: CreateRoomOptions): Promise<string> {
    const roomId = this.world.create(this.uid, options);
    this.world.notify(roomId);
    return roomId;
  }

  async joinRoom(roomId: string, displayName: string): Promise<void> {
    const r = this.world.room(roomId);
    // Mirrors the rule: you may only add yourself, and only in the lobby.
    if (r.view.phase !== 'lobby') throw new Error('game already started');
    // A referee who sat the game out cannot change their mind and take a seat:
    // they have already seen the room from the one place every card is visible.
    // Sitting down now would be dealing a card to somebody who can read them
    // all, which is the exact thing the referee/player split exists to prevent.
    if (r.view.refereeUid === this.uid && !r.players.has(this.uid)) {
      throw new Error('the referee is not a player in this room');
    }
    if (!r.players.has(this.uid)) {
      r.players.set(this.uid, {
        uid: this.uid,
        displayName,
        seatIndex: r.players.size,
      });
      r.view.seating = [...r.view.seating, this.uid];
    } else {
      r.players.get(this.uid)!.displayName = displayName;
    }
    this.world.notify(roomId);
  }

  async setSeating(roomId: string, seating: string[]): Promise<void> {
    const r = this.world.room(roomId);
    this.requireHost(r);
    if (r.view.phase !== 'lobby') throw new Error('seating is frozen once the game starts');
    if (seating.length !== r.players.size) throw new Error('seating must cover every player');
    r.view.seating = [...seating];
    seating.forEach((uid, seat) => {
      const p = r.players.get(uid);
      if (p) p.seatIndex = seat;
    });
    this.world.notify(roomId);
  }

  async setActiveRoles(roomId: string, roles: RoleId[], config: GameConfig): Promise<void> {
    const r = this.world.room(roomId);
    this.requireHost(r);
    if (r.view.phase !== 'lobby') throw new Error('roles are frozen once the game starts');
    r.view.activeRoles = [...roles];
    r.view.config = config;
    this.world.notify(roomId);
  }

  async startGame(roomId: string, seed: number): Promise<void> {
    const r = this.world.room(roomId);
    this.requireReferee(r);
    if (r.view.phase !== 'lobby') throw new Error('already started');

    const seatCount = r.view.seating.length;
    const cards = cardsForRoles(r.view.activeRoles, seatCount);
    const dealt = deal({ cards, seatCount, seed });

    r.state = dealt.state;
    r.view.timeline = buildTimeline(r.view.activeRoles, r.view.config);
    r.view.phase = 'night';
    r.view.nightWindowIndex = 0;

    // Each seat learns its own dealt role and nothing else. This is the only
    // moment the referee writes a role anywhere, and it writes one per device.
    r.view.seating.forEach((uid, seat) => {
      r.privates.set(uid, {
        originalRole: dealt.seatRoles[seat] ?? null,
        privateInfo: [],
      });
    });

    this.world.notify(roomId);
  }

  watchRoom(roomId: string, cb: (room: RoomView | null) => void): Unsubscribe {
    const r = this.world.room(roomId);
    r.watchers.room.add(cb);
    cb({ ...r.view });
    return () => r.watchers.room.delete(cb);
  }

  watchPlayers(roomId: string, cb: (players: PlayerView[]) => void): Unsubscribe {
    const r = this.world.room(roomId);
    r.watchers.players.add(cb);
    cb([...r.players.values()].sort((a, b) => a.seatIndex - b.seatIndex));
    return () => r.watchers.players.delete(cb);
  }

  watchPrivate(roomId: string, cb: (own: PrivateView) => void): Unsubscribe {
    const r = this.world.room(roomId);
    const set = r.watchers.private.get(this.uid) ?? new Set();
    set.add(cb);
    r.watchers.private.set(this.uid, set);
    cb(r.privates.get(this.uid) ?? { originalRole: null, privateInfo: [] });
    return () => set.delete(cb);
  }

  async submit(
    roomId: string,
    windowIndex: number,
    choices: Record<string, Choice>,
  ): Promise<void> {
    const r = this.world.room(roomId);
    // Mirrors the rule exactly: a write is accepted only while the room is
    // still on the window it was made for. This is what closes a window
    // server-side without trusting any client's clock.
    if (r.view.phase !== 'night') throw new Error('not night');
    if (windowIndex !== r.view.nightWindowIndex) throw new Error('window closed');
    const existing = r.submissions.get(this.uid);
    r.submissions.set(this.uid, {
      windowIndex,
      choices: { ...(existing?.windowIndex === windowIndex ? existing.choices : {}), ...choices },
    });
  }

  async vote(roomId: string, target: string | null, abstain: boolean): Promise<void> {
    const r = this.world.room(roomId);
    if (target === this.uid) throw new Error('no self-votes');
    // §7: an abstain counts at any moment, so it is accepted during the
    // discussion. A named target is confined to 'voting' — letting one be
    // locked in early would quietly make a simultaneous vote a first-mover one.
    const phase = r.view.phase;
    const ok = phase === 'voting' || (phase === 'day' && target === null);
    if (!ok) throw new Error(`cannot vote in phase ${phase}`);
    r.votes.set(this.uid, { target, abstain });
  }

  async setPaused(roomId: string, paused: boolean): Promise<void> {
    const r = this.world.room(roomId);
    this.requireHostOrReferee(r);
    r.view.pausedAt = paused ? Date.now() : null;
    this.world.notify(roomId);
  }

  refereeStore(roomId: string): RoomStore & DayStore {
    const r = this.world.room(roomId);
    this.requireReferee(r);
    return new MemoryRefereeStore(this.world, roomId);
  }

  async refereeNightState(roomId: string): Promise<NightState | null> {
    const r = this.world.room(roomId);
    this.requireReferee(r);
    return r.state;
  }

  async publishResults(
    roomId: string,
    results: GameResults,
    persist: boolean,
  ): Promise<void> {
    const r = this.world.room(roomId);
    this.requireReferee(r);
    r.view.finalRoles = results.finalRoles;
    r.view.outcome = results.outcome;
    // Only a live game leaves a permanent record. See the note on the
    // interface: these documents are append-only and there is no delete path.
    if (persist) {
      for (const [seatKey, seatResult] of Object.entries(results.seats)) {
        const uid = r.view.seating[Number(seatKey)];
        if (uid) r.results.set(uid, seatResult);
      }
    }
    this.world.notify(roomId);
  }

  /* ---------------------------- guards ---------------------------- */

  private requireHost(r: RoomRecord): void {
    if (r.view.hostUid !== this.uid) throw new Error('host only');
  }
  private requireReferee(r: RoomRecord): void {
    if (r.view.refereeUid !== this.uid) throw new Error('referee only');
  }
  private requireHostOrReferee(r: RoomRecord): void {
    if (r.view.hostUid !== this.uid && r.view.refereeUid !== this.uid) {
      throw new Error('host or referee only');
    }
  }
}

/** The referee's side, satisfying the interfaces runNight and runDay expect. */
class MemoryRefereeStore implements RoomStore, DayStore {
  constructor(
    private readonly world: MemoryWorld,
    private readonly roomId: string,
  ) {}

  private get r() {
    return this.world.room(this.roomId);
  }

  private uidForSeat(seat: SeatIndex): string | undefined {
    return this.r.view.seating[seat];
  }

  async setWindowIndex(windowIndex: number): Promise<void> {
    this.r.view.nightWindowIndex = windowIndex;
    this.world.notify(this.roomId);
  }

  async readSubmissions(windowIndex: number) {
    const out = new Map<SeatIndex, Record<string, Choice>>();
    const { seating } = this.r.view;
    for (const [uid, sub] of this.r.submissions) {
      if (sub.windowIndex !== windowIndex) continue;
      // Seat comes from the document's OWNER, never from a field inside it —
      // the same reasoning as FirestoreRoomStore.
      const seat = seating.indexOf(uid);
      if (seat < 0) continue;
      out.set(seat, sub.choices);
    }
    return out;
  }

  async releasePrivateInfo(seat: SeatIndex, info: PrivateInfo[]): Promise<void> {
    const uid = this.uidForSeat(seat);
    if (!uid) return;
    const existing = this.r.privates.get(uid) ?? { originalRole: null, privateInfo: [] };
    this.r.privates.set(uid, {
      ...existing,
      privateInfo: [...existing.privateInfo, ...info],
    });
    this.world.notify(this.roomId);
  }

  async appendPublicEvents(events: NightEvent[]): Promise<void> {
    const r = this.r;
    r.view.publicEvents = [...r.view.publicEvents, ...events];
    // Mirror the two things the table can legitimately see.
    for (const e of events) {
      if (e.kind === 'shield-placed' && e.slot < r.view.seating.length) {
        r.view.shieldedSeats = [...new Set([...r.view.shieldedSeats, e.slot])];
      }
      if (e.kind === 'card-publicly-revealed' && e.slot < r.view.seating.length) {
        r.view.revealedSeats = { ...r.view.revealedSeats, [e.slot]: e.role };
      }
    }
    this.world.notify(this.roomId);
  }

  async recordLatency(samples: LatencySample[]): Promise<void> {
    this.r.latency.push(...samples);
  }

  async setPhase(phase: RoomPhase): Promise<void> {
    this.r.view.phase = phase;
    this.world.notify(this.roomId);
  }

  async readVotes(): Promise<Map<SeatIndex, Vote>> {
    const r = this.r;
    const out = new Map<SeatIndex, Vote>();
    for (const [uid, v] of r.votes) {
      const seat = r.view.seating.indexOf(uid);
      if (seat < 0) continue;
      const targetSeat = v.target === null ? null : r.view.seating.indexOf(v.target);
      out.set(seat, {
        voter: seat,
        target: targetSeat === undefined || targetSeat === null || targetSeat < 0 ? null : targetSeat,
        abstain: v.abstain,
      });
    }
    // Publish the counts the table is allowed to see: how many, never who.
    r.view.abstainCount = [...out.values()].filter((v) => v.abstain).length;
    r.view.votesCast = [...out.values()].filter((v) => v.target !== null || v.abstain).length;
    this.world.notify(this.roomId);
    return out;
  }

  async announceExtension(extraMs: number): Promise<void> {
    // Public on purpose — seeing the extension land IS the mechanic (§7).
    // Deliberately not written to `outcome`: that field means "the game is
    // over and here is the result", and an extension is the opposite of that.
    this.r.view.discussionExtendedByMs = extraMs;
    this.world.notify(this.roomId);
  }

}

export { MemoryRefereeStore };
