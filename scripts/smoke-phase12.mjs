#!/usr/bin/env node
/**
 * Test de bout en bout de la Phase 12 (collaboration).
 *
 *   node scripts/smoke-phase12.mjs                          # production
 *   API_URL=http://localhost:3000 node scripts/smoke-phase12.mjs
 *
 * Couvre le §14 sur un vrai parcours d'agence : un éditeur prépare, un client
 * commente et valide, l'agence suit les tâches et l'historique.
 *
 * Trois exigences sont vérifiées en priorité :
 *
 * - **le client ne voit pas l'interne** : un commentaire `INTERNAL` n'est ni
 *   listé, ni compté, ni présent dans l'historique de son contenu ;
 * - **le client peut valider, l'éditeur ne le peut pas** : la validation passe
 *   par une liste de rôles explicite, pas par un rang hiérarchique ;
 * - **les compteurs du portefeuille ne comptent que le visible**.
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

/** Invite un compte dans l'organisation et accepte l'invitation. */
async function invite(ownerToken, orgId, role, email, name) {
  const created = await call(`/organizations/${orgId}/invitations`, {
    method: 'POST',
    token: ownerToken,
    org: orgId,
    body: { email, role },
  });
  ok(`Invitation ${role} créée`, created.status === 201, describe(created));
  const account = await register(email, name, `${name} ${RUN_ID}`);
  const accepted = await call('/invitations/accept', {
    method: 'POST',
    token: account.token,
    body: { token: created.data.token },
  });
  ok(`Invitation ${role} acceptée`, accepted.status === 200, describe(accepted));
  return account;
}

/** Prépare un contenu avec deux cibles, prêt à demander une validation. */
async function makePublication(editorToken, orgId, accounts, title) {
  const publication = await call('/publications', {
    method: 'POST',
    token: editorToken,
    org: orgId,
    body: {
      title,
      postType: 'TEXT',
      mode: 'APPROVAL',
      targets: [
        { socialAccountId: accounts.LINKEDIN, body: 'Texte LinkedIn.' },
        { socialAccountId: accounts.X, body: 'Texte X.' },
      ],
    },
  });
  ok(`Contenu « ${title} » créé`, publication.status === 201, describe(publication));
  const id = publication.data.id;
  await call(`/publications/${id}/submit`, { method: 'POST', token: editorToken, org: orgId });
  const requested = await call(`/publications/${id}/request-approval`, {
    method: 'POST',
    token: editorToken,
    org: orgId,
  });
  ok(`Validation demandée pour « ${title} »`, requested.status === 200, describe(requested));
  return id;
}

