#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 6 (Publishing Center + Content Calendar).
 *
 *   node scripts/smoke-phase6.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase6.mjs
 *
 * Couvre : circuit de validation complet, transitions interdites, contrôle des
 * capacités de plateforme, échec honnête de la publication, export, confirmation
 * manuelle, programmation et réclamation d'échéance, bornage des tentatives,
 * calendrier et fuseau horaire, RBAC et isolation multi-tenant.
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

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function main() {
  console.log(`Phase 6 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase6-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Publication ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));
  ok('Fuseau par défaut de l’organisation', orgs.data?.[0]?.timezone === 'Europe/Paris');

  // --- Comptes sociaux ---
  const accounts = {};
  for (const platform of ['LINKEDIN', 'X', 'INSTAGRAM']) {
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

  // --- Passerelle de publication ---
  const readiness = await call('/publications/readiness', { token, org: orgId });
  ok('État de la passerelle consultable', readiness.status === 200, describe(readiness));
  ok('Aucun adaptateur configuré en production', readiness.data?.ready === false);
  ok(
    'Le message explique la marche à suivre',
    /Publiez manuellement/i.test(readiness.data?.message ?? ''),
    readiness.data?.message,
  );

  // --- Création ---
  const created = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Annonce LinkedIn et X',
      postType: 'TEXT',
      mode: 'AUTO',
      targets: [
        { socialAccountId: accounts.LINKEDIN, body: 'Annonce LinkedIn de test.' },
        { socialAccountId: accounts.X, body: 'Annonce X de test.' },
      ],
    },
  });
  ok('Publication créée', created.status === 201, describe(created));
  const publicationA = created.data?.id;
  ok('État initial : brouillon', created.data?.status === 'DRAFT', created.data?.status);
  ok('Deux cibles enregistrées', created.data?.targets.length === 2, describe(created));
  ok(
    'La soumission est proposée depuis le brouillon',
    created.data?.allowedTransitions.includes('READY_FOR_REVIEW'),
  );
  const linkedinTarget = created.data?.targets.find((target) => target.platform === 'LINKEDIN');
  ok('Limite LinkedIn connue', linkedinTarget?.charLimit === 3_000, linkedinTarget?.charLimit);
  ok('Aucune erreur de capacité sur une cible valide', linkedinTarget?.errors.length === 0);

  // --- Transitions interdites ---
  const earlyApprove = await call(`/publications/${publicationA}/approve`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok(
    'Valider depuis un brouillon est refusé (409)',
    earlyApprove.status === 409,
    describe(earlyApprove),
  );

  const earlyPublish = await call(`/publications/${publicationA}/publish`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok(
    'Publier depuis un brouillon est refusé (409)',
    earlyPublish.status === 409,
    describe(earlyPublish),
  );

  const earlySchedule = await call(`/publications/${publicationA}/schedule`, {
    method: 'POST',
    token,
    org: orgId,
    body: { scheduledAt: minutesFromNow(60) },
  });
  ok(
    'Programmer depuis un brouillon est refusé (409)',
    earlySchedule.status === 409,
    describe(earlySchedule),
  );

  // --- Circuit en mode AUTO ---
  const submitted = await call(`/publications/${publicationA}/submit`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Soumission réussie', submitted.status === 200, describe(submitted));
  ok(
    'Le mode AUTO valide sans intervention',
    submitted.data?.status === 'APPROVED',
    submitted.data?.status,
  );
  ok(
    'Deux étapes tracées dans l’historique',
    submitted.data?.events.filter((event) => event.toStatus !== 'DRAFT').length === 2,
    String(submitted.data?.events.length),
  );
  ok(
    'La validation automatique est motivée',
    submitted.data?.events.some((event) => /automatique/i.test(event.reason ?? '')),
  );

  // --- Publication sans adaptateur ---
  const published = await call(`/publications/${publicationA}/publish`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('La tentative de publication aboutit à un échec explicite', published.status === 200);
  ok(
    'Aucune publication simulée : état FAILED',
    published.data?.status === 'FAILED',
    published.data?.status,
  );
  ok('Tentative comptée', published.data?.attempts === 1, String(published.data?.attempts));
  ok(
    'Le motif nomme l’absence d’adaptateur',
    /adaptateur/i.test(published.data?.lastError ?? ''),
    published.data?.lastError,
  );
  ok(
    'Toutes les cibles sont marquées en échec',
    published.data?.targets.every((target) => target.status === 'FAILED'),
  );
  ok(
    'Des solutions de repli sont proposées',
    (published.data?.alternatives.length ?? 0) >= 2,
    String(published.data?.alternatives.length),
  );
  ok(
    'Le repli nomme la confirmation manuelle',
    published.data?.alternatives.some((alternative) => /Confirmer/i.test(alternative.label)),
  );

  // --- Export ---
  const exported = await call(`/publications/${publicationA}/export`, { token, org: orgId });
  ok('Export disponible', exported.status === 200, describe(exported));
  ok('Export : une entrée par cible', exported.data?.targets.length === 2);
  ok(
    'Export : texte complet par cible',
    exported.data?.targets.every((target) => target.text.length > 10),
  );
  ok(
    'Export : longueur mesurée face à la limite',
    exported.data?.targets.every((target) => target.charCount <= target.charLimit),
  );

  // --- Confirmation manuelle ---
  const targetsOfA = published.data?.targets ?? [];
  const partial = await call(`/publications/${publicationA}/confirm`, {
    method: 'POST',
    token,
    org: orgId,
    body: {
      targets: [{ targetId: targetsOfA[0].id, url: 'https://social.example/p/1' }],
    },
  });
  ok('Confirmation partielle acceptée', partial.status === 200, describe(partial));
  ok(
    'Une confirmation partielle ne clôt pas la publication',
    partial.data?.status === 'FAILED',
    partial.data?.status,
  );
  ok(
    'La cible confirmée porte son URL',
    partial.data?.targets.find((target) => target.id === targetsOfA[0].id)?.externalUrl ===
      'https://social.example/p/1',
  );

  const confirmed = await call(`/publications/${publicationA}/confirm`, {
    method: 'POST',
    token,
    org: orgId,
    body: {
      targets: [{ targetId: targetsOfA[1].id, url: 'https://social.example/p/2' }],
    },
  });
  ok('Confirmation complète', confirmed.status === 200, describe(confirmed));
  ok(
    'Toutes les cibles confirmées closent la publication',
    confirmed.data?.status === 'PUBLISHED',
    confirmed.data?.status,
  );
  ok('Date de publication renseignée', Boolean(confirmed.data?.publishedAt));

  const confirmAgain = await call(`/publications/${publicationA}/confirm`, {
    method: 'POST',
    token,
    org: orgId,
    body: {
      targets: [{ targetId: targetsOfA[0].id, url: 'https://social.example/p/3' }],
    },
  });
  ok(
    'Confirmer une publication déjà publiée est refusé (409)',
    confirmAgain.status === 409,
    describe(confirmAgain),
  );

  const patchPublished = await call(`/publications/${publicationA}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { title: 'Tentative de modification' },
  });
  ok(
    'Une publication publiée n’est plus modifiable (409)',
    patchPublished.status === 409,
    describe(patchPublished),
  );

  // --- Duplication ---
  const duplicated = await call(`/publications/${publicationA}/duplicate`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok('Duplication créée', duplicated.status === 201, describe(duplicated));
  ok('La copie repart en brouillon', duplicated.data?.status === 'DRAFT');
  ok('La copie conserve les cibles', duplicated.data?.targets.length === 2);
  ok('La copie n’hérite pas de l’échéance', duplicated.data?.scheduledAt === null);
  ok(
    'Le titre de la copie est explicite',
    /\(copie\)$/.test(duplicated.data?.title ?? ''),
    duplicated.data?.title,
  );

  // --- Capacités de plateforme ---
  const instagramText = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Instagram sans média',
      postType: 'TEXT',
      targets: [{ socialAccountId: accounts.INSTAGRAM, body: 'Un texte seul ne suffit pas ici.' }],
    },
  });
  ok('Brouillon Instagram créé', instagramText.status === 201, describe(instagramText));
  const instagramId = instagramText.data?.id;
  ok(
    'La cible porte l’erreur de capacité',
    (instagramText.data?.targets[0]?.errors.length ?? 0) > 0,
    String(instagramText.data?.targets[0]?.errors),
  );

  const instagramSubmit = await call(`/publications/${instagramId}/submit`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok(
    'La soumission bloque un format impossible (400)',
    instagramSubmit.status === 400,
    describe(instagramSubmit),
  );
  const instagramMessage = JSON.stringify(instagramSubmit.data);
  ok(
    'Le message nomme Instagram et le format refusé',
    /Instagram/i.test(instagramMessage) && /n.accepte pas le format TEXT/i.test(instagramMessage),
    describe(instagramSubmit),
  );

  const instagramPatch = await call(`/publications/${instagramId}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { title: 'Instagram corrigé' },
  });
  ok('Un brouillon reste modifiable', instagramPatch.status === 200, describe(instagramPatch));
  ok('Le titre est bien enregistré', instagramPatch.data?.title === 'Instagram corrigé');

  const instagramDelete = await call(`/publications/${instagramId}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Brouillon supprimé (204)', instagramDelete.status === 204, describe(instagramDelete));
  const instagramGone = await call(`/publications/${instagramId}`, { token, org: orgId });
  ok('La publication supprimée renvoie 404', instagramGone.status === 404, describe(instagramGone));

  // --- Circuit avec validation ---
  const approval = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Annonce avec validation',
      postType: 'TEXT',
      mode: 'APPROVAL',
      targets: [{ socialAccountId: accounts.LINKEDIN, body: 'Texte soumis à validation.' }],
    },
  });
  ok('Publication en mode validation créée', approval.status === 201, describe(approval));
  const publicationC = approval.data?.id;

  const submittedC = await call(`/publications/${publicationC}/submit`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok(
    'Le mode APPROVAL s’arrête à la relecture',
    submittedC.data?.status === 'READY_FOR_REVIEW',
    submittedC.data?.status,
  );

  const requestApproval = await call(`/publications/${publicationC}/request-approval`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok(
    'La demande de validation est transmise',
    requestApproval.data?.status === 'PENDING_APPROVAL',
    requestApproval.data?.status,
  );

  const approved = await call(`/publications/${publicationC}/approve`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Validation du responsable', approved.data?.status === 'APPROVED', approved.data?.status);

  // --- Programmation, déplacement et réclamation ---
  const scheduled = await call(`/publications/${publicationC}/schedule`, {
    method: 'POST',
    token,
    org: orgId,
    body: { scheduledAt: minutesFromNow(-2) },
  });
  ok('Programmation acceptée', scheduled.status === 200, describe(scheduled));
  ok('État programmé', scheduled.data?.status === 'SCHEDULED', scheduled.data?.status);

  const futureDate = minutesFromNow(180);
  const rescheduled = await call(`/publications/${publicationC}/reschedule`, {
    method: 'POST',
    token,
    org: orgId,
    body: { scheduledAt: futureDate },
  });
  ok('Déplacement d’échéance accepté', rescheduled.status === 200, describe(rescheduled));
  ok(
    'La nouvelle échéance est enregistrée',
    new Date(rescheduled.data?.scheduledAt ?? 0).toISOString() ===
      new Date(futureDate).toISOString(),
    rescheduled.data?.scheduledAt,
  );
  ok(
    'Le déplacement ne change pas l’état',
    rescheduled.data?.status === 'SCHEDULED',
    rescheduled.data?.status,
  );
  ok(
    'Le déplacement est tracé',
    rescheduled.data?.events.some((event) => /Échéance modifiée/.test(event.reason ?? '')),
  );

  const backToDue = await call(`/publications/${publicationC}/reschedule`, {
    method: 'POST',
    token,
    org: orgId,
    body: { scheduledAt: minutesFromNow(-2) },
  });
  ok('Retour à une échéance passée', backToDue.status === 200, describe(backToDue));

  const runDue = await call('/publications/run-due', { method: 'POST', token, org: orgId });
  ok('Exécution des échéances', runDue.status === 200, describe(runDue));

  const afterDue = await call(`/publications/${publicationC}`, { token, org: orgId });
  // La boucle de fond (tick de 60 s) peut avoir réclamé l'échéance avant nous.
  // L'invariant à tenir est qu'elle n'est traitée qu'une seule fois.
  ok(
    'La publication due est traitée une seule fois',
    (runDue.data?.claimed ?? 0) <= 1 && afterDue.data?.attempts === 1,
    `claimed=${runDue.data?.claimed} attempts=${afterDue.data?.attempts}`,
  );
  ok(
    'La publication réclamée passe en échec faute d’adaptateur',
    afterDue.data?.status === 'FAILED',
    afterDue.data?.status,
  );
  ok('La tentative est comptée', afterDue.data?.attempts === 1, String(afterDue.data?.attempts));

  // --- Bornage des tentatives ---
  const retryOne = await call(`/publications/${publicationC}/retry`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Première nouvelle tentative', retryOne.status === 200, describe(retryOne));
  ok('Deuxième tentative comptée', retryOne.data?.attempts === 2, String(retryOne.data?.attempts));

  const retryTwo = await call(`/publications/${publicationC}/retry`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Deuxième nouvelle tentative', retryTwo.status === 200, describe(retryTwo));
  ok('Troisième tentative comptée', retryTwo.data?.attempts === 3, String(retryTwo.data?.attempts));

  const retryThree = await call(`/publications/${publicationC}/retry`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok(
    'Au-delà de trois tentatives, la relance est refusée (409)',
    retryThree.status === 409,
    describe(retryThree),
  );
  ok(
    'La relance n’est plus proposée dans les transitions',
    !retryTwo.data?.allowedTransitions.includes('PUBLISHING'),
    JSON.stringify(retryTwo.data?.allowedTransitions),
  );

  // --- Refus et retour en brouillon ---
  const rejectNoReason = await call(`/publications/${publicationC}/reject`, {
    method: 'POST',
    token,
    org: orgId,
    body: { reason: '' },
  });
  ok(
    'Refuser sans motif est rejeté (400)',
    rejectNoReason.status === 400,
    describe(rejectNoReason),
  );

  const rejected = await call(`/publications/${publicationC}/reject`, {
    method: 'POST',
    token,
    org: orgId,
    body: { reason: 'Ton trop commercial pour la marque' },
  });
  ok('Refus depuis un échec est refusé (409)', rejected.status === 409, describe(rejected));

  const cancelled = await call(`/publications/${publicationC}/cancel`, {
    method: 'POST',
    token,
    org: orgId,
    body: { reason: 'Campagne reportée' },
  });
  ok('Annulation acceptée', cancelled.data?.status === 'CANCELLED', cancelled.data?.status);

  const reopened = await call(`/publications/${publicationC}/reopen`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Retour en brouillon depuis une annulation', reopened.data?.status === 'DRAFT');
  ok(
    'L’historique conserve les tentatives',
    reopened.data?.attempts === 3,
    String(reopened.data?.attempts),
  );

  // --- Refus nominal en mode validation ---
  const toReject = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Annonce à refuser',
      postType: 'TEXT',
      mode: 'APPROVAL',
      targets: [{ socialAccountId: accounts.X, body: 'Texte à refuser.' }],
    },
  });
  const rejectId = toReject.data?.id;
  await call(`/publications/${rejectId}/submit`, { method: 'POST', token, org: orgId });
  await call(`/publications/${rejectId}/request-approval`, {
    method: 'POST',
    token,
    org: orgId,
  });
  const rejectedOk = await call(`/publications/${rejectId}/reject`, {
    method: 'POST',
    token,
    org: orgId,
    body: { reason: 'Ton trop commercial pour la marque' },
  });
  ok('Refus avec motif accepté', rejectedOk.data?.status === 'REJECTED', rejectedOk.data?.status);
  ok(
    'Le motif est conservé',
    rejectedOk.data?.rejectionReason === 'Ton trop commercial pour la marque',
    rejectedOk.data?.rejectionReason,
  );
  ok(
    'Un contenu refusé redevient modifiable',
    (
      await call(`/publications/${rejectId}`, {
        method: 'PATCH',
        token,
        org: orgId,
        body: { title: 'Annonce corrigée' },
      })
    ).status === 200,
  );

  // --- Calendrier ---
  const tomorrow = minutesFromNow(24 * 60);
  const calendarItem = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Publication du lendemain',
      postType: 'TEXT',
      scheduledAt: tomorrow,
      targets: [{ socialAccountId: accounts.LINKEDIN, body: 'Prévu demain.' }],
    },
  });
  ok('Publication datée créée', calendarItem.status === 201, describe(calendarItem));
  ok('La date est conservée', Boolean(calendarItem.data?.scheduledAt));
  const calendarId = calendarItem.data?.id;

  const windowFrom = new Date(Date.now() - 24 * 3600_000).toISOString();
  const windowTo = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
  const calendar = await call(
    `/calendar?from=${encodeURIComponent(windowFrom)}&to=${encodeURIComponent(windowTo)}`,
    { token, org: orgId },
  );
  ok('Calendrier consultable', calendar.status === 200, describe(calendar));
  ok(
    'La publication datée apparaît',
    calendar.data?.entries.some((entry) => entry.id === calendarId),
  );
  ok(
    'Le fuseau de l’organisation accompagne la réponse',
    calendar.data?.timezone === 'Europe/Paris',
    calendar.data?.timezone,
  );

  const calendarInstagram = await call(
    `/calendar?from=${encodeURIComponent(windowFrom)}&to=${encodeURIComponent(windowTo)}&platform=INSTAGRAM`,
    { token, org: orgId },
  );
  ok(
    'Le filtre par réseau écarte les autres plateformes',
    !calendarInstagram.data?.entries.some((entry) => entry.id === calendarId),
  );

  const calendarScheduled = await call(
    `/calendar?from=${encodeURIComponent(windowFrom)}&to=${encodeURIComponent(windowTo)}&status=SCHEDULED`,
    { token, org: orgId },
  );
  ok(
    'Le filtre par statut écarte les brouillons',
    !calendarScheduled.data?.entries.some((entry) => entry.id === calendarId),
  );

  // --- Fuseau horaire de l'organisation ---
  const badTimezone = await call(`/organizations/${orgId}/timezone`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { timezone: 'Mars/Olympus' },
  });
  ok('Un fuseau inconnu est refusé (400)', badTimezone.status === 400, describe(badTimezone));

  const goodTimezone = await call(`/organizations/${orgId}/timezone`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { timezone: 'America/Montreal' },
  });
  ok('Le fuseau est modifiable', goodTimezone.status === 200, describe(goodTimezone));
  ok('Le nouveau fuseau est renvoyé', goodTimezone.data?.timezone === 'America/Montreal');

  const calendarMontreal = await call(
    `/calendar?from=${encodeURIComponent(windowFrom)}&to=${encodeURIComponent(windowTo)}`,
    { token, org: orgId },
  );
  ok(
    'Le calendrier suit le fuseau de l’organisation',
    calendarMontreal.data?.timezone === 'America/Montreal',
    calendarMontreal.data?.timezone,
  );

  await call(`/organizations/${orgId}/timezone`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { timezone: 'Europe/Paris' },
  });

  // --- RBAC ---
  const viewerEmail = `phase6-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerRead = await call(`/publications/${publicationA}`, {
    token: viewer.token,
    org: orgId,
  });
  ok('Un VIEWER consulte les publications', viewerRead.status === 200, describe(viewerRead));

  const viewerCreate = await call('/publications', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: {
      postType: 'TEXT',
      targets: [{ socialAccountId: accounts.LINKEDIN, body: 'Interdit.' }],
    },
  });
  ok(
    'Un VIEWER ne peut pas créer de publication (403)',
    viewerCreate.status === 403,
    describe(viewerCreate),
  );

  const viewerPublish = await call(`/publications/${publicationC}/publish`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
  });
  ok('Un VIEWER ne peut pas publier (403)', viewerPublish.status === 403, describe(viewerPublish));

  const viewerDue = await call('/publications/run-due', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
  });
  ok(
    'Un VIEWER ne peut pas déclencher les échéances (403)',
    viewerDue.status === 403,
    describe(viewerDue),
  );

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase6-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  const crossRead = await call(`/publications/${publicationA}`, {
    token: other.token,
    org: otherOrgId,
  });
  ok(
    'Une publication est invisible depuis une autre organisation (404)',
    crossRead.status === 404,
    describe(crossRead),
  );

  // --- Tableau de bord ---
  const dashboard = await call('/dashboard', { token, org: orgId });
  ok(
    'Tableau de bord : compteur de publications',
    dashboard.status === 200 && dashboard.data?.publications >= 5,
    String(dashboard.data?.publications),
  );
  ok(
    'Tableau de bord : aucune publication programmée restante',
    dashboard.data?.scheduledPublications === 0,
    String(dashboard.data?.scheduledPublications),
  );

  console.log(`\n✅ Phase 6 : ${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n❌ Échec du test Phase 6 : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
