# Dageraad

Companion app for *Dageraad: 1 Nacht Weerwolven & Waaghalzen* with our house rules.

Current state: **night-phase resolution engine + day phase, complete and tested.**
No UI, no Firebase wiring yet.

```bash
npm install
npm test        # 19 tests
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
  role in memory. Prefer running it on **the tablet** — a neutral device in the
  middle of the table that nobody is holding during the night. Failing that it
  falls to the room creator's phone, which is worse.
- **The referee's tab must stay open** for the whole night. Lock the phone or
  lose signal mid-round and resolution stalls until it's back.

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
  schedule.ts   round + dependency scheduling (anti-leak)
  dayphase.ts   voting, tie/abstain/Bodyguard rules, win conditions
  presets.ts    default role set + the two mode configs
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
the timing path may read the deal.** `schedule.ts` already obeys this; the
orchestration layer must too.

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

**Not yet built** — this is the orchestration layer, and it's the next task.

---

## House rules encoded here

| | |
|---|---|
| **Dubbelganger** | Copied action fires at the **Dubbelganger's own slot**, whatever it copied. Copying the Medium therefore peeks before the Heks and Dorpsgek move anything. No chaining onto another Dubbelganger. |
| **Dorpsgek** | Exempt from the rotation: the **acting** player's card, any shielded card (stays put, the rest rotate around it), plus one designated seat in the `designate` variant. When the Dubbelganger copies this, the *Dubbelganger's* card is the exempt one and the real Dorpsgek's card moves normally. |
| **Heks** | Chooses among the **three** centre cards — never the Alpha Wolf's card. Always gets a real receipt for what she saw, because the physical Heks *does* look; the pre-commit is our constraint, not her weakness. Her conditional rule branches **three ways** (Wolf / Looier / village) — a two-way wolf-or-not rule would silently arm a Looier. |
| **Alpha Wolf** | Stays **blind**. Never learns the card she displaced, only that her swap executed. That blindness is the role's design, so we don't restore it. Same for the Dronkaard. |
| **Medium** | A wolf is not flipped face-up; anything else is. May swap with the Looier — pre-committed in mode 2, live in mode 1. |
| **Bodyguard** | If they are the top vote target the vote is voided and nobody dies. Differs from the printed rulebook, deliberately. |
| **Looier** | Their own vote never counts, judged on their **final** card. |

**Three centre cards + one separate wolf card.** `centerCount` is 3 and the
Alpha Wolf's card lives in its own slot outside it. Once she swaps, the
displaced card sits in that fourth slot and must **not** become selectable — a
Heks acting later still picks from the original three. Enforced structurally by
`centerSlot()`'s range check, and tested.

---

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

- Orchestration layer (the fixed timeline above, latency telemetry, host pause)
- Firestore schema + security rules — needs an Opus pass
- Any UI; the chess-puzzle filler; the tablet display
- `onderzoeker` (reveal-then-decide; would add a third round), Curator + artifacts
- Eyes-closed / AI narrator mode — deprioritized on purpose

## When Firebase is needed

Not yet — the engine runs and tests with no cloud anything. At wiring time:
create a Firebase project, enable **Firestore** and **Anonymous Auth**, and add
a web app to get the config. Hosting comes last, at deploy.
