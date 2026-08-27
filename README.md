# Dageraad

Companion app for *Dageraad: 1 Nacht Weerwolven & Waaghalzen* with our house rules.

Current state: **engine, timeline, orchestration, UI and Firestore rules all
built and tested.** Not yet wired to a live Firebase project — see `SETUP.md`.

```bash
npm install
npm test        # 113 tests
npm run dev     # the demo: phone / tablet / lobby, nl + en
npm run typecheck
```

---

## Trust model — read this before wiring anything up

We are staying on Firebase's **free Spark plan**, which means **no Cloud Functions**
(deploying them requires the Blaze plan and a credit card on file). That has one
consequence worth stating plainly:

Firestore is a *database*, not a place to run code. Its security rules can only
answer yes/no to "may this user read this document" — they cannot replay a night.
So something has to actually execute the resolution, and on the free plan that
something is **a browser at the table**.

- **Safe regardless:** ordinary players cannot read each other's cards. Each
  player's secret lives in a document whose rule is "readable only by its owner."
  Player B cannot fetch player A's card, devtools or not.
- **The referee is the exposure.** Whoever computes the resolution holds every
  role in memory.
- **The referee's tab must stay open** for the whole night. Lock the phone or
  lose signal mid-round and resolution stalls until it's back.

### The group chooses whose browser — on screen, in words

Because the exposure is real and unavoidable, it is not buried in this file.
The room-creation screen (`src/ui/setup.ts`) asks the question directly and
says what each answer costs. Player-facing, the device is the **table device**
(*tafelapparaat*); internally it is still `refereeUid` and nothing about the
rules changed.

| On screen | `playing` | What it means |
| --- | --- | --- |
| **Separate table device** (recommended) | `false` | A spare tablet, laptop or old phone runs the game and **takes no seat**. It can technically read every card, which is exactly why it is not dealt one — and why its screen shows only what everyone may know, so it can lie face-up on the table. |
| **A player's own phone** (trusted group) | `true` | One player runs it and plays along. No extra hardware, but that phone can technically read every card, including yours. Appropriate for a group that trusts each other; not for strangers. |

The screen states the trade-off of the second option in plain language, and
states it **before** the create button rather than after — a consequence you
read having already committed is not a choice you were offered. The chosen
device remains the controller in normal play. If it fails, an active member can
consciously transfer both host and referee control by confirming `referee`; this
is trusted-group recovery, not a way to hide the fact that the new controller
can read every card.

Softening that wording is the one genuinely dishonest thing this app could do.
A group that picked the convenient option without being told was misled, and
they find out when somebody wonders aloud how the host always guesses right.

**The engine is written so this is reversible.** `src/engine/` imports no
Firebase, no `window`, no timers — it is a pure function of (deal + answers) →
(resolved state + per-seat private info). If the group ever wants real secrecy,
the same module moves into a Cloud Function untouched; only the wiring changes.
**Do not import Firebase into `src/engine/`.** That constraint is the whole
escape hatch.

---

## Architecture

```
src/engine/
  types.ts      core types + the decision protocol
  roles.ts      role library, teams, isWolf, default night order
  state.ts      card/slot model, swaps, the Dorpsgek rotation
  appliers.ts   per-role night actions, as generators
  resolve.ts    canonical-order replay driver
  schedule.ts   round scheduling (delegates gate logic to timeline.ts)
  timeline.ts   the fixed night timeline (anti-leak)
  telemetry.ts  latency capture + duration calibration
  dayphase.ts   voting, tie/abstain/Bodyguard rules, win conditions
  suspicion.ts  private suspicion tracker scoring
  presets.ts    default role set + the two mode configs

src/orchestration/    (knows about time; still knows nothing about Firebase)
  replay.ts     replay-until-blocked, so the engine can stay synchronous
  referee.ts    the night loop: windows, deadlines, timed reveal release
  dayrunner.ts  discussion timer, suspense extension, vote window
  clock.ts      Clock interface + FakeClock + PausableClock (host pause)
  store.ts      RoomStore interface + InMemoryRoomStore

src/ui/               (one palette, night and day — see below)
  table.ts      the seating circle, the home screen in every phase
  sheet.ts      prompts and panels drawn OVER the table, never instead
  stats.ts      tap-a-player history; the night phase's cover traffic
  voting.ts     vote + results sheets
  lobby.ts      seating arrangement (functionally required, not decoration)
  tablet.ts     the neutral shared display
  i18n.ts       nl default, en per device

src/firestore/
  schema.ts     document shapes, mirroring the rules
  rules.spec.ts rules tests, written as attacks
```

