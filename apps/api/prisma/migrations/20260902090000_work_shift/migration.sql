-- "Ca làm việc" (docs/DECISIONS.md #101) — danh mục mẫu ca do clinic_admin tự quản lý, RIÊNG cho
-- từng phòng khám (tenant-scoped), KHÔNG dùng chung khuôn `reference_catalog` (toàn hệ thống) vì
-- mỗi phòng khám tự đặt giờ ca của mình. Cùng khuôn `room`/`department`/`exam_station` (đủ 8 cột
-- bắt buộc + RLS). DELETE đã bị revoke toàn cục cho `nexamed_app` từ migration *_tenant_context
-- (ALTER DEFAULT PRIVILEGES) — không cần REVOKE DELETE riêng ở đây.

CREATE TABLE "work_shift" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "rest_start_time" TEXT,
    "rest_end_time" TEXT,
    "rest_minutes" INTEGER,
    "standard_work_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "work_shift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_shift_tenant_id_code_key" ON "work_shift"("tenant_id", "code");

ALTER TABLE "work_shift" ADD CONSTRAINT "work_shift_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_shift" ADD CONSTRAINT "work_shift_version_check" CHECK (version >= 1);

ALTER TABLE "work_shift" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "work_shift"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
