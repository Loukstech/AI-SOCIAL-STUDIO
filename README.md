# AI Social Studio

Studio de production et de distribution de contenus assisté par IA : une idée ou une vidéo source devient une campagne multiréseaux, depuis un seul espace de travail.

Le document de référence est [AI_Social_Studio_Cahier_des_Charges.md](AI_Social_Studio_Cahier_des_Charges.md). L'avancement réel est tenu dans [docs/PROGRESS.md](docs/PROGRESS.md).

**État actuel : Phase 6 (Publishing Center et calendrier éditorial).** Comptes, organisations multi-tenant, droits par rôle, marques, médiathèque (métadonnées), comptes sociaux avec jetons chiffrés, invitations de membres, projets vidéo avec transcription éditable, sept styles de sous-titres, exports SRT/VTT/TXT, extraction des meilleurs passages, génération de contenus multiréseaux avec assistant rédactionnel, circuit de validation des publications, programmation et calendrier éditorial sont opérationnels. Le parcours OAuth des plateformes, le rendu ffmpeg et l'envoi réel vers les réseaux arrivent aux phases suivantes.

## Démarrage rapide

Prérequis : Node.js 22 ou plus, pnpm 12 (`npm install -g pnpm`). Docker n'est pas nécessaire.

```bash
pnpm install
cp .env.example .env     # puis renseigner DATABASE_URL, REDIS_URL et AUTH_SECRET
pnpm dev                 # API sur http://localhost:3000, web sur http://localhost:5173
```

Le fichier `.env.local` contient tous les jetons de gestion (Neon, Upstash, Render, Cloudflare) — jamais committé.

## Commandes

| Commande                             | Rôle                                                |
| ------------------------------------ | --------------------------------------------------- |
| `pnpm dev`                           | Lance l'API et le frontend en mode développement    |
| `pnpm build`                         | Compile tous les paquets                            |
| `pnpm test`                          | Lance tous les tests unitaires                      |
| `pnpm test:online`                   | Vérifie la production (frontend + API + CORS)       |
| `pnpm test:phase1`                   | Parcours E2E Phase 1 (compte, marques, médias)      |
| `pnpm test:phase2`                   | Parcours E2E Phase 2 (comptes sociaux, invitations) |
| `pnpm test:phase3`                   | Parcours E2E Phase 3 (projets vidéo, sous-titres)   |
| `pnpm test:phase4`                   | Parcours E2E Phase 4 (édition, clips, exports)      |
| `pnpm test:phase5`                   | Parcours E2E Phase 5 (génération de contenus)       |
| `pnpm test:phase6`                   | Parcours E2E Phase 6 (publication, calendrier)      |
| `pnpm lint` / `pnpm typecheck`       | Analyse statique                                    |
| `pnpm format`                        | Formate le code avec Prettier                       |
| `pnpm db:migrate` / `pnpm db:deploy` | Migrations Prisma (développement / production)      |

## Organisation

```text
apps/
  api/          API NestJS (monolithe modulaire) — /api/v1, docs OpenAPI sur /api/docs
  web/          Frontend React + Vite + Tailwind
packages/
  database/     Schéma Prisma, migrations et client
  shared/       Schémas Zod et types partagés entre l'API et le frontend
docs/           Architecture, développement, déploiement, journal de progression
```

Les workers (`worker-video`, `worker-ai`, `worker-publishing`, `worker-scheduler`) et les autres paquets prévus au cahier des charges sont créés dans la phase qui les rend réellement fonctionnels, pas avant.

## Documentation

- [Architecture et décisions](docs/architecture/overview.md)
- [Installation du poste de développement](docs/development/setup.md)
- [Hébergement gratuit pour la démo, sans VPS](docs/deployment/hebergement-gratuit.md)
- [Journal de progression](docs/PROGRESS.md)
