import {
  collection, doc, getDoc, onSnapshot, runTransaction, setDoc, updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  seatingForNextRound, standings,
  type RoundRecord, type SessionMember, type SessionStanding,
} from '../app/session.js';
import type { Unsubscribe } from '../app/backend.js';

/** Who this device says it is, across evenings. Never an authorisation. */
export interface FriendLabel {
  friendId: string;
  friendName: string;
}
import { paths, type RoundDoc, type SessionMemberDoc } from './schema.js';

/**
 * The evening, in Firestore: who is here, and what has been played.
 *
 * Separate from `FirestoreRoomStore`, which is the referee's own read/write
 * path for running one night. This is the SESSION layer — it spans rounds, and
 * every device uses it, not just the referee.
 *
 * WHAT IS NOT IN THIS FILE, and must never be: a write of anybody's score.
 * A latecomer's seed used to be a field on their member document, which is to
 * say a number the joining device chose for itself. The seed is now derived
 * (session.ts `standings`) from two things this store can only append to:
 * which round somebody joined at, and the round records themselves. If a
 * future method here ever writes points, wins, or a seed, the security rules
 * will reject the write — and that rejection is the design working, not a bug
 * to route around.
 */
export interface SessionStore {
  /** Add this device to the evening, at whatever round it is currently on. */
  join(uid: string, friend: FriendLabel): Promise<void>;
  /** Go home after the round now being played. Never ends it for anybody else. */
  leave(uid: string): Promise<void>;
  /** Come back. Re-uses the original joinedAtRound, and so the original seed. */
  rejoin(uid: string): Promise<void>;
  watchMembers(cb: (members: SessionMember[]) => void): Unsubscribe;
  watchRounds(cb: (rounds: RoundRecord[]) => void): Unsubscribe;
  /** Referee only. Append-only: the same round cannot be recorded twice. */
  recordRound(record: RoundRecord): Promise<void>;
  /** Referee only. Advances the evening. Monotonic — the rules refuse a rewind. */
  advanceRound(): Promise<number>;
}

export class FirestoreSessionStore implements SessionStore {
  constructor(
    private readonly db: Firestore,
    private readonly roomId: string,
  ) {}

  private room() {
    return doc(this.db, paths.room(this.roomId));
  }

  /** The round NOW BEING PLAYED. 0 in the lobby, N during and after round N. */
  private async currentRound(): Promise<number> {
    const snap = await getDoc(this.room());
    const data = snap.data() as { currentRound?: number } | undefined;
    return typeof data?.currentRound === 'number' ? Math.max(0, data.currentRound) : 0;
  }

  /**
   * Join at the round the evening is actually on.
   *
   * `joinedAtRound` is read from the room document rather than passed in, and
   * that is the entire security story for scoring. It is the one field a
   * player influences at all, the rules pin it to the room's current round at
   * the instant of the write, and everything else about their standing is
   * recomputed from it. Nothing here decides how many points they start with,
   * because nothing here is allowed to.
   */
  async join(uid: string, friend: FriendLabel): Promise<void> {
    // The NEXT round, not the one running: the deal is fixed the moment the
    // night starts, so an arrival plays from the following game. In the lobby
    // that is round 1, which is the same arithmetic rather than a special case.
    const member: SessionMemberDoc = {
      uid,
      joinedAtRound: await this.currentRound() + 1,
      leftAtRound: null,
      // Written once, at join. Whose row a finished round belongs to has to
      // survive that person going home, so it lives on the membership rather
      // than being looked up from a device that may be gone.
      friendId: friend.friendId,
      friendName: friend.friendName,
    };
    await setDoc(doc(this.db, paths.member(this.roomId, uid)), member);
  }

  /**
   * Leave, taking the round now being played with you.
   *
   * `leftAtRound` is the LAST round they play, not the first they miss: mid
   * round the deal already has their card in it and their outstanding
   * decisions decline like an AFK player's. The seat goes at the next
   * boundary. The evening does not stop because one person has to drive home.
   */
  async leave(uid: string): Promise<void> {
    await updateDoc(doc(this.db, paths.member(this.roomId, uid)), {
      leftAtRound: await this.currentRound(),
    });
  }

