# Phase 11 — Notifications (§15)

**Statut : TERMINÉE.**

## Ce qui est livré

Le §15 demande des notifications « internes et e-mail » pour dix événements,
avec préférences par utilisateur, déduplication et journal.

Ce qui est livré, c'est cela — **et la vérité sur ce qui manque**. Sur les dix
événements, six sont réellement émis. Les quatre autres dépendent de
sous-systèmes qui n'existent pas encore (rendu vidéo, facturation) : ils sont
déclarés **non disponibles avec leur motif** dans un catalogue public, plutôt
que de produire une notification qui n'arrivera jamais.

```
GET /api/v1/notifications/catalog

{
  "events": [
    { "type": "PUBLICATION_PUBLISHED", "label": "Publication réussie", "wired": true,  "reason": null },
    { "type": "VIDEO_READY",          "label": "Vidéo terminée",       "wired": false,
      "reason": "Aucun moteur de rendu (ffmpeg) n’est branché : un projet vidéo
                 n’atteint jamais l’état « rendu terminé », donc l’événement n’a
                 pas encore de source." }
  ],
  "email": {
    "available": false,
    "reason": "Aucun transport e-mail transactionnel n’est configuré sur ce
               déploiement : les notifications restent internes…"
  }
}
```

### Les routes

| Route                             | Rôle                                                   |
| --------------------------------- | ------------------------------------------------------ |
| `GET /notifications`              | boîte de réception (filtres `unread`, `type`, `limit`) |
| `GET /notifications/unread-count` | compteur de la pastille                                |
| `GET /notifications/catalog`      | événements du §15 + état du canal e-mail               |
| `GET /notifications/preferences`  | grille complète, valeurs par défaut comprises          |
| `PUT /notifications/preferences`  | enregistrement des seuls réglages modifiés             |
| `POST /notifications/:id/read`    | marquer comme lue                                      |
| `POST /notifications/read-all`    | tout marquer comme lu                                  |
| `DELETE /notifications/:id`       | supprimer                                              |

Toutes les routes sont **personnelles** : aucun rôle particulier n'est exigé,
mais on ne voit que ses propres notifications. Une notification appartenant à
quelqu'un d'autre — ou à une autre organisation — renvoie `404`, pas `403` :
son existence n'est pas divulguée.

## Quatre décisions qui portent l'honnêteté

### 1. Un événement qu'on ne sait pas produire n'est pas notifié

Le type existe dans le contrat, la préférence existe, la ligne de catalogue
existe — mais `wired: false` et un motif nomment le sous-système manquant. Le
catalogue est la source unique : l'API et l'interface le lisent au même endroit,
donc ils ne peuvent pas diverger.

Les motifs sont explicites sur la cause **et** sur la section concernée :

| Événement        | Motif                                                |
| ---------------- | ---------------------------------------------------- |
| `VIDEO_READY`    | Aucun moteur de rendu (ffmpeg) branché               |
| `EXPORT_READY`   | Les exports sont synchrones : pas de file à notifier |
| `CREDITS_LOW`    | Aucun système de crédits (§16)                       |
| `PAYMENT_FAILED` | Aucun prestataire de paiement (§16)                  |

### 2. Un e-mail qui n'est pas parti n'est pas présenté comme parti

Le canal e-mail conserve un statut **explicite** par notification :

| Statut          | Sens                                                       |
| --------------- | ---------------------------------------------------------- |
| `NOT_REQUESTED` | L'utilisateur n'a pas activé l'e-mail pour ce type         |
| `NO_PROVIDER`   | **Aucun transport configuré** : rien n'a été tenté         |
| `SENT`          | Un transport réel a accepté le message                     |
| `FAILED`        | Un envoi a été tenté et a échoué, avec le message d'erreur |

`NO_PROVIDER` n'est pas un échec : c'est un aveu. La distinction compte, parce
que l'un demande d'aller voir la configuration, l'autre demande de réessayer.

Le transport est une interface injectable (`MAIL_TRANSPORT`). Par défaut, le
module fournit `noopMailTransport`, qui **refuse d'envoyer** et le dit. Brancher
un fournisseur consiste à remplacer une ligne dans `SaasModule` ; rien d'autre
ne change. Les tests injectent un transport simulé pour vérifier le chemin
`SENT` sans jamais prétendre qu'il existe en production.

### 3. La déduplication est une clé, pas une fenêtre

Deux échecs de la même publication ne doivent pas remplir la boîte. La clé
(`publication:{id}:failed`) est **sans horodatage** : la seconde occurrence
incrémente un compteur et remet la notification en non-lue.

```
1re synchro en échec → 1 notification, occurrences: 1
2e  synchro en échec → 1 notification, occurrences: 2
```

L'index unique `(organizationId, userId, dedupeKey)` protège d'une course entre
deux émissions simultanées : la seconde insertion échoue, on relit la ligne
gagnante et on la cumule.

### 4. Une notification ne casse jamais ce qu'elle annonce

