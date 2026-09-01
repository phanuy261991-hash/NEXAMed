-- "Đăng ký ca làm việc" — Giai đoạn 2 của danh mục "Ca làm việc" (#101). MỌI nhân viên (không
-- riêng bác sĩ) tự đăng ký ca đã có trong danh mục `work_shift` cho một NGÀY CỤ THỂ (`work_date`,
-- nhận từ client — khác `doctor_availability`/`doctor_room_session` luôn ép "hôm nay"). Nhiều
-- dòng/ngày được (ví dụ Sáng+Chiều), chặn đúng 1 ca lặp lại 2 lần/ngày bằng unique bên dưới.
--
-- Quy tắc khoá (kiểm ở tầng Service, PermissionGuard không có khái niệm điều kiện thời gian): tự
-- sửa/xoá tự do trong đúng NGÀY LỊCH VN đã tạo (`created_at`), khoá lại từ hôm sau — chỉ vai trò
-- có quyền `update`/`delete` scope `global` (mặc định clinic_admin) sửa/xoá được sau đó.

-- `work_shift` (#101) chưa có unique (tenant_id, id) — cần trước khi làm đích FK composite từ
-- bảng mới, đúng bài học đã gặp với `room`/`department_type` ("lần đầu bị composite FK tham chiếu
-- tới").
CREATE UNIQUE INDEX "work_shift_tenant_id_id_key" ON "work_shift"("tenant_id", "id");

-- CreateTable
CREATE TABLE "work_shift_assignment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_shift_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "work_shift_assignment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "work_shift_assignment" ADD CONSTRAINT "work_shift_assignment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_shift_assignment" ADD CONSTRAINT "work_shift_assignment_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_shift_assignment" ADD CONSTRAINT "work_shift_assignment_tenant_id_work_shift_id_fkey" FOREIGN KEY ("tenant_id", "work_shift_id") REFERENCES "work_shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "work_shift_assignment" ADD CONSTRAINT "work_shift_assignment_version_check" CHECK (version >= 1);

-- Partial unique (tenant_id, user_id, work_date, work_shift_id) WHERE deleted_at IS NULL — chặn
-- đăng ký trùng ĐÚNG 1 ca 2 lần cùng ngày, nhưng cho phép nhiều ca KHÁC NHAU cùng ngày (Sáng+Chiều).
-- Bắt lỗi P2002 ở tầng Service (Prisma map unique_violation của Postgres về P2002 dù index này
-- không khai báo được qua `@@unique` trong schema.prisma vì có điều kiện WHERE — đã xác nhận đúng
-- cơ chế này ở `PatientService`/`patient.national_id_hash`, không cần raw SQL cho INSERT).
CREATE UNIQUE INDEX "work_shift_assignment_tenant_id_user_id_work_date_work_shift_id_key"
  ON "work_shift_assignment" ("tenant_id", "user_id", "work_date", "work_shift_id")
  WHERE "deleted_at" IS NULL;

-- Index (tenant_id, work_date, user_id) — cùng thứ tự cột `doctor_availability`/`doctor_room_session`
-- (work_date TRƯỚC user_id) để phục vụ tốt cả truy vấn "lịch của 1 người" lẫn "toàn tenant theo ngày"
-- (bảng lịch nhân viên) bằng cùng 1 index (leftmost-prefix).
CREATE INDEX "work_shift_assignment_tenant_id_work_date_user_id_idx"
  ON "work_shift_assignment" ("tenant_id", "work_date", "user_id");

-- Row Level Security — cùng mẫu mọi bảng tenant_id khác.
ALTER TABLE "work_shift_assignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "work_shift_assignment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
