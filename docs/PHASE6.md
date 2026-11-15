# Phase 6 — Publishing Center et Content Calendar

> **Statut : LIVRÉE** (15 novembre 2026).

## Objectif

Faire passer un contenu du brouillon à la publication, avec un circuit de validation lisible,
une programmation fiable et un calendrier éditorial. Cette phase couvre les §10 et §11 du cahier
des charges.

## La contrainte assumée : aucune publication simulée

Le cahier des charges est catégorique au §10.4 : « Ne jamais simuler une publication réussie. »
Or aucun identifiant d'application OAuth n'est disponible pour Meta, TikTok, LinkedIn, Google ou
X. Écrire huit adaptateurs sans jamais pouvoir les tester n'aurait produit que du code mort
présenté comme fonctionnel.

La passerelle est donc explicite sur ce qu'elle sait faire :

| Situation                    | Comportement                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Aucun transport configuré    | `publish()` échoue avec `NOT_CONFIGURED`, la publication passe en `FAILED` et l'interface propose les replis                             |
| `PUBLISH_WEBHOOK_URL` défini | L'envoi est délégué à un scénario externe (n8n, Make, Zapier) ; une réponse sans identifiant **ni** URL est refusée comme non vérifiable |
| Publication faite à la main  | `POST /publications/:id/confirm` exige une **URL par cible** ; c'est la seule preuve acceptée                                            |

Autrement dit : la phase livre tout ce qui entoure l'envoi — validation, approbation,
programmation, réessais, historique — et refuse de mentir sur la dernière étape.

## Périmètre livré

### Types de publication (§10.1)

`TEXT`, `IMAGE`, `GALLERY`, `VIDEO`, `REEL`, `SHORT`, `CAROUSEL`, `LINK`. Chaque plateforme
déclare les formats qu'elle accepte réellement (`platformCapabilities`) : TikTok n'accepte que la
vidéo, Instagram exige un média quel que soit le format, X plafonne à quatre médias.

### Modes et workflow (§10.2, §10.3)

```
DRAFT → READY_FOR_REVIEW → PENDING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED
```

États complémentaires : `REJECTED`, `CANCELLED`, `FAILED`, `EXPIRED`.

- **Mode `AUTO`** : la soumission vaut validation. Deux événements sont écrits
  (`READY_FOR_REVIEW` puis `APPROVED`) avec le motif « Validation automatique ».
- **Mode `APPROVAL`** : la soumission s'arrête à `READY_FOR_REVIEW`, la demande de validation
  passe en `PENDING_APPROVAL`, et seul un `ADMIN` peut approuver ou refuser (motif obligatoire).

Chaque transition a **sa propre route** (`/submit`, `/approve`, `/reject`, `/schedule`,
`/reschedule`, `/cancel`, `/publish`, `/retry`, `/reopen`, `/confirm`). Aucun client ne peut
écrire un statut arbitraire : `publicationTransitions` est la seule source de vérité, partagée
par l'API, l'interface et les tests.

Une seule arête sort du schéma strict : `FAILED → PUBLISHED`, réservée à la confirmation
manuelle. Elle est commentée dans le code et verrouillée par un test.

### Fonctions (§10.4)

- Sélection de plusieurs comptes à la création, variante éditoriale par réseau ensuite.
- Prévisualisation par cible avec compteur de caractères face à la limite réelle, erreurs
  bloquantes et avertissements non bloquants.
- Publication immédiate, programmation, déplacement d'échéance.
- Duplication et réutilisation (la copie repart en brouillon, sans échéance).
- Historique complet (`PublicationEvent`) et journal d'audit.
- Nouvelle tentative bornée à **3 essais**, après quoi `retry` renvoie 409 et la relance
  disparaît des transitions proposées.
- Replis proposés en cas d'échec, calculés à partir de la plateforme concernée : export du texte,
  publication manuelle, ou brouillon.

### Programmation

La boucle tourne dans le processus de l'API (`PUBLISH_SCHEDULER=on`, tick de 60 s par défaut).
L'offre gratuite Render n'offre pas de worker séparé, et un cron externe aurait ajouté une pièce
mobile pour rien.

