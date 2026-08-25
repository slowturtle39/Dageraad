import type { FirebaseOptions } from 'firebase/app';

/**
 * Copy this to `config.ts` and paste in the values from the Firebase console
 * (SETUP.md §10.4).
 *
 * This is NOT a secret. Firebase web API keys are public by design — they
 * identify the project, they do not authorise anything. Every bit of the
 * security is in `firestore.rules`. Committing the real config is fine.
 */
export const firebaseConfig: FirebaseOptions = {
  apiKey: 'PASTE_ME',
  authDomain: 'dageraad-xxxxx.firebaseapp.com',
  projectId: 'dageraad-xxxxx',
  storageBucket: 'dageraad-xxxxx.appspot.com',
  messagingSenderId: 'PASTE_ME',
  appId: 'PASTE_ME',
};
