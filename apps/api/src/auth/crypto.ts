import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_COST = 16_384;
const SALT_HEX = new RegExp(`^[0-9a-f]{${SALT_LENGTH * 2}}$`, 'i');
const HASH_HEX = new RegExp(`^[0-9a-f]{${KEY_LENGTH * 2}}$`, 'i');

/** Hash de mot de passe : scrypt avec sel aléatoire, format `scrypt$<sel>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [scheme, saltHex, hashHex] = parts as [string, string, string];
  // Un sel ou un hash vide/tronqué ne doit jamais être considéré comme valide :
  // scrypt avec une longueur de clé nulle produirait sinon un faux positif.
  if (scheme !== 'scrypt' || !SALT_HEX.test(saltHex) || !HASH_HEX.test(hashHex)) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Jeton signé HMAC-SHA256 (format JWT compact), sans dépendance externe. */
export interface TokenPayload {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signToken(payload: TokenPayload, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const meta = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: string;
    };
    if (meta.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload.sub || !payload.sid || !payload.exp || payload.exp * 1000 <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Empreinte stockée en base : le jeton brut ne quitte jamais le serveur. */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export { SCRYPT_COST };
