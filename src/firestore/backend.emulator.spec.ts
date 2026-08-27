import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore,
  setDoc, type Firestore,
} from 'firebase/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { TWO_ROUND_CONFIG } from '../engine/presets.js';
import { createNightState } from '../engine/state.js';
import type { RoleId } from '../engine/types.js';
import type { RoomView } from '../app/backend.js';
import { FirestoreBackend } from './backend.js';
import { engineStateToDoc, paths } from './schema.js';

const PROJECT_ID = 'dageraad-rules-test';
const apps: FirebaseApp[] = [];
let serial = 0;

interface Client {
  backend: FirestoreBackend;
  db: Firestore;
  uid: string;
}

async function client(label: string): Promise<Client> {
  const n = ++serial;
  const app = initializeApp({
    apiKey: `emulator-${n}`,
    appId: `emulator-${n}`,
    projectId: PROJECT_ID,
  }, `backend-emulator-${label}-${n}`);
  apps.push(app);

  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const credential = await signInAnonymously(auth);

  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { backend: new FirestoreBackend(db, credential.user.uid), db, uid: credential.user.uid };
}

afterAll(async () => { await Promise.all(apps.map((app) => deleteApp(app))); });

const roomOptions = (playing: boolean, displayName = 'player') => ({
  playing,
  displayName,
  activeRoles: ['weerwolf'] as RoleId[],
  config: TWO_ROUND_CONFIG,
});

async function readRoom(db: Firestore, roomId: string) {
  const snap = await getDoc(doc(db, paths.room(roomId)));
  expect(snap.exists()).toBe(true);
  return snap.data() as Record<string, unknown>;
}

