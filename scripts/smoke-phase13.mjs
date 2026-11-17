#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 13 (administration, crédits, rendu vidéo).
 *
 *   node --env-file=.env scripts/smoke-phase13.mjs                    # production
 *   API_URL=http://localhost:3000 node --env-file=.env scripts/smoke-phase13.mjs
 *
 * Trois exigences sont vérifiées en priorité :
 *
 * - **l'administration est réellement protégée** : sans élévation en base, les
 *   routes §17 et l'octroi de crédits refusent ; le test élève un compte jetable
 *   puis le rétrograde dans un `finally`, jamais un compte permanent ;
 * - **le registre de crédits ne rend rien deux fois** : `CONFIRM` puis `REFUND`
 *   sur la même réservation doit échouer, la clé est propre à chaque compte ;
 * - **le rendu n'invente pas de vidéo** : sans fichier local, l'API refuse avec
 *   un motif explicite. Un vrai rendu n'est tenté que si `SMOKE13_VIDEO_SOURCE`
 *   désigne un fichier visible par la machine qui exécute l'API.
 *
 * `DATABASE_URL` est requis : il sert uniquement à élever/rétrograder le compte
 * de test créé par ce script. Le nettoyage habituel supprime ce compte.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPrismaClient } from '../packages/database/dist/index.js';

const API_URL = (process.env.API_URL ?? 'https://ai-social-studio-api.onrender.com').replace(
  /\/$/,
  '',
);
const RUN_ID = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const PASSWORD = randomBytes(24).toString('base64url');
const TIMEOUT = Number(process.env.TIMEOUT ?? 45_000);
const VIDEO_SOURCE = process.env.SMOKE13_VIDEO_SOURCE;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL manquant — lancer avec `node --env-file=.env …`');
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

let checks = 0;
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
}

