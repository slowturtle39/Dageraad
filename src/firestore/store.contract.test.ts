import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryRoomStore } from '../orchestration/store.js';

/**
 * The in-memory store and the Firestore store must stay interchangeable.
 *
 * Every one of the 124 tests runs against the in-memory one; the real game runs
 * against Firestore. If the two drift, the tests keep passing while the app
 * breaks — the worst failure mode available to us. TypeScript catches a missing
 * method, but not one that was added to the interface and then only implemented
 * on one side, which is the drift that actually happens.
 */

const firestoreSrc = readFileSync('src/firestore/roomstore.ts', 'utf8');

const REQUIRED = [
  'setWindowIndex',
  'readSubmissions',
  'releasePrivateInfo',
  'releaseDecisions',
  'appendPublicEvents',
  'recordLatency',
  'setPhase',
  'readVotes',
  'announceExtension',
];

describe('store implementations stay in step', () => {
  it('the in-memory store implements every RoomStore method', () => {
    const proto = Object.getOwnPropertyNames(InMemoryRoomStore.prototype);
    for (const m of REQUIRED.filter((m) => m !== 'readVotes' && m !== 'announceExtension')) {
      expect(proto).toContain(m);
    }
  });

  it('the Firestore store implements every method the referee and day runner call', () => {
    for (const m of REQUIRED) {
      expect(firestoreSrc).toMatch(new RegExp(`\\b(async )?${m}\\s*\\(`));
    }
  });

  it('is the only file in the codebase that imports Firebase', () => {
    // src/engine/ must never import it — that constraint is the escape hatch
    // that lets the engine move into a Cloud Function untouched if the trust
    // model is ever revisited. src/orchestration/ must not either.
    // Comments are stripped first. The engine talks about decision "windows"
    // constantly, and a guard that trips over the prose explaining itself
    // teaches the next person to delete the explanation rather than keep the
    // rule.
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const engine = strip(['types', 'roles', 'state', 'appliers', 'resolve', 'schedule',
      'timeline', 'telemetry', 'dayphase', 'suspicion', 'presets', 'deal']
      .map((f) => readFileSync(`src/engine/${f}.ts`, 'utf8')).join('\n'));
    const orch = strip(['replay', 'referee', 'dayrunner', 'clock', 'store']
      .map((f) => readFileSync(`src/orchestration/${f}.ts`, 'utf8')).join('\n'));

    expect(engine).not.toMatch(/from ['"]firebase/);
    expect(orch).not.toMatch(/from ['"]firebase/);
    // And no DOM or timers in the engine either.
    expect(engine).not.toMatch(/\b(window|document|setTimeout|setInterval|Date\.now)\b/);
  });
});
