# État du déploiement (Phase 0)

## Services en ligne

| Service | URL | État | Notes |
| --- | --- | --- | --- |
| Frontend | https://ai-social-studio.pages.dev | ✓ Live | Cloudflare Pages, déploiement manuel pour l'instant |
| API | https://ai-social-studio-api.onrender.com | ✓ Live | Render offre gratuite, mise en veille après 15 min d'inactivité |
| Health check | https://ai-social-studio-api.onrender.com/api/v1/health | ✓ ok | Montre l'état réel des trois services |
| Documentation API | https://ai-social-studio-api.onrender.com/api/docs | ✓ Live | OpenAPI 3.0 |

## Infrastructure de données

| Service | Région | Projet/Base | État | Notes |
| --- | --- | --- | --- | --- |
| PostgreSQL | eu-central-1 | Neon: `ai-social-studio` | ✓ up | 1 Go gratuit, query scaling gratuit |
| Redis | eu-central-1 | Upstash: `ai-social-studio` | ✓ up | 500k commandes/mois, 256 Mo stockage |
| Stockage objet | — | Cloudflare R2 (clés prêtes) | ⏳ inactif | 10 Go gratuit, activation en Phase 1 (sans carte bancaire : Supabase Storage) |

## Configuration de l'environnement

### `.env` (public, committé)
```
DATABASE_URL=postgresql://...@ep-plain-grass-bad2y7pl.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full
REDIS_URL=rediss://default:...@valid-oriole-190659.upstash.io:6379
VITE_API_URL=https://ai-social-studio-api.onrender.com
CORS_ORIGINS=https://ai-social-studio.pages.dev,http://localhost:5173
```

### `.env.local` (privé, ignoré par Git)
```
NEON_API_KEY=napi_...
NEON_ORG_ID=org-crimson-bread-54394307
NEON_PROJECT_ID=calm-snow-29047826

UPSTASH_EMAIL=loukstech@gmail.com
UPSTASH_API_KEY=ab0e668d-...
UPSTASH_DATABASE_ID=2d307e71-...

RENDER_API_KEY=rnd_...
RENDER_OWNER_ID=tea-dbrf78bm8hqs73cs8gag
RENDER_SERVICE_ID=srv-dbrjb56tlv9c738mtsrg

CLOUDFLARE_ACCOUNT_ID=52c1db36897892db1605760353075d77
CLOUDFLARE_API_TOKEN=cfat_...
R2_ACCESS_KEY_ID=c8716a1c5059ad67cc1c290ed3284275
R2_SECRET_ACCESS_KEY=a788475ccac0f6ced142cb3497c86987d319b7b011aa027c4f40ec59341208e7
R2_ENDPOINT=https://52c1db36897892db1605760353075d77.r2.cloudflarestorage.com
```

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

1. Régénérer tous les jetons (Neon, Upstash, Render, Cloudflare, GitHub).
2. Changer les variables d'environnement Render : `CORS_ORIGINS`, `NODE_ENV`, etc.
3. Activer R2 ou choisir Supabase Storage pour le stockage.
4. Ajouter un monitoring (Sentry ou autre).
5. Certificat SSL/domaine personnalisé.
6. Plan payant Render pour éviter la mise en veille.