async function main() {
  console.log(`Phase 12 E2E → ${API_URL}\n`);

  const health = await call('/health');
  ok('API /health répond 200', health.status === 200, describe(health));

  // --- Quatre rôles dans une même agence ---
  const owner = await register(
    `phase12-owner-${RUN_ID}@ai-social-studio.test`,
    'Propriétaire',
    `Collaboration ${RUN_ID}`,
  );
  const orgs = await call('/organizations', { token: owner.token });
  const orgId = orgs.data?.[0]?.id;
  ok('Organisation du propriétaire disponible', Boolean(orgId));

  const editor = await invite(
    owner.token,
    orgId,
    'EDITOR',
    `phase12-editor-${RUN_ID}@ai-social-studio.test`,
    'Éditeur',
  );
  const client = await invite(
    owner.token,
    orgId,
    'CLIENT',
    `phase12-client-${RUN_ID}@ai-social-studio.test`,
    'Client',
  );
  const viewer = await invite(
    owner.token,
    orgId,
    'VIEWER',
    `phase12-viewer-${RUN_ID}@ai-social-studio.test`,
    'Lecteur',
  );

  const members = await call(`/organizations/${orgId}/members`, { token: owner.token, org: orgId });
  ok(
    'Quatre membres dans l’organisation',
    members.data?.length === 4,
    String(members.data?.length),
  );
  ok(
    'Le rôle CLIENT existe réellement en base',
    members.data?.some((member) => member.role === 'CLIENT'),
    JSON.stringify(members.data?.map((member) => member.role)),
  );
  const clientId = members.data?.find((member) => member.role === 'CLIENT')?.userId;
  ok('L’identifiant du client est connu', Boolean(clientId));

  // --- Un contenu prêt à être discuté ---
  const accounts = {};
  for (const platform of ['LINKEDIN', 'X']) {
    const created = await call('/social-accounts', {
      method: 'POST',
      token: owner.token,
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

  const publicationId = await makePublication(
    editor.token,
    orgId,
    accounts,
    'Annonce collaborative',
  );

  // --- Commentaires ---
  const internal = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: { body: 'Note interne : ne pas publier avant le 15.', visibility: 'INTERNAL' },
  });
  ok('L’éditeur dépose une note interne', internal.status === 201, describe(internal));
  ok(
    'La note est bien interne',
    internal.data?.visibility === 'INTERNAL',
    internal.data?.visibility,
  );

  const visible = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: { body: 'Bonjour, voici la version à valider.', visibility: 'CLIENT' },
  });
  ok('L’éditeur dépose un commentaire client', visible.status === 201, describe(visible));

  const ownerView = await call(`/publications/${publicationId}/comments`, {
    token: owner.token,
    org: orgId,
  });
  ok(
    'L’agence voit les deux commentaires',
    ownerView.data?.total === 2,
    String(ownerView.data?.total),
  );

  const clientView = await call(`/publications/${publicationId}/comments`, {
    token: client.token,
    org: orgId,
  });
  ok('Le client n’en voit qu’un', clientView.data?.total === 1, String(clientView.data?.total));
  ok(
    'Aucune ligne interne n’est transmise au client',
    clientView.data?.comments?.every((comment) => comment.visibility === 'CLIENT'),
    JSON.stringify(clientView.data?.comments?.map((comment) => comment.visibility)),
  );
  ok(
    'Le texte interne ne figure nulle part dans la réponse',
    !JSON.stringify(clientView.data).includes('ne pas publier avant le 15'),
  );

  const clientNote = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: client.token,
    org: orgId,
    body: { body: 'Le visuel me convient.', visibility: 'INTERNAL' },
  });
  ok('Le client peut commenter', clientNote.status === 201, describe(clientNote));
  ok(
    'Sa note est forcée en visibilité client',
    clientNote.data?.visibility === 'CLIENT',
    clientNote.data?.visibility,
  );

  const replyToInternal = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: client.token,
    org: orgId,
    body: { body: 'Je réponds à l’interne', parentId: internal.data.id },
  });
  ok(
    'Répondre à un commentaire interne est refusé (404)',
    replyToInternal.status === 404,
    describe(replyToInternal),
  );

  const reply = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: {
      body: 'Merci pour la validation.',
      visibility: 'INTERNAL',
      parentId: clientNote.data.id,
    },
  });
  ok('Une réponse est acceptée', reply.status === 201, describe(reply));
  ok(
    'La réponse hérite de la visibilité du parent',
    reply.data?.visibility === 'CLIENT',
    reply.data?.visibility,
  );

  const tooDeep = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: { body: 'Réponse à une réponse', parentId: reply.data.id },
  });
  ok('Une réponse à une réponse est refusée (400)', tooDeep.status === 400, describe(tooDeep));

  const viewerComment = await call(`/publications/${publicationId}/comments`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
    body: { body: 'Je commente aussi' },
  });
  ok(
    'Un lecteur ne peut pas commenter (403)',
    viewerComment.status === 403,
    describe(viewerComment),
  );

  const foreignEdit = await call(`/comments/${clientNote.data.id}`, {
    method: 'PATCH',
    token: editor.token,
    org: orgId,
    body: { body: 'Texte réécrit par quelqu’un d’autre' },
  });
  ok(
    'Seul l’auteur peut réécrire son commentaire (403)',
    foreignEdit.status === 403,
    describe(foreignEdit),
  );

  const viewerResolve = await call(`/comments/${clientNote.data.id}`, {
    method: 'PATCH',
    token: viewer.token,
    org: orgId,
    body: { resolved: true },
  });
  ok(
    'Un lecteur ne peut pas résoudre (403)',
    viewerResolve.status === 403,
    describe(viewerResolve),
  );

  const resolved = await call(`/comments/${clientNote.data.id}`, {
    method: 'PATCH',
    token: client.token,
    org: orgId,
    body: { resolved: true },
  });
  ok('L’auteur peut résoudre son commentaire', resolved.status === 200, describe(resolved));
  ok(
    'La résolution est datée',
    Boolean(resolved.data?.resolvedAt),
    String(resolved.data?.resolvedAt),
  );

  const afterResolve = await call(`/publications/${publicationId}/comments`, {
    token: owner.token,
    org: orgId,
  });
  // Quatre commentaires, un résolu : il en reste trois ouverts.
  ok(
    'Le point résolu sort du décompte',
    afterResolve.data?.open === 3,
    String(afterResolve.data?.open),
  );

  const foreignDelete = await call(`/comments/${clientNote.data.id}`, {
    method: 'DELETE',
    token: editor.token,
    org: orgId,
  });
  ok(
    'Un éditeur non administrateur ne supprime pas le commentaire d’un client (403)',
    foreignDelete.status === 403,
    describe(foreignDelete),
  );

  const ownerDelete = await call(`/comments/${visible.data.id}`, {
    method: 'DELETE',
    token: owner.token,
    org: orgId,
  });
  ok('Un administrateur peut supprimer (204)', ownerDelete.status === 204, describe(ownerDelete));
  const afterDelete = await call(`/publications/${publicationId}/comments`, {
    token: owner.token,
    org: orgId,
  });
  ok(
    'La suppression est logique : le commentaire quitte la liste',
    afterDelete.data?.comments?.every((comment) => comment.id !== visible.data.id),
  );

  const unknownEntity = await call(`/brands/${publicationId}/comments`, {
    token: owner.token,
    org: orgId,
  });
  ok(
    'Un type non commentable est refusé (404/400)',
    unknownEntity.status >= 400,
    describe(unknownEntity),
  );

  // --- Tâches ---
  const task = await call('/tasks', {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: {
      title: 'Préparer les visuels',
      entityType: 'publication',
      entityId: publicationId,
      assigneeId: clientId,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  ok('Une tâche est créée', task.status === 201, describe(task));
  ok(
    'La tâche est assignée au client',
    task.data?.assigneeId === clientId,
    task.data?.assigneeName,
  );

  const nonMember = await call('/tasks', {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: { title: 'Tâche orpheline', assigneeId: 'membre-inexistant' },
  });
  ok('Assigner à un non-membre est refusé (400)', nonMember.status === 400, describe(nonMember));

  const halfEntity = await call('/tasks', {
    method: 'POST',
    token: editor.token,
    org: orgId,
    body: { title: 'Tâche incomplète', entityType: 'publication' },
  });
  ok(
    'Un contenu sans identifiant est refusé (400)',
    halfEntity.status === 400,
    describe(halfEntity),
  );

  const clientTask = await call('/tasks', {
    method: 'POST',
    token: client.token,
    org: orgId,
    body: { title: 'Tâche créée par le client' },
  });
  ok('Un client ne crée pas de tâche (403)', clientTask.status === 403, describe(clientTask));

  const clientSeesTasks = await call('/tasks', { token: client.token, org: orgId });
  ok(
    'Le client consulte les tâches (lecture)',
    clientSeesTasks.status === 200 && clientSeesTasks.data.length >= 1,
    describe(clientSeesTasks),
  );

  const done = await call(`/tasks/${task.data.id}`, {
    method: 'PATCH',
    token: editor.token,
    org: orgId,
    body: { status: 'DONE' },
  });
  ok('Une tâche peut être terminée', done.status === 200, describe(done));
  ok('Terminer date l’achèvement', Boolean(done.data?.completedAt), String(done.data?.completedAt));

  const reopened = await call(`/tasks/${task.data.id}`, {
    method: 'PATCH',
    token: editor.token,
    org: orgId,
    body: { status: 'OPEN' },
  });
  ok(
    'Rouvrir efface la date d’achèvement',
    reopened.data?.completedAt === null,
    describe(reopened),
  );

  const filtered = await call(`/tasks?entityType=publication&entityId=${publicationId}`, {
    token: owner.token,
    org: orgId,
  });
  ok(
    'Le filtre par contenu ne renvoie que la tâche liée',
    filtered.data?.length === 1 && filtered.data[0].id === task.data.id,
    String(filtered.data?.length),
  );

  // --- Historique ---
  const history = await call(`/publications/${publicationId}/history`, {
    token: owner.token,
    org: orgId,
  });
  ok('L’historique répond 200', history.status === 200, describe(history));
  const kinds = new Set((history.data?.entries ?? []).map((entry) => entry.kind));
  ok(
    'Les quatre sources sont fusionnées',
    ['STATUS', 'AUDIT', 'COMMENT', 'TASK'].every((kind) => kinds.has(kind)),
    JSON.stringify([...kinds]),
  );
  const stamps = (history.data?.entries ?? []).map((entry) => Date.parse(entry.at));
  ok(
    'La chronologie est décroissante',
    stamps.every((stamp, index) => index === 0 || stamps[index - 1] >= stamp),
  );
  ok(
    'Les actions journalisées portent un libellé lisible',
    (history.data?.entries ?? [])
      .filter((entry) => entry.kind === 'AUDIT')
      .some((entry) => /a créé le contenu/.test(entry.label)),
    JSON.stringify(
      (history.data?.entries ?? []).filter((entry) => entry.kind === 'AUDIT').map((e) => e.label),
    ),
  );

  const clientHistory = await call(`/publications/${publicationId}/history`, {
    token: client.token,
    org: orgId,
  });
  ok(
    'L’historique du client ne contient pas la note interne',
    !JSON.stringify(clientHistory.data).includes('ne pas publier avant le 15'),
  );

  const windowed = await call(`/publications/${publicationId}/history?limit=2`, {
    token: owner.token,
    org: orgId,
  });
  ok(
    'La fenêtre limite le nombre d’entrées',
    windowed.data?.entries?.length === 2,
    String(windowed.data?.entries?.length),
  );
  ok(
    'Le nombre d’entrées antérieures est annoncé',
    windowed.data?.truncated > 0,
    String(windowed.data?.truncated),
  );

  const missingHistory = await call('/publications/inexistant/history', {
    token: owner.token,
    org: orgId,
  });
  ok('Un contenu inexistant renvoie 404', missingHistory.status === 404, describe(missingHistory));

  // --- Validation par le client ---
  const editorApprove = await call(`/publications/${publicationId}/approve`, {
    method: 'POST',
    token: editor.token,
    org: orgId,
  });
  ok(
    'Un éditeur ne peut pas approuver (403)',
    editorApprove.status === 403,
    describe(editorApprove),
  );

  const viewerApprove = await call(`/publications/${publicationId}/approve`, {
    method: 'POST',
    token: viewer.token,
    org: orgId,
  });
  ok(
    'Un lecteur ne peut pas approuver (403)',
    viewerApprove.status === 403,
    describe(viewerApprove),
  );

  const clientApprove = await call(`/publications/${publicationId}/approve`, {
    method: 'POST',
    token: client.token,
    org: orgId,
  });
  ok('Le client peut approuver', clientApprove.status === 200, describe(clientApprove));
  ok(
    'Le contenu passe en validé',
    clientApprove.data?.status === 'APPROVED',
    clientApprove.data?.status,
  );

  const approvedHistory = await call(`/publications/${publicationId}/history`, {
    token: client.token,
    org: orgId,
  });
  ok(
    'La validation apparaît dans l’historique du client',
    (approvedHistory.data?.entries ?? []).some(
      (entry) => entry.kind === 'STATUS' && /Validé/.test(entry.label),
    ),
    JSON.stringify(
      (approvedHistory.data?.entries ?? [])
        .filter((entry) => entry.kind === 'STATUS')
        .map((entry) => entry.label),
    ),
  );

  // --- Refus motivé par le client ---
  const secondId = await makePublication(editor.token, orgId, accounts, 'Annonce à refuser');
  const clientReject = await call(`/publications/${secondId}/reject`, {
    method: 'POST',
    token: client.token,
    org: orgId,
    body: { reason: 'Le logo est l’ancien' },
  });
  ok('Le client peut refuser', clientReject.status === 200, describe(clientReject));
  ok(
    'Le contenu passe en refusé',
    clientReject.data?.status === 'REJECTED',
    clientReject.data?.status,
  );

  const rejectHistory = await call(`/publications/${secondId}/history`, {
    token: owner.token,
    org: orgId,
  });
  ok(
    'Le motif du refus est conservé dans l’historique',
    (rejectHistory.data?.entries ?? []).some((entry) => entry.detail === 'Le logo est l’ancien'),
    JSON.stringify(
      (rejectHistory.data?.entries ?? []).filter((entry) => entry.detail).map((e) => e.detail),
    ),
  );

  // --- Portefeuille ---
  const portfolio = await call('/portfolio', { token: owner.token });
  ok('Le portefeuille répond 200', portfolio.status === 200, describe(portfolio));
  ok(
    'Il ne contient que les organisations de l’utilisateur',
    portfolio.data?.clients?.length === 1,
    String(portfolio.data?.clients?.length),
  );
  const summary = portfolio.data?.clients?.[0];
  ok('Le rôle du propriétaire est repris', summary?.role === 'OWNER', summary?.role);
  ok('Les contenus sont comptés', summary?.publications === 2, String(summary?.publications));
  ok(
    'Les validations en attente sont comptées',
    summary?.pendingApprovals === 0,
    String(summary?.pendingApprovals),
  );
  ok('Les tâches ouvertes sont comptées', summary?.openTasks === 1, String(summary?.openTasks));
  ok(
    'La dernière activité est datée',
    typeof summary?.lastActivityAt === 'string',
    String(summary?.lastActivityAt),
  );
  ok(
    'Les totaux additionnent les clients',
    portfolio.data?.totals?.publications === 2 && portfolio.data?.totals?.clients === 1,
    JSON.stringify(portfolio.data?.totals),
  );

  const clientPortfolio = await call('/portfolio', { token: client.token });
  ok(
    'Le client a son propre portefeuille',
    clientPortfolio.status === 200,
    describe(clientPortfolio),
  );
  // L'inscription crée une organisation personnelle : le client invité en a donc
  // deux — la sienne, dont il est propriétaire, et celle de l'agence. Le
  // portefeuille les liste toutes les deux, ce qui est exact.
  ok(
    'Le portefeuille du client liste ses deux appartenances',
    clientPortfolio.data?.clients?.length === 2,
    String(clientPortfolio.data?.clients?.length),
  );
  const agencyEntry = (clientPortfolio.data?.clients ?? []).find(
    (entry) => entry.organizationId === orgId,
  );
  ok(
    'Son rôle dans l’agence y est CLIENT',
    agencyEntry?.role === 'CLIENT',
    JSON.stringify(agencyEntry),
  );
  // Sur quatre commentaires, le client n'en voit que deux de vivants : sa note
  // (résolue, donc hors décompte) et la réponse qui lui a été faite. La note
  // interne et le commentaire supprimé ne comptent pas.
  ok(
    'Ses points ouverts excluent l’interne',
    agencyEntry?.openComments === 1,
    String(agencyEntry?.openComments),
  );

  const anonymousPortfolio = await call('/portfolio');
  ok(
    'Le portefeuille exige un jeton (401)',
    anonymousPortfolio.status === 401,
    describe(anonymousPortfolio),
  );

  console.log(`\nPhase 12 : ${checks} vérifications E2E réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
