# Phase 8 — Déclinaison multi-formats et export PNG (§7)

**Statut : TERMINÉE.**

## Ce qui est livré

### Décliner un visuel (§7)

Une idée ne vit jamais dans un seul format. Le studio sait désormais produire
**la même composition dans plusieurs gabarits** en un appel : les calques de
texte, la palette, la marque, le style et la graine sont repris tels quels, et
seul le gabarit change. Le composeur réajuste la typographie — rien n'est étiré,
rien n'est rogné.

```
POST /api/v1/image-projects/{id}/decline
{ "formats": ["STORY_9_16", "LANDSCAPE_16_9"] }
```

Chaque déclinaison est un visuel **à part entière** : elle a son propre SVG, ses
propres avertissements, et pointe vers son origine via `sourceProjectId`.

### Ce que la déclinaison refuse, et pourquoi

Une déclinaison ne doit jamais produire silencieusement un visuel de travers.
La règle est donc explicite, et testée :

| Cas                                           | Comportement                                                      |
| --------------------------------------------- | ----------------------------------------------------------------- |
| Format identique à l'origine                  | Ignoré — « Format identique au visuel d'origine »                 |
| Format personnalisé (`CUSTOM`)                | Ignoré — « doit être composé explicitement, avec ses dimensions » |
| Doublon dans la demande                       | Produit une seule fois                                            |
| Plateforme compatible                         | Conservée sur la déclinaison                                      |
| Plateforme incompatible                       | **Retirée**, avec un avertissement nommant les formats acceptés   |
| Plus de 5 formats, liste vide, format inconnu | `400`                                                             |

Le cas « plateforme incompatible » mérite d'être souligné : décliner un visuel
LinkedIn en story ne renvoie pas une erreur, cela produit une story **sans
plateforme** et l'explique. Le visuel reste utilisable ; l'information perdue
est signalée, pas effacée.

### Export PNG

Le SVG est le format de travail ; les réseaux sociaux, eux, veulent du raster.
L'export PNG se fait **dans le navigateur**, via un canvas, pour trois raisons :

1. **Typographie exacte.** Le rendu canvas utilise les polices de la machine qui
   affiche l'aperçu. Un rendu serveur tournerait dans un conteneur où `Inter`
   n'est pas installée : les métriques changeraient et un titre ajusté au pixel
   près déborderait.
2. **Aucune dépendance native.** Pas de `sharp`, pas de `resvg`, pas de
   `librsvg` à compiler — le déploiement reste identique à la phase précédente.
3. **Le fichier est produit là où l'utilisateur le voit.**

Deux échelles sont proposées : `PNG` (dimensions natives) et `PNG ×2` (double
densité, utile pour les écrans haute résolution).

**La limite, traitée explicitement.** Un SVG chargé comme image est rendu en
« mode statique sécurisé » : les ressources externes sont bloquées. Un logo
référencé par URL disparaîtrait donc silencieusement du PNG. Le module
`apps/web/src/lib/png-export.ts` commence par **intégrer ces ressources en
`data:` URI** ; si le CDN refuse la requête (CORS) ou si le fichier est
introuvable, l'utilisateur est prévenu nommément au lieu de recevoir un PNG
amputé sans le savoir.

## Modèle de données

```prisma
model ImageProject {
  ...
  sourceProjectId String?
  source   ImageProject?  @relation("ImageVariants", fields: [sourceProjectId], references: [id], onDelete: SetNull)
  variants ImageProject[] @relation("ImageVariants")
  @@index([sourceProjectId])
}
```

Migration `20261115240000_phase8_image_variants` appliquée sur Neon (9 migrations
au total).

Supprimer l'origine ne casse pas les déclinaisons : `onDelete: SetNull`, et la
suppression reste logique (`deletedAt`) côté API, donc la déclinaison conserve
son origine tant que celle-ci existe.

## Contrats partagés

`packages/shared/src/image.ts` :

- `planDecline({ sourceFormat, platform, formats })` — **fonction pure**, sans
  accès base ni réseau. C'est la règle métier de la déclinaison, partagée par
  l'API et l'interface, et testable isolément.
- `declineImageProjectSchema` (1 à 5 formats), `declineResultSchema`
  (`{ created, skipped }`).
- `sourceProjectId` ajouté à `imageProjectSchema`.

## API

| Méthode | Route                          | Rôle minimal |
| ------- | ------------------------------ | ------------ |
| `POST`  | `/image-projects/{id}/decline` | EDITOR       |

Réponse `201` : `{ created: ImageProjectDetail[], skipped: [{ format, reason }] }`.

## Interface

- Boutons **PNG** et **PNG ×2** dans la barre d'actions de l'aperçu, avec
  message de confirmation (dimensions produites) ou avertissement d'intégration.
- Panneau **« Décliner dans d'autres formats »** : cases à cocher (format
  d'origine et `CUSTOM` exclus), bouton, puis compte-rendu des visuels créés et
  des formats ignorés avec leur raison.
- La galerie marque les déclinaisons (`· déclinaison`).

## Vérification

- **187 tests unitaires** (172 avant la phase, dont **15 nouveaux** sur
  `planDecline` et `declineImageProjectSchema`).
- **65 vérifications E2E** (`pnpm test:phase8`) : héritage complet des calques,
  recomposition réelle du SVG, refus motivés, propagation puis retrait de la
  plateforme, traçabilité, validation, RBAC, isolation multi-tenant, survie de
  la déclinaison à la suppression de l'origine.
- **`pnpm verify:png`** : 13 contrôles dans **Chrome headless**, sur le module
  réel compilé par esbuild — dimensions 1× et 2×, type MIME, poids, variance des
  pixels (détecte un PNG vide), nommage, rejet d'un SVG invalide, et
  avertissement quand une ressource externe est inaccessible.
- Planche visuelle : les quatre gabarits déclinés depuis les mêmes calques sont
  rendus côte à côte (`node scripts/preview-composer.mjs`) et contrôlés à l'œil.

## Ce qui n'est pas fait

- **Pas d'export PNG côté serveur.** Il faudrait un moteur raster et une police
  embarquée pour garantir le même rendu que l'aperçu ; le navigateur le fait
  déjà mieux. À prévoir le jour où un envoi automatisé vers les réseaux exigera
  un fichier PNG produit sans utilisateur.
- **Pas de déclinaison en lot depuis la galerie.** La déclinaison part d'un
  visuel ouvert ; un lot multi-visuels reste à faire.
- **Pas de résolution automatique du CORS** pour les logos distants : le message
  est honnête, mais il dépend de la configuration du CDN qui héberge le média.

## Reproduire la vérification

```bash
pnpm test:phase8                                   # E2E complet
API_URL=http://localhost:3000 pnpm test:phase8     # contre l'API locale
pnpm verify:png                                    # export PNG dans Chrome headless
node scripts/preview-composer.mjs                  # planche de contrôle visuel
```
