# RBAC permission matrix

This matrix is the authorization contract. Controller guards enforce authentication, role eligibility and the named permission; services additionally enforce tenant, duty, ownership and state-machine scope. `SUPER_ADMIN` bypasses named permissions. All other roles require every declared permission.

| Area | Read | Mutation | Eligible roles and scope |
|---|---|---|---|
| Auth/profile | authenticated user | login/refresh are public token exchanges | active users only; company users also require an active assigned company |
| Users/RBAC | `CAN_VIEW_USERS` | Super Admin only | global; last active Super Admin is protected |
| Companies | `CAN_VIEW_COMPANIES` | Super Admin only | global read for permitted staff |
| Movement categories | authenticated operational/config roles | Super Admin only | no company-user configuration access |
| Counters | `CAN_VIEW_COUNTERS` | Super Admin config; Movement/Admin operational reservation/status paths | current authorized duty and state machine |
| Devices | `CAN_VIEW_DEVICES` | Super Admin only | global configuration |
| Check items | `CAN_VIEW_CHECK_ITEMS` | Super Admin only | global configuration |
| Daily duties | `CAN_VIEW_SESSIONS` | Movement Supervisor/Admin/Super Admin | Movement Supervisor owns current duty; accepted carry-over only |
| Daily company sessions/flights/reservations | `CAN_VIEW_SESSIONS` | Movement Supervisor/Admin/Super Admin | company users read only their company; supervisors current/owned duty |
| PreCheck/OutCheck entry | `CAN_VIEW_SESSIONS` | Company User | own company flight and valid lifecycle state |
| OutCheck review | `CAN_APPROVE_OUTCHECK` | Admin/Super Admin | reviewer cannot be submitter; immutable attempt/review rules apply |
| Operational issues | `CAN_VIEW_ISSUES` | `CAN_RESOLVE_ISSUES` for Admin/Super Admin | company and supervisor duty scope on read |
| Reports | `CAN_VIEW_REPORTS` | `CAN_EXPORT_REPORTS` | company download is tenant-scoped; generation is Admin/Super Admin only |
| Report jobs | `CAN_EXPORT_REPORTS` | `CAN_EXPORT_REPORTS` | Admin/Super Admin only |
| Report email jobs | `CAN_SEND_REPORT_EMAILS` | `CAN_SEND_REPORT_EMAILS` | Admin/Super Admin only |
| Audit log | `CAN_VIEW_AUDIT_LOGS` | internal append only | Admin/Super Admin according to explicit permission |
| Notifications | authenticated user | mark own visible notification read | user, role, company or explicitly global scope only |

Role defaults live in the `RolePermission` table and migrations. Individual grants are additive for Admin and Movement Supervisor. Company User receives only its role bundle; arbitrary user grants do not elevate that role. Role eligibility remains mandatory where a permission must not broaden a sensitive operation to another role.
