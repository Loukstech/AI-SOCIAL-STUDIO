#!/usr/bin/env node
/**
 * Test de bout en bout de la médiathèque (§12).
 *
 *   node scripts/smoke-media.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-media.mjs
 *
 * Vérifie que la recherche et les filtres sont exécutés en base, que les tags,
 * dossiers, favoris, versions et doublons sont réels, et que l'isolation
 * multi-tenant tient y compris sur les métadonnées.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const API_URL = (process.env.API_URL ?? 'https://ai-social-studio-api.onrender.com').replace(
  /\/$/,
  '',
);
const RUN_ID = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const PASSWORD = randomBytes(24).toString('base64url');
const TIMEOUT = Number(process.env.TIMEOUT ?? 45_000);

let checks = 0;
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function isSuccess(status) {
  return status === 200 || status === 201;
}

async function call(path, { method = 'GET', token, org, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers['X-Organization-Id'] = org;
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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

function describe(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

async function register(role) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: {
      email: `media-${role}-${RUN_ID}@ai-social-studio.test`,
      password: PASSWORD,
      name: role,
      organizationName: `Médiathèque ${role} ${RUN_ID}`,
    },
  });
  ok(`Compte ${role} créé`, result.status === 201, describe(result));
  const orgs = await call('/organizations', { token: result.data.token });
  ok(`Organisation de ${role} disponible`, orgs.status === 200 && orgs.data?.length === 1);
  return {
    token: result.data.token,
    id: result.data.user.id,
    email: result.data.user.email,
    orgId: orgs.data[0].id,
  };
}

async function main() {
  console.log(`Médiathèque E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register('owner');
  const other = await register('other');

  const viewerEmail = `media-viewer-${RUN_ID}@ai-social-studio.test`;
  const invitation = await call(`/organizations/${owner.orgId}/invitations`, {
    method: 'POST',
    token: owner.token,
    org: owner.orgId,
    body: { email: viewerEmail, role: 'VIEWER' },
  });
  ok('Invitation VIEWER créée', invitation.status === 201, describe(invitation));
  const viewerRegister = await call('/auth/register', {
    method: 'POST',
    body: {
      email: viewerEmail,
      password: PASSWORD,
      name: 'Lecteur',
      organizationName: `Lecteur ${RUN_ID}`,
    },
  });
  ok('Compte VIEWER créé', viewerRegister.status === 201, describe(viewerRegister));
  const accepted = await call('/invitations/accept', {
    method: 'POST',
    token: viewerRegister.data.token,
    body: { token: invitation.data.token },
  });
  ok('Invitation acceptée', accepted.status === 200, describe(accepted));
  const viewer = { token: viewerRegister.data.token, orgId: owner.orgId };

  // --- Création riche ---
  const checksum = `sha256-${RUN_ID}`;
  const first = await call('/media', {
    method: 'POST',
    token: owner.token,
    org: owner.orgId,
    body: {
      name: `Visuel campagne ${RUN_ID}`,
      kind: 'LOGO',
      sourceUrl: `https://exemple.test/${RUN_ID}.png`,
      folder: 'Campagnes/2026',
      tags: ['validé', 'été'],
      favorite: true,
      checksum,
      rights: 'Usage interne',
    },
  });
  ok('Un média riche est enregistré', isSuccess(first.status), describe(first));
  ok('Le type LOGO est accepté', first.data?.kind === 'LOGO', String(first.data?.kind));
  ok(
    'Le dossier est conservé',
    first.data?.folder === 'Campagnes/2026',
    String(first.data?.folder),
  );
  ok(
    'Les tags sont conservés',
    JSON.stringify(first.data?.tags) === JSON.stringify(['validé', 'été']),
    JSON.stringify(first.data?.tags),
  );
  ok('Le favori est conservé', first.data?.favorite === true, String(first.data?.favorite));
  ok('L’empreinte est conservée', first.data?.checksum === checksum, String(first.data?.checksum));
  ok(
    'Les droits sont conservés',
    first.data?.rights === 'Usage interne',
    String(first.data?.rights),
  );

  const viewerCreate = await call('/media', {
    method: 'POST',
    token: viewer.token,
    org: viewer.orgId,
    body: { name: 'Refusé' },
  });
  ok(
    'Un lecteur ne peut pas ajouter de média (403)',
    viewerCreate.status === 403,
    describe(viewerCreate),
  );
  const viewerList = await call('/media', { token: viewer.token, org: viewer.orgId });
  ok('Un lecteur consulte la médiathèque', viewerList.status === 200, describe(viewerList));

  // --- Recherche et filtres exécutés en base ---
  const searched = await call(`/media?search=${encodeURIComponent('campagne')}`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok(
    'La recherche par nom renvoie le média',
    searched.data?.some((item) => item.id === first.data.id),
    describe(searched),
  );
  const byTag = await call('/media?tag=' + encodeURIComponent('été'), {
    token: owner.token,
    org: owner.orgId,
  });
  ok('Le filtre par tag renvoie le média', byTag.data?.length === 1, String(byTag.data?.length));
  const byFolder = await call('/media?folder=' + encodeURIComponent('Campagnes/2026'), {
    token: owner.token,
    org: owner.orgId,
  });
  ok(
    'Le filtre par dossier renvoie le média',
    byFolder.data?.length === 1,
    String(byFolder.data?.length),
  );
  const byKind = await call('/media?kind=LOGO', { token: owner.token, org: owner.orgId });
  ok('Le filtre par type renvoie le média', byKind.data?.length === 1, String(byKind.data?.length));
  const favorites = await call('/media?favorite=true', { token: owner.token, org: owner.orgId });
  ok(
    'Le filtre favori renvoie le média',
    favorites.data?.length === 1,
    String(favorites.data?.length),
  );
  const notFavorites = await call('/media?favorite=false', {
    token: owner.token,
    org: owner.orgId,
  });
  ok(
    'Le filtre non-favori exclut le média',
    notFavorites.data?.length === 0,
    String(notFavorites.data?.length),
  );
  const missed = await call('/media?search=' + encodeURIComponent(`absent-${RUN_ID}`), {
    token: owner.token,
    org: owner.orgId,
  });
  ok('Une recherche sans résultat est vide', missed.data?.length === 0, describe(missed));
  const badLimit = await call('/media?limit=500', { token: owner.token, org: owner.orgId });
  ok('Une limite excessive est refusée (400)', badLimit.status === 400, describe(badLimit));

  // --- Mise à jour ---
  const patched = await call(`/media/${first.data.id}`, {
    method: 'PATCH',
    token: owner.token,
    org: owner.orgId,
    body: { favorite: false, tags: ['archivé'], rights: null, folder: null },
  });
  ok('Les métadonnées peuvent être mises à jour', patched.status === 200, describe(patched));
  ok(
    'Le favori peut être retiré',
    patched.data?.favorite === false,
    String(patched.data?.favorite),
  );
  ok(
    'Les tags peuvent être remplacés',
    JSON.stringify(patched.data?.tags) === JSON.stringify(['archivé']),
    JSON.stringify(patched.data?.tags),
  );
  ok(
    'Vider un champ avec null fonctionne',
    patched.data?.rights === null && patched.data?.folder === null,
    describe(patched),
  );
  const emptyPatch = await call(`/media/${first.data.id}`, {
    method: 'PATCH',
    token: owner.token,
    org: owner.orgId,
    body: {},
  });
  ok('Une mise à jour vide est refusée (400)', emptyPatch.status === 400, describe(emptyPatch));
  const selfVersion = await call(`/media/${first.data.id}`, {
    method: 'PATCH',
    token: owner.token,
    org: owner.orgId,
    body: { versionOfId: first.data.id },
  });
  ok(
    'Un média ne peut pas être sa propre version (400)',
    selfVersion.status === 400,
    describe(selfVersion),
  );

  // --- Versions ---
  const version = await call('/media', {
    method: 'POST',
    token: owner.token,
    org: owner.orgId,
    body: {
      name: `Visuel campagne ${RUN_ID} v2`,
      kind: 'LOGO',
      versionOfId: first.data.id,
      checksum: `sha256-v2-${RUN_ID}`,
    },
  });
  ok('Une version est enregistrée', isSuccess(version.status), describe(version));
  ok(
    'La version pointe vers son origine',
    version.data?.versionOfId === first.data.id,
    String(version.data?.versionOfId),
  );
  const versions = await call(`/media/${first.data.id}/versions`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok(
    'Les versions du média sont listées',
    versions.data?.length === 1 && versions.data[0].id === version.data.id,
    describe(versions),
  );
  const foreignVersion = await call('/media', {
    method: 'POST',
    token: owner.token,
    org: owner.orgId,
    body: { name: 'Version étrangère', versionOfId: 'inexistant' },
  });
  ok(
    'Une version d’origine inexistante est refusée (404)',
    foreignVersion.status === 404,
    describe(foreignVersion),
  );

  // --- Doublons ---
  const duplicate = await call('/media', {
    method: 'POST',
    token: owner.token,
    org: owner.orgId,
    body: { name: `Copie ${RUN_ID}`, kind: 'IMAGE', checksum },
  });
  ok(
    'Une copie avec la même empreinte est acceptée',
    isSuccess(duplicate.status),
    describe(duplicate),
  );
  const duplicates = await call('/media/duplicates', { token: owner.token, org: owner.orgId });
  const group = duplicates.data?.find((entry) => entry.checksum === checksum);
  ok('Le doublon est détecté', Boolean(group), describe(duplicates));
  ok(
    'Le groupe contient exactement les deux médias',
    group?.assets?.length === 2,
    String(group?.assets?.length),
  );

  // --- Isolation multi-tenant ---
  const foreignAsset = await call('/media', {
    method: 'POST',
    token: other.token,
    org: other.orgId,
    body: { name: `Autre organisation ${RUN_ID}`, checksum },
  });
  ok(
    'Un média existe dans une autre organisation',
    isSuccess(foreignAsset.status),
    describe(foreignAsset),
  );
  const stolenPatch = await call(`/media/${foreignAsset.data.id}`, {
    method: 'PATCH',
    token: owner.token,
    org: owner.orgId,
    body: { favorite: true },
  });
  ok('Modifier le média d’autrui renvoie 404', stolenPatch.status === 404, describe(stolenPatch));
  const stolenVersions = await call(`/media/${foreignAsset.data.id}/versions`, {
    token: owner.token,
    org: owner.orgId,
  });
  ok(
    'Lire les versions d’autrui renvoie 404',
    stolenVersions.status === 404,
    describe(stolenVersions),
  );
  const ownerDuplicates = await call('/media/duplicates', { token: owner.token, org: owner.orgId });
  ok(
    'Les doublons ne traversent pas les organisations',
    ownerDuplicates.data?.every((entry) =>
      entry.assets.every((asset) => asset.organizationId === owner.orgId),
    ),
    describe(ownerDuplicates),
  );

  // --- Suppression logique ---
  const removed = await call(`/media/${duplicate.data.id}`, {
    method: 'DELETE',
    token: owner.token,
    org: owner.orgId,
  });
  ok('Un média peut être supprimé (204)', removed.status === 204, describe(removed));
  const afterRemove = await call('/media', { token: owner.token, org: owner.orgId });
  ok(
    'Le média supprimé quitte la liste',
    !afterRemove.data?.some((item) => item.id === duplicate.data.id),
  );
  const afterDuplicates = await call('/media/duplicates', { token: owner.token, org: owner.orgId });
  ok(
    'Le doublon supprimé quitte le groupe',
    !afterDuplicates.data?.some((entry) =>
      entry.assets.some((asset) => asset.id === duplicate.data.id),
    ),
    describe(afterDuplicates),
  );

  const anonymous = await call('/media');
  ok('La médiathèque exige un jeton (401)', anonymous.status === 401, describe(anonymous));

  console.log(`\nMédiathèque : ${checks} vérifications E2E réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
