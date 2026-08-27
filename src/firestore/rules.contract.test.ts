import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The seed cannot come back as a stored field. Checked offline, on purpose.
 *
 * The real security tests live in rules.spec.ts and need the Firestore
 * emulator (`npm run test:rules`). These run in the ordinary suite, so the one
 * invariant that took a security hole to notice is guarded on every commit
 * rather than only when somebody remembers to start an emulator.
 *
 * THE HOLE: `SessionMember.seeded` was the number of points a latecomer's
 * scoreboard row starts on — written by the joining client, into a document
 * that client owns. `seeded: 9999` from devtools won the evening, and no rule
 * could refuse it: rules answer "may you write this document", never "was 9999
 * the right floor at round four", which needs the whole evening replayed.
 *
 * The fix has three parts and they only work together, which is why one test
 * file checks all three: the field is gone from the model, the rules allowlist
 * the member document's keys so it cannot be re-added from outside, and the
 * rounds it is derived from are append-only.
 */

const rules = readFileSync('firestore.rules', 'utf8');
const session = readFileSync('src/app/session.ts', 'utf8');
const schema = readFileSync('src/firestore/schema.ts', 'utf8');
const spec = readFileSync('src/firestore/rules.spec.ts', 'utf8');

/** The body of one `match /path/{id} { ... }` block, braces balanced. */
function matchBlock(src: string, path: string): string {
  const header = `match ${path} {`;
  const start = src.indexOf(header);
  expect(start, `no match block for ${path}`).toBeGreaterThan(-1);
  // Open at the block's OWN brace: the path contains braces of its own, and
  // counting from the first one in the line gets the nesting wrong.
  let depth = 0;
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${path}`);
}

/** Field names declared on a TypeScript interface, ignoring its comments. */
function interfaceFields(src: string, name: string): string[] {
  const start = src.indexOf(`export interface ${name} {`);
  expect(start, `no interface ${name}`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}', start));
  return [...body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    .matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]!);
}

describe('the seed is not a stored field anywhere', () => {
  it('is absent from the session model', () => {
    // Pinned as an exact list: a field added to a member document is a field
    // one player can write, so adding one has to be deliberate and come with
    // an argument. friendId/friendName are LABELS for history spanning
    // evenings — they carry no points and authorise nothing, and the uid above
    // is still what every rule checks.
    expect(interfaceFields(session, 'SessionMember')).toEqual([
      'uid', 'joinedAtRound', 'leftAtRound', 'friendId', 'friendName',
    ]);
  });

  it('is absent from the Firestore document shape', () => {
    expect(interfaceFields(schema, 'SessionMemberDoc')).toEqual([
      'uid', 'joinedAtRound', 'leftAtRound', 'friendId', 'friendName',
    ]);
  });

  it('carries no field that could be worth points', () => {
    // The actual property, stated directly rather than implied by the list
    // above: whatever a member document grows, none of it may be a score.
    for (const iface of ['SessionMember', 'SessionMemberDoc'] as const) {
      const src = iface === 'SessionMember' ? session : schema;
      for (const field of interfaceFields(src, iface)) {
        expect(field).not.toMatch(/seed|point|score|win|round(s)?Played/i);
      }
    }
  });

  it('is still visible on the scoreboard, because hiding it would be worse', () => {
    // Derived, not stored — but a latecomer's head start has to be legible or
    // the scoreboard is lying about where their points came from.
    expect(interfaceFields(session, 'SessionStanding')).toContain('seeded');
  });

  it('is derived from the rounds, which is what makes it unforgeable', () => {
    // `standings` walks round by round so a joiner's floor is the floor AT the
    // round they arrived. A member-then-round loop cannot know that, and a
    // refactor back to one would silently need a stored seed again.
    expect(session).toMatch(/for \(let round = 1; round <= lastRound; round\+\+\)/);
  });
});

describe('the rules refuse to let it be re-added from outside', () => {
  const members = matchBlock(rules, '/members/{memberUid}');
  const rounds = matchBlock(rules, '/rounds/{roundId}');

  it('allowlists the member document keys, on create and on update', () => {
    // hasOnly is what makes a re-added `seeded` a rejected write rather than a
    // field one client happens to ignore.
    const allowlists = members.match(/hasOnly\(\s*\[[^\]]*\]\s*\)/g) ?? [];
    // One per write rule that exists — a human create, a human update, and the
    // referee's create of an AI player's membership. Counted rather than
    // hard-coded so a NEW write rule without an allowlist fails here.
    const writes = members.match(/allow (create|update)[^:]*:/g) ?? [];
    expect(allowlists).toHaveLength(writes.length);
    expect(allowlists.length).toBeGreaterThanOrEqual(3);
    for (const list of allowlists) {
      expect(list).toContain("'uid'");
      expect(list).toContain("'joinedAtRound'");
      expect(list).toContain("'leftAtRound'");
      expect(list).not.toContain('seeded');
    }
  });

  it('pins joinedAtRound to the round actually being played', () => {
    // The joiner's only remaining influence over their own seed. If this
    // comparison goes, `joinedAtRound: 99` is the new `seeded: 9999`.
    expect(members).toMatch(/joinedAtRound == currentRound\(roomId\) \+ 1/);
  });

  it('never lets joinedAtRound move once it is set', () => {
    expect(members).toMatch(
      /joinedAtRound == resource\.data\.joinedAtRound/,
    );
  });

  it('keeps a HUMAN membership as history — it can never be deleted', () => {
    // This used to be `allow delete: if false;`. An AI player added to a
    // practice lobby and then removed again is the one thing that may go, so
    // the assertion moved from "nothing deletes" to the property that was
    // always the point: a delete is impossible unless the target is a bot, in
    // a practice room, before anything has been dealt. Drop ANY of those three
    // and a host can erase the rounds somebody played.
    const deletes = members.match(/allow delete:[^;]*;/g) ?? [];
    expect(deletes).toHaveLength(1);
    const rule = deletes[0]!;
    expect(rule).toContain('isBotPlayer(roomId, memberUid)');
    expect(rule).toContain("isPractice(roomId)");
    expect(rule).toContain("inPhase(roomId, 'lobby')");
    expect(rule).toContain('isReferee(roomId)');
  });

  it('keeps round records append-only, since they are now the score', () => {
    expect(rounds).toMatch(/allow update, delete: if false;/);
    expect(rounds).toMatch(/round == currentRound\(roomId\)/);
    expect(rounds).toMatch(/roundId == string\(request\.resource\.data\.round\)/);
  });

  it('never lets the round counter go backwards', () => {
    // A rewind would re-open a floor the evening has already passed.
    expect(rules).toMatch(/function roundNeverRewinds\(\)/);
    expect(matchBlock(rules, '/rooms/{roomId}')).toMatch(/roundNeverRewinds\(\)/);
  });

  it('mentions the word `seeded` only where it explains its own absence', () => {
    const code = rules.replace(/\/\/.*/g, '');
    expect(code).not.toContain('seeded');
  });
});

describe('the emulator suite still attacks both new collections', () => {
  // These assertions cannot run without the emulator, so this checks they are
  // at least still written — a deleted attack test is invisible otherwise.
  it('tries to write a seed and expects to be refused', () => {
    expect(spec).toMatch(/assertFails\([\s\S]{0,400}seeded: 9999/);
  });

  it('tries to claim a round the evening has not reached', () => {
    expect(spec).toMatch(/assertFails\([\s\S]{0,400}joinedAtRound: 99/);
  });

  it('tries to have a player record their own round', () => {
    expect(spec).toMatch(/'rounds'/);
    expect(spec).toMatch(/assertFails\([\s\S]{0,300}as\(ALICE\), 'rooms', ROOM, 'rounds'/);
  });
});
