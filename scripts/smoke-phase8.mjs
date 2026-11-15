#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 8 (déclinaison multi-formats).
 *
 *   node scripts/smoke-phase8.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase8.mjs
 *
 * Couvre : déclinaison dans plusieurs gabarits, héritage des calques de texte,
 * de la palette et de la graine, refus motivés (format identique, personnalisé,
 * doublon), propagation et retrait de la plateforme incompatible, traçabilité
 * de l'origine, validation, RBAC, isolation multi-tenant, et les conditions
 * d'un export PNG sans perte.
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

/** Recompose le flux textuel : chaque ligne est un `<text>` distinct. */
function textContent(svg) {
  return [...String(svg ?? '').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1] ?? '')
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  console.log(`Phase 8 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase8-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Déclinaisons ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  // --- Visuel d'origine ---
  const source = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Annoncer l’ouverture de l’atelier avec un ton posé',
      title: `Source ${RUN_ID}`,
      format: 'SQUARE',
      style: 'EDITORIAL',
      headline: 'Portes ouvertes samedi',
      subheadline: 'De 10 h à 18 h, sans inscription.',
      callToAction: 'Réserver',
      badge: 'Atelier',
      palette: ['#0f172a', '#7c5cff', '#22d3ee'],
      seed: 31415,
    },
  });
  ok('Visuel d’origine créé', source.status === 201, describe(source));
  ok('Un visuel d’origine n’a pas de parent', source.data?.sourceProjectId === null);

  // --- Déclinaison nominale ---
  const declined = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['STORY_9_16', 'LANDSCAPE_16_9'] },
  });
  ok('Déclinaison acceptée (201)', declined.status === 201, describe(declined));
  ok('Deux visuels produits', declined.data?.created?.length === 2, describe(declined));
  ok('Aucun format ignoré', declined.data?.skipped?.length === 0);

  const story = declined.data?.created?.find((item) => item.format === 'STORY_9_16');
  const landscape = declined.data?.created?.find((item) => item.format === 'LANDSCAPE_16_9');

  ok('La déclinaison story est en 1080×1920', story?.width === 1080 && story?.height === 1920);
  ok(
    'La déclinaison paysage est en 1920×1080',
    landscape?.width === 1920 && landscape?.height === 1080,
  );
  ok('Les deux déclinaisons pointent vers l’origine', story?.sourceProjectId === source.data.id);
  ok(
    'La déclinaison paysage pointe aussi vers l’origine',
    landscape?.sourceProjectId === source.data.id,
  );

  // --- Héritage du contenu ---
  ok('Le titre est repris', story?.headline === 'Portes ouvertes samedi');
  ok('Le sous-titre est repris', story?.subheadline === 'De 10 h à 18 h, sans inscription.');
  ok('Le bouton est repris', story?.callToAction === 'Réserver');
  ok('La pastille est reprise', story?.badge === 'Atelier');
  ok(
    'La palette est reprise',
    JSON.stringify(story?.palette) === JSON.stringify(source.data.palette),
  );
  ok('La graine est reprise', story?.seed === source.data.seed);
  ok('Le style est repris', story?.style === 'EDITORIAL');
  ok('Le prompt est repris', story?.prompt === source.data.prompt);
  ok('Le titre interne est repris', story?.title === source.data.title);

  // --- Le rendu est bien recomposé, pas étiré ---
  ok('Le SVG de la story diffère de l’origine', story?.svg !== source.data.svg);
  ok(
    'Les textes survivent au changement de gabarit',
    textContent(story?.svg).includes('Portes ouvertes samedi'),
  );
  ok(
    'Le sous-titre survit aussi',
    textContent(story?.svg).includes('De 10 h à 18 h, sans inscription.'),
  );
  ok(
    'Les dimensions du SVG correspondent au format',
    story?.svg?.includes('viewBox="0 0 1080 1920"'),
  );

  // --- Refus motivés ---
  const sameFormat = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['SQUARE'] },
  });
  ok('Décliner vers le même format ne crée rien', sameFormat.data?.created?.length === 0);
  ok(
    'Le format identique est expliqué',
    /identique/i.test(sameFormat.data?.skipped?.[0]?.reason ?? ''),
    sameFormat.data?.skipped?.[0]?.reason,
  );

  const custom = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['CUSTOM'] },
  });
  ok('Un format personnalisé est ignoré', custom.data?.created?.length === 0);
  ok(
    'La raison mentionne les dimensions',
    /dimensions/i.test(custom.data?.skipped?.[0]?.reason ?? ''),
    custom.data?.skipped?.[0]?.reason,
  );

  const deduped = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['PORTRAIT_4_5', 'PORTRAIT_4_5'] },
  });
  ok('Un doublon n’est produit qu’une fois', deduped.data?.created?.length === 1);

  // --- Validation ---
  const empty = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: [] },
  });
  ok('Une demande vide est refusée (400)', empty.status === 400, describe(empty));

  const tooMany = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: {
      formats: ['STORY_9_16', 'PORTRAIT_4_5', 'LANDSCAPE_16_9', 'CUSTOM', 'SQUARE', 'STORY_9_16'],
    },
  });
  ok('Plus de cinq formats est refusé (400)', tooMany.status === 400, describe(tooMany));

  const unknownFormat = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['CARRE'] },
  });
  ok('Un format inconnu est refusé (400)', unknownFormat.status === 400, describe(unknownFormat));

  const missing = await call('/image-projects/visuel-inexistant/decline', {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['STORY_9_16'] },
  });
  ok('Décliner un visuel inexistant renvoie 404', missing.status === 404, describe(missing));

  // --- Plateforme : propagation puis retrait ---
  const instagram = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Annoncer les portes ouvertes sur Instagram',
      format: 'SQUARE',
      platform: 'INSTAGRAM',
    },
  });
  ok('Visuel carré destiné à Instagram', instagram.status === 201, describe(instagram));

  const instaStory = await call(`/image-projects/${instagram.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['STORY_9_16'] },
  });
  ok(
    'La plateforme compatible est conservée',
    instaStory.data?.created?.[0]?.platform === 'INSTAGRAM',
    String(instaStory.data?.created?.[0]?.platform),
  );

  const linkedin = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Annoncer les portes ouvertes sur LinkedIn',
      format: 'SQUARE',
      platform: 'LINKEDIN',
    },
  });
  ok('Visuel carré destiné à LinkedIn', linkedin.status === 201, describe(linkedin));

  const linkedinStory = await call(`/image-projects/${linkedin.data.id}/decline`, {
    method: 'POST',
    token,
    org: orgId,
    body: { formats: ['STORY_9_16'] },
  });
  const linkedinVariant = linkedinStory.data?.created?.[0];
  ok('Une story est produite malgré tout', Boolean(linkedinVariant), describe(linkedinStory));
  ok(
    'La plateforme incompatible est retirée',
    linkedinVariant?.platform === null,
    String(linkedinVariant?.platform),
  );
  ok(
    'L’avertissement explique le retrait',
    (linkedinVariant?.warnings ?? []).some((warning) => /sans plateforme/i.test(warning)),
    JSON.stringify(linkedinVariant?.warnings),
  );
  ok(
    'Le visuel reste exploitable sans plateforme',
    linkedinVariant?.width === 1080 && linkedinVariant?.height === 1920,
  );

  // --- Traçabilité dans la liste ---
  const list = await call('/image-projects', { token, org: orgId });
  ok('La liste répond 200', list.status === 200, describe(list));
  const listed = list.data?.find((item) => item.id === story?.id);
  ok('La déclinaison figure dans la liste', Boolean(listed));
  ok('La liste expose l’origine', listed?.sourceProjectId === source.data.id);
  ok(
    'Les visuels d’origine n’ont pas de parent',
    list.data?.filter((item) => item.sourceProjectId === null).length >= 2,
  );

  // --- Export PNG : conditions d'un rendu sans perte ---
  const download = await fetch(`${API_URL}/api/v1/image-projects/${story?.id}/download`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': orgId },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const svg = await download.text();
  ok('Le SVG de la déclinaison se télécharge', download.status === 200, String(download.status));
  ok(
    'Le SVG est autonome, donc convertible en PNG sans perte',
    !/<image\b/.test(svg),
    'aucune ressource externe',
  );
  ok('Le SVG déclaré en 1080×1920', svg.includes('width="1080"') && svg.includes('height="1920"'));

  const media = await call('/media', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      name: `Logo ${RUN_ID}`,
      kind: 'IMAGE',
      sourceUrl: 'https://cdn.example.com/logo-declinaison.svg',
    },
  });
  ok('Média logo créé', media.status === 201, describe(media));

  const withLogo = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Un visuel qui porte le logo de la marque',
      format: 'SQUARE',
      logoMediaId: media.data.id,
    },
  });
  ok('Visuel avec logo créé', withLogo.status === 201, describe(withLogo));
  ok(
    'Un logo distant est référencé par URL',
    /<image\b[^>]*href="https?:\/\//.test(withLogo.data?.svg ?? ''),
    'l’intégration en data: URI est donc nécessaire à l’export PNG',
  );

  // --- RBAC ---
  const viewerEmail = `phase8-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerRead = await call(`/image-projects/${source.data.id}`, {
    token: viewer.token,
    org: orgId,
  });
  ok('Un VIEWER consulte le visuel d’origine', viewerRead.status === 200, describe(viewerRead));

  const viewerDecline = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { formats: ['STORY_9_16'] },
  });
  ok('Un VIEWER ne peut pas décliner (403)', viewerDecline.status === 403, describe(viewerDecline));

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase8-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  ok('Organisation tierce disponible', Boolean(otherOrgId) && otherOrgId !== orgId);

  const stolen = await call(`/image-projects/${source.data.id}/decline`, {
    method: 'POST',
    token: other.token,
    org: otherOrgId,
    body: { formats: ['STORY_9_16'] },
  });
  ok(
    'Décliner le visuel d’une autre organisation renvoie 404',
    stolen.status === 404,
    describe(stolen),
  );

  // --- Suppression de l'origine ---
  const removed = await call(`/image-projects/${source.data.id}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Suppression de l’origine (204)', removed.status === 204, describe(removed));

  const afterRemove = await call(`/image-projects/${story?.id}`, { token, org: orgId });
  ok(
    'La déclinaison survit à la suppression de l’origine',
    afterRemove.status === 200,
    describe(afterRemove),
  );
  ok('La déclinaison conserve son origine', afterRemove.data?.sourceProjectId === source.data.id);

  const listAfter = await call('/image-projects', { token, org: orgId });
  ok(
    'L’origine supprimée disparaît de la liste',
    !listAfter.data?.some((item) => item.id === source.data.id),
  );

  const dashboard = await call('/dashboard', { token, org: orgId });
  ok('Le tableau de bord répond 200', dashboard.status === 200, describe(dashboard));
  ok(
    'Le compteur de visuels inclut les déclinaisons',
    dashboard.data?.imageProjects >= 6,
    String(dashboard.data?.imageProjects),
  );

  console.log(`\n${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
