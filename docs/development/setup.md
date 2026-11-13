# Installation du poste de développement

Le projet est conçu pour tourner sur une machine modeste, sans Docker ni VPS : PostgreSQL et Redis sont des services managés gratuits, joints par Internet.

## 1. Outils

- Node.js 22 ou plus (24 recommandé)
- pnpm 12 : `npm install -g pnpm`
- Git

## 2. Dépendances

```bash
pnpm install
```

## 3. Variables d'environnement

Copier `.env.example` vers `.env` à la racine. Ce fichier unique sert à l'API, à Prisma et au frontend. Il est ignoré par Git et ne doit jamais être commité.

### PostgreSQL avec Neon

1. Créer un compte sur <https://neon.tech> (sans carte bancaire).
2. Créer un projet, de préférence dans une région européenne.
3. Copier la chaîne de connexion (« Connection string ») dans `DATABASE_URL`.

### Redis avec Upstash

1. Créer un compte sur <https://upstash.com> (sans carte bancaire).
2. Créer une base Redis, de préférence dans une région européenne.
3. Copier l'URL TCP, qui commence par `rediss://`, dans `REDIS_URL`. Ne pas utiliser l'URL REST : BullMQ exige le protocole Redis.

### Variante avec Docker (optionnelle)

Sur une machine qui dispose de Docker : `docker compose up -d`, puis utiliser les URL locales indiquées en commentaire dans `.env.example`.

## 4. Lancer

```bash
pnpm dev
```

- Frontend : <http://localhost:5173>. La page affiche l'état réel de l'API, de PostgreSQL et de Redis.
- API : <http://localhost:3000/api/v1/health>
- Documentation OpenAPI : <http://localhost:3000/api/docs>

## 5. Vérifier avant de pousser

```bash
pnpm format:check
pnpm turbo run lint typecheck test build
```

La CI GitHub Actions exécute exactement ces commandes.

## Conventions

- **Modules ES partout.** Les imports relatifs côté Node portent l'extension `.js` (`./env.js`), y compris depuis un fichier `.ts`.
- **Injection NestJS explicite.** Écrire `@Inject(Service)` dans les constructeurs : les tests tournent sous Vitest, qui n'émet pas les métadonnées de types des décorateurs.
- **Types partagés dans `@ass/shared`.** Un contrat d'API est un schéma Zod, utilisé pour valider côté serveur et côté client.
- **Tests à côté du code**, nommés `*.test.ts` ou `*.test.tsx`.
- **TypeScript 6.** TypeScript 7 n'est pas encore pris en charge par typescript-eslint ; ne pas monter de version sans vérifier.
- **Prisma 7.** L'URL de la base est lue dans `packages/database/prisma.config.ts`, pas dans `schema.prisma`.
