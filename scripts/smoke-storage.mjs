#!/usr/bin/env node
/**
 * Test de bout en bout du stockage objet (§12).
 *
 *   node scripts/smoke-storage.mjs
 *   API_URL=http://localhost:3000 node scripts/smoke-storage.mjs
 *
 * Vérifie le cycle complet : upload multipart, clé privée calculée côté
 * serveur, URL signée réellement téléchargeable, expiration bornée,
 * isolation multi-tenant et suppression de l'objet.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const API_URL = (process.env.API_URL ?? 'https://ai-social-studio-api.onrender.com').replace(
  /\/$/,
  '',
);
const RUN_ID = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const PASSWORD = randomBytes(24).toString('base64url');
const TIMEOUT = Number(process.env.TIMEOUT ?? 45_000);

// PNG 1×1 transparent.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let checks = 0;
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function describe(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

async function call(path, { method = 'GET', token, org, body, form } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers['X-Organization-Id'] = org;
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

async function register(role) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: {
      email: `storage-${role}-${RUN_ID}@ai-social-studio.test`,
      password: PASSWORD,
      name: role,
      organizationName: `Stockage ${role} ${RUN_ID}`,
    },
  });
  ok(`Compte ${role} créé`, result.status === 201, describe(result));
  const orgs = await call('/organizations', { token: result.data.token });
  ok(`Organisation de ${role} disponible`, orgs.status === 200 && orgs.data?.length === 1);
  return { token: result.data.token, orgId: orgs.data[0].id };
}

async function main() {
  console.log(`Stockage objet E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register('owner');
  const other = await register('other');

  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), `visuel-${RUN_ID}.png`);
  form.append('kind', 'IMAGE');
  form.append('folder', 'Campagnes/2026');
  form.append('tags', 'test, stockage');
  const upload = await call('/media/upload', { method: 'POST', form });
  ok('Upload sans jeton refusé (401)', upload.status === 401, describe(upload));

  const created = await call('/media/upload', {
    method: 'POST',
    token: owner.token,
    org: owner.orgId,
    form,
  });
  ok('Upload multipart accepté (201)', created.status === 201, describe(created));
  const asset = created.data;
  ok('Le type est déduit du MIME', asset?.kind === 'IMAGE', String(asset?.kind));
  ok('La taille est celle du binaire reçu', asset?.sizeBytes === PNG.length);
  ok(
    'L’empreinte est calculée côté serveur',
    asset?.checksum === createHash('sha256').update(PNG).digest('hex'),
  );
  ok(
    'Le dossier et les tags sont enregistrés',
    asset?.folder === 'Campagnes/2026' && asset?.tags.includes('stockage'),
  );
  ok('Aucune URL publique permanente', asset?.sourceUrl === null, String(asset?.sourceUrl));
  ok('Le média signale un fichier privé', asset?.hasFile === true);

  const signed = await call(`/media/${asset.id}/url`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok('URL signée délivrée (200)', signed.status === 200, describe(signed));
  ok('URL signée dans le futur', new Date(signed.data?.expiresAt).getTime() > Date.now());
  const fetched = await fetch(signed.data.url, { signal: AbortSignal.timeout(TIMEOUT) });
  const bytes = Buffer.from(await fetched.arrayBuffer());
  ok('Le fichier signé est téléchargeable', fetched.status === 200 && bytes.equals(PNG));

  const tooShort = await call(`/media/${asset.id}/url?expires=5`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok('Durée trop courte refusée (400)', tooShort.status === 400, describe(tooShort));
  const tooLong = await call(`/media/${asset.id}/url?expires=99999`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok('Durée trop longue refusée (400)', tooLong.status === 400, describe(tooLong));

  const foreign = await call(`/media/${asset.id}/url`, {
    token: other.token,
    org: other.orgId,
  });
  ok('URL refusée depuis une autre organisation (404)', foreign.status === 404, describe(foreign));

  const removed = await call(`/media/${asset.id}`, {
    method: 'DELETE',
    token: owner.token,
    org: owner.orgId,
  });
  ok('Média supprimé (204)', removed.status === 204, describe(removed));
  const afterDelete = await call(`/media/${asset.id}/url`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok('Plus d’URL après suppression (404)', afterDelete.status === 404, describe(afterDelete));
  const list = await call('/media', { token: owner.token, org: owner.orgId });
  ok('La médiathèque est vide', list.status === 200 && list.data.length === 0, describe(list));

  console.log(`\nStockage objet : ${checks} vérifications E2E réussies.`);
}

main().catch((error) => {
  console.error(`\nÉchec : ${error.message}`);
  process.exitCode = 1;
});