### Two rules everything else hangs off

**§6.0 — original role acts, final card wins.** A seat's night-order position
and which action it performs come from `originalRole`, fixed at deal time and
never mutated. Which team it *wins* with comes from whatever card it is holding
at dawn. Cards move all night; turns do not. Both are tracked separately and
conflating them is the single easiest way to break this engine.

**Cards are instances, not role names.** There are duplicate Dorpelingen and
several Weerwolven, and a public face-up reveal has to follow the *card* as it
gets swapped around — not the slot it happened to be in when it was flipped.

### Roles as generators

Each role's action is a generator that **pauses when it needs a decision**.
That is what lets both resolution modes share one set of rules rather than two
implementations that drift:

- **Mode 1, `dependency`** — everyone chooses at once; reveals are released as
  each seat's prerequisites clear. Reveal-then-decide roles answer their pauses
  **live**. Nothing pre-commits.
- **Mode 2, `tworound`** — everyone submits up front; the pre-commit resolver
  answers the reveal-dependent pauses from stored rules, which is the *only*
  reason the night stays at two rounds instead of three.

The waiting in mode 1 is about **seeing results, not making choices** — the
Mystieke Wolf picks her target immediately and simply learns the answer later,
once the Alpha Wolf has resolved.

### The anti-leak invariant

**Every timing constant is derived from the public active-role list. Nothing in
the timing path may read the deal.** `timeline.ts` owns this logic; nothing else
may reimplement it.

The active role *set* is public — everyone knows whether the Alpha Wolf is in
this game. What is secret is whether her card was **dealt to a player or is in
the centre**, and that is what timing leaks: if nobody is playing her, a naive
implementation resolves that step instantly, and the short wait tells the
Mystieke Wolf exactly where the card is.

**A fixed-length window IS the padding** — no time is added, because the window
is needed anyway. A window whose role turned out to be in the centre simply
passes with nobody tapping, and looks identical from outside.

Each role's reveal lands when **its own** dependency clears, not at the end of
the night. The Alpha Wolf's action is a single tap (the card is always the
centre wolf card), and nothing before the Mystieke Wolf mutates anything else —
so she has her card by about second 9 and is done. Target timeline for the
default set, mode 1:

| t | What |
|---|---|
| 0 | Deal. Everyone reads their role and taps in parallel. Droomwolf sees the wolves at once. |
| ~8s | Alpha Wolf window closes. Swap applies. |
| ~9s | **Mystieke Wolf sees her card — done.** Dubbelganger sees what it copied. |
| 9→21s | Dubbelganger's second decision. |
| ~21s | Heks sees her centre card. |
| 21→31s | Heks picks her target. |
| ~32s | Dorpsgek applies. Medium sees her card. |
| 32→38s | Medium's Looier swap, if it came up. |

Roles needing a second decision need padding on **both** halves: the reveal they
wait on lands at a fixed offset, *and* their window exists at fixed length even
when nobody plays the role they depend on.

Durations self-calibrate from measured submission latency, but must stay
**public per-role constants frozen at room creation** — per-player, or adapting
mid-night, is the leak itself. Calibrate on p90 of submitted samples. A host
pause button covers AFK players; discard paused windows from telemetry.

Built in `timeline.ts`, calibration in `telemetry.ts`, audited by
`timeline.test.ts`. Actual output for the default set:

```
MODE 1 (dependency)  total 40s      MODE 2 (tworound)  total 22s
  0s→8s   everyone taps               0s→8s   everyone taps
  9s→21s  dubbelganger                9s→21s  dubbelganger
  22s→32s heks
  33s→39s medium                    reveals: 9s  droomwolf, alphawolf,
                                              mystiekewolf, dubbelganger
reveals: 9s  droomwolf, alphawolf            22s  heks, leerlingziener,
                mystiekewolf, dubbelganger        dorpsgek, medium
         22s heks
         33s leerlingziener, dorpsgek, medium
```

