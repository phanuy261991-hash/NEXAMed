-- Tiếp nhận bệnh nhân (Sprint 3, phần 1: REC-01→03 + state machine encounter) — xem
-- .claude/docs/clinical-workflow.md mục "Tiếp nhận (check-in)", docs/ERD.md mục 3.3/4/5,
-- .claude/docs/data-model.md. Viết tay (không `prisma migrate diff`) theo đúng lý do đã ghi ở các
-- migration trước có RLS/partial unique index (*_appointment_s2_05, *_patient_s2_01): công cụ
-- diff không biểu diễn được các đối tượng này.

-- CreateEnum
CREATE TYPE "encounter_status" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
-- Đủ 6 giá trị enum theo .claude/docs/clinical-workflow.md dù v1 chỉ tạo dòng thẳng ở CHECKED_IN
-- (check-in luôn đi qua ReceptionService.checkIn(), không có luồng nào tạo SCHEDULED/NO_SHOW cho
-- encounter — hai giá trị này giữ cho đúng state machine đầy đủ, dùng khi cần mở rộng sau).
CREATE TABLE "encounter" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID,
    "encounter_no" TEXT NOT NULL,
    "status" "encounter_status" NOT NULL,
    "specialty" TEXT NOT NULL DEFAULT 'general',
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "chief_complaint" TEXT,
    "insurance_snapshot" JSONB NOT NULL,
    -- "Bỏ về" (CHECKED_IN → CANCELLED, bắt buộc lý do — .claude/docs/clinical-workflow.md mục
    -- "State machine của encounter") không thay đổi encounter thành soft-delete (deleted_at vẫn
    -- NULL, giống appointment.status='CANCELLED' không soft-delete) — cần cột riêng lưu lý do,
    -- cùng khuôn appointment.cancel_reason. docs/ERD.md mục ENCOUNTER chưa liệt kê cột này (bảng
    -- đó viết trước khi "bỏ về" được thiết kế cụ thể) — bổ sung ở đây, cập nhật ERD trong cùng PR.
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vital_sign" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "pulse" SMALLINT,
    "temperature_deci_c" SMALLINT,
    "bp_systolic" SMALLINT,
    "bp_diastolic" SMALLINT,
    "respiratory_rate" SMALLINT,
    "spo2" SMALLINT,
    "weight_gram" INTEGER,
    "height_mm" INTEGER,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "vital_sign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encounter_tenant_id_id_key" ON "encounter"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_tenant_id_encounter_no_key" ON "encounter"("tenant_id", "encounter_no");

-- CreateIndex — phòng vệ double check-in (race hiếm ngoài điều kiện WHERE status='SCHEDULED' đã
-- có ở AppointmentRepository.checkin()): mỗi appointment chỉ sinh được tối đa 1 encounter còn
-- hiệu lực. Partial vì appointment_id nullable (encounter walk-in trực tiếp không qua appointment
-- — chưa có luồng nào tạo kiểu này ở v1, nhưng cột để nullable đúng docs/ERD.md).
CREATE UNIQUE INDEX "encounter_tenant_id_appointment_id_key"
  ON "encounter" ("tenant_id", "appointment_id")
  WHERE "appointment_id" IS NOT NULL AND "deleted_at" IS NULL;

-- CreateIndex — tra cứu theo docs/ERD.md mục 5 "Index cần có từ đầu" (tiền sử khám, ENC-01).
CREATE INDEX "encounter_tenant_id_patient_id_checked_in_at_idx" ON "encounter" ("tenant_id", "patient_id", "checked_in_at" DESC);

-- CreateIndex — truy vấn mặc định chỉ đọc bản còn hiệu lực (C7, docs/ERD.md).
CREATE INDEX "encounter_tenant_id_id_active_idx" ON "encounter" ("tenant_id", "id") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "vital_sign_tenant_id_id_key" ON "vital_sign"("tenant_id", "id");

-- CreateIndex — tra lịch sử sinh hiệu của một lượt khám.
CREATE INDEX "vital_sign_tenant_id_encounter_id_idx" ON "vital_sign" ("tenant_id", "encounter_id");

-- AddForeignKey
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_tenant_id_doctor_id_fkey" FOREIGN KEY ("tenant_id", "doctor_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — appointment_id nullable, FK chỉ áp khi có giá trị (giống appointment.room_id).
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign" ADD CONSTRAINT "vital_sign_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign" ADD CONSTRAINT "vital_sign_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_version_check" CHECK (version >= 1);
ALTER TABLE "vital_sign" ADD CONSTRAINT "vital_sign_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu các migration trước. Quyền SELECT/INSERT/UPDATE cơ bản đã tự
-- động cấp cho nexamed_app qua ALTER DEFAULT PRIVILEGES trong migration *_tenant_context.
ALTER TABLE "encounter" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "encounter"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "vital_sign" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vital_sign"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