describe('FirestoreBackend through the real emulators', () => {
  it('creates a table-device room without seating or enrolling the referee', async () => {
    const referee = await client('table-referee');
    const roomId = await referee.backend.createRoom(roomOptions(false, 'tablet'));
    const room = await readRoom(referee.db, roomId);

    expect(room.refereeUid).toBe(referee.uid);
    expect(room.seating).toEqual([]);
    expect((await getDoc(doc(referee.db, paths.member(roomId, referee.uid)))).exists()).toBe(false);
  });

  it('creates a trusted-host room with its creator seated for round one', async () => {
    const host = await client('trusted-host');
    const roomId = await host.backend.createRoom(roomOptions(true, 'host'));
    const room = await readRoom(host.db, roomId);
    const member = (await getDoc(doc(host.db, paths.member(roomId, host.uid)))).data();

    expect(room.currentRound).toBe(0);
    expect(room.seating).toEqual([host.uid]);
    expect(member).toMatchObject({ uid: host.uid, joinedAtRound: 1, leftAtRound: null });
  });

  it('hands a failed tablet over only through the phrase-confirmed recovery method', async () => {
    const tablet = await client('recovery-tablet');
    const roomId = await tablet.backend.createRoom(roomOptions(false, 'tablet'));
    const players = await Promise.all(['recovery-a', 'recovery-b', 'recovery-c'].map(client));
    for (const player of players) await player.backend.joinRoom(roomId, 'Player');

    await expect(players[0]!.backend.takeEmergencyControl(roomId, 'wrong'))
      .rejects.toThrow('type referee');
    await players[0]!.backend.takeEmergencyControl(roomId, 'referee');
    const room = await readRoom(players[0]!.db, roomId);
    expect(room).toMatchObject({ hostUid: players[0]!.uid, refereeUid: players[0]!.uid });
    await expect(players[0]!.backend.startGame(roomId, 77)).resolves.toBeUndefined();
  });

  it('joins lobby players, starts atomically, and seats a mid-round joiner only next round', async () => {
    const referee = await client('referee');
    const roomId = await referee.backend.createRoom(roomOptions(false, 'tablet'));
    const players = await Promise.all(['a', 'b', 'c'].map(client));
    for (const [i, player] of players.entries()) await player.backend.joinRoom(roomId, `P${i}`);

    await referee.backend.startGame(roomId, 123);
    const started = await readRoom(referee.db, roomId);
    expect(started).toMatchObject({ currentRound: 1, phase: 'night' });
    expect(started.seating).toHaveLength(3);
    expect((await getDoc(doc(referee.db, paths.engineState(roomId)))).exists()).toBe(true);
    expect((await getDocs(collection(referee.db, `rooms/${roomId}/private`))).docs).toHaveLength(3);
    expect((await getDocs(collection(referee.db, paths.players(roomId)))).docs).toHaveLength(3);

    const late = await client('late');
    await late.backend.joinRoom(roomId, 'Late');
    const lateMember = (await getDoc(doc(late.db, paths.member(roomId, late.uid)))).data();
    expect(lateMember).toMatchObject({ joinedAtRound: 2, leftAtRound: null });
    expect((await readRoom(referee.db, roomId)).seating).not.toContain(late.uid);
  });

  it('keeps a mid-round departure seated until the next round boundary', async () => {
    const referee = await client('departure-referee');
    const roomId = await referee.backend.createRoom(roomOptions(false));
    const players = await Promise.all(
      ['departure-a', 'departure-b', 'departure-c', 'departure-d'].map(client),
    );
    for (const player of players) await player.backend.joinRoom(roomId, 'Player');
    await referee.backend.startGame(roomId, 22);

    await players[1]!.backend.leaveRoom(roomId);
    expect((await readRoom(referee.db, roomId)).seating).toContain(players[1]!.uid);
    expect((await getDoc(doc(referee.db, paths.member(roomId, players[1]!.uid)))).data())
      .toMatchObject({ leftAtRound: 1 });

    await referee.backend.refereeStore(roomId).setPhase('results');
    await referee.backend.startGame(roomId, 23);
    expect((await readRoom(referee.db, roomId)).seating).not.toContain(players[1]!.uid);
  });

  it('records one append-only round and derives a late joiner at the current score floor', async () => {
    const referee = await client('standing-referee');
    const roomId = await referee.backend.createRoom(roomOptions(false));
    const players = await Promise.all(['standing-a', 'standing-b', 'standing-c'].map(client));
    for (const player of players) await player.backend.joinRoom(roomId, 'Player');
    await referee.backend.startGame(roomId, 31);
    const late = await client('standing-late');
    await late.backend.joinRoom(roomId, 'Late');

    const record = {
      round: 1,
      activeRoles: ['weerwolf'] as RoleId[],
      seatCount: 3,
      outcome: 'eliminated',
      results: players.map((player, seat) => ({
        uid: player.uid, seat, originalRole: 'dorpeling' as RoleId,
        finalRole: 'dorpeling' as RoleId, won: seat === 0,
        voteOutcome: 'correct' as const, suspicionAccuracy: null,
      })),
    };
    await referee.backend.recordRound(roomId, record);
    await referee.backend.recordRound(roomId, record);
    expect((await getDocs(collection(referee.db, paths.rounds(roomId)))).docs).toHaveLength(1);

    const composed = await new Promise<RoomView>((resolve) => {
      const stop = referee.backend.watchRoom(roomId, (view) => {
        if (view?.standings.some((standing) => standing.uid === late.uid)) {
          stop();
          resolve(view);
        }
      });
    });
    const lateStanding = composed.standings.find((standing) => standing.uid === late.uid);
    expect(lateStanding?.seeded).toBe(1);
  }, 5_000);

  it('round-trips serialized engine Sets and assumedRole through Firestore', async () => {
    const referee = await client('round-trip');
    const roomId = await referee.backend.createRoom(roomOptions(false));
    const state = createNightState({
      seatCount: 3,
      seatRoles: ['dorpeling', 'ziener', 'weerwolf'],
      centerRoles: ['jager', 'heks', 'medium'],
    });
    state.shieldedSlots.add(1);
    state.revealedCards.add(state.slots[2]!);
    state.assumedRole[0] = 'looier';
    await setDoc(doc(referee.db, paths.engineState(roomId)), engineStateToDoc(state));

    const restored = await referee.backend.refereeNightState(roomId);
    expect(restored?.shieldedSlots).toEqual(new Set([1]));
    expect(restored?.revealedCards).toEqual(new Set([state.slots[2]! ]));
    expect(restored?.assumedRole).toEqual({ 0: 'looier' });
  });

  it('refuses non-referee startGame and another player writing a member document', async () => {
    const referee = await client('negative-referee');
    const roomId = await referee.backend.createRoom(roomOptions(false));
    const player = await client('negative-player');

    await expect(player.backend.startGame(roomId, 1)).rejects.toThrow('referee only');
    await expect(setDoc(doc(player.db, paths.member(roomId, referee.uid)), {
      uid: referee.uid, joinedAtRound: 1, leftAtRound: null,
    })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
