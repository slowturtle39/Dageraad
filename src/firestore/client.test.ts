import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';

const authMocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  signInAnonymously: vi.fn(),
}));

vi.mock('firebase/auth', () => authMocks);

import { currentUid } from './client.js';

function authWith(user: { uid: string; getIdToken: () => Promise<string> } | null) {
  return {
    authStateReady: vi.fn().mockResolvedValue(undefined),
    currentUser: user,
    signOut: vi.fn().mockResolvedValue(undefined),
  } as unknown as Auth;
}

describe('Firebase anonymous identity bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies a restored anonymous user before exposing its uid', async () => {
    const getIdToken = vi.fn().mockResolvedValue('fresh-token');
    const auth = authWith({ uid: 'stable-uid', getIdToken });

    await expect(currentUid(auth)).resolves.toBe('stable-uid');
    expect(auth.authStateReady).toHaveBeenCalledOnce();
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it('replaces a cached anonymous user that Firebase has deleted', async () => {
    const getIdToken = vi.fn().mockRejectedValue({ code: 'auth/user-not-found' });
    const auth = authWith({ uid: 'stale-uid', getIdToken });
    authMocks.signInAnonymously.mockResolvedValue({ user: { uid: 'new-uid' } });

    await expect(currentUid(auth)).resolves.toBe('new-uid');
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(authMocks.signInAnonymously).toHaveBeenCalledWith(auth);
  });

  it('creates an anonymous identity when this browser has none', async () => {
    const auth = authWith(null);
    authMocks.signInAnonymously.mockResolvedValue({ user: { uid: 'first-uid' } });

    await expect(currentUid(auth)).resolves.toBe('first-uid');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(authMocks.signInAnonymously).toHaveBeenCalledWith(auth);
  });

  it('does not discard a stable identity because the network is temporarily down', async () => {
    const networkError = { code: 'auth/network-request-failed' };
    const getIdToken = vi.fn().mockRejectedValue(networkError);
    const auth = authWith({ uid: 'keep-me', getIdToken });

    await expect(currentUid(auth)).rejects.toBe(networkError);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
  });
});
