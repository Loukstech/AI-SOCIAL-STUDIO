#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 1 (Fondations SaaS).
 *
 *   node scripts/smoke-phase1.mjs                         # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase1.mjs
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-phase1.mjs
 *
 * Le compte de test est réutilisé (inscription, puis connexion les fois suivantes)
 * et les marques / médias créés sont supprimés à la fin : le test est rejouable.
 * Les données sont isolées dans l'organisation du compte de test.
 */
import assert from 'node:assert/strict';

const API_URL = (process.env.API_URL ?? 'https://ai-social-studio-api.onrender.com').replace(
  /\/$/,
  '',
);
const EMAIL = (process.env.SMOKE_EMAIL ?? 'phase1-smoke@ai-social-studio.test').toLowerCase();
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Smoke-Phase1-2026!';
const TIMEOUT = Number(process.env.TIMEOUT ?? 45_000);
const RUN_ID = `${Date.now()}`;

let checks = 0;
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
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

function describeError(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

async function main() {
  console.log(`Phase 1 E2E → ${API_URL}\n`);

  // 1. Santé de l'infrastructure
  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describeError(health));
  ok('PostgreSQL est up', health.data?.dependencies?.database === 'up');
  ok('Redis est up', health.data?.dependencies?.redis === 'up');

  // 2. Inscription (ou connexion si le compte de test existe déjà)
  let auth = await call('/auth/register', {
    method: 'POST',
    body: {
      email: EMAIL,
      password: PASSWORD,
      name: 'Test Phase 1',
      organizationName: 'Smoke Test',
    },
  });
  if (auth.status === 409) {
    auth = await call('/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    });
  }
  ok(
    'Inscription / connexion réussit',
    auth.status === 200 || auth.status === 201,
    describeError(auth),
  );
  const token = auth.data?.token;
  ok('Un jeton signé est retourné', typeof token === 'string' && token.split('.').length === 3);
  ok('Le profil utilisateur est conforme', auth.data?.user?.email === EMAIL);

  // 3. Session et profil
  const me = await call('/auth/me', { token });
  ok('GET /auth/me retourne le profil', me.status === 200 && me.data?.id === auth.data.user.id);
  const anonymous = await call('/auth/me');
  ok('Sans jeton, /auth/me est refusé (401)', anonymous.status === 401, describeError(anonymous));

  // 4. Organisations et isolation multi-tenant
  const orgs = await call('/organizations', { token });
  ok(
    'Liste des organisations accessible',
    orgs.status === 200 && Array.isArray(orgs.data),
    describeError(orgs),
  );
  const orgId = orgs.data?.[0]?.id;
  ok('Au moins une organisation (créée à l’inscription)', Boolean(orgId));
  ok('Le compte est OWNER de son organisation', orgs.data[0]?.role === 'OWNER');
  const members = await call(`/organizations/${orgId}/members`, { token, org: orgId });
  ok(
    'Liste des membres accessible',
    members.status === 200 && members.data.length >= 1,
    describeError(members),
  );
  const foreign = await call('/brands', { token, org: '00000000-0000-0000-0000-000000000000' });
  ok(
    'Une organisation étrangère est refusée (403)',
    foreign.status === 403,
    describeError(foreign),
  );

  // 5. Marques (création -> lecture -> suppression logique)
  const brandName = `Marque smoke ${RUN_ID}`;
  const created = await call('/brands', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: brandName, primaryColor: '#7c5cff', toneOfVoice: 'Direct' },
  });
  ok(
    'Création d’une marque',
    created.status === 201 && created.data?.name === brandName,
    describeError(created),
  );
  const brandId = created.data?.id;
  const brandList = await call('/brands', { token, org: orgId });
  ok(
    'La marque apparaît dans la liste',
    brandList.data?.some((b) => b.id === brandId),
  );
  const brandDelete = await call(`/brands/${brandId}`, { method: 'DELETE', token, org: orgId });
  ok('Suppression de la marque (204)', brandDelete.status === 204, describeError(brandDelete));
  const brandListAfter = await call('/brands', { token, org: orgId });
  ok(
    'La marque supprimée disparaît (soft delete)',
    !brandListAfter.data?.some((b) => b.id === brandId),
  );

  // 6. Médiathèque (métadonnées)
  const mediaName = `Visuel smoke ${RUN_ID}`;
  const media = await call('/media', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: mediaName, kind: 'IMAGE', sourceUrl: 'https://example.com/visuel.png' },
  });
  ok(
    'Création d’un média',
    media.status === 201 && media.data?.kind === 'IMAGE',
    describeError(media),
  );
  const mediaId = media.data?.id;
  const mediaList = await call('/media', { token, org: orgId });
  ok(
    'Le média apparaît dans la liste',
    mediaList.data?.some((m) => m.id === mediaId),
  );
  const mediaDelete = await call(`/media/${mediaId}`, { method: 'DELETE', token, org: orgId });
  ok('Suppression du média (204)', mediaDelete.status === 204, describeError(mediaDelete));

  // 7. Tableau de bord
  const dashboard = await call('/dashboard', { token, org: orgId });
  ok(
    'Statistiques du tableau de bord',
    dashboard.status === 200 && typeof dashboard.data?.organizations === 'number',
    describeError(dashboard),
  );
  ok(
    'Journal d’audit présent',
    Array.isArray(dashboard.data?.recentActivity) && dashboard.data.recentActivity.length >= 1,
  );

  // 8. Révocation de session
  const logout = await call('/auth/logout', { method: 'POST', token, body: {} });
  ok('Déconnexion (204)', logout.status === 204, describeError(logout));
  const revoked = await call('/auth/me', { token });
  ok(
    'Le jeton est révoqué après déconnexion (401)',
    revoked.status === 401,
    describeError(revoked),
  );

  console.log(`\n✅ Phase 1 : ${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n❌ Échec du test Phase 1 : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
