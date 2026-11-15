# Phase 3 — AI Video Studio

> **Statut : LIVRÉE** (15 novembre 2026).

## Objectif

Ouvrir le studio de production : un projet vidéo par livrable, sa transcription, puis ses
sous-titres dans trois styles, exportables en `.srt`. C'est la fondation sur laquelle le rendu
vidéo (ffmpeg) et le montage viendront se greffer.

## Périmètre livré

### Projets vidéo

- Modèle `VideoProject` : nom, description, URL de source facultative, langue, durée,
  marque associée facultative, statut (`DRAFT`, `TRANSCRIBING`, `TRANSCRIBED`, `FAILED`),
  suppression logique.
- Routes :
  - `GET /api/v1/video-projects` (VIEWER)
  - `POST /api/v1/video-projects` (EDITOR)
  - `GET /api/v1/video-projects/:id` (VIEWER) — renvoie la transcription et les pistes
  - `PATCH /api/v1/video-projects/:id` (EDITOR)
  - `DELETE /api/v1/video-projects/:id` (EDITOR) — suppression logique
  - `POST /api/v1/video-projects/:id/transcribe` (EDITOR)
  - `POST /api/v1/video-projects/:id/subtitles` (EDITOR)

### Transcription

- Modèle `Transcript` : un par projet, statut (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`),
  langue, fournisseur, texte complet, segments horodatés (`start`, `end`, `text`), erreur.
- **Frontière fournisseur explicite** : `AI_PROVIDER=mock` (défaut) produit une transcription
  déterministe construite à partir du nom et de la description du projet, sans appel externe
  ni coût. `AI_PROVIDER=openai` est reconnu par la configuration mais renvoie `503` tant que
  l'adaptateur n'est pas écrit — aucune fausse promesse, aucun échec silencieux.
- La transcription est un `upsert` : relancer écrase proprement la précédente.

### Sous-titres

- Modèle `SubtitleTrack` : style (`PROFESSIONAL`, `MINIMAL`, `KARAOKE`), langue, contenu SRT,
  nombre de cues. Unicité par `(projet, style, langue)` — régénérer met à jour la piste
  existante au lieu d'en créer une quatrième.
- Module `apps/api/src/video/subtitles.ts`, **pur et testé séparément** :
  - `PROFESSIONAL` : cues longues (découpage sur la ponctuation, ~84 caractères).
  - `MINIMAL` : cues courtes (~42 caractères), rythme rapide.
  - `KARAOKE` : un mot par cue, pour l'incrustation mot-à-mot.
  - `formatSrtTime` produit `HH:MM:SS,mmm`, `toSrt` numérote les cues de façon contiguë.
- Les sous-titres ne peuvent être générés qu'à partir d'une transcription `COMPLETED` ;
  sinon `400` avec un message explicite.

### Interface

- Page « AI Video Studio » : création de projet (nom, description, URL, marque), liste,
  panneau de détail, bouton « Transcrire », sélecteur de style, génération, aperçu du SRT,
  copie dans le presse-papiers et téléchargement du fichier `.srt`.
- Compteur « Projets vidéo » sur le tableau de bord.

## Sécurité

- Toutes les routes sont filtrées par `organizationId` : un projet d'une autre organisation
  renvoie `404`, jamais `403` (pas de fuite d'existence).
- RBAC : un `VIEWER` lit mais ne peut ni créer, ni transcrire, ni générer de sous-titres.
- Chaque action écrit une ligne d'audit (`video_project.created`, `.transcribed`,
  `.subtitles_generated`, `.deleted`).

## Reporté

- **Rendu ffmpeg** : nécessite un worker avec CPU et disque (Render Background Worker ou
  service dédié). L'API est prête à recevoir un `jobId`, la file BullMQ est déjà configurée.
- **Transcription réelle** : l'adaptateur OpenAI (ou Whisper auto-hébergé) reste à écrire ;
  le point d'insertion est unique (`VideoPipelineService.transcribe`).
- **Upload de fichier vidéo** : suppose le stockage objet (R2 ou Supabase Storage) activé.
- **Traduction des sous-titres** : le modèle porte déjà `language` sur les pistes, il ne
  manque que l'appel de traduction.

## Vérification

`pnpm test:phase3` exécute **52 vérifications** de bout en bout : création de projet, refus
d'un nom trop court et d'une URL invalide, détail vide, refus des sous-titres avant
transcription, transcription complète (segments ordonnés, durée déduite, statut
`TRANSCRIBED`), génération des trois styles avec contrôle du format SRT, différence de
découpage entre styles, régénération idempotente, style inconnu refusé, isolation
multi-tenant, RBAC (un `VIEWER` ne peut ni créer ni transcrire), compteurs du tableau de bord
et suppression logique.

## Notes techniques

- `createVideoProjectSchema` ne porte plus de `.default('fr')` : la valeur par défaut est
  appliquée côté contrôleur. Cela garde le type d'entrée et le type de sortie identiques,
  donc le client web peut omettre `language` sans caster.
- Le module `subtitles.ts` ne dépend ni de Nest, ni de Prisma : les six tests unitaires
  s'exécutent en quelques millisecondes.
