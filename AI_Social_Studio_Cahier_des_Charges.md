# AI SOCIAL STUDIO
## Cahier des charges fonctionnel et technique

**Version :** 1.0  
**Date :** 13 novembre 2026  
**Nature :** SaaS multi-utilisateur, multi-organisation et multi-marque  
**Objectif :** usage personnel et commercialisation  
**Statut :** document de référence pour Claude Code

---

# 1. Présentation générale

## 1.1 Vision

AI Social Studio est une plateforme SaaS de création, transformation, gestion et publication de contenus numériques assistée par intelligence artificielle.

Elle permet aux créateurs, entreprises, agences, community managers et professionnels de centraliser leur production et leur présence numérique dans une seule interface.

Deux moteurs principaux structurent le produit :

1. **AI Video Studio :** transformer des vidéos longues en contenus courts et adapter des vidéos complètes aux formats sociaux.
2. **AI Content & Publishing Studio :** générer des contenus à partir d'un prompt, les adapter aux réseaux et les publier ou programmer.

La plateforme doit permettre de passer d'une idée ou d'une vidéo source à une campagne multiréseaux depuis un espace de travail unique.

## 1.2 Objectifs

- Transformer des vidéos en Reels, Shorts et TikTok.
- Identifier les meilleurs passages d'une vidéo.
- Transcrire les voix et générer des sous-titres synchronisés.
- Générer des voix off et traductions.
- Produire des publications à partir d'un prompt.
- Générer des visuels publicitaires.
- Adapter les contenus à chaque réseau.
- Connecter plusieurs comptes, pages et marques.
- Publier immédiatement ou programmer.
- Proposer une validation humaine facultative.
- Mesurer les performances.
- Gérer plusieurs clients et équipes.
- Commercialiser le service avec abonnements et crédits.

## 1.3 Public cible

Créateurs de contenu, influenceurs, entrepreneurs, PME, grandes entreprises, agences, community managers, formateurs, organismes de formation et freelances.

## 1.4 Positionnement

AI Social Studio est un studio de production et de distribution de contenus assisté par IA, et non un simple planificateur de publications.

## 1.5 Décisions produit confirmées

| Dimension | Décision |
|---|---|
| Objectif | SaaS commercial + usage personnel |
| Transformation vidéo | Extraction de clips + conversion de vidéo complète |
| Publication | Automatique + validation humaine |
| Comptes | Plusieurs comptes, pages, marques et clients |
| Design | SaaS premium, moderne et professionnel |
| Plateformes | Web responsive, architecture extensible vers mobile |

---

# 2. Périmètre fonctionnel

## 2.1 Modules

| Module | Responsabilité |
|---|---|
| Dashboard | Vue d'ensemble et indicateurs |
| AI Video Studio | Import, analyse, montage et export vidéo |
| AI Content Studio | Génération de textes et campagnes par prompt |
| AI Image Studio | Création de visuels |
| AI Voice Studio | Voix off et traitement audio |
| Social Accounts | Connexion des comptes sociaux |
| Publishing Center | Publication et programmation |
| Content Calendar | Calendrier éditorial |
| Media Library | Bibliothèque de médias |
| Brand Kit | Identité visuelle et éditoriale |
| Templates | Modèles de contenus |
| Analytics | Statistiques et rapports |
| AI Assistant | Assistant conversationnel |
| Team Management | Équipes et permissions |
| Client Workspace | Espaces clients d'agence |
| Billing & Credits | Abonnements, paiements et crédits |
| Notifications | Alertes |
| Super Admin | Administration globale |

## 2.2 Profils et rôles

| Rôle | Permissions générales |
|---|---|
| Super Admin | Administration globale de la plateforme |
| Organization Owner | Contrôle complet de son organisation |
| Admin | Membres, paramètres et ressources |
| Manager | Gestion des contenus et publications |
| Editor | Création et modification |
| Publisher | Validation et publication |
| Analyst | Consultation des statistiques |
| Viewer | Consultation seule |
| Client | Validation des contenus de son agence |

Mettre en place un contrôle d'accès RBAC avec permissions granulaires. Un utilisateur peut appartenir à plusieurs organisations. Chaque requête doit vérifier l'organisation active et les permissions.

---

# 3. Authentification, organisations et onboarding

## 3.1 Authentification

- Inscription par e-mail et mot de passe.
- Connexion Google.
- Vérification de l'adresse e-mail.
- Réinitialisation du mot de passe.
- Gestion des sessions et déconnexion globale.
- Profil utilisateur.
- Export et suppression du compte.
- Protection contre les tentatives répétées.

Utiliser Supabase Auth ou une solution équivalente, intégrée proprement au backend NestJS. Le backend reste responsable de l'autorisation métier.

## 3.2 Multi-tenant

Structure logique :

`Utilisateur → Organisations → Marques / Clients → Comptes sociaux → Contenus → Publications`

Un utilisateur peut appartenir à plusieurs organisations. Les données commerciales et les ressources doivent être isolées par organisation.

## 3.3 Onboarding

1. Présentation du produit.
2. Choix du profil (créateur, entreprise, agence).
3. Création de l'organisation.
4. Création facultative d'une marque.
5. Configuration du Brand Kit.
6. Connexion facultative des réseaux.
7. Présentation guidée des modules.
8. Accès au dashboard.

