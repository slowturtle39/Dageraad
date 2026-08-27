import { describe, expect, it } from 'vitest';
import { homeUrl, roomCodeFromUrl, roomUrl } from './roomlink.js';

/**
 * One link in a group chat is the entire distribution story: no app store, no
 * install. So these two functions are the front door.
 */

describe('building a link to share', () => {
  it('puts the code in the hash, where a server never sees it', () => {
    // A hash is not sent to the server, so a room code cannot land in a
    // Hosting access log.
    expect(roomUrl('https://dageraad.web.app/', 'ABCDE'))
      .toBe('https://dageraad.web.app/#/ABCDE');
  });

  it('normalises whatever it is handed', () => {
    expect(roomUrl('https://x.dev/', 'ab cde')).toBe('https://x.dev/#/ABCDE');
  });

  it('does not stack hashes when re-shared from inside a room', () => {
    expect(roomUrl('https://x.dev/#/OLDXX', 'ABCDE')).toBe('https://x.dev/#/ABCDE');
  });
});

describe('reading the code somebody arrived with', () => {
  it('finds it', () => {
    expect(roomCodeFromUrl('https://x.dev/#/ABCDE')).toBe('ABCDE');
  });

  it('copes with a link typed without the slash, or in lower case', () => {
    expect(roomCodeFromUrl('https://x.dev/#ABCDE')).toBe('ABCDE');
    expect(roomCodeFromUrl('https://x.dev/#/abcde')).toBe('ABCDE');
  });

  it('returns null rather than failing on a mangled link', () => {
    // A bad link should drop you on the normal entry screen, not into a state
    // you cannot get out of.
    expect(roomCodeFromUrl('https://x.dev/')).toBeNull();
    expect(roomCodeFromUrl('https://x.dev/#/')).toBeNull();
    expect(roomCodeFromUrl('https://x.dev/#/TOOLONGCODE')).toBeNull();
    expect(roomCodeFromUrl('https://x.dev/#/ABCDO')).toBeNull();  // O is not in the alphabet
  });

  it('round-trips with roomUrl', () => {
    for (const code of ['ABCDE', 'ZZ234', 'MNPQR']) {
      expect(roomCodeFromUrl(roomUrl('https://x.dev/', code))).toBe(code);
    }
  });
});

describe('leaving a room on this device', () => {
  it('removes only the room hash and preserves an intentional query mode', () => {
    expect(homeUrl('https://x.dev/?demo&fast#/ABCDE'))
      .toBe('https://x.dev/?demo&fast');
  });
});
