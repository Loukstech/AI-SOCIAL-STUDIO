#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 4 (édition, clips et exports).
 *
 *   node scripts/smoke-phase4.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase4.mjs
 *
 * Couvre : édition manuelle de la transcription, recalcul des pistes, les sept
 * styles de sous-titres, les exports SRT / VTT / TXT, l'extraction des meilleurs
 * passages (Mode A), l'isolation multi-tenant et le RBAC.
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

const STYLES = ['PROFESSIONAL', 'MINIMAL', 'KARAOKE', 'KEYWORDS', 'DYNAMIC', 'CREATOR', 'PODCAST'];

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

/** Transcription éditée : une accroche, un corps, une conclusion. */
const EDITED_SEGMENTS = [
  { start: 0, end: 4, text: 'Comment doubler sa portée organique sans budget publicitaire ?' },
  { start: 4, end: 9, text: 'La méthode tient en trois étapes simples et mesurables.' },
  { start: 9, end: 14, text: 'Découpez la source, isolez les passages autonomes, sous-titrez.' },
  { start: 14, end: 20, text: 'Mesurez la rétention, puis itérez sur le format gagnant.' },
];

async function main() {
  console.log(`Phase 4 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  // --- Contexte ---
  const owner = await register(
    `phase4-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Studio ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  const project = await call('/video-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: `Édition ${RUN_ID}`, description: 'Test de la Phase 4.' },
  });
  ok('Projet vidéo créé', project.status === 201, describe(project));
  const projectId = project.data?.id;

  const transcribed = await call(`/video-projects/${projectId}/transcribe`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok('Transcription initiale', transcribed.status === 200, describe(transcribed));

  // --- Sept styles de sous-titres ---
  const tracks = {};
  for (const style of STYLES) {
    const track = await call(`/video-projects/${projectId}/subtitles`, {
      method: 'POST',
      token,
      org: orgId,
      body: { style },
    });
    ok(`Style ${style} généré`, track.status === 201, describe(track));
    ok(`Style ${style} : cues > 0`, (track.data?.cueCount ?? 0) > 0);
    tracks[style] = track.data;
  }

  const detailWithTracks = await call(`/video-projects/${projectId}`, { token, org: orgId });
  ok(
    'Les sept pistes coexistent',
    detailWithTracks.data?.subtitles.length === 7,
    describe(detailWithTracks),
  );

  // --- Exports SRT / VTT / TXT ---
  const trackId = tracks.PROFESSIONAL.id;
  const srt = await call(`/video-projects/${projectId}/subtitles/${trackId}/export?format=srt`, {
    token,
    org: orgId,
  });
  ok('Export SRT', srt.status === 200 && srt.data?.format === 'srt', describe(srt));
  ok(
    'Export SRT : contenu horodaté',
    /^1\r?\n\d{2}:\d{2}:\d{2},\d{3} -->/.test(srt.data?.content ?? ''),
  );
  ok(
    'Export SRT : nom de fichier explicite',
    typeof srt.data?.filename === 'string' && srt.data.filename.endsWith('.srt'),
    srt.data?.filename,
  );

  const vtt = await call(`/video-projects/${projectId}/subtitles/${trackId}/export?format=vtt`, {
    token,
    org: orgId,
  });
  ok('Export VTT', vtt.status === 200 && vtt.data?.format === 'vtt', describe(vtt));
  ok('Export VTT : en-tête WEBVTT', (vtt.data?.content ?? '').startsWith('WEBVTT\n\n'));
  ok(
    'Export VTT : horodatage à points',
    /--> \d{2}:\d{2}:\d{2}\.\d{3}/.test(vtt.data?.content ?? ''),
  );
  ok('Export VTT : pas de virgule décimale', !(vtt.data?.content ?? '').includes(',000'));

  const txt = await call(`/video-projects/${projectId}/subtitles/${trackId}/export?format=txt`, {
    token,
    org: orgId,
  });
  ok('Export TXT', txt.status === 200 && txt.data?.format === 'txt', describe(txt));
  ok('Export TXT : texte brut sans timecodes', !(txt.data?.content ?? '').includes('-->'));

  const badFormat = await call(
    `/video-projects/${projectId}/subtitles/${trackId}/export?format=ass`,
    { token, org: orgId },
  );
  ok('Format d’export inconnu refusé (400)', badFormat.status === 400, describe(badFormat));

  const unknownTrack = await call(
    `/video-projects/${projectId}/subtitles/piste-inexistante/export?format=srt`,
    { token, org: orgId },
  );
  ok('Piste inconnue → 404', unknownTrack.status === 404, describe(unknownTrack));

  // --- Édition de la transcription ---
  const invalidOrder = await call(`/video-projects/${projectId}/transcript`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: {
      segments: [
        { start: 5, end: 9, text: 'Deuxième' },
        { start: 1, end: 4, text: 'Premier' },
      ],
    },
  });
  ok('Segments désordonnés refusés (400)', invalidOrder.status === 400, describe(invalidOrder));

  const invalidBounds = await call(`/video-projects/${projectId}/transcript`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { segments: [{ start: 8, end: 4, text: 'Bornes inversées' }] },
  });
  ok('Bornes inversées refusées (400)', invalidBounds.status === 400, describe(invalidBounds));

  const emptyText = await call(`/video-projects/${projectId}/transcript`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { segments: [{ start: 0, end: 2, text: '   ' }] },
  });
  ok('Segment vide refusé (400)', emptyText.status === 400, describe(emptyText));

  const edited = await call(`/video-projects/${projectId}/transcript`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { segments: EDITED_SEGMENTS },
  });
  ok('Transcription éditée', edited.status === 200, describe(edited));
  ok(
    'Les segments sont remplacés',
    edited.data?.transcript?.segments.length === EDITED_SEGMENTS.length,
    describe(edited),
  );
  ok(
    'Le texte de la transcription est recalculé',
    (edited.data?.transcript?.text ?? '').includes('portée organique'),
  );
  ok('La durée suit la nouvelle transcription', edited.data?.durationSeconds === 20);
  ok('Les pistes obsolètes sont supprimées', edited.data?.subtitles.length === 0, describe(edited));

  // --- Régénération après édition ---
  const regenerated = await call(`/video-projects/${projectId}/subtitles`, {
    method: 'POST',
    token,
    org: orgId,
    body: { style: 'PROFESSIONAL' },
  });
  ok('Piste régénérée depuis le texte édité', regenerated.status === 201, describe(regenerated));
  ok(
    'Le contenu reflète le texte corrigé',
    (regenerated.data?.content ?? '').includes('portée organique'),
  );
  ok(
    'Les cues correspondent aux quatre segments',
    regenerated.data?.cueCount === EDITED_SEGMENTS.length,
    `${regenerated.data?.cueCount}`,
  );

  // --- Extraction de clips (Mode A) ---
  const earlyClips = await call(`/video-projects/${projectId}/clips`, {
    method: 'POST',
    token,
    org: orgId,
    body: {},
  });
  ok('Clips extraits', earlyClips.status === 201, describe(earlyClips));
  ok(
    'Au moins un clip proposé',
    Array.isArray(earlyClips.data) && earlyClips.data.length > 0,
    describe(earlyClips),
  );

  const clips = earlyClips.data ?? [];
  for (const clip of clips) {
    ok(
      `Clip « ${clip.title} » : bornes cohérentes`,
      clip.start >= 0 &&
        clip.end > clip.start &&
        Math.abs(clip.duration - (clip.end - clip.start)) < 0.1,
    );
    ok(
      `Clip « ${clip.title} » : score borné`,
      Number.isInteger(clip.score) && clip.score >= 0 && clip.score <= 100,
      `${clip.score}`,
    );
    ok(`Clip « ${clip.title} » : justification fournie`, clip.rationale.length > 0);
  }
  ok(
    'Clips classés par score décroissant',
    clips.every((clip, index) => index === 0 || clips[index - 1].score >= clip.score),
  );

  const clipsInDetail = await call(`/video-projects/${projectId}`, { token, org: orgId });
  ok(
    'Les clips apparaissent dans le détail',
    clipsInDetail.data?.clips.length === clips.length,
    describe(clipsInDetail),
  );

  const firstClip = clips[0];
  const selected = await call(`/video-projects/${projectId}/clips/${firstClip.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { selected: true },
  });
  ok(
    'Clip retenu',
    selected.status === 200 && selected.data?.selected === true,
    describe(selected),
  );

  const retimed = await call(`/video-projects/${projectId}/clips/${firstClip.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { start: 1, end: 9 },
  });
  ok(
    'Points de coupe ajustables',
    retimed.status === 200 &&
      retimed.data?.start === 1 &&
      Math.abs(retimed.data.duration - 8) < 0.1,
    describe(retimed),
  );

  const badCut = await call(`/video-projects/${projectId}/clips/${firstClip.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { start: 10, end: 5 },
  });
  ok('Coupe invalide refusée (400)', badCut.status === 400, describe(badCut));

  const removedClip = await call(`/video-projects/${projectId}/clips/${firstClip.id}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Clip retiré (204)', removedClip.status === 204, describe(removedClip));

  const afterClipDelete = await call(`/video-projects/${projectId}`, { token, org: orgId });
  ok(
    'Le clip supprimé disparaît',
    afterClipDelete.data?.clips.length === clips.length - 1,
    describe(afterClipDelete),
  );

  // --- Isolation et RBAC ---
  const other = await register(
    `phase4-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const crossTenant = await call(`/video-projects/${projectId}/clips`, {
    method: 'POST',
    token: other.token,
    org: otherOrgs.data?.[0]?.id,
    body: {},
  });
  ok('Extraction impossible depuis une autre organisation (404)', crossTenant.status === 404);

  const viewerEmail = `phase4-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerExport = await call(
    `/video-projects/${projectId}/subtitles/${regenerated.data.id}/export?format=vtt`,
    { token: viewer.token, org: orgId },
  );
  ok(
    'Un VIEWER peut exporter les sous-titres',
    viewerExport.status === 200 && viewerExport.data?.format === 'vtt',
    describe(viewerExport),
  );

  const viewerEdit = await call(`/video-projects/${projectId}/transcript`, {
    method: 'PATCH',
    token: viewer.token,
    org: orgId,
    body: { segments: EDITED_SEGMENTS },
  });
  ok(
    'Un VIEWER ne peut pas éditer la transcription (403)',
    viewerEdit.status === 403,
    describe(viewerEdit),
  );

  const viewerClips = await call(`/video-projects/${projectId}/clips`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: {},
  });
  ok(
    'Un VIEWER ne peut pas extraire de clips (403)',
    viewerClips.status === 403,
    describe(viewerClips),
  );

  // --- Nettoyage ---
  const removed = await call(`/video-projects/${projectId}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Projet supprimé (204)', removed.status === 204, describe(removed));

  console.log(`\n✅ Phase 4 : ${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n❌ Échec du test Phase 4 : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