La réclamation est atomique : `updateMany({ where: { id, status: 'SCHEDULED' } })` sert de
verrou, donc deux instances ne peuvent pas envoyer la même publication. Une publication
programmée depuis plus de **7 jours** sans envoi passe automatiquement en `EXPIRED` plutôt que
d'être envoyée en retard.

`POST /publications/run-due` (ADMIN) déclenche le même traitement immédiatement : dépannage
opérationnel et tests déterministes.

### Content Calendar (§11)

- Vues **mois**, **semaine**, **jour** et **liste**.
- Filtres par réseau, marque et statut.
- Glisser-déposer pour déplacer une publication : `POST /publications/:id/reschedule` conserve
  l'état `SCHEDULED` et journalise « Échéance modifiée ».
- Création rapide sur un jour donné, duplication depuis la vue liste.
- **Fuseau horaire par organisation** (`PATCH /organizations/:id/timezone`), avec validation du
  fuseau contre `Intl`. Les dates restent stockées en UTC ; le fuseau ne sert qu'à l'affichage et
  à l'interprétation des saisies. Le calendrier regroupe les entrées avec le fuseau de
  l'organisation, jamais avec celui du navigateur : une publication à 00:30 n'apparaît pas la
  veille pour un visiteur situé ailleurs.

## Modèle de données

```prisma
model Publication {
  postType PostType            // format
  mode     PublicationMode     // AUTO | APPROVAL
  status   PublicationStatus
  scheduledAt DateTime?        // UTC
  timezone    String           // fuseau au moment de la programmation
  attempts    Int
  lastError   String?
  mediaIds    String[]
  targets  PublicationTarget[]
  events   PublicationEvent[]
}

model PublicationTarget {
  platform SocialPlatform
  body     String
  hashtags String[]
  status   PublicationTargetStatus  // PENDING | PUBLISHED | FAILED | SKIPPED
  externalUrl String?               // preuve de publication
  @@unique([publicationId, socialAccountId])
}
```

`Organization.timezone` a été ajoutée (défaut `Europe/Paris`). Migration
`20261115220000_phase6_publishing` appliquée sur Neon — 7 migrations au total.

Le statut de chaque cible est indépendant : une publication peut réussir sur LinkedIn et échouer
sur X sans que l'ensemble soit perdu.

## Interface

- **Centre de publication** : création, filtres, détail par cible éditable, boutons d'action
  déduits des transitions autorisées, solutions de repli, export copiable, confirmation par URL,
  historique.
- **Calendrier éditorial** : quatre vues, filtres, glisser-déposer, création rapide.
- Deux compteurs ajoutés au tableau de bord : publications et publications programmées.

## Tests

| Suite                                 | Portée                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/publishing/transitions.test.ts`  | 12 tests : toutes les arêtes autorisées et interdites, absence d'auto-transition, états terminaux            |
| `src/publishing/capabilities.test.ts` | 18 tests : limites de caractères, hashtags comptés, média obligatoire, formats refusés, titres               |
| `src/publishing/connectors.test.ts`   | 13 tests : adaptateur inerte, webhook, refus d'un 200 sans référence, 429, réseau injoignable, délai dépassé |
| `scripts/smoke-phase6.mjs`            | **106 vérifications** de bout en bout                                                                        |

Le smoke test couvre le circuit complet, les transitions interdites, l'échec honnête, l'export,
la confirmation partielle puis complète, la duplication, le bornage des tentatives, la
réclamation d'échéance, les quatre filtres du calendrier, le fuseau horaire, le RBAC et
l'isolation multi-tenant.

## Ce qui reste pour publier réellement

1. Identifiants d'application OAuth (Meta, TikTok, LinkedIn, Google, X, Pinterest) et un
   adaptateur par réseau implémentant `SocialConnector`.
2. Ou, sans attendre : définir `PUBLISH_WEBHOOK_URL` et `PUBLISH_WEBHOOK_SECRET` pour déléguer
   l'envoi à un scénario externe.
3. Médias : la publication référence des `mediaIds`, mais l'upload réel attend le stockage objet
   (R2 ou Supabase Storage), bloqué par la carte bancaire.