`notifyPublication` est appelée depuis `apply()`, le passage obligé de toute
transition d'état. Elle n'attrape pas seulement les erreurs : elle ne les
propage **jamais**. Une publication réussie ne doit pas être annulée parce qu'un
avertissement n'a pas pu être déposé. L'échec est journalisé avec le contexte.

## Qui reçoit quoi

| Événement                     | Destinataires                             |
| ----------------------------- | ----------------------------------------- |
| Demande de validation         | Propriétaires et administrateurs          |
| Contenu approuvé / refusé     | Auteur du contenu, sinon les responsables |
| Publication réussie / échouée | Auteur du contenu, sinon les responsables |
| Connexion sociale expirée     | Propriétaires et administrateurs          |

Deux règles s'appliquent toujours :

- **l'auteur de l'action n'est jamais destinataire de sa propre notification** —
  approuver son propre contenu ne produit pas d'écho ;
- **un auteur qui a quitté l'espace ne perd pas l'information** : elle bascule
  vers les responsables plutôt que de disparaître.

## Préférences

Une ligne par type et par utilisateur, avec `inApp` et `email`. Par défaut :
interne **activé**, e-mail **désactivé** — parce qu'aucun transport n'existe.

Une préférence non touchée n'est **pas** écrite en base : seule une ligne
réellement modifiée est enregistrée. L'utilisateur ne fige donc pas, sans le
savoir, un réglage qu'il n'a jamais exprimé. L'interface marque d'ailleurs d'un
badge « personnalisé » les seules lignes concernées.

Quand seul l'e-mail est demandé, la ligne est tout de même créée (`inApp:
false`) : elle constitue le journal de la tentative d'envoi, mais n'entre pas
dans la boîte de réception ni dans le compteur.

## Modèle

```prisma
enum NotificationType { PUBLICATION_PUBLISHED PUBLICATION_FAILED APPROVAL_REQUESTED
                        CONTENT_APPROVED CONTENT_REJECTED VIDEO_READY EXPORT_READY
                        SOCIAL_CONNECTION_EXPIRED CREDITS_LOW PAYMENT_FAILED }

enum NotificationEmailStatus { NOT_REQUESTED NO_PROVIDER SENT FAILED }

model Notification {
  id             String
  organizationId String
  userId         String
  type           NotificationType
  title          String
  body           String
  entityType     String?    // 'publication' | 'social_account'
  entityId       String?
  url            String?    // ancre de page : '#publishing', '#social'
  dedupeKey      String?
  occurrences    Int        @default(1)
  inApp          Boolean    @default(true)
  readAt         DateTime?
  createdAt      DateTime   @default(now())
  lastOccurredAt DateTime   @default(now())
  emailStatus    NotificationEmailStatus @default(NOT_REQUESTED)
  emailError     String?
  @@unique([organizationId, userId, dedupeKey])
}

model NotificationPreference {
  organizationId String
  userId         String
  type           NotificationType
  inApp          Boolean @default(true)
  email          Boolean @default(false)
  @@unique([organizationId, userId, type])
}
```

Migrations `20261116070000_phase11_notifications` et
`20261116071000_phase11_notification_channel` appliquées sur Neon
(**13 migrations** au total).

## L'interface

Page « Notifications » :

- pastille de compteur dans la navigation, rafraîchie toutes les 45 s ;
- boîte de réception avec filtres « non lues » et par type, corps du message,
  nombre d'occurrences, statut e-mail en infobulle ;
- actions Ouvrir / Marquer lu / Supprimer, et « tout marquer comme lu » ;
- bandeau d'avertissement quand le canal e-mail n'est pas configuré ;
- grille de préférences 10 × 2 avec badge « personnalisé » ;
- catalogue des événements avec état réel et motif.

## Vérification

```bash
pnpm --filter @ass/api test    # 347 tests unitaires, dont 46 sur les notifications
pnpm test:phase11              # 86 vérifications E2E
```

Le parcours E2E crée un propriétaire et un éditeur, fait passer une publication
par tout le circuit du §10 (soumission → demande de validation → approbation →
échec d'envoi → confirmation), et vérifie à chaque étape **qui** est notifié :

- une soumission seule ne notifie personne ;
- la demande de validation notifie le responsable, avec le titre et les réseaux ;
- l'approbation et le refus notifient l'auteur, avec le motif du refus ;
- l'échec puis la confirmation notifient l'auteur ;
- deux synchronisations en échec produisent **une** notification à deux
  occurrences ;
- un e-mail demandé sans transport porte `NO_PROVIDER` et son motif ;
- un lecteur gère ses propres notifications mais ne voit pas celles des autres ;
- une autre organisation voit une boîte vide et ne peut pas lire les nôtres.

## Ce qui reste hors de portée

- **L'envoi d'e-mail réel.** Aucun fournisseur transactionnel n'est branché :
  le point d'injection existe, l'implémentation est un refus explicite.
- **Les quatre événements non branchés**, listés ci-dessus avec leur motif.
- **Les notifications temps réel** (WebSocket). La pastille interroge l'API
  toutes les 45 s : suffisant à cette échelle, et sans serveur supplémentaire.
