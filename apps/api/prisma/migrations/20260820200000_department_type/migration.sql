-- "Loại Khoa/Phòng" (mở rộng ADM-01, yêu cầu chủ dự án 2026-08-20) — cấp CHA tùy chọn của
-- `department` (`department.department_type_id` nullable), THUẦN phân loại/tổ chức, đúng khuôn
-- `floor` (cấp cha tùy chọn của `room`, migration `20260819100000_floor_room_exam_station`).

-- CreateTable
CREATE TABLE "department_type" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "department_type_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "department_type_tenant_id_id_key" ON "department_type"("tenant_id", "id");

ALTER TABLE "department_type" ADD CONSTRAINT "department_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "department_type" ADD CONSTRAINT "department_type_version_check" CHECK (version >= 1);

ALTER TABLE "department_type" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "department_type"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- AlterTable — department.department_type_id nullable, FK chỉ áp khi có giá trị (cùng mẫu room.floor_id).
ALTER TABLE "department" ADD COLUMN "department_type_id" UUID;

ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_department_type_id_fkey" FOREIGN KEY ("tenant_id", "department_type_id") REFERENCES "department_type"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;