# Architecture et décisions

Ce document complète le cahier des charges : il consigne ce qui est réellement en place, les décisions prises en Phase 0 et les points encore ouverts.

## Vue d'ensemble

```text
Navigateur
   │
apps/web  (React + Vite, hébergement statique)
   │  HTTPS, /api/v1
apps/api  (NestJS, monolithe modulaire)
   ├── PostgreSQL   source de vérité (Prisma)
   ├── Redis        files BullMQ et cache
   └── Stockage objet (R2 / S3)        ← à partir de la Phase 1
            │
         Workers (vidéo, IA, publication, planification)   ← à partir de la Phase 3
```

Les workers ne reçoivent aucune connexion entrante : ils lisent leurs tâches dans Redis et écrivent dans PostgreSQL et le stockage objet. Ils peuvent donc tourner n'importe où, y compris sur un simple ordinateur, ce qui rend la démo possible sans VPS.

## Décisions prises en Phase 0

| Sujet              | Décision                                                      | Raison                                                                           |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Format des modules | ES modules dans tout le monorepo                              | NestJS 12 et Prisma 7 sont publiés en ESM                                        |
| Tests              | Vitest partout                                                | Compatible ESM sans configuration ; un seul outil pour l'API et le frontend      |
| Injection NestJS   | `@Inject()` explicite                                         | Indépendant des métadonnées de décorateurs, donc du compilateur                  |
| TypeScript         | 6.x                                                           | La 7 (réécriture native) n'est pas encore supportée par typescript-eslint        |
| Infra locale       | Services managés par défaut, Docker optionnel                 | Poste de développement sans Docker, aucun VPS                                    |
| Configuration      | Validée par Zod au démarrage                                  | L'API refuse de démarrer en production sans base ni Redis, avec un message clair |
| Santé              | `GET /api/v1/health` répond 200 et détaille chaque dépendance | Sert de sonde aux hébergeurs sans masquer une panne                              |
| Contrats d'API     | Schémas Zod dans `@ass/shared`                                | Une seule définition, validée des deux côtés                                     |
| Paquets vides      | Aucun                                                         | Un paquet est créé dans la phase qui le rend fonctionnel                         |

## Points à confirmer avant la Phase 1

1. **Authentification.** Recommandation : Supabase Auth (e-mail, Google, vérification, réinitialisation), le backend NestJS vérifiant les JWT et portant toute l'autorisation métier. Alternative : Neon Auth, pour n'avoir qu'un seul fournisseur avec la base.
2. **Base de données.** Recommandation : Neon. Alternative : la base PostgreSQL de Supabase, si l'on veut regrouper l'authentification et les données.
3. **Stockage objet.** Recommandation : Cloudflare R2 (10 Go gratuits, pas de frais de sortie), qui demande une carte bancaire à l'inscription. Sans carte : Supabase Storage, limité à 50 Mo par fichier sur l'offre gratuite, donc insuffisant pour de longues vidéos.
4. **Langue de l'interface.** Le cahier des charges nomme les menus en anglais et est rédigé en français. Français seul, ou français et anglais dès le départ ?
5. **Fournisseurs IA de départ.** Voir le tableau ci-dessous ; la couche multi-fournisseurs permet d'en changer ensuite.
6. **Paiement.** Stripe ne couvre pas tous les pays de facturation. Pour le Mobile Money en Afrique de l'Ouest, FedaPay, KKiaPay et CinetPay sont à étudier en Phase 7.

## Intégrations qui exigent des comptes, des clés ou une validation

Aucune de ces intégrations ne sera simulée. Les délais de validation sont longs : les demandes sont à déposer bien avant la Phase 2.

| Intégration                      | Ce qu'il faut                                                                          | Contrainte à connaître                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Connexion Google                 | Projet Google Cloud, écran de consentement OAuth                                       | Simple, sans validation pour les scopes de base                                          |
| Meta (Facebook Pages, Instagram) | Application Meta, vérification d'entreprise, App Review des permissions de publication | Sans App Review, seuls les comptes déclarés testeurs peuvent publier                     |
| TikTok                           | Application TikTok for Developers, Content Posting API                                 | Tant que l'application n'est pas auditée, les publications restent privées               |
| YouTube                          | Projet Google Cloud, YouTube Data API v3                                               | Quota quotidien faible ; sans audit de l'API, les vidéos envoyées restent privées        |
| LinkedIn                         | Application LinkedIn                                                                   | Profil personnel accessible en libre-service ; pages d'entreprise soumises à approbation |
| Threads, Pinterest               | Application développeur par plateforme                                                 | Validation propre à chaque plateforme                                                    |
| X                                | Abonnement API payant                                                                  | Pas d'accès gratuit exploitable pour la publication                                      |
| Telegram                         | Bot créé avec BotFather                                                                | Gratuit et immédiat : bon premier connecteur                                             |
| Transcription                    | Clé d'un fournisseur Whisper (Groq, OpenAI…)                                           | Les offres gratuites ont des limites de débit                                            |
| Texte, image, voix               | Clés des fournisseurs retenus (Gemini, Mistral, OpenAI…)                               | Les offres gratuites ne couvrent pas un usage commercial                                 |
| E-mails                          | Compte Resend ou Brevo, domaine vérifié                                                | Un domaine est nécessaire pour une bonne délivrabilité                                   |
| Paiement                         | Compte marchand, clés de test puis de production                                       | Dépend du pays de facturation                                                            |
| Monitoring                       | Projet Sentry                                                                          | Offre gratuite suffisante pour démarrer                                                  |

Les callbacks OAuth exigent une URL HTTPS publique et stable. Sans VPS, c'est l'URL de l'API hébergée gratuitement, ou un tunnel Cloudflare vers le poste de développement.