L'utilisateur peut ignorer des étapes et les compléter plus tard.

---

# 4. Dashboard

Afficher :

- Comptes sociaux connectés.
- Publications effectuées et programmées.
- Publications en attente de validation.
- Vidéos en traitement.
- Vidéos générées.
- Crédits disponibles et consommation du mois.
- Engagement global.
- Évolution des performances.
- Activités récentes.
- Notifications et erreurs importantes.

Widgets : statistiques, graphiques, calendrier, contenus récents, tâches vidéo et état des connexions sociales.

Filtres : période, organisation, marque et réseau social. Les métriques affichées doivent provenir de données réelles, avec indication claire lorsqu'une donnée n'est pas disponible.

---

# 5. AI Video Studio

## 5.1 Sources vidéo

L'utilisateur peut :

- Importer un fichier depuis son appareil.
- Sélectionner un fichier de la Media Library.
- Coller un lien YouTube pour identifier le contenu et ses métadonnées autorisées.
- Utiliser ultérieurement des sources de stockage connectées et autorisées.

**Règle de conformité :** ne pas développer de téléchargement non autorisé de vidéos YouTube tierces. Pour le traitement, privilégier les fichiers importés par leur propriétaire ou les sources pour lesquelles l'utilisateur dispose des droits et d'un accès autorisé. Enregistrer la provenance et, si nécessaire, la déclaration de droits.

## 5.2 Deux modes de transformation

### Mode A — Extraction des meilleurs passages

L'IA analyse la transcription, les changements de sujet, les phrases marquantes, les moments forts, les scènes, les silences et la cohérence narrative.

Elle propose des clips avec :

- Titre et résumé.
- Début et fin horodatés.
- Durée.
- Transcription.
- Score de pertinence.
- Justification succincte.

Durées configurables : 15, 30, 45, 60, 90 secondes ou durée personnalisée. L'utilisateur peut sélectionner plusieurs clips et modifier les points de coupe.

### Mode B — Conversion de la vidéo complète

Conserver le contenu complet et l'adapter au format choisi :

- Recadrage intelligent.
- Détection et suivi du sujet ou du visage.
- Adaptation verticale 9:16.
- Gestion des plans larges.
- Flou d'arrière-plan ou bandes latérales si nécessaire.
- Conservation de l'audio original.
- Sous-titres automatiques.
- Suppression des silences en option.

La durée est conservée par défaut. Toute coupe ou suppression doit être explicitement activée.

## 5.3 Transcription

Intégrer un moteur Speech-to-Text (Whisper ou fournisseur interchangeable).

Fonctions :

- Détection de langue.
- Transcription horodatée.
- Identification des intervenants si disponible.
- Ponctuation et correction.
- Édition manuelle.
- Export TXT, SRT et VTT.

Langues prioritaires : français, anglais, espagnol, portugais, allemand, arabe et autres langues supportées par le fournisseur.

## 5.4 Sous-titres

Styles : professionnel, mots-clés colorés, karaoké, dynamique, minimaliste, créateur et podcast.

Personnalisation : police, taille, couleur, contour, ombre, position, fond, animation et nombre de mots par ligne.

L'utilisateur doit pouvoir modifier le texte et le timing dans l'éditeur.

## 5.5 Éditeur vidéo

Prévoir :

- Lecteur et timeline.
- Découpage et suppression de séquences.
- Modification des sous-titres.
- Ajout de texte, logo, musique et images.
- Réglage des volumes.
- Recadrage et zoom.
- Transitions simples.
- Prévisualisation.
- Sauvegarde du projet.

Les modifications doivent être non destructives : conserver la source et enregistrer une représentation des opérations d'édition.

## 5.6 Audio et voix off

- Extraction audio.
- Réduction de bruit.
- Normalisation du volume.
- Suppression des silences.
- Génération de voix off.
- Text-to-Speech.
- Choix de langue et de voix.
- Réglage de vitesse.
- Synchronisation avec les séquences.

Le clonage ou la reproduction d'une voix réelle exige le consentement et les droits nécessaires.

## 5.7 Traduction et doublage

- Traduction des sous-titres.
- Création d'une piste audio traduite.
- Voix off dans une autre langue.
- Adaptation des titres et descriptions.
- Conservation des noms propres.
- Export de versions linguistiques.

Le doublage avec synchronisation labiale est une fonctionnalité ultérieure, non requise pour le MVP.

## 5.8 Export

Formats : MP4 H.264 en priorité, H.265 si compatible, MOV en option, SRT et VTT.

Résolutions : 720p, 1080p et 4K selon les capacités de l'infrastructure.

Ratios : 9:16, 16:9, 1:1, 4:5 et personnalisé.

Préréglages : Instagram Reels, TikTok, YouTube Shorts, Facebook Reels, LinkedIn et format personnalisé.

L'export génère un fichier téléchargeable et réutilisable dans le Publishing Center.

---

# 6. AI Content Studio

## 6.1 Génération par prompt

L'utilisateur décrit son besoin en langage naturel. Exemple :

