import { PermissionCode, Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  companyId?: string | null;
  permissions: PermissionCode[];
}
