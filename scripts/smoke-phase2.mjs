#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 2 (Connexions sociales + invitations).
 *
 *   node scripts/smoke-phase2.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase2.mjs
 *
 * Deux comptes jetables sont créés à chaque exécution : un propriétaire qui
 * connecte un compte social et invite, puis un invité qui accepte. Aucun
 * identifiant n'est publié dans le dépôt. Les comptes sociaux créés sont
 * supprimés en fin de course.
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

function describe(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

async function register(email, name) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, name, organizationName: `Org ${name}` },
  });
  ok(`Création du compte ${name}`, result.status === 201, describe(result));
  return result.data;
}

async function main() {
  console.log(`Phase 2 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  // --- Propriétaire : compte social ---
  const ownerEmail = `phase2-owner-${RUN_ID}@ai-social-studio.test`;
  const owner = await register(ownerEmail, 'Propriétaire');
  const ownerToken = owner.token;
  const orgs = await call('/organizations', { token: ownerToken });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  const brand = await call('/brands', {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: { name: `Marque ${RUN_ID}` },
  });
  ok('Marque créée pour rattacher le compte', brand.status === 201, describe(brand));

  const social = await call('/social-accounts', {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: {
      platform: 'INSTAGRAM',
      username: `nova.${RUN_ID}`,
      brandId: brand.data.id,
      accessToken: 'jeton-de-test-chiffre-123456',
      refreshToken: 'refresh-de-test-123456',
      scopes: ['instagram_basic'],
    },
  });
  ok('Compte social connecté', social.status === 201, describe(social));
  ok('Le jeton est signalé présent', social.data?.hasAccessToken === true);
  ok(
    'Aucun jeton brut dans la réponse',
    social.data && !('accessToken' in social.data) && !('refreshToken' in social.data),
  );
  ok('Statut CONNECTED', social.data?.status === 'CONNECTED');
  const socialId = social.data?.id;

  const socialList = await call('/social-accounts', { token: ownerToken, org: orgId });
  ok(
    'Le compte apparaît dans la liste',
    socialList.status === 200 && socialList.data.some((row) => row.id === socialId),
    describe(socialList),
  );

  const duplicate = await call('/social-accounts', {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: { platform: 'INSTAGRAM', username: `nova.${RUN_ID}` },
  });
  ok('Doublon refusé (409)', duplicate.status === 409, describe(duplicate));

  const synced = await call(`/social-accounts/${socialId}/sync`, {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: {},
  });
  ok('Synchronisation horodatée', synced.status === 200 && Boolean(synced.data?.lastSyncedAt));

  const renamed = await call(`/social-accounts/${socialId}`, {
    method: 'PATCH',
    token: ownerToken,
    org: orgId,
    body: { displayName: 'Nova Studio' },
  });
  ok(
    'Mise à jour du compte social',
    renamed.status === 200 && renamed.data?.displayName === 'Nova Studio',
  );

  // --- Invitation ---
  const inviteeEmail = `phase2-invitee-${RUN_ID}@ai-social-studio.test`;
  const invitation = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: { email: inviteeEmail, role: 'EDITOR' },
  });
  ok('Invitation créée', invitation.status === 201, describe(invitation));
  ok('Lien d’acceptation fourni', typeof invitation.data?.acceptUrl === 'string');
  const inviteToken = invitation.data?.token;
  ok('Jeton d’invitation fourni une seule fois', typeof inviteToken === 'string');

  const invitationList = await call(`/organizations/${orgId}/invitations`, {
    token: ownerToken,
    org: orgId,
  });
  ok(
    'Invitation listée comme en attente',
    invitationList.status === 200 && invitationList.data.some((row) => row.isPending),
    describe(invitationList),
  );

  // --- Invité : acceptation ---
  const invitee = await register(inviteeEmail, 'Invité');
  const accepted = await call('/invitations/accept', {
    method: 'POST',
    token: invitee.token,
    body: { token: inviteToken },
  });
  ok('Invitation acceptée', accepted.status === 200, describe(accepted));
  ok('L’invité rejoint l’organisation du propriétaire', accepted.data?.organizationId === orgId);
  ok('Rôle attribué : EDITOR', accepted.data?.role === 'EDITOR');

  const inviteeOrgs = await call('/organizations', { token: invitee.token });
  ok(
    'L’invité voit deux organisations',
    inviteeOrgs.status === 200 && inviteeOrgs.data.length === 2,
    describe(inviteeOrgs),
  );

  const inviteeSocial = await call('/social-accounts', { token: invitee.token, org: orgId });
  ok(
    'L’invité (EDITOR) lit les comptes sociaux',
    inviteeSocial.status === 200 && inviteeSocial.data.length === 1,
    describe(inviteeSocial),
  );

  const forbiddenCreate = await call('/social-accounts', {
    method: 'POST',
    token: invitee.token,
    org: orgId,
    body: { platform: 'TIKTOK', username: 'interdit' },
  });
  ok(
    'Un EDITOR ne peut pas connecter de compte (403)',
    forbiddenCreate.status === 403,
    describe(forbiddenCreate),
  );

  const forbiddenInvite = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token: invitee.token,
    org: orgId,
    body: { email: `autre-${RUN_ID}@ai-social-studio.test` },
  });
  ok(
    'Un EDITOR ne peut pas inviter (403)',
    forbiddenInvite.status === 403,
    describe(forbiddenInvite),
  );

  const alreadyMember = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: { email: inviteeEmail, role: 'VIEWER' },
  });
  ok(
    'Inviter un membre existant est refusé (409)',
    alreadyMember.status === 409,
    describe(alreadyMember),
  );

  const reused = await call('/invitations/accept', {
    method: 'POST',
    token: invitee.token,
    body: { token: inviteToken },
  });
  ok('Une invitation ne peut pas être réutilisée (409)', reused.status === 409, describe(reused));

  // --- Révocation et déconnexion ---
  const pending = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: { email: `revoque-${RUN_ID}@ai-social-studio.test`, role: 'VIEWER' },
  });
  const revoked = await call(`/organizations/${orgId}/invitations/${pending.data.id}`, {
    method: 'DELETE',
    token: ownerToken,
    org: orgId,
  });
  ok('Révocation d’une invitation (204)', revoked.status === 204, describe(revoked));

  const disconnected = await call(`/social-accounts/${socialId}`, {
    method: 'DELETE',
    token: ownerToken,
    org: orgId,
  });
  ok('Déconnexion du compte social (204)', disconnected.status === 204, describe(disconnected));

  const afterDelete = await call('/social-accounts', { token: ownerToken, org: orgId });
  ok(
    'Le compte déconnecté disparaît de la liste',
    afterDelete.status === 200 && afterDelete.data.length === 0,
    describe(afterDelete),
  );

  const dashboard = await call('/dashboard', { token: ownerToken, org: orgId });
  ok(
    'Tableau de bord : compteurs Phase 2',
    dashboard.status === 200 &&
      typeof dashboard.data?.socialAccounts === 'number' &&
      typeof dashboard.data?.pendingInvitations === 'number',
    describe(dashboard),
  );

  console.log(`\n✅ Phase 2 : ${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n❌ Échec du test Phase 2 : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
