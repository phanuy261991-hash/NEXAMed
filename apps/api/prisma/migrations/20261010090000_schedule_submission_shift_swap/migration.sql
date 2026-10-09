-- "Duyệt đăng ký ca theo tháng" + "Đổi ca" (#225).
--
-- `work_schedule_submission`: bảng đăng ký ca THEO THÁNG của từng nhân viên — DRAFT (Nháp) → SUBMITTED (Chờ
-- duyệt) → APPROVED (Đã duyệt); trả lại = về DRAFT kèm `return_reason`. Không có dòng = Nháp ảo.
-- `shift_swap_request`: yêu cầu đổi 2 ca cho nhau giữa 2 nhân viên, chỉ người nhận xác nhận.

-- `work_shift_assignment` cần `UNIQUE (tenant_id, id)` làm đích FK composite từ bảng đổi ca.
CREATE UNIQUE INDEX "work_shift_assignment_tenant_id_id_key" ON "work_shift_assignment"("tenant_id", "id");

-- ============ work_schedule_submission ============
CREATE TABLE "work_schedule_submission" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "return_reason" TEXT,
    "returned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "work_schedule_submission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "work_schedule_submission" ADD CONSTRAINT "work_schedule_submission_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_schedule_submission" ADD CONSTRAINT "work_schedule_submission_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_schedule_submission" ADD CONSTRAINT "work_schedule_submission_version_check" CHECK (version >= 1);
ALTER TABLE "work_schedule_submission" ADD CONSTRAINT "work_schedule_submission_month_check" CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "work_schedule_submission" ADD CONSTRAINT "work_schedule_submission_status_check" CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED'));

CREATE UNIQUE INDEX "work_schedule_submission_user_month_key"
  ON "work_schedule_submission" ("tenant_id", "user_id", "month")
  WHERE "deleted_at" IS NULL;
CREATE INDEX "work_schedule_submission_tenant_id_month_status_idx"
  ON "work_schedule_submission" ("tenant_id", "month", "status");

ALTER TABLE "work_schedule_submission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_schedule_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ shift_swap_request ============
CREATE TABLE "shift_swap_request" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "requester_assignment_id" UUID NOT NULL,
    "counterpart_id" UUID NOT NULL,
    "counterpart_assignment_id" UUID NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "decline_reason" TEXT,
    "manager_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "shift_swap_request_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_requester_fkey" FOREIGN KEY ("tenant_id", "requester_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_counterpart_fkey" FOREIGN KEY ("tenant_id", "counterpart_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_requester_assignment_fkey" FOREIGN KEY ("tenant_id", "requester_assignment_id") REFERENCES "work_shift_assignment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_counterpart_assignment_fkey" FOREIGN KEY ("tenant_id", "counterpart_assignment_id") REFERENCES "work_shift_assignment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_version_check" CHECK (version >= 1);
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_status_check" CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'));
ALTER TABLE "shift_swap_request" ADD CONSTRAINT "shift_swap_request_distinct_users_check" CHECK (requester_id <> counterpart_id);

-- Chặn 2 yêu cầu ĐANG CHỜ cùng đụng một ca (backstop race — service còn kiểm trước).
CREATE UNIQUE INDEX "shift_swap_request_pending_requester_assignment_key"
  ON "shift_swap_request" ("tenant_id", "requester_assignment_id")
  WHERE "status" = 'PENDING' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "shift_swap_request_pending_counterpart_assignment_key"
  ON "shift_swap_request" ("tenant_id", "counterpart_assignment_id")
  WHERE "status" = 'PENDING' AND "deleted_at" IS NULL;

CREATE INDEX "shift_swap_request_tenant_id_status_idx" ON "shift_swap_request" ("tenant_id", "status");
CREATE INDEX "shift_swap_request_tenant_id_counterpart_id_status_idx" ON "shift_swap_request" ("tenant_id", "counterpart_id", "status");

ALTER TABLE "shift_swap_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift_swap_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
