-- S2-05 — Module `appointment` (APP-01/02/03). Xem .claude/docs/clinical-workflow.md mục
-- "Đặt lịch", docs/ERD.md mục 3.3/4/5, .claude/docs/data-model.md.
--
-- Sinh phần bảng/FK/index cơ bản bằng `prisma migrate diff --from-schema-datasource ...
-- --to-schema-datamodel ... --script` (chạy non-interactive, thay cho `migrate dev
-- --create-only` vì môi trường agent không có TTY). Diff thô còn kèm 3 dòng KHÔNG liên quan
-- (DROP INDEX patient_tenant_id_phone_idx, DROP INDEX
-- patient_tenant_id_search_key_trgm_idx, ALTER TABLE patient ALTER COLUMN search_key DROP
-- DEFAULT) — cùng loại "drift" giả do index/generated column raw-SQL-only không khai báo
-- trong schema.prisma đã gặp ở migration *_patient_search_s2_02 (xem docs/CHANGELOG.md mục
-- đó) — đã bỏ, KHÔNG đưa vào migration này.

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('SCHEDULED', 'CANCELLED', 'NO_SHOW', 'CONVERTED');

-- CreateEnum
CREATE TYPE "appointment_source" AS ENUM ('walk_in', 'phone', 'online');

-- CreateTable
CREATE TABLE "appointment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "room_id" UUID,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'SCHEDULED',
    "source" "appointment_source" NOT NULL,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_tenant_id_id_key" ON "appointment"("tenant_id", "id");

-- CreateIndex — room chưa từng bị tham chiếu bởi composite FK trước S2-05.
CREATE UNIQUE INDEX "room_tenant_id_id_key" ON "room"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_doctor_id_fkey" FOREIGN KEY ("tenant_id", "doctor_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — room_id nullable, FK chỉ áp khi có giá trị (đặt lịch qua điện thoại/online
-- chưa chắc gán phòng ngay, xem comment trong schema.prisma).
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "room"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu các migration trước.
ALTER TABLE "appointment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "appointment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- C2 (docs/ERD.md mục 4) — chống đặt trùng khung giờ cùng bác sĩ, kể cả khi hai lễ tân thao
-- tác đồng thời (APP-03). Chỉ áp cho lịch còn hiệu lực (status = SCHEDULED, chưa soft-delete)
-- — lịch đã CANCELLED/NO_SHOW/CONVERTED không còn chiếm chỗ. GiST cần btree_gist để dùng
-- toán tử "=" trên cột uuid (doctor_id) trong cùng exclusion constraint với toán tử "&&" trên
-- tstzrange (cùng lý do dùng btree_gin cho GIN kết hợp uuid + trigram ở migration
-- *_patient_search_s2_02, nhưng đây là GiST không phải GIN).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Postgres từ chối biểu thức "timestamptz + interval" thẳng trong index/exclusion constraint
-- vì toán tử đó đánh dấu STABLE (không IMMUTABLE) — phụ thuộc lý thuyết vào timezone phiên,
-- dù interval ở đây chỉ có đơn vị phút (không tháng/ngày nên thực tế không có điểm mơ hồ do
-- DST/lịch). Cùng cách xử lý với nexamed_unaccent_lower() ở migration
-- *_patient_search_s2_02: bọc lại thành hàm SQL riêng đánh dấu IMMUTABLE — đánh đổi đã ghi rõ
-- ở đây, chỉ an toàn vì interval luôn là phút, không dùng hàm này cho interval tháng/ngày.
CREATE OR REPLACE FUNCTION nexamed_appointment_slot_range(scheduled_at TIMESTAMPTZ, duration_minutes INTEGER)
RETURNS TSTZRANGE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT tstzrange(scheduled_at, scheduled_at + (duration_minutes * INTERVAL '1 minute'));
$$;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_slot_excl"
  EXCLUDE USING gist (
    doctor_id WITH =,
    nexamed_appointment_slot_range(scheduled_at, duration_minutes) WITH &&
  )
  WHERE (status = 'SCHEDULED' AND deleted_at IS NULL);

-- Index tra cứu theo docs/ERD.md mục 5 "Index cần có từ đầu" — lịch theo bác sĩ theo ngày (APP-01).
CREATE INDEX "appointment_tenant_id_doctor_id_scheduled_at_idx" ON "appointment" ("tenant_id", "doctor_id", "scheduled_at");

-- Partial index cho truy vấn mặc định (chỉ đọc bản còn hiệu lực) — C7 trong docs/ERD.md.
CREATE INDEX "appointment_tenant_id_id_active_idx" ON "appointment" ("tenant_id", "id") WHERE "deleted_at" IS NULL;
