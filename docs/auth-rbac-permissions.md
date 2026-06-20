# Auth, RBAC, And Permissions

JWT access and refresh tokens are issued by `/auth/login`.

Roles:

- `SUPER_ADMIN`: bypasses permission checks.
- `ADMIN`: requires assigned permissions.
- `MOVEMENT_SUPERVISOR`: has fixed session and counter assignment capabilities.
- `COMPANY_USER`: can access only sessions belonging to their company and signs PreCheck/OutCheck automatically.

Permissions are seeded from the Prisma `PermissionCode` enum. Super Admin assigns Admin permissions through `PATCH /users/:id/permissions`.