/** Les opérations POST de l'API répondent 201 par défaut, 200 quand c'est déclaré. */
function isSuccess(status) {
  return status === 200 || status === 201;
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

async function register(role) {
  const result = await call('/auth/register', {
    method: 'POST',
    body: {
      email: `phase13-${role}-${RUN_ID}@ai-social-studio.test`,
      password: PASSWORD,
      name: role,
      organizationName: `Phase 13 ${role} ${RUN_ID}`,
    },
  });
  ok(`Compte ${role} créé`, result.status === 201, describe(result));
  const orgs = await call('/organizations', { token: result.data.token });
  ok(`Organisation de ${role} disponible`, orgs.status === 200 && orgs.data?.length === 1);
  return {
    token: result.data.token,
    id: result.data.user.id,
    email: result.data.user.email,
    orgId: orgs.data[0].id,
  };
}

async function setSuperAdmin(email, value) {
  await prisma.user.update({ where: { email }, data: { isSuperAdmin: value } });
}

async function main() {
  console.log(`Phase 13 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  const admin = await register('admin');
  const other = await register('other');
  ok('Les deux organisations sont distinctes', admin.orgId !== other.orgId);
  let elevated = false;

  try {
    // --- La porte est fermée avant élévation ---
    const closedOverview = await call('/admin/overview', { token: admin.token });
    ok(
      'Un utilisateur ordinaire ne voit pas le tableau de bord (403)',
      closedOverview.status === 403,
      describe(closedOverview),
    );
    const closedPlans = await call('/admin/plans', { token: other.token });
    ok(
      'Un utilisateur ordinaire ne liste pas les offres (403)',
      closedPlans.status === 403,
      describe(closedPlans),
    );
    const closedGrant = await call('/credits/grant', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { amount: 10, idempotencyKey: `refuse-${RUN_ID}` },
    });
    ok(
      'Un non-admin ne peut pas octroyer de crédits (403)',
      closedGrant.status === 403,
      describe(closedGrant),
    );

    // --- Élévation d'un compte jetable, directement en base ---
    await setSuperAdmin(admin.email, true);
    elevated = true;
    const me = await call('/auth/me', { token: admin.token });
    ok(
      'Le jeton existant reflète l’élévation en base',
      me.data?.isSuperAdmin === true,
      describe(me),
    );

    // --- Administration (§17) ---
    const overview = await call('/admin/overview', { token: admin.token });
    ok('Le tableau de bord administration répond 200', overview.status === 200, describe(overview));
    for (const key of ['users', 'organizations', 'disabledUsers', 'superAdmins', 'plans']) {
      ok(
        `Le compteur ${key} est un entier`,
        Number.isInteger(overview.data?.[key]),
        String(overview.data?.[key]),
      );
    }
    ok(
      'Au moins un administrateur plateforme est actif',
      overview.data?.superAdmins >= 1,
      String(overview.data?.superAdmins),
    );

    const plans = await call('/admin/plans', { token: admin.token });
    ok(
      'Les offres actives sont listées',
      plans.status === 200 && plans.data?.length >= 2,
      describe(plans),
    );
    ok(
      'Chaque offre expose son quota',
      plans.data?.every((plan) => 'monthlyCredits' in plan),
    );
    const initialOtherAccount = await call('/credits/account', {
      token: other.token,
      org: other.orgId,
    });
    const targetPlan = plans.data.find(
      (plan) => plan.key !== initialOtherAccount.data?.planKey && plan.monthlyCredits !== null,
    );
    ok(
      'Une autre offre à quota est disponible',
      Boolean(targetPlan),
      JSON.stringify(plans.data?.map((plan) => plan.key)),
    );

    const users = await call('/admin/users', { token: admin.token });
    ok(
      'Les utilisateurs sont listés',
      users.status === 200 && Array.isArray(users.data),
      describe(users),
    );
    ok(
      'Le super-admin test apparaît comme tel',
      users.data?.some((user) => user.email === admin.email && user.isSuperAdmin === true),
    );

    const organizations = await call('/admin/organizations', { token: admin.token });
    ok(
      'Les organisations sont listées',
      organizations.status === 200 && Array.isArray(organizations.data),
      describe(organizations),
    );
    ok(
      'L’organisation test figure dans la liste',
      organizations.data?.some((org) => org.id === admin.orgId),
    );

    const badUpdate = await call(`/admin/users/${admin.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: {},
    });
    ok('Une mise à jour vide est refusée (400)', badUpdate.status === 400, describe(badUpdate));

    const viewerEmail = `phase13-viewer-${RUN_ID}@ai-social-studio.test`;
    const invitation = await call(`/organizations/${admin.orgId}/invitations`, {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { email: viewerEmail, role: 'VIEWER' },
    });
    ok('Invitation VIEWER créée', invitation.status === 201, describe(invitation));
    const viewerRegister = await call('/auth/register', {
      method: 'POST',
      body: {
        email: viewerEmail,
        password: PASSWORD,
        name: 'Lecteur',
        organizationName: `Lecteur ${RUN_ID}`,
      },
    });
    ok('Compte VIEWER créé', viewerRegister.status === 201, describe(viewerRegister));
    const accepted = await call('/invitations/accept', {
      method: 'POST',
      token: viewerRegister.data.token,
      body: { token: invitation.data.token },
    });
    ok('Invitation acceptée', accepted.status === 200, describe(accepted));
    const viewer = {
      token: viewerRegister.data.token,
      id: viewerRegister.data.user.id,
      email: viewerRegister.data.user.email,
    };

    const disabled = await call(`/admin/users/${viewer.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { disabled: true },
    });
    ok(
      'Un super-admin peut désactiver un compte',
      disabled.status === 200 && disabled.data?.disabled === true,
      describe(disabled),
    );
    const viewerOff = await call('/auth/me', { token: viewer.token });
    ok(
      'Le compte désactivé ne peut plus s’authentifier (401)',
      viewerOff.status === 401,
      describe(viewerOff),
    );
    const enabled = await call(`/admin/users/${viewer.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { disabled: false },
    });
    ok(
      'Le compte peut être réactivé',
      enabled.status === 200 && enabled.data?.disabled === false,
      describe(enabled),
    );
    const viewerOn = await call('/auth/me', { token: viewer.token });
    ok(
      'La session redevient valide après réactivation',
      viewerOn.status === 200,
      describe(viewerOn),
    );

    const changed = await call(`/admin/organizations/${other.orgId}/plan`, {
      method: 'PATCH',
      token: admin.token,
      body: { planKey: targetPlan.key },
    });
    ok(
      'Le plan d’une organisation peut être changé',
      changed.status === 200 && changed.data?.planKey === targetPlan.key,
      describe(changed),
    );
    const otherAfterPlan = await call('/credits/account', { token: other.token, org: other.orgId });
    ok(
      'Le compte de crédits suit le nouveau plan',
      otherAfterPlan.data?.planKey === targetPlan.key,
      describe(otherAfterPlan),
    );
    ok(
      'Le quota du nouveau plan est exposé',
      otherAfterPlan.data?.monthlyLimit === targetPlan.monthlyCredits,
      String(otherAfterPlan.data?.monthlyLimit),
    );

    const badPlan = await call(`/admin/organizations/${other.orgId}/plan`, {
      method: 'PATCH',
      token: admin.token,
      body: { planKey: `inexistant-${RUN_ID}` },
    });
    ok('Un plan inconnu est refusé (404)', badPlan.status === 404, describe(badPlan));

    const audit = await call('/admin/audit?limit=100', { token: admin.token });
    ok(
      'Le journal administration répond 200',
      audit.status === 200 && Array.isArray(audit.data),
      describe(audit),
    );
    const actions = (audit.data ?? []).map((entry) => entry.action);
    ok(
      'Le changement de plan est journalisé',
      actions.includes('admin.organization.plan_changed'),
      JSON.stringify(actions.slice(0, 8)),
    );
    ok('La désactivation est journalisée', actions.includes('admin.user.updated'));
    ok(
      'L’auteur des actions est nommé',
      (audit.data ?? []).some(
        (entry) => entry.action.startsWith('admin.') && entry.actorEmail === admin.email,
      ),
    );
    const oneAudit = await call('/admin/audit?limit=1', { token: admin.token });
    ok(
      'La fenêtre du journal est respectée',
      oneAudit.data?.length === 1,
      String(oneAudit.data?.length),
    );
    const tooMany = await call('/admin/audit?limit=200', { token: admin.token });
    ok('Une fenêtre excessive est refusée (400)', tooMany.status === 400, describe(tooMany));

    // --- Registre de crédits (§16.2) ---
    const before = await call('/credits/account', { token: admin.token, org: admin.orgId });
    ok('Le compte de crédits est lisible', before.status === 200, describe(before));
    ok(
      'Le solde initial est entier',
      Number.isInteger(before.data?.balance),
      String(before.data?.balance),
    );

    const grantKey = `grant-a-${RUN_ID}`;
    const grant = await call('/credits/grant', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { amount: 25, idempotencyKey: grantKey, label: 'Octroi Phase 13' },
    });
    ok(
      'Un super-admin octroie des crédits à sa propre organisation',
      isSuccess(grant.status) && grant.data?.transaction?.type === 'GRANT',
      describe(grant),
    );
    ok(
      'Le solde augmente du montant octroyé',
      grant.data?.account?.balance === before.data.balance + 25,
      String(grant.data?.account?.balance),
    );
    ok('L’octroi n’est pas marqué comme rejoué', grant.data?.replayed === false);

    const replayGrant = await call('/credits/grant', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { amount: 25, idempotencyKey: grantKey },
    });
    ok('Un octroi rejoué est reconnu', replayGrant.data?.replayed === true, describe(replayGrant));
    ok(
      'Le rejeu ne crédite pas deux fois',
      replayGrant.data?.account?.balance === grant.data.account.balance,
      String(replayGrant.data?.account?.balance),
    );

    const foreignGrant = await call('/credits/grant', {
      method: 'POST',
      token: other.token,
      org: other.orgId,
      body: { amount: 5, idempotencyKey: `foreign-${RUN_ID}` },
    });
    ok(
      'Un propriétaire ordinaire ne peut pas s’octroyer de crédits (403)',
      foreignGrant.status === 403,
      describe(foreignGrant),
    );

    const reserveKey = `reserve-a-${RUN_ID}`;
    const reserved = await call('/credits/reserve', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { amount: 10, idempotencyKey: reserveKey, label: 'Rendu Phase 13' },
    });
    ok(
      'Une réservation est acceptée',
      isSuccess(reserved.status) && reserved.data?.transaction?.type === 'RESERVE',
      describe(reserved),
    );
    const afterReserve = reserved.data.account;
    ok(
      'La réservation débite le disponible',
      afterReserve.balance === grant.data.account.balance - 10,
      String(afterReserve.balance),
    );
    ok(
      'La réservation augmente le réservé',
      afterReserve.reserved === before.data.reserved + 10,
      String(afterReserve.reserved),
    );

    const confirmed = await call('/credits/confirm', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { idempotencyKey: reserveKey },
    });
    ok(
      'La réservation peut être confirmée',
      isSuccess(confirmed.status) && confirmed.data?.transaction?.type === 'CONFIRM',
      describe(confirmed),
    );
    ok(
      'Confirmer ne rend pas de crédits',
      confirmed.data?.account?.balance === afterReserve.balance,
      String(confirmed.data?.account?.balance),
    );
    ok(
      'Confirmer consomme le réservé',
      confirmed.data?.account?.reserved === afterReserve.reserved - 10,
      String(confirmed.data?.account?.reserved),
    );

    // Le bug historique : ce remboursement restituait des crédits déjà consommés.
    const badRefund = await call('/credits/refund', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { idempotencyKey: reserveKey },
    });
    ok(
      'Rembourser une réservation confirmée est refusé (400)',
      badRefund.status === 400,
      describe(badRefund),
    );
    ok(
      'Le refus est motivé',
      String(badRefund.data?.message ?? '').includes('déjà réglée'),
      describe(badRefund),
    );
    const afterBadRefund = await call('/credits/account', { token: admin.token, org: admin.orgId });
    ok(
      'Aucun crédit n’est restitué après le refus',
      afterBadRefund.data?.balance === confirmed.data.account.balance &&
        afterBadRefund.data?.reserved === confirmed.data.account.reserved,
      describe(afterBadRefund),
    );

    const replayConfirm = await call('/credits/confirm', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { idempotencyKey: reserveKey },
    });
    ok(
      'Une confirmation rejouée est reconnue',
      replayConfirm.data?.replayed === true &&
        replayConfirm.data?.account?.balance === confirmed.data.account.balance,
      describe(replayConfirm),
    );

    const refundKey = `reserve-b-${RUN_ID}`;
    await call('/credits/reserve', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { amount: 7, idempotencyKey: refundKey },
    });
    const refunded = await call('/credits/refund', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { idempotencyKey: refundKey },
    });
    ok(
      'Une réservation non consommée peut être remboursée',
      isSuccess(refunded.status) && refunded.data?.transaction?.type === 'REFUND',
      describe(refunded),
    );
    ok(
      'Le remboursement rend le crédit au disponible',
      refunded.data?.account?.balance === confirmed.data.account.balance,
      String(refunded.data?.account?.balance),
    );
    ok(
      'Le remboursement vide le réservé',
      refunded.data?.account?.reserved === confirmed.data.account.reserved,
      String(refunded.data?.account?.reserved),
    );
    const lateConfirm = await call('/credits/confirm', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { idempotencyKey: refundKey },
    });
    ok(
      'Confirmer après remboursement est refusé',
      lateConfirm.status === 400,
      describe(lateConfirm),
    );

    // Même clé, deux comptes : aucune écriture partagée.
    const sharedKey = `shared-${RUN_ID}`;
    const otherReserve = await call('/credits/reserve', {
      method: 'POST',
      token: other.token,
      org: other.orgId,
      body: { amount: 3, idempotencyKey: sharedKey },
    });
    ok(
      'Une clé déjà utilisée ailleurs est acceptée dans un autre compte',
      isSuccess(otherReserve.status) && otherReserve.data?.replayed === false,
      describe(otherReserve),
    );
    const stolenSettle = await call('/credits/confirm', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { idempotencyKey: sharedKey },
    });
    ok(
      'Régler la réservation d’autrui renvoie 404',
      stolenSettle.status === 404,
      describe(stolenSettle),
    );

    const viewerReserve = await call('/credits/reserve', {
      method: 'POST',
      token: viewer.token,
      org: admin.orgId,
      body: { amount: 1, idempotencyKey: `viewer-${RUN_ID}` },
    });
    ok(
      'Un lecteur ne peut pas réserver (403)',
      viewerReserve.status === 403,
      describe(viewerReserve),
    );

    const overLimit = await call('/credits/reserve', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { amount: 1000, idempotencyKey: `limit-${RUN_ID}` },
    });
    ok('Un dépassement de quota est refusé', overLimit.status === 400, describe(overLimit));
    ok(
      'Le refus nomme une raison connue',
      ['INSUFFICIENT_CREDITS', 'MONTHLY_LIMIT_REACHED'].includes(String(overLimit.data?.message)),
      describe(overLimit),
    );

    const ledger = await call('/credits/ledger', { token: admin.token, org: admin.orgId });
    ok(
      'Le registre est lisible',
      ledger.status === 200 && Array.isArray(ledger.data?.transactions),
      describe(ledger),
    );
    const types = (ledger.data?.transactions ?? []).map((entry) => entry.type);
    for (const type of ['GRANT', 'RESERVE', 'CONFIRM', 'REFUND']) {
      ok(`Le registre contient un ${type}`, types.includes(type), JSON.stringify(types));
    }

    // --- Rendu vidéo local (§22) ---
    const project = await call('/video-projects', {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { name: `Phase 13 ${RUN_ID}`, sourceUrl: 'https://exemple.test/source.mp4' },
    });
    ok('Un projet vidéo est créé', project.status === 201, describe(project));
    const projectId = project.data?.id;

    const renderBody = { clips: [{ start: 0, end: 2 }], format: 'SQUARE' };
    const noSource = await call(`/video-projects/${projectId}/render`, {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: renderBody,
    });
    ok(
      'Une URL distante sans fichier local est refusée (400)',
      noSource.status === 400,
      describe(noSource),
    );
    ok(
      'Le refus dit qu’aucun fichier local n’est fourni',
      String(noSource.data?.message ?? '').includes('Aucun fichier source local'),
      describe(noSource),
    );

    const missingSource = await call(`/video-projects/${projectId}/render`, {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { ...renderBody, sourcePath: `/introuvable/phase13-${RUN_ID}.mp4` },
    });
    ok(
      'Un fichier source absent est refusé (400)',
      missingSource.status === 400,
      describe(missingSource),
    );
    ok(
      'Le refus ne prétend pas qu’un rendu a eu lieu',
      String(missingSource.data?.message ?? '').includes('Fichier source introuvable'),
      describe(missingSource),
    );

    const badClip = await call(`/video-projects/${projectId}/render`, {
      method: 'POST',
      token: admin.token,
      org: admin.orgId,
      body: { ...renderBody, clips: [{ start: 2, end: 1 }] },
    });
    ok(
      'Un clip inversé est refusé avant tout rendu (400)',
      badClip.status === 400,
      describe(badClip),
    );

    const viewerRender = await call(`/video-projects/${projectId}/render`, {
      method: 'POST',
      token: viewer.token,
      org: admin.orgId,
      body: renderBody,
    });
    ok(
      'Un lecteur ne peut pas lancer de rendu (403)',
      viewerRender.status === 403,
      describe(viewerRender),
    );
    const foreignRender = await call(`/video-projects/${projectId}/render`, {
      method: 'POST',
      token: other.token,
      org: other.orgId,
      body: renderBody,
    });
    ok(
      'Le projet d’une autre organisation est invisible (404)',
      foreignRender.status === 404,
      describe(foreignRender),
    );

    if (VIDEO_SOURCE) {
      const realRender = await call(`/video-projects/${projectId}/render`, {
        method: 'POST',
        token: admin.token,
        org: admin.orgId,
        body: { ...renderBody, sourcePath: VIDEO_SOURCE },
      });
      ok(
        'Un vrai rendu ffmpeg aboutit quand un fichier local est fourni',
        isSuccess(realRender.status),
        describe(realRender),
      );
      ok(
        'Le rendu est annoncé comme local',
        realRender.data?.worker === 'local-ffmpeg',
        String(realRender.data?.worker),
      );
      ok(
        'Le chemin de sortie est renvoyé',
        typeof realRender.data?.outputPath === 'string' && realRender.data.outputPath.length > 0,
        String(realRender.data?.outputPath),
      );
    } else {
      console.log(
        '  · Rendu ffmpeg réel non tenté : définir SMOKE13_VIDEO_SOURCE avec un fichier visible par l’API.',
      );
    }

    const detail = await call(`/video-projects/${projectId}`, {
      token: admin.token,
      org: admin.orgId,
    });
    ok(
      'Le projet reste intact après les refus',
      detail.status === 200 && detail.data?.id === projectId,
      describe(detail),
    );

    console.log(`\nPhase 13 : ${checks} vérifications E2E réussies.`);
  } finally {
    // Le compte élevé est jetable : ne jamais laisser un super-admin de test.
    if (elevated) await setSuperAdmin(admin.email, false).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
