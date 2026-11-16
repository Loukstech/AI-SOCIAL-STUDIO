import {
  acceptedInvitationSchema,
  adminAuditEntrySchema,
  adminOrganizationSchema,
  adminOverviewSchema,
  adminUserSchema,
  notificationCatalogResponseSchema,
  notificationListSchema,
  notificationPreferencesSchema,
  notificationSchema,
  unreadCountSchema,
  analyticsOverviewSchema,
  collectResultSchema,
  measurementSchema,
  topPublicationsSchema,
  authResponseSchema,
  brandSchema,
  calendarResponseSchema,
  clipSuggestionSchema,
  commentListSchema,
  commentSchema,
  connectResultSchema,
  creditAccountSchema,
  creditLedgerSchema,
  creditOperationSchema,
  planSchema,
  connectionHealthSchema,
  contentProjectDetailSchema,
  contentProjectSchema,
  createdInvitationSchema,
  dashboardStatsSchema,
  declineResultSchema,
  healthResponseSchema,
  historySchema,
  imageProjectDetailSchema,
  imageProjectSchema,
  invitationSchema,
  mediaAssetSchema,
  memberSchema,
  organizationSchema,
  portfolioSchema,
  publicationDetailSchema,
  publicationExportSchema,
  publicationListSchema,
  publishingReadinessSchema,
  socialAccountSchema,
  subtitleExportSchema,
  subtitleTrackSchema,
  taskSchema,
  userSchema,
  videoProjectDetailSchema,
  videoProjectSchema,
  videoRenderResultSchema,
  z,
  type AcceptedInvitation,
  type AdminAuditEntry,
  type AdminOrganization,
  type AdminOverview,
  type AdminUser,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type CollectResult,
  type Comment,
  type CommentList,
  type CreateCommentInput,
  type CreateTaskInput,
  type History,
  type Portfolio,
  type Task,
  type TaskQuery,
  type UpdateCommentInput,
  type UpdateTaskInput,
  type Measurement,
  type Ranking,
  type RecordMeasurementInput,
  type TopPublications,
  // `Notification` masquerait le type DOM homonyme : on l'alias ici.
  type Notification as AppNotification,
  type NotificationCatalogResponse,
  type NotificationList,
  type NotificationPreference,
  type NotificationQuery,
  type UnreadCount,
  type UpdatePreferencesInput,
  type AuthResponse,
  type Brand,
  type CalendarQuery,
  type CalendarResponse,
  type CancelPublicationInput,
  type ClipSuggestion,
  type ConfirmPublicationInput,
  type ConnectRequestInput,
  type CreditAccount,
  type CreditLedger,
  type CreditOperation,
  type ConnectResult,
  type ConnectionHealth,
  type ContentProject,
  type ContentProjectDetail,
  type CreateBrandInput,
  type CreateImageProjectInput,
  type CreateInvitationInput,
  type CreateMediaInput,
  type CreateOrganizationInput,
  type CreatePublicationInput,
  type CreateSocialAccountInput,
  type CreatedInvitation,
  type DashboardStats,
  type DeclineResult,
  type DuplicatePublicationInput,
  type GenerateContentInput,
  type HealthResponse,
  type ImageProject,
  type ImageProjectDetail,
  type ImageFormat,
  type Invitation,
  type LoginInput,
  type MediaAsset,
  type Member,
  type Organization,
  type Plan,
  type PublicationDetail,
  type PublicationExport,
  type PublicationList,
  type PublicationQuery,
  type PublishingReadiness,
  type RegisterInput,
  type RejectPublicationInput,
  type RenderVideoInput,
  type VideoRenderResult,
  type ReserveCreditsInput,
  type RewriteVariantInput,
  type SettleCreditsInput,
  type UpdateAdminUserInput,
  type UpdateOrganizationPlanInput,
  type CreateVideoProjectInput,
  type SchedulePublicationInput,
  type SocialAccount,
  type SubtitleExport,
  type SubtitleFormat,
  type SubtitleStyle,
  type SubtitleTrack,
  type UpdateBrandInput,
  type UpdateClipInput,
  type UpdateImageProjectInput,
  type UpdatePublicationInput,
  type UpdateVariantInput,
  type UpdateSocialAccountInput,
  type UpdateTranscriptInput,
  type UpdateVideoProjectInput,
  type User,
  type VideoProject,
  type VideoProjectDetail,
} from '@ass/shared';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const TOKEN_KEY = 'ass.token';
const ORG_KEY = 'ass.organization';

