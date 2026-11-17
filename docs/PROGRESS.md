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

Phase 5 — AI Content Studio (voir ci-dessous).

---

## Phase 5 — AI Content Studio (15 novembre 2026)

**Statut : TERMINÉE.**

- Génération par prompt avec extraction du sujet, de l'objectif et du public (§6.1) ; 14 types de contenus et 6 tons (§6.2).
- Une variante par plateforme, calibrée sur les limites réelles des 8 réseaux (§6.3), avec compteur de caractères incluant les hashtags et avertissements de dépassement.
- Assistant rédactionnel à neuf actions (§6.4), dont la traduction qui crée la version FR ou EN côte à côte.
- Modèles `ContentProject` et `ContentVariant` (avec `language`), migrations `20261115210000_phase5_content_studio` et `20261115211000_phase5_variant_language` appliquées sur Neon.
- Interface : page « AI Content Studio » (brief, type, ton, langue, marque, réseaux, variantes éditables, assistant, copie), compteur « Contenus générés » sur le tableau de bord.
- Qualité : 70 tests unitaires (dont 30 sur le Content Studio), `pnpm test:phase5` (77 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE5.md](PHASE5.md).

### Prochaine étape

Phase 6 — Publishing Center et calendrier (voir ci-dessous).

---

## Phase 6 — Publishing Center et Content Calendar (15 novembre 2026)

**Statut : TERMINÉE.**

- Circuit de validation complet §10.3 (`DRAFT → READY_FOR_REVIEW → PENDING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED`) plus `REJECTED`, `CANCELLED`, `FAILED`, `EXPIRED`. Une route par transition, table de transitions partagée par l'API, l'interface et les tests.
- Modes `AUTO` (validation automatique tracée) et `APPROVAL` (approbation par un ADMIN, refus motivé obligatoire).
- Huit formats de publication (§10.1) et capacités réelles par plateforme : formats acceptés, médias obligatoires, plafonds. Une cible invalide bloque la soumission avec un message explicite.
- Publication honnête : sans identifiant OAuth, `publish()` échoue avec `NOT_CONFIGURED` plutôt que de simuler un succès. Replis proposés (export, publication manuelle), export copiable, et confirmation par URL externe obligatoire.
- Programmation avec réclamation atomique (`updateMany` conditionnel), boucle interne toutes les 60 s, expiration à 7 jours, relance bornée à 3 tentatives.
- Content Calendar §11 : vues mois, semaine, jour et liste, filtres réseau/marque/statut, glisser-déposer, création rapide, duplication.
- Fuseau horaire par organisation (`Organization.timezone`), validation contre `Intl`, dates stockées en UTC et regroupement au fuseau de l'organisation.
- Modèles `Publication`, `PublicationTarget`, `PublicationEvent` ; migration `20261115220000_phase6_publishing` appliquée sur Neon.
- Interface : pages « Centre de publication » et « Calendrier éditorial », compteurs « Publications » et « Programmées » sur le tableau de bord.
- Qualité : 115 tests unitaires (dont 43 sur la publication), `pnpm test:phase6` (106 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE6.md](PHASE6.md).

### Prochaine étape

Phase 7 — AI Image Studio et Brand Kit (§7, §8), ou branchement d'un transport de publication réel (`PUBLISH_WEBHOOK_URL` ou adaptateurs OAuth).

---

## Phase 7 — AI Image Studio et Brand Kit (15 novembre 2026)

**Statut : TERMINÉE.**

