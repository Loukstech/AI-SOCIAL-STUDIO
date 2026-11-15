# Phase 10 — Analytics (§13)

**Statut : TERMINÉE.**

## Ce qui est livré

Le §13 tient en une phrase, et c'est une phrase dure :

> « Ne jamais inventer ou extrapoler une métrique indisponible. Afficher sa
> provenance, sa date de synchronisation et son éventuelle indisponibilité. »

La facilité, ici, serait de rendre `0` là où la donnée manque : les tableaux se
remplissent, les graphiques sont plats, personne ne remarque. C'est exactement
ce que la phase refuse. `null` traverse l'API, le contrat partagé, le CSV et
l'interface sans jamais devenir un zéro.

```
GET /api/v1/analytics/overview

{
  "totals": { "views": { "value": null, "contributors": 0 }, … },
  "engagement": {
    "value": null,
    "basis": null,
    "basedOn": 0,
    "reason": "Aucune mesure complète : il faut les quatre interactions et les
               impressions (ou la portée) pour calculer un taux"
  },
  "audience": {
    "available": false,
    "reason": "Aucune série d'audience (abonnés) n'est collectée : les API des
               réseaux l'exigent par appel dédié, et aucun adaptateur natif n'est
               configuré. La donnée n'est donc pas affichée plutôt qu'estimée."
  }
}
```

### Les routes

| Route                              | Rôle     | Rôle requis |
| ---------------------------------- | -------- | ----------- |
| `GET /analytics/overview`          | agrégat  | `VIEWER`    |
| `GET /analytics/top`               | classement | `VIEWER`  |
| `GET /analytics/export.csv`        | export   | `VIEWER`    |
| `GET /analytics/measurements`      | historique d'une cible | `VIEWER` |
| `POST /analytics/measurements`     | saisie   | `EDITOR`    |
| `POST /analytics/collect`          | collecte auprès des plateformes | `EDITOR` |

Un rapport n'est pas modifiable ; une mesure, si — c'est une donnée qu'on
engage, d'où le seuil `EDITOR`.

## Cinq décisions qui portent la justesse

### 1. `null` n'est pas `0`

`sumMetrics` additionne champ par champ **en ignorant les absences** et renvoie,
pour chaque métrique, `{ value, contributors }`. Un total de 1 200 vues sur
12 mesures qui n'en fournissent que 3 s'affiche « 1 200 » avec l'infobulle
« 3 mesures sur 12 ». Le chiffre reste utile ; il ne se fait plus passer pour
complet.

À l'inverse, un `0` saisi est une **contribution réelle** : il entre dans la
somme et dans le compte des contributeurs. « Mesuré à zéro » et « non mesuré »
sont deux informations différentes, et le système les distingue de bout en bout,
jusqu'à la cellule CSV vide.

### 2. Un taux ne se calcule que s'il a un sens

Le taux d'engagement exige **les quatre composantes** — likes, commentaires,
partages, enregistrements — et un dénominateur d'audience. Avec un numérateur
partiel, le taux serait mécaniquement sous-estimé et afficherait une
contre-performance inexistante. Sans dénominateur, il n'existe pas.

`engagementRate` renvoie donc `{ value, basis, reason }` où `basis` nomme le
dénominateur réellement utilisé (`impressions` ou `reach`), et `reason` dit
précisément ce qui manque :

```
"Composantes manquantes : Partages, Enregistrements"
"Aucun dénominateur d'audience : impressions et portée sont indisponibles ou nulles"
```

### 3. Un agrégat ne calcule que sur des mesures complètes

C'est le défaut corrigé en cours de phase, et il valait la peine d'être vu :
additionner toutes les mesures puis diviser gonfle le dénominateur avec des
publications dont le numérateur est incomplet — le taux global baisse sans
raison.

`pooledEngagement` filtre donc les mesures **complètes** avant de sommer, et
renvoie `basedOn` : le nombre de mesures qui ont réellement servi. L'interface
l'affiche en infobulle. Calculer sur un sous-ensemble sans le dire serait déjà
une extrapolation.

Le calcul reste un **rapport de sommes**, jamais une moyenne de taux : une
moyenne donnerait le même poids à une publication vue 10 fois et à une
publication vue 10 000 fois.

### 4. Une seule mesure par cible est retenue

