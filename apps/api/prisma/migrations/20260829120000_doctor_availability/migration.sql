-- "Tạm nghỉ / Đóng ca" của bác sĩ — trạng thái sẵn sàng nhận bệnh, TÁCH BIỆT hoàn toàn khỏi
-- `encounter.status` và khỏi `doctor_room_session` (bảng đó THUẦN chọn phòng ngồi vật lý, không
-- phải khoá điều phối — giữ nguyên ý nghĩa đã chốt ở docs/DECISIONS.md #054/#064). Chỉ tác động
-- routing: bác sĩ BREAK/ENDED không được điều phối ca mới (theo bác sĩ cụ thể lẫn theo Khoa qua
-- pool "Hàng đợi ảo" #064).
--
-- 1 dòng/bác sĩ/ngày lịch Việt Nam (work_date, DATE — cùng cách UTC+7 cố định đã dùng cho
-- doctor_room_session). Không có dòng cho hôm nay = ACTIVE ngầm định (không seed). Đổi trạng thái
-- giữa ngày = UPDATE tại chỗ (không phải dữ liệu lâm sàng cần giữ lịch sử bất biến — lịch sử đã có
-- đủ ở audit_log qua các action doctor_availability.*) — service dùng
-- INSERT ... ON CONFLICT DO UPDATE atomic, cùng kỹ thuật doctor_room_session.

-- CreateEnum
CREATE TYPE "doctor_availability_status" AS ENUM ('ACTIVE', 'BREAK', 'ENDED');

-- CreateTable
CREATE TABLE "doctor_availability" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "status" "doctor_availability_status" NOT NULL,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "doctor_availability_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_tenant_id_doctor_id_fkey" FOREIGN KEY ("tenant_id", "doctor_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_version_check" CHECK (version >= 1);

-- Partial unique (tenant_id, work_date, doctor_id) WHERE deleted_at IS NULL — 1 trạng thái hiệu lực
-- /bác sĩ/ngày. Thứ tự cột (work_date TRƯỚC doctor_id) để cùng index phục vụ tốt truy vấn "toàn bộ
-- trạng thái hôm nay của tenant" (tenant_id + work_date, không ràng buộc doctor_id) làm
-- leftmost-prefix — dùng chung 1 index cho cả 2 truy vấn. Đồng thời là arbiter index cho
-- INSERT ... ON CONFLICT DO UPDATE ở DoctorAvailabilityRepository (không khai báo được trong
-- schema.prisma vì có điều kiện WHERE, cùng lý do doctor_room_session/user_role/patient.national_id_hash).
CREATE UNIQUE INDEX "doctor_availability_tenant_id_work_date_doctor_id_key"
  ON "doctor_availability" ("tenant_id", "work_date", "doctor_id")
  WHERE "deleted_at" IS NULL;

-- Row Level Security — cùng mẫu mọi bảng tenant_id khác.
ALTER TABLE "doctor_availability" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "doctor_availability"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
