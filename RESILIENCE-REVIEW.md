# Firestore Resilience Review

Review-only audit at `c1d7ed3` on 2026-08-26. No source files were changed.
Line references are to the current checkout.

## Findings Ranked By Evening Impact

### P0: A referee reload during night is not a safe resume

`runGame` reads the persisted engine state and calls `runNight` from its
beginning (`src/app/refereeRunner.ts:102-143`). The runner always sets phase
`night` and iterates every timeline window from index 0
(`src/orchestration/referee.ts:87-110`). Firestore persists the original deal,
submissions, partial private releases, and public events, but not a completed
window/checkpoint or the intermediate resolved state:

- deal and initial private cards: `src/firestore/backend.ts:244-299`;
- live window index: `src/firestore/roomstore.ts:35-39`;
- submissions keyed by window: `src/firestore/backend.ts:462-477`;
- released info/events are appended: `src/firestore/roomstore.ts:91-123`.

A reload can therefore reopen earlier windows, wait their full durations, and
append already-released information/events again. The raw material for a
deterministic replay exists, but there is no resume cursor or idempotency key.
**Table mitigation:** keep the referee tab awake and open; if it reloads during
night, stop the round rather than pressing start again.

Proposed fix: persist a per-window completion record and/or the resolved state
after each window, make release/event writes idempotent, and resume from the
first unfinished window.

### P1: Offline or rejected writes have no explicit UI-visible state

All Firestore listeners use only the success callback (`backend.ts:322-330,
402-418, 423-430`; `sessionstore.ts:104-132`) and no listener requests
metadata. The code contains no `hasPendingWrites`, `fromCache`, or
`includeMetadataChanges` handling. Firestore can show a locally applied join,
seat change, vote, or round start before it reaches the server, then revert it
if rules reject it. `watchRoom` also combines independently arriving room,
members, and rounds snapshots (`backend.ts:311-333`), so a transient
scoreboard/seating combination can be from different server moments.

Proposed fix: expose connection and pending-write status, add listener error
callbacks, and label cached/pending table state as synchronising rather than
confirmed.

### P1: A new anonymous uid makes a returning person a stranger

`connect` obtains the current anonymous user or signs in anonymously
(`src/firestore/client.ts:41-66`). Clearing browser storage or using a private
window creates another uid. Membership, private card, submissions, votes, and
results are all keyed by uid (`src/firestore/schema.ts:263-278` and
`backend.ts:422-430`), so the new identity cannot read the old private card or
continue its old seat. Calling `joinRoom` creates a new player/member instead
(`backend.ts:136-180`).

Proposed fix: show the uid-loss case as "join as new player for next round";
do not promise account recovery without real authentication or a deliberate
host-mediated transfer mechanism.

## Required Questions

### 1. Referee reload mid-round

Recoverable from Firestore: initial deal/engine state, room phase/window,
submissions, votes, released private info, public events, members, and finished
round records. Only in memory: the runner's current loop position, clock and
remaining duration, `releasedSoFar`, `publicEventsWritten`, resolved
intermediate state, and day-runner state. The current implementation does not
safely reconstruct those in-memory values.

### 2. Listener leaks

`watchRoom` creates room, members, and rounds subscriptions and returns one
function that calls all three unsubscribers (`backend.ts:322-333`): no leak in
that path. `watchPlayers` likewise stops all three (`backend.ts:402-418`), and
`watchPrivate`, `watchMembers`, and `watchRounds` each return their direct
unsubscribe. The concern is error visibility, not an unclosed normal path.

### 3. Optimistic local cache

The most confusing temporary states are a late joiner appearing before their
member/seat sequence fully confirms (`backend.ts:160-180`), a newly dealt
seating/current round before all listener collections catch up, and standings
recomputed from a new members snapshot plus old rounds (or reverse). A rejected
write rolls back, but no code tells the table that it was provisional.

### 4. `startGame` batch failure and retry

The deal uses one `writeBatch` containing room, engine, and every private
document (`backend.ts:263-299`), so Firestore commits it atomically: no
server-visible half-deal. There is no retry policy. During bad connectivity,
the local SDK may show pending batch state before acknowledgement; a retry can
then see cached `phase: night` and refuse with "a round is already running", or
later learn the batch was rejected. It is safe from a partial server deal, but
not operationally clear at the table. Proposed fix: surface pending/failed
commit status and offer a reload-and-confirm flow before retrying.

### 5. `recordRound` check-then-write race

`backend.ts:559-563` first checks existence, then delegates to `setDoc` in
`sessionstore.ts:143-156`; this races between two tabs of the same referee.
The rules make `/rounds/{n}` create-only and bind the document id to the current
round (`firestore.rules:301-315`). One write wins; the other is denied rather
than overwriting the score. The race is harmless to integrity but currently
surfaces as an unhandled write failure. Proposed fix: treat an already-exists/
permission-denied result as "round was already recorded; reload standings."

### 6. Anonymous-auth identity change

See P1 above. A changed uid is intentionally not the same player; it cannot
resume private data or reclaim a seat. This is safe for role secrecy but needs
plain UI copy before a live evening.
