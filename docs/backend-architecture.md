# Backend Architecture

The backend is a modular NestJS application. Controllers expose REST endpoints and delegate business logic to services. State transitions are centralized in `SessionStatusMachine` and `CounterStatusService`.

Core modules:

- `auth`, `users`, `roles-permissions` for JWT, roles, and assignable Admin permissions.
- `sessions`, `precheck`, `outcheck`, `approvals`, `issues` for lifecycle behavior.
- `notifications` for database-backed notifications and Socket.IO events.
- `reports`, `storage`, `mailer`, `scheduler` for generated artifacts, email logging, and periodic backups.
- `audit` for sensitive action logging.

Prisma is global through `PrismaModule`. Multi-step lifecycle operations use Prisma transactions.
