import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  signToken,
  tokenFingerprint,
  verifyPassword,
  verifyToken,
} from './crypto.js';

const SECRET = 'secret-de-test-suffisamment-long';
const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('crypto', () => {
  it('hache un mot de passe avec un sel aléatoire et le vérifie', async () => {
    const first = await hashPassword('MotDePasse123!');
    const second = await hashPassword('MotDePasse123!');
    expect(first.startsWith('scrypt$')).toBe(true);
    expect(first).not.toBe(second);
    await expect(verifyPassword('MotDePasse123!', first)).resolves.toBe(true);
    await expect(verifyPassword('MotDePasse123!', second)).resolves.toBe(true);
    await expect(verifyPassword('autre-mot-de-passe', first)).resolves.toBe(false);
  });

  it('refuse un hash malformé ou tronqué sans lever d’exception', async () => {
    const valid = await hashPassword('MotDePasse123!');
    await expect(verifyPassword('x', 'mot-de-passe-en-clair')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$zz$zz')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$$')).resolves.toBe(false);
    await expect(verifyPassword('MotDePasse123!', valid.slice(0, -2))).resolves.toBe(false);
    await expect(
      verifyPassword('MotDePasse123!', `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`),
    ).resolves.toBe(false);
  });

  it('signe et vérifie un jeton, et rejette toute altération', () => {
    const payload = { sub: 'user-1', sid: 'session-1', iat: 1, exp: future() };
    const token = signToken(payload, SECRET);
    expect(token.split('.')).toHaveLength(3);
    expect(verifyToken(token, SECRET)).toEqual(payload);
    expect(verifyToken(token, 'un-autre-secret-suffisamment-long')).toBeNull();
    expect(verifyToken(`${token}x`, SECRET)).toBeNull();
    expect(verifyToken('a.b', SECRET)).toBeNull();
    expect(verifyToken('', SECRET)).toBeNull();
  });

  it('refuse un jeton expiré ou sans identifiants', () => {
    const expired = { sub: 'user-1', sid: 'session-1', iat: 1, exp: 1 };
    expect(verifyToken(signToken(expired, SECRET), SECRET)).toBeNull();
    const invalid = { sub: '', sid: 'session-1', iat: 1, exp: future() };
    expect(verifyToken(signToken(invalid, SECRET), SECRET)).toBeNull();
  });

  it('produit une empreinte SHA-256 stable, distincte du jeton brut', () => {
    const token = signToken({ sub: 'u', sid: 's', iat: 1, exp: future() }, SECRET);
    expect(tokenFingerprint(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenFingerprint(token)).toBe(tokenFingerprint(token));
    expect(tokenFingerprint(token)).not.toBe(token);
  });
});
