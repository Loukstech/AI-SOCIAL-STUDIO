# Phase 4 — Édition, clips et exports

> **Statut : LIVRÉE** (15 novembre 2026).

## Objectif

Transformer la transcription brute de la Phase 3 en un vrai poste de travail : corriger le
texte et les timings, décliner les sous-titres dans les sept styles du cahier des charges,
exporter dans les formats attendus et proposer les meilleurs passages à découper.

Cette phase couvre les §5.2 (Mode A), §5.3, §5.4 et §5.8 du cahier des charges. Elle ne
nécessite aucun service externe : tout est calculé côté API.

## Périmètre livré

### Édition de la transcription (§5.3)

- `PATCH /api/v1/video-projects/:id/transcript` (EDITOR) remplace les segments : bornes et
  texte sont corrigeables.
- Validation stricte, avec un message qui désigne le segment fautif :
  - fin postérieure au début ;
  - texte non vide ;
  - ordre chronologique croissant.
- Le texte concaténé et la durée du projet sont recalculés.
- **Les pistes de sous-titres sont supprimées** : ce sont des artefacts dérivés, et garder des
  cues calculées sur un texte qui n'existe plus serait trompeur. L'interface l'annonce
  explicitement avant enregistrement.

### Sept styles de sous-titres (§5.4)

| Style          | Découpage                                               |
| -------------- | ------------------------------------------------------- |
| `PROFESSIONAL` | une phrase par cue, redécoupée au-delà de 84 caractères |
| `MINIMAL`      | cues courtes, 42 caractères maximum                     |
| `KARAOKE`      | 2 mots par cue                                          |
| `KEYWORDS`     | cues de 42 caractères, mots porteurs en majuscules      |
| `DYNAMIC`      | cues de 28 caractères et 3 mots maximum                 |
| `CREATOR`      | cues de 32 caractères                                   |
| `PODCAST`      | cues longues, 90 caractères                             |

Le style `KEYWORDS` met en majuscules les mots de six lettres et plus, en excluant les mots
outils et les mots interrogatifs — sans quoi « COMMENT » serait mis en avant au détriment du
sujet réel.

### Exports SRT, VTT, TXT (§5.3 et §5.8)

- `GET /api/v1/video-projects/:id/subtitles/:trackId/export?format=srt|vtt|txt` (VIEWER).
- Les cues sont stockées en JSON sur la piste (`SubtitleTrack.cues`) : les exports sont une
  simple sérialisation, sans reparsing fragile du SRT.
- Une piste créée avant cette phase (sans `cues`) est recalculée depuis la transcription.
- Le nom de fichier est dérivé du projet : `lancement-collection.professional.fr.vtt`.

### Extraction des meilleurs passages — Mode A (§5.2, §22.1)

- `POST /api/v1/video-projects/:id/clips` (EDITOR), avec une durée cible (15 à 90 s).
- `PATCH /api/v1/video-projects/:id/clips/:clipId` : titre, points de coupe, sélection.
- `DELETE /api/v1/video-projects/:id/clips/:clipId`.
- Modèle `ClipSuggestion` : titre, résumé, début, fin, durée, score 0–100, justification,
  sélection.

**Scoring** (`apps/api/src/video/clips.ts`), heuristique déterministe et explicable :

| Critère           | Effet                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Accroche          | +14 si question ou mot déclencheur à l'ouverture, +7 pour un chiffre |
| Densité de parole | +12 entre 2 et 4,5 mots/s, −12 sous 1 mot/s                          |
| Autonomie         | +13 si le passage commence et finit sur une frontière de phrase      |
| Durée             | +16 à ±25 % de la cible, −14 sous 40 %, −10 au-delà de 160 %         |
| Richesse lexicale | +9 si ratio de mots uniques ≥ 0,6, −7 sous 0,4                       |
| Contenu parlé     | −15 sous 6 mots (échantillon non significatif)                       |
| Position          | +4 pour le premier passage d'une vidéo                               |

Le titre reprend la phrase d'ouverture du passage, seule garante d'une accroche lisible ; les
mots-clés ne servent que de repli. Chaque clip expose sa justification en clair
(« ouvre sur une question, débit régulier, passage autonome »), l'utilisateur reste décideur.

## Sécurité

- Toutes les routes restent filtrées par `organizationId` : un projet ou un clip d'une autre
  organisation renvoie `404`.
- RBAC : un `VIEWER` exporte mais ne peut ni éditer la transcription, ni extraire des clips,
  ni modifier un clip.
- Audit : `transcript_edited`, `clips_extracted`, `clip_updated`, `clip_deleted`.

## Reporté

- **Rendu ffmpeg** (découpage réel, recadrage 9:16, incrustation) : requiert un worker avec
  CPU et disque, hors offre gratuite.
- **Analyse sémantique du scoring** : l'heuristique actuelle est lexicale et rythmique. Un
  modèle de langage affinerait le classement, mais le contrat d'API ne changera pas.
- **Personnalisation visuelle des sous-titres** (police, couleur, position, animation) : sans
  objet tant que l'incrustation ffmpeg n'existe pas.
- **Traduction des pistes** et **doublage**.

## Vérification

`pnpm test:phase4` exécute **63 vérifications** de bout en bout : génération des sept styles,
exports SRT / VTT / TXT avec contrôle du format, refus d'un format inconnu, édition de la
transcription (cas valides et trois cas invalides), suppression des pistes obsolètes,
régénération depuis le texte corrigé, extraction et classement des clips, ajustement des
points de coupe, refus d'une coupe inversée, sélection, suppression, isolation multi-tenant
et RBAC.

Côté unitaire, `apps/api/src/video/` compte **24 tests** : 13 sur les sous-titres (dont les
sept styles et les trois formats) et 11 sur l'extraction de clips.