  /** Coming back re-uses the original joinedAtRound, and so the original seed. */
  async rejoin(uid: string): Promise<void> {
    await updateDoc(doc(this.db, paths.member(this.roomId, uid)), {
      leftAtRound: null,
    });
  }

  watchMembers(cb: (members: SessionMember[]) => void): Unsubscribe {
    return onSnapshot(collection(this.db, paths.members(this.roomId)), (snap) => {
      cb(snap.docs.map((d) => {
        const data = d.data() as Partial<SessionMemberDoc>;
        // Built from the document ID and two fields, deliberately. Anything
        // else a document happens to carry is not read here, so a field
        // smuggled past a future rules edit still buys nobody anything.
        return {
          uid: d.id,
          joinedAtRound: typeof data.joinedAtRound === 'number' ? data.joinedAtRound : 1,
          leftAtRound: typeof data.leftAtRound === 'number' ? data.leftAtRound : null,
          ...(data.friendId ? { friendId: data.friendId } : {}),
          ...(data.friendName ? { friendName: data.friendName } : {}),
        };
      }));
    });
  }

  watchRounds(cb: (rounds: RoundRecord[]) => void): Unsubscribe {
    return onSnapshot(collection(this.db, paths.rounds(this.roomId)), (snap) => {
      const rounds = snap.docs.map((d) => {
        const data = d.data() as RoundDoc;
        return {
          round: data.round,
          activeRoles: data.activeRoles ?? [],
          seatCount: data.seatCount ?? 0,
          outcome: data.outcome ?? '',
          results: data.results ?? [],
        };
      });
      // Sorted here rather than left to Firestore's document order, because
      // the scoreboard walks them in sequence: a latecomer's seed is the floor
      // at the round they arrived, which is only right if the rounds before it
      // have already been applied.
      cb(rounds.sort((a, b) => a.round - b.round));
    });
  }

  /**
   * Record the finished round. Referee only, and once.
   *
   * The document id is the round number, so a second write for the same round
   * is a collision rather than an overwrite — these documents are now the only
   * input to the scoreboard, and an editable round is an editable score.
   */
  async recordRound(record: RoundRecord): Promise<void> {
    const payload: RoundDoc = {
      round: record.round,
      activeRoles: record.activeRoles,
      seatCount: record.seatCount,
      outcome: record.outcome,
      results: record.results,
      recordedAt: Date.now(),
    };
    await setDoc(doc(this.db, paths.round(this.roomId, record.round)), payload);
  }

  /**
   * Move the evening on by one.
   *
   * In a transaction because this number is load-bearing: it is what a joining
   * member's `joinedAtRound` is pinned to, so two devices advancing at once
   * must not land two people on the same round twice over. The rules refuse a
   * value lower than the stored one, which makes a lost race fail loudly
   * rather than quietly re-seed somebody against a floor already passed.
   */
  async advanceRound(): Promise<number> {
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(this.room());
      const data = snap.data() as { currentRound?: number } | undefined;
      const next = (typeof data?.currentRound === 'number' ? data.currentRound : 0) + 1;
      tx.update(this.room(), { currentRound: next });
      return next;
    });
  }
}

/**
 * The scoreboard, from what the two collections say.
 *
 * Here rather than in a component so every screen shows the same numbers, and
 * so the one place they are computed is a pure function of documents nobody
 * can rewrite. Recomputed on every snapshot; never cached into a counter.
 */
export function sessionView(
  members: SessionMember[],
  rounds: RoundRecord[],
  currentSeating: string[],
  nextRound: number,
): { standings: SessionStanding[]; seating: string[] } {
  return {
    standings: standings(members, rounds),
    seating: seatingForNextRound(members, currentSeating, nextRound),
  };
}
