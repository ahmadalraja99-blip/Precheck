export function sanitizeUser<T extends { passwordHash?: string | null; refreshTokenHash?: string | null } | null>(user: T) {
  if (!user) return user;
  const { passwordHash: _passwordHash, refreshTokenHash: _refreshTokenHash, ...safe } = user;
  return safe;
}
