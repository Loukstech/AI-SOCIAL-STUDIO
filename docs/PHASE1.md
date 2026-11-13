# Plan détaillé de la Phase 1

## Objectifs

Fonder une application SaaS opérationnelle avec authentification, organisations multi-tenant, et schéma de données.

## Décisions en attente

Avant de commencer, choisir :

1. **Langue de l'interface** : français seul, ou français + anglais ?

Les autres décisions sont prises :
- **Authentification** : Supabase Auth (e-mail, Google, vérification, réinitialisation).
- **Stockage** : Supabase Storage (50 Mo/fichier) — gratuit, pas de carte bancaire requise.

## Étapes

### 1. Authentification (Supabase Auth)

**Nouvelle base Supabase ou existante ?**
- Supabase inclut PostgreSQL, Auth, Storage, Realtime.
- Neon + Supabase Auth : deux services à gérer.
- Recommandation : créer un projet Supabase pour inclure Auth nativement.

**À implémenter :**
- Création de compte (e-mail + mot de passe).
- Connexion Google OAuth.
- Vérification de l'adresse e-mail.
- Réinitialisation de mot de passe.
- Gestion de session.
- Profil utilisateur (nom, photo, préférences).

**Backend :**
- Module `auth` NestJS : vérifie le JWT, extrait l'utilisateur, protège les endpoints.
- Contrôle d'accès : chaque requête doit vérifier l'organisation active.

**Frontend :**
- Pages : inscription, connexion, vérification e-mail, réinitialisation, profil.
- Redirection post-login.

### 2. Organisations multi-tenant

**Schéma :**
```
Utilisateur
  ├─ Memberships (avec Rôle)
       └─ Organisation
             ├─ Brands
             ├─ SocialAccounts
             ├─ Contents
             └─ Clients (pour agence)
```

**Tables :**
- `users` : id, email, created_at.
- `organizations` : id, name, owner_id, created_at.
- `memberships` : user_id, organization_id, role, created_at.
- `roles` : id (owner, admin, manager, editor, publisher, analyst, viewer, client).
- `permissions` : id, role_id, resource, action (read, create, update, delete).

**Contrôle d'accès :**
- `RBAC` : chaque requête reçoit user_id et organization_id.
- Validation : l'utilisateur appartient-il à cette organisation ? A-t-il le rôle requis ?

**Backend :**
- Module `organizations` : créer, lister, mettre à jour, inviter des membres.
- Module `memberships` : gérer les rôles, permissions.
- Middleware : injecter l'organisation active à chaque requête.

**Frontend :**
- Écran de création d'organisation.
- Écran de sélection d'organisation active.
- Gestion des membres.

### 3. Schéma de données détaillé

**Domaines métier (Phase 0 ne contient aucun modèle) :**

#### Marques (Brand Kit)
- `brands` : id, organization_id, name, logo_url, color_palette (JSON), guidelines (texte).
- `brand_assets` : id, brand_id, type (logo, image, font), url, created_at.

#### Comptes sociaux
- `social_accounts` : id, organization_id, brand_id, platform, username, avatar_url, access_token (chiffré), refresh_token (chiffré), token_expires_at.
- `social_account_syncs` : id, social_account_id, last_sync_at, status.

#### Contenus
- `content_projects` : id, organization_id, name, status (draft, ready, in_review, scheduled, published).
- `content_items` : id, project_id, type (text, image, video, carousel), prompt, content (JSON), created_at.
- `content_variants` : id, content_item_id, platform (instagram, tiktok, facebook, linkedin), text, media_url, created_at.
- `template_categories` : id, organization_id, name.
- `templates` : id, category_id, name, structure (JSON).

#### Vidéos
- `video_projects` : id, organization_id, name, source_url, status, created_at.
- `video_sources` : id, project_id, file_url, duration, resolution, codec.
- `transcripts` : id, source_id, text, language, detected_language.
- `subtitles` : id, source_id, style (professional, minimal, karaoké), language, srt_url.
- `render_jobs` : id, source_id, status (pending, processing, completed, failed), progress, created_at.
- `render_outputs` : id, job_id, format (mp4, mov), resolution, ratio, file_url, size_bytes.

#### Publications
- `publications` : id, organization_id, status (draft, ready_for_review, pending_approval, approved, scheduled, published, failed), created_at, scheduled_for.
- `publication_targets` : id, publication_id, social_account_id, status, response_id (ID externe du post).
- `publication_approvals` : id, publication_id, requested_by_id, approved_by_id, status (pending, approved, rejected), reason.
- `scheduled_jobs` : id, publication_id, scheduled_at, status.

#### Médias
- `media_assets` : id, organization_id, file_url, type (image, video, audio, document), size_bytes, mime_type, created_at.
- `media_folders` : id, organization_id, name, parent_id (pour arborescence).
- `media_tags` : id, organization_id, name.
- `media_asset_tags` : asset_id, tag_id.

#### Facturation et crédits (Phase 7)
- `plans` : id, name, credits_per_month, price_cents.
- `subscriptions` : id, organization_id, plan_id, status (active, cancelled), renews_at.
- `credit_wallets` : id, organization_id, balance_credits, updated_at.
- `credit_transactions` : id, wallet_id, amount, reason (purchase, usage, refund), created_at.

#### Administration
- `audit_logs` : id, organization_id, user_id, action, resource, created_at.

### 4. Tests

- Tests unitaires : authentification, permissions, calculs de crédits.
- Tests d'intégration : création d'organisation, ajout de membre, création de contenu.
- Tests E2E : inscription → création organisation → invitation membre → création contenu → publication.

## Livrables de Phase 1

1. Module authentification (Supabase Auth).
2. Module organisations et memberships.
3. Schéma Prisma complet avec 20+ tables.
4. Migrations Prisma.
5. RBAC et middleware de contrôle d'accès.
6. Pages frontend : inscription, connexion, organisations, membres, profil.
7. Tests unitaires et d'intégration.
8. Dashboard simplifié : organisations, membres, états.

## Calendrier estimé

À définir selon disponibilité. Phase 1 prend généralement 2-3 semaines en développement full-time.

## Points de décision avant lancement

1. **Supabase ou Neon+Auth ?** Supabase inclut tout en un, Neon+Auth sépare les services.
2. **Domaine personnalisé ?** Render et Cloudflare Pages acceptent des domaines.
3. **Multi-langage dès Phase 1 ?** Ajoute i18n (internationalisation), à budgéter.