### The physical tell — and why the table view must not change colour

Server-side timing rigor does nothing about the leak happening *in the room*.
If most players finish tapping at 8s and only the Dubbelganger is still tapping
at second 20, anyone glancing around the table has their identity for free.
This affects **both modes** — mode 2's round 2 is the Dubbelganger alone too.

Cover: **tapping a player shows their historical stats**, and that is the
*default* night screen — you land on the seating circle once you've chosen (or
immediately, if you have no action), so tapping is the table's resting state
rather than something a bored player might not bother with. A second decision
prompt appears *over* that same surface.

Hard UI constraints that make or break it:

- **The night table view and the day table view must look the same.** No colour
  swap on state change — the glow off someone's face changes even if they never
  look at the screen, and that is itself a tell.
- **The action prompt must overlay the table view, not replace it.** A different
  layout or colour is readable from across the table without reading a word.
- **Stats are historical only.** Wins, per-role win rate, vote accuracy. The
  moment it shows anything about tonight it is a worse problem than the one it
  solves.
- Stay as close as possible to the physical game's art style.

Residual risk worth naming: this covers *phone activity*, not human behaviour.
Someone deliberating looks different from someone idly scrolling. True of the
physical game too, and outside the app's control.

A chess-puzzle filler can be added later if stats alone don't hold attention.

---

## House rules encoded here

| | |
|---|---|
| **Dubbelganger** | Copied action fires at the **Dubbelganger's own slot**, whatever it copied. Copying the Medium therefore peeks before the Heks and Dorpsgek move anything. No chaining onto another Dubbelganger. |
| **Dorpsgek** | **He picks the direction and nobody else learns it** — no screen names one. Exempt from the rotation: the **acting** player's card, and any shielded card (stays put, the rest rotate around it). When the Dubbelganger copies this, the *Dubbelganger's* card is the exempt one and the real Dorpsgek's card moves normally. |
| **Dorpsgek (`designate`)** | As above, plus he may hold one further card still. **Only that player is told**, and told only that it happened — not by whom, and not whether the actor was the Dorpsgek Alt or a Dubbelganger copying them; either would be a free read on somebody's role. The lock covers this shift alone: not other actions, and not a later Dorpsgek's turn. |
| **Heks** | Chooses among the **three** centre cards — never the Alpha Wolf's card. Always gets a real receipt for what she saw, because the physical Heks *does* look; the pre-commit is our constraint, not her weakness. In mode 2 she commits a rule up front and it branches **three ways** (Wolf / Looier / village) — a two-way wolf-or-not rule would file the Looier under village and silently arm him. In mode 1 she simply chooses live. |
| **Alpha Wolf** | Stays **blind**. Never learns the card she displaced, only that her swap executed. That blindness is the role's design, so we don't restore it. Same for the Dronkaard. |
| **Medium** | A wolf is not flipped face-up; anything else is. Turning over the Looier **forces** the swap — no yes/no. She hands her Medium card to that player, who is never told, and from then on wins only by being lynched herself. The Looier is deliberately *not* flipped: a publicly revealed Looier is one nobody will ever lynch, which would turn a forced swap into a guaranteed loss. Having no decision left is what dropped her out of `precommitRoles` in both modes. |
| **Bodyguard** | **Shields instead of voting.** Names one player once voting opens; every vote against them is cancelled, his own included — he casts none. Naming is compulsory, so the abstain button is taken from him. He may not shield himself, which is what keeps him killable. The shield resolves on whoever holds the Bodyguard card **at dawn**, so a swapped-away Bodyguard shields nobody and somebody else shields without knowing it. He cancels ballots, not bullets: the Jaeger's shot goes through. Differs from the printed rulebook, deliberately. |
| **Looier** | Their own vote never counts, judged on their **final** card. |

**Three centre cards + one separate wolf card.** `centerCount` is 3 and the
Alpha Wolf's card lives in its own slot outside it. Once she swaps, the
displaced card sits in that fourth slot and must **not** become selectable — a
Heks acting later still picks from the original three. Enforced structurally by
`centerSlot()`'s range check, and tested.

