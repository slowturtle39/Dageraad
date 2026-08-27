# FirestoreBackend Emulator Findings

This report records bugs found through `FirestoreBackend` running against the
real local Firebase Auth and Firestore emulators, and whether `MemoryBackend`
shares them. A green memory-only suite cannot otherwise reveal a backend
divergence.

| Finding | Severity | Fixed | MemoryBackend also affected? |
| --- | --- | --- | --- |
| A lobby player could create their player/member documents but `joinRoom` then failed when appending their uid to `room.seating`. The room update rule allowed only host/referee writes. This prevented real multiplayer rooms from reaching the first deal. | P1: playtest blocker | Yes. Active lobby members may now add themselves or reorder the physical seating, but cannot remove, replace, or duplicate an existing seat. | No. `MemoryBackend` permitted the intended join flow, so its tests hid this Firestore-rules divergence. |
| `npm run test:rules` inherited the live Firebase project from `.firebaserc` while the tests connected to `dageraad-rules-test`. With single-project emulator mode, that could hang the rules setup and obscure its result. | P1: verification blocker | Yes. The script explicitly starts local emulators with `--project dageraad-rules-test`; it never needs the live Firebase project. | No. This is emulator-process configuration, not backend behavior. |
| A dead host/referee device had no recovery path. | Deliberate trusted-group decision | Yes. An active member can take both roles only in an update that changes no game state and carries the rule-checked phrase `referee`. This is conscious friction, not a secret or protection against devtools. | No. The same `takeEmergencyControl` method is implemented and tested in both backends. |

The emergency route intentionally changes the previous threat model: any
active member who consciously confirms with `referee` can become referee and
read the deal. Milan explicitly approved that trusted-table trade-off. Outside
that route, no `assertFails` attack unexpectedly succeeded: the negative
real-client checks still refuse a non-referee starting a game and a player
writing another member's document.

## Verification

- `npm test`: 34 files, 436 tests passed.
- `npm run typecheck`: passed.
- `npm run test:rules`: 2 files, 76 tests passed: 68 rules attacks and 8
  FirestoreBackend scenarios against local Auth and Firestore emulators.
