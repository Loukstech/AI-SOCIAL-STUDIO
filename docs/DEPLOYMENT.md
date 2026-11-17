# État du déploiement (Phase 12)

## Services en ligne

| Service           | URL                                                     | État   | Notes                                                           |
| ----------------- | ------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| Frontend          | https://ai-social-studio.pages.dev                      | ✓ Live | Cloudflare Pages, déploiement manuel pour l'instant             |
| API               | https://ai-social-studio-api.onrender.com               | ✓ Live | Render offre gratuite, mise en veille après 15 min d'inactivité |
| Health check      | https://ai-social-studio-api.onrender.com/api/v1/health | ✓ ok   | Montre l'état réel des trois services                           |
| Documentation API | https://ai-social-studio-api.onrender.com/api/docs      | ✓ Live | OpenAPI 3.0                                                     |

## Infrastructure de données

| Service             | Région            | Projet/Base                 | État                                                                                                                                                  | Notes                                |
| ------------------- | ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| PostgreSQL          | eu-central-1      | Neon: `ai-social-studio`    | ✓ up                                                                                                                                                  | 1 Go gratuit, query scaling gratuit  |
| Redis               | eu-central-1      | Upstash: `ai-social-studio` | ✓ up                                                                                                                                                  | 500k commandes/mois, 256 Mo stockage |
| Stockage des médias | Neon (PostgreSQL) | ✓ actif                     | Binaire dans la table `MediaObject`, URLs signées HMAC par l’API. Aucune carte ni compte supplémentaire ; le pilote S3/R2 reste disponible si désiré. |

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
AUTH_SECRET=<openssl rand -base64 48>
```

`AUTH_SECRET` signe les jetons de session (≥ 16 caractères) et est **obligatoire en production**.

En production ces valeurs sont injectées par Render, pas par un fichier. Le jeu complet attendu sur Render est : `NODE_ENV`, `CORS_ORIGINS`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `WEB_APP_URL` (base des liens d'invitation, `https://www.socialstudio.timestradinginter.com`) et `API_PUBLIC_URL` (base des URLs signées de fichiers, `https://ai-social-studio-api.onrender.com`). `MEDIA_STORAGE_DRIVER` vaut `database` par défaut : aucun réglage supplémentaire n'est nécessaire. `MAIL_TRANSPORT=resend` active l'envoi via Resend ; voir §Notifications pour `RESEND_API_KEY` et `MAIL_FROM`. `INVITATION_TTL_HOURS` est optionnel (168 h par défaut).

`AI_PROVIDER` vaut `mock` par défaut : la transcription de démonstration fonctionne sans variable supplémentaire. `OPENAI_API_KEY` n'est utile qu'une fois l'adaptateur réel écrit (Phase 4).

Publication (Phase 6) — toutes optionnelles :

| Variable                     | Défaut | Rôle                                                           |
| ---------------------------- | ------ | -------------------------------------------------------------- |
| `PUBLISH_SCHEDULER`          | `on`   | Boucle de réclamation des échéances dans le processus de l'API |
| `PUBLISH_TICK_SECONDS`       | `60`   | Période de la boucle (10 à 3600)                               |
| `PUBLISH_WEBHOOK_URL`        | —      | Délègue l'envoi à un scénario externe (n8n, Make)              |
| `PUBLISH_WEBHOOK_SECRET`     | —      | Envoyé en `Authorization: Bearer` au webhook                   |
| `PUBLISH_WEBHOOK_TIMEOUT_MS` | `8000` | Délai maximal d'un envoi                                       |

Sans `PUBLISH_WEBHOOK_URL`, une tentative de publication échoue avec `NOT_CONFIGURED` et l'interface propose l'export ou la confirmation manuelle. C'est le comportement voulu : aucune publication n'est simulée.

Connexion des comptes sociaux (Phase 9) — toutes optionnelles, mais sans elles aucune connexion n'est possible :

