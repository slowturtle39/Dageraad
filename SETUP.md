# Setup — the two things only you can do

Task 9 (verify the security rules) and task 10 (create the Firebase project).
Do them in that order: **nothing should be built on top of unverified rules.**

---

# Task 9 — Verify the security rules

The rules were written but never executed, because the sandbox they were written
in blocks the emulator download. This runs them.

## 9.1 Prerequisites

**Node 18 or newer:**

```bash
node --version
```

**Java 11 or newer** — this is the one people miss. The Firestore emulator is a
Java program; without it you get a confusing download or startup error.

```bash
java -version
```

If Java is missing:

- **macOS:** `brew install openjdk@21` — then follow the `brew info openjdk@21`
  instructions to symlink it, or it won't be on your PATH.
- **Windows:** install Temurin from adoptium.net, tick "Set JAVA_HOME".
- **Linux:** `sudo apt install default-jre`

## 9.2 Run it

```bash
tar -xzf dageraad-handoff.tar.gz
cd dageraad
npm install
npm run test:rules
```

**The first run downloads the emulator (~60 MB), so you need internet.** After
that it's cached and works offline.

## 9.3 What you should see

```
✓ src/firestore/rules.spec.ts (33 tests)
Test Files  1 passed (1)
```

**Status: ✅ PASSED on Windows, 2026-08-25.** All 33 tests green — every
`assertFails` attack case correctly denied, no permissive-rule leaks, and no
legitimate action blocked. The `PERMISSION_DENIED` lines in the emulator log are
expected; they are the attacks being refused.

The suite is written as **attacks**, not happy paths. Each test is something one
of your friends could try with devtools open. The five that matter most are
under *"the load-bearing rule: nobody can become the referee"* — if any of those
fail, a player can promote themselves and read every card in the game.

## 9.4 If tests fail

**This is the expected outcome for at least one or two.** I wrote these rules
without being able to run them once. A failure means the rule is wrong, not the
test — the tests encode decisions you and I already agreed on.

Send me the output and I'll fix it. Useful detail when you do:

- Which test name failed
- Whether it was `assertFails` (a rule is too permissive — **urgent**) or
  `assertSucceeds` (a rule is too strict — annoying but safe)

The `assertFails` failures are the security-relevant ones. A rule that's too
strict breaks the app loudly; a rule that's too permissive leaks silently.

## 9.5 Common problems

| Symptom | Cause |
|---|---|
| `Could not start Firestore Emulator` | Java missing or not on PATH |
| `download failed, status 403` | No internet, or a proxy blocking `storage.googleapis.com` |
| `port 8080 is not open` | Something else is using 8080 — change it in `firebase.json` under `emulators.firestore.port`, and in the `port` in `rules.spec.ts` |
| Hangs at "Starting emulators" | Usually Java; try `npx firebase emulators:start --only firestore` alone to see the real error |
| `'firebase' is not recognized` (Windows) | npm 11 sometimes doesn't create `node_modules\.bin\firebase.cmd`. **Already fixed** — `test:rules` now invokes both binaries through `node` directly rather than relying on the shims, which works on every platform. |

---

# Task 10 — Create the Firebase project

Only do this **after** task 9 passes.

## 10.1 Create the project

1. Go to **console.firebase.google.com** and sign in with your Google account.
2. **Create a project**. Name it something like `dageraad`. The project *ID*
   it generates (e.g. `dageraad-a1b2c`) is what you'll need later.
3. **Turn Google Analytics OFF.** You don't need it, and it adds a consent
   surface and a second linked account for no benefit here.

## 10.2 Firestore

1. Left sidebar → **Build → Firestore Database → Create database**.
2. **Choose "Start in production mode."** Not test mode — test mode leaves the
   database open to the world for 30 days, and we have real rules to deploy.
3. **Location: `eur3` (europe-west)** or `europe-west4` (Netherlands).

   ⚠️ **This cannot be changed later.** Changing it means creating a new
   project and migrating. Pick a European one so latency at your table is low
   and the data stays in the EU.

