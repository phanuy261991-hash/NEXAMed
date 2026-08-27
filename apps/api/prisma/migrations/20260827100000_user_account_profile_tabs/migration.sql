-- Redesign form "Thêm tài khoản" sang 3 Tab (Thông tin chung / Chuyên môn và Pháp lý / Cấu hình và
-- Vai trò) — docs/DECISIONS.md #082, 2026-08-27. Viết tay (không qua `prisma migrate dev --create-
-- only` tự động) để RENAME COLUMN personal_email -> email giữ nguyên dữ liệu cũ thay vì Prisma tự
-- suy diễn thành DROP+ADD (mất dữ liệu personal_email hiện có, không chỉ company_email).

-- 1. Gộp personal_email/company_email thành 1 cột "email" duy nhất — chốt qua AskUserQuestion:
--    đổi tên personal_email -> email (giữ dữ liệu cũ), xoá hẳn company_email (chấp nhận mất dữ
--    liệu company_email cũ nếu có — chưa có tenant production, cùng cách đã làm với occupation/
--    SOAP các lần trước).
ALTER TABLE "user_account" RENAME COLUMN "personal_email" TO "email";
ALTER TABLE "user_account" DROP COLUMN "company_email";

-- 2. Trường mới cho tab "Thông tin chung".
ALTER TABLE "user_account" ADD COLUMN "dob" DATE;
ALTER TABLE "user_account" ADD COLUMN "gender" TEXT;

-- 3. Trường mới cho tab "Chuyên môn và Pháp lý" (CCHN + Tên hiển thị + Chữ ký).
ALTER TABLE "user_account" ADD COLUMN "license_issued_at" DATE;
ALTER TABLE "user_account" ADD COLUMN "license_issued_place" TEXT;
ALTER TABLE "user_account" ADD COLUMN "display_name" TEXT;
ALTER TABLE "user_account" ADD COLUMN "signature_key" TEXT;

-- 4. Trường mới cho tab "Cấu hình và Vai trò" — Phòng khám mặc định (FK -> room, cùng khuôn
--    department_id, chỉ áp khi có giá trị vì nullable).
ALTER TABLE "user_account" ADD COLUMN "default_room_id" UUID;

ALTER TABLE "user_account"
  ADD CONSTRAINT "user_account_tenant_id_default_room_id_fkey"
  FOREIGN KEY ("tenant_id", "default_room_id") REFERENCES "room"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;