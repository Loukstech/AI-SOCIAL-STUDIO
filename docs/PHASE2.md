# Phase 2 — Connexions sociales

> **Statut : LIVRÉE** (15 novembre 2026).

## Objectif

Rattacher les comptes sociaux d'une organisation et de ses marques, avec un stockage
de jetons réellement sûr, et permettre d'inviter des collaborateurs dans une organisation.

## Périmètre livré

### Comptes sociaux

- Modèle `SocialAccount` : plateforme (Instagram, Facebook, TikTok, LinkedIn, YouTube, X,
  Pinterest, Threads), nom d'utilisateur, marque associée facultative, statut, portées,
  date d'expiration du jeton, dernière synchronisation, suppression logique.
- **Jetons chiffrés en AES-256-GCM** (clé dérivée de `AUTH_SECRET`, IV aléatoire, tag
  d'authentification). L'API ne renvoie jamais le jeton : seulement `hasAccessToken` et
  `hasRefreshToken`.
- Un compte social est unique par `(organisation, plateforme, nom d'utilisateur)`.
- Routes :
  - `GET /api/v1/social-accounts` (VIEWER)
  - `POST /api/v1/social-accounts` (ADMIN)
  - `PATCH /api/v1/social-accounts/:id` (ADMIN)
  - `POST /api/v1/social-accounts/:id/sync` (EDITOR) — vérifie le déchiffrement et horodate
  - `DELETE /api/v1/social-accounts/:id` (ADMIN) — efface les jetons et passe le statut à `REVOKED`

### Invitations

- Modèle `Invitation` : e-mail, rôle, **empreinte SHA-256 du jeton** (le jeton brut n'est
  jamais stocké), expiration, acceptation, révocation.
- Une seule invitation active par adresse et par organisation : la création révoque les
  précédentes.
- Routes :
  - `GET /api/v1/organizations/:id/invitations` (ADMIN)
  - `POST /api/v1/organizations/:id/invitations` (ADMIN) — renvoie `acceptUrl` et `token` une seule fois
  - `DELETE /api/v1/organizations/:id/invitations/:invitationId` (ADMIN)
  - `POST /api/v1/invitations/accept` (authentifié) — l'adresse du compte doit correspondre
- Le lien prend la forme `https://<frontend>/?invitation=<jeton>` ; l'application accepte
  automatiquement l'invitation après connexion ou création de compte.
- L'envoi d'e-mail automatique reste à brancher sur un fournisseur transactionnel ; en
  attendant, le lien est affiché à l'administrateur qui invite.

### Tableau de bord

Deux compteurs supplémentaires : comptes sociaux et invitations en attente.

## Sécurité

- Aucun jeton tiers en clair en base, dans les logs ou dans les réponses HTTP.
- Les invitations sont vérifiées sur quatre axes : révocation, usage unique, expiration,
  correspondance de l'adresse e-mail.
- Toutes les routes restent filtrées par `organizationId` et protégées par le RBAC.

## Reporté

- Parcours OAuth complet (autorisation, échange de code, rafraîchissement) : nécessite les
  identifiants d'application Meta, TikTok, LinkedIn et Google.
- Appels réels aux API des plateformes lors de la synchronisation.
- Envoi d'e-mails d'invitation et rappels d'expiration.
- Upload binaire des médias (stockage objet R2 ou Supabase Storage).

## Vérification

`pnpm test:phase2` exécute 30 vérifications de bout en bout : connexion d'un compte social,
absence de fuite de jeton, doublon refusé, synchronisation, mise à jour, invitation, création
du compte invité, acceptation, isolation RBAC (un EDITOR ne peut ni connecter ni inviter),
invitation déjà utilisée, révocation, déconnexion et compteurs du tableau de bord.
