# Database ERD

Main relations:

- `Company` has many `User` and `Session`.
- `Session` belongs to `Company` and assigning `User`, and has many `SessionCounter`, `PreCheck`, `OutCheck`, `Issue`, `Approval`, and `Report`.
- `Counter` has many `Device`, `SessionCounter`, check results, and issues.
- `CheckItem` is referenced by PreCheck and OutCheck result rows.
- `Issue` may link to a session, counter, device, and check item.
- `Approval` records OutCheck decisions.
- `Report`, `Notification`, `EmailLog`, and `AuditLog` are operational history tables.

The full ERD source of truth is `prisma/schema.prisma`.