- Composeur SVG déterministe (§7) : un vrai visuel vectoriel, reproductible à partir d'une graine, dont chaque texte reste un calque `<text>` éditable — la correction ne demande pas de régénérer l'image.
- Quatre formats normalisés (Carré 1080×1080, Portrait 4:5, Story 9:16, Paysage 16:9) plus un format personnalisé borné à 256–4096 px, et quatre styles (Éditorial, Affirmé, Minimal, Dégradé).
- Quatre calques de texte (titre, sous-titre, bouton, pastille), palette de 8 couleurs, logo référencé par identifiant de média, image de référence en fond voilé.
- Avertissements explicites au lieu de rendus silencieusement dégradés : contraste limite, logo absent, titre ou sous-titre tronqué, média sans URL exploitable.
- Refus explicite d'un format incompatible avec la plateforme visée (`400` et liste des formats acceptés), application du §8 « ne pas imposer d'éléments incompatibles ».
- Brand Kit complet (§8) : logos principal et secondaire, palette, polices de titre et de texte, slogan, site, e-mail, téléphone, 8 liens sociaux, 12 images de référence, consignes éditoriales. Mise à jour partielle où `null` vide un champ, corps vide refusé, propriété des médias vérifiée.
- Échappement XML systématique ; un titre contenant `<script>` est rendu inerte dans le SVG.
- Interface : page « AI Image Studio » (brief, aperçu en direct, correction des textes, nouveau décor, téléchargement, galerie), page « Marques et Brand Kit » refondue, compteur « Visuels générés » sur le tableau de bord.
- Modèle `ImageProject` et extension de `Brand` ; migration `20261115230000_phase7_image_brandkit` appliquée sur Neon (8 migrations au total).
- Qualité : 172 tests unitaires (dont 57 nouveaux sur le composeur et les formats), `pnpm test:phase7` (87 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE7.md](PHASE7.md).

### Prochaine étape

Export PNG des visuels (moteur raster) et branchement d'un transport de publication réel — ou ouverture des phases restantes du cahier des charges (analytics, collaboration temps réel).

---

## Phase 8 — Déclinaison multi-formats et export PNG (15 novembre 2026)

**Statut : TERMINÉE.**

- Déclinaison (§7) : `POST /image-projects/{id}/decline` produit la même composition dans plusieurs gabarits. Les calques de texte, la palette, la marque, le style et la graine sont repris ; seul le gabarit change et le composeur réajuste la typographie. Rien n'est étiré ni rogné.
- Chaque déclinaison est un visuel autonome (SVG, avertissements propres) rattaché à son origine par `sourceProjectId`.
- Règle de déclinaison extraite dans `planDecline`, **fonction pure** partagée par l'API et l'UI : format identique et `CUSTOM` ignorés avec motif, doublons dédupliqués, plateforme conservée si compatible et **retirée avec avertissement** sinon, plutôt qu'un échec global.
- Export PNG **dans le navigateur** (canvas) : typographie identique à l'aperçu, aucune dépendance native, échelles 1× et 2×. Les logos et photos distantes sont intégrés en `data:` URI au préalable ; un CDN qui refuse la requête déclenche un avertissement nommé au lieu d'un PNG amputé en silence.
- Interface : boutons PNG / PNG ×2, panneau « Décliner dans d'autres formats » avec compte-rendu des formats produits et ignorés, marquage des déclinaisons dans la galerie.
- Modèle : `ImageProject.sourceProjectId` (auto-relation, `onDelete: SetNull`) ; migration `20261115240000_phase8_image_variants` appliquée sur Neon (9 migrations au total).
- Qualité : 187 tests unitaires (15 nouveaux sur la déclinaison), `pnpm test:phase8` (65 vérifications E2E), `pnpm verify:png` (13 contrôles dans Chrome headless sur le module réel), lint/typecheck/build/format verts.

Détail : [PHASE8.md](PHASE8.md).

### Prochaine étape

Export PNG côté serveur pour l'envoi automatisé, ou branchement d'un transport de publication réel (`PUBLISH_WEBHOOK_URL` ou adaptateurs OAuth).

---

## Phase 9 — Connexion des comptes sociaux (15 novembre 2026)

**Statut : TERMINÉE.**