> Crée une publication professionnelle pour annoncer notre nouvelle formation en intelligence artificielle. Le ton doit être dynamique et accessible. Encourage les personnes intéressées à s'inscrire.

L'IA identifie l'objectif, le sujet, le public, le ton, le format, les réseaux ciblés et l'appel à l'action.

## 6.2 Types de contenus

Publications commerciales, annonces, promotions, présentations d'entreprise, citations, astuces, tutoriels, témoignages, lancements de produits, événements, offres spéciales, contenus éducatifs, scripts vidéo et carrousels.

## 6.3 Adaptation multiréseaux

Générer une variante distincte pour chaque plateforme sélectionnée :

- Facebook : texte détaillé et appel à l'action.
- Instagram : texte visuel, accroche et hashtags.
- LinkedIn : ton professionnel et informatif.
- TikTok : description courte et directe.
- YouTube : titre, description et hashtags.

Chaque variante est éditable indépendamment. Respecter les limites, formats et règles de chaque plateforme.

## 6.4 Assistant rédactionnel

Actions : reformuler, corriger, raccourcir, développer, changer le ton, ajouter un appel à l'action, proposer des hashtags, traduire et générer plusieurs variantes.

---

# 7. AI Image Studio

Générer des affiches, visuels publicitaires, publications, miniatures YouTube, bannières, stories, carrousels et illustrations.

Formats prédéfinis : 1:1, 4:5, 9:16, 16:9 et dimensions personnalisées.

Entrées possibles : logo, images de référence, palette de couleurs, texte à intégrer et consignes de composition.

Le système doit préserver les fichiers de logo originaux. Les textes générés dans les images doivent pouvoir être corrigés ou remplacés manuellement. Conserver les prompts, modèles et métadonnées de génération.

---

# 8. Brand Kit

Chaque organisation peut gérer plusieurs marques.

Une marque contient : nom, description, logo principal et secondaire, palette, polices, slogan, coordonnées, site web, réseaux sociaux, images de référence et instructions éditoriales.

L'IA utilise le Brand Kit sélectionné pour générer les contenus. Les règles de marque doivent rester modifiables et ne pas imposer d'éléments incompatibles avec les règles d'une plateforme.

---

# 9. Social Accounts et connecteurs

## 9.1 Plateformes prioritaires

1. Facebook Pages.
2. Instagram Professional.
3. TikTok.
4. YouTube.
5. LinkedIn.
6. Threads.
7. Pinterest.
8. X.
9. Telegram.

## 9.2 Données d'une connexion

- Plateforme et identifiant externe.
- Nom du compte et nom d'affichage.
- Avatar.
- Organisation et marque associées.
- Permissions accordées.
- État de connexion.
- Expiration du token.
- Date de dernière synchronisation.

## 9.3 Fonctions

Connecter, déconnecter, renouveler une autorisation, vérifier les permissions, synchroniser les informations, détecter les erreurs et guider la reconnexion.

Les tokens OAuth doivent être chiffrés au repos, masqués dans les logs et ne jamais être exposés au frontend.

## 9.4 Architecture des adaptateurs

Définir une interface commune, par exemple :

```typescript
interface SocialConnector {
  connect(): Promise<void>;
  refreshToken(): Promise<void>;
  getAccountInfo(): Promise<SocialAccountInfo>;
  getCapabilities(): Promise<PlatformCapabilities>;
  validatePost(post: SocialPost): Promise<ValidationResult>;
  publish(post: SocialPost): Promise<PublishResult>;
  getPublishStatus(id: string): Promise<PublishStatus>;
  getAnalytics(id: string): Promise<AnalyticsResult>;
  disconnect(): Promise<void>;
}
```

Chaque réseau possède son adaptateur. Les capacités doivent être déclarées par plateforme : formats, médias, limites, publication directe, brouillons, analytics et permissions.

Ne jamais supposer que toutes les plateformes proposent les mêmes opérations.

---

# 10. Publishing Center

## 10.1 Types de publications

Texte, image, galerie, vidéo, Reel, Short, carrousel et lien, selon les capacités de la plateforme.

## 10.2 Modes

**Publication automatique :** publier à la date programmée après validation des permissions et des prérequis.

**Publication avec validation :** le contenu attend l'approbation d'un responsable ou d'un client.

## 10.3 Workflow

`DRAFT → READY_FOR_REVIEW → PENDING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED`

États complémentaires : `REJECTED`, `CANCELLED`, `FAILED`, `EXPIRED`.

## 10.4 Fonctions

- Sélection de plusieurs comptes.
- Variante éditoriale par réseau.
- Prévisualisation.
- Modification des légendes et médias.
- Publication immédiate.
- Programmation.
- Duplication et réutilisation.
- Historique.
- Nouvelle tentative contrôlée après échec.

Si une plateforme ne permet pas une action, proposer une alternative clairement signalée : export, partage ou brouillon lorsque disponible. Ne jamais simuler une publication réussie.

---

# 11. Content Calendar

- Vue mensuelle, hebdomadaire et journalière.
- Vue liste.
- Filtres par réseau, marque et statut.
- Déplacement des publications par glisser-déposer.
- Création rapide.
- Duplication.
- Modification de date.
- Fuseau horaire configurable par organisation.

