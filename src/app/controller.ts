import type {
  Backend, PlayerView, PrivateView, RoomView, Unsubscribe,
} from './backend.js';
import type { RoundRecord } from './session.js';
import { screenFor, type Screen } from './shell.js';

/**
 * Everything one device is watching, and the discipline for stopping.
 *
 * Every screen in this app is live: four subscriptions per room, fanning out
 * to more inside the Firestore backend (watchRoom alone listens to the room
 * document, the members and the rounds, because the scoreboard is derived
 * rather than stored). That is fine while there is one room. It stops being
 * fine the moment somebody leaves a room and joins another, which is exactly
 * what happens at a table when a code is mistyped.
 *
 * A leaked listener does not throw. It keeps firing, so the previous room's
 * snapshots race the current one's and the screen flickers between two
 * evenings — and on Firestore it goes on costing reads all night. So the rule
 * here is that there is EXACTLY ONE place a subscription is created and
 * exactly one that stops it, and `watch` on an already-watching controller
 * detaches the old room first rather than adding to it.
 */

export interface AppState {
  uid: string;
  roomId: string | null;
  room: RoomView | null;
  players: PlayerView[];
  own: PrivateView;
  rounds: RoundRecord[];
  /** True until the room document's first snapshot lands. */
  loading: boolean;
  /** Set when this device asked to join a room it is not a member of yet. */
  joining: boolean;
}

const EMPTY_PRIVATE: PrivateView = { originalRole: null, privateInfo: [], pending: [] };

export class AppController {
  private stops: Unsubscribe[] = [];
  private listeners = new Set<(state: AppState) => void>();

  private state: AppState;

  constructor(private readonly backend: Backend) {
    this.state = {
      uid: backend.uid,
      roomId: null,
      room: null,
      players: [],
      own: EMPTY_PRIVATE,
      rounds: [],
      loading: false,
      joining: false,
    };
  }

  current(): AppState {
    return this.state;
  }

  /** Which screen this device should render. The routing lives in shell.ts. */
  screen(): Screen {
    return screenFor({
      uid: this.state.uid,
      room: this.state.room,
      players: this.state.players,
      joining: this.state.joining,
    });
  }

  /** Subscribe to state changes. Returns its own unsubscribe, as everything does. */
  onChange(fn: (state: AppState) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Watch a room, detaching whatever was being watched before.
   *
   * Idempotent for the same room, so a re-render cannot quietly double every
   * listener — the failure mode that produces a screen flickering between two
   * evenings and a Firestore bill to match.
   */
  watch(roomId: string): void {
    if (this.state.roomId === roomId && this.stops.length > 0) return;
    this.detach();

    this.state = {
      ...this.state,
      roomId,
      room: null,
      players: [],
      own: EMPTY_PRIVATE,
      rounds: [],
      loading: true,
    };

    this.stops.push(
      this.backend.watchRoom(roomId, (room) => {
        this.state = { ...this.state, room, loading: false };
        // A room that has gone means the host deleted it, or the code was
        // wrong. Either way this device is not in an evening any more, and
        // saying so beats showing the last frame of one forever.
        if (!room) this.state = { ...this.state, joining: false };
        this.emit();
      }),
      this.backend.watchPlayers(roomId, (players) => {
        this.state = { ...this.state, players };
        this.emit();
      }),
      this.backend.watchPrivate(roomId, (own) => {
        this.state = { ...this.state, own };
        this.emit();
      }),
      this.backend.watchRounds(roomId, (rounds) => {
        this.state = { ...this.state, rounds };
        this.emit();
      }),
    );
    this.emit();
  }

  /** Stop watching and forget the room. Safe to call twice. */
  detach(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
  }

  /** Leave the room entirely: the screen goes back to the entry point. */
  reset(): void {
    this.detach();
    this.state = {
      ...this.state,
      roomId: null,
      room: null,
      players: [],
      own: EMPTY_PRIVATE,
      rounds: [],
      loading: false,
      joining: false,
    };
    this.emit();
  }

  /** Show the join screen. Purely local — nothing is written until they join. */
  setJoining(joining: boolean): void {
    this.state = { ...this.state, joining };
    this.emit();
  }

  private emit(): void {
    // Iterate a copy: a listener that unsubscribes itself while being called
    // is a normal thing for a re-rendering UI to do.
    for (const fn of [...this.listeners]) fn(this.state);
  }
}