---

## Firestore layer

```
firestore.rules              security rules
src/firestore/schema.ts      document shapes, mirroring the rules
src/firestore/rules.spec.ts  rules tests, written as attacks
```

### ✅ Rules verified — 33/33 passing (Windows, 2026-08-25)

```bash
npm run test:rules     # boots the emulator, runs the attack suite
```

Every `assertFails` attack case was correctly denied — no permissive-rule leaks
— and no legitimate action is blocked by an over-strict rule. The
`PERMISSION_DENIED` lines in the emulator log are expected; they are the attacks
being refused.

Needs **Java 11+** (the emulator is a Java program) and internet on first run.
The script invokes firebase-tools and vitest through `node` directly rather than
the `node_modules/.bin` shims, because npm 11 on Windows does not always create
them.

### The shape of the problem

On the free plan the referee genuinely must read every player's card, and no
rule can change that. What the rules do is ensure **nobody else can** outside
the group-approved emergency recovery route.

Normal updates cannot move `refereeUid`. Emergency recovery requires an active
member, the phrase `referee`, and an update that changes only `hostUid`,
`refereeUid`, and the confirmation field. This is intentional friction for a
trusted physical group, not a technical secret: someone who confirms it becomes
able to read the entire deal.

### Decisions worth knowing about

**There are no mutable stats counters anywhere.** Per-game outcomes are
append-only documents under the room; profile stats are aggregated client-side
by reading them. That removes "who is allowed to increment my win count" as a
question entirely and makes history tamper-evident. `profiles` uses an explicit
key allowlist, so a client cannot smuggle a `wins` field in.

**Late writes are blocked by matching `windowIndex`,** not by trusting clocks.
A submission is accepted only while the room is still on the window it was
made for.

**No-self-vote is enforced in the rules,** not just the UI, so a hand-crafted
write cannot do it either. Votes stay unreadable by other players until the
phase reaches `results` — otherwise the last person to vote sees the tally
before deciding.

**Calibration samples are keyed by role name and never carry a uid.** Attaching
one would turn that collection into a public record of who played what; there
is a test asserting the write is rejected.

### Known residual risks

- A malicious **referee** sees everything. Inherent to the free plan; use the
  tablet. Moving the engine into a Cloud Function is the only real fix.
- A malicious referee could also **write false results**. Append-only makes it
  visible, not impossible.
- Votes don't validate that the target is actually a player in the room; the
  engine ignores nonsense targets.
- Any signed-in user can read any room document if they know its ID. Room IDs
  are random, so this is enumeration-resistant rather than access-controlled.

## Open rules questions

- **All wolves in the centre.** §8 doesn't cover it. Standard One Night handling
  is implemented (village wins only if nobody is lynched) — confirm with the group.
- **Looier + village simultaneously.** Currently independent: the Looier winning
  doesn't block a village win. §8 doesn't say.
- **Tie → wolves win** and the **>50% abstain** rule are both flagged tentative
  in §7. Both implemented as written; `DayOptions.tieRule` is the seam to change it.
- **Bodyguard vote accuracy** scores `null` rather than a guess — §10 flags what
  "correct" even means for them as undecided.
- **§5.2 of the concept doc is out of date.** It describes mode 1 as
  "one role at a time, turn-based." It is not — it's dependency-driven parallel.

## Not built yet

- **Firebase wiring.** Everything runs against `InMemoryRoomStore`; a
  `FirestoreRoomStore` implementing the same six methods drops in once the
  project exists. See `SETUP.md`.
- **Curator + artifacts.** The placement mechanic is trivial, but the artifact
  list and their effects are specified nowhere, and inventing house rules Milan
  would then have to unpick is worse than leaving it. Needs his spec.
- **Profile pictures.** Names and initials work; photo upload does not.
- **Eyes-closed / AI narrator mode.** Deprioritised on purpose — the AI is more
  work and the group prefers the phone mode because it is faster.

## When Firebase is needed

Not yet — the engine runs and tests with no cloud anything. At wiring time:
create a Firebase project, enable **Firestore** and **Anonymous Auth**, and add
a web app to get the config. Hosting comes last, at deploy.