Le backend stocke les dates de manière cohérente (UTC) et applique le fuseau horaire de l'organisation pour l'affichage et la programmation.

---

# 12. Media Library

Types : images, vidéos, audios, logos, documents, projets et exports.

Fonctions : import, prévisualisation, recherche, filtres, dossiers, tags, favoris, suppression, versions, détection de doublons, métadonnées et gestion des droits.

Stocker les fichiers dans un stockage objet, jamais en BLOB dans PostgreSQL. Utiliser des URLs signées et temporaires pour les accès privés.

---

# 13. Analytics

Indicateurs possibles selon les permissions et données disponibles :

- Publications.
- Vues.
- Impressions.
- Portée.
- Likes.
- Commentaires.
- Partages.
- Enregistrements.
- Clics.
- Taux d'engagement.
- Évolution de l'audience si disponible.

Fonctions : comparaison des réseaux et publications, meilleurs contenus, rapports par marque et période, export CSV/PDF.

Ne jamais inventer ou extrapoler une métrique indisponible. Afficher sa provenance, sa date de synchronisation et son éventuelle indisponibilité.

---

# 14. Équipes et espaces clients

Une agence peut créer plusieurs espaces clients et leur attribuer des marques, comptes sociaux, contenus et collaborateurs.

Fonctions :

- Invitations par e-mail.
- Rôles et permissions par client.
- Assignation de tâches.
- Commentaires.
- Historique des modifications.
- Validation client.
- Dashboard par client.

Un client doit pouvoir approuver ou refuser les contenus qui le concernent sans accéder aux autres clients ni aux paramètres internes de l'agence.

---

# 15. Notifications

Notifications internes et e-mail pour :

- Publication réussie ou échouée.
- Demande de validation.
- Contenu approuvé ou refusé.
- Vidéo terminée.
- Export disponible.
- Connexion sociale expirée.
- Solde de crédits faible.
- Renouvellement ou échec de paiement.

Prévoir préférences par utilisateur, déduplication et journal des notifications.

---

# 16. Billing et monétisation

## 16.1 Offres

Plans configurables : Free, Starter, Pro, Business et Agency. Les prix, quotas et fonctionnalités ne doivent pas être codés en dur.

## 16.2 Consommation

Types de consommation : minutes vidéo, transcription, extraction de clips, génération de texte, image, voix et traduction.

Mettre en place un registre de crédits avec transactions immuables et traçables.

Règles :

1. Vérifier le solde et les limites avant traitement.
2. Réserver les crédits nécessaires.
3. Confirmer la consommation au succès.
4. Libérer ou rembourser selon les règles en cas d'échec.
5. Empêcher les doubles débits via idempotency keys.
6. Journaliser chaque mouvement.
7. Appliquer les limites du plan.

## 16.3 Paiements

Créer une couche de paiement abstraite. Étudier Stripe, PayPal et des prestataires Mobile Money compatibles avec le pays de facturation et les pays ciblés.

Gérer abonnements, factures, paiements, renouvellements, annulations, changements de plan, remboursements et webhooks de paiement.

---

# 17. Administration

Le Super Admin peut gérer utilisateurs, organisations, abonnements, plans, quotas, crédits, fournisseurs IA, consommations, traitements vidéo, erreurs de publication, signalements, journaux, intégrations, revenus et paramètres généraux.

Toute opération administrative sensible doit être auditée. Prévoir une séparation stricte entre administration de la plateforme et données privées des organisations.

---

# 18. Architecture technique

## 18.1 Choix technologiques

| Couche | Technologie recommandée |
|---|---|
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Backend | Node.js + NestJS |
| API | REST + OpenAPI |
| Base de données | PostgreSQL |
| ORM | Prisma |
| Auth | Supabase Auth ou équivalent |
| Stockage | Cloudflare R2 ou S3 compatible |
| Cache | Redis |
| Files de tâches | BullMQ |
| Vidéo | FFmpeg |
| Transcription | Whisper / fournisseur interchangeable |
| IA | Couche multi-fournisseurs |
| Temps réel | WebSocket / Supabase Realtime |
| Monitoring | Sentry + OpenTelemetry |
| Conteneurs | Docker |
| CI/CD | GitHub Actions |
| Monorepo | pnpm workspaces + Turborepo |

## 18.2 Architecture de déploiement

Commencer par un **monolithe modulaire** NestJS, accompagné de workers indépendants. Éviter les microservices prématurés. Les modules pourront être extraits lorsque le volume ou les besoins d'isolation le justifieront.

```text
UTILISATEURS
    |
REACT + TYPESCRIPT
    |
API REST / NESTJS
    |
    +---- Auth / RBAC / Organizations
    +---- Business modules
    +---- AI Orchestrator
    +---- Social Connectors
    +---- Billing / Credits
    |
    +---- PostgreSQL
    +---- Redis / BullMQ
    +---- Object Storage (R2/S3)
                 |
              WORKERS
                 |
      +----------+-----------+
      |          |           |
   VIDEO       AI TEXT    PUBLISHING
   WORKER      WORKER      WORKER
      |          |           |
    FFmpeg     LLM/API     Social APIs
```

## 18.3 Modules NestJS

