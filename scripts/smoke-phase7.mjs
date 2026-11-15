#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 7 (AI Image Studio + Brand Kit).
 *
 *   node scripts/smoke-phase7.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase7.mjs
 *
 * Couvre : Brand Kit complet (palette, polices, slogan, contacts, liens,
 * logos, références, consignes), propriété des médias, composition SVG
 * déterministe, calques de texte éditables, incompatibilité de format par
 * plateforme, avertissements de lisibilité, téléchargement, RBAC et isolation
 * multi-tenant.
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

/** Requête brute : le téléchargement renvoie du SVG, pas du JSON. */
async function raw(path, token, org) {
  const headers = { Authorization: `Bearer ${token}` };
  if (org) headers['X-Organization-Id'] = org;
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    disposition: response.headers.get('content-disposition') ?? '',
    body: await response.text(),
  };
}

function describe(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

/**
 * Le composeur place chaque ligne dans un `<text>` distinct : on recompose le
 * flux textuel pour vérifier qu'un titre survit au retour à la ligne.
 */
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
  console.log(`Phase 7 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase7-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Visuels ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  // --- Médias de référence ---
  const logo = await call('/media', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      name: `Logo ${RUN_ID}`,
      kind: 'IMAGE',
      sourceUrl: 'https://cdn.example.com/logo-atelier.svg',
    },
  });
  ok('Média logo créé', logo.status === 201, describe(logo));

  const photo = await call('/media', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      name: `Photo ${RUN_ID}`,
      kind: 'IMAGE',
      sourceUrl: 'https://cdn.example.com/photo-atelier.jpg',
    },
  });
  ok('Média photo créé', photo.status === 201, describe(photo));

  const orphan = await call('/media', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: `Sans URL ${RUN_ID}`, kind: 'IMAGE' },
  });
  ok('Média sans URL source créé', orphan.status === 201, describe(orphan));

  // --- Brand Kit ---
  const brand = await call('/brands', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      name: `Atelier ${RUN_ID}`,
      description: 'Atelier de fabrication numérique, ton posé.',
      primaryColor: '#1f2937',
      toneOfVoice: 'Direct, jamais familier',
      palette: ['#0f172a', '#7c5cff', '#22d3ee'],
      logoPrimaryId: logo.data?.id,
      logoSecondaryId: logo.data?.id,
      headingFont: 'Inter Tight',
      bodyFont: 'Inter',
      slogan: 'Le contenu, sans bruit',
      website: 'https://atelier.example.com',
      contactEmail: 'bonjour@atelier.example.com',
      contactPhone: '+33 1 23 45 67 89',
      socialLinks: [
        { platform: 'INSTAGRAM', url: 'https://instagram.com/atelier' },
        { platform: 'LINKEDIN', url: 'https://linkedin.com/company/atelier' },
      ],
      referenceImageIds: [photo.data?.id],
      editorialInstructions: 'Toujours nommer le matériau, jamais de superlatif.',
    },
  });
  ok('Brand Kit complet créé', brand.status === 201, describe(brand));
  ok('La palette est conservée dans l’ordre', brand.data?.palette?.length === 3);
  ok('Le slogan est enregistré', brand.data?.slogan === 'Le contenu, sans bruit');
  ok('Les deux liens sociaux sont enregistrés', brand.data?.socialLinks?.length === 2);
  ok('Le logo est référencé par identifiant', brand.data?.logoPrimaryId === logo.data?.id);
  ok(
    'Les consignes éditoriales sont conservées',
    brand.data?.editorialInstructions?.includes('matériau'),
  );

  const minimal = await call('/brands', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: `Minimal ${RUN_ID}` },
  });
  ok('Marque minimale créée', minimal.status === 201, describe(minimal));
  ok('Les champs absents valent null', minimal.data?.slogan === null);
  ok('Les tableaux absents sont vides', minimal.data?.palette?.length === 0);

  const cleared = await call(`/brands/${brand.data.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { slogan: null, palette: ['#111827', '#f59e0b'] },
  });
  ok('Mise à jour partielle du kit', cleared.status === 200, describe(cleared));
  ok('`null` vide bien le slogan', cleared.data?.slogan === null);
  ok('La palette est remplacée', cleared.data?.palette?.length === 2);

  const emptyPatch = await call(`/brands/${brand.data.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: {},
  });
  ok('Une modification vide est refusée (400)', emptyPatch.status === 400, describe(emptyPatch));

  const badColor = await call(`/brands/${brand.data.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { primaryColor: 'bleu' },
  });
  ok('Une couleur non hexadécimale est refusée (400)', badColor.status === 400, describe(badColor));

  const foreignMedia = await call('/brands', {
    method: 'POST',
    token,
    org: orgId,
    body: { name: `Intruse ${RUN_ID}`, logoPrimaryId: 'media-inexistant' },
  });
  ok(
    'Un logo appartenant à une autre organisation est refusé (404)',
    foreignMedia.status === 404,
    describe(foreignMedia),
  );

  // --- Composition d'un visuel ---
  const square = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { prompt: 'Annoncer l’ouverture de l’atelier avec un ton posé' },
  });
  ok('Visuel carré généré', square.status === 201, describe(square));
  ok('Les dimensions canoniques sont appliquées', square.data?.width === 1080);
  ok('Le SVG est renvoyé dans le détail', square.data?.svg?.startsWith('<svg'));
  ok(
    'Le titre est déduit du brief',
    square.data?.headline === 'Annoncer l’ouverture de l’atelier avec un ton posé',
    square.data?.headline,
  );
  ok(
    'Le moteur et sa version sont tracés',
    square.data?.provider === 'svg' && square.data?.model === 'layout-v1',
  );
  ok('Une graine est enregistrée', Number.isInteger(square.data?.seed));

  const story = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Annoncer les portes ouvertes du samedi matin',
      format: 'STORY_9_16',
      style: 'BOLD',
      platform: 'INSTAGRAM',
    },
  });
  ok('Visuel story généré pour Instagram', story.status === 201, describe(story));
  ok('Le format story est en 1080×1920', story.data?.width === 1080 && story.data?.height === 1920);
  ok(
    'Le style BOLD passe le titre en majuscules',
    textContent(story.data?.svg).includes('PORTES OUVERTES'),
    story.data?.headline,
  );

  const incompatible = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Annoncer les portes ouvertes du samedi matin',
      format: 'STORY_9_16',
      platform: 'LINKEDIN',
    },
  });
  ok(
    'Un format story est refusé sur LinkedIn (400)',
    incompatible.status === 400,
    describe(incompatible),
  );
  ok(
    'Le refus nomme les formats acceptés',
    /incompatible/i.test(incompatible.data?.message ?? '') &&
      /Carré/.test(incompatible.data?.message ?? ''),
    incompatible.data?.message,
  );

  const customIncomplete = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { prompt: 'Un visuel très allongé pour une bannière', format: 'CUSTOM' },
  });
  ok(
    'Un format personnalisé sans dimensions est refusé (400)',
    customIncomplete.status === 400,
    describe(customIncomplete),
  );

  const custom = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Un visuel très allongé pour une bannière de site',
      format: 'CUSTOM',
      width: 800,
      height: 1200,
    },
  });
  ok('Un format personnalisé complet est accepté', custom.status === 201, describe(custom));
  ok(
    'Les dimensions personnalisées sont respectées',
    custom.data?.width === 800 && custom.data?.height === 1200,
  );

  const shortPrompt = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { prompt: 'court' },
  });
  ok('Un brief trop court est refusé (400)', shortPrompt.status === 400, describe(shortPrompt));

  const badPalette = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { prompt: 'Un visuel avec une palette invalide', palette: ['rouge'] },
  });
  ok(
    'Une palette non hexadécimale est refusée (400)',
    badPalette.status === 400,
    describe(badPalette),
  );

  // --- Brand Kit appliqué au visuel ---
  const branded = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Présenter l’atelier et ses horaires d’ouverture',
      brandId: brand.data.id,
      format: 'SQUARE',
    },
  });
  ok('Visuel rattaché à une marque', branded.status === 201, describe(branded));
  ok('Le visuel reprend la palette de la marque', branded.data?.palette?.length === 2);
  ok(
    'Le logo de la marque est intégré',
    branded.data?.svg?.includes('<image href="https://cdn.example.com/logo-atelier.svg"'),
  );
  ok(
    'Le slogan vidé plus haut n’apparaît plus dans le pied de page',
    branded.data?.svg?.includes('Le contenu, sans bruit') === false,
  );

  const orphanLogo = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Un visuel dont le logo n’a pas d’URL source',
      logoMediaId: orphan.data.id,
    },
  });
  ok('Visuel généré malgré un logo sans URL', orphanLogo.status === 201, describe(orphanLogo));
  ok(
    'L’absence d’URL de logo est signalée',
    (orphanLogo.data?.warnings ?? []).some((warning) => /URL source/i.test(warning)),
    JSON.stringify(orphanLogo.data?.warnings),
  );

  const referenced = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      prompt: 'Un visuel appuyé sur une photo de l’atelier',
      referenceMediaIds: [photo.data.id],
    },
  });
  ok('Visuel avec image de référence', referenced.status === 201, describe(referenced));
  ok(
    'La référence est rendue en fond voilé',
    referenced.data?.svg?.includes('opacity="0.62"') &&
      referenced.data?.svg?.includes('photo-atelier.jpg'),
  );

  // --- Reproductibilité ---
  const seeded = {
    prompt: 'Un visuel reproductible pour vérifier la graine',
    seed: 987654,
    format: 'SQUARE',
    style: 'GRADIENT',
  };
  const first = await call('/image-projects', { method: 'POST', token, org: orgId, body: seeded });
  const second = await call('/image-projects', { method: 'POST', token, org: orgId, body: seeded });
  ok(
    'Deux créations avec la même graine réussissent',
    first.status === 201 && second.status === 201,
  );
  ok(
    'La même graine produit exactement le même SVG',
    first.data?.svg === second.data?.svg,
    `${first.data?.svg?.length} vs ${second.data?.svg?.length}`,
  );

  // --- Édition des calques de texte ---
  const corrected = await call(`/image-projects/${square.data.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: {
      headline: 'Portes ouvertes samedi',
      subheadline: 'De 10 h à 18 h, sans inscription.',
      callToAction: 'Réserver',
      badge: 'Atelier',
    },
  });
  ok(
    'Les textes sont corrigeables après génération',
    corrected.status === 200,
    describe(corrected),
  );
  ok(
    'Le SVG est recomposé avec le nouveau titre',
    textContent(corrected.data?.svg).includes('Portes ouvertes samedi'),
  );
  ok(
    'Le sous-titre corrigé est présent',
    textContent(corrected.data?.svg).includes('De 10 h à 18 h, sans inscription.'),
  );
  ok('Le bouton apparaît dans le SVG', textContent(corrected.data?.svg).includes('Réserver'));
  ok(
    'La graine ne change pas lors d’une correction de texte',
    corrected.data?.seed === square.data?.seed,
  );

  const clearedText = await call(`/image-projects/${square.data.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { headline: null },
  });
  ok('Un texte peut être effacé explicitement', clearedText.status === 200, describe(clearedText));
  ok('Le titre est bien null', clearedText.data?.headline === null);

  const rerendered = await call(`/image-projects/${square.data.id}/rerender`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Le décor peut être régénéré', rerendered.status === 200, describe(rerendered));
  ok('La graine change au nouveau décor', rerendered.data?.seed !== square.data?.seed);
  ok('Le SVG change aussi', rerendered.data?.svg !== square.data?.svg);

  // --- Échappement XML ---
  const injected = await call('/image-projects', {
    method: 'POST',
    token,
    org: orgId,
    body: { prompt: 'Un titre qui contient <script>alert(1)</script> volontairement' },
  });
  ok('Un titre contenant du balisage est accepté', injected.status === 201, describe(injected));
  ok(
    'Le balisage est échappé dans le SVG',
    injected.data?.svg?.includes('&lt;script&gt;') && !injected.data?.svg?.includes('<script>'),
  );

  // --- Téléchargement ---
  const download = await raw(`/image-projects/${square.data.id}/download`, token, orgId);
  ok('Le téléchargement répond 200', download.status === 200, String(download.status));
  ok(
    'Le type MIME est image/svg+xml',
    download.contentType.includes('image/svg+xml'),
    download.contentType,
  );
  ok(
    'Le fichier est proposé en pièce jointe',
    download.disposition.includes('attachment') && download.disposition.includes('.svg'),
    download.disposition,
  );
  ok('Le corps est bien du SVG', download.body.trimEnd().endsWith('</svg>'));

  // --- Liste et isolation ---
  const list = await call('/image-projects', { token, org: orgId });
  ok('La liste des visuels répond 200', list.status === 200, describe(list));
  ok(
    'Tous les visuels créés sont listés',
    list.data?.some((item) => item.id === square.data.id) &&
      list.data?.some((item) => item.id === branded.data.id),
  );
  ok(
    'La liste ne transporte pas la source SVG',
    list.data?.every((item) => item.svg === undefined),
  );

  const detail = await call(`/image-projects/${square.data.id}`, { token, org: orgId });
  ok('Le détail transporte la source SVG', typeof detail.data?.svg === 'string');

  const missing = await call('/image-projects/visuel-inexistant', { token, org: orgId });
  ok('Un visuel inexistant renvoie 404', missing.status === 404, describe(missing));

  // --- Tableau de bord ---
  const dashboard = await call('/dashboard', { token, org: orgId });
  ok('Le tableau de bord répond 200', dashboard.status === 200, describe(dashboard));
  ok(
    'Le compteur de visuels est alimenté',
    dashboard.data?.imageProjects >= 6,
    String(dashboard.data?.imageProjects),
  );

  // --- RBAC ---
  const viewerEmail = `phase7-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerRead = await call(`/image-projects/${square.data.id}`, {
    token: viewer.token,
    org: orgId,
  });
  ok('Un VIEWER consulte un visuel', viewerRead.status === 200, describe(viewerRead));

  const viewerCreate = await call('/image-projects', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { prompt: 'Un visuel que le lecteur ne peut pas créer' },
  });
  ok(
    'Un VIEWER ne peut pas générer de visuel (403)',
    viewerCreate.status === 403,
    describe(viewerCreate),
  );

  const viewerBrand = await call(`/brands/${brand.data.id}`, {
    method: 'PATCH',
    token: viewer.token,
    org: orgId,
    body: { slogan: 'Modifié par un lecteur' },
  });
  ok(
    'Un VIEWER ne peut pas modifier un Brand Kit (403)',
    viewerBrand.status === 403,
    describe(viewerBrand),
  );

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase7-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  ok('Organisation tierce disponible', Boolean(otherOrgId) && otherOrgId !== orgId);

  const stolen = await call(`/image-projects/${square.data.id}`, {
    token: other.token,
    org: otherOrgId,
  });
  ok(
    'Un visuel d’une autre organisation est introuvable (404)',
    stolen.status === 404,
    describe(stolen),
  );

  const stolenDownload = await raw(
    `/image-projects/${square.data.id}/download`,
    other.token,
    otherOrgId,
  );
  ok(
    'Le téléchargement croisé est refusé',
    stolenDownload.status === 404,
    String(stolenDownload.status),
  );

  const stolenBrand = await call(`/brands/${brand.data.id}`, {
    method: 'PATCH',
    token: other.token,
    org: otherOrgId,
    body: { slogan: 'Volé' },
  });
  ok(
    'Un Brand Kit d’une autre organisation est introuvable (404)',
    stolenBrand.status === 404,
    describe(stolenBrand),
  );

  const otherList = await call('/image-projects', { token: other.token, org: otherOrgId });
  ok(
    'La liste de l’organisation tierce est vide',
    otherList.data?.length === 0,
    describe(otherList),
  );

  // --- Suppression ---
  const removed = await call(`/image-projects/${custom.data.id}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Suppression d’un visuel (204)', removed.status === 204, describe(removed));

  const afterRemove = await call('/image-projects', { token, org: orgId });
  ok(
    'Le visuel supprimé disparaît de la liste',
    !afterRemove.data?.some((item) => item.id === custom.data.id),
  );

  const brandRemoved = await call(`/brands/${minimal.data.id}`, {
    method: 'DELETE',
    token,
    org: orgId,
  });
  ok('Suppression d’une marque (204)', brandRemoved.status === 204, describe(brandRemoved));

  const brandsAfter = await call('/brands', { token, org: orgId });
  ok(
    'La marque supprimée disparaît de la liste',
    !brandsAfter.data?.some((item) => item.id === minimal.data.id),
  );
  ok(
    'La marque utilisée par un visuel reste listée',
    brandsAfter.data?.some((item) => item.id === brand.data.id),
  );

  console.log(`\n${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