Les compteurs des réseaux sont **cumulatifs**. Deux relevés de la même
publication ne s'additionnent pas : le second contient déjà le premier.
`latestByTarget` ne garde donc que la mesure la plus récente de la période
(départage par date d'enregistrement à date de relevé égale), et la réponse
l'explique :

> « Plusieurs mesures existent pour certaines publications : seule la plus
> récente est retenue, pour ne pas additionner des compteurs cumulatifs. »

L'historique complet reste consultable cible par cible — il sert à suivre une
progression, pas à faire des totaux.

### 5. La portée est additionnée, mais signalée

La portée compte des **personnes**. Additionner celle de deux publications
recompte celles qui ont vu les deux. La valeur reste exposée — elle est utile —
mais `aggregationNotes` l'accompagne systématiquement de :

> « La portée est additionnée sans déduplication : une même personne peut être
> comptée sur plusieurs publications. »

### Ce que la collecte fait quand elle ne peut rien collecter

`POST /analytics/collect` interroge les adaptateurs de plateforme. Sans
identifiants natifs, la réponse ne fabrique aucun chiffre :

```json
{
  "attempted": 2,
  "collected": 0,
  "skipped": [
    {
      "targetId": "…",
      "platform": "LINKEDIN",
      "reason": "Aucune statistique LinkedIn n'est disponible sans accès direct à l'API du fournisseur (publication …)."
    }
  ]
}
```

`attempted`, `collected`, `skipped` : les trois nombres sont là pour que
l'échec soit comptable, pas pour être masqué.

## L'export CSV

Une ligne par **mesure**, pas par publication : le fichier sert aussi à vérifier
la traçabilité (source, dates de relevé et d'enregistrement) dans un tableur.

- Séparateur `;` et BOM UTF-8 — ce qu'attend Excel en configuration française ;
  sans BOM les accents sortent cassés.
- En-têtes en français (`Vues`, `Impressions`, `Portée`, …) alignés sur le
  reste de l'interface.
- Une métrique indisponible donne une **cellule vide**, jamais `0`.

## L'interface

Page « Analytics » :

- sélecteur de période (30 jours par défaut, un an maximum), de marque et de
  métrique de classement ;
- trois cartes : publications de la période, taux d'engagement global,
  audience — cette dernière annonce son indisponibilité avec son motif ;
- carte « Limites de ces chiffres » listant les avertissements d'agrégation ;
- tableau de comparaison par réseau, avec la couverture de chaque métrique en
  infobulle (« 3 mesures sur 12 ») et la date du dernier relevé ;
- meilleurs contenus, avec provenance et date de relevé pour chacun ;
- formulaire de saisie d'une mesure, historique de la cible, bouton de collecte,
  export CSV.

## Modèle

```prisma
enum MetricSource { MANUAL PLATFORM_API WEBHOOK }

model PublicationMetric {
  id             String            @id @default(uuid())
  organizationId String
  targetId       String
  platform       SocialPlatform
  source         MetricSource
  collectedAt    DateTime   // quand la métrique a été observée
  syncedAt       DateTime   @default(now()) // quand elle est entrée en base
  recordedById   String?
  views          Int?
  impressions    Int?
  reach          Int?
  likes          Int?
  comments       Int?
  shares         Int?
  saves          Int?
  clicks         Int?
  note           String?
  target         PublicationTarget @relation(fields: [targetId], references: [id], onDelete: Cascade)
  @@index([organizationId, collectedAt])
  @@index([targetId, collectedAt])
}
```

Deux dates, parce que ce sont deux faits différents : `collectedAt` est la date
du relevé (saisie ou lecture API), `syncedAt` celle de son enregistrement. Le
§13 demande « sa date de synchronisation » ; les deux sont exposées.

Migration `20261115260000_phase10_publication_metrics` appliquée sur Neon
(**11 migrations** au total).

## Vérification

```bash
pnpm --filter @ass/api test          # 301 tests unitaires, dont 35 sur analytics
pnpm test:phase10                    # 62 vérifications E2E
```

Le parcours E2E crée une vraie publication, la fait passer en `PUBLISHED` par le
circuit du §9 (soumettre → publier → confirmer), puis mesure :

- organisation vide → totaux nuls, taux refusé, motif affiché ;
- mesure complète → 50/1000 = 5 %, `basedOn: 1` ;
- seconde mesure à dénominateur nul → le taux des autres **n'est pas annulé**,
  et reste `basedOn: 1` ;
- métrique fournie une seule fois → total partiel signalé ;
- second relevé sur la même cible → 5 000 vues retenues, pas 6 200 ;
- export CSV → cellule vide pour la métrique absente, jamais `0` ;
- collecte → `attempted: 2`, `collected: 0`, deux motifs ;
- RBAC → `VIEWER` lit, ne saisit pas, ne collecte pas ;
- isolation → la publication d'une autre organisation renvoie `404`.

## Ce qui reste hors de portée

- **L'audience (abonnés).** Elle demande un appel dédié par réseau et une
  fenêtre temporelle ; rien n'est collecté, donc rien n'est affiché. La réponse
  le dit au lieu d'estimer une courbe.
- **La collecte automatique.** Elle s'activera quand les adaptateurs natifs
  existeront — c'est-à-dire quand les applications OAuth de la Phase 9 auront
  leurs identifiants. Le chemin de code est déjà branché et testé.
- **Les webhooks de plateforme** (`MetricSource.WEBHOOK`). La valeur existe dans
  le contrat ; aucun transport ne l'alimente encore.
