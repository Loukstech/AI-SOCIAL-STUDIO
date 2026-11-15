# Phase 9 — Connexion des comptes sociaux (§9)

**Statut : TERMINÉE.**

## Ce qui est livré

Le §9 demande le cycle de vie complet d'une connexion : autoriser, échanger le
code, lire le profil, stocker les jetons chiffrés, renouveler, détecter la
panne, et déclarer par plateforme ce qui est réellement possible.

Ce cycle est **entièrement implémenté et testé**. Ce qui manque n'est pas du
code : ce sont les identifiants d'application de chaque fournisseur. Sans eux,
l'API refuse la connexion en nommant les variables exactes à renseigner. Aucune
connexion n'est jamais simulée.

```
POST /api/v1/social-accounts/connect
{ "platform": "INSTAGRAM" }

409 — Connexion Instagram Professional indisponible : renseignez META_CLIENT_ID,
      META_CLIENT_SECRET. Aucun identifiant d'application OAuth n'est configuré
      sur ce déploiement.
```

### Le flux d'autorisation (§9.1)

| Étape                 | Route                                 | Rôle     |
| --------------------- | ------------------------------------- | -------- |
| Ouvrir la connexion   | `POST /social-accounts/connect`       | `ADMIN`  |
| Retour du fournisseur | `GET /social-accounts/oauth/callback` | public   |
| Renouveler            | `POST /social-accounts/:id/refresh`   | `ADMIN`  |
| Synchroniser          | `POST /social-accounts/:id/sync`      | `EDITOR` |
| Santé des connexions  | `GET /social-accounts/health`         | `VIEWER` |

Le retour du fournisseur est **public par nécessité** : le navigateur y arrive
par redirection, sans en-tête `Authorization`. La sécurité ne repose donc pas
sur la session mais sur l'état signé, vérifié à chaque appel.

### Trois protections sur l'état OAuth

L'état (`state`) transporte l'organisation, la plateforme, le compte à
réautoriser et le vérificateur PKCE. Il n'est pas stocké en base : il est signé.

1. **Signature HMAC-SHA256**, comparée en temps constant. Un état forgé est
   rejeté avant toute lecture.
2. **Expiration à 10 minutes.** Un état qui traîne dans un historique de
   navigation ne peut plus servir.
3. **Vérificateur PKCE chiffré** (AES-256-GCM). L'état transite par le
   navigateur : un vérificateur lisible annulerait l'intérêt de PKCE pour qui
   intercepterait le code d'autorisation.

Le type de plateforme est revalidé à la lecture : un état valide mais porteur
d'une valeur hors contrat ne passe pas.

### PKCE, là où il est exigé — et seulement là

| Plateforme                          | PKCE | Secret client | Renouvellement         |
| ----------------------------------- | ---- | ------------- | ---------------------- |
| Facebook, Instagram, Threads (Meta) | non  | oui           | non (jeton long)       |
| LinkedIn                            | oui  | oui           | oui                    |
| X                                   | oui  | oui           | oui (`offline.access`) |
| TikTok                              | oui  | oui           | oui                    |
| YouTube (Google)                    | oui  | oui           | oui                    |
| Pinterest                           | non  | oui           | oui                    |

`code_challenge_method=S256` n'est ajouté **que** si un défi est fourni :
l'envoyer sans défi casse certains fournisseurs. L'algorithme est vérifié
contre le vecteur de test du RFC 7636 annexe B — la preuve que c'est bien
`BASE64URL(SHA256(verifier))` et pas autre chose.

### Lecture des profils (§9.2)

Chaque réseau nomme différemment les mêmes informations. Plutôt que huit
fonctions presque identiques, les chemins sont **une donnée** :

```ts
X:      { id: ['data.id'], username: ['data.username'], … }
TIKTOK: { id: ['data.user.open_id', 'data.user.union_id'], … }
LINKEDIN: { id: ['sub'], username: ['preferred_username', …], … }
```

Un profil sans identifiant externe est refusé : sans lui, aucune connexion ne
peut être rattachée, et créer une ligne au hasard produirait une connexion
fantôme.

### Détection d'erreur (§9.3)

Une synchronisation qui échoue **n'est pas une exception** : l'échec est
enregistré sur le compte et renvoyé avec lui.

```json
{
  "status": "ERROR",
  "lastError": "Synchronisation Instagram Professional impossible : renseignez META_CLIENT_ID.",
  "lastErrorAt": "2026-11-15T22:20:11.004Z",
  "lastSyncedAt": "2026-11-15T22:20:11.004Z"
}
```

L'interface peut alors guider la reconnexion au lieu d'afficher un compte
faussement sain. Un succès efface `lastError` et `lastErrorAt`.

Six états sont distingués, par ordre de priorité :

