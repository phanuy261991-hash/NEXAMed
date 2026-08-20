-- Danh mục Quản lý Tài khoản (mở rộng ADM-01, yêu cầu chủ dự án) — hồ sơ nhân sự trên
-- `user_account`, cột `deactivates_account` trên `reference_catalog`, 4 category mới.
--
-- `ALTER TYPE ... ADD VALUE` không dùng giá trị mới ngay trong CÙNG migration này (không
-- insert/update dòng nào dùng nó, seed dữ liệu mặc định chạy ở bước `db:seed` riêng sau khi
-- migration đã commit) — cùng lý do đã ghi ở migration 20260820160000_reference_catalog_occupation.
ALTER TYPE "reference_catalog_category" ADD VALUE 'ACADEMIC_TITLE';
ALTER TYPE "reference_catalog_category" ADD VALUE 'STAFF_POSITION';
ALTER TYPE "reference_catalog_category" ADD VALUE 'EMPLOYMENT_STATUS';
ALTER TYPE "reference_catalog_category" ADD VALUE 'EMPLOYMENT_TYPE';

-- Chỉ có ý nghĩa với category EMPLOYMENT_STATUS (giống price/unit chỉ có ý nghĩa với EXAM_TYPE).
-- Tách cột riêng thay vì so khớp `code` cố định vì `code` sửa được qua UI (ReferenceCatalogPane).
ALTER TABLE "reference_catalog"
  ADD COLUMN "deactivates_account" BOOLEAN NOT NULL DEFAULT false;

-- Hồ sơ nhân sự trên `user_account` — tất cả nullable trừ 2 cột boolean có default, không
-- backfill (chưa có tenant production, tài khoản cũ hiện "—" tới khi sửa). employee_code sinh
-- tự động qua code_sequence (prefix "NV") chỉ cho tài khoản tạo mới sau tính năng này.
ALTER TABLE "user_account"
  ADD COLUMN "employee_code" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "personal_email" TEXT,
  ADD COLUMN "company_email" TEXT,
  ADD COLUMN "academic_title_code" TEXT,
  ADD COLUMN "position_code" TEXT,
  ADD COLUMN "employment_status_code" TEXT,
  ADD COLUMN "employment_type_code" TEXT,
  ADD COLUMN "can_sign_medical_record" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
