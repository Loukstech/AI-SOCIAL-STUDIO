# Phase 12 — Collaboration (§14)

**Statut : TERMINÉE.**

## Ce qui est livré

Le §14 demande un espace client : commentaires, assignation de tâches,
historique des modifications et validation par le client. Une phrase du cahier
des charges commande tout le reste :

> « Un client doit pouvoir approuver ou refuser les contenus qui le concernent
> sans accéder aux autres clients ni aux paramètres internes de l'agence. »

Cette phrase n'est pas un rôle de plus : c'est une **règle de visibilité**. Un
commentaire interne reste interne, y compris pour un client qui a le droit de
commenter. Le filtre est appliqué dans la requête SQL, pas à l'écran.

### Les routes

| Route                             | Rôle requis                | Remarque                                        |
| --------------------------------- | -------------------------- | ----------------------------------------------- |
| `GET /publications/:id/comments`  | `VIEWER`                   | filtré par visibilité                           |
| `POST /publications/:id/comments` | `CLIENT`                   | visibilité forcée pour un client                |
| `PATCH /comments/:id`             | `CLIENT`                   | texte : auteur ; résolution : éditeur ou auteur |
| `DELETE /comments/:id`            | `CLIENT`                   | auteur ou administrateur                        |
| `GET /tasks`                      | `VIEWER`                   | filtres contenu / assigné / statut              |
| `POST /tasks`                     | `EDITOR`                   | assigné = membre obligatoire                    |
| `PATCH /tasks/:id`                | `EDITOR`                   | `completedAt` suit `status`                     |
| `DELETE /tasks/:id`               | `EDITOR`                   |                                                 |
| `GET /publications/:id/history`   | `VIEWER`                   | quatre sources fusionnées                       |
| `GET /portfolio`                  | authentifié                | toutes les organisations de l'utilisateur       |
| `POST /publications/:id/approve`  | `OWNER`, `ADMIN`, `CLIENT` | **plus** `ADMIN` seul                           |
| `POST /publications/:id/reject`   | `OWNER`, `ADMIN`, `CLIENT` | idem                                            |

## Six décisions

### 1. `CLIENT` est un rôle, mais la validation n'est pas un rang

Un client doit pouvoir valider ; un éditeur ne doit pas valider son propre
travail. Aucun seuil dans une hiérarchie linéaire ne satisfait ces deux
contraintes : si `CLIENT` passe au-dessus d'`EDITOR`, l'éditeur valide aussi ;
s'il passe en dessous, le client ne valide plus.

D'où un second décorateur, `@OnlyRoles('OWNER', 'ADMIN', 'CLIENT')`, à côté de
`@MinRole`. La route d'approbation porte les deux : `@MinRole('VIEWER')` pour
exiger une appartenance, `@OnlyRoles(...reviewerRoles)` pour nommer les rôles
autorisés. `reviewerRoles` est exporté par `@ass/shared`, donc l'API et
l'interface lisent la même liste.

### 2. La visibilité est filtrée en base

`CommentsService.list()` ajoute `visibility: 'CLIENT'` au `where` quand le rôle
est `CLIENT`. La ligne interne ne quitte jamais PostgreSQL : elle n'est pas
envoyée puis masquée côté navigateur. Un test le vérifie sur le JSON complet de
la réponse, pas seulement sur les champs affichés.

La même règle s'applique à l'historique et aux compteurs du portefeuille.

### 3. Une réponse hérite de la visibilité de son parent

Sans cet héritage, deux fuites symétriques :

- un client répondant à un commentaire visible créerait un fil interne ;
- un interne répondant à un fil client divulguerait une note privée.

`create()` lit donc le parent et **écrase** la visibilité demandée. Un client
qui répond à un commentaire interne reçoit `404` — pas `403` : l'existence du
commentaire n'est pas divulguée.

Les réponses ne s'imbriquent que sur **un niveau** : une réponse à une réponse
est refusée en `400`. L'interface regroupe par `parentId` et une réponse
orpheline (parent masqué) est traitée comme une racine plutôt que d'être perdue.

### 4. L'historique ne cache pas ce qu'il ne sait pas nommer

