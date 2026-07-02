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
# Daily duty and flight operations

- `GET /movement-categories/available`
- `GET|POST /movement-categories`
- `GET|PATCH /movement-categories/:id`
- `POST /daily-duties/activate`
- `GET /daily-duties/my/active`
- `GET /daily-duties/my/carry-over`
- `GET /daily-duties`
- `GET /daily-duties/:id`
- `PATCH /daily-duties/:id/close`
- `PATCH /daily-duties/:id/cancel`
- `POST|GET /daily-company-sessions`
- `GET|PATCH /daily-company-sessions/:id`
- `PATCH /daily-company-sessions/:id/open|close|cancel`
- `POST|GET /flights`
- `GET|PATCH /flights/:id`
- `PATCH /flights/:id/status`
- `POST|GET /daily-company-sessions/:sessionId/flights`
- `GET /session-flights`
- `GET /session-flights/:id`
- `PATCH /session-flights/:id/status|cancel`
- `POST /session-flights/:id/accept-carry-over`
- `POST|GET /session-flights/:sessionFlightId/counter-reservations`
- `GET /counter-reservations`
- `GET /counter-reservations/status-map`
- `PATCH /counter-reservations/:id/release|cancel`
- `POST|GET /session-flights/:sessionFlightId/reports`
- `POST|GET /daily-company-sessions/:sessionId/reports`
- `GET /operational-reports/flights`
- `GET /operational-reports/daily`
- `PATCH /companies/:id/logo`
