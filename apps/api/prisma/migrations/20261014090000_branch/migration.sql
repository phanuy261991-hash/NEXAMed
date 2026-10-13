-- Tầng CHI NHÁNH, Đợt 1 — Nền (docs/DECISIONS.md #231, mô hình B của #075): `tenant` = CÔNG TY, chi nhánh là bảng `branch` BÊN TRONG tenant.
--
--  1. `branch` + `user_branch` (nhân viên được làm việc ở chi nhánh nào).
--  2. BACKFILL: mọi tenant hiện có được 1 chi nhánh mặc định (tên/địa chỉ/SĐT lấy từ `tenant`) và mọi tài khoản hiện có được gán vào đó
--     → hành vi phòng khám 1 chi nhánh KHÔNG đổi gì.
--  3. `branch_id` NOT NULL (composite FK `(tenant_id, branch_id)`, chặn trỏ chéo tenant) cho 10 bảng gắn địa điểm: floor, room, exam_station,
--     encounter, appointment, work_shift_assignment, doctor_room_session, leave_request, work_schedule_submission, shift_swap_request
--     (đơn nghỉ/đăng ký ca tháng/đổi ca theo chi nhánh vì mỗi chi nhánh có người duyệt riêng) — backfill = chi nhánh mặc định của tenant.
--  4. `user_session.branch_id` (chi nhánh đang làm việc của phiên) + `user_account.last_branch_id` ("nhớ lựa chọn"), cả hai nullable.
--
-- Forward-only. Chạy bằng role đặc quyền (migrate) nên không bị RLS chặn khi backfill chéo tenant.

-- ======================================================================================================================
-- 1. branch
-- ======================================================================================================================
CREATE TABLE "branch" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "branch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_version_check" CHECK ("version" >= 1),
  CONSTRAINT "branch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "branch_tenant_id_id_key" ON "branch"("tenant_id", "id");
CREATE UNIQUE INDEX "branch_tenant_id_code_key" ON "branch"("tenant_id", "code");
-- Đúng 1 chi nhánh mặc định mỗi tenant.
CREATE UNIQUE INDEX "branch_one_default_per_tenant_idx" ON "branch"("tenant_id") WHERE "is_default" AND "deleted_at" IS NULL;

ALTER TABLE "branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branch"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ======================================================================================================================
-- 2. user_branch
-- ======================================================================================================================
CREATE TABLE "user_branch" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "user_branch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_branch_version_check" CHECK ("version" >= 1),
  CONSTRAINT "user_branch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_branch_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_branch_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Gán lại đúng chi nhánh đã từng bị gỡ vẫn được (dòng cũ soft-delete không tính) — cùng khuôn `user_role`.
CREATE UNIQUE INDEX "user_branch_tenant_id_user_id_branch_id_key" ON "user_branch"("tenant_id", "user_id", "branch_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "user_branch_tenant_id_user_id_idx" ON "user_branch"("tenant_id", "user_id");
CREATE INDEX "user_branch_tenant_id_branch_id_idx" ON "user_branch"("tenant_id", "branch_id");

ALTER TABLE "user_branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_branch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_branch"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ======================================================================================================================
-- 3. BACKFILL chi nhánh mặc định + gán mọi tài khoản hiện có
-- ======================================================================================================================
INSERT INTO "branch" ("tenant_id", "code", "name", "address", "phone", "is_default", "is_active", "created_by", "updated_by")
SELECT t."id", 'CN00001', t."name", t."address", t."phone", true, true,
       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "tenant" t;

-- Bộ đếm mã `CN` của mỗi tenant tiếp tục từ 1 (chi nhánh mặc định đã dùng CN00001).
INSERT INTO "code_sequence" ("tenant_id", "prefix", "period_key", "current_value", "created_by", "updated_by")
SELECT t."id", 'CN', '', 1, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "tenant" t
ON CONFLICT ("tenant_id", "prefix", "period_key") DO NOTHING;

INSERT INTO "user_branch" ("tenant_id", "user_id", "branch_id", "created_by", "updated_by")
SELECT u."tenant_id", u."id", b."id", '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "user_account" u
JOIN "branch" b ON b."tenant_id" = u."tenant_id" AND b."is_default"
WHERE u."deleted_at" IS NULL;

-- ======================================================================================================================
-- 4. branch_id NOT NULL cho 7 bảng gắn địa điểm
-- ======================================================================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['floor', 'room', 'exam_station', 'encounter', 'appointment', 'work_shift_assignment', 'doctor_room_session', 'leave_request', 'work_schedule_submission', 'shift_swap_request'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "branch_id" UUID', tbl);
    EXECUTE format(
      'UPDATE %I x SET "branch_id" = b."id" FROM "branch" b WHERE b."tenant_id" = x."tenant_id" AND b."is_default"',
      tbl
    );
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "branch_id" SET NOT NULL', tbl);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
      tbl, tbl || '_tenant_id_branch_id_fkey'
    );
    EXECUTE format('CREATE INDEX %I ON %I ("tenant_id", "branch_id")', tbl || '_tenant_id_branch_id_idx', tbl);
  END LOOP;
END
$$;

-- Bảng đăng ký ca theo tháng: MỘT bảng/tháng/NGƯỜI/CHI NHÁNH (mỗi chi nhánh có người duyệt riêng) — unique cũ chưa có `branch_id`.
DROP INDEX "work_schedule_submission_user_month_key";
CREATE UNIQUE INDEX "work_schedule_submission_user_month_key"
  ON "work_schedule_submission" ("tenant_id", "user_id", "month", "branch_id")
  WHERE "deleted_at" IS NULL;

-- ======================================================================================================================
-- 5. Chi nhánh đang làm việc của phiên + "nhớ lựa chọn"
-- ======================================================================================================================
ALTER TABLE "user_session" ADD COLUMN "branch_id" UUID;
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenant_id_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_account" ADD COLUMN "last_branch_id" UUID;
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_tenant_id_last_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "last_branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
