import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Vote } from '../engine/dayphase.js';
import type { LatencySample } from '../engine/telemetry.js';
import type {
  Choice, DecisionRequest, NightEvent, PrivateInfo, SeatIndex,
} from '../engine/types.js';
import type { DayStore } from '../orchestration/dayrunner.js';
import type { NightCheckpoint, RoomStore } from '../orchestration/store.js';
import { paths, type RoomPhase } from './schema.js';
import type { PublicNightView } from '../engine/publicview.js';

/**
 * The referee's read/write path for ONE night.
 *
 * Firebase lives in this directory and nowhere else — here and in
 * `sessionstore.ts`, which handles what spans rounds (who is in the evening,
 * and what has been played). The split is along who writes: everything below
 * is the referee's, and the session store is every device's.
 *
 * It implements the same `RoomStore` and `DayStore` interfaces that
 * `InMemoryRoomStore` does, so the referee and the day runner cannot tell the
 * difference — and neither can their tests, which is why all 124 of them run
 * with no cloud account.
 *
 * Everything here is written by the REFEREE. Player devices never call these
 * methods; they write their own submission and vote documents directly, and the
 * security rules are what stop them writing anything else.
 */
export class FirestoreRoomStore implements RoomStore, DayStore {
  constructor(
    private readonly db: Firestore,
    private readonly roomId: string,
  ) {}

  private room() {
    return doc(this.db, paths.room(this.roomId));
  }

  async readNightCheckpoint(): Promise<NightCheckpoint | null> {
    const snap = await getDoc(doc(this.db, paths.engineState(this.roomId)));
    const data = snap.data() as {
      completedWindowIndex?: number;
      nightAnswers?: NightCheckpoint['answers'];
    } | undefined;
    return typeof data?.completedWindowIndex === 'number'
      ? {
          completedWindowIndex: data.completedWindowIndex,
          answers: Array.isArray(data.nightAnswers) ? data.nightAnswers : [],
        }
      : null;
  }

  async saveNightCheckpoint(checkpoint: NightCheckpoint): Promise<void> {
    await setDoc(doc(this.db, paths.engineState(this.roomId)), {
      completedWindowIndex: checkpoint.completedWindowIndex,
      nightAnswers: checkpoint.answers,
    }, { merge: true });
  }

  async setWindowIndex(windowIndex: number): Promise<void> {
    // This is what actually enforces the submission deadline: the rules only
    // accept a write whose windowIndex matches this value, so advancing it
    // closes the window server-side without trusting any client's clock.
    await updateDoc(this.room(), { nightWindowIndex: windowIndex });
  }

  async setPhase(phase: RoomPhase): Promise<void> {
    await updateDoc(this.room(), { phase });
  }

  async readSubmissions(
    windowIndex: number,
  ): Promise<Map<SeatIndex, Record<string, Choice>>> {
    const snap = await getDocs(
      collection(this.db, `rooms/${this.roomId}/submissions`),
    );
    const room = (await getDoc(this.room())).data() as { currentRound?: number } | undefined;
    const seats = await this.seatByUid();
    const out = new Map<SeatIndex, Record<string, Choice>>();
    for (const d of snap.docs) {
      const data = d.data() as {
        round?: number;
        windowIndex?: number;
        choices?: Record<string, Choice>;
      };
      // Belt and braces: the rules already reject a mismatched windowIndex, but
      // a document left over from an earlier window must not be replayed here.
      if (data.round !== room?.currentRound || data.windowIndex !== windowIndex) continue;
      // The seat comes from the document's OWNER, not from a field inside it.
      // A `seat` field would be both redundant (the doc is keyed by uid) and
      // forgeable — nothing in the rules could stop a player writing somebody
      // else's seat number into their own submission.
      const seat = seats.get(d.id);
      if (seat === undefined) continue;
      out.set(seat, data.choices ?? {});
    }
    return out;
  }

  /**
   * Release private info to one seat.
   *
   * Called ONLY when the seat's reveal is due per the timeline. Writing early
   * is the leak, and it is a leak the security rules cannot catch — they can
   * tell who may read this document, not when it should have been written. The
   * discipline lives in `referee.ts`.
   */
  async setPrivateInfo(seat: SeatIndex, info: PrivateInfo[]): Promise<void> {
    const uid = await this.uidForSeat(seat);
    if (!uid) return;
    const ref = doc(this.db, paths.private(this.roomId, uid));
    await setDoc(
      ref,
      {
        privateInfo: info,
        revealedThrough: info.length,
      },
      { merge: true },
    );
  }

  /**
   * Tell one seat what it is being asked this window.
   *
   * Into that seat's own private document, which the rules already make
   * referee-write and owner-read — so no new surface, and no chance of one
   * player reading another's question. REPLACES rather than appends: the
   * pending list is what is being asked NOW, and an empty write is what clears
   * the last window's question off somebody's screen.
   */
  async releaseDecisions(seat: SeatIndex, requests: DecisionRequest[]): Promise<void> {
    const uid = await this.uidForSeat(seat);
    if (!uid) return;
    await setDoc(
      doc(this.db, paths.private(this.roomId, uid)),
      { pendingDecisions: requests },
      { merge: true },
    );
  }

