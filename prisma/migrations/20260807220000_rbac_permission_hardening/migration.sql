-- PostgreSQL requires a newly-added enum value to be committed before it is used.
ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'CAN_VIEW_CHECK_ITEMS';
