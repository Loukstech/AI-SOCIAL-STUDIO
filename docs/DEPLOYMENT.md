# État du déploiement (Phase 0)

## Services en ligne

| Service           | URL                                                     | État   | Notes                                                           |
| ----------------- | ------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| Frontend          | https://ai-social-studio.pages.dev                      | ✓ Live | Cloudflare Pages, déploiement manuel pour l'instant             |
| API               | https://ai-social-studio-api.onrender.com               | ✓ Live | Render offre gratuite, mise en veille après 15 min d'inactivité |
| Health check      | https://ai-social-studio-api.onrender.com/api/v1/health | ✓ ok   | Montre l'état réel des trois services                           |
| Documentation API | https://ai-social-studio-api.onrender.com/api/docs      | ✓ Live | OpenAPI 3.0                                                     |

## Infrastructure de données

| Service        | Région       | Projet/Base                 | État          | Notes                                                                                                                                                |
| -------------- | ------------ | --------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | eu-central-1 | Neon: `ai-social-studio`    | ✓ up          | 1 Go gratuit, query scaling gratuit                                                                                                                  |
| Redis          | eu-central-1 | Upstash: `ai-social-studio` | ✓ up          | 500k commandes/mois, 256 Mo stockage                                                                                                                 |
| Stockage objet | —            | Cloudflare R2               | ⛔ non activé | L'API Cloudflare répond « Please enable R2 through the Cloudflare Dashboard » : aucun bucket n'existe. Activation manuelle + carte bancaire requises |

## Configuration de l'environnement

**Aucune valeur réelle ne doit figurer dans ce fichier ni dans aucun document du dépôt.** Les deux fichiers ci-dessous sont locaux, ignorés par Git (`.gitignore`) et renseignés à partir des API de gestion des fournisseurs.

### `.env` (local, ignoré par Git)

Variables consommées par l'API, Prisma et Vite :

```
NODE_ENV=development
API_PORT=3000
CORS_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:3000
DATABASE_URL=postgresql://<user>:<password>@<host>/neondb?sslmode=require
REDIS_URL=rediss://default:<password>@<host>:6379
```

En production ces valeurs sont injectées par Render, pas par un fichier.

### `.env.local` (local, ignoré par Git)

Clés de **gestion** (automatisation uniquement, jamais lues par l'application) :

```
NEON_API_KEY=...
NEON_ORG_ID=org-crimson-bread-54394307
NEON_PROJECT_ID=calm-snow-29047826

UPSTASH_EMAIL=...
UPSTASH_API_KEY=...
UPSTASH_DATABASE_ID=...
UPSTASH_REDIS_REST_TOKEN=...

RENDER_API_KEY=...
RENDER_OWNER_ID=tea-dbrf78bm8hqs73cs8gag
RENDER_SERVICE_ID=srv-dbrjb56tlv9c738mtsrg

CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=...
```

`DATABASE_URL` s'obtient via `GET /api/v2/projects/{id}/connection_uri` (Neon), `REDIS_URL` et les tokens REST via `GET /v2/redis/databases` (Upstash, auth Basic e-mail + clé API).

## Flux de déploiement

### Frontend

1. Compilation locale : `VITE_API_URL=https://ai-social-studio-api.onrender.com pnpm --filter @ass/web build`
2. Envoi sur Cloudflare Pages : `wrangler pages deploy apps/web/dist --project-name ai-social-studio`
3. Accès : https://ai-social-studio.pages.dev

**Automatisation à venir :** connecter le projet GitHub pour auto-déploiement à chaque push.

### API

1. GitHub : push sur `main` → GitHub Actions lance la CI (lint, typecheck, test, build).
2. Render : détecte le push, clône le dépôt, construit (`pnpm install --frozen-lockfile && pnpm turbo run build --filter=@ass/api...`), démarre l'API.
3. Accès : https://ai-social-studio-api.onrender.com

**CI GitHub Actions :**

```yaml
- Lint (ESLint)
- Typecheck (TypeScript)
- Tests (Vitest)
- Build (Turborepo, tous les paquets)
```

## Points d'attention

### Mise en veille Render

- L'API s'endort après 15 minutes sans trafic.
- Premier appel après mise en veille : ~1 minute de latence.
- Solution pour la démo : un ping gratuit (cron-job.org) toutes les 10 minutes.

### Partage du quota gratuit Render

- Offre gratuite : 750 heures/mois par organisation.
- Deux services (API + `crm-api`) : ne peuvent pas tous les deux rester allumés en permanence.
- Solution : vérifier l'heure d'allumage du `crm-api`, ou passer l'API à Starter ($7/mois).

### CORS

- `CORS_ORIGINS` autorise `https://ai-social-studio.pages.dev` et `http://localhost:5173`.
- À mettre à jour si le frontend est hébergé ailleurs.

### Stockage

- R2 n'est pas activé (demande carte bancaire).
- Alternative gratuite : Supabase Storage (50 Mo/fichier).
- Phase 1 : choisir l'une ou l'autre avant d'implémenter les uploads.

## Commandes courantes

```bash
# Développement local
pnpm dev                          # API:3000, Frontend:5173

# Déploiement
pnpm --filter @ass/web build && npx wrangler pages deploy apps/web/dist --project-name ai-social-studio
git push                          # Déclenche Render automatiquement
```

## À faire avant production

1. Régénérer tous les jetons (Neon, Upstash, Render, Cloudflare, GitHub) : une clé secrète R2 a figuré en clair dans l'historique Git de ce fichier — la rotation ne suffit pas, il faut aussi purger l'historique (git filter-repo / BFG) puis force-push.
2. Changer les variables d'environnement Render : `CORS_ORIGINS`, `NODE_ENV`, etc.
3. Activer R2 (tableau de bord Cloudflare + carte bancaire), créer un bucket et renseigner `R2_BUCKET_NAME`, ou choisir Supabase Storage pour le stockage.
4. Ajouter un monitoring (Sentry ou autre).
5. Certificat SSL/domaine personnalisé.
6. Plan payant Render pour éviter la mise en veille.
