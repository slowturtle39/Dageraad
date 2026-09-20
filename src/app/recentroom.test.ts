// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { rememberedRoom, rememberRoom } from './recentroom.js';

describe('returning to the last table', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a valid room across the home screen', () => {
    rememberRoom('abcde');
    expect(rememberedRoom()).toBe('ABCDE');
  });

  it('never turns arbitrary storage into a room link', () => {
    localStorage.setItem('dageraad.lastRoom', 'not-a-room');
    expect(rememberedRoom()).toBeNull();
  });
});
