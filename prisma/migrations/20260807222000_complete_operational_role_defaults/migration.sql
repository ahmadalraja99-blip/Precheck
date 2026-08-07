-- Keep role defaults aligned with RolesPermissionsService and the RBAC matrix.
INSERT INTO "RolePermission" ("id", "role", "permissionId", "createdAt")
SELECT md5('company-default:' || p."id" || ':' || p."code"::text), 'COMPANY_USER'::"Role", p."id", CURRENT_TIMESTAMP
FROM "Permission" p
WHERE p."code" IN ('CAN_VIEW_DASHBOARD','CAN_VIEW_COUNTERS','CAN_VIEW_DEVICES','CAN_VIEW_SESSIONS','CAN_VIEW_REPORTS','CAN_EXPORT_REPORTS')
ON CONFLICT ("role", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("id", "role", "permissionId", "createdAt")
SELECT md5('movement-read-default:' || p."id" || ':' || p."code"::text), 'MOVEMENT_SUPERVISOR'::"Role", p."id", CURRENT_TIMESTAMP
FROM "Permission" p
WHERE p."code" IN ('CAN_VIEW_ISSUES','CAN_VIEW_REPORTS')
ON CONFLICT ("role", "permissionId") DO NOTHING;
