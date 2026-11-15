#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 10 (analytics).
 *
 *   node scripts/smoke-phase10.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase10.mjs
 *
 * Couvre la règle centrale du §13 : **aucune métrique n'est inventée**. Le
 * parcours vérifie, sur une organisation réelle et une publication réellement
 * passée en `PUBLISHED`, que :
 *
 * - une métrique absente reste `null` et n'est jamais rendue comme `0` ;
 * - un `0` saisi est bien compté comme une mesure à zéro ;
 * - un taux d'engagement n'apparaît que si ses quatre composantes et un
 *   dénominateur d'audience existent, et `basedOn` dit sur combien de mesures ;
 * - une mesure incomplète est écartée du taux au lieu de le fausser ;
 * - une seule mesure par cible est retenue (les compteurs sont cumulatifs) ;
 * - l'export CSV laisse une cellule vide plutôt qu'un zéro trompeur ;
 * - la collecte auprès des plateformes annonce 0 mesure récupérée **et son
 *   motif**, au lieu de fabriquer des chiffres.
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
  return { status: response.status, data, headers: response.headers };
}

function describe(result) {
  const message = result.data?.message ?? result.data ?? '';
  return `${result.status} ${Array.isArray(message) ? message.join(', ') : message}`.trim();
}

/**
 * Réponse brute, en octets.
 *
 * `Response.text()` applique le décodage UTF-8 **avec suppression du BOM** :
 * impossible de vérifier le BOM par ce chemin. On lit donc les octets, puis on
 * décode en conservant le BOM (`ignoreBOM: true`) pour les assertions de texte.
 */
async function callBytes(path, { token, org } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers['X-Organization-Id'] = org;
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return { status: response.status, headers: response.headers, bytes, text };
}

async function register(email, name, organizationName) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, name, organizationName },
  });
  ok(`Création du compte ${name}`, result.status === 201, describe(result));
  return result.data;
}

/** Amène une publication à l'état `PUBLISHED` par le circuit réel (§9). */
async function publishPublication(token, orgId, accounts) {
  const created = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Bilan de campagne',
      postType: 'TEXT',
      mode: 'AUTO',
      targets: [
        { socialAccountId: accounts.LINKEDIN, body: 'Bilan de campagne LinkedIn.' },
        { socialAccountId: accounts.X, body: 'Bilan de campagne X.' },
      ],
    },
  });
  ok('Publication de mesure créée', created.status === 201, describe(created));
  const publicationId = created.data?.id;

  const submitted = await call(`/publications/${publicationId}/submit`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Publication soumise (auto-validée)', submitted.status === 200, describe(submitted));

  const published = await call(`/publications/${publicationId}/publish`, {
    method: 'POST',
    token,
    org: orgId,
  });
  ok('Publication tentée par la passerelle', published.status === 200, describe(published));

  const targets = published.data?.targets ?? [];
  const confirmed = await call(`/publications/${publicationId}/confirm`, {
    method: 'POST',
    token,
    org: orgId,
    body: {
      targets: targets.map((target, index) => ({
        targetId: target.id,
        url: `https://social.example/analytics/${index + 1}`,
      })),
    },
  });
  ok('Publication confirmée manuellement', confirmed.status === 200, describe(confirmed));
  ok(
    'La publication passe en PUBLISHED',
    confirmed.data?.status === 'PUBLISHED',
    confirmed.data?.status,
  );

  const linkedin = targets.find((target) => target.platform === 'LINKEDIN');
  const x = targets.find((target) => target.platform === 'X');
  ok('Les deux cibles sont identifiables', Boolean(linkedin?.id) && Boolean(x?.id));

  return { publicationId, linkedinTargetId: linkedin?.id, xTargetId: x?.id };
}

