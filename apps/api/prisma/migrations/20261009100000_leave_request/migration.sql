-- "Đơn xin nghỉ" (#224) — nhân viên xin nghỉ MỘT NGÀY trên ca đã đăng ký (từng ca hoặc cả ngày),
-- quản lý duyệt/từ chối. Ca đã đăng ký (`work_shift_assignment`) GIỮ NGUYÊN — nghỉ là bản ghi
-- riêng có lịch sử. `start_minute`/`end_minute` là SNAPSHOT khung nghỉ (phút kể từ 00:00 giờ VN,
-- khoảng nửa mở) lúc gửi đơn — cả ngày = 0..1440 — nên sửa mẫu ca về sau không đổi đơn đã gửi.
-- `work_shift_id` NULL = cả ngày.

-- CreateTable
CREATE TABLE "leave_request" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "leave_date" DATE NOT NULL,
    "work_shift_id" UUID,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "filed_on_behalf" BOOLEAN NOT NULL DEFAULT false,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — `work_shift_id` NULL (cả ngày) thì MATCH SIMPLE bỏ qua kiểm FK, đúng ý.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_work_shift_id_fkey" FOREIGN KEY ("tenant_id", "work_shift_id") REFERENCES "work_shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_version_check" CHECK (version >= 1);

-- Khung nghỉ hợp lệ trong 1 ngày.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_window_check"
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);

ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_status_check"
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'));

-- Từ chối/huỷ đơn đã duyệt bắt buộc có lý do; đơn đã quyết định phải có người + thời điểm quyết định.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_decision_check"
  CHECK (
    (status IN ('REJECTED', 'CANCELLED') AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0)
    OR status NOT IN ('REJECTED', 'CANCELLED')
  );

-- Chống trùng khi 2 yêu cầu đồng thời (backstop race — service còn kiểm chồng lấn khung giờ): cùng
-- người, cùng ngày, cùng ca (hoặc cùng "cả ngày") chỉ được MỘT đơn đang hiệu lực. Expression
-- `COALESCE` đưa NULL (cả ngày) về UUID rỗng để unique hoạt động với NULL.
CREATE UNIQUE INDEX "leave_request_active_unique"
  ON "leave_request" ("tenant_id", "user_id", "leave_date", COALESCE("work_shift_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" IN ('PENDING', 'APPROVED') AND "deleted_at" IS NULL;

-- Danh sách theo ngày/người (lưới Lịch hẹn, Tiếp nhận) và theo trạng thái (đếm chờ duyệt).
CREATE INDEX "leave_request_tenant_id_leave_date_user_id_idx"
  ON "leave_request" ("tenant_id", "leave_date", "user_id");
CREATE INDEX "leave_request_tenant_id_status_idx"
  ON "leave_request" ("tenant_id", "status");

-- Row Level Security — cùng mẫu mọi bảng tenant_id khác.
ALTER TABLE "leave_request" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "leave_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
