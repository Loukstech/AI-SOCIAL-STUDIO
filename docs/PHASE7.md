# Phase 7 — AI Image Studio et Brand Kit (§7, §8)

**Statut : TERMINÉE.**

## Ce qui est livré

### AI Image Studio (§7)

Un visuel est composé **localement**, sans clé d'API, sans coût, sans latence réseau. Le moteur produit un **SVG autonome** : une vraie image vectorielle, dont chaque texte reste un calque `<text>` séparé. C'est exactement ce qu'exige le cahier des charges — « les textes générés doivent pouvoir être corrigés ou remplacés manuellement » — sans avoir à régénérer l'image.

| Élément            | Détail                                                                         |
| ------------------ | ------------------------------------------------------------------------------ |
| Formats            | Carré 1080×1080, Portrait 4:5, Story 9:16, Paysage 16:9, personnalisé 256–4096 |
| Styles             | Éditorial, Affirmé, Minimal, Dégradé                                           |
| Calques de texte   | Titre, sous-titre, bouton, pastille — tous modifiables après génération        |
| Palette            | 1 à 8 couleurs ; la première sert de fond, la deuxième d'accent                |
| Logo               | Référencé par identifiant de média, **jamais copié ni altéré**                 |
| Image de référence | Rendue en fond voilé (opacité 0,62) pour préserver la lisibilité               |
| Reproductibilité   | Graine explicite : même entrée + même graine = SVG identique, octet pour octet |
| Export             | `GET /image-projects/{id}/download` en `image/svg+xml` avec pièce jointe       |

**Déterminisme.** Le décor (trois cercles) est tiré d'un générateur mulberry32 amorcé par la graine. Deux créations avec la même graine produisent un SVG strictement identique — vérifié par les tests unitaires et par le test E2E.

**Avertissements plutôt que rendus silencieusement dégradés.** Le composeur signale : contraste fond/texte limite, absence de logo, titre tronqué, sous-titre tronqué, logo sans URL source, image de référence inexploitable. L'interface les affiche sous l'aperçu.

**Refus explicite des combinaisons impossibles.** Un format Story envoyé vers LinkedIn renvoie `400` avec la liste des formats acceptés, au lieu de produire un visuel inutilisable. C'est l'application directe du §8 : un Brand Kit ne doit pas imposer un élément incompatible.

### Brand Kit (§8)

Une marque porte désormais son identité complète :

- logos principal et secondaire, **référencés par identifiant de média** (`onDelete: SetNull` — le fichier d'origine n'est jamais réécrit) ;
- palette ordonnée de 8 couleurs maximum, plus une couleur principale de repli ;
- polices de titre et de texte, slogan ;
- site web, e-mail et téléphone de contact ;
- jusqu'à 8 liens sociaux typés par plateforme ;
- jusqu'à 12 images de référence ;
- consignes éditoriales libres.

`PATCH /brands/{id}` est partiel : un champ absent reste inchangé, `null` le vide. Un corps vide est refusé (`400`) pour éviter les écritures fantômes. Tout identifiant de média est vérifié comme appartenant à l'organisation avant insertion — un logo d'une autre organisation renvoie `404`.

La palette de la marque est appliquée automatiquement à la création d'un visuel rattaché ; l'organisation peut la surcharger visuel par visuel.

## Modèle de données

```prisma
enum ImageFormat { SQUARE PORTRAIT_4_5 STORY_9_16 LANDSCAPE_16_9 CUSTOM }
enum ImageStyle  { EDITORIAL BOLD MINIMAL GRADIENT }

model ImageProject {
  id, organizationId, brandId?, createdById?, title?
  prompt, format, width, height, style
  provider, model, seed, platform?
  palette[], logoMediaId?, referenceMediaIds[]
  headline?, subheadline?, callToAction?, badge?
  svg, warnings[]
  createdAt, updatedAt, deletedAt
}
```

`Brand` reçoit `logoPrimaryId`, `logoSecondaryId`, `headingFont`, `bodyFont`, `slogan`, `website`, `contactEmail`, `contactPhone`, `socialLinks` (Json), `referenceImageIds`, `editorialInstructions`.

Migration `20261115230000_phase7_image_brandkit` appliquée sur Neon (8 migrations au total).

## Contrats partagés