async function main() {
  console.log(`Phase 10 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const owner = await register(
    `phase10-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Analytics ${RUN_ID}`,
  );
  const token = owner.token;
  const orgs = await call('/organizations', { token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  // --- Une organisation sans mesure ---
  const empty = await call('/analytics/overview', { token, org: orgId });
  ok('La vue d’ensemble répond 200 même sans donnée', empty.status === 200, describe(empty));
  ok(
    'Aucune publication comptée',
    empty.data?.publications === 0,
    String(empty.data?.publications),
  );
  ok('Aucune publication mesurée', empty.data?.measured === 0, String(empty.data?.measured));
  ok(
    'Aucun réseau comparé',
    Array.isArray(empty.data?.networks) && empty.data.networks.length === 0,
    String(empty.data?.networks?.length),
  );
  ok(
    'Les totaux restent nuls, pas zéro',
    empty.data?.totals?.views?.value === null && empty.data?.totals?.views?.contributors === 0,
    JSON.stringify(empty.data?.totals?.views),
  );
  ok(
    'Le taux d’engagement est refusé, pas estimé',
    empty.data?.engagement?.value === null && Boolean(empty.data?.engagement?.reason),
    JSON.stringify(empty.data?.engagement),
  );
  ok('Aucune mesure n’a servi au taux', empty.data?.engagement?.basedOn === 0);
  ok(
    'La vue d’ensemble dit qu’aucune métrique n’existe',
    (empty.data?.notes ?? []).some((note) => /Aucune métrique/.test(note)),
    JSON.stringify(empty.data?.notes),
  );
  ok(
    'L’audience est déclarée indisponible avec son motif',
    empty.data?.audience?.available === false && (empty.data?.audience?.reason ?? '').length > 20,
    empty.data?.audience?.reason,
  );
  ok(
    'La provenance est vide tant qu’aucune mesure n’existe',
    Array.isArray(empty.data?.sources) && empty.data.sources.length === 0,
    JSON.stringify(empty.data?.sources),
  );

  const emptyCsv = await callBytes('/analytics/export.csv', { token, org: orgId });
  ok(
    'L’export CSV répond 200 sur une organisation vide',
    emptyCsv.status === 200,
    String(emptyCsv.status),
  );
  ok(
    'Le CSV annonce son type et son nom de fichier',
    String(emptyCsv.headers.get('content-type') ?? '').includes('text/csv') &&
      String(emptyCsv.headers.get('content-disposition') ?? '').includes('analytics-'),
    String(emptyCsv.headers.get('content-disposition')),
  );
  ok(
    'Le CSV porte le BOM UTF-8 attendu par Excel',
    emptyCsv.bytes[0] === 0xef && emptyCsv.bytes[1] === 0xbb && emptyCsv.bytes[2] === 0xbf,
    `octets ${[...emptyCsv.bytes.slice(0, 3)].join(' ')}`,
  );
  ok(
    'Le CSV vide ne contient que son en-tête',
    emptyCsv.text.trimEnd().split('\r\n').length === 1,
    String(emptyCsv.text.trimEnd().split('\r\n').length),
  );

  const emptyTop = await call('/analytics/top', { token, org: orgId });
  ok('Le classement répond 200 sans donnée', emptyTop.status === 200, describe(emptyTop));
  ok(
    'Le classement est vide, pas fabriqué',
    Array.isArray(emptyTop.data?.items) && emptyTop.data.items.length === 0,
    String(emptyTop.data?.items?.length),
  );

  // --- Comptes sociaux et publication réellement publiée ---
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

  const { publicationId, linkedinTargetId, xTargetId } = await publishPublication(
    token,
    orgId,
    accounts,
  );

  // --- Mesurer une cible non publiée est refusé ---
  const draft = await call('/publications', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      title: 'Brouillon non mesurable',
      postType: 'TEXT',
      mode: 'AUTO',
      targets: [{ socialAccountId: accounts.LINKEDIN, body: 'Encore en brouillon.' }],
    },
  });
  ok('Brouillon créé', draft.status === 201, describe(draft));
  const draftTargetId = draft.data?.targets?.[0]?.id;
  const draftRecord = await call('/analytics/measurements', {
    method: 'POST',
    token,
    org: orgId,
    body: { publicationId: draft.data?.id, targetId: draftTargetId, views: 10 },
  });
  ok(
    'Mesurer une publication non publiée est refusé (400)',
    draftRecord.status === 400,
    describe(draftRecord),
  );
  ok(
    'Le refus dit qu’il faut confirmer la publication',
    /confirmez/i.test(String(draftRecord.data?.message ?? '')),
    describe(draftRecord),
  );

  // --- Première mesure complète ---
  const first = await call('/analytics/measurements', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      publicationId,
      targetId: linkedinTargetId,
      views: 1200,
      impressions: 1000,
      reach: 800,
      likes: 40,
      comments: 5,
      shares: 3,
      saves: 2,
      clicks: 60,
      note: 'premier relevé',
    },
  });
  ok('Mesure complète enregistrée', first.status === 201, describe(first));
  ok(
    'La mesure est marquée comme saisie manuelle',
    first.data?.source === 'MANUAL',
    first.data?.source,
  );
  ok('La mesure porte sa date de relevé', Boolean(first.data?.collectedAt));
  ok('La mesure porte sa date d’enregistrement', Boolean(first.data?.syncedAt));
  ok('La note est conservée', first.data?.note === 'premier relevé', first.data?.note);

  const single = await call('/analytics/overview', { token, org: orgId });
  ok(
    'La publication publiée est comptée',
    single.data?.publications === 1,
    String(single.data?.publications),
  );
  ok('La publication est comptée comme mesurée', single.data?.measured === 1);
  ok(
    'Un réseau est comparé',
    single.data?.networks?.length === 1 && single.data.networks[0].platform === 'LINKEDIN',
    JSON.stringify(single.data?.networks?.map((row) => row.platform)),
  );
  ok(
    'Les vues sont additionnées avec leur contributeur',
    single.data?.totals?.views?.value === 1200 && single.data?.totals?.views?.contributors === 1,
    JSON.stringify(single.data?.totals?.views),
  );
  ok(
    'Le taux d’engagement vaut 50/1000 = 5 %',
    Math.abs((single.data?.engagement?.value ?? 0) - 0.05) < 1e-9,
    String(single.data?.engagement?.value),
  );
  ok(
    'Le dénominateur utilisé est nommé',
    single.data?.engagement?.basis === 'impressions',
    single.data?.engagement?.basis,
  );
  ok('Le taux dit sur combien de mesures il porte', single.data?.engagement?.basedOn === 1);
  ok(
    'La provenance de la mesure est affichée',
    single.data?.sources?.some((entry) => entry.source === 'MANUAL' && entry.measurements === 1),
    JSON.stringify(single.data?.sources),
  );
  ok(
    'Une mesure complète n’entraîne aucun avertissement de total partiel',
    !(single.data?.notes ?? []).some((note) => /Totaux partiels/.test(note)),
    JSON.stringify(single.data?.notes),
  );

  // --- Zéro mesuré n'est pas une absence ---
  const second = await call('/analytics/measurements', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      publicationId,
      targetId: xTargetId,
      views: 300,
      impressions: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
    },
  });
  ok('Seconde mesure (zéro assumé) enregistrée', second.status === 201, describe(second));
  ok('Un zéro saisi reste un zéro', second.data?.likes === 0, JSON.stringify(second.data?.likes));
  ok(
    'Une métrique non saisie reste nulle',
    second.data?.clicks === null,
    JSON.stringify(second.data?.clicks),
  );

  const zeros = await call('/analytics/overview', { token, org: orgId });
  ok(
    'Deux réseaux sont désormais comparés',
    zeros.data?.networks?.length === 2,
    JSON.stringify(zeros.data?.networks?.map((row) => row.platform)),
  );
  ok(
    'Les vues cumulées valent 1500',
    zeros.data?.totals?.views?.value === 1500 && zeros.data?.totals?.views?.contributors === 2,
    JSON.stringify(zeros.data?.totals?.views),
  );
  ok(
    'Les likes additionnent 40 et 0 en comptant deux mesures',
    zeros.data?.totals?.likes?.value === 40 && zeros.data?.totals?.likes?.contributors === 2,
    JSON.stringify(zeros.data?.totals?.likes),
  );
  ok(
    'Une métrique fournie par une seule mesure reste partielle',
    zeros.data?.totals?.clicks?.value === 60 && zeros.data?.totals?.clicks?.contributors === 1,
    JSON.stringify(zeros.data?.totals?.clicks),
  );
  ok(
    'Les totaux partiels sont signalés',
    (zeros.data?.notes ?? []).some((note) => /Totaux partiels/.test(note)),
    JSON.stringify(zeros.data?.notes),
  );
  ok(
    'La portée est signalée comme non dédupliquée',
    (zeros.data?.notes ?? []).some((note) => /déduplication/.test(note)),
    JSON.stringify(zeros.data?.notes),
  );
  ok(
    'Un dénominateur nul n’annule pas le taux des autres mesures',
    Math.abs((zeros.data?.engagement?.value ?? 0) - 0.05) < 1e-9,
    String(zeros.data?.engagement?.value),
  );
  ok(
    'Le taux reste calculé sur une seule mesure complète',
    zeros.data?.engagement?.basedOn === 1,
    String(zeros.data?.engagement?.basedOn),
  );

  const xNetwork = zeros.data?.networks?.find((row) => row.platform === 'X');
  ok(
    'Le réseau sans dénominateur affiche un taux refusé',
    xNetwork?.engagement?.value === null && Boolean(xNetwork.engagement.reason),
    JSON.stringify(xNetwork?.engagement),
  );
  ok(
    'Le refus explique qu’aucune mesure n’est complète',
    /Aucune mesure complète/.test(String(xNetwork?.engagement?.reason ?? '')),
    xNetwork?.engagement?.reason,
  );
  ok(
    'Le réseau est malgré tout compté avec ses métriques',
    xNetwork?.metrics?.views?.value === 300,
    JSON.stringify(xNetwork?.metrics?.views),
  );

  // --- Classement : métrique explicite, jamais devinée ---
  const topEngagement = await call('/analytics/top?rankedBy=ENGAGEMENT', { token, org: orgId });
  ok(
    'Le classement par engagement répond 200',
    topEngagement.status === 200,
    describe(topEngagement),
  );
  ok(
    'Seul le contenu mesurable est classé',
    topEngagement.data?.items?.length === 1 && topEngagement.data?.total === 1,
    JSON.stringify({ items: topEngagement.data?.items?.length, total: topEngagement.data?.total }),
  );
  ok(
    'Le contenu écarté est annoncé avec son motif',
    (topEngagement.data?.notes ?? []).some((note) => /écartées/.test(note)),
    JSON.stringify(topEngagement.data?.notes),
  );
  ok(
    'La métrique de classement est nommée dans la réponse',
    topEngagement.data?.rankedBy === 'ENGAGEMENT',
    topEngagement.data?.rankedBy,
  );

  const topViews = await call('/analytics/top?rankedBy=VIEWS', { token, org: orgId });
  ok(
    'Classer par vues retient les deux contenus',
    topViews.data?.items?.length === 2,
    String(topViews.data?.items?.length),
  );
  ok(
    'Le classement par vues est décroissant',
    (topViews.data?.items?.[0]?.metrics?.views?.value ?? 0) === 1200 &&
      (topViews.data?.items?.[1]?.metrics?.views?.value ?? 0) === 300,
    JSON.stringify(topViews.data?.items?.map((item) => item.metrics.views.value)),
  );

  const badRanking = await call('/analytics/top?rankedBy=POUCE', { token, org: orgId });
  ok(
    'Une métrique de classement inconnue est refusée (400)',
    badRanking.status === 400,
    describe(badRanking),
  );

  // --- Export CSV ---
  const csv = await callBytes('/analytics/export.csv', { token, org: orgId });
  const text = csv.text;
  ok('L’export CSV répond 200', csv.status === 200, String(csv.status));
  ok(
    'L’en-tête nomme les métriques en français',
    text.includes(
      'Source;Vues;Impressions;Portée;Likes;Commentaires;Partages;Enregistrements;Clics',
    ),
    text.slice(0, 200),
  );
  ok(
    'La ligne complète est exportée telle quelle',
    text.includes('Saisie manuelle;1200;1000;800;40;5;3;2;60'),
    text.slice(0, 400),
  );
  ok(
    'Une métrique absente laisse une cellule vide, jamais un zéro',
    text.includes('Saisie manuelle;300;0;0;0;0;0;0;;'),
    text.slice(0, 400),
  );
  ok(
    'Le CSV contient une ligne par mesure',
    text.trimEnd().split('\r\n').length === 3,
    String(text.trimEnd().split('\r\n').length),
  );

  // --- Une seule mesure par cible ---
  const newer = await call('/analytics/measurements', {
    method: 'POST',
    token,
    org: orgId,
    body: {
      publicationId,
      targetId: linkedinTargetId,
      views: 5000,
      impressions: 2000,
      reach: 1500,
      likes: 100,
      comments: 10,
      shares: 5,
      saves: 5,
    },
  });
  ok('Un second relevé sur la même cible est accepté', newer.status === 201, describe(newer));

  const latest = await call('/analytics/overview', { token, org: orgId });
  ok(
    'Seul le relevé le plus récent est retenu (5000 vues, pas 6200)',
    latest.data?.totals?.views?.value === 5300,
    String(latest.data?.totals?.views?.value),
  );
  ok(
    'L’ancien relevé n’est plus additionné',
    latest.data?.totals?.views?.contributors === 2,
    String(latest.data?.totals?.views?.contributors),
  );
  ok(
    'Le taux suit le relevé le plus récent (120/2000 = 6 %)',
    Math.abs((latest.data?.engagement?.value ?? 0) - 0.06) < 1e-9,
    String(latest.data?.engagement?.value),
  );
  ok(
    'La déduplication des relevés est expliquée',
    (latest.data?.notes ?? []).some((note) => /plus récente/.test(note)),
    JSON.stringify(latest.data?.notes),
  );

  // --- Historique ---
  const history = await call(
    `/analytics/measurements?publicationId=${publicationId}&targetId=${linkedinTargetId}`,
    {
      token,
      org: orgId,
    },
  );
  ok('L’historique répond 200', history.status === 200, describe(history));
  ok(
    'L’historique conserve les deux relevés, du plus ancien au plus récent',
    history.data?.length === 2 && history.data[1]?.views === 5000,
    JSON.stringify(history.data?.map((row) => row.views)),
  );

  const historyNoParams = await call('/analytics/measurements', { token, org: orgId });
  ok(
    'L’historique sans cible est refusé (400)',
    historyNoParams.status === 400,
    describe(historyNoParams),
  );

  // --- Période ---
  const inverted = await call(
    '/analytics/overview?from=2026-06-01T00:00:00.000Z&to=2026-05-01T00:00:00.000Z',
    { token, org: orgId },
  );
  ok('Une période inversée est refusée (400)', inverted.status === 400, describe(inverted));

  const tooLong = await call(
    '/analytics/overview?from=2024-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
    { token, org: orgId },
  );
  ok('Une période de plus d’un an est refusée (400)', tooLong.status === 400, describe(tooLong));

  const oldWindow = await call(
    '/analytics/overview?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z',
    { token, org: orgId },
  );
  ok(
    'Une période sans mesure renvoie des totaux nuls',
    oldWindow.status === 200 && oldWindow.data?.totals?.views?.value === null,
    JSON.stringify(oldWindow.data?.totals?.views),
  );

  // --- Collecte : l'absence de chiffres est annoncée, pas comblée ---
  const collect = await call('/analytics/collect', { method: 'POST', token, org: orgId });
  ok('La collecte répond 200', collect.status === 200, describe(collect));
  ok(
    'Les deux cibles publiées sont tentées',
    collect.data?.attempted === 2,
    String(collect.data?.attempted),
  );
  ok(
    'Aucune mesure n’est fabriquée',
    collect.data?.collected === 0,
    String(collect.data?.collected),
  );
  ok(
    'Chaque cible ignorée porte son motif',
    collect.data?.skipped?.length === 2 &&
      collect.data.skipped.every((entry) => (entry.reason ?? '').length > 20),
    JSON.stringify(collect.data?.skipped?.map((entry) => entry.reason)),
  );

  // --- RBAC ---
  const viewerEmail = `phase10-viewer-${RUN_ID}@ai-social-studio.test`;
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

  const viewerOverview = await call('/analytics/overview', { token: viewer.token, org: orgId });
  ok('Un VIEWER consulte les analytics', viewerOverview.status === 200, describe(viewerOverview));

  const viewerRecord = await call('/analytics/measurements', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { publicationId, targetId: linkedinTargetId, views: 1 },
  });
  ok(
    'Un VIEWER ne peut pas saisir de mesure (403)',
    viewerRecord.status === 403,
    describe(viewerRecord),
  );

  const viewerCollect = await call('/analytics/collect', {
    method: 'POST',
    token: viewer.token,
    org: orgId,
  });
  ok(
    'Un VIEWER ne peut pas lancer de collecte (403)',
    viewerCollect.status === 403,
    describe(viewerCollect),
  );

  // --- Isolation multi-tenant ---
  const other = await register(
    `phase10-other-${RUN_ID}@ai-social-studio.test`,
    'Autre',
    `Autre ${RUN_ID}`,
  );
  const otherOrgs = await call('/organizations', { token: other.token });
  const otherOrgId = otherOrgs.data?.[0]?.id;
  ok('Organisation tierce disponible', Boolean(otherOrgId) && otherOrgId !== orgId);

  const otherOverview = await call('/analytics/overview', { token: other.token, org: otherOrgId });
  ok(
    'L’autre organisation ne voit aucune mesure',
    otherOverview.status === 200 && otherOverview.data?.totals?.views?.value === null,
    JSON.stringify(otherOverview.data?.totals?.views),
  );

  const stolenRecord = await call('/analytics/measurements', {
    method: 'POST',
    token: other.token,
    org: otherOrgId,
    body: { publicationId, targetId: linkedinTargetId, views: 1 },
  });
  ok(
    'Mesurer la publication d’une autre organisation renvoie 404',
    stolenRecord.status === 404,
    describe(stolenRecord),
  );

  const stolenHistory = await call(
    `/analytics/measurements?publicationId=${publicationId}&targetId=${linkedinTargetId}`,
    { token: other.token, org: otherOrgId },
  );
  ok(
    'L’historique d’une autre organisation est vide, pas partagé',
    stolenHistory.status === 200 && stolenHistory.data?.length === 0,
    describe(stolenHistory),
  );

  const stolenCollect = await call('/analytics/collect', {
    method: 'POST',
    token: other.token,
    org: otherOrgId,
  });
  ok(
    'La collecte d’une autre organisation ne voit aucune cible',
    stolenCollect.status === 200 && stolenCollect.data?.attempted === 0,
    describe(stolenCollect),
  );

  console.log(`\n${checks} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