```text
src/
├── auth/
├── users/
├── organizations/
├── memberships/
├── permissions/
├── brands/
├── social-accounts/
├── social-connectors/
├── publishing/
├── scheduling/
├── video-projects/
├── video-processing/
├── transcription/
├── subtitles/
├── ai-content/
├── ai-images/
├── ai-voices/
├── prompts/
├── media-library/
├── templates/
├── analytics/
├── notifications/
├── teams/
├── clients/
├── billing/
├── credits/
├── audit-logs/
├── webhooks/
├── admin/
└── common/
```

## 18.4 Workers

**Video Worker :** validation, extraction audio, transcription si assignée, découpage, recadrage, sous-titres, encodage et export.

**AI Worker :** génération de textes, adaptation multiréseaux, traduction, scripts et métadonnées.

**Media Worker :** compression, miniatures, conversion et vérification des formats.

**Publishing Worker :** contrôle des permissions, publication, vérification du statut, erreurs et nouvelles tentatives.

**Scheduler Worker :** recherche des publications dues et dispatch vers les workers de publication.

Les traitements lourds ne doivent jamais bloquer les requêtes HTTP.

---

# 19. Architecture de la base de données

PostgreSQL est la source de vérité. Les tables métier possèdent des UUID, timestamps, clés étrangères, contraintes et index adaptés. Les données sont isolées par organisation.

## 19.1 Tables principales