export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  set token(value: string | null) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  },
  get organizationId(): string | null {
    return localStorage.getItem(ORG_KEY);
  },
  set organizationId(value: string | null) {
    if (value) localStorage.setItem(ORG_KEY, value);
    else localStorage.removeItem(ORG_KEY);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ORG_KEY);
  },
};

/** Écritures de session centralisées : les composants ne mutent jamais l'objet importé. */
export function setSessionToken(value: string | null): void {
  session.token = value;
}

export function setActiveOrganization(value: string | null): void {
  session.organizationId = value;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const token = session.token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const org = session.organizationId;
  if (org) headers.set('X-Organization-Id', org);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'API injoignable');
  }
  if (response.status === 401) {
    session.clear();
    throw new ApiError(401, 'Session expirée, reconnectez-vous');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : (body?.message ?? `Erreur ${response.status}`);
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return schema.parse(await response.json());
}

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const put = <T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> =>
  request(path, schema, { method: 'PUT', body: JSON.stringify(body) });

/** Requête dont la réponse n'est pas du JSON (export CSV). */
async function requestText(path: string): Promise<string> {
  const headers = new Headers();
  const token = session.token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const org = session.organizationId;
  if (org) headers.set('X-Organization-Id', org);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, { headers });
  } catch {
    throw new ApiError(0, 'API injoignable');
  }
  if (response.status === 401) {
    session.clear();
    throw new ApiError(401, 'Session expirée, reconnectez-vous');
  }
  if (!response.ok) throw new ApiError(response.status, `Erreur ${response.status}`);
  return response.text();
}

