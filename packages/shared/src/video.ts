import { z } from 'zod';

/** Contrats partagés de la Phase 3 : projets vidéo, transcription, sous-titres. */

export const videoProjectStatuses = ['DRAFT', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED'] as const;
export const videoProjectStatusSchema = z.enum(videoProjectStatuses);
export type VideoProjectStatus = (typeof videoProjectStatuses)[number];

export const transcriptStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export const transcriptStatusSchema = z.enum(transcriptStatuses);
export type TranscriptStatus = (typeof transcriptStatuses)[number];

export const subtitleStyles = [
  'PROFESSIONAL',
  'MINIMAL',
  'KARAOKE',
  'KEYWORDS',
  'DYNAMIC',
  'CREATOR',
  'PODCAST',
] as const;
export const subtitleStyleSchema = z.enum(subtitleStyles);
export type SubtitleStyle = (typeof subtitleStyles)[number];

export const subtitleStyleLabels: Record<SubtitleStyle, string> = {
  PROFESSIONAL: 'Professionnel',
  MINIMAL: 'Minimal',
  KARAOKE: 'Karaoké',
  KEYWORDS: 'Mots-clés',
  DYNAMIC: 'Dynamique',
  CREATOR: 'Créateur',
  PODCAST: 'Podcast',
};

export const subtitleFormats = ['srt', 'vtt', 'txt'] as const;
export const subtitleFormatSchema = z.enum(subtitleFormats);
export type SubtitleFormat = (typeof subtitleFormats)[number];

export const createVideoProjectSchema = z.object({
  name: z.string().trim().min(2, 'Au moins 2 caractères').max(160),
  description: z.string().trim().max(2000).optional(),
  sourceUrl: z.string().trim().url().max(2048).optional(),
  brandId: z.string().min(1).optional(),
  language: z.string().trim().min(2).max(10).optional(),
});
export type CreateVideoProjectInput = z.infer<typeof createVideoProjectSchema>;

export const updateVideoProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    sourceUrl: z.string().trim().url().max(2048).nullable().optional(),
    brandId: z.string().min(1).nullable().optional(),
    language: z.string().trim().min(2).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' });
export type UpdateVideoProjectInput = z.infer<typeof updateVideoProjectSchema>;

export const transcriptSegmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: transcriptStatusSchema,
  language: z.string(),
  provider: z.string().nullable(),
  text: z.string().nullable(),
  segments: z.array(transcriptSegmentSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const subtitleTrackSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  style: subtitleStyleSchema,
  language: z.string(),
  content: z.string(),
  cueCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;

/** Suggestion de clip (Mode A) : passage autonome proposé par l'analyse. */
export const clipSuggestionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  summary: z.string(),
  start: z.number(),
  end: z.number(),
  duration: z.number(),
  score: z.number(),
  rationale: z.string(),
  selected: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClipSuggestion = z.infer<typeof clipSuggestionSchema>;

export const clipTargetDurations = [15, 30, 45, 60, 90] as const;

export const suggestClipsSchema = z.object({
  targetDuration: z.number().int().min(5).max(600).optional(),
});
export type SuggestClipsInput = z.infer<typeof suggestClipsSchema>;

export const updateClipSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    start: z.number().nonnegative().optional(),
    end: z.number().nonnegative().optional(),
    selected: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' })
  .refine(
    (value) => value.start === undefined || value.end === undefined || value.end > value.start,
    {
      message: 'La fin doit être postérieure au début',
    },
  );
export type UpdateClipInput = z.infer<typeof updateClipSchema>;

/** Édition manuelle de la transcription : le texte et les bornes sont corrigeables. */
export const updateTranscriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema).min(1).max(5000),
});
export type UpdateTranscriptInput = z.infer<typeof updateTranscriptSchema>;

/** Réponse d'export : le contenu est renvoyé tel quel, le client en fait un fichier. */
export const subtitleExportSchema = z.object({
  format: subtitleFormatSchema,
  filename: z.string(),
  content: z.string(),
});
export type SubtitleExport = z.infer<typeof subtitleExportSchema>;

export const videoProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  brandId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  language: z.string(),
  durationSeconds: z.number().nullable(),
  status: videoProjectStatusSchema,
  transcriptStatus: transcriptStatusSchema.nullable(),
  subtitleCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VideoProject = z.infer<typeof videoProjectSchema>;

export const videoProjectDetailSchema = videoProjectSchema.extend({
  transcript: transcriptSchema.nullable(),
  subtitles: z.array(subtitleTrackSchema),
  clips: z.array(clipSuggestionSchema),
});
export type VideoProjectDetail = z.infer<typeof videoProjectDetailSchema>;

export const createSubtitleSchema = z.object({
  style: subtitleStyleSchema,
  language: z.string().trim().min(2).max(10).optional(),
});
export type CreateSubtitleInput = z.infer<typeof createSubtitleSchema>;
