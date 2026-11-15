#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 5 (AI Content Studio).
 *
 *   node scripts/smoke-phase5.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase5.mjs
 *
 * Couvre : analyse du brief, génération multiréseaux, respect des limites de
 * plateforme, édition des variantes, neuf actions de l'assistant, traduction,
 * isolation multi-tenant et RBAC.
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

const BRIEF =
  'Crée une publication professionnelle pour annoncer notre nouvelle formation en intelligence artificielle. Le ton doit être dynamique et accessible. Encourage les personnes intéressées à s’inscrire.';

/** Limites dures des plateformes, dupliquées ici pour vérifier le contrat public. */
const LIMITS = {
  FACEBOOK: 63_206,
  INSTAGRAM: 2_200,
  LINKEDIN: 3_000,
  TIKTOK: 2_200,
  YOUTUBE: 5_000,
  X: 280,
  PINTEREST: 500,
  THREADS: 500,
};

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

function variantOf(detail, platform, language = 'FR') {
  return detail.variants.find(
    (variant) => variant.platform === platform && variant.language === language,
  );
}

async function main() {
  console.log(`Phase 5 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase5-owner-${RUN_ID}@ai-social-studio.test`,
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
  ok('Marque créée', brand.status === 201, describe(brand));

  // --- Génération ---
  const platforms = ['LINKEDIN', 'INSTAGRAM', 'X', 'YOUTUBE'];
  const generated = await call('/ai/content/generate', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      brief: BRIEF,
      platforms,
      contentType: 'ANNOUNCEMENT',
      tone: 'DYNAMIC',
      brandId: brand.data.id,
    },
  });
  ok('Contenu généré', generated.status === 201, describe(generated));
  ok(
    'Une variante par plateforme',
    generated.data?.variants.length === platforms.length,
    describe(generated),
  );
  ok(
    'Sujet extrait du brief',
    generated.data?.subject === 'nouvelle formation en intelligence artificielle',
    generated.data?.subject,
  );
  ok('Objectif déduit', generated.data?.objective === 'annoncer', generated.data?.objective);
  ok('Fournisseur tracé', generated.data?.provider === 'mock');
  const projectId = generated.data?.id;

  for (const platform of platforms) {
    const variant = variantOf(generated.data, platform);
    ok(`Variante ${platform} présente`, Boolean(variant));
    ok(`Variante ${platform} : texte non vide`, (variant?.body ?? '').length > 20);
    ok(
      `Variante ${platform} : limite respectée`,
      variant.charCount <= LIMITS[platform],
      `${variant.charCount} / ${LIMITS[platform]}`,
    );
    ok(`Variante ${platform} : hashtags bornés`, variant.hashtags.length <= 10);
    ok(`Variante ${platform} : appel à l’action`, Boolean(variant.callToAction));
  }

  const youtube = variantOf(generated.data, 'YOUTUBE');
  ok('YouTube : titre fourni', Boolean(youtube?.title));
  const xVariant = variantOf(generated.data, 'X');
  ok('X : pas de titre', xVariant?.title === null);
  ok('X : tient en 280 caractères', xVariant.charCount <= 280, `${xVariant.charCount}`);
  ok(
    'Le nom de marque est repris',
    (variantOf(generated.data, 'LINKEDIN')?.body ?? '').includes(`Marque ${RUN_ID}`),
  );

  const regenerated = await call('/ai/content/generate', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      brief: BRIEF,
      platforms: ['LINKEDIN'],
      contentType: 'ANNOUNCEMENT',
      tone: 'DYNAMIC',
      brandId: brand.data.id,
    },
  });
  ok(
    'Génération déterministe pour une même entrée',
    variantOf(regenerated.data, 'LINKEDIN')?.body === variantOf(generated.data, 'LINKEDIN')?.body,
  );

  const tooShort = await call('/ai/content/generate', {
    method: 'POST',
    token,
    org: orgId,
    body: { brief: 'Trop court', platforms: ['X'] },
  });
  ok('Brief trop court refusé (400)', tooShort.status === 400, describe(tooShort));

  const noPlatform = await call('/ai/content/generate', {
    method: 'POST',
    token,
    org: orgId,
    body: { brief: BRIEF, platforms: [] },
  });
  ok('Aucune plateforme refusée (400)', noPlatform.status === 400, describe(noPlatform));

  // --- Lecture ---
  const list = await call('/content', { token, org: orgId });
  ok(
    'Le projet apparaît dans la liste',
    list.status === 200 && list.data.some((row) => row.id === projectId),
    describe(list),
  );

  const detail = await call(`/content/${projectId}`, { token, org: orgId });
  ok('Détail accessible', detail.status === 200, describe(detail));
  ok(
    'Le détail expose toutes les variantes',
    detail.data?.variants.length === platforms.length,
    describe(detail),
  );

  // --- Édition d'une variante ---
  const linkedin = variantOf(detail.data, 'LINKEDIN');
  const edited = await call(`/content/${projectId}/variants/${linkedin.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { body: 'Texte entièrement réécrit à la main.', hashtags: ['#Test', '#Édition'] },
  });
  ok('Variante modifiée', edited.status === 200, describe(edited));
  const editedVariant = variantOf(edited.data, 'LINKEDIN');
  ok('Le texte est remplacé', editedVariant.body === 'Texte entièrement réécrit à la main.');
  ok('La variante est marquée comme modifiée', editedVariant.edited === true);
  // Le texte publiable inclut le bloc d'hashtags, séparé par deux retours à la ligne.
  const expectedCount = 'Texte entièrement réécrit à la main.'.length + 2 + '#Test #Édition'.length;
  ok(
    'La longueur est recalculée',
    editedVariant.charCount === expectedCount,
    `${editedVariant.charCount} attendu ${expectedCount}`,
  );

  const tooManyTags = await call(`/content/${projectId}/variants/${xVariant.id}`, {
    method: 'PATCH',
    token,
    org: orgId,
    body: { hashtags: Array.from({ length: 12 }, (_, index) => `#Tag${index}`) },
  });
  ok('Trop de hashtags pour X refusé (400)', tooManyTags.status === 400, describe(tooManyTags));

  // --- Assistant rédactionnel ---
  const actions = [
    'FIX',
    'REPHRASE',
    'SHORTEN',
    'EXPAND',
    'CHANGE_TONE',
    'ADD_CTA',
    'HASHTAGS',
    'VARIATIONS',
  ];
  for (const action of actions) {
    const target = variantOf(detail.data, 'INSTAGRAM');
    const result = await call(`/content/${projectId}/variants/${target.id}/rewrite`, {
      method: 'POST',
      token,
      org: orgId,
      body: { action },
    });
    ok(`Assistant « ${action} »`, result.status === 200, describe(result));
    const after = variantOf(result.data, 'INSTAGRAM');
    ok(`Assistant « ${action} » : texte non vide`, (after?.body ?? '').length > 0);
  }

  const shortenResult = await call(
    `/content/${projectId}/variants/${variantOf(detail.data, 'YOUTUBE').id}/rewrite`,
    {
      method: 'POST',
      token,
      org: orgId,
      body: { action: 'SHORTEN' },
    },
  );
  ok(
    'Raccourcir réduit réellement le texte',
    (variantOf(shortenResult.data, 'YOUTUBE')?.body.length ?? 0) <
      (variantOf(detail.data, 'YOUTUBE')?.body.length ?? 0),
  );

  // --- Traduction ---
  const translate = await call(`/content/${projectId}/variants/${xVariant.id}/rewrite`, {
    method: 'POST',
    token,
    org: orgId,
    body: { action: 'TRANSLATE' },
  });
  ok('Traduction exécutée', translate.status === 200, describe(translate));
  const englishX = variantOf(translate.data, 'X', 'EN');
  ok('Une version EN est créée', Boolean(englishX), describe(translate));
  ok(
    'La version EN utilise les formulations anglaises',
    (englishX?.body ?? '').includes('Thoughts?'),
    englishX?.body,
  );
  ok('La version FR est conservée', Boolean(variantOf(translate.data, 'X', 'FR')));

  const sameLanguage = await call(`/content/${projectId}/variants/${englishX.id}/rewrite`, {
    method: 'POST',
    token,
    org: orgId,
    body: { action: 'TRANSLATE', language: 'EN' },
  });
  ok(
    'Traduire vers la langue déjà utilisée est refusé (400)',
    sameLanguage.status === 400,
    describe(sameLanguage),
  );

  // --- Isolation et RBAC ---
  const other = await register(
    `phase5-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const crossTenant = await call(`/content/${projectId}`, {
    token: other.token,
    org: otherOrgs.data?.[0]?.id,
  });
  ok('Contenu invisible depuis une autre organisation (404)', crossTenant.status === 404);

  const viewerEmail = `phase5-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerRead = await call(`/content/${projectId}`, { token: viewer.token, org: orgId });
  ok('Un VIEWER lit les contenus', viewerRead.status === 200, describe(viewerRead));

  const viewerGenerate = await call('/ai/content/generate', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { brief: BRIEF, platforms: ['X'] },
  });
  ok(
    'Un VIEWER ne peut pas générer (403)',
    viewerGenerate.status === 403,
    describe(viewerGenerate),
  );

  const viewerRewrite = await call(`/content/${projectId}/variants/${xVariant.id}/rewrite`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { action: 'FIX' },
  });
  ok(
    'Un VIEWER ne peut pas utiliser l’assistant (403)',
    viewerRewrite.status === 403,
    describe(viewerRewrite),
  );

  // --- Tableau de bord et suppression ---
  const dashboard = await call('/dashboard', { token, org: orgId });
  ok(
    'Tableau de bord : compteur de contenus',
    dashboard.status === 200 && dashboard.data?.contentProjects === 2,
    describe(dashboard),
  );

  const removed = await call(`/content/${projectId}`, { method: 'DELETE', token, org: orgId });
  ok('Contenu supprimé (204)', removed.status === 204, describe(removed));

  const afterDelete = await call(`/content/${projectId}`, { token, org: orgId });
  ok('Le contenu supprimé renvoie 404', afterDelete.status === 404, describe(afterDelete));

  console.log(`\n✅ Phase 5 : ${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n❌ Échec du test Phase 5 : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
