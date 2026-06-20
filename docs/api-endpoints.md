# API Endpoints

All endpoints use `/api/v1`.

- Auth: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`
- Users: `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `PATCH /users/:id/activate`, `PATCH /users/:id/deactivate`, `PATCH /users/:id/permissions`
- Companies: `POST /companies`, `GET /companies`, `GET /companies/:id`, `PATCH /companies/:id`, activate/deactivate
- Counters: `POST /counters`, `GET /counters`, `GET /counters/status-map`, `GET /counters/:id`, `PATCH /counters/:id`, `PATCH /counters/:id/status`
- Devices: `POST /devices`, `GET /devices`, `GET /devices/:id`, `PATCH /devices/:id`
- Check Items: `POST /check-items`, list/get/update, activate/deactivate
- Sessions: `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `PATCH /sessions/:id/cancel`
- PreCheck: start, submit, get under `/sessions/:sessionId/precheck`
- OutCheck: start, submit, get under `/sessions/:sessionId/outcheck`
- Approvals: `POST /sessions/:sessionId/outcheck/approve`, `POST /sessions/:sessionId/outcheck/reject`
- Issues: list/get/create/assign/resolve/close
- Notifications: list, mark read, mark all read
- Reports: list/get/download/email/generate
- Audit: `GET /audit-logs`
