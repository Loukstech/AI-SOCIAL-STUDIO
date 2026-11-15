# Phase 5 — AI Content Studio

> **Statut : LIVRÉE** (15 novembre 2026).

## Objectif

Passer d'une idée décrite en langage naturel à un jeu de publications prêtes à éditer, une
variante par réseau, calibrée sur les règles réelles de chaque plateforme. Cette phase couvre
les §6.1 à §6.4 du cahier des charges.

Comme la transcription vidéo, la génération est **locale et déterministe** (`AI_PROVIDER=mock`).
Aucune clé, aucun coût, aucun appel réseau : le contrat d'API est posé pour recevoir un modèle
de langage réel sans changer l'interface.

## Périmètre livré

### Génération par prompt (§6.1)

- `POST /api/v1/ai/content/generate` (EDITOR).
- Le brief est analysé pour en extraire **sujet**, **objectif** et **public** :
  - retrait du verbe d'action initial (`Crée`, `Rédige`, `Annonce`…) qui devient l'objectif ;
  - coupe sur les marqueurs de consigne (`le ton doit être`, `ajoute`, `encourage`…) pour ne
    pas confondre une instruction avec le sujet ;
  - reconnaissance de la forme « … pour annoncer X » : l'objectif est explicite, X devient le sujet ;
  - détection du public par lexique (`débutants`, `professionnels`, `clients`…).
- Sur l'exemple du cahier des charges, l'analyse produit le sujet
  « nouvelle formation en intelligence artificielle » et l'objectif « annoncer ».

### Types de contenus (§6.2)

Les 14 types sont couverts : publication commerciale, annonce, promotion, présentation
d'entreprise, citation, astuce, tutoriel, témoignage, lancement de produit, événement, offre
spéciale, contenu éducatif, script vidéo, carrousel. Chacun porte sa propre formulation de
fond et son bénéfice associé.

### Adaptation multiréseaux (§6.3)

Une variante distincte par plateforme, avec les limites réelles :

| Plateforme | Limite dure | Longueur visée | Hashtags max | Titre |
| ---------- | ----------- | -------------- | ------------ | ----- |
| Facebook   | 63 206      | 600            | 3            | —     |
| Instagram  | 2 200       | 400            | 10           | —     |
| LinkedIn   | 3 000       | 700            | 5            | —     |
| TikTok     | 2 200       | 150            | 5            | —     |
| YouTube    | 5 000       | 600            | 5            | 100   |
| X          | 280         | 240            | 2            | —     |
| Pinterest  | 500         | 300            | 5            | 100   |
| Threads    | 500         | 280            | 3            | —     |

- Les plateformes courtes enchaînent accroche, fond et appel à l'action sur un seul bloc ;
  les autres respirent avec un paragraphe par intention éditoriale.
- Le compteur de caractères inclut le bloc d'hashtags, séparé par deux retours à la ligne :
  c'est bien le texte publiable qui est mesuré.
- Au-delà de la longueur recommandée, un avertissement est remonté ; au-delà de la limite dure,
  le texte est tronqué proprement et l'avertissement l'indique.
- Chaque variante est éditable indépendamment (`PATCH /content/:id/variants/:variantId`).

### Assistant rédactionnel (§6.4)

`POST /api/v1/content/:id/variants/:variantId/rewrite` avec neuf actions :

| Action        | Effet                                                           |
| ------------- | --------------------------------------------------------------- |
| `FIX`         | Normalise espaces, ponctuation et majuscules de début de ligne  |
| `REPHRASE`    | Retravaille l'enchaînement avec un connecteur propre au ton     |
| `SHORTEN`     | Conserve accroche et chute, retire les phrases intermédiaires   |
| `EXPAND`      | Ajoute un paragraphe de contexte ancré sur le sujet             |
| `CHANGE_TONE` | Substitutions lexicales et ponctuation du ton visé              |
| `ADD_CTA`     | Ajoute un appel à l'action adapté à la plateforme, sans doublon |
| `HASHTAGS`    | Propose des hashtags dans la limite de la plateforme            |
| `TRANSLATE`   | Crée la version FR ou EN de la même variante, côte à côte       |
| `VARIATIONS`  | Produit plusieurs ouvertures alternatives pour A/B tester       |

`TRANSLATE` est la seule action qui ne réécrit pas le texte existant : elle régénère la
variante dans l'autre langue. Le modèle porte donc `language` sur la variante, et une même
plateforme peut porter une version FR et une version EN (`@@unique(projectId, platform, language)`).

## Sécurité

- Filtrage systématique par `organizationId` : un contenu d'une autre organisation renvoie `404`.
- RBAC : un `VIEWER` lit mais ne peut ni générer, ni éditer, ni utiliser l'assistant.
- Audit : `content.generated`, `content.variant_updated`, `content.variant_rewritten`,
  `content.deleted`.
- Le nombre d'hashtags est validé côté serveur, pas seulement dans l'interface.

## Limites assumées

- **Le sujet saisi reste dans sa langue d'origine.** Une génération en anglais avec un sujet
  français produit un texte anglais autour d'un sujet français. C'est cohérent avec un
  fournisseur `mock` qui ne traduit pas ; un modèle réel lèvera cette limite.
- **La qualité éditoriale est celle d'un assemblage.** Les textes sont grammaticalement
  corrects et calibrés, mais ils restent génériques : l'utilisateur doit éditer avant de
  publier. L'interface le dit explicitement.
- `AI_PROVIDER=openai` renvoie `503` tant que l'adaptateur n'est pas écrit, plutôt que de
  simuler une réponse.
- **Pas de `content_items` séparé** : le cahier des charges prévoit `content_projects` →
  `content_items` → `content_variants`. Un projet porte ici directement ses variantes, ce qui
  suffit tant qu'un projet ne contient qu'un seul contenu. La séparation sera introduite avec
  le Publishing Center, quand plusieurs contenus devront cohabiter dans un même projet.

## Vérification

`pnpm test:phase5` exécute **77 vérifications** de bout en bout : analyse du brief sur
l'exemple du cahier des charges, génération de quatre variantes, respect des limites et des
quotas d'hashtags, présence des titres attendus, déterminisme, refus d'un brief trop court et
d'une sélection vide, édition d'une variante avec recalcul de la longueur, refus d'un excès
d'hashtags, les huit actions de réécriture, réduction effective par `SHORTEN`, traduction vers
l'anglais avec conservation du français, refus d'une traduction vers la langue courante,
isolation multi-tenant, RBAC, compteur du tableau de bord et suppression.

Côté unitaire, `apps/api/src/content/` compte **30 tests** : 19 sur le générateur et 11 sur
l'assistant.