| État       | Signification                     | Marche à suivre affichée           |
| ---------- | --------------------------------- | ---------------------------------- |
| `REVOKED`  | compte déconnecté                 | reconnecter                        |
| `NO_TOKEN` | aucun jeton enregistré            | lancer la connexion                |
| `EXPIRED`  | jeton expiré                      | renouveler                         |
| `ERROR`    | dernière synchronisation en échec | vérifier les permissions           |
| `EXPIRING` | expire dans moins de 72 h         | renouveler pour éviter une coupure |
| `OK`       | opérationnelle                    | —                                  |

Le renouvellement ne remplace **jamais** un jeton de rafraîchissement existant
par une absence : certains fournisseurs n'en renvoient pas de nouveau.

### Interface commune des adaptateurs (§9.4)

```ts
interface SocialConnector {
  connect();
  refreshToken();
  getAccountInfo();
  getCapabilities();
  validatePost(post);
  publish(post);
  getPublishStatus(id);
  getAnalytics(id);
  disconnect();
}
```

Deux niveaux sont séparés volontairement :

- le **transport** (`SocialTransport`) : comment un envoi quitte la machine ;
- l'**adaptateur** (`SocialConnector`) : ce que le réseau autorise réellement.

Chaque méthode répond honnêtement :

| Méthode                                 | Réponse aujourd'hui                                                  |
| --------------------------------------- | -------------------------------------------------------------------- |
| `getCapabilities`                       | réelle — formats, médias, limites, permissions, variables manquantes |
| `validatePost`                          | réelle — les règles de la plateforme, réutilisées par l'envoi        |
| `publish`                               | réelle via le transport configuré, sinon `NOT_CONFIGURED`            |
| `getPublishStatus`                      | `UNKNOWN` — un webhook ne permet pas de relire l'état distant        |
| `getAnalytics`                          | `metrics: null` — aucune statistique inventée                        |
| `connect`, `refreshToken`, `disconnect` | `NOT_SUPPORTED` + la route qui le fait vraiment                      |

`connect()` sur un adaptateur renvoie vers `POST /social-accounts/connect` : la
connexion vit dans `OAuthService`, qui manipule des jetons chiffrés et une ligne
en base — ce qu'un adaptateur sans état ne peut pas faire. Ce n'est pas un
contournement, c'est une répartition exacte des responsabilités.

La validation appartient désormais à l'adaptateur : `publish()` ne part plus
jamais avec une cible que la plateforme refusera.

### Ce que l'interface montre

- L'état de chaque connexion, avec un compte à rebours lisible (« expire dans
  12,4 h », « expiré depuis 3 j ») plutôt qu'une date brute.
- Les permissions réellement accordées.
- La dernière panne, datée et expliquée.
- Les variables d'environnement qui bloquent chaque plateforme.
- Un tableau **par réseau** : formats acceptés, envoi possible ou non, repli
  prévu, ce qui bloque. Huit réseaux, huit réponses distinctes.

## Configuration requise

Aucune variable n'est obligatoire pour démarrer : sans elles, la connexion est
refusée avec un message qui nomme ce qui manque.

| Variable                                          | Usage                                                   |
| ------------------------------------------------- | ------------------------------------------------------- |
| `API_PUBLIC_URL`                                  | base publique de l'API, pour construire l'URL de retour |
| `OAUTH_REDIRECT_URL`                              | surcharge explicite de l'URL de retour                  |
| `OAUTH_HTTP_TIMEOUT_MS`                           | délai des appels au fournisseur (10 000 ms par défaut)  |
| `META_CLIENT_ID` / `META_CLIENT_SECRET`           | Facebook, Instagram, Threads                            |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`   | LinkedIn                                                |
| `X_CLIENT_ID` / `X_CLIENT_SECRET`                 | X                                                       |
| `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET`       | TikTok                                                  |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`       | YouTube                                                 |
| `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | Pinterest                                               |

L'URL de retour à déclarer chez chaque fournisseur est
`{API_PUBLIC_URL}/api/v1/social-accounts/oauth/callback`.

## Vérification

```bash
pnpm test:phase9     # 57 vérifications en ligne
```

Couvre : le refus motivé sans identifiants (Meta, X), la plateforme inconnue
refusée, le retour OAuth qui redirige sans jamais renvoyer de JSON, l'état de
santé, la panne de synchronisation enregistrée et expliquée, les limites du
renouvellement par plateforme, les capacités déclarées par réseau, le RBAC et
l'isolation multi-tenant.

Tests unitaires : **266** au total, dont 37 sur les briques OAuth pures
(PKCE RFC 7636, état signé/expiré/altéré, construction d'URL, profils) et 27 sur
le service avec un transport simulé (échange, renouvellement, panne, santé).

## Ce qui reste à faire pour publier vraiment

1. **Créer les applications OAuth** chez les fournisseurs et renseigner les
   variables ci-dessus.
2. **Passer la revue de plateforme** quand elle est exigée (TikTok, Instagram
   content publishing, LinkedIn Page).
3. **Écrire les adaptateurs d'envoi natifs** — `publish()` délègue aujourd'hui à
   un transport externe. Les jetons obtenus par ce flux sont précisément ce
   qu'il faut pour les brancher.