## 10.3 Anonymous Auth

1. **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Anonymous** → enable → Save.

Anonymous auth is what gives each phone a stable `uid` without anyone making an
account. Every rule in `firestore.rules` depends on `request.auth.uid`, so
**nothing works until this is on.**

## 10.4 Register the web app and get the config

1. **Project settings** (gear icon, top left) → scroll to **Your apps**.
2. Click the **web** icon (`</>`).
3. Nickname it `dageraad-web`. **Do not** tick Firebase Hosting yet — we'll set
   that up from the CLI at deploy time.
4. Copy the `firebaseConfig` object it shows you.

**On whether that config is secret: it isn't.** Firebase web API keys are
public by design — they identify the project, they don't authorise anything.
Your security comes entirely from the rules in task 9, which is exactly why
those rules matter so much. It's fine to commit this to the repo.

Save it as `src/firebase/config.ts`:

```ts
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "dageraad-xxxxx.firebaseapp.com",
  projectId: "dageraad-xxxxx",
  storageBucket: "dageraad-xxxxx.appspot.com",
  messagingSenderId: "...",
  appId: "...",
};
```

**The store is already written.** `src/firestore/roomstore.ts` implements the
same interfaces the referee already runs against, so once `config.ts` exists the
only remaining work is calling `connect(firebaseConfig)` and handing the referee
a `FirestoreRoomStore` instead of an `InMemoryRoomStore`. There is a test
asserting the two stay in step, because if they drift the whole test suite keeps
passing while the app breaks.

## 10.5 Connect the CLI and deploy the rules

```bash
npx firebase login
npx firebase use --add        # pick your project, alias it "default"
npx firebase deploy --only firestore:rules
```

That last command pushes `firestore.rules` to the live database. **Re-run it
every time the rules change** — editing the file locally does nothing until you
deploy.

To confirm it worked: Firebase console → Firestore → **Rules** tab. You should
see the Dageraad rules with a recent timestamp, not the default template.

## 10.6 Sanity check

In the console → Firestore → Rules → **Rules Playground**:

- Location `/rooms/room1/private/alice-uid`, **get**, authenticated as
  `bob-uid` → should be **DENIED**.
- Same location authenticated as `alice-uid` → **ALLOWED** (once the doc
  exists).

If the first one is allowed, stop and tell me — that's the leak.

---

# Task 11 — Decide which device runs the game

This one is a table decision, not a console one, and it takes thirty seconds —
but make it **before** the first real evening, because it cannot be changed
afterwards.

The room-creation screen now asks it directly. Player-facing the device is the
**tafelapparaat** / **table device**; in the code and the rules it is still
`refereeUid`, unchanged.

**Separate table device (recommended).** A spare tablet, laptop or old phone
creates the room and runs the game, and takes no seat. It can technically read
every card — that is unavoidable on the free plan, see the README trust model —
which is exactly why it is not dealt one, and why its screen shows only what
everyone at the table may know. Leave it face-up in the middle.

**A player's own phone (trusted group).** One player creates the room and plays
along. No extra hardware. That phone can technically read every card, including
everybody else's. Fine for your group; not something to do with strangers, and
not something to do without saying so out loud first.

The screen says all of this itself, in Dutch and English, before the create
button. You do not have to brief anybody — but you do have to pick, and picking
the second option quietly is the one thing worth avoiding.

**Whichever you choose, the referee's tab has to stay open all night.** Lock
that device or lose signal mid-round and resolution stalls until it is back.

---

## What I need back from you

1. ~~**Task 9 output**~~ — ✅ done, 33/33 passing.
2. **The project ID** (or just drop the config into `src/firebase/config.ts`
   yourself — there is a `config.example.ts` to copy).
3. **The Firestore region** you picked.

Everything else is built and tested against the in-memory store, so this is the
last thing standing between the repo and a playable game.

## Cost

Everything above stays on the **free Spark plan**. No card, no billing account.
If the console ever prompts you to upgrade to Blaze, you've wandered into Cloud
Functions or Storage — back out. We deliberately don't use either.
