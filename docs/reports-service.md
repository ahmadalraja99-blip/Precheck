# Reports Service

`ReportsService` generates:

- Session final PDF and Excel reports.
- Daily PDF backup reports.
- Weekly Excel backup reports.

Reports are stored under `STORAGE_ROOT` using `StorageService`. Final reports are generated automatically when OutCheck is approved and can also be generated manually.

Email sending is delegated to `MailerService`, which logs every attempt and emits an Email Failed notification when SMTP fails.
