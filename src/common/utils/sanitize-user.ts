import { Prisma } from '@prisma/client';

export const safeUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  companyId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export function sanitizeUser<T extends { passwordHash?: string | null; refreshTokenHash?: string | null } | null>(user: T) {
  if (!user) return user;
  const { passwordHash: _passwordHash, refreshTokenHash: _refreshTokenHash, ...safe } = user;
  return safe;
}

export function sanitizeSensitiveUserFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSensitiveUserFields);
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'passwordHash' && key !== 'refreshTokenHash')
      .map(([key, nestedValue]) => [key, sanitizeSensitiveUserFields(nestedValue)]),
  );
}
