-- "Tầng" / "Bàn khám-Ghế" (docs/DECISIONS.md #055) — mở rộng cấp bậc không gian vật lý quanh
-- `room` đã có từ S2-07, theo yêu cầu chủ dự án. `floor` là cấp CHA tùy chọn của `room`
-- (`room.floor_id` nullable) — phòng khám 1 tầng không tạo dòng nào, web tự ẩn (cùng nguyên tắc
-- "tự ẩn khi ≤1" đã áp dụng cho chính `room` ở #054, migration *_doctor_room_session).
-- `exam_station` là cấp CON bắt buộc thuộc 1 `room` — THUẦN MÔ TẢ, không phải đơn vị điều phối:
-- "phòng làm việc hôm nay" (`doctor_room_session`) và `appointment.room_id` vẫn dừng ở cấp `room`,
-- không đổi gì (đã hỏi và chốt qua AskUserQuestion trước khi thiết kế).

-- CreateTable
CREATE TABLE "floor" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "floor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "floor_tenant_id_id_key" ON "floor"("tenant_id", "id");

ALTER TABLE "floor" ADD CONSTRAINT "floor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "floor" ADD CONSTRAINT "floor_version_check" CHECK (version >= 1);

ALTER TABLE "floor" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "floor"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- AlterTable — room.floor_id nullable, FK chỉ áp khi có giá trị (cùng mẫu appointment.room_id).
ALTER TABLE "room" ADD COLUMN "floor_id" UUID;

ALTER TABLE "room" ADD CONSTRAINT "room_tenant_id_floor_id_fkey" FOREIGN KEY ("tenant_id", "floor_id") REFERENCES "floor"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "exam_station" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "exam_station_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "exam_station" ADD CONSTRAINT "exam_station_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exam_station" ADD CONSTRAINT "exam_station_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "room"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exam_station" ADD CONSTRAINT "exam_station_version_check" CHECK (version >= 1);

CREATE INDEX "exam_station_tenant_id_room_id_idx" ON "exam_station"("tenant_id", "room_id");

ALTER TABLE "exam_station" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "exam_station"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
