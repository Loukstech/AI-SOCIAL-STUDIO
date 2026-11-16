#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 11 (notifications).
 *
 *   node scripts/smoke-phase11.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase11.mjs
 *
 * Couvre le §15 sur un vrai parcours de publication : demande de validation,
 * approbation, échec d'envoi, publication confirmée, connexion sociale tombée.
 *
 * Deux exigences sont vérifiées en priorité :
 *
 * - **le catalogue ne promet rien de faux** : les dix événements sont listés,
 *   ceux qui ne peuvent pas être émis portent leur motif ;
 * - **l'e-mail ne ment pas** : sans transport, la notification porte
 *   `NO_PROVIDER` et son motif — jamais `SENT`.
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

async function register(email, name, organizationName) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, name, organizationName },
  });
  ok(`Création du compte ${name}`, result.status === 201, describe(result));
  return result.data;
}

async function main() {
  console.log(`Phase 11 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase11-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Notifications ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  // --- Boîte vide ---
  const empty = await call('/notifications', { token, org: orgId });
  ok('La boîte de réception répond 200', empty.status === 200, describe(empty));
  ok('Aucune notification au départ', empty.data?.total === 0, String(empty.data?.total));
  ok('Aucune non lue au départ', empty.data?.unread === 0, String(empty.data?.unread));

  const emptyCount = await call('/notifications/unread-count', { token, org: orgId });
  ok(
    'Le compteur de non-lues répond 0',
    emptyCount.status === 200 && emptyCount.data?.unread === 0,
    describe(emptyCount),
  );

  // --- Catalogue honnête ---
  const catalog = await call('/notifications/catalog', { token, org: orgId });
  ok('Le catalogue répond 200', catalog.status === 200, describe(catalog));
  ok(
    'Les dix événements du §15 sont listés',
    Array.isArray(catalog.data?.events) && catalog.data.events.length === 10,
    String(catalog.data?.events?.length),
  );
  const wired = (catalog.data?.events ?? []).filter((entry) => entry.wired);
  const unwired = (catalog.data?.events ?? []).filter((entry) => !entry.wired);
  ok('Six événements sont réellement émis', wired.length === 6, String(wired.length));
  ok('Quatre sont déclarés non disponibles', unwired.length === 4, String(unwired.length));
  ok(
    'Chaque événement non émis porte son motif',
    unwired.every((entry) => (entry.reason ?? '').length > 40),
    JSON.stringify(unwired.map((entry) => entry.type)),
  );
  ok(
    'Le motif nomme le sous-système manquant',
    unwired.some((entry) => /ffmpeg/.test(entry.reason ?? '')) &&
      unwired.some((entry) => /paiement/i.test(entry.reason ?? '')),
    JSON.stringify(unwired.map((entry) => entry.reason?.slice(0, 40))),
  );
  ok(
    'Le canal e-mail est annoncé indisponible',
    catalog.data?.email?.available === false && (catalog.data?.email?.reason ?? '').length > 40,
    catalog.data?.email?.reason,
  );

  // --- Préférences ---
  const prefs = await call('/notifications/preferences', { token, org: orgId });
  ok('Les préférences répondent 200', prefs.status === 200, describe(prefs));
  ok(
    'Une ligne par événement du §15',
    Array.isArray(prefs.data) && prefs.data.length === 10,
    String(prefs.data?.length),
  );
  ok(
    'L’interne est actif et l’e-mail coupé par défaut',
    prefs.data.every((entry) => entry.inApp === true && entry.email === false),
    JSON.stringify(prefs.data[0]),
  );
  ok(
    'Aucune préférence n’est marquée personnalisée au départ',
    prefs.data.every((entry) => entry.customized === false),
  );

  const savedPrefs = await call('/notifications/preferences', {
    method: 'PUT',
    token,
    org: orgId,
    body: { preferences: [{ type: 'APPROVAL_REQUESTED', email: true }] },
  });
  ok(
    'Une préférence e-mail peut être enregistrée',
    savedPrefs.status === 200,
    describe(savedPrefs),
  );
  const approvalPref = savedPrefs.data?.find((entry) => entry.type === 'APPROVAL_REQUESTED');
  ok(
    'La préférence est marquée personnalisée',
    approvalPref?.customized === true && approvalPref?.email === true,
    JSON.stringify(approvalPref),
  );
  ok(
    'Les autres préférences ne sont pas figées par l’enregistrement',
    savedPrefs.data?.find((entry) => entry.type === 'PUBLICATION_PUBLISHED')?.customized === false,
  );

  const badPrefs = await call('/notifications/preferences', {
    method: 'PUT',
    token,
    org: orgId,
    body: { preferences: [{ type: 'EVENEMENT_INVENTE', email: true }] },
  });
  ok('Un type inconnu est refusé (400)', badPrefs.status === 400, describe(badPrefs));

  const emptyPrefs = await call('/notifications/preferences', {
    method: 'PUT',
    token,
    org: orgId,
    body: { preferences: [] },
  });
  ok('Une mise à jour vide est refusée (400)', emptyPrefs.status === 400, describe(emptyPrefs));

  // --- Un éditeur prépare un contenu ---
  const editorEmail = `phase11-editor-${RUN_ID}@ai-social-studio.test`;
  const invitation = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token,
    org: orgId,
    body: { email: editorEmail, role: 'EDITOR' },
  });
  ok('Invitation EDITOR créée', invitation.status === 201, describe(invitation));
  const editor = await register(editorEmail, 'Éditeur', `Éditeur ${RUN_ID}`);
  const accepted = await call('/invitations/accept', {
    method: 'POST',
    token: editor.token,
    body: { token: invitation.data.token },
  });
  ok('Invitation acceptée', accepted.status === 200, describe(accepted));

  // Les comptes sociaux sont ouverts par un administrateur ; l'éditeur, lui,
  // écrit et soumet les contenus. C'est la répartition réelle des rôles.
  const accounts = {};
  for (const platform of ['LINKEDIN', 'X']) {
    const created = await call('/social-accounts', {
      method: 'POST',
      token,
      org: orgId,
      body: {
        platform,
        username: `${platform.toLowerCase()}-${RUN_ID}`,
        accessToken: `jeton-de-test-${platform}-${RUN_ID}`,
      },
    });
    ok(`Compte ${platform} connecté`, created.status === 201, describe(created));
    accounts[platform] = created.data?.id;
  }

  const publication = await call('/publications', {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: {
      title: 'Annonce à valider',
      postType: 'TEXT',
      mode: 'APPROVAL',
      targets: [
        { socialAccountId: accounts.LINKEDIN, body: 'Texte LinkedIn à valider.' },
        { socialAccountId: accounts.X, body: 'Texte X à valider.' },
      ],
    },
  });
  ok('Publication créée en mode validation', publication.status === 201, describe(publication));
  const publicationId = publication.data?.id;
  const targetIds = (publication.data?.targets ?? []).map((target) => target.id);

  const submitted = await call(`/publications/${publicationId}/submit`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok('Publication soumise', submitted.status === 200, describe(submitted));

  const ownerAfterSubmit = await call('/notifications', { token, org: orgId });
  ok(
    'Une soumission seule ne notifie pas le responsable',
    ownerAfterSubmit.data?.total === 0,
    String(ownerAfterSubmit.data?.total),
  );

  const requested = await call(`/publications/${publicationId}/request-approval`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok('Validation demandée', requested.status === 200, describe(requested));

  // --- Le responsable reçoit la demande ---
  const ownerInbox = await call('/notifications', { token, org: orgId });
  ok('Le responsable reçoit une notification', ownerInbox.data?.total === 1, describe(ownerInbox));
  const approval = ownerInbox.data?.items?.[0];
  ok(
    'Le type est « demande de validation »',
    approval?.type === 'APPROVAL_REQUESTED',
    approval?.type,
  );
  ok(
    'Le message nomme le contenu et les réseaux',
    /Annonce à valider/.test(approval?.body ?? '') && /LinkedIn et X/.test(approval?.body ?? ''),
    approval?.body,
  );
  ok(
    'La notification pointe vers le centre de publication',
    approval?.url === '#publishing',
    approval?.url,
  );
  ok(
    'Le contenu concerné est identifié',
    approval?.entityType === 'publication' && approval?.entityId === publicationId,
    `${approval?.entityType} ${approval?.entityId}`,
  );
  ok(
    'L’e-mail est déclaré non envoyé faute de transport',
    approval?.email?.status === 'NO_PROVIDER',
    approval?.email?.status,
  );
  ok(
    'Le motif de non-envoi est explicite',
    /Aucun transport e-mail/.test(approval?.email?.reason ?? ''),
    approval?.email?.reason,
  );
  ok('Le compteur de non-lues suit', ownerInbox.data?.unread === 1);

  // --- Approbation : l'auteur est prévenu ---
  const approved = await call(`/publications/${publicationId}/approve`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Publication approuvée', approved.status === 200, describe(approved));

  const editorInbox = await call('/notifications', { token: editor.token, org: orgId });
  ok(
    'L’auteur est prévenu de l’approbation',
    editorInbox.data?.items?.some((item) => item.type === 'CONTENT_APPROVED'),
    JSON.stringify(editorInbox.data?.items?.map((item) => item.type)),
  );

  // --- Échec d'envoi, puis publication confirmée ---
  const failed = await call(`/publications/${publicationId}/publish`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok(
    'La tentative de publication aboutit à un échec explicite',
    failed.status === 200,
    describe(failed),
  );
  ok('La publication est en échec', failed.data?.status === 'FAILED', failed.data?.status);

  const afterFailure = await call('/notifications', { token: editor.token, org: orgId });
  const failure = afterFailure.data?.items?.find((item) => item.type === 'PUBLICATION_FAILED');
  ok(
    'L’auteur est prévenu de l’échec',
    Boolean(failure),
    JSON.stringify(afterFailure.data?.items?.map((item) => item.type)),
  );
  ok(
    'Le motif de l’échec est repris tel quel',
    /adaptateur/i.test(failure?.body ?? ''),
    failure?.body,
  );

  // La confirmation est faite par le responsable : c'est le cas où l'auteur a
  // réellement besoin d'être prévenu. S'il confirmait lui-même, la notification
  // serait un écho de son propre geste — elle est donc volontairement omise.
  const confirmed = await call(`/publications/${publicationId}/confirm`, {
    method: 'POST',
    token,
    org: orgId,
    body: {
      targets: targetIds.map((targetId, index) => ({
        targetId,
        url: `https://social.example/phase11/${index + 1}`,
      })),
    },
  });
  ok('Publication confirmée', confirmed.status === 200, describe(confirmed));
  ok(
    'La publication passe en PUBLISHED',
    confirmed.data?.status === 'PUBLISHED',
    confirmed.data?.status,
  );

  const afterPublish = await call('/notifications', { token: editor.token, org: orgId });
  ok(
    'L’auteur est prévenu de la publication',
    afterPublish.data?.items?.some((item) => item.type === 'PUBLICATION_PUBLISHED'),
    JSON.stringify(afterPublish.data?.items?.map((item) => item.type)),
  );
  ok(
    'Trois notifications pour l’auteur',
    afterPublish.data?.total === 3,
    String(afterPublish.data?.total),
  );
  ok('Trois non lues', afterPublish.data?.unread === 3, String(afterPublish.data?.unread));

  // --- Refus : motif repris ---
  const second = await call('/publications', {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: {
      title: 'Annonce à refuser',
      postType: 'TEXT',
      mode: 'APPROVAL',
      targets: [{ socialAccountId: accounts.LINKEDIN, body: 'Texte à refuser.' }],
    },
  });
  ok('Seconde publication créée', second.status === 201, describe(second));
  await call(`/publications/${second.data?.id}/submit`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  await call(`/publications/${second.data?.id}/request-approval`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  const rejected = await call(`/publications/${second.data?.id}/reject`, {
    method: 'POST',
    token,
    org: orgId,
    body: { reason: 'Ton trop familier pour la marque' },
  });
  ok('Publication refusée', rejected.status === 200, describe(rejected));

  const afterReject = await call('/notifications', { token: editor.token, org: orgId });
  const rejection = afterReject.data?.items?.find((item) => item.type === 'CONTENT_REJECTED');
  ok('L’auteur est prévenu du refus', Boolean(rejection));
  ok(
    'Le motif du refus est repris',
    /Ton trop familier/.test(rejection?.body ?? ''),
    rejection?.body,
  );

  // --- Déduplication sur une connexion tombée ---
  const syncOne = await call(`/social-accounts/${accounts.LINKEDIN}/sync`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: {},
  });
  ok('La synchronisation échoue explicitement', syncOne.status === 200, describe(syncOne));
  const syncTwo = await call(`/social-accounts/${accounts.LINKEDIN}/sync`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: {},
  });
  ok('La seconde synchronisation échoue aussi', syncTwo.status === 200, describe(syncTwo));

  const ownerAfterSync = await call('/notifications', { token, org: orgId });
  const expired = ownerAfterSync.data?.items?.filter(
    (item) => item.type === 'SOCIAL_CONNECTION_EXPIRED',
  );
  ok(
    'Une seule notification pour deux synchronisations en échec',
    expired?.length === 1,
    String(expired?.length),
  );
  ok(
    'L’événement porte son nombre d’occurrences',
    expired?.[0]?.occurrences === 2,
    String(expired?.[0]?.occurrences),
  );
  ok(
    'Le motif de la panne est repris',
    /identifiant|renseignez|Aucune statistique|LINKEDIN/i.test(expired?.[0]?.body ?? ''),
    expired?.[0]?.body,
  );
  ok(
    'La connexion concernée est identifiée',
    expired?.[0]?.entityType === 'social_account' && expired?.[0]?.entityId === accounts.LINKEDIN,
    `${expired?.[0]?.entityType} ${expired?.[0]?.entityId}`,
  );

  // --- Filtres ---
  const filtered = await call('/notifications?type=SOCIAL_CONNECTION_EXPIRED', {
    token,
    org: orgId,
  });
  ok(
    'Le filtre par type restreint la liste',
    filtered.data?.total === 1 &&
      filtered.data?.items?.every((item) => item.type === 'SOCIAL_CONNECTION_EXPIRED'),
    String(filtered.data?.total),
  );

  const badType = await call('/notifications?type=NIMPORTEQUOI', { token, org: orgId });
  ok('Un type de filtre inconnu est refusé (400)', badType.status === 400, describe(badType));

  const badLimit = await call('/notifications?limit=0', { token, org: orgId });
  ok('Une limite hors bornes est refusée (400)', badLimit.status === 400, describe(badLimit));

  // --- Lecture ---
  const target = afterReject.data?.items?.[0];
  const read = await call(`/notifications/${target.id}/read`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok('Marquer une notification comme lue répond 200', read.status === 200, describe(read));
  ok('La notification porte sa date de lecture', Boolean(read.data?.readAt), read.data?.readAt);

  const afterRead = await call('/notifications/unread-count', { token: editor.token, org: orgId });
  ok(
    'Le compteur décroît après lecture',
    afterRead.data?.unread === afterReject.data.unread - 1,
    `${afterReject.data?.unread} → ${afterRead.data?.unread}`,
  );

  const unreadOnly = await call('/notifications?unread=true', { token: editor.token, org: orgId });
  ok(
    'Le filtre « non lues » exclut la notification lue',
    unreadOnly.data?.items?.every((item) => item.readAt === null) &&
      unreadOnly.data?.total === afterRead.data.unread,
    String(unreadOnly.data?.total),
  );

  const allRead = await call('/notifications/read-all', {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok(
    'Tout marquer comme lu remet le compteur à zéro',
    allRead.status === 200 && allRead.data?.unread === 0,
    describe(allRead),
  );

  // --- Suppression ---
  const beforeDelete = await call('/notifications', { token: editor.token, org: orgId });
  const removed = await call(`/notifications/${beforeDelete.data.items[0].id}`, {
    method: 'DELETE',
    token: editor.token,
    org: orgId,
  });
  ok('Supprimer une notification répond 204', removed.status === 204, describe(removed));

  const afterDelete = await call('/notifications', { token: editor.token, org: orgId });
  ok(
    'La notification supprimée disparaît',
    afterDelete.data?.total === beforeDelete.data.total - 1,
    `${beforeDelete.data?.total} → ${afterDelete.data?.total}`,
  );

  // --- Cloisonnement entre utilisateurs ---
  const ownerItem = ownerAfterSync.data?.items?.[0];
  const stealRead = await call(`/notifications/${ownerItem.id}/read`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok(
    'Lire la notification d’un autre utilisateur renvoie 404',
    stealRead.status === 404,
    describe(stealRead),
  );

  const stealDelete = await call(`/notifications/${ownerItem.id}`, {
    method: 'DELETE',
    token: editor.token,
    org: orgId,
  });
  ok(
    'Supprimer la notification d’un autre utilisateur renvoie 404',
    stealDelete.status === 404,
    describe(stealDelete),
  );

  // --- RBAC : un lecteur gère ses propres notifications ---
  const viewerEmail = `phase11-viewer-${RUN_ID}@ai-social-studio.test`;
  const viewerInvite = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token,
    org: orgId,
    body: { email: viewerEmail, role: 'VIEWER' },
  });
  ok('Invitation VIEWER créée', viewerInvite.status === 201, describe(viewerInvite));
  const viewer = await register(viewerEmail, 'Lecteur', `Lecteur ${RUN_ID}`);
  const viewerAccepted = await call('/invitations/accept', {
    method: 'POST',
    token: viewer.token,
    body: { token: viewerInvite.data.token },
  });
  ok('Invitation VIEWER acceptée', viewerAccepted.status === 200, describe(viewerAccepted));

  const viewerInbox = await call('/notifications', { token: viewer.token, org: orgId });
  ok('Un VIEWER consulte sa boîte', viewerInbox.status === 200, describe(viewerInbox));
  ok(
    'Sa boîte ne contient pas les notifications des autres',
    viewerInbox.data?.total === 0,
    String(viewerInbox.data?.total),
  );

  const viewerCatalog = await call('/notifications/catalog', { token: viewer.token, org: orgId });
  ok('Un VIEWER consulte le catalogue', viewerCatalog.status === 200, describe(viewerCatalog));

  const viewerPrefs = await call('/notifications/preferences', {
    method: 'PUT',
    token: viewer.token,
    org: orgId,
    body: { preferences: [{ type: 'PUBLICATION_FAILED', inApp: false, email: false }] },
  });
  ok(
    'Un VIEWER gère ses propres préférences',
    viewerPrefs.status === 200 &&
      viewerPrefs.data?.find((entry) => entry.type === 'PUBLICATION_FAILED')?.inApp === false,
    describe(viewerPrefs),
  );

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase11-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  ok('Organisation tierce disponible', Boolean(otherOrgId) && otherOrgId !== orgId);

  const otherInbox = await call('/notifications', { token: other.token, org: otherOrgId });
  ok(
    'L’autre organisation a une boîte vide',
    otherInbox.status === 200 && otherInbox.data?.total === 0,
    describe(otherInbox),
  );

  const stolen = await call(`/notifications/${ownerItem.id}/read`, {
    method: 'POST',
    token: other.token,
    org: otherOrgId,
  });
  ok(
    'Lire une notification d’une autre organisation renvoie 404',
    stolen.status === 404,
    describe(stolen),
  );

  const otherPrefs = await call('/notifications/preferences', {
    token: other.token,
    org: otherOrgId,
  });
  ok(
    'Les préférences ne sont pas partagées entre organisations',
    otherPrefs.data?.every((entry) => entry.customized === false),
    JSON.stringify(otherPrefs.data?.map((entry) => entry.customized)),
  );

  // --- Sans organisation active ---
  const noOrg = await call('/notifications', { token });
  ok('Sans organisation active, la boîte renvoie 404', noOrg.status === 404, describe(noOrg));

  console.log(`\n${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
