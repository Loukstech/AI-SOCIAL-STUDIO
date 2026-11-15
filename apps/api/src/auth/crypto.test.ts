import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  signToken,
  tokenFingerprint,
  verifyPassword,
  verifyToken,
} from './crypto.js';

const SECRET = 'secret-de-test-suffisamment-long';
const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('crypto', () => {
  /**
   * scrypt est volontairement coûteux : ces deux tests enchaînent plusieurs
   * dérivations et dépassent le délai par défaut de 5 s quand la suite tourne
   * en parallèle des builds du monorepo. Le délai est donc explicite.
   */
  const SCRYPT_TIMEOUT = 30_000;

  it(
    'hache un mot de passe avec un sel aléatoire et le vérifie',
    async () => {
      const first = await hashPassword('MotDePasse123!');
      const second = await hashPassword('MotDePasse123!');
      expect(first.startsWith('scrypt$')).toBe(true);
      expect(first).not.toBe(second);
      await expect(verifyPassword('MotDePasse123!', first)).resolves.toBe(true);
      await expect(verifyPassword('MotDePasse123!', second)).resolves.toBe(true);
      await expect(verifyPassword('autre-mot-de-passe', first)).resolves.toBe(false);
    },
    SCRYPT_TIMEOUT,
  );

  it(
    'refuse un hash malformé ou tronqué sans lever d’exception',
    async () => {
      const valid = await hashPassword('MotDePasse123!');
      await expect(verifyPassword('x', 'mot-de-passe-en-clair')).resolves.toBe(false);
      await expect(verifyPassword('x', 'scrypt$zz$zz')).resolves.toBe(false);
      await expect(verifyPassword('x', 'scrypt$$')).resolves.toBe(false);
      await expect(verifyPassword('MotDePasse123!', valid.slice(0, -2))).resolves.toBe(false);
      await expect(
        verifyPassword('MotDePasse123!', `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`),
      ).resolves.toBe(false);
    },
    SCRYPT_TIMEOUT,
  );

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

  it('chiffre et déchiffre un jeton OAuth en AES-256-GCM', () => {
    const token = 'EAAG1234567890abcdef';
    const sealed = encryptSecret(token, SECRET);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed, SECRET)).toBe(token);
  });

  it('utilise un IV aléatoire : deux chiffrements du même secret diffèrent', () => {
    const first = encryptSecret('meme-valeur', SECRET);
    const second = encryptSecret('meme-valeur', SECRET);
    expect(first).not.toBe(second);
    expect(decryptSecret(first, SECRET)).toBe('meme-valeur');
    expect(decryptSecret(second, SECRET)).toBe('meme-valeur');
  });

  it('refuse un chiffré altéré, une mauvaise clé ou un format inconnu', () => {
    const sealed = encryptSecret('jeton-sensible', SECRET);
    const parts = sealed.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}AA`].join('.');
    expect(decryptSecret(tampered, SECRET)).toBeNull();
    expect(decryptSecret(sealed, 'une-autre-cle-suffisamment-longue')).toBeNull();
    expect(decryptSecret('v2.a.b.c', SECRET)).toBeNull();
    expect(decryptSecret('nimportequoi', SECRET)).toBeNull();
    expect(decryptSecret('', SECRET)).toBeNull();
  });

  it('produit une empreinte SHA-256 stable, distincte du jeton brut', () => {
    const token = signToken({ sub: 'u', sid: 's', iat: 1, exp: future() }, SECRET);
    expect(tokenFingerprint(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenFingerprint(token)).toBe(tokenFingerprint(token));
    expect(tokenFingerprint(token)).not.toBe(token);
  });
});
