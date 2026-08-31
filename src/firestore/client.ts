import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Firebase bootstrap.
 *
 * The config is PASSED IN rather than imported, so this file compiles and can
 * be reasoned about before the Firebase project exists. Drop your config in as
 * `src/firebase/config.ts` (see SETUP.md §10.4) and call `connect(firebaseConfig)`.
 *
 * On whether that config is a secret: it is not. Firebase web API keys are
 * public by design — they identify the project, they do not authorise anything.
 * All of the security is in `firestore.rules`, which is exactly why those rules
 * matter as much as they do. Committing the config is fine.
 */

export interface Connection {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  /** This device's stable anonymous uid. Every rule keys off it. */
  uid: string;
}

/**
 * Connect and sign in anonymously.
 *
 * Anonymous auth gives each phone a stable uid without anybody making an
 * account. **Nothing works until it is enabled in the console** (SETUP.md
 * §10.3) — every rule in firestore.rules depends on `request.auth.uid`, so
 * without it every read and write is denied and the app looks broken rather
 * than misconfigured.
 */
export async function connect(config: FirebaseOptions): Promise<Connection> {
  const app = initializeApp(config);
  const db = getFirestore(app);
  const auth = getAuth(app);

  const uid = await currentUid(auth);
  return { app, db, auth, uid };
}

const STALE_USER_CODES = new Set([
  'auth/invalid-user-token',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/user-token-expired',
]);

function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  return typeof err.code === 'string' ? err.code : null;
}

/**
 * Return a uid whose token Firebase has just accepted.
 *
 * Auth restores an anonymous user from IndexedDB before it knows whether that
 * user still exists server-side. Returning that uid immediately leaves one
 * browser in a deceptive state: the app thinks it signed in, while every
 * Firestore operation is denied. Force-refreshing the token closes that gap.
 * Only a specifically invalid user is replaced; a network error must not
 * discard somebody's stable identity and detach their all-time history.
 */
export async function currentUid(auth: Auth): Promise<string> {
  await auth.authStateReady();

  const cached = auth.currentUser;
  if (cached) {
    try {
      await cached.getIdToken(true);
      return cached.uid;
    } catch (err) {
      if (!STALE_USER_CODES.has(errorCode(err) ?? '')) throw err;
      await auth.signOut();
    }
  }

  try {
    const credential = await signInAnonymously(auth);
    return credential.user.uid;
  } catch (err) {
    throw new Error(
      'Anonymous sign-in failed. Is Anonymous auth enabled in the Firebase ' +
      `console? (SETUP.md §10.3). Underlying error: ${String(err)}`,
    );
  }
}
