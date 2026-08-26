# Verifying A Clean Checkout

Use this before deploying rules or Hosting. It exercises unit tests, TypeScript,
and the real Firestore/Auth emulator suite.

## Requirements

- Node.js and npm (the locked versions in `package-lock.json` are used).
- Java 11 or newer. The Firestore emulator is a Java program; without `java`
  on `PATH`, `npm run test:rules` can stop after the Firebase wrapper starts
  with no useful test output.
- Internet on the first emulator run. Firebase downloads the Firestore emulator
  jar (about 60 MB) once.

On Windows, verify Java first:

```powershell
java -version
```

## Fresh Clone

```powershell
npm ci
npm rebuild
npm run verify
```

`npm rebuild` is intentionally included. In this Windows environment a clean
`npm ci` installed packages but left `node_modules/.bin` empty, so scripts such
as `tsc`, `vitest`, and `firebase` were not available until `npm rebuild`
regenerated their command links. It changes only ignored `node_modules` files.

`npm run verify` runs, in order:

```text
npm test
npm run typecheck
npm run test:rules
```

The last command starts local Auth and Firestore emulators and never contacts
or deploys to the live Firebase project.

## Offline Emulator Cache

Firebase CLI caches the Firestore emulator jar under:

```text
%USERPROFILE%\.cache\firebase\emulators\
```

For this checkout the cached file is named like
`cloud-firestore-emulator-v1.19.8.jar`. To prepare another offline machine,
run `npm run test:rules` once while online there, or copy the matching cached
jar into that directory before running the suite. Keep the file name/version
that the installed `firebase-tools` requests; a mismatched jar can be
redownloaded when internet is available.