Quatre sources hétérogènes — `PublicationEvent`, `AuditLog`, `Comment`,
`Task` — fusionnées en une chronologie décroissante, avec un libellé **rédigé
côté serveur** : un historique est une lecture d'audit, la phrase doit être
vérifiable et identique dans l'export comme dans l'interface.

Une action sans libellé connu s'affiche avec son code brut
(`Action « publication.archived_by_cron »`) au lieu de disparaître. Un trou dans
un historique est pire qu'un libellé sec.

Découverte en cours de route : la saisie de mesures est journalisée contre
`publication_target`, pas contre la publication. Sans résoudre les cibles du
contenu, l'événement `analytics.metric_recorded` manquait à l'historique alors
qu'il en fait partie. `forPublication()` résout donc les identifiants de cibles
et interroge les deux `targetType`.

`truncated` compte les entrées antérieures à la fenêtre : l'interface peut dire
« N événements plus anciens » au lieu de laisser croire que tout commence là.

### 5. Un client est une organisation

Il n'existe pas d'entité `Client` séparée, et en inventer une dupliquerait les
tenants, les rôles et l'isolation déjà en place. Le portefeuille est donc la
liste des organisations dont l'utilisateur est membre, chacune résumée.

Conséquence assumée et vérifiée en E2E : un client invité appartient à **deux**
organisations — celle de l'agence, et celle créée automatiquement à son
inscription, dont il est propriétaire. Le portefeuille les liste toutes les
deux, ce qui est exact ; c'est l'interface qui les distingue par leur nom.

Les compteurs d'un client n'incluent pas les commentaires internes : un résumé
ne doit pas laisser deviner ce qu'il ne peut pas lire. Une organisation sans
activité renvoie `lastActivityAt: null`, jamais une date arbitraire.

### 6. Les tâches sont gérées par l'agence

Lecture ouverte à tout membre, écriture réservée à `EDITOR` et au-dessus. Une
tâche est un engagement de production, pas un fil de discussion : laisser un
client réassigner ou annuler une tâche rendrait le suivi interne inutilisable.
Le client dispose du commentaire et de la validation pour s'exprimer, et
l'interface le dit au lieu de cacher les boutons sans explication.

## Modèle de données

```
enum OrganizationRole  { OWNER ADMIN EDITOR CLIENT VIEWER }   ← CLIENT ajouté
enum CommentVisibility { INTERNAL CLIENT }
enum TaskStatus        { OPEN DONE CANCELLED }

model Comment  { organizationId, entityType, entityId, authorId, body,
                 visibility, parentId (self-relation CommentThread),
                 resolvedAt, resolvedById, deletedAt }
model Task     { organizationId, entityType?, entityId?, title, description?,
                 status, assigneeId?, createdById?, dueAt?, completedAt? }
```

Migration `20261116080000_phase12_collaboration` appliquée sur Neon —
**14 migrations au total**. Suppression logique des commentaires (`deletedAt`) :
le fil reste lisible dans l'historique.

## Interface

- Fiche d'un contenu : fil de discussion (fils regroupés, portée visible,
  résolution), tâches liées (échéance, retard, terminer/annuler/rouvrir),
  historique fusionné avec badges de type.
- Nouvelle page **Espace client** : cartes par organisation, compteurs, dernière
  activité, totaux d'agence.
- Le rôle et l'identifiant viennent de l'application : l'écran ne propose pas
  une action que l'API refusera. L'API reste seule juge.
- `useAsyncData` : chargement et rechargement explicite, sans `setState`
  synchrone dans un effet (règle du compilateur React). Après une action, on
  relit la vérité du serveur plutôt que de rafistoler l'état local.

## Qualité

- **383 tests unitaires** (36 nouveaux : visibilité, héritage, profondeur,
  permissions de résolution, invariants de tâches, fusion et libellés
  d'historique, compteurs de portefeuille).
- `pnpm test:phase12` — **83 vérifications E2E** sur un vrai parcours à quatre
  rôles (propriétaire, éditeur, client, lecteur).
- Lint, typecheck, build et `format:check` verts.
- Aucune régression : phases 6, 10 et 11 rejouées en local après le changement
  RBAC sur `approve` / `reject` (106, 97 et 86 vérifications).
