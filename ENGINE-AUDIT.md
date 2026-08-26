# Engine Rule-Conformance Audit

Audited at `e5999b8` on 2026-08-26. This is a read-and-report audit: engine
source was not changed. `src/engine/conformance.test.ts` records the checked
behaviours and labels the two source-of-truth divergences explicitly.

## Written Rule Disagreements

### P1: Bodyguard behaviour conflicts with the authoritative PDF table

The authoritative table in `tools/build_status_pdf.py:346` says: when the
Bodyguard is the top vote target, the vote is void and nobody dies. The engine
does something else: `src/engine/dayphase.ts:93-129` makes the player holding
the final Bodyguard card protect the person they name, cancels ballots against
that person, and leaves the Bodyguard killable. It also records the special
`caused-village-loss` outcome in `src/engine/dayphase.ts:245-279`.

This is not a small wording difference: the two rules produce different
survivors and different score history. The current source code, the current
delegation brief, and existing tests favour the **target-shield** behaviour;
the PDF table and README house-rule table still describe the **Bodyguard-is-top
target** behaviour. Milan needs to pick one and update the other source.

### P1: Medium's Looier swap is optional in the authoritative PDF, forced in code

`tools/build_status_pdf.py:345` says the Medium "mag ruilen met de Looier"
(may swap). In `src/engine/appliers.ts:335-364`, seeing the Looier performs the
swap with no follow-up decision; `src/engine/roles.ts:52-55` removes the Medium
from reveal-then-decide scheduling as a consequence.

The current delegation brief calls out the "forced Medium", and code comments
say that was ruled on 2026-08-26. That makes the PDF table stale rather than
evidence that the engine is accidentally wrong, but it is still an
authoritative-source disagreement that needs reconciliation before playtest.

### P2: The Heks `conditional` variant has no engine-owned policy evaluator

The written rule requires three pre-committed branches: Wolf, Looier, and
village (`tools/build_status_pdf.py:343`). `HeksVariant` exists in
`src/engine/types.ts:47`, but the action in `src/engine/appliers.ts:223-257`
only accepts whatever second target its `AnswerProvider` supplies. There is no
engine representation or evaluation of the three branch policy; a provider can
implement it externally because the request includes the card seen.

That may be an intentional boundary, but today `heksVariant: 'conditional'`
does not itself change engine execution. The policy needs a tested owner
(outside the engine if that boundary is intentional) before the conditional
mode can be claimed as enforced.

## Confirmed Conformance

- **Dorpsgek:** `rotateSeats` in `src/engine/state.ts:46-78` excludes the
  acting seat, shields, and designated seat; it rotates the remaining ring
  with wrap-around. The duplicated role acts with the Dubbelganger as actor.
- **Dubbelganger:** `src/engine/appliers.ts:414-462` runs the copied action at
  the Dubbelganger's own seat and explicitly stops a Doppelganger-to-
  Doppelganger chain.
- **Alpha Wolf and Dronkaard:** `src/engine/appliers.ts:91-113` and
  `src/engine/appliers.ts:271-286` issue confirmation without a card reveal.
- **Heks centre selection:** `centerSlot` bounds every selection to the three
  centre slots; the separate Alpha Wolf slot cannot be selected.
- **Onderzoeker:** `src/engine/appliers.ts:369-405` stops immediately on a
  wolf or Looier and writes `assumedRole`; `finalRoleOf` gives that assumption
  priority at dawn.
- **Voting and wins:** `src/engine/dayphase.ts:70-187` implements strict
  majority abstention and hangs every tied top target. `finish` implements the
  Looier-alone win and the no-player-wolves case described in the PDF.

## Written Rules That Remain Ambiguous

- **Dorpsgek direction:** the written rule says a one-seat shift but does not
  define which increasing seat-number direction is visually "left" versus
  "right". The engine consistently uses a ring, but the table UI must label
  the physical direction from the players' point of view.
- **Conditional Heks ownership:** it is not stated whether the three-way
  precommit belongs in the pure engine or in an answer provider. The current
  engine permits the latter but does not enforce it itself.
