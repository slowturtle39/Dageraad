# Deploy Readiness

Audited against commit `7981519` on 2026-08-26. This review deliberately did
not run `firebase deploy`.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Locked dependencies | Pass | `npm ci` completed. The local npm command links were missing afterwards and were restored with `npm rebuild`; this changed only ignored `node_modules` files. |
| Production build | Pass | `npm run build` completed with `tsc -b && vite build`. Vite wrote the site to `dist/`. |
| Type checking | Pass | `npm run typecheck` completed cleanly. |
| Unit and integration tests | Pass | `npm test` completed: 24 files, 314 tests passing. |

## Hosting Configuration

1. **Yes.** `hosting.public` is `dist`, which is Vite's actual production
   output directory.
2. **Yes.** The rewrite from `**` to `/index.html` is present. A direct
   refresh of a client-side route will therefore load the SPA instead of a
   Hosting 404.
3. **Yes.** `hosting.ignore` excludes `firebase.json`, hidden paths via
   `**/.*` (including `.git`), and `**/node_modules/**`.
4. **Yes.** The configured emulator ports are Firestore `8080` and Auth
   `9099`, which are the ports used by `src/firestore/rules.spec.ts`.
5. **Yes: no composite index is currently required.** The Firestore access in
   `src/firestore/*.ts` is document access or plain subcollection reads for
   submissions, votes, members, and rounds. It contains no compound
   `where`/`orderBy` query, collection-group query, or other query that needs
   a composite index. An empty `firestore.indexes.json` is therefore correct.
6. **Yes.** The generated main JavaScript file is `33.77 kB` raw and
   `10.75 kB` gzip-compressed. It is well below the roughly `500 kB` review
   threshold. The CSS file is `11.98 kB` raw and `3.09 kB` gzip-compressed.

## Project Selection

`.firebaserc` now pins the default Firebase CLI project to `dageraad-fdb2d`.
It contains an identifier only, not Firebase credentials or web configuration.

## Required Before a Real Playtest

The live Firestore rules are stale: they predate the `members` and `rounds`
subcollections. Do not create a room against them. First run a fresh local
`npm run test:rules`; only after that succeeds, deliberately deploy the rules
and Hosting as described in [PLAYTEST.md](PLAYTEST.md). This audit did not
deploy either service.
