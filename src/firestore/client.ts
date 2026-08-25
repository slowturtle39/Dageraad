import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth';
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

function currentUid(auth: Auth): Promise<string> {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          stop();
          resolve(user.uid);
        }
      },
      (err) => {
        stop();
        reject(err);
      },
    );
    signInAnonymously(auth).catch((err: unknown) => {
      stop();
      reject(
        new Error(
          'Anonymous sign-in failed. Is Anonymous auth enabled in the Firebase ' +
          `console? (SETUP.md §10.3). Underlying error: ${String(err)}`,
        ),
      );
    });
  });
}