  /**
   * What the table can see, replaced wholesale on the room document.
   *
   * Only cards that were turned face up in front of everybody, and only their
   * CURRENT position — nothing here is a card identity nobody has seen, a
   * private choice, or any part of the deal. Those live in the engine document
   * the rules keep referee-only.
   */
  async publishPublicView(view: PublicNightView): Promise<void> {
    await updateDoc(this.room(), {
      revealedSlots: view.revealed,
      shieldedSeats: view.shielded,
    });
  }

  async setPublicEvents(events: NightEvent[]): Promise<void> {
    await updateDoc(this.room(), { publicEvents: events });
  }

  /**
   * Timing samples, batched.
   *
   * Keyed by role NAME and never by who was playing it — a uid here would turn
   * the calibration collection into a public record of who played what, and the
   * rules reject the write.
   */
  async recordLatency(samples: LatencySample[]): Promise<void> {
    if (samples.length === 0) return;
    const batch = writeBatch(this.db);
    for (const s of samples) {
      const ref = doc(collection(this.db, paths.calibration()));
      batch.set(ref, { ...s, createdAt: Date.now() });
    }
    await batch.commit();
  }

  async readVotes(): Promise<Map<SeatIndex, Vote>> {
    const snap = await getDocs(collection(this.db, `rooms/${this.roomId}/votes`));
    const room = (await getDoc(this.room())).data() as { currentRound?: number } | undefined;
    const seats = await this.seatByUid();
    const out = new Map<SeatIndex, Vote>();
    for (const d of snap.docs) {
      const seat = seats.get(d.id);
      if (seat === undefined) continue;
      const data = d.data() as {
        round?: number; target?: string | null; abstain?: boolean; readyToVote?: boolean;
      };
      if (data.round !== room?.currentRound) continue;
      const targetSeat =
        data.target == null ? null : (seats.get(data.target) ?? null);
      out.set(seat, {
        voter: seat,
        target: targetSeat,
        abstain: data.abstain === true,
        readyToVote: data.readyToVote === true,
      });
    }

    // The public counts, republished from what was just read. Counts only:
    // who abstained, who asked to vote, and who targeted whom all stay
    // referee-only until the results (§7).
    const counts: [number, number, number] = [
      [...out.values()].filter((v) => v.abstain).length,
      [...out.values()].filter((v) => v.readyToVote === true).length,
      [...out.values()].filter((v) => v.target !== null).length,
    ];
    if (!this.publishedVoteCounts
      || counts.some((count, index) => count !== this.publishedVoteCounts![index])) {
      await updateDoc(this.room(), {
        abstainCount: counts[0],
        earlyVoteCount: counts[1],
        votesCast: counts[2],
      });
      this.publishedVoteCounts = counts;
    }

    return out;
  }

  async announceExtension(extraMs: number): Promise<void> {
    // Public on purpose. Everyone should see the extension land — it is the
    // entire point of the mechanic, not a secret the referee keeps.
    await updateDoc(this.room(), { discussionExtendedByMs: extraMs });
  }

  async setDiscussionDeadline(endsAt: number | null): Promise<void> {
    await updateDoc(this.room(), { discussionEndsAt: endsAt });
  }

  async practiceForceVoteRequested(): Promise<boolean> {
    const data = (await getDoc(this.room())).data() as { practiceSkipDiscussion?: boolean } | undefined;
    return data?.practiceSkipDiscussion === true;
  }

  /* ---------------------------- seat lookup ---------------------------- */

  private seatCache: Map<string, SeatIndex> | null = null;
  private publishedVoteCounts: [number, number, number] | null = null;

  /**
   * uid -> seat, from the room's seating list. Index IS the seat.
   *
   * Read from the ROOM document rather than from a seatIndex on each player,
   * because a seat number living in a document its own player can write is a
   * seat number that player can choose. Same reasoning as `readSubmissions`
   * taking the seat from the document's owner.
   *
   * Cached because seating is frozen for the duration of a round. A new round
   * re-seats the table, so the referee builds a new store for it — this cache
   * must never outlive one round.
   */
  private async seatByUid(): Promise<Map<string, SeatIndex>> {
    if (this.seatCache) return this.seatCache;
    const snap = await getDoc(this.room());
    const seating = (snap.data() as { seating?: string[] } | undefined)?.seating ?? [];
    const map = new Map<string, SeatIndex>();
    seating.forEach((uid, seat) => map.set(uid, seat));
    this.seatCache = map;
    return map;
  }

  private async uidForSeat(seat: SeatIndex): Promise<string | null> {
    for (const [uid, s] of await this.seatByUid()) {
      if (s === seat) return uid;
    }
    return null;
  }
}