/** Sérialise les filtres en query string, en ignorant les valeurs vides. */
function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export const api = {
  health: (signal?: AbortSignal): Promise<HealthResponse> =>
    request('/health', healthResponseSchema, { signal }),

  register: (body: RegisterInput): Promise<AuthResponse> =>
    post('/auth/register', authResponseSchema, body),
  login: (body: LoginInput): Promise<AuthResponse> => post('/auth/login', authResponseSchema, body),
  me: (): Promise<User> => request('/auth/me', userSchema),
  logout: (): Promise<unknown> => post('/auth/logout', z.unknown(), {}),

  organizations: {
    list: (): Promise<Organization[]> => request('/organizations', z.array(organizationSchema)),
    create: (body: CreateOrganizationInput): Promise<Organization> =>
      post('/organizations', organizationSchema, body),
    members: (id: string): Promise<Member[]> =>
      request(`/organizations/${id}/members`, z.array(memberSchema)),
  },

  admin: {
    overview: (): Promise<AdminOverview> => request('/admin/overview', adminOverviewSchema),
    plans: (): Promise<Plan[]> => request('/admin/plans', z.array(planSchema)),
    users: (): Promise<AdminUser[]> => request('/admin/users', z.array(adminUserSchema)),
    updateUser: (id: string, body: UpdateAdminUserInput): Promise<AdminUser> =>
      request(`/admin/users/${id}`, adminUserSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    organizations: (): Promise<AdminOrganization[]> =>
      request('/admin/organizations', z.array(adminOrganizationSchema)),
    setPlan: (id: string, body: UpdateOrganizationPlanInput): Promise<AdminOrganization> =>
      request(`/admin/organizations/${id}/plan`, adminOrganizationSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    audit: (limit = 30): Promise<AdminAuditEntry[]> =>
      request(`/admin/audit?limit=${limit}`, z.array(adminAuditEntrySchema)),
  },

  credits: {
    account: (): Promise<CreditAccount> => request('/credits/account', creditAccountSchema),
    ledger: (): Promise<CreditLedger> => request('/credits/ledger', creditLedgerSchema),
    reserve: (body: ReserveCreditsInput): Promise<CreditOperation> =>
      post('/credits/reserve', creditOperationSchema, body),
    confirm: (body: SettleCreditsInput): Promise<CreditOperation> =>
      post('/credits/confirm', creditOperationSchema, body),
    refund: (body: SettleCreditsInput): Promise<CreditOperation> =>
      post('/credits/refund', creditOperationSchema, body),
  },

  brands: {
    list: (): Promise<Brand[]> => request('/brands', z.array(brandSchema)),
    create: (body: CreateBrandInput): Promise<Brand> => post('/brands', brandSchema, body),
    update: (id: string, body: UpdateBrandInput): Promise<Brand> =>
      request(`/brands/${id}`, brandSchema, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string): Promise<unknown> =>
      request(`/brands/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  image: {
    list: (): Promise<ImageProject[]> => request('/image-projects', z.array(imageProjectSchema)),
    detail: (id: string): Promise<ImageProjectDetail> =>
      request(`/image-projects/${id}`, imageProjectDetailSchema),
    create: (body: CreateImageProjectInput): Promise<ImageProjectDetail> =>
      post('/image-projects', imageProjectDetailSchema, body),
    update: (id: string, body: UpdateImageProjectInput): Promise<ImageProjectDetail> =>
      request(`/image-projects/${id}`, imageProjectDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    rerender: (id: string): Promise<ImageProjectDetail> =>
      post(`/image-projects/${id}/rerender`, imageProjectDetailSchema, {}),
    /** Décline le visuel dans d'autres gabarits, à calques identiques. */
    decline: (id: string, formats: ImageFormat[]): Promise<DeclineResult> =>
      post(`/image-projects/${id}/decline`, declineResultSchema, { formats }),
    remove: (id: string): Promise<unknown> =>
      request(`/image-projects/${id}`, z.unknown(), { method: 'DELETE' }),
    /** URL de téléchargement direct du SVG. */
    downloadUrl: (id: string): string => `${API_URL}/api/v1/image-projects/${id}/download`,
  },

  media: {
    list: (): Promise<MediaAsset[]> => request('/media', z.array(mediaAssetSchema)),
    create: (body: CreateMediaInput): Promise<MediaAsset> => post('/media', mediaAssetSchema, body),
    remove: (id: string): Promise<unknown> =>
      request(`/media/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  socialAccounts: {
    list: (): Promise<SocialAccount[]> => request('/social-accounts', z.array(socialAccountSchema)),
    create: (body: CreateSocialAccountInput): Promise<SocialAccount> =>
      post('/social-accounts', socialAccountSchema, body),
    update: (id: string, body: UpdateSocialAccountInput): Promise<SocialAccount> =>
      request(`/social-accounts/${id}`, socialAccountSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    sync: (id: string): Promise<SocialAccount> =>
      post(`/social-accounts/${id}/sync`, socialAccountSchema, {}),
    /** Ouvre une connexion OAuth : renvoie l'URL d'autorisation à visiter. */
    connect: (body: ConnectRequestInput): Promise<ConnectResult> =>
      post('/social-accounts/connect', connectResultSchema, body),
    /** Renouvelle une autorisation à partir du jeton de rafraîchissement. */
    refresh: (id: string): Promise<SocialAccount> =>
      post(`/social-accounts/${id}/refresh`, socialAccountSchema, {}),
    /** Santé des connexions : état, expiration, permissions, blocages. */
    health: (): Promise<ConnectionHealth[]> =>
      request('/social-accounts/health', z.array(connectionHealthSchema)),
    remove: (id: string): Promise<unknown> =>
      request(`/social-accounts/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  analytics: {
    overview: (query: Partial<AnalyticsQuery> = {}): Promise<AnalyticsOverview> =>
      request(`/analytics/overview${queryString(query)}`, analyticsOverviewSchema),
    top: (query: Partial<AnalyticsQuery> & { rankedBy?: Ranking } = {}): Promise<TopPublications> =>
      request(`/analytics/top${queryString(query)}`, topPublicationsSchema),
    history: (publicationId: string, targetId: string): Promise<Measurement[]> =>
      request(
        `/analytics/measurements${queryString({ publicationId, targetId })}`,
        z.array(measurementSchema),
      ),
    record: (body: RecordMeasurementInput): Promise<Measurement> =>
      post('/analytics/measurements', measurementSchema, body),
    /** Collecte auprès des plateformes : rapporte aussi ce qui n'a pas pu l'être. */
    collect: (): Promise<CollectResult> => post('/analytics/collect', collectResultSchema, {}),
    /** CSV brut, téléchargé côté navigateur avec l'en-tête d'authentification. */
    exportCsv: (query: Partial<AnalyticsQuery> = {}): Promise<string> =>
      requestText(`/analytics/export.csv${queryString(query)}`),
  },

  notifications: {
    list: (query: Partial<NotificationQuery> = {}): Promise<NotificationList> =>
      request(`/notifications${queryString(query)}`, notificationListSchema),
    unread: (): Promise<UnreadCount> => request('/notifications/unread-count', unreadCountSchema),
    /** Événements du §15 et état réel du canal e-mail. */
    catalog: (): Promise<NotificationCatalogResponse> =>
      request('/notifications/catalog', notificationCatalogResponseSchema),
    preferences: (): Promise<NotificationPreference[]> =>
      request('/notifications/preferences', notificationPreferencesSchema),
    savePreferences: (body: UpdatePreferencesInput): Promise<NotificationPreference[]> =>
      put('/notifications/preferences', notificationPreferencesSchema, body),
    read: (id: string): Promise<AppNotification> =>
      post(`/notifications/${id}/read`, notificationSchema, {}),
    readAll: (): Promise<UnreadCount> => post('/notifications/read-all', unreadCountSchema, {}),
    remove: (id: string): Promise<unknown> =>
      request(`/notifications/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  collaboration: {
    comments: (publicationId: string): Promise<CommentList> =>
      request(`/publications/${publicationId}/comments`, commentListSchema),
    addComment: (publicationId: string, body: CreateCommentInput): Promise<Comment> =>
      post(`/publications/${publicationId}/comments`, commentSchema, body),
    updateComment: (id: string, body: UpdateCommentInput): Promise<Comment> =>
      request(`/comments/${id}`, commentSchema, { method: 'PATCH', body: JSON.stringify(body) }),
    removeComment: (id: string): Promise<unknown> =>
      request(`/comments/${id}`, z.unknown(), { method: 'DELETE' }),

    tasks: (query: Partial<TaskQuery> = {}): Promise<Task[]> =>
      request(`/tasks${queryString(query)}`, z.array(taskSchema)),
    createTask: (body: CreateTaskInput): Promise<Task> => post('/tasks', taskSchema, body),
    updateTask: (id: string, body: UpdateTaskInput): Promise<Task> =>
      request(`/tasks/${id}`, taskSchema, { method: 'PATCH', body: JSON.stringify(body) }),
    removeTask: (id: string): Promise<unknown> =>
      request(`/tasks/${id}`, z.unknown(), { method: 'DELETE' }),

    /** Chronologie fusionnée : transitions, audit, commentaires et tâches. */
    history: (publicationId: string, limit?: number): Promise<History> =>
      request(`/publications/${publicationId}/history${queryString({ limit })}`, historySchema),

    /** Portefeuille : les organisations où l'utilisateur est membre. */
    portfolio: (): Promise<Portfolio> => request('/portfolio', portfolioSchema),
  },

  contentGeneration: {
    generate: (body: GenerateContentInput): Promise<ContentProjectDetail> =>
      post('/ai/content/generate', contentProjectDetailSchema, body),
  },

  content: {
    list: (): Promise<ContentProject[]> => request('/content', z.array(contentProjectSchema)),
    detail: (id: string): Promise<ContentProjectDetail> =>
      request(`/content/${id}`, contentProjectDetailSchema),
    updateVariant: (
      id: string,
      variantId: string,
      body: UpdateVariantInput,
    ): Promise<ContentProjectDetail> =>
      request(`/content/${id}/variants/${variantId}`, contentProjectDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    rewrite: (
      id: string,
      variantId: string,
      body: RewriteVariantInput,
    ): Promise<ContentProjectDetail> =>
      request(`/content/${id}/variants/${variantId}/rewrite`, contentProjectDetailSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    remove: (id: string): Promise<unknown> =>
      request(`/content/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  invitations: {
    list: (organizationId: string): Promise<Invitation[]> =>
      request(`/organizations/${organizationId}/invitations`, z.array(invitationSchema)),
    create: (organizationId: string, body: CreateInvitationInput): Promise<CreatedInvitation> =>
      post(`/organizations/${organizationId}/invitations`, createdInvitationSchema, body),
    revoke: (organizationId: string, invitationId: string): Promise<unknown> =>
      request(`/organizations/${organizationId}/invitations/${invitationId}`, z.unknown(), {
        method: 'DELETE',
      }),
    accept: (token: string): Promise<AcceptedInvitation> =>
      post('/invitations/accept', acceptedInvitationSchema, { token }),
  },

  videoProjects: {
    list: (): Promise<VideoProject[]> => request('/video-projects', z.array(videoProjectSchema)),
    create: (body: CreateVideoProjectInput): Promise<VideoProject> =>
      post('/video-projects', videoProjectSchema, body),
    detail: (id: string): Promise<VideoProjectDetail> =>
      request(`/video-projects/${id}`, videoProjectDetailSchema),
    update: (id: string, body: UpdateVideoProjectInput): Promise<VideoProjectDetail> =>
      request(`/video-projects/${id}`, videoProjectDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    remove: (id: string): Promise<unknown> =>
      request(`/video-projects/${id}`, z.unknown(), { method: 'DELETE' }),
    transcribe: (id: string): Promise<VideoProjectDetail> =>
      post(`/video-projects/${id}/transcribe`, videoProjectDetailSchema, {}),
    subtitles: (id: string, style: SubtitleStyle): Promise<SubtitleTrack> =>
      post(`/video-projects/${id}/subtitles`, subtitleTrackSchema, { style }),
    exportSubtitle: (
      id: string,
      trackId: string,
      format: SubtitleFormat,
    ): Promise<SubtitleExport> =>
      request(
        `/video-projects/${id}/subtitles/${trackId}/export?format=${format}`,
        subtitleExportSchema,
      ),
    updateTranscript: (id: string, body: UpdateTranscriptInput): Promise<VideoProjectDetail> =>
      request(`/video-projects/${id}/transcript`, videoProjectDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    suggestClips: (id: string, targetDuration?: number): Promise<ClipSuggestion[]> =>
      post(
        `/video-projects/${id}/clips`,
        z.array(clipSuggestionSchema),
        targetDuration === undefined ? {} : { targetDuration },
      ),
    updateClip: (id: string, clipId: string, body: UpdateClipInput): Promise<ClipSuggestion> =>
      request(`/video-projects/${id}/clips/${clipId}`, clipSuggestionSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    removeClip: (id: string, clipId: string): Promise<unknown> =>
      request(`/video-projects/${id}/clips/${clipId}`, z.unknown(), { method: 'DELETE' }),
    render: (id: string, body: RenderVideoInput): Promise<VideoRenderResult> =>
      post(`/video-projects/${id}/render`, videoRenderResultSchema, body),
  },

  publishing: {
    list: (query: Partial<PublicationQuery> = {}): Promise<PublicationList> =>
      request(`/publications${queryString(query)}`, publicationListSchema),
    readiness: (): Promise<PublishingReadiness> =>
      request('/publications/readiness', publishingReadinessSchema),
    detail: (id: string): Promise<PublicationDetail> =>
      request(`/publications/${id}`, publicationDetailSchema),
    export: (id: string): Promise<PublicationExport> =>
      request(`/publications/${id}/export`, publicationExportSchema),
    create: (body: CreatePublicationInput): Promise<PublicationDetail> =>
      post('/publications', publicationDetailSchema, body),
    update: (id: string, body: UpdatePublicationInput): Promise<PublicationDetail> =>
      request(`/publications/${id}`, publicationDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    submit: (id: string): Promise<PublicationDetail> =>
      post(`/publications/${id}/submit`, publicationDetailSchema, {}),
    requestApproval: (id: string): Promise<PublicationDetail> =>
      post(`/publications/${id}/request-approval`, publicationDetailSchema, {}),
    approve: (id: string): Promise<PublicationDetail> =>
      post(`/publications/${id}/approve`, publicationDetailSchema, {}),
    reject: (id: string, body: RejectPublicationInput): Promise<PublicationDetail> =>
      post(`/publications/${id}/reject`, publicationDetailSchema, body),
    reopen: (id: string): Promise<PublicationDetail> =>
      post(`/publications/${id}/reopen`, publicationDetailSchema, {}),
    schedule: (id: string, body: SchedulePublicationInput): Promise<PublicationDetail> =>
      post(`/publications/${id}/schedule`, publicationDetailSchema, body),
    cancel: (id: string, body: CancelPublicationInput): Promise<PublicationDetail> =>
      post(`/publications/${id}/cancel`, publicationDetailSchema, body),
    reschedule: (id: string, body: SchedulePublicationInput): Promise<PublicationDetail> =>
      post(`/publications/${id}/reschedule`, publicationDetailSchema, body),
    publish: (id: string): Promise<PublicationDetail> =>
      post(`/publications/${id}/publish`, publicationDetailSchema, {}),
    retry: (id: string): Promise<PublicationDetail> =>
      post(`/publications/${id}/retry`, publicationDetailSchema, {}),
    confirm: (id: string, body: ConfirmPublicationInput): Promise<PublicationDetail> =>
      post(`/publications/${id}/confirm`, publicationDetailSchema, body),
    duplicate: (id: string, body: DuplicatePublicationInput = {}): Promise<PublicationDetail> =>
      post(`/publications/${id}/duplicate`, publicationDetailSchema, body),
    remove: (id: string): Promise<unknown> =>
      request(`/publications/${id}`, z.unknown(), { method: 'DELETE' }),
    runDue: (): Promise<{ claimed: number; expired: number }> =>
      post('/publications/run-due', z.object({ claimed: z.number(), expired: z.number() }), {}),
  },

  calendar: {
    window: (query: CalendarQuery): Promise<CalendarResponse> =>
      request(`/calendar${queryString(query)}`, calendarResponseSchema),
  },

  dashboard: (): Promise<DashboardStats> => request('/dashboard', dashboardStatsSchema),
};

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return api.health(signal);
}
