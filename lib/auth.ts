import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'PRODUCT_MANAGER' | 'ORDER_MANAGER' | 'CUSTOMER';
export type Permission = 'pricing:read' | 'pricing:write' | 'audit:read' | 'orders:write' | 'inventory:write' | 'users:manage';

const MATRIX: Record<Permission, Role[]> = {
  'pricing:read': ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ORDER_MANAGER'],
  'pricing:write': ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER'],
  'audit:read': ['SUPER_ADMIN', 'ADMIN'],
  'orders:write': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER'],
  'inventory:write': ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER'],
  'users:manage': ['SUPER_ADMIN'],
};
export const can = (role: Role, perm: Permission) => MATRIX[perm].includes(role);

/** scrypt, per-user random salt. Format: s1$<salt>$<hash> */
export function hashPassword(pw: string): string {
  if (pw.length < 12) throw new Error('password must be at least 12 characters');
  const salt = randomBytes(16);
  return `s1$${salt.toString('base64')}$${scryptSync(pw, salt, 64).toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [v, s, h] = stored.split('$');
  if (v !== 's1' || !s || !h) return false;
  const expect = Buffer.from(h, 'base64'), got = scryptSync(pw, Buffer.from(s, 'base64'), expect.length);
  return timingSafeEqual(expect, got);
}

export interface Session { uid: string; exp: number }
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export function signSession(s: Session, secret: string): string {
  if (secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 chars');
  const body = b64(JSON.stringify(s));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifySession(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session; return s.exp > now ? s : null; } catch { return null; }
}

/** Fixed-window limiter. In-memory: use Redis/Upstash when running more than one instance. */
export function makeRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    return ++h.n <= max;
  };
}
