# Postman

Import the environment and both collection files from the `postman` directory.

Use the generated environment and run `Auth / Login` first. The login test script stores:

- `accessToken`
- `refreshToken`

Create endpoint scripts store useful IDs such as `companyId`, `counterId`, `sessionId`, `issueId`, and `reportId`.

The collection follows Postman Collection schema v2.1 and mirrors the REST endpoints in `docs/api-endpoints.md`.

`Daily-Duty-Operations.postman_collection.json` contains the daily-duty, flights,
counter-reservation, carry-over, company-logo, and operational-report requests.

Required operational variables:

- `baseUrl`
- `accessToken`
- `movementCategoryId`
- `dailyDutyId`
- `companyId`
- `dailyCompanySessionId`
- `flightId`
- `sessionFlightId`
- `counterId`
- `counterReservationId`
- `flightReportId`
- `dailyCompanyReportId`
