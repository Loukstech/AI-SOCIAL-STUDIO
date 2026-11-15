import { z } from 'zod';

/** Contrats partagés de la Phase 3 : projets vidéo, transcription, sous-titres. */

export const videoProjectStatuses = ['DRAFT', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED'] as const;
export const videoProjectStatusSchema = z.enum(videoProjectStatuses);
export type VideoProjectStatus = (typeof videoProjectStatuses)[number];

export const transcriptStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export const transcriptStatusSchema = z.enum(transcriptStatuses);
export type TranscriptStatus = (typeof transcriptStatuses)[number];

export const subtitleStyles = ['PROFESSIONAL', 'MINIMAL', 'KARAOKE'] as const;
export const subtitleStyleSchema = z.enum(subtitleStyles);
export type SubtitleStyle = (typeof subtitleStyles)[number];

export const subtitleStyleLabels: Record<SubtitleStyle, string> = {
  PROFESSIONAL: 'Professionnel',
  MINIMAL: 'Minimal',
  KARAOKE: 'Karaoké',
};

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
});
export type VideoProjectDetail = z.infer<typeof videoProjectDetailSchema>;

export const createSubtitleSchema = z.object({
  style: subtitleStyleSchema,
  language: z.string().trim().min(2).max(10).optional(),
});
export type CreateSubtitleInput = z.infer<typeof createSubtitleSchema>;
