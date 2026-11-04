-- Nhật ký các lần NHẮC hẹn tái khám (docs/DECISIONS.md #285, mockup "Hẹn tái khám" chốt 04/11/2026). Chỉ THÊM, không sửa (mỗi lần nhắc một dòng).
-- Gắn với LƯỢT KHÁM GỐC (encounter) chứ không gắn kế hoạch điều trị: đính chính kế hoạch tạo bản mới nên nhật ký nhắc phải sống qua đính chính.
-- Theo CHI NHÁNH bằng cách kế thừa qua lượt khám gốc (encounter.branch_id) — KHÔNG có cột branch_id riêng (#231 câu 2).
-- result = NOT_RETURNING ("Bệnh nhân không tái khám") làm hẹn biến khỏi danh sách và khỏi số "quá hạn" ở Tổng quan.

CREATE TYPE "follow_up_reminder_result" AS ENUM ('REACHED', 'NO_ANSWER', 'CALL_BACK_LATER', 'NOT_RETURNING');

CREATE TABLE "follow_up_reminder" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "encounter_id" UUID NOT NULL,
  "result" "follow_up_reminder_result" NOT NULL,
  "note" TEXT,
  -- Thời điểm liên lạc: máy chủ tự đặt, không nhập tay.
  "reminded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "follow_up_reminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follow_up_reminder_version_check" CHECK ("version" >= 1),
  CONSTRAINT "follow_up_reminder_note_check" CHECK ("note" IS NULL OR char_length("note") <= 1000),
  CONSTRAINT "follow_up_reminder_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "follow_up_reminder_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "follow_up_reminder_tenant_id_id_key" ON "follow_up_reminder"("tenant_id", "id");
-- Lịch sử nhắc của một lượt khám + "lần nhắc gần nhất" của danh sách.
CREATE INDEX "follow_up_reminder_encounter_idx" ON "follow_up_reminder"("tenant_id", "encounter_id", "reminded_at" DESC) WHERE "deleted_at" IS NULL;

ALTER TABLE "follow_up_reminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_up_reminder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "follow_up_reminder"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
