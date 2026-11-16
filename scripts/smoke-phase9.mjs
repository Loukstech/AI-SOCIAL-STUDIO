#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 9 (connexions sociales).
 *
 *   node scripts/smoke-phase9.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase9.mjs
 *
 * Couvre : le refus motivé quand aucun identifiant d'application n'est
 * configuré, l'état de santé des connexions, la détection d'erreur de
 * synchronisation, les limites du renouvellement par plateforme, le retour
 * OAuth public (redirection, jamais de JSON), les capacités déclarées par
 * réseau, la validation par adaptateur, le RBAC et l'isolation multi-tenant.
 *
 * Aucun test ne simule une connexion réussie : sans identifiants OAuth, le
 * comportement attendu **est** le refus explicite.
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

/** Appel sans suivre les redirections : nécessaire pour inspecter le retour OAuth. */
async function redirect(path) {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  return { status: response.status, location: response.headers.get('location') ?? '' };
}

function describe(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

async function register(email, name, organizationName) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, name, organizationName },
  });
  ok(`Création du compte ${name}`, result.status === 201, describe(result));
  return result.data;
}

async function main() {
  console.log(`Phase 9 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase9-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Connexions ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  // --- État initial ---
  const emptyHealth = await call('/social-accounts/health', { token, org: orgId });
  ok('La santé des connexions répond 200', emptyHealth.status === 200, describe(emptyHealth));
  ok(
    'Aucune connexion au départ',
    Array.isArray(emptyHealth.data) && emptyHealth.data.length === 0,
    describe(emptyHealth),
  );

  // --- Refus honnête : aucun identifiant d'application ---
  const metaConnect = await call('/social-accounts/connect', {
    method: 'POST',
    token,
    org: orgId,
    body: { platform: 'INSTAGRAM' },
  });
  ok(
    'Connexion Instagram refusée sans identifiants (409)',
    metaConnect.status === 409,
    describe(metaConnect),
  );
  ok(
    'Le refus nomme META_CLIENT_ID',
    String(metaConnect.data?.message ?? '').includes('META_CLIENT_ID'),
    describe(metaConnect),
  );
  ok(
    'Le refus dit qu’aucune application OAuth n’est configurée',
    /Aucun identifiant d’application OAuth n’est configuré/.test(
      String(metaConnect.data?.message ?? ''),
    ),
  );

  const xConnect = await call('/social-accounts/connect', {
    method: 'POST',
    token,
    org: orgId,
    body: { platform: 'X' },
  });
  ok('Connexion X refusée sans identifiants (409)', xConnect.status === 409, describe(xConnect));
  ok(
    'Le refus nomme X_CLIENT_ID et X_CLIENT_SECRET',
    String(xConnect.data?.message ?? '').includes('X_CLIENT_ID') &&
      String(xConnect.data?.message ?? '').includes('X_CLIENT_SECRET'),
    describe(xConnect),
  );

  const invalidPlatform = await call('/social-accounts/connect', {
    method: 'POST',
    token,
    org: orgId,
    body: { platform: 'MYSPACE' },
  });
  ok(
    'Plateforme inconnue refusée (400)',
    invalidPlatform.status === 400,
    describe(invalidPlatform),
  );

  // --- Retour OAuth public ---
  const callback = await redirect('/social-accounts/oauth/callback?state=faux&code=abc');
  ok('Le retour OAuth redirige (302)', callback.status === 302, String(callback.status));
  ok(
    'La redirection porte un motif d’erreur',
    callback.location.includes('error='),
    callback.location,
  );
  ok(
    'Le retour ne renvoie jamais un corps JSON',
    !callback.location.includes('{'),
    callback.location,
  );

  const bareCallback = await redirect('/social-accounts/oauth/callback');
  ok(
    'Un retour sans paramètres redirige aussi',
    bareCallback.status === 302 && bareCallback.location.includes('error='),
    String(bareCallback.status),
  );

  // --- Connexion manuelle (repli documenté) ---
  const manual = await call('/social-accounts', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      platform: 'INSTAGRAM',
      username: `nova.${RUN_ID}`,
      accessToken: 'jeton-de-test-phase9-123456',
      refreshToken: 'refresh-de-test-phase9-123456',
      scopes: ['instagram_basic'],
    },
  });
  ok('Compte enregistré manuellement', manual.status === 201, describe(manual));
  ok(
    'La réponse ne contient aucun jeton',
    manual.data && !('accessToken' in manual.data) && !('refreshToken' in manual.data),
  );
  ok(
    'Les champs de panne sont présents et vides',
    manual.data?.lastError === null && manual.data?.lastErrorAt === null,
    JSON.stringify(manual.data?.lastError),
  );
  const accountId = manual.data?.id;

  // --- Santé après connexion ---
  const afterHealth = await call('/social-accounts/health', { token, org: orgId });
  const row = afterHealth.data?.find((entry) => entry.id === accountId);
  ok('La connexion apparaît dans la santé', Boolean(row), describe(afterHealth));
  ok('État « opérationnelle » sans date d’expiration', row?.state === 'OK', row?.state);
  ok('Le jeton est signalé présent', row?.hasAccessToken === true);
  ok(
    'Les identifiants manquants sont nommés par plateforme',
    Array.isArray(row?.missingCredentials) && row.missingCredentials.includes('META_CLIENT_ID'),
    JSON.stringify(row?.missingCredentials),
  );
  ok(
    'Meta est signalé comme non renouvelable',
    row?.supportsRefresh === false,
    String(row?.supportsRefresh),
  );
  ok(
    'Les permissions accordées sont reprises',
    Array.isArray(row?.scopes) && row.scopes.includes('instagram_basic'),
    JSON.stringify(row?.scopes),
  );

  // --- Renouvellement ---
  const refreshMeta = await call(`/social-accounts/${accountId}/refresh`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok(
    'Meta ne délivre pas de jeton de rafraîchissement (409)',
    refreshMeta.status === 409,
    describe(refreshMeta),
  );
  ok(
    'Le refus explique qu’il faut relancer la connexion',
    /relancez la connexion/i.test(String(refreshMeta.data?.message ?? '')),
    describe(refreshMeta),
  );

  // --- Synchronisation : l'échec est enregistré, jamais masqué ---
  const sync = await call(`/social-accounts/${accountId}/sync`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok('La synchronisation répond 200 avec le compte', sync.status === 200, describe(sync));
  ok('Le compte passe en erreur', sync.data?.status === 'ERROR', String(sync.data?.status));
  ok(
    'La panne est datée et expliquée',
    Boolean(sync.data?.lastErrorAt) && Boolean(sync.data?.lastError),
    String(sync.data?.lastError),
  );
  ok(
    'L’explication nomme les identifiants manquants',
    String(sync.data?.lastError ?? '').includes('META_CLIENT_ID'),
    String(sync.data?.lastError),
  );
  ok(
    'La synchronisation reste horodatée',
    Boolean(sync.data?.lastSyncedAt),
    String(sync.data?.lastSyncedAt),
  );

  const errorHealth = await call('/social-accounts/health', { token, org: orgId });
  const errorRow = errorHealth.data?.find((entry) => entry.id === accountId);
  ok('La santé reflète la panne', errorRow?.state === 'ERROR', errorRow?.state);
  ok(
    'La santé propose une marche à suivre',
    typeof errorRow?.guidance === 'string' && errorRow.guidance.length > 0,
    errorRow?.guidance ?? '',
  );

  // --- Un compte sans jeton ne peut pas être synchronisé ---
  const noToken = await call('/social-accounts', {
    method: 'POST',
    token,
    org: orgId,
    body: { platform: 'LINKEDIN', username: `li.${RUN_ID}` },
  });
  ok('Compte LinkedIn enregistré sans jeton', noToken.status === 201, describe(noToken));
  const noTokenSync = await call(`/social-accounts/${noToken.data.id}/sync`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok('Synchroniser sans jeton est refusé (400)', noTokenSync.status === 400, describe(noTokenSync));

  const noTokenRefresh = await call(`/social-accounts/${noToken.data.id}/refresh`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok(
    'Renouveler sans jeton de rafraîchissement est refusé (409)',
    noTokenRefresh.status === 409,
    describe(noTokenRefresh),
  );

  const linkedinHealth = await call('/social-accounts/health', { token, org: orgId });
  const linkedinRow = linkedinHealth.data?.find((entry) => entry.id === noToken.data.id);
  ok('LinkedIn est signalé sans jeton', linkedinRow?.state === 'NO_TOKEN', linkedinRow?.state);
  ok(
    'LinkedIn est signalé comme renouvelable',
    linkedinRow?.supportsRefresh === true,
    String(linkedinRow?.supportsRefresh),
  );

  // --- Capacités déclarées par plateforme ---
  const readiness = await call('/publications/readiness', { token, org: orgId });
  ok('La préparation de publication répond 200', readiness.status === 200, describe(readiness));
  ok(
    'Les huit plateformes sont décrites',
    Array.isArray(readiness.data?.platforms) && readiness.data.platforms.length === 8,
    String(readiness.data?.platforms?.length),
  );
  const instagram = readiness.data?.platforms?.find((entry) => entry.platform === 'INSTAGRAM');
  ok(
    'Instagram déclare ses formats réels',
    Array.isArray(instagram?.supports) && !instagram.supports.includes('TEXT'),
    JSON.stringify(instagram?.supports),
  );
  ok(
    'L’envoi est annoncé indisponible sans configuration',
    instagram?.canPublish === false,
    String(instagram?.canPublish),
  );
  ok(
    'Chaque plateforme nomme ce qui bloque',
    readiness.data?.platforms?.every(
      (entry) =>
        // Deux motifs explicites : des identifiants manquants, ou un transport
        // réellement absent (TikTok a désormais ses clés, mais pas d'envoi).
        (Array.isArray(entry.missingCredentials) && entry.missingCredentials.length > 0) ||
        (entry.canPublish === false && entry.transport === 'NONE' && Boolean(entry.fallback)),
    ),
    'une plateforme ne nomme ni identifiant manquant ni transport absent',
  );

  // --- RBAC ---
  const viewerEmail = `phase9-viewer-${RUN_ID}@ai-social-studio.test`;
  const invitation = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token,
    org: orgId,
    body: { email: viewerEmail, role: 'VIEWER' },
  });
  ok('Invitation VIEWER créée', invitation.status === 201, describe(invitation));

  const viewer = await register(viewerEmail, 'Lecteur', `Lecteur ${RUN_ID}`);
  const accepted = await call('/invitations/accept', {
    method: 'POST',
    token: viewer.token,
    body: { token: invitation.data.token },
  });
  ok('Invitation acceptée', accepted.status === 200, describe(accepted));

  const viewerHealth = await call('/social-accounts/health', { token: viewer.token, org: orgId });
  ok('Un VIEWER consulte la santé', viewerHealth.status === 200, describe(viewerHealth));

  const viewerConnect = await call('/social-accounts/connect', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { platform: 'LINKEDIN' },
  });
  ok(
    'Un VIEWER ne peut pas ouvrir de connexion (403)',
    viewerConnect.status === 403,
    describe(viewerConnect),
  );

  const viewerRefresh = await call(`/social-accounts/${accountId}/refresh`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: {},
  });
  ok(
    'Un VIEWER ne peut pas renouveler (403)',
    viewerRefresh.status === 403,
    describe(viewerRefresh),
  );

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase9-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  ok('Organisation tierce disponible', Boolean(otherOrgId) && otherOrgId !== orgId);

  const stolenSync = await call(`/social-accounts/${accountId}/sync`, {
    method: 'POST',
    token: other.token,
    org: otherOrgId,
    body: {},
  });
  ok(
    'Synchroniser le compte d’une autre organisation renvoie 404',
    stolenSync.status === 404,
    describe(stolenSync),
  );

  const stolenRefresh = await call(`/social-accounts/${accountId}/refresh`, {
    method: 'POST',
    token: other.token,
    org: otherOrgId,
    body: {},
  });
  ok(
    'Renouveler le compte d’une autre organisation renvoie 404',
    stolenRefresh.status === 404,
    describe(stolenRefresh),
  );

  const otherHealth = await call('/social-accounts/health', {
    token: other.token,
    org: otherOrgId,
  });
  ok(
    'La santé d’une autre organisation est vide',
    Array.isArray(otherHealth.data) && otherHealth.data.length === 0,
    String(otherHealth.data?.length),
  );

  // --- Déconnexion ---
  const removed = await call(`/social-accounts/${accountId}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Déconnexion du compte (204)', removed.status === 204, describe(removed));

  const finalHealth = await call('/social-accounts/health', { token, org: orgId });
  ok(
    'Le compte déconnecté quitte la santé',
    !finalHealth.data?.some((entry) => entry.id === accountId),
    describe(finalHealth),
  );

  const audit = await call('/social-accounts', { token, org: orgId });
  ok('La liste des comptes répond 200', audit.status === 200, describe(audit));

  console.log(`\n${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
