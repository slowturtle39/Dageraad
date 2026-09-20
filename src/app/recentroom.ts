import { isValidRoomCode, normaliseRoomCode } from './backend.js';

const KEY = 'dageraad.lastRoom';

export function rememberRoom(code: string): void {
  const clean = normaliseRoomCode(code);
  if (isValidRoomCode(clean)) localStorage.setItem(KEY, clean);
}

export function rememberedRoom(): string | null {
  const clean = normaliseRoomCode(localStorage.getItem(KEY) ?? '');
  return isValidRoomCode(clean) ? clean : null;
}
