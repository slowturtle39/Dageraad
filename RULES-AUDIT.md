# Firestore Rules Audit

Audited commit: `fb3f37b` (FirestoreBackend) plus the audit hardening in this
commit.

## Result

`npm run test:rules` passed **66 tests** locally using the Firestore Emulator.
No `assertFails` assertion unexpectedly succeeded, so the executed suite found
no permissive-rule information leak. `npm test` passed **294 tests** and
`npm run typecheck` completed cleanly.

## Finding Fixed

### P1: `currentRound` could skip forward arbitrarily

The old rule only rejected a backward move. The backend advances one round at a
time, but an authorized host or referee could set `currentRound` directly from
4 to 99. That could manufacture a later member join boundary and corrupt
session timing.

The rule now permits only an unchanged counter or a one-step integer advance.
The emulator test `cannot skip ahead and manufacture a later join boundary`
guards this behavior.

## Required Checks

- `refereeUid` is immutable after room creation. The existing attack tests deny
  promotion by a player, host, and referee.
- Member documents allow only `uid`, `joinedAtRound`, and `leftAtRound`; score-
  shaped and unknown fields are denied.
- Member creation pins `joinedAtRound` to `currentRound + 1`; it cannot be
  backdated, moved forward, or altered on update.
- Round records are referee-only, create-only, and bind their document id to
  the round number. Updates and deletes are denied.
- `currentRound` cannot rewind or skip forward.

## Rule Evaluation Cost

The new `members` create/update and `rounds` create rules read only their room
document through `roomDoc()`. Repeated calls within one evaluation use the same
path and are cached by Firestore Rules. Each operation therefore requires at
most one additional document access, well below Firestore's 10-access limit per
single-document write and 20-access limit per atomic operation.

## Deployment

These rules are emulator-tested only. They must not be deployed to the live
Firebase project without Milan's explicit approval.
