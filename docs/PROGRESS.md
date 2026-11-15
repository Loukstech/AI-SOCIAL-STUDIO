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

Phase 2 — Connexions sociales : schéma des comptes sociaux, OAuth plateformes, invitations par e-mail et activation du stockage objet pour les fichiers binaires. Préalable : activer Cloudflare R2 dans le tableau de bord et faire tourner les clés exposées.
