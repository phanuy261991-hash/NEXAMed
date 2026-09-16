-- Tách quyền `drug.manage` (Thêm/sửa/ẩn thuốc trong danh mục) thành `drug.create`/`drug.update`
-- (docs/DECISIONS.md #156, chủ dự án yêu cầu trực tiếp lúc xem trang "Vai trò & Phân quyền" — cột
-- "Thêm"/"Sửa" trống vì `drug` chỉ có action `manage` gộp, khác các module nghiệp vụ khác đã tách
-- sẵn create/update). Áp dụng luôn cho `supplier`/`warehouse` (cùng dùng chung `drug.manage`,
-- #146/#148). `drug.create`/`drug.update` sẽ được `seedPermissionCatalog()` tạo lại (upsert) và
-- `syncRolePermissionsForAllTenants()` tự cấp cho `clinic_admin` lúc API khởi động — không cần
-- seed tay trong migration này.
--
-- `permission` KHÔNG có 8 cột bắt buộc (bảng danh mục hệ thống thuần, cùng bản chất
-- `icd10_catalog`/`province`, không phải "dữ liệu nghiệp vụ" theo CLAUDE.md) — xoá cứng dòng cũ an
-- toàn. `role_permission` CÓ 8 cột bắt buộc (bảng nghiệp vụ) nhưng dòng cũ tham chiếu action đã
-- xoá sẽ không còn ý nghĩa gì (PermissionGuard sẽ không bao giờ hỏi lại action 'manage' của module
-- 'drug' nữa) — xoá cứng luôn vì migration chạy bằng role có đặc quyền (`MIGRATE_DATABASE_URL`,
-- không phải `nexamed_app`), không vi phạm REVOKE DELETE ở tầng ứng dụng.
DELETE FROM "role_permission"
WHERE "permission_id" IN (SELECT "id" FROM "permission" WHERE "module" = 'drug' AND "action" = 'manage');

DELETE FROM "permission" WHERE "module" = 'drug' AND "action" = 'manage';
