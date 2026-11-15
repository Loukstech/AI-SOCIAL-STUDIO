#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 3 (AI Video Studio).
 *
 *   node scripts/smoke-phase3.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase3.mjs
 *
 * Un propriétaire et un lecteur jetables sont créés à chaque exécution. Le
 * parcours couvre : création de projet, transcription, génération des trois
 * styles de sous-titres, contenu SRT, isolation multi-tenant, RBAC et
 * suppression. Aucun identifiant n'est publié dans le dépôt.
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

/** Un fichier SRT valide commence par « 1 » et contient des flèches horaires. */
function looksLikeSrt(content) {
  return /^1\r?\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(content);
}

async function main() {
  console.log(`Phase 3 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  // --- Propriétaire et contexte ---
  const owner = await register(
    `phase3-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Studio ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  const brand = await call('/brands', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: `Marque ${RUN_ID}` },
  });
  ok('Marque créée pour rattacher le projet', brand.status === 201, describe(brand));

  // --- Création du projet ---
  const created = await call('/video-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      name: `Lancement ${RUN_ID}`,
      description: 'Annonce de la nouvelle collection, ton chaleureux.',
      brandId: brand.data.id,
    },
  });
  ok('Projet vidéo créé', created.status === 201, describe(created));
  ok('Statut initial DRAFT', created.data?.status === 'DRAFT');
  ok('Langue par défaut « fr »', created.data?.language === 'fr');
  ok('Aucune piste de sous-titres', created.data?.subtitleCount === 0);
  ok('Marque rattachée', created.data?.brandId === brand.data.id);
  const projectId = created.data?.id;

  const nameTooShort = await call('/video-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: 'a' },
  });
  ok('Nom trop court refusé (400)', nameTooShort.status === 400, describe(nameTooShort));

  const badUrl = await call('/video-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: 'Source invalide', sourceUrl: 'pas-une-url' },
  });
  ok('URL de source invalide refusée (400)', badUrl.status === 400, describe(badUrl));

  const list = await call('/video-projects', { token, org: orgId });
  ok(
    'Le projet apparaît dans la liste',
    list.status === 200 && list.data.some((row) => row.id === projectId),
    describe(list),
  );

  const detail = await call(`/video-projects/${projectId}`, { token, org: orgId });
  ok(
    'Détail : ni transcription ni sous-titres au départ',
    detail.status === 200 &&
      detail.data?.transcript === null &&
      detail.data?.subtitles.length === 0,
    describe(detail),
  );

  // --- Sous-titres refusés avant transcription ---
  const tooEarly = await call(`/video-projects/${projectId}/subtitles`, {
    method: 'POST',
    token,
    org: orgId,
    body: { style: 'PROFESSIONAL' },
  });
  ok('Sous-titres refusés sans transcription (400)', tooEarly.status === 400, describe(tooEarly));

  // --- Transcription ---
  const transcribed = await call(`/video-projects/${projectId}/transcribe`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok('Transcription générée', transcribed.status === 200, describe(transcribed));
  ok('Transcription COMPLETED', transcribed.data?.transcript?.status === 'COMPLETED');
  ok(
    'Fournisseur « mock » tracé',
    transcribed.data?.transcript?.provider === 'mock',
    describe(transcribed),
  );
  const segments = transcribed.data?.transcript?.segments ?? [];
  ok('Segments non vides', segments.length > 0, `${segments.length} segment(s)`);
  ok(
    'Segments ordonnés et bornés',
    segments.every(
      (segment, index) =>
        segment.end > segment.start && (index === 0 || segment.start >= segments[index - 1].end),
    ),
  );
  ok('Projet passé en TRANSCRIBED', transcribed.data?.status === 'TRANSCRIBED');
  ok(
    'Durée déduite de la transcription',
    typeof transcribed.data?.durationSeconds === 'number' && transcribed.data.durationSeconds > 0,
  );

  // --- Trois styles de sous-titres ---
  const tracks = {};
  for (const style of ['PROFESSIONAL', 'MINIMAL', 'KARAOKE']) {
    const track = await call(`/video-projects/${projectId}/subtitles`, {
      method: 'POST',
      token,
      org: orgId,
      body: { style },
    });
    ok(`Piste ${style} générée`, track.status === 201, describe(track));
    ok(`Piste ${style} : cues > 0`, (track.data?.cueCount ?? 0) > 0);
    ok(`Piste ${style} : SRT bien formé`, looksLikeSrt(track.data?.content ?? ''));
    ok(`Piste ${style} : langue reprise`, track.data?.language === 'fr');
    tracks[style] = track.data;
  }

  // Le style conditionne le découpage : le karaoké produit plus de cues.
  ok(
    'Le style change le découpage (karaoké > professionnel)',
    tracks.KARAOKE.cueCount > tracks.PROFESSIONAL.cueCount,
    `${tracks.KARAOKE.cueCount} vs ${tracks.PROFESSIONAL.cueCount}`,
  );
  ok(
    'Les contenus SRT diffèrent selon le style',
    tracks.KARAOKE.content !== tracks.PROFESSIONAL.content,
  );

  const regenerated = await call(`/video-projects/${projectId}/subtitles`, {
    method: 'POST',
    token,
    org: orgId,
    body: { style: 'PROFESSIONAL' },
  });
  ok(
    'Régénérer un style met à jour la piste existante',
    regenerated.status === 201 && regenerated.data?.id === tracks.PROFESSIONAL.id,
    describe(regenerated),
  );

  const afterTracks = await call(`/video-projects/${projectId}`, { token, org: orgId });
  ok(
    'Trois pistes distinctes au total',
    afterTracks.data?.subtitles.length === 3,
    describe(afterTracks),
  );

  const badStyle = await call(`/video-projects/${projectId}/subtitles`, {
    method: 'POST',
    token,
    org: orgId,
    body: { style: 'INCONNU' },
  });
  ok('Style inconnu refusé (400)', badStyle.status === 400, describe(badStyle));

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase3-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  const crossTenant = await call(`/video-projects/${projectId}`, {
    token: other.token,
    org: otherOrgId,
  });
  ok('Projet invisible depuis une autre organisation (404)', crossTenant.status === 404);

  const unknown = await call('/video-projects/projet-inexistant', { token, org: orgId });
  ok('Identifiant inconnu → 404', unknown.status === 404, describe(unknown));

  // --- RBAC ---
  const viewerEmail = `phase3-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerRead = await call('/video-projects', { token: viewer.token, org: orgId });
  ok(
    'Un VIEWER lit les projets vidéo',
    viewerRead.status === 200 && viewerRead.data.length === 1,
    describe(viewerRead),
  );

  const viewerCreate = await call('/video-projects', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { name: 'Interdit' },
  });
  ok(
    'Un VIEWER ne peut pas créer de projet (403)',
    viewerCreate.status === 403,
    describe(viewerCreate),
  );

  const viewerTranscribe = await call(`/video-projects/${projectId}/transcribe`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: {},
  });
  ok(
    'Un VIEWER ne peut pas transcrire (403)',
    viewerTranscribe.status === 403,
    describe(viewerTranscribe),
  );

  // --- Tableau de bord et suppression ---
  const dashboard = await call('/dashboard', { token, org: orgId });
  ok(
    'Tableau de bord : compteur de projets vidéo',
    dashboard.status === 200 && dashboard.data?.videoProjects === 1,
    describe(dashboard),
  );

  const removed = await call(`/video-projects/${projectId}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Suppression du projet (204)', removed.status === 204, describe(removed));

  const afterDelete = await call('/video-projects', { token, org: orgId });
  ok(
    'Le projet supprimé disparaît de la liste',
    afterDelete.status === 200 && afterDelete.data.length === 0,
    describe(afterDelete),
  );

  const gone = await call(`/video-projects/${projectId}`, { token, org: orgId });
  ok('Le projet supprimé renvoie 404', gone.status === 404, describe(gone));

  const dashboardAfter = await call('/dashboard', { token, org: orgId });
  ok(
    'Le compteur retombe à zéro',
    dashboardAfter.data?.videoProjects === 0,
    describe(dashboardAfter),
  );

  console.log(`\n✅ Phase 3 : ${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n❌ Échec du test Phase 3 : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
