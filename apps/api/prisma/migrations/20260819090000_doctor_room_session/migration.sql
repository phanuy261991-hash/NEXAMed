-- "Phòng làm việc hôm nay" của bác sĩ — mô hình tham khảo từ chủ dự án (định tuyến theo phòng
-- vật lý thay vì gán cứng bác sĩ↔phòng), đã hỏi và chốt 3 điểm trước khi code (docs/DECISIONS.md
-- #054): (1) bác sĩ tự chọn phòng lúc đăng nhập mỗi ngày; (2) `data_scope`/hàng đợi khám GIỮ
-- NGUYÊN lọc theo doctor_id (docs/DECISIONS.md #042) — bảng này KHÔNG dùng để lọc quyền, chỉ để
-- điều phối/hiển thị UI; (3) 0-1 phòng active thì mọi UI liên quan tự ẩn hoàn toàn (không migrate
-- dữ liệu cũ nào, không seed).
--
-- 1 dòng/bác sĩ/ngày lịch Việt Nam (work_date, DATE — không phải TIMESTAMPTZ, tính 1 lần lúc ghi
-- qua getVietnamDateString() ở tầng service, cùng cách UTC+7 cố định đã dùng cho
-- formatDisplayCode()/vietnamDayRange()). Cho phép đổi phòng giữa ngày qua UPDATE tại chỗ (không
-- phải bản ghi lâm sàng cần giữ lịch sử bất biến) — service dùng INSERT ... ON CONFLICT DO UPDATE
-- atomic, cùng kỹ thuật code_sequence.repository.ts.

-- CreateTable
CREATE TABLE "doctor_room_session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "doctor_room_session_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "doctor_room_session" ADD CONSTRAINT "doctor_room_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_room_session" ADD CONSTRAINT "doctor_room_session_tenant_id_doctor_id_fkey" FOREIGN KEY ("tenant_id", "doctor_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_room_session" ADD CONSTRAINT "doctor_room_session_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "room"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "doctor_room_session" ADD CONSTRAINT "doctor_room_session_version_check" CHECK (version >= 1);

-- Partial unique (tenant_id, work_date, doctor_id) WHERE deleted_at IS NULL — 1 phòng/bác sĩ/ngày
-- hiệu lực. Thứ tự cột (work_date TRƯỚC doctor_id, khác thứ tự khai báo cột) để index này cũng
-- phục vụ tốt truy vấn "toàn bộ phân công hôm nay của tenant" (tenant_id + work_date, không ràng
-- buộc doctor_id) làm leftmost-prefix — dùng chung 1 index cho cả 2 truy vấn, không tạo thêm
-- index thường bên cạnh. Đồng thời là arbiter index cho INSERT ... ON CONFLICT DO UPDATE ở
-- DoctorRoomSessionRepository (không khai báo được trong schema.prisma vì có điều kiện WHERE,
-- cùng lý do user_role/patient.national_id_hash).
CREATE UNIQUE INDEX "doctor_room_session_tenant_id_work_date_doctor_id_key"
  ON "doctor_room_session" ("tenant_id", "work_date", "doctor_id")
  WHERE "deleted_at" IS NULL;

-- Row Level Security — cùng mẫu mọi bảng tenant_id khác.
ALTER TABLE "doctor_room_session" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "doctor_room_session"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