| Variable                                          | Défaut  | Rôle                                                          |
| ------------------------------------------------- | ------- | ------------------------------------------------------------- |
| `API_PUBLIC_URL`                                  | —       | Base publique de l'API, pour construire l'URL de retour OAuth |
| `OAUTH_REDIRECT_URL`                              | —       | Surcharge explicite de l'URL de retour                        |
| `OAUTH_HTTP_TIMEOUT_MS`                           | `10000` | Délai des appels au fournisseur                               |
| `META_CLIENT_ID` / `META_CLIENT_SECRET`           | —       | Facebook, Instagram, Threads                                  |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`   | —       | LinkedIn                                                      |
| `X_CLIENT_ID` / `X_CLIENT_SECRET`                 | —       | X                                                             |
| `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET`       | —       | TikTok                                                        |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`       | —       | YouTube                                                       |
| `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | —       | Pinterest                                                     |

L'URL de retour à déclarer chez chaque fournisseur est `{API_PUBLIC_URL}/api/v1/social-accounts/oauth/callback`. Sur Render, `API_PUBLIC_URL=https://ai-social-studio-api.onrender.com`.

Sans identifiants, `POST /social-accounts/connect` répond `409` en nommant les variables manquantes pour la plateforme demandée. C'est le comportement voulu : aucune connexion n'est simulée.

> ⚠️ **Piège Render :** `PUT /v1/services/{id}/env-vars` **remplace** l'intégralité de la liste. Pour ajouter une seule variable, utiliser `PUT /v1/services/{id}/env-vars/{key}` ou renvoyer la liste complète. Une mise à jour partielle vide les autres variables : le déploiement suivant construit correctement mais échoue au health check (`update_failed`), car `parseEnv` exige `DATABASE_URL` et `REDIS_URL` en production.

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

# Facultatif : Only if a S3-compatible bucket is configured.
MEDIA_STORAGE_DRIVER=database   # or s3
R2_ENDPOINT=...
```

`DATABASE_URL` s'obtient via `GET /api/v2/projects/{id}/connection_uri` (Neon), `REDIS_URL` et les tokens REST via `GET /v2/redis/databases` (Upstash, auth Basic e-mail + clé API).

## Flux de déploiement

### Frontend

Le projet Cloudflare Pages est en **upload direct** (`ad_hoc`) : aucun dépôt Git n'est connecté, donc un push sur `main` ne publie **pas** le frontend. Il faut déployer explicitement après chaque changement d'interface.

1. Compiler contre l'API de production. Comme `.env` local pointe vers `localhost` et que Vite donne priorité au fichier `.env`, créer un fichier local ignoré `.env.production` contenant `VITE_API_URL=https://ai-social-studio-api.onrender.com`, puis :

   ```bash
   VITE_API_URL=https://ai-social-studio-api.onrender.com pnpm --filter @ass/web build
   ```

2. Vérifier le bundle : il doit contenir `ai-social-studio-api.onrender.com` et **pas** `http://localhost:3000`.
3. Publier sur la branche de production :

   ```bash
   npx wrangler pages deploy apps/web/dist \
     --project-name ai-social-studio --branch main \
     --commit-hash <sha> --commit-message "Phase 1"
   ```

   Le `--branch main` est indispensable : sans lui, Wrangler utilise la branche Git courante et crée un déploiement de prévisualisation.

4. Accès : https://ai-social-studio.pages.dev

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
- Solution en place : le workflow GitHub Actions `ci.yml` tourne toutes les 10 minutes (cron) et exécute `smoke-online.mjs`, ce qui réveille l'API et vérifie la production.

### Partage du quota gratuit Render

- Offre gratuite : 750 heures/mois par organisation.
- Deux services (API + `crm-api`) : ne peuvent pas tous les deux rester allumés en permanence.
- Solution : vérifier l'heure d'allumage du `crm-api`, ou passer l'API à Starter ($7/mois).

### Programmation des publications

- La boucle tourne dans le processus de l'API : pas de worker séparé, donc pas de consommation d'heures Render supplémentaire.
- La réclamation est atomique (`UPDATE … WHERE status = 'SCHEDULED'`), ce qui protège d'un double envoi si une seconde instance démarre.
- Une publication programmée depuis plus de 7 jours sans envoi passe en `EXPIRED` au lieu de partir en retard.
- `POST /api/v1/publications/run-due` (ADMIN) force un passage immédiat, utile pour vérifier la production.

