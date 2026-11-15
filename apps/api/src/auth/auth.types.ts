import type { Request } from 'express';
import type { OrganizationRole } from '@ass/shared';

export interface AuthContext {
  userId: string;
  email: string;
  sessionId: string;
  organizationId: string;
  role: OrganizationRole;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}