`packages/shared/src/image.ts` : formats et dimensions canoniques, `nearestFormat` (tolérance 4 %), `checkPlatformFormat`, schémas de création et de mise à jour.

`packages/shared/src/brand.ts` : schémas de marque et de Brand Kit. Ce fichier existe pour **casser le cycle d'imports** `saas.ts ↔ social.ts` : `social.ts` a besoin de `organizationRoleSchema` (défini dans `saas.ts`), et le Brand Kit a besoin des plateformes. Les schémas de marque ont donc quitté `saas.ts`.

## API

| Méthode  | Route                           | Rôle minimal |
| -------- | ------------------------------- | ------------ |
| `GET`    | `/image-projects`               | VIEWER       |
| `GET`    | `/image-projects/{id}`          | VIEWER       |
| `GET`    | `/image-projects/{id}/download` | VIEWER       |
| `POST`   | `/image-projects`               | EDITOR       |
| `PATCH`  | `/image-projects/{id}`          | EDITOR       |
| `POST`   | `/image-projects/{id}/rerender` | EDITOR       |
| `DELETE` | `/image-projects/{id}`          | EDITOR       |
| `GET`    | `/brands`                       | VIEWER       |
| `POST`   | `/brands`                       | ADMIN        |
| `PATCH`  | `/brands/{id}`                  | ADMIN        |
| `DELETE` | `/brands/{id}`                  | ADMIN        |

La liste ne transporte pas la source SVG (réponses légères) ; le détail la renvoie.

## Interface

- **AI Image Studio** : brief, format (les formats incompatibles avec la plateforme choisie sont désactivés), style, marque, plateforme, palette éditable, logo, image de référence, textes forcés en option. Aperçu en direct, avertissements, correction des textes, nouveau décor, téléchargement, galerie de vignettes.
- **Marques et Brand Kit** : éditeur complet du kit, sélection de la marque à gauche, formulaire à droite, enregistrement en une passe.
- Navigation : nouvelle entrée « AI Image Studio », « Marques » devenue « Marques et Brand Kit ».
- Tableau de bord : compteur « Visuels générés » et raccourci « Générer un visuel pour les réseaux ».

L'aperçu utilise un `<img src="data:image/svg+xml,…">` : le document est rendu dans un contexte image, donc **il ne peut pas exécuter de script**, même si le SVG contient du balisage échappé.

## Sécurité et fiabilité

- Échappement XML systématique (`&`, `<`, `>`, `"`, `'`) de tout texte utilisateur avant insertion dans le SVG.
- Un titre contenant `<script>` est stocké tel quel mais rendu en `&lt;script&gt;` — vérifié par les tests unitaires et E2E.
- Toute lecture hors organisation renvoie **404**, jamais 403 : un visuel ou une marque d'un autre tenant est introuvable.
- Téléchargement croisé refusé (`404`).
- Un `VIEWER` peut consulter et télécharger, jamais générer ni modifier un kit (`403`).

## Qualité

- **172 tests unitaires** (115 avant la phase, dont **57 nouveaux** : 33 sur le composeur, 24 sur les formats et la compatibilité plateforme).
- **87 vérifications E2E** (`pnpm test:phase7`) : Brand Kit complet et partiel, propriété des médias, composition, déterminisme de la graine, calques éditables, refus de format, avertissements, téléchargement, RBAC, isolation multi-tenant, suppression logique.
- lint / typecheck / test / build / format:check verts.

## Ce qui n'est pas fait

- **Pas de modèle raster.** Le §7 évoque une génération par IA ; le moteur livré est un composeur déterministe. Il produit un résultat réel, reproductible et éditable, sans clé payante ni coût variable. Un modèle de génération d'images se branchera derrière la même interface (`provider`/`model` sont déjà stockés par visuel) sans changer les contrats d'API ni la base.
- **Pas d'export PNG.** Le SVG est le format de sortie ; la conversion raster demande un moteur (resvg, sharp) ou un navigateur headless, non installés.
- **Pas d'upload binaire.** Les logos restent des médias référencés par URL source, en attendant l'activation du stockage objet (voir `DEPLOYMENT.md`).

## Reproduire la vérification

```bash
pnpm test:phase7                                    # E2E complet
node scripts/preview-composer.mjs                   # planche de contrôle visuel → tmp/
API_URL=http://localhost:3000 pnpm test:phase7      # contre l'API locale
```
