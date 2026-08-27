import { isValidRoomCode, normaliseRoomCode } from './backend.js';

/**
 * The room code in the address bar.
 *
 * One link shared in a group chat is the whole distribution story — there is
 * no app store and no install (§ concept). So the code lives in the URL, and
 * opening that URL puts you straight on the join screen with it filled in.
 *
 * It goes in the HASH rather than the query string, deliberately: a hash never
 * reaches the server, so a room code cannot end up in a Hosting access log,
 * and changing it does not reload the page mid-evening.
 */

export function roomUrl(base: string, code: string): string {
  const clean = normaliseRoomCode(code);
  // Strip any existing hash so re-sharing a link from inside a room does not
  // produce ...#/ABCDE#/FGHIJ.
  const root = base.split('#')[0] ?? base;
  return `${root}#/${clean}`;
}

/**
 * The code somebody arrived with, or null.
 *
 * Anything that is not a valid code is treated as no code at all rather than
 * as an error: a mangled link should drop you on the normal entry screen, not
 * into a failure state you cannot get out of.
 */
export function roomCodeFromUrl(url: string): string | null {
  const hash = url.split('#')[1];
  if (!hash) return null;
  const code = normaliseRoomCode(hash.replace(/^\/+/, ''));
  return isValidRoomCode(code) ? code : null;
}
