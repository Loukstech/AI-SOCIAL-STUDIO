# Journal de progression

## Phase 0 — Préparation technique (13 novembre 2026)

**Statut : terminée côté code, en attente de validation.** PostgreSQL est branché et vérifié ; Redis reste à configurer (voir « Limites »).

### Travaux

- Monorepo pnpm workspaces + Turborepo, entièrement en modules ES.
- `apps/api` : NestJS 12, configuration validée par Zod, Helmet, CORS restreint, préfixe `/api/v1`, documentation OpenAPI sur `/api/docs`, point de santé qui interroge PostgreSQL et Redis.
- `apps/web` : React 19, Vite 8, Tailwind 4, jetons de design clair et sombre, page d'état branchée sur l'API réelle avec ses états de chargement, d'erreur et de succès.
- `packages/database` : Prisma 7 avec le pilote `pg`, sans modèle pour l'instant.
- `packages/shared` : contrat Zod du point de santé, partagé entre l'API et le frontend.
- Qualité : ESLint, Prettier, TypeScript strict, Vitest, CI GitHub Actions.
- `docker-compose.yml` optionnel (PostgreSQL 17, Redis 7) pour les machines qui ont Docker.
- Documentation : architecture, installation, hébergement gratuit.

### Décisions techniques

Détaillées dans [architecture/overview.md](architecture/overview.md). Les principales : ESM partout, Vitest au lieu de Jest, TypeScript 6 plutôt que 7, services managés plutôt que Docker en local.

### Migrations

Aucune : le schéma ne contient pas encore de modèle. Le schéma détaillé est le premier livrable de la Phase 1.

### Tests

`pnpm turbo run lint typecheck test build` : 16 tâches réussies sur 16, 16 tests réussis sur 16.

- `@ass/shared` : 3 tests (calcul de l'état global, validation du contrat).
- `@ass/api` : 10 tests (validation de la configuration, service de santé, requêtes HTTP réelles sur `/api/v1/health`, CORS, préfixe).
- `@ass/web` : 3 tests (affichage de l'état, API injoignable, réponse invalide).

Vérifié à la main : l'API compilée démarre, `/api/v1/health` et `/api/docs` répondent, et le démarrage en production sans base ni Redis est refusé avec un message explicite.

### Réellement opérationnel

- Démarrage de l'API et du frontend en local.
- Point de santé et documentation OpenAPI.
- Chaîne qualité complète, en local.

### Limites et blocages

- **Redis non exercé.** PostgreSQL (projet Neon `ai-social-studio`, région eu-central-1, PostgreSQL 17) répond « opérationnel » depuis l'API. Sans `REDIS_URL`, seul le cas « non configuré » a été vérifié pour Redis.
- **CI.** Le dépôt est sur GitHub (Loukstech/AI-SOCIAL-STUDIO) et la CI s'exécute à chaque push.
- **Docker non testé.** Docker n'est pas installé sur le poste ; `docker-compose.yml` n'a pas été lancé. Aucun Dockerfile n'est fourni : il sera écrit et testé quand l'hébergeur de l'API sera choisi.
- **Rendu visuel non contrôlé dans un navigateur.** Le frontend est couvert par des tests de composants et compile, mais la page n'a pas été ouverte dans un navigateur pendant cette phase.
- **Espace disque.** Environ 6 Go libres sur le poste : à surveiller avant d'installer FFmpeg et les dépendances vidéo.

### Prochaine étape recommandée

1. Créer la base Redis Upstash, renseigner `REDIS_URL`, constater les trois services « Opérationnel » sur la page d'accueil.
2. Trancher les points ouverts listés dans [architecture/overview.md](architecture/overview.md).
3. Phase 1 : schéma de données détaillé, puis authentification et organisations.
