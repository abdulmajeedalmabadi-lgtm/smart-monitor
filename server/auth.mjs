import { createHash, timingSafeEqual } from 'node:crypto';

export function equalSecret(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
