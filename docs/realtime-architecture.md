# Real-time architecture

## Transport and authentication

The application uses Socket.IO on the `/realtime` namespace. The browser supplies the current access token in `handshake.auth.token`. The gateway verifies the token with `JWT_ACCESS_SECRET`, reloads the user, company state and permissions from PostgreSQL, and disconnects missing, invalid, expired or inactive identities. Client-supplied roles, permissions and room names are ignored. Allowed browser origins come from the comma-separated `FRONTEND_ORIGIN` environment variable; the local fallback is `http://localhost:3001`.

## Server-controlled rooms

| Room | Membership |
|---|---|
| `authenticated` | every authenticated socket |
| `user:{id}` | that user only |
| `company:{id}` | users assigned to that company |
| `role:{role}` | server-resolved role |
| `duty:{id}` | Movement Supervisor owning a current open duty |
| `movement-category:{id}` | active Movement Supervisor assignment |
| `admins` | Admin and Super Admin |
| `super-admins` | Super Admin only |

Clients cannot request arbitrary room membership. Accepted carry-over updates are delivered by company, authorized movement-category, current-duty or administrative scope as selected by the mutation publisher.

## Event contract

Events use `{domain}.{past-action}` names: `duty.activated`, `duty.resumed`, `duty.expired`, `duty.closed`; `company-session.created`, `.updated`, `.closed`, `.carry-over`; `flight.created`, `.updated`, `.status-changed`, `.closed`, `.carry-over-created`, `.handover-accepted`; `counter-reservation.created`, `.released`; `counter.status-changed`; `precheck.started`, `.updated`, `.submitted`; `outcheck.started`, `.updated`, `.submitted`, `.rejected`, `.approved`; `operational-issue.created`, `.updated`, `.resolved`; `report.pending`, `.generated`, `.failed`; `report-job.status-changed`; `report-email-job.status-changed`; and `notification.new`, `.read`, `.read-all`.

Operational payloads are allow-listed and contain `resourceId`, `updatedAt`, optional `status`, and only relevant `companyId`, duty/session/flight/category parent IDs, plus minimal `display` values. Notification events contain the persisted notification ID, type, title, message and target entity reference. Payloads never contain JWTs, credentials, file paths, worker locks, SMTP data or audit metadata.

## Query reconciliation

The frontend owns one lazy Socket.IO singleton. Components do not construct sockets. Events invalidate targeted TanStack Query families:

- duty/session events: current duty and company sessions;
- flight events: flight/session-flight lists and details;
- reservations/counters: counters, reservations, duty and affected flight;
- PreCheck/OutCheck: their workflow, flight lifecycle, review queue and reservations;
- issues: counters and affected flight;
- reports/jobs/email jobs: only their report query families;
- notifications: notification list and unread count.

REST remains authoritative. Socket events signal reconciliation and are never used as the mutation transport.

## Reconnection

Socket.IO uses exponential backoff from one to thirty seconds with 50% jitter. After every successful connection/reconnection, the client invalidates current duty, visible company sessions/flights and notifications. This REST recovery is the delivery-gap strategy; there is currently no event sequence log. Logout and provider teardown remove every registered listener and close the singleton.

## Transaction safety and persistence

Publishers emit transition events only after their database mutation resolves. Persistent notifications are committed before `notification.new` is emitted. Notification read events are emitted only after the ownership-checked update commits. WebSocket delivery is transient and is not an audit record.

## Multi-instance production deployment

Single-instance operation needs no additional infrastructure. Socket.IO currently uses its in-memory adapter, so events published on one backend instance do not reach sockets connected to another. A multi-instance deployment must configure sticky sessions and a shared Socket.IO adapter, preferably `@socket.io/redis-adapter` with managed Redis. The gateway's room-based publisher is adapter-compatible; Redis is intentionally not required for local operation.
