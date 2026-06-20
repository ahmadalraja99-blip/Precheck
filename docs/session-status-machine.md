# Session Status Machine

Allowed transitions:

- `SCHEDULED` to `PRECHECK_IN_PROGRESS` or `CANCELLED`
- `PRECHECK_IN_PROGRESS` to `PRECHECK_BLOCKED` or `OPERATING`
- `PRECHECK_BLOCKED` to `PRECHECK_IN_PROGRESS` or `CANCELLED`
- `OPERATING` to `OUTCHECK_IN_PROGRESS`
- `OUTCHECK_IN_PROGRESS` to `OUTCHECK_PENDING_APPROVAL`
- `OUTCHECK_PENDING_APPROVAL` to `CLOSED` or `OUTCHECK_REJECTED`
- `OUTCHECK_REJECTED` to `CLOSED_WITH_ISSUES` or `CLOSED`

Controllers do not mutate session statuses directly; lifecycle services call the status machine or perform guarded service operations.