### Identité et organisations
- `users`
- `organizations`
- `memberships`
- `roles`
- `permissions`
- `role_permissions`
- `invitations`
- `sessions` (si nécessaire en complément du fournisseur d'authentification)

### Marques et comptes sociaux
- `brands`
- `brand_assets`
- `brand_guidelines`
- `social_accounts`
- `social_tokens`
- `social_permissions`
- `social_account_syncs`

### Vidéos
- `video_projects`
- `video_sources`
- `video_assets`
- `video_clips`
- `video_segments`
- `transcripts`
- `transcript_segments`
- `subtitles`
- `subtitle_styles`
- `video_edits`
- `render_jobs`
- `render_outputs`

### Contenus et publications
- `content_projects`
- `content_items`
- `content_variants`
- `content_media`
- `templates`
- `template_categories`
- `publications`
- `publication_targets`
- `publication_approvals`
- `publication_logs`
- `scheduled_jobs`

### Médias
- `media_assets`
- `media_folders`
- `media_tags`
- `media_asset_tags`
- `media_versions`

### IA et facturation
- `ai_providers`
- `ai_models`
- `ai_usage_logs`
- `ai_prompts`
- `credit_wallets`
- `credit_transactions`
- `plans`
- `subscriptions`
- `invoices`
- `payments`
- `billing_events`

### Collaboration et administration
- `clients`
- `team_tasks`
- `comments`
- `notifications`
- `audit_logs`
- `webhooks`
- `api_keys`
- `support_tickets`

## 19.2 Relations de haut niveau

```text
USERS -- MEMBERSHIPS -- ORGANIZATIONS
ORGANIZATIONS -- BRANDS
ORGANIZATIONS -- SOCIAL_ACCOUNTS
ORGANIZATIONS -- CLIENTS
BRANDS -- CONTENTS
CONTENTS -- MEDIA_ASSETS
VIDEO_PROJECTS -- VIDEO_CLIPS -- RENDER_JOBS
PUBLICATIONS -- PUBLICATION_TARGETS
ORGANIZATIONS -- SUBSCRIPTIONS
SUBSCRIPTIONS -- CREDIT_WALLETS -- CREDIT_TRANSACTIONS
```

## 19.3 Règles de données

- Isolation multi-tenant obligatoire.
- Clés étrangères et contraintes explicites.
- Index sur les colonnes filtrées et jointes fréquemment.
- Transactions SQL pour les opérations critiques.
- Soft delete lorsque pertinent.
- Journal des opérations sensibles.
- Pagination côté serveur.
- Migrations versionnées.
- RLS lorsque pertinente, en complément des contrôles backend.
- Vérification de l'organisation sur chaque opération sensible.
- Fichiers volumineux hors PostgreSQL.

Un schéma SQL détaillé devra être produit avant la phase de développement des modules métier, avec colonnes, types, nullabilité, index, contraintes, enums et règles de suppression.

---

# 20. API interne

Préfixe : `/api/v1`

Routes principales :

```text
/api/v1/auth
/api/v1/users
/api/v1/organizations
/api/v1/brands
/api/v1/social-accounts
/api/v1/video-projects
/api/v1/video-projects/:id/analyze
/api/v1/video-projects/:id/clips
/api/v1/video-projects/:id/render
/api/v1/ai/content/generate
/api/v1/ai/images/generate
/api/v1/ai/voice/generate
/api/v1/content
/api/v1/publications
/api/v1/publications/:id/approve
/api/v1/publications/:id/publish
/api/v1/calendar
/api/v1/media
/api/v1/analytics
/api/v1/billing
/api/v1/credits
/api/v1/notifications
```

Chaque endpoint doit documenter méthode, paramètres, schémas de validation, authentification, permissions, codes d'erreur, pagination et idempotence lorsqu'approprié. Générer une documentation OpenAPI.

---

# 21. Couche IA multi-fournisseurs

Ne pas coupler le produit à un seul fournisseur. Définir des interfaces communes :

```typescript
interface AIProvider {
  generateText(input: TextInput): Promise<TextOutput>;
  transcribe(input: AudioInput): Promise<TranscriptOutput>;
  analyzeMedia(input: MediaInput): Promise<AnalysisOutput>;
  generateImage(input: ImageInput): Promise<ImageOutput>;
  generateSpeech(input: SpeechInput): Promise<SpeechOutput>;
}
```

Fournisseurs envisageables : OpenAI, Google Gemini, Mistral et autres fournisseurs compatibles.

Prévoir routage par tâche, sélection de modèle, estimation et suivi des coûts, quotas, fallback, rate limiting, logs et gestion des erreurs.

Ne pas utiliser un LLM pour effectuer les opérations déterministes de montage vidéo. Le LLM analyse et propose ; FFmpeg exécute les opérations techniques.

---

# 22. Pipeline vidéo

```text
IMPORT AUTORISÉ
    |
VALIDATION DU FICHIER
    |
MÉTADONNÉES
    |
EXTRACTION AUDIO
    |
TRANSCRIPTION
    |
ANALYSE IA
    |
    +----------------------+
    |                      |
EXTRACTION CLIPS      CONVERSION COMPLÈTE
    |                      |
    +----------+-----------+
               |
        RECADRAGE / FORMAT
               |
          SOUS-TITRAGE
               |
          MONTAGE FINAL
               |
          ENCODAGE FFMPEG
               |
          STOCKAGE CLOUD
               |
          EXPORT / POST
```

## 22.1 Scoring des clips

Combiner analyse sémantique, changements de scène, silences, visages, activité audio et contexte.

Le score peut considérer : intérêt, autonomie du passage, qualité de l'accroche, cohérence narrative, qualité audiovisuelle et respect de la durée. Retourner des timestamps précis et une justification courte. L'utilisateur garde le contrôle final.

## 22.2 FFmpeg

Responsable du découpage, recadrage, encodage, extraction audio, normalisation, incrustation des sous-titres, ajout des pistes audio et miniatures.

## 22.3 Cycle de vie des tâches

États : `PENDING`, `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`, `RETRYING`.

Prévoir progression, logs, tentatives limitées, timeouts, reprise après interruption, nettoyage des fichiers temporaires, limites CPU/RAM et annulation.

---

# 23. UX/UI et design system

## 23.1 Direction artistique

SaaS premium, studio créatif et IA. Interface moderne, claire, hiérarchie forte, espaces généreux, typographie professionnelle, animations discrètes et composants cohérents.

Prévoir thème clair et sombre, responsive desktop/tablette/mobile et accessibilité clavier.

## 23.2 Navigation

```text
AI SOCIAL STUDIO

Workspace
  Dashboard

Create
  AI Video Studio
  AI Content Studio
  AI Image Studio
  AI Voice Studio

Manage
  Publications
  Calendar
  Media Library
  Templates
  Brand Kit

Social
  Connected Accounts
  Analytics

Workspace Settings
  Team
  Clients
  Billing
  Settings
```

## 23.3 Pages

Landing page, inscription, connexion, onboarding, dashboard, Video Studio, Video Editor, Content Studio, Image Studio, Social Accounts, Publishing Center, Calendar, Media Library, Brand Kit, Analytics, Team Management, Billing, User Settings et Super Admin.

Tous les écrans doivent comporter états de chargement, vide, erreur, succès et permissions insuffisantes.

---

# 24. Sécurité et conformité

## 24.1 Mesures de sécurité

- HTTPS obligatoire.
- OAuth 2.0 et validation stricte des callbacks.
- Chiffrement des tokens au repos.
- Secrets dans des variables sécurisées ou un secret manager.
- Protection CSRF/XSS.
- Validation des entrées.
- Protection contre les injections SQL.
- Rate limiting.
- Contrôle des fichiers et types MIME.
- Limites de taille et durée d'upload.
- Analyse antivirus si possible.
- Audit des opérations sensibles.
- Sauvegardes et tests de restauration.
- Gestion des sessions et révocation.

## 24.2 Protection des données

- Isolation des organisations.
- Export et suppression des données.
- Politique de conservation.
- Consentement pour les intégrations.
- Transparence sur l'usage de l'IA.
- Documentation des sous-traitants.
- Respect des règles applicables dans les pays ciblés.

## 24.3 Droits d'auteur et règles sociales

- Exiger les droits nécessaires sur les médias importés.
- Enregistrer la provenance.
- Conserver les preuves d'autorisation si nécessaire.
- Ne pas contourner les restrictions de téléchargement.
- Respecter les licences musicales.
- Permettre le signalement de contenus litigieux.
- Respecter les politiques, quotas et conditions des APIs sociales.

Une autorisation OAuth ne garantit pas toutes les permissions de publication. Les fonctionnalités disponibles dépendent du type de compte, des scopes, de la validation de l'application et des politiques en vigueur.

---

# 25. Performance et infrastructure

Objectifs initiaux :

- P95 inférieur à 500 ms pour les endpoints API classiques, hors dépendances externes.
- Pagination côté serveur.
- Chargement différé des médias.
- Cache Redis.
- CDN pour les médias publics.
- URLs signées pour les fichiers privés.
- Indexation et optimisation SQL.
- Workers horizontaux.
- Limitation de concurrence.
- Monitoring CPU, RAM, stockage, GPU et files de tâches.

Séparer logiquement et, en production, autant que nécessaire :

1. Frontend.
2. API.
3. PostgreSQL et Redis managés.
4. Workers vidéo.
5. Workers IA.
6. Stockage objet.

Les temps de traitement vidéo dépendent de la durée, résolution, codec et ressources disponibles. Ne pas promettre de délai fixe sans mesure.

---

# 26. Tests et qualité

## Tests unitaires

Authentification, permissions, calcul des crédits, validation des contenus, connecteurs et transitions de statut.

## Tests d'intégration

OAuth, upload, transcription, rendu vidéo, publication, webhooks et facturation.

## Tests E2E

1. Inscription.
2. Création d'organisation.
3. Création d'une marque.
4. Connexion d'un réseau.
5. Import vidéo.
6. Transcription et extraction de clips.
7. Export.
8. Création d'un contenu par prompt.
9. Validation.
10. Programmation et publication.
11. Consultation des statistiques.

## Tests de sécurité

Accès inter-organisations, permissions, tokens expirés, upload malveillant, abus de quotas, webhooks frauduleux et tentatives de double débit.

Aucune fonctionnalité n'est terminée sans tests correspondants.

---

# 27. Plan de développement

## Phase 0 — Préparation technique

- Initialisation Git et monorepo.
- Docker et environnements.
- PostgreSQL et Redis.
- CI/CD.
- Design system.
- Documentation initiale.

**Livrable :** socle technique exécutable.

## Phase 1 — Fondations SaaS

- Authentification.
- Organisations et membres.
- Permissions.
- Marques.
- Dashboard.
- Media Library de base.
- Administration initiale.

**Livrable :** application multi-tenant fonctionnelle.

## Phase 2 — Connexions sociales

- OAuth.
- Meta (Facebook/Instagram).
- TikTok.
- YouTube.
- LinkedIn.
- Gestion des tokens et permissions.
- Adaptateurs et tests.

**Livrable :** comptes sociaux connectables et capacités identifiées.

## Phase 3 — AI Video Studio

- Upload autorisé.
- Métadonnées.
- Extraction audio.
- Transcription.
- Analyse et sélection des clips.
- Conversion verticale.
- Sous-titres.
- Rendu FFmpeg.
- Export.

**Livrable :** pipeline vidéo complet.

## Phase 4 — AI Content Studio

- Prompt.
- Assistant rédactionnel.
- Variantes par plateforme.
- Hashtags.
- Génération d'images.
- Brand Kit.
- Templates.

**Livrable :** moteur de création de contenus.

## Phase 5 — Publishing Center

- Prévisualisation.
- Publication manuelle.
- Programmation.
- Publication automatique lorsque autorisée.
- Workflow de validation.
- Calendrier.
- Historique et gestion des erreurs.

**Livrable :** distribution multiréseaux opérationnelle.

## Phase 6 — Analytics et collaboration

- Statistiques.
- Équipes.
- Clients.
- Commentaires.
- Approbations.
- Rapports.

**Livrable :** plateforme collaborative.

## Phase 7 — Monétisation

- Plans.
- Abonnements.
- Crédits.
- Paiements.
- Facturation.
- Quotas.
- Administration commerciale.

**Livrable :** SaaS commercialisable.

## Phase 8 — Optimisation et lancement

- Tests de charge.
- Audit de sécurité.
- Optimisation des coûts IA.
- Monitoring.
- Documentation utilisateur.
- Landing page.
- Déploiement production.

**Livrable :** version de lancement.

---

# 28. Organisation du dépôt

Monorepo recommandé :

```text
ai-social-studio/
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker-video/
│   ├── worker-ai/
│   ├── worker-publishing/
│   └── worker-scheduler/
├── packages/
│   ├── database/
│   ├── shared/
│   ├── ui/
│   ├── types/
│   ├── validation/
│   ├── ai-providers/
│   ├── social-connectors/
│   ├── video-engine/
│   └── config/
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   └── deployment/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   ├── security/
│   └── development/
├── scripts/
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```

Utiliser pnpm workspaces et Turborepo. Mettre en place lint, format, tests, typecheck et build dans la CI.

---

# 29. Livrables attendus

1. Frontend complet.
2. Backend API documenté.
3. Schéma PostgreSQL et migrations.
4. Workers de traitement.
5. Moteur vidéo.
6. Orchestrateur IA.
7. Connecteurs sociaux.
8. Centre de publication.
9. Gestion multi-organisation.
10. Administration.
11. Abonnements et crédits.
12. Documentation technique.
13. Documentation de déploiement.
14. Tests automatisés.
15. Docker et CI/CD.
16. Documentation utilisateur.

---

# 30. Scénarios d'acceptation

## Scénario A — Transformer une vidéo

1. L'utilisateur importe une vidéo dont il détient les droits.
2. Le système valide le fichier.
3. Le système extrait l'audio.
4. L'IA transcrit et analyse.
5. L'IA propose les meilleurs passages.
6. L'utilisateur choisit les extraits ou le mode vidéo complète.
7. Le moteur génère les formats verticaux.
8. Les sous-titres sont éditables et intégrés.
9. L'utilisateur prévisualise.
10. L'utilisateur exporte le résultat.

## Scénario B — Créer une campagne par prompt

1. L'utilisateur saisit un prompt.
2. Il sélectionne une marque.
3. Il choisit les réseaux.
4. L'IA génère les textes.
5. Les visuels sont générés si demandés.
6. Les variantes sont adaptées par réseau.
7. L'utilisateur prévisualise et modifie.
8. Il valide ou demande une approbation.
9. Les publications sont programmées ou publiées selon les permissions.

## Scénario C — Gérer plusieurs clients

1. Une agence crée plusieurs espaces clients.
2. Elle attribue des marques.
3. Elle connecte les réseaux correspondants.
4. Les collaborateurs créent les contenus.
5. Les clients valident leurs publications.
6. L'agence suit les résultats sans fuite de données entre clients.

## Scénario D — Gestion commerciale

1. L'utilisateur choisit une offre.
2. Il souscrit.
3. Les crédits sont attribués.
4. Les opérations consomment les crédits.
5. Les transactions sont historisées.
6. Le renouvellement est géré.
7. Les factures sont consultables.

---

# 31. Directives obligatoires pour Claude Code

Ces règles doivent être respectées pendant tout le développement.

1. Lire ce cahier des charges avant de modifier le projet.
2. Commencer par auditer le dépôt existant avant toute initialisation ou réécriture.
3. Ne pas développer toutes les fonctionnalités dans un seul module monolithique.
4. Ne pas coder les tarifs, quotas ou fournisseurs en dur.
5. Ne jamais exposer les tokens sociaux.
6. Ne jamais contourner les APIs officielles.
7. Ne jamais mélanger les données de plusieurs organisations.
8. Ne jamais traiter les vidéos lourdes dans les requêtes HTTP.
9. Utiliser des files d'attente pour les traitements longs.
10. Utiliser des interfaces communes pour les fournisseurs IA et sociaux.
11. Ajouter des tests aux fonctionnalités critiques.
12. Documenter chaque intégration externe.
13. Préserver la compatibilité des migrations.
14. Utiliser des composants UI réutilisables.
15. Prévoir les états de chargement, vide, erreur et succès.
16. Ne jamais présenter une fonctionnalité comme opérationnelle si elle n'est pas intégrée.
17. Vérifier les permissions avant chaque opération.
18. Respecter les droits d'auteur et les conditions des plateformes.
19. Livrer une fonctionnalité complète avant de passer à la suivante.
20. Ne pas supprimer ou remplacer des fonctionnalités existantes sans justification et validation.
21. Ne jamais committer de secrets ou fichiers `.env` réels.
22. Mettre à jour la documentation et le journal de progression à chaque phase.

## Règle de développement

Chaque phase doit être validée avant de passer à la suivante. Aucun faux bouton, aucune donnée fictive présentée comme réelle et aucune intégration simulée ne sont considérés comme terminés.

À la fin de chaque phase, fournir :

- Résumé des travaux.
- Fichiers créés ou modifiés.
- Décisions techniques.
- Migrations exécutées.
- Tests lancés et résultats.
- Fonctionnalités réellement opérationnelles.
- Limites et blocages.
- Prochaine étape recommandée.

---

# 32. Prompt de démarrage à fournir à Claude Code

Tu es l'architecte logiciel et développeur principal chargé de construire AI Social Studio à partir de ce cahier des charges.

Ta mission est de livrer une application SaaS robuste, sécurisée, multi-tenant, maintenable et réellement fonctionnelle.

Avant de coder :

1. Analyse le dépôt et l'environnement existants.
2. Lis intégralement ce cahier des charges.
3. Identifie les décisions déjà prises et les points techniques à confirmer.
4. Propose une architecture détaillée et un plan d'exécution par petites tâches.
5. Identifie les intégrations nécessitant des clés API, comptes développeur, validations ou autorisations.
6. Ne simule jamais une intégration réelle.

Commence par la Phase 0 uniquement. Mets en place le monorepo, les conventions, les environnements, Docker, PostgreSQL, Redis, la CI et la documentation initiale.

Ne passe pas automatiquement à la phase suivante sans présenter le résultat, les tests et les éventuels blocages.

Pour chaque fonctionnalité, développe le frontend, le backend, la base de données, les permissions, les validations, les états d'erreur et les tests nécessaires.

Respecte strictement l'isolation multi-tenant, la sécurité des tokens, les conditions des APIs sociales et les droits sur les médias.

Le résultat attendu est un véritable produit opérationnel, pas une simple maquette.

---

# 33. Principe directeur

**Une idée, plusieurs contenus, plusieurs réseaux, un seul espace de travail.**

AI Social Studio doit réunir trois capacités :

- **Créer :** produire textes, images, voix et vidéos avec l'IA.
- **Transformer :** adapter les contenus aux formats et plateformes.
- **Distribuer :** gérer, programmer et publier sur plusieurs réseaux sociaux.

L'ambition est de permettre à un utilisateur de passer d'une idée ou d'une vidéo source à une campagne de communication complète, sans quitter la plateforme.
