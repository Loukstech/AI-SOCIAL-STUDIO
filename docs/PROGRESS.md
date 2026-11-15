# Journal de progression

## Phase 0 — Préparation technique (13 novembre 2026)

**Statut : TERMINÉE.**

### Livraison finale

**Environnement de développement opérationnel :**

- Frontend : React 19, Vite 8, Tailwind 4, jetons de design clair/sombre, tests Vitest.
- API : NestJS 12, modules ES, configuration validée, point de santé, documentation OpenAPI, tests Vitest.
- Base de données : Prisma 7 + PostgreSQL 17 (Neon), migrations prêtes.
- Cache : Redis (Upstash), configuration BullMQ prête.
- Infrastructure :
  - **Frontend en ligne** : https://ai-social-studio.pages.dev (Cloudflare Pages)
  - **API en ligne** : https://ai-social-studio-api.onrender.com (Render, offre gratuite)
  - **PostgreSQL** : Neon, projet "ai-social-studio", région eu-central-1
  - **Redis** : Upstash, région eu-central-1
  - **Stockage objet** : Cloudflare R2 (clés prêtes, pas encore activé)

**Qualité logicielle :**

- CI/CD : GitHub Actions, passant à chaque push.
- Lint, typecheck, tests et build : tout automatisé et validé.
- Monorepo : pnpm workspaces + Turborepo, architecture modulaire.

**Fichiers critiques :**

- `.env` : URLs de connexion (DATABASE_URL, REDIS_URL, VITE_API_URL, CORS_ORIGINS).
- `.env.local` : jetons de gestion (Neon, Upstash, Render, Cloudflare) — jamais committé.

**Vérifications manuelles :**

- ✓ Démarrage local en mode dev (API + frontend).
- ✓ Point de santé local : base et Redis « up ».
- ✓ Point de santé en ligne (Render) : base et Redis « up ».
- ✓ CORS : frontend autorisé à joindre l'API.
- ✓ Frontend ouvre l'API et affiche l'état réel des trois services.

### Limites intentionnelles de Phase 0

- Aucun modèle métier dans Prisma : le schéma détaillé est le premier livrable de Phase 1.
- Pas d'authentification : Phase 1.
- Pas de stockage objet : R2 activable en Phase 1 si carte bancaire, ou Supabase Storage sinon.
- Frontend minimaliste : page d'état seulement, interface des modules arrive en Phase 1+.

### Prochaine étape

Phase 1 : authentification (Supabase Auth), schéma de données (13 tables), organisations multi-tenant.

La Phase 1 commence dès validation de ce livrable et choix de la langue de l'interface (français seul ou français+anglais).

---

## Phase 1 — Fondations SaaS (15 novembre 2026)

**Statut : TERMINÉE.**

- Authentification locale : `scrypt` + jetons HMAC-SHA256, sessions révocables, `AUTH_SECRET` configuré sur Render.
- Schéma Prisma livré : `User`, `Session`, `Organization`, `Member`, `Brand`, `MediaAsset`, `AuditLog`. Migration `20261115161000_phase1_fondations` appliquée sur Neon.
- Multi-tenant par `X-Organization-Id`, RBAC `OWNER / ADMIN / EDITOR / VIEWER`.
- Routes : `/auth/*`, `/organizations/*`, `/brands`, `/media`, `/dashboard`.
- Interface produit : connexion, tableau de bord, organisations, marques, médiathèque ; l'ancien diagnostic technique reste accessible dans « État du système ».
- Qualité : lint, typecheck, 18 tests unitaires, build, `pnpm test:phase1` (24 vérifications E2E), `pnpm test:online`.

Détail des choix et du périmètre reporté : [PHASE1.md](PHASE1.md).

### Prochaine étape

Phase 2 — Connexions sociales (voir ci-dessous).

---

## Phase 2 — Connexions sociales (15 novembre 2026)

**Statut : TERMINÉE.**

- Modèles `SocialAccount` et `Invitation`, migration `20261115181000_phase2_connexions_sociales` appliquée sur Neon.
- Jetons OAuth chiffrés en AES-256-GCM (clé dérivée de `AUTH_SECRET`), jamais renvoyés par l'API ; seuls `hasAccessToken` / `hasRefreshToken` sont exposés.
- Routes `/social-accounts` (liste, connexion, mise à jour, synchronisation, déconnexion) et `/organizations/:id/invitations` + `/invitations/accept`.
- Invitations à usage unique, expirantes, révocables, stockées par empreinte SHA-256 ; le lien `?invitation=<jeton>` est accepté automatiquement après connexion.
- Interface : page « Comptes sociaux », section invitations dans Organisations, compteurs du tableau de bord.
- Qualité : 18 tests unitaires (dont 8 sur la crypto), `pnpm test:phase2` (30 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE2.md](PHASE2.md).

### Prochaine étape

Phase 3 — AI Video Studio. Préalables : identifiants d'application OAuth pour les plateformes, fournisseur d'IA, et activation du stockage objet (R2 ou Supabase Storage) pour les fichiers binaires.

---

## Phase 3 — AI Video Studio (15 novembre 2026)

**Statut : TERMINÉE.**

- Modèles `VideoProject`, `Transcript` et `SubtitleTrack`, migration `20261115190000_phase3_video_studio` appliquée sur Neon.
- Routes `/video-projects` : liste, création, détail, mise à jour, suppression logique, transcription et génération de sous-titres.
- Transcription via `AI_PROVIDER=mock` (déterministe, sans appel externe) ; `openai` est reconnu mais renvoie `503` tant que l'adaptateur n'existe pas — pas de fausse promesse.
- Sous-titres SRT dans trois styles (`PROFESSIONAL`, `MINIMAL`, `KARAOKE`) produits par un module pur `apps/api/src/video/subtitles.ts`, couvert par 6 tests unitaires.
- Interface : page « AI Video Studio » (création, détail, transcription, styles, aperçu, copie et téléchargement du `.srt`), compteur « Projets vidéo » sur le tableau de bord.
- Qualité : 24 tests unitaires, `pnpm test:phase3` (52 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE3.md](PHASE3.md).

### Prochaine étape

Phase 4 — Production et rendu. Préalables : worker de rendu (ffmpeg), stockage objet activé, adaptateur de transcription réel, identifiants OAuth des plateformes.

---

## Phase 4 — Édition, clips et exports (15 novembre 2026)

**Statut : TERMINÉE.**

- Édition manuelle de la transcription (texte et timings) avec validation stricte ; les pistes de sous-titres obsolètes sont supprimées, car dérivées du texte.
- Sept styles de sous-titres conformes au §5.4 : professionnel, minimal, karaoké, mots-clés, dynamique, créateur, podcast.
- Exports SRT, VTT et TXT par simple sérialisation des cues stockées en JSON sur la piste.
- Mode A : extraction des meilleurs passages avec score 0–100 et justification explicable (`ClipSuggestion`), ajustement des points de coupe et sélection.
- Migration `20261115200000_phase4_edition_clips` appliquée sur Neon.
- Qualité : 40 tests unitaires (dont 24 sur le pipeline vidéo), `pnpm test:phase4` (63 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE4.md](PHASE4.md).

### Prochaine étape

Phase 5 — Production et rendu. Préalables : worker de rendu (ffmpeg), stockage objet activé, adaptateur de transcription réel, identifiants OAuth des plateformes.