### Composition des visuels

- Aucune variable d'environnement, aucune clé : le composeur SVG tourne dans le processus de l'API. Pas de coût variable, pas de dépendance externe, pas de quota.
- Le SVG est stocké en base (colonne `text`) : un visuel pèse quelques kilo-octets, la limite Neon n'est pas un sujet à cette échelle.
- L'aperçu web passe par une `data:` URI dans une balise `<img>` : le SVG ne peut pas exécuter de script.
- Le téléchargement est servi par l'API (`Content-Disposition: attachment`). Un export PNG nécessiterait un moteur raster (resvg, sharp) ou un navigateur headless, non installés à ce stade.
- **Export PNG : côté navigateur.** Le SVG est converti en canvas puis en `image/png`. Aucune dépendance serveur, aucune police à embarquer, et un rendu identique à l'aperçu. Les ressources externes (logo, photo) sont intégrées en `data:` URI avant conversion, car un SVG chargé comme image ne peut pas les charger lui-même ; si le CDN refuse la requête (CORS), l'utilisateur reçoit un avertissement nommé.
- **Déclinaison** : `POST /image-projects/{id}/decline` recompose le visuel dans d'autres gabarits. Aucun coût, aucun appel externe. Une plateforme incompatible est retirée de la déclinaison avec un avertissement, plutôt que de faire échouer la requête entière.

### Mesure des performances

- Aucune variable d'environnement, aucune clé : les métriques sont saisies via l'API ou lues par les adaptateurs de plateforme. Pas de coût variable.
- La collecte automatique (`POST /api/v1/analytics/collect`) n'appelle un fournisseur que si ses identifiants sont présents ; sinon elle rend `collected: 0` et un motif par cible. Rien n'est facturé et rien n'est inventé.
- Les agrégats sont calculés à la volée (deux requêtes indexées : `[organizationId, collectedAt]` et `[targetId, collectedAt]`). À l'échelle de Neon, pas de table de résumé à maintenir.
- `PublicationMetric` cascade avec sa cible : supprimer une publication supprime ses mesures, donc pas de ligne orpheline à nettoyer.
- L'export CSV est généré en mémoire et renvoyé avec `Content-Disposition`; aucune écriture disque, compatible avec le système de fichiers éphémère de Render.

### Notifications

