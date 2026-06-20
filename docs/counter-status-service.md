# Counter Status Service

`CounterStatusService` centralizes counter state changes.

Rules:

- Sessions may reserve only `AVAILABLE` counters.
- Session creation changes counters to `RESERVED`.
- Clean PreCheck changes counters to `IN_USE`.
- OutCheck submission changes counters to `PENDING_OUTCHECK_APPROVAL`.
- Approval changes counters to `AVAILABLE`.
- Rejection changes counters to `UNAVAILABLE`.
- Issue resolution can return counters to `AVAILABLE` when no active session or open issue remains.

Every transition is audited and important availability changes create notifications.
