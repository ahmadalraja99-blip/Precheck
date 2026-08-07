INSERT INTO "Permission" ("id", "code", "description", "createdAt")
VALUES ('f0000000-0000-4000-8000-000000000001', 'CAN_VIEW_CHECK_ITEMS', 'View operational checklist configuration', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "role", "permissionId", "createdAt")
SELECT md5('movement-default:' || p."id" || ':' || p."code"::text), 'MOVEMENT_SUPERVISOR'::"Role", p."id", CURRENT_TIMESTAMP
FROM "Permission" p
WHERE p."code" IN ('CAN_VIEW_DASHBOARD','CAN_VIEW_COMPANIES','CAN_VIEW_COUNTERS','CAN_VIEW_DEVICES','CAN_VIEW_SESSIONS')
ON CONFLICT ("role", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("id", "role", "permissionId", "createdAt")
SELECT md5('admin-default:' || p."id" || ':' || p."code"::text), 'ADMIN'::"Role", p."id", CURRENT_TIMESTAMP
FROM "Permission" p
WHERE p."code" = 'CAN_VIEW_CHECK_ITEMS'
ON CONFLICT ("role", "permissionId") DO NOTHING;
