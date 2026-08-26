import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Vote } from '../engine/dayphase.js';
import type { LatencySample } from '../engine/telemetry.js';
import type { Choice, NightEvent, PrivateInfo, SeatIndex } from '../engine/types.js';
import type { DayStore } from '../orchestration/dayrunner.js';
import type { RoomStore } from '../orchestration/store.js';
import { paths, type RoomPhase } from './schema.js';

/**
 * The one Firebase-aware file in the whole codebase.
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
    const seats = await this.seatByUid();
    const out = new Map<SeatIndex, Record<string, Choice>>();
    for (const d of snap.docs) {
      const data = d.data() as {
        windowIndex?: number;
        choices?: Record<string, Choice>;
      };
      // Belt and braces: the rules already reject a mismatched windowIndex, but
      // a document left over from an earlier window must not be replayed here.
      if (data.windowIndex !== windowIndex) continue;
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
  async releasePrivateInfo(seat: SeatIndex, info: PrivateInfo[]): Promise<void> {
    const uid = await this.uidForSeat(seat);
    if (!uid) return;
    const ref = doc(this.db, paths.private(this.roomId, uid));
    const existing = (await getDoc(ref)).data() as { privateInfo?: PrivateInfo[] } | undefined;
    await setDoc(
      ref,
      {
        privateInfo: [...(existing?.privateInfo ?? []), ...info],
        revealedThrough: (existing?.privateInfo?.length ?? 0) + info.length,
      },
      { merge: true },
    );
  }

  async appendPublicEvents(events: NightEvent[]): Promise<void> {
    if (events.length === 0) return;
    const ref = this.room();
    const existing = (await getDoc(ref)).data() as { publicEvents?: NightEvent[] } | undefined;
    await updateDoc(ref, {
      publicEvents: [...(existing?.publicEvents ?? []), ...events],
    });
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
    const seats = await this.seatByUid();
    const out = new Map<SeatIndex, Vote>();
    for (const d of snap.docs) {
      const seat = seats.get(d.id);
      if (seat === undefined) continue;
      const data = d.data() as { target?: string | null; abstain?: boolean };
      const targetSeat =
        data.target == null ? null : (seats.get(data.target) ?? null);
      out.set(seat, {
        voter: seat,
        target: targetSeat,
        abstain: data.abstain === true,
      });
    }
    return out;
  }

  async announceExtension(extraMs: number): Promise<void> {
    // Public on purpose. Everyone should see the extension land — it is the
    // entire point of the mechanic, not a secret the referee keeps.
    await updateDoc(this.room(), { discussionExtendedByMs: extraMs });
  }

  /* ---------------------------- seat lookup ---------------------------- */

  private seatCache: Map<string, SeatIndex> | null = null;

  /** uid -> seat. Seating is frozen once the game starts, so cache it. */
  private async seatByUid(): Promise<Map<string, SeatIndex>> {
    if (this.seatCache) return this.seatCache;
    const snap = await getDocs(collection(this.db, paths.players(this.roomId)));
    const map = new Map<string, SeatIndex>();
    for (const d of snap.docs) {
      const data = d.data() as { seatIndex?: number };
      if (typeof data.seatIndex === 'number') map.set(d.id, data.seatIndex);
    }
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