- Transport **Resend** activé en production : `MAIL_TRANSPORT=resend`, `RESEND_API_KEY` (clé secrète stockée sur Render, en accès complet à l'API Resend) et `MAIL_FROM=AI Social Studio <noreply@socialstudio.timestradinginter.com>`.
- Domaine `socialstudio.timestradinginter.com` vérifié dans Resend (`ff1e606d-7e58-4d97-bb76-e0ac7339ca0c`, région `eu-west-1`). Les enregistrements DNS ont été publiés via l'API Hostinger sur la zone `timestradinginter.com` : DKIM `resend._domainkey.socialstudio`, MX `send.socialstudio`, SPF TXT `send.socialstudio` et CNAME `rsend.socialstudio`.
- Validation finale après le déploiement Render `dep-dbu9i6jm8hqs73f6g53g` (live sur `a6637b2`) : une invitation créée via l'API de production a bien été envoyée par `AI Social Studio <noreply@socialstudio.timestradinginter.com>` (journal Resend `01a1eab9-d47e-7d9e-bf9a-5d45810a38cf`). Le compte jetable créé pour l'essai a été supprimé.
- L'alternative SMTP Hostinger a été préparée (`noreply@timestradinginter.com`, ports 587 et 465) mais Render n'a pas pu joindre `smtp.hostinger.com` (`Connection timeout` dans les deux cas), alors que les tests locaux passaient. Le code SMTP reste disponible avec `MAIL_TRANSPORT=smtp`.
- Le quota gratuit Resend est de 3 000 e-mails/mois et 100/jour.
- Sans transport configuré (`MAIL_TRANSPORT=none`), le transport reste inerte et enregistre `NO_PROVIDER` : aucun succès n'est simulé.
- Les invitations envoient aussi un e-mail best-effort avec le lien d'acceptation ; une panne du transport est journalisée mais ne bloque pas la création de l'invitation.
- Les notifications sont écrites dans la même transaction logique que la transition qui les déclenche, mais leur échec est journalisé sans être propagé : une publication réussie n'est jamais annulée par un avertissement manquant.
- La pastille de compteur interroge l'API toutes les 45 s : aucun WebSocket, aucun serveur supplémentaire, aucune consommation d'heures Render.

### CORS

- En production, `CORS_ORIGINS=https://ai-social-studio.pages.dev` ; en local, `http://localhost:5173`.
- À mettre à jour si le frontend est hébergé ailleurs (préflight vérifié par `pnpm test:online`).

### Stockage

- Les fichiers de la médiathèque sont stockés dans la table PostgreSQL `MediaObject` de Neon (`MEDIA_STORAGE_DRIVER=database`, défaut). Aucun fournisseur, carte bancaire ou bucket n'est nécessaire.
- Les URLs de lecture passent par `GET /api/v1/media/file?key=...&exp=...&token=...`, signées en HMAC-SHA256 avec `AUTH_SECRET` et valables 30–3600 s. Elles ne donnent jamais d'accès permanent au fichier.
- Le pilote `s3` reste dans le code pour un éventuel branchement R2/compatible S3 : il exige `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY`. R2 demande une souscription Cloudflare avec moyen de paiement, mais son quota gratuit (10 Go/mois) reste à 0 € tant qu'il n'est pas dépassé.
- `/media/:id/url` conserve la même signature d'API pour le frontend ; seule l'URL renvoyée change.

## Commandes courantes

```bash
# Développement local
pnpm dev                          # API:3000, Frontend:5173

# Qualité locale
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check

# Tests en ligne (production)
pnpm test:online                  # frontend, API, PostgreSQL, Redis, CORS, headers
pnpm test:phase1                  # parcours E2E : compte, organisation, marques, médias
pnpm test:phase2                  # parcours E2E : comptes sociaux chiffrés, invitations, RBAC
pnpm test:phase3                  # parcours E2E : projets vidéo, transcription, sous-titres SRT
pnpm test:phase4                  # parcours E2E : édition, 7 styles, exports, clips
pnpm test:phase5                  # parcours E2E : génération de contenus, assistant
pnpm test:phase6                  # parcours E2E : publication, calendrier, fuseau
pnpm test:phase7                  # parcours E2E : visuels, Brand Kit, téléchargement
pnpm test:phase8                  # parcours E2E : déclinaison multi-formats
pnpm test:phase9                  # parcours E2E : connexions OAuth, santé des comptes
pnpm test:phase10                 # parcours E2E : métriques, agrégats, export CSV
pnpm test:phase11                 # parcours E2E : notifications, préférences, déduplication
pnpm test:phase12                 # parcours E2E : commentaires, tâches, historique, validation client
pnpm verify:png                   # export PNG dans Chrome headless

# Déploiement
pnpm --filter @ass/web build && npx wrangler pages deploy apps/web/dist --project-name ai-social-studio --branch main
git push                          # Déclenche Render automatiquement (API uniquement)
```

## À faire avant production

1. Régénérer tous les jetons (Neon, Upstash, Render, Cloudflare, GitHub) : une clé secrète R2 a figuré en clair dans l'historique Git de ce fichier — la rotation ne suffit pas, il faut aussi purger l'historique (git filter-repo / BFG) puis force-push.
2. Vérifier avant chaque déploiement le jeu complet de variables Render (`NODE_ENV`, `CORS_ORIGINS`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`) : voir le piège du `PUT` ci-dessus.
3. Le stockage des médias est déjà actif dans Neon. Activer R2 uniquement si le volume dépasse le quota gratuit de la base ; dans ce cas poser `MEDIA_STORAGE_DRIVER=s3` et renseigner les variables `R2_*`.
4. Ajouter un monitoring (Sentry ou autre).
5. Certificat SSL/domaine personnalisé.
6. Plan payant Render pour éviter la mise en veille.
