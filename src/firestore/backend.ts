import {
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { cardsForRoles, deal } from '../engine/deal.js';
import { buildTimeline } from '../engine/timeline.js';
import type {
  Choice, GameConfig, NightState, RoleId, SeatIndex,
} from '../engine/types.js';
import type { DayStore } from '../orchestration/dayrunner.js';
import type { RoomStore } from '../orchestration/store.js';
import {
  generateRoomCode, type Backend, type CreateRoomOptions, type GameResults,
  type PlayerView, type PrivateView, type RoomView, type Unsubscribe,
} from '../app/backend.js';
import {
  canStartRound, seatingForNextRound, standings,
  type RoundRecord, type SessionMember,
} from '../app/session.js';
import { FirestoreRoomStore } from './roomstore.js';
import { FirestoreSessionStore } from './sessionstore.js';
import {
  engineStateFromDoc, engineStateToDoc, paths,
  type EngineStateDoc, type PlayerDoc, type PrivateDoc, type RoomDoc,
} from './schema.js';

/**
 * The real backend: the same `Backend` interface `MemoryBackend` implements,
 * against Firestore.
 *
 * Every method here has a counterpart in memorybackend.ts, and where the two
 * disagree the app breaks in a way no test catches — the memory one is what
 * all 283 tests run against. So the rule for this file is that it mirrors that
 * one's BEHAVIOUR, and where it cannot, the difference is written down.
 *
 * The other rule is that this file assumes it will be lied to. Every guard in
 * here is duplicated in firestore.rules, because a guard that lives only in
 * the client is a guard a player with devtools does not have. The checks below
 * exist to produce a sensible error message before the round-trip; the rules
 * are what actually stop anything.
 */
export class FirestoreBackend implements Backend {
  constructor(
    private readonly db: Firestore,
    readonly uid: string,
  ) {}

  private roomRef(roomId: string) {
    return doc(this.db, paths.room(roomId));
  }

  private session(roomId: string): FirestoreSessionStore {
    return new FirestoreSessionStore(this.db, roomId);
  }

  private async room(roomId: string): Promise<RoomDoc> {
    const snap = await getDoc(this.roomRef(roomId));
    if (!snap.exists()) throw new Error(`no room ${roomId}`);
    return snap.data() as RoomDoc;
  }

  /* ------------------------------ lifecycle ------------------------------ */

  /**
   * Create the room, and become its referee.
   *
   * The creating device is the referee. In practice this still means creating
   * the room on the tablet; a phrase-confirmed trusted-group recovery exists
   * only for when that device fails.
   */
  async createRoom(options: CreateRoomOptions): Promise<string> {
    const playing = options.playing !== false;
    const roomId = await this.freeRoomCode();

    const room: RoomDoc = {
      hostUid: this.uid,
      refereeUid: this.uid,
      recoveryPhrase: null,
      phase: 'lobby',
      // 0 means "nothing played yet". Somebody joining now is a round-1
      // member, which is currentRound + 1 — the same arithmetic as joining
      // mid-evening rather than a special case.
      currentRound: 0,
      nightWindowIndex: 0,
      activeRoles: options.activeRoles,
      nightOrder: [],
      config: options.config,
      // A neutral tablet is the referee and takes NO seat: it holds every
      // card, so dealing it one would be dealing a card to the person who can
      // read them all. A phone hosting its own game does take a seat, with the
      // caveat that its owner then knows the whole deal.
      seating: playing ? [this.uid] : [],
      timeline: null as unknown as RoomDoc['timeline'],
      publicEvents: [],
      shieldedSlots: [],
      revealedCards: [],
      createdAt: Date.now(),
      pausedAt: null,
      votesCast: 0,
      abstainCount: 0,
      discussionExtendedByMs: 0,
      finalRoles: null,
      outcome: null,
      revealedSeats: {},
      shieldedSeats: [],
    };
    await setDoc(this.roomRef(roomId), room);

    if (playing) {
      await this.writePlayer(roomId, options.displayName);
      await this.session(roomId).join(this.uid);
    }
    return roomId;
  }

  async takeEmergencyControl(roomId: string, phrase: string): Promise<void> {
    if (phrase !== 'referee') throw new Error('type referee to confirm takeover');
    await updateDoc(this.roomRef(roomId), {
      hostUid: this.uid,
      refereeUid: this.uid,
      recoveryPhrase: phrase,
    });
  }

  /**
   * A code nobody is using.
   *
   * 32^5 is about 33 million, so a collision is not a real concern for one
   * group — but it is checked rather than assumed, because a collision that
   * went unchecked would silently drop somebody into a stranger's evening.
   */
  private async freeRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateRoomCode();
      if (!(await getDoc(this.roomRef(code))).exists()) return code;
    }
    throw new Error('could not find a free room code');
  }

  private async writePlayer(roomId: string, displayName: string): Promise<void> {
    const player: PlayerDoc = { displayName, avatar: null, joinedAt: Date.now() };
    await setDoc(doc(this.db, paths.player(roomId, this.uid)), player);
  }

  /**
   * Join the session. Allowed at any time, not just in the lobby.
   *
   * Mid-round you become a member now and are seated when the next round
   * starts — there is no card to hand somebody who walks in at second twenty,
   * and the Dorpsgek's shift needs stable adjacency (§13).
   *
   * Nothing here decides how many points you start on, because nothing here is
   * allowed to: the seed is derived from joinedAtRound, which the rules pin to
   * the room's own round counter. See sessionstore.ts.
   */
  async joinRoom(roomId: string, displayName: string): Promise<void> {
    const room = await this.room(roomId);

    // A referee who sat the game out cannot change their mind and take a seat:
    // they have already seen the room from the one place every card is visible.
    // Sitting down now would deal a card to somebody who can read them all.
    const already = await getDoc(doc(this.db, paths.member(roomId, this.uid)));
    if (room.refereeUid === this.uid && !already.exists()) {
      throw new Error('the referee is not a player in this room');
    }

    await this.writePlayer(roomId, displayName);

    if (already.exists()) {
      // A rename, or somebody coming back after leaving. Coming back re-uses
      // the original joinedAtRound and therefore the original seed — otherwise
      // stepping out for a round would be a way to top your score up off the
      // bottom of the table.
      const member = already.data() as { leftAtRound?: number | null };
      if (member.leftAtRound !== null && member.leftAtRound !== undefined) {
        await this.session(roomId).rejoin(this.uid);
      }
      return;
    }

    await this.session(roomId).join(this.uid);

    // In the lobby they sit down immediately; mid-round they wait. Seating is
    // the room document's, and in the lobby present members may rearrange it.
    if (room.phase === 'lobby') {
      await updateDoc(this.roomRef(roomId), {
        seating: [...room.seating, this.uid],
      });
    }
  }

  /**
   * Leave without ending the evening for everybody else.
   *
   * Mid-round this does NOT stop the game: the seat stays in the deal and its
   * outstanding decisions decline exactly as an AFK player's would, and the
   * seat disappears at the next round boundary. Ending the night because one
   * person has to drive home is the behaviour this exists to prevent.
   */
  async leaveRoom(roomId: string): Promise<void> {
    const member = await getDoc(doc(this.db, paths.member(roomId, this.uid)));
    if (!member.exists()) return;                  // never here; nothing to do

    await this.session(roomId).leave(this.uid);

    const room = await this.room(roomId);
    if (room.phase === 'lobby') {
      await updateDoc(this.roomRef(roomId), {
        seating: room.seating.filter((uid) => uid !== this.uid),
      });
    }
  }

  /* -------------------------------- lobby -------------------------------- */

  async setSeating(roomId: string, seating: string[]): Promise<void> {
    const room = await this.room(roomId);
    const member = await getDoc(doc(this.db, paths.member(roomId, this.uid)));
    const activeMember = member.exists()
      && (member.data() as { leftAtRound?: number | null }).leftAtRound === null;
    if (room.hostUid !== this.uid && room.refereeUid !== this.uid && !activeMember) {
      throw new Error('active member, host, or referee only');
    }
    if (room.phase !== 'lobby') throw new Error('seating is frozen once the game starts');
    // Measured against who is SEATED, not who is in the room: somebody waiting
    // for the next round has no seat to arrange yet.
    const current = new Set(room.seating);
    if (seating.length !== room.seating.length
      || new Set(seating).size !== seating.length
      || seating.some((uid) => !current.has(uid))) {
      throw new Error('seating must contain every seated player exactly once');
    }
    await updateDoc(this.roomRef(roomId), { seating: [...seating] });
  }

  async setActiveRoles(roomId: string, roles: RoleId[], config: GameConfig): Promise<void> {
    const room = await this.room(roomId);
    if (room.hostUid !== this.uid) throw new Error('host only');
    if (room.phase !== 'lobby') throw new Error('roles are frozen once the game starts');
    await updateDoc(this.roomRef(roomId), { activeRoles: [...roles], config });
  }

  async setPaused(roomId: string, paused: boolean): Promise<void> {
    const room = await this.room(roomId);
    if (room.hostUid !== this.uid && room.refereeUid !== this.uid) {
      throw new Error('host or referee only');
    }
    await updateDoc(this.roomRef(roomId), { pausedAt: paused ? Date.now() : null });
  }

  /* ------------------------------- the deal ------------------------------ */

  /**
   * Deal and begin the next round. Referee only.
   *
   * This is the ROUND BOUNDARY: everybody waiting sits down, everybody who
   * left is removed, and the ring closes up — a hole in the seating is a hole
   * in the Dorpsgek's rotation (§13). It is also the only moment a role is
   * written anywhere, and it writes one document per seat.
   */
  async startGame(roomId: string, seed: number): Promise<void> {
    const room = await this.room(roomId);
    if (room.refereeUid !== this.uid) throw new Error('referee only');
    // A round may start from the lobby or from the results of the last one.
    // Anything else means a round is already running.
    if (room.phase !== 'lobby' && room.phase !== 'results') {
      throw new Error('a round is already running');
    }

    const nextRound = room.currentRound + 1;
    const members = await this.readMembers(roomId);
    const seating = seatingForNextRound(members, room.seating, nextRound);

    const tooSmall = canStartRound(seating.length);
    if (tooSmall) throw new Error(tooSmall);

    const cards = cardsForRoles(room.activeRoles, seating.length);
    const dealt = deal({ cards, seatCount: seating.length, seed });

    // One batch, so the table never observes a half-dealt room: seats assigned
    // without cards behind them, or a phase that has turned over before the
    // private documents exist, is a round that looks broken to everybody.
    const batch = writeBatch(this.db);

    batch.update(this.roomRef(roomId), {
      currentRound: nextRound,
      seating,
      phase: 'night',
      nightWindowIndex: 0,
      timeline: buildTimeline(room.activeRoles, room.config),
      // Clear last round's table so nothing bleeds across.
      publicEvents: [],
      shieldedSeats: [],
      revealedSeats: {},
      votesCast: 0,
      abstainCount: 0,
      discussionExtendedByMs: 0,
      finalRoles: null,
      outcome: null,
    });

    batch.set(doc(this.db, paths.engineState(roomId)), engineStateToDoc(dealt.state));

    // Each seat learns its own dealt role and nothing else.
    seating.forEach((uid, seat) => {
      const priv: PrivateDoc = {
        originalRole: dealt.seatRoles[seat]!,
        currentCard: dealt.state.slots[seat]!,
        currentRole: dealt.seatRoles[seat]!,
        privateInfo: [],
        revealedThrough: 0,
      };
      batch.set(doc(this.db, paths.private(roomId, uid)), priv);
    });

    await batch.commit();
  }

  /* -------------------------------- reads -------------------------------- */

  /**
   * The public room, live.
   *
   * Three listeners, because the scoreboard is derived rather than stored:
   * the room document, the members, and the rounds. Recomputing on every
   * snapshot is the point — a cached total is a total that can be wrong.
   */
  watchRoom(roomId: string, cb: (room: RoomView | null) => void): Unsubscribe {
    let room: RoomDoc | null = null;
    let members: SessionMember[] = [];
    let rounds: RoundRecord[] = [];
    let haveRoom = false;

    const emit = () => {
      if (!haveRoom) return;
      cb(room ? this.composeRoomView(roomId, room, members, rounds) : null);
    };

    const stopRoom = onSnapshot(this.roomRef(roomId), (snap) => {
      haveRoom = true;
      room = snap.exists() ? (snap.data() as RoomDoc) : null;
      emit();
    });
    const session = this.session(roomId);
    const stopMembers = session.watchMembers((m) => { members = m; emit(); });
    const stopRounds = session.watchRounds((r) => { rounds = r; emit(); });

    return () => { stopRoom(); stopMembers(); stopRounds(); };
  }

  private composeRoomView(
    roomId: string,
    room: RoomDoc,
    members: SessionMember[],
    rounds: RoundRecord[],
  ): RoomView {
    return {
      roomId,
      hostUid: room.hostUid,
      refereeUid: room.refereeUid,
      phase: room.phase,
      round: room.currentRound,
      nightWindowIndex: room.nightWindowIndex ?? 0,
      activeRoles: room.activeRoles ?? [],
      config: room.config,
      timeline: room.timeline ?? null,
      seating: room.seating ?? [],
      members,
      standings: standings(members, rounds),
      publicEvents: room.publicEvents ?? [],
      shieldedSeats: room.shieldedSeats ?? [],
      revealedSeats: room.revealedSeats ?? {},
      abstainCount: room.abstainCount ?? 0,
      votesCast: room.votesCast ?? 0,
      pausedAt: room.pausedAt ?? null,
      discussionExtendedByMs: room.discussionExtendedByMs ?? 0,
      finalRoles: room.finalRoles ?? null,
      outcome: room.outcome ?? null,
    };
  }

  /**
   * Everyone in the evening, live.
   *
   * Seats come from the ROOM's seating list, not from the player documents, so
   * somebody waiting for the next round genuinely has no seat rather than a
   * stale one — and so no player can write their own seat number.
   */
  watchPlayers(roomId: string, cb: (players: PlayerView[]) => void): Unsubscribe {
    let names = new Map<string, string>();
    let seating: string[] = [];
    let members: SessionMember[] = [];
    let havePlayers = false;

    const emit = () => {
      if (!havePlayers) return;
      const departed = new Set(
        members.filter((m) => m.leftAtRound !== null).map((m) => m.uid),
      );
      const out: PlayerView[] = [...names].map(([uid, displayName]) => {
        const seat = seating.indexOf(uid);
        return {
          uid,
          displayName,
          seatIndex: seat < 0 ? null : (seat as SeatIndex),
          playing: seat >= 0,
          departed: departed.has(uid),
        };
      });
      out.sort((a, b) => {
        if (a.seatIndex !== null && b.seatIndex !== null) return a.seatIndex - b.seatIndex;
        if (a.seatIndex !== null) return -1;
        if (b.seatIndex !== null) return 1;
        return a.uid.localeCompare(b.uid);
      });
      cb(out);
    };

    const stopPlayers = onSnapshot(
      collection(this.db, paths.players(roomId)),
      (snap) => {
        havePlayers = true;
        names = new Map(
          snap.docs.map((d) => [d.id, (d.data() as PlayerDoc).displayName ?? d.id]),
        );
        emit();
      },
    );
    const stopRoom = onSnapshot(this.roomRef(roomId), (snap) => {
      seating = (snap.data() as RoomDoc | undefined)?.seating ?? [];
      emit();
    });
    const stopMembers = this.session(roomId).watchMembers((m) => { members = m; emit(); });

    return () => { stopPlayers(); stopRoom(); stopMembers(); };
  }

  /** This device's own card and reveals. Never anybody else's. */
  watchPrivate(roomId: string, cb: (own: PrivateView) => void): Unsubscribe {
    return onSnapshot(doc(this.db, paths.private(roomId, this.uid)), (snap) => {
      const data = snap.data() as PrivateDoc | undefined;
      cb({
        originalRole: data?.originalRole ?? null,
        privateInfo: data?.privateInfo ?? [],
        pending: data?.pendingDecisions ?? [],
      });
    });
  }

  watchRounds(roomId: string, cb: (rounds: RoundRecord[]) => void): Unsubscribe {
    return this.session(roomId).watchRounds(cb);
  }

  private async readMembers(roomId: string): Promise<SessionMember[]> {
    const snap = await getDocs(collection(this.db, paths.members(roomId)));
    return snap.docs.map((d) => {
      const data = d.data() as Partial<SessionMember>;
      return {
        uid: d.id,
        joinedAtRound: typeof data.joinedAtRound === 'number' ? data.joinedAtRound : 1,
        leftAtRound: typeof data.leftAtRound === 'number' ? data.leftAtRound : null,
      };
    });
  }

  /* ------------------------------- writes -------------------------------- */

  /**
   * A player's own night choices, for the window currently open.
   *
   * The phase and window checks below mirror the security rule exactly. They
   * are here for the error message; the rule is what closes the window,
   * without trusting any client's clock.
   */
  async submit(
    roomId: string,
    windowIndex: number,
    choices: Record<string, Choice>,
  ): Promise<void> {
    const room = await this.room(roomId);
    if (room.phase !== 'night') throw new Error('not night');
    if (windowIndex !== room.nightWindowIndex) throw new Error('window closed');

    const ref = doc(this.db, paths.submission(roomId, this.uid));
    const existing = (await getDoc(ref)).data() as
      { windowIndex?: number; choices?: Record<string, Choice> } | undefined;
    // Merge only within the SAME window. A document left over from an earlier
    // window must not have its choices carried forward into this one.
    const carried = existing?.windowIndex === windowIndex ? existing.choices ?? {} : {};
    await setDoc(ref, {
      windowIndex,
      choices: { ...carried, ...choices },
      submittedAt: Date.now(),
    });
  }

  /**
   * A vote, or an abstain.
   *
   * §7: an abstain counts at any moment and so is accepted during the
   * discussion; a named target is confined to 'voting', because letting one be
   * locked in early would quietly turn a simultaneous vote into a first-mover
   * one even though nobody can read it yet. Never a vote for yourself.
   */
  async vote(roomId: string, target: string | null, abstain: boolean): Promise<void> {
    if (target === this.uid) throw new Error('no self-votes');
    const room = await this.room(roomId);
    const ok = room.phase === 'voting' || (room.phase === 'day' && target === null);
    if (!ok) throw new Error(`cannot vote in phase ${room.phase}`);
    await setDoc(doc(this.db, paths.vote(roomId, this.uid)), {
      target, abstain, castAt: Date.now(),
    });
  }

  /* ------------------------------- referee ------------------------------- */

  refereeStore(roomId: string): RoomStore & DayStore {
    // Not checked here: the rules refuse every write this store makes unless
    // the caller really is the referee, and a client-side guard would only
    // change which error you get.
    return new FirestoreRoomStore(this.db, roomId);
  }

  async refereeNightState(roomId: string): Promise<NightState | null> {
    const snap = await getDoc(doc(this.db, paths.engineState(roomId)));
    if (!snap.exists()) return null;
    return engineStateFromDoc(snap.data() as EngineStateDoc);
  }

  /**
   * Publish the outcome. The one moment roles become public.
   *
   * `persist` separates two things that look alike. The room's own result is
   * shown to the table either way — you still want to see who won a test game.
   * The per-player result documents are what profile stats aggregate from, and
   * a test game must never write one: they are append-only with no delete path
   * by design, so a bot game would inflate somebody's record permanently (§16).
   */
  async publishResults(
    roomId: string,
    results: GameResults,
    persist: boolean,
  ): Promise<void> {
    const room = await this.room(roomId);
    if (room.refereeUid !== this.uid) throw new Error('referee only');

    const batch = writeBatch(this.db);
    batch.update(this.roomRef(roomId), {
      finalRoles: results.finalRoles,
      outcome: results.outcome,
    });

    if (persist) {
      for (const [seatKey, seatResult] of Object.entries(results.seats)) {
        const uid = room.seating[Number(seatKey)];
        if (!uid) continue;
        batch.set(doc(this.db, paths.result(roomId, uid)), {
          ...seatResult,
          recordedAt: Date.now(),
        });
      }
    }
    await batch.commit();
  }

  /**
   * Append the finished round to the evening's record.
   *
   * Separate from publishResults on purpose: that one shows the table who won,
   * this one is the row the scoreboard and every stats breakdown are rebuilt
   * from, and a test round must produce the first without the second.
   *
   * Recording is idempotent by construction — the document id is the round
   * number, and the rules allow create but never update, so a referee who
   * refreshes their tab cannot double-score the evening.
   */
  async recordRound(roomId: string, record: RoundRecord): Promise<void> {
    const existing = await getDoc(doc(this.db, paths.round(roomId, record.round)));
    if (existing.exists()) return;
    await this.session(roomId).recordRound(record);
  }
}