- Cycle de vie OAuth complet (§9.1) : `POST /social-accounts/connect` construit l'URL d'autorisation du fournisseur, `GET /social-accounts/oauth/callback` (public, protégé par l'état signé) échange le code, lit le profil et enregistre les jetons chiffrés en AES-256-GCM. `POST /:id/refresh` renouvelle, `POST /:id/sync` relit le profil, `GET /health` expose l'état des connexions.
- État OAuth sans table de session : signature HMAC-SHA256 comparée en temps constant, expiration à 10 minutes, **vérificateur PKCE chiffré** (il transite par le navigateur), type de plateforme revalidé à la lecture.
- PKCE S256 conforme au RFC 7636 (vérifié contre le vecteur de test de l'annexe B), ajouté **uniquement** pour les plateformes qui l'exigent (LinkedIn, X, TikTok, Google) — `code_challenge_method` sans défi casserait Meta.
- Registre des points d'entrée réels par fournisseur (autorisation, jeton, profil, documentation officielle) et permissions demandées par réseau.
- Lecture des profils pilotée par des chemins déclarés (Facebook, Instagram, Threads, LinkedIn, X, TikTok, YouTube, Pinterest) ; un profil sans identifiant externe est refusé plutôt que rattaché au hasard.
- Détection d'erreur (§9.3) : une synchronisation en échec **n'est pas une exception**, elle enregistre `status: ERROR`, `lastError`, `lastErrorAt` et se renvoie avec le compte ; six états distingués (`REVOKED`, `NO_TOKEN`, `EXPIRED`, `ERROR`, `EXPIRING`, `OK`) avec marche à suivre. Le renouvellement ne remplace jamais un jeton de rafraîchissement par une absence.
- Interface commune des adaptateurs (§9.4) complétée : `connect`, `refreshToken`, `getAccountInfo`, `getCapabilities`, `validatePost`, `publish`, `getPublishStatus`, `getAnalytics`, `disconnect`. `getCapabilities` et `validatePost` sont réels ; les opérations hors de portée répondent `NOT_SUPPORTED` avec la route qui les fait vraiment, plutôt qu'un succès creux. La validation est désormais portée par l'adaptateur : l'envoi ne part plus avec une cible que la plateforme refuserait.
- `/publications/readiness` expose les capacités **par plateforme** : formats acceptés, envoi possible, repli, variables manquantes.
- Interface : état de chaque connexion avec compte à rebours lisible, permissions accordées, dernière panne datée, variables bloquantes, boutons Ouvrir / Reconnecter / Renouveler / Synchroniser / Déconnecter, tableau des huit plateformes, connexion manuelle repliée en second recours.
- Modèle : `SocialAccount.lastError` / `lastErrorAt` ; migration `20261115250000_phase9_connection_health` appliquée sur Neon (10 migrations au total).
- Qualité : 266 tests unitaires (79 nouveaux : 37 sur les briques OAuth pures, 27 sur le service avec transport simulé, 15 sur les adaptateurs), `pnpm test:phase9` (57 vérifications E2E), lint/typecheck/build/format verts.

**Ce qui manque n'est pas du code, ce sont des identifiants.** Sans applications OAuth créées chez les fournisseurs, `connect` refuse avec la liste exacte des variables à renseigner — jamais de connexion simulée.

Détail : [PHASE9.md](PHASE9.md).

### Prochaine étape

Créer les applications OAuth (Meta, LinkedIn, X, TikTok, Google, Pinterest), renseigner les douze variables, passer les revues de plateforme, puis écrire les adaptateurs d'envoi natifs — les jetons obtenus par ce flux sont précisément ce qu'il faut pour brancher `publish()` sur les API réelles.

---

## Phase 10 — Analytics (§13)

**Statut : TERMINÉE.**

- Règle du §13 appliquée de bout en bout : **aucune métrique n'est inventée**. `null` reste `null` dans l'API, le contrat partagé, le CSV et l'interface ; `0` signifie « mesuré à zéro ». Les deux ne sont jamais confondus.
- Agrégation honnête : `sumMetrics` renvoie `{ value, contributors }` par métrique, donc un total de 1 200 vues alimenté par 3 mesures sur 12 s'affiche avec sa couverture, pas comme un total complet.
- Taux d'engagement conditionnel : les quatre composantes (likes, commentaires, partages, enregistrements) et un dénominateur d'audience sont exigés. Sinon `value: null` **et** le motif exact de l'indisponibilité. Le dénominateur utilisé (`impressions` ou `reach`) est nommé.
- Correction de justesse en cours de phase : `pooledEngagement` calcule uniquement sur les mesures **complètes** et expose `basedOn`. Additionner toutes les mesures avant de diviser gonflait le dénominateur avec des numérateurs partiels et faisait baisser le taux sans raison.
- Calcul en rapport de sommes, jamais en moyenne de taux — sinon une publication vue 10 fois pèserait autant qu'une vue 10 000 fois.
- Une seule mesure par cible retenue (compteurs cumulatifs) : `latestByTarget` garde la plus récente de la période, départage par date d'enregistrement, et l'explique dans les notes.
- Portée exposée mais signalée comme non dédupliquée ; audience (abonnés) déclarée indisponible avec son motif plutôt qu'estimée.
- `POST /analytics/collect` interroge les adaptateurs et rend `{ attempted, collected, skipped }` : sans identifiants natifs, `collected: 0` et un motif par cible. Aucun chiffre fabriqué.
- Export CSV (une ligne par mesure, séparateur `;`, BOM UTF-8, en-têtes français) : une métrique absente laisse une cellule vide, jamais `0`.
- Interface : page « Analytics » avec période/marque/classement, cartes de synthèse, carte « Limites de ces chiffres », comparaison par réseau avec couverture en infobulle, meilleurs contenus avec provenance et date de relevé, saisie et historique, collecte, export.
- Modèle `PublicationMetric` (`MANUAL` / `PLATFORM_API` / `WEBHOOK`, `collectedAt` + `syncedAt`) ; migration `20261115260000_phase10_publication_metrics` appliquée sur Neon (11 migrations au total).
- Qualité : 301 tests unitaires (35 sur analytics), `pnpm test:phase10` (97 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE10.md](PHASE10.md).

### Prochaine étape

Collaboration temps réel (commentaires, présence) et notifications — les autres volets de la Phase 6 du cahier des charges ; la collecte automatique des statistiques s'activera d'elle-même dès que les applications OAuth de la Phase 9 auront leurs identifiants.

---

## Phase 11 — Notifications (§15)

**Statut : TERMINÉE.**

- Dix événements du §15 modélisés, **six réellement émis**. Les quatre autres (vidéo terminée, export disponible, solde de crédits, échec de paiement) dépendent de sous-systèmes inexistants et sont déclarés non disponibles **avec leur motif** dans `GET /notifications/catalog` — jamais une notification creuse.
- Émission branchée sur `apply()`, le passage obligé de toute transition d'état : aucune notification ne peut être oubliée, et aucune ne peut annuler la transition qu'elle annonce (le service ne lève jamais).
- Destinataires : responsables pour une demande de validation, auteur du contenu sinon ; l'auteur de l'action n'est jamais destinataire de son propre geste ; un auteur sorti de l'espace bascule vers les responsables.
- Déduplication par clé stable, sans horodatage : deux échecs de la même publication se cumulent sur une ligne avec compteur, et la remettent en non-lue. Index unique protégé contre les courses.
- Canal e-mail à quatre états : `NOT_REQUESTED`, `NO_PROVIDER`, `SENT`, `FAILED`. Sans transport, le statut est `NO_PROVIDER` avec le motif — jamais `SENT`. Transport injectable (`MAIL_TRANSPORT`), inerte par défaut.
- Préférences par utilisateur et par type, valeurs par défaut comprises. Seules les lignes réellement modifiées sont écrites : un réglage non exprimé n'est pas figé. Interne actif et e-mail coupé par défaut, puisque rien ne peut partir.
- Routes personnelles (aucun rôle requis, mais on ne voit que les siennes) ; une notification d'autrui ou d'une autre organisation renvoie `404`.
- Interface : pastille de compteur rafraîchie toutes les 45 s, boîte de réception filtrable, statut e-mail en infobulle, grille de préférences, catalogue honnête des événements.
- Modèles `Notification` et `NotificationPreference` ; migrations `20261116070000_phase11_notifications` et `20261116071000_phase11_notification_channel` appliquées sur Neon (13 migrations au total).
- Qualité : 347 tests unitaires (46 nouveaux sur les notifications), `pnpm test:phase11` (86 vérifications E2E), lint/typecheck/build/format verts.

Détail : [PHASE11.md](PHASE11.md).

### Prochaine étape

Collaboration (§14) : commentaires, assignation de tâches, historique des modifications exposé et validation client — puis branchement d'un transport e-mail réel quand un fournisseur transactionnel sera choisi.

---

## Phase 12 — Collaboration (§14)

**Statut : TERMINÉE.**

- Le §14 est traité comme une **règle de visibilité**, pas comme un rôle de plus : un commentaire interne reste interne, y compris pour un client autorisé à commenter. Le filtre est dans la requête (`visibility: 'CLIENT'`), pas à l'écran.
- Nouveau rôle `CLIENT` (rang 3) et nouveau décorateur `@OnlyRoles(...)`. La validation par le client ne pouvait pas s'exprimer par un seuil : si `CLIENT` passe au-dessus d'`EDITOR`, l'éditeur valide son propre travail ; en dessous, le client ne valide plus. `approve` / `reject` portent donc `@MinRole('VIEWER')` **et** `@OnlyRoles('OWNER','ADMIN','CLIENT')`, avec la liste `reviewerRoles` partagée entre API et interface.
- Une réponse hérite de la visibilité de son parent, dans les deux sens : un client répondant à un fil visible ne crée pas de note interne, et un interne répondant à un fil client ne divulgue rien. Répondre à un commentaire interne renvoie `404` (l'existence n'est pas divulguée), pas `403`.
- Imbrication limitée à un niveau ; une réponse orpheline est traitée comme une racine plutôt que d'être perdue.
- Historique fusionnant `PublicationEvent`, `AuditLog`, `Comment` et `Task` en une chronologie décroissante, avec libellés rédigés côté serveur. Une action inconnue s'affiche avec son code brut plutôt que de disparaître. Correction en cours de phase : les mesures sont journalisées contre `publication_target`, pas contre la publication — sans résoudre les cibles, `analytics.metric_recorded` manquait à l'historique.
- Portefeuille : un client **est** une organisation (aucune entité dupliquée), les compteurs n'incluent que le visible, et une organisation sans activité renvoie `lastActivityAt: null`, jamais une date arbitraire.
- Tâches gérées par l'agence (lecture ouverte à tous), `completedAt` suivant `status` dans les deux sens, assigné obligatoirement membre de l'organisation.
- Interface : fil de discussion, tâches liées et historique dans la fiche d'un contenu ; nouvelle page « Espace client » ; `useAsyncData` pour un chargement sans `setState` synchrone dans un effet.
- Modèles `Comment` et `Task`, énumérations `CommentVisibility` et `TaskStatus` ; migration `20261116080000_phase12_collaboration` appliquée sur Neon (14 migrations au total).
- Qualité : 383 tests unitaires (36 nouveaux), `pnpm test:phase12` (83 vérifications E2E à quatre rôles), lint/typecheck/build/format verts. Phases 6, 10 et 11 rejouées en local après le changement RBAC : aucune régression.

Détail : [PHASE12.md](PHASE12.md).

### Prochaine étape

Le cahier des charges est couvert jusqu'au §15. Restent les briques qui dépendent de tiers : transport e-mail transactionnel, identifiants des applications OAuth, moteur de rendu ffmpeg, stockage objet R2 et fournisseur de transcription.

---

## Correctif — registre de crédits (§16.2)

**Statut : CORRIGÉ ET DÉPLOYÉ.**

Trois bugs ont été trouvés en revue du travail de la Phase 13, tous confirmés avant correction :

- `CONFIRM` puis `REFUND` sur la même réservation restituait les crédits d'un travail déjà consommé et mettait `reserved` en négatif. La ligne `RESERVE` porte désormais `settledAt`, posé par un `updateMany` conditionnel dans la transaction : les deux règlements s'excluent, y compris en concurrence.
- La clé d'idempotence était unique globalement. Deux organisations choisissant la même clé partageaient une écriture, et `confirm`/`refund` ne prenaient aucun `organizationId` : un membre d'une organisation pouvait régler la réservation d'une autre. La clé est maintenant unique par compte et le règlement est scopé à l'organisation.
- Le contrôle de solde était hors transaction : deux réservations parallèles pouvaient passer. Le débit est devenu un `updateMany` conditionnel sur `balance >= amount`. Le quota mensuel est vérifié avant tout débit, et un rejeu concurrent renvoie `replayed: true` plutôt qu'un 500.

Migration `20261117001500_credit_ledger_safety` (16 au total), appliquée après vérification de la production : 0 transaction, 1 compte, aucune clé dupliquée. Les index créés à la main en Phase 13 sont déclarés au schéma pour que le diff Prisma ne propose pas de les supprimer.

Qualité : 412 tests unitaires (6 de régression), 15 vérifications en ligne dédiées au correctif, 12 suites E2E rejouées. `smoke-phase9` a été ajusté : TikTok dispose désormais d'identifiants, donc « chaque plateforme nomme ce qui bloque » accepte aussi un `transport: NONE` avec repli manuel. `cleanup-test-data` couvre maintenant `creditAccount` et `creditTransaction`.

### Prochaine étape

Suite E2E dédiée à la Phase 13 et mise à jour du worktree d'origine.

---

## Couverture E2E — Phase 13 (17 novembre 2026)

**Statut : TERMINÉE.**

- `scripts/smoke-phase13.mjs` (`pnpm test:phase13`) comble le trou de couverture sur l'administration (§17), les crédits (§16.2) et le rendu vidéo (§22). Il faut fournir `DATABASE_URL` (`node --env-file=.env scripts/smoke-phase13.mjs`) : le script élève **un compte jetable** en super-admin, puis le rétrograde dans un `finally`. Aucun compte permanent n'est touché.
- Administration : les routes sont fermées avant élévation (403), puis le tableau de bord, les offres, les utilisateurs, les organisations et le journal sont vérifiés. Un changement de plan met à jour le compte de crédits cible ; une désactivation coupe la session et la réactivation la rend. Chaque action administrative est journalisée avec son auteur. Un plan inconnu et une fenêtre de journal excessive sont refusés.
- Crédits : octroi réservé au super-admin, rejeu d'octroi sans double crédit, réservation → confirmation → remboursement refusé (le bug historique), remboursement d'une réservation non consommée, confirmation après remboursement refusée, clé d'idempotence acceptée dans un autre compte mais règlement inter-organisations renvoyé en 404, quota et solde refusés avec un motif, registre contenant `GRANT` / `RESERVE` / `CONFIRM` / `REFUND`.
- Rendu vidéo : sans fichier local, l'API refuse explicitement (aucun téléchargement simulé, aucun rendu inventé) ; un clip inversé, un lecteur ou une autre organisation sont refusés avant `ffmpeg`. Quand `SMOKE13_VIDEO_SOURCE` désigne un fichier visible par l'API, un vrai rendu `local-ffmpeg` est exigé.
- Qualité : **83 vérifications réussies en production**, **86 en local** avec un vrai rendu ffmpeg sur une source vidéo générée pour l'occasion. Le worktree de `Documents/PROJETS/AI-SOCIAL-STUDIO` a été avancé de `8c763b3` à `1548bac` en fast-forward (27 commits), sans écraser de travail local. Base nettoyée à 0 résidu de test.
- Aucun code applicatif n'a changé : ni l'API Render ni le frontend Cloudflare n'ont besoin d'être redéployés.

### Limites consignées, pas des régressions

- Les intégrations tierces restent honnêtement indisponibles tant que les identifiants OAuth, le transport e-mail, le stockage objet et le fournisseur de transcription ne sont pas branchés.

---

## Compléments de la Phase 13 (17 novembre 2026)

**Statut : CORRIGÉ ET DÉPLOYÉ.**

- **Octroi ciblé** : `POST /credits/grant` accepte désormais un `organizationId` optionnel. Sans lui, le super-admin crédite sa propre organisation comme avant ; avec lui, il crédite nommément une organisation cliente. La route reste réservée aux administrateurs plateforme et l'acteur est toujours enregistré sur la transaction. Le contrat partagé `grantCreditsSchema` porte ce champ optionnel.
- **Confinement du rendu** : `sourcePath` et les `file://` du projet sont résolus puis comparés à une racine configurée par `VIDEO_SOURCE_DIR` (par défaut `tmp/uploads` relatif à l'API). Une traversée `..`, un chemin absolu hors racine ou un lien symbolique sortant sont refusés avec « Fichier source hors du dossier autorisé », avant tout appel à `ffmpeg` — y compris quand le fichier existe réellement.
- Qualité : **416 tests unitaires API** (4 nouveaux sur le confinement), 4 web, 6 worker ; lint / typecheck / build / format verts. Suite `smoke-phase13` étendue à **90 vérifications locales** (dont un vrai rendu ffmpeg depuis la racine autorisée et l'octroi ciblé sans effet sur le solde du super-admin) et **87 vérifications en production**. Les 13 suites E2E antérieures ont été rejouées : **839 vérifications** supplémentaires, toutes vertes. Base nettoyée à 0 résidu de test (41 comptes et 197 journaux orphelins supprimés).
- `.env.example` documente `VIDEO_SOURCE_DIR`. Aucune migration n'était nécessaire.
- Déploiements : Render `dep-dbtv0a3bc2fs73fjp4i0` **live sur `1215bda`** ; Cloudflare Pages sert le bundle `index-B-mYa9Tc.js`, identique au build local. Aucune migration de base requise.

---

## Médiathèque — §12 (17 novembre 2026)

**Statut : CODE LIVRÉ, VÉRIFICATION EN LIGNE EN ATTENTE.**

**Fait :**

- Commit `e5a2c59` poussé sur `main`. Les deux migrations ont été appliquées sur Neon avant le push (18 migrations au total) ; le client Prisma a été régénéré.
- Frontend Cloudflare déployé sur la branche `main` : bundle `index-FoVtDn7J.js`, identique au build local.
- Les types du §12 sont complets : `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`, `LOGO`, `PROJECT`, `EXPORT`. Les trois derniers rejoignent l'énumération partagée et la base (migration `20261117073500_media_kinds`).
- `MediaAsset` gagne `folder`, `tags`, `favorite`, `checksum`, `rights` et `versionOfId` (migration `20261117073000_media_library`, 18 migrations au total). Aucun binaire n'est stocké en base : `sourceUrl` reste la référence externe, comme l'exige le §12.
- Recherche et filtres sont exécutés **en base** : nom, dossier, tag, type, favori et limite bornée. Le dossier vide est interprété comme la racine. Aucun filtrage côté interface.
- Métadonnées modifiables : nom, type, URL, dossier, tags, favori, empreinte, droits. `null` vide un champ ; un corps vide est refusé.
- Versions : un média peut pointer vers son origine dans la même organisation ; un média ne peut pas être sa propre version. `GET /media/:id/versions` liste les versions.
- Doublons : `GET /media/duplicates` regroupe les médias partageant la même empreinte déclarée, organisation par organisation. La suppression logique retire immédiatement un média de son groupe.
- Interface : recherche, cinq filtres, formulaire enrichi, bascule favori, panneau des versions et panneau des doublons.
- Qualité locale : 423 tests API (7 nouveaux sur la médiathèque), 4 web, 6 worker ; lint / typecheck / build / format verts. Suite `scripts/smoke-media.mjs` (`pnpm test:media`) avec **46 vérifications E2E locales**. Isolation multi-tenant vérifiée sur la lecture, la mutation, les versions et les doublons.

**Reste à faire :**

- Attendre et confirmer l'auto-déploiement Render sur `e5a2c59` (non vérifié : l'arrêt a été demandé juste après le push).
- Rejouer `pnpm test:media` contre la production, puis les suites antérieures si nécessaire.
- Nettoyer les données créées par le passage local : `node --env-file=.env scripts/cleanup-test-data.mjs`.
- Stockage privé et URLs signées implémentés dans Neon (voir section dédiée ci-dessous).
- Backlog tiers inchangé : identifiants OAuth, transport e-mail, fournisseur de transcription. Aucun succès simulé n'est ajouté en leur absence.

---

## Stockage privé et URLs signées (§12) — 17 novembre 2026

**Statut : CODE, MIGRÉ ET DÉPLOYÉ SANS FOURNISSEUR PAYANT.**

La médiathèque dépose le binaire dans la table `MediaObject` de la base Neon déjà configurée. Le pilote S3/R2 reste dans le code, mais R2 demande une souscription Cloudflare avec moyen de paiement : il n'est plus nécessaire.

- `MediaAsset.storageKey` (migration `20261117090000_media_storage_key`, unique) référence le binaire. `NULL` = média sans fichier. La table séparée `MediaObject` (migration `20261117151500_media_object_blobs`) évite de charger les octets dans les listes de médias.
- `MEDIA_STORAGE_DRIVER=database` par défaut. `ObjectStorageService` écrit, relit et supprime les octets via Prisma ; le pilote `s3` reste disponible avec les variables `R2_*`.
- Clé privée préfixée par organisation (`org/<organizationId>/<assetId>/<nom>`), traversée refusée ; empreinte SHA-256 calculée côté serveur, pas déclarée par le client.
- `POST /media/upload` (multipart, 25 Mo max) déduit le type du MIME, stocke le fichier puis crée la ligne. Si l'écriture en base échoue, l'objet est supprimé en compensation.
- `GET /media/:id/url?expires=` (30–3600 s, défaut 900) renvoie une URL signée HMAC-SHA256 avec `AUTH_SECRET` : `GET /api/v1/media/file?key=...&exp=...&token=...`. Le fichier reste privé en permanence.
- `DELETE /media/:id` supprime aussi l'objet (best-effort, journalisé si échec).
- Interface : formulaire d'envoi et bouton « Ouvrir » sur les médias pourvus d'un fichier (`hasFile`).
- Suite dédiée `pnpm test:storage` : upload, téléchargement effectif de l'URL signée, bornes d'expiration, isolation multi-tenant, suppression.

Qualité : **435 tests unitaires** (6 nouveaux sur le stockage/URL signée), lint / typecheck / format / build verts. Migration appliquée sur Neon (20 migrations). Aucune variable d'environnement supplémentaire requise en production.

Validation en ligne : `pnpm test:storage` **22/22** (upload, URL signée téléchargeable, bornes, isolation, suppression), `pnpm test:online` **12/12**. Données de test supprimées ; `scripts/cleanup-test-data.mjs` nettoie aussi les blobs orphelins.
