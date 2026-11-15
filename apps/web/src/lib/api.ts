import {
  authResponseSchema,
  brandSchema,
  dashboardStatsSchema,
  healthResponseSchema,
  mediaAssetSchema,
  memberSchema,
  organizationSchema,
  userSchema,
  z,
  type AuthResponse,
  type Brand,
  type CreateBrandInput,
  type CreateMediaInput,
  type CreateOrganizationInput,
  type DashboardStats,
  type HealthResponse,
  type LoginInput,
  type MediaAsset,
  type Member,
  type Organization,
  type RegisterInput,
  type User,
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

  brands: {
    list: (): Promise<Brand[]> => request('/brands', z.array(brandSchema)),
    create: (body: CreateBrandInput): Promise<Brand> => post('/brands', brandSchema, body),
    remove: (id: string): Promise<unknown> =>
      request(`/brands/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  media: {
    list: (): Promise<MediaAsset[]> => request('/media', z.array(mediaAssetSchema)),
    create: (body: CreateMediaInput): Promise<MediaAsset> => post('/media', mediaAssetSchema, body),
    remove: (id: string): Promise<unknown> =>
      request(`/media/${id}`, z.unknown(), { method: 'DELETE' }),
  },

  dashboard: (): Promise<DashboardStats> => request('/dashboard', dashboardStatsSchema),
};

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return api.health(signal);
}
