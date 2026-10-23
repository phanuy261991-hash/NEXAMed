-- Khoá chống ghi trùng khi mạng đứt giữa chừng (docs/DECISIONS.md #257, chủ dự án chọn phương án A ngày 23/10/2026).
--
-- Vì sao: mạng đứt đúng lúc máy chủ đã ghi xong nhưng phản hồi chưa tới nơi, người dùng bấm lại → các thao tác "tạo mới" không có khoá tự nhiên (Tiếp nhận,
-- phiếu thu/chi, nạp ví, thanh toán NCC một phần, phát thuốc một phần...) ghi trùng (đo ở #256 bổ sung 1). Giao diện gửi header `Idempotency-Key` (UUID) cho mọi POST JSON và GIỮ NGUYÊN khoá khi
-- bấm lại; API (IdempotencyInterceptor) giữ chỗ khoá trước khi chạy nghiệp vụ, rồi lưu phản hồi để trả lại đúng kết quả cũ cho lần gửi lại.
--
-- Dữ liệu KỸ THUẬT, không phải hồ sơ bệnh án; theo (công ty, người gửi, khoá), KHÔNG theo chi nhánh (vân tay yêu cầu đã gồm chi nhánh của phiên).
-- `status`: IN_PROGRESS (đang xử lý) / COMPLETED (xong, có thể replay) / FAILED (nghiệp vụ lỗi, nhả khoá cho phép thử lại).
-- `response_body_enc`: phản hồi thành công đã MÃ HOÁ (AES-GCM, cùng khoá với PII) vì có thể chứa dữ liệu bệnh nhân; NULL khi phản hồi quá lớn (không replay được) hoặc chưa xong.
-- Hết hạn sau 24 giờ (`expires_at`), job nền xoá cứng dòng quá hạn — NGOẠI LỆ thứ ba với quy tắc "cấm DELETE" (sau audit_log và user_session), chỉ cấp cho ĐÚNG bảng này.
-- Forward-only.

CREATE TABLE "idempotency_key" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "request_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "response_body_enc" BYTEA,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_key_version_check" CHECK ("version" >= 1),
  CONSTRAINT "idempotency_key_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  CONSTRAINT "idempotency_key_request_key_check" CHECK ("request_key" ~ '^[0-9a-fA-F-]{36}$'),
  CONSTRAINT "idempotency_key_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "idempotency_key_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "idempotency_key_tenant_id_id_key" ON "idempotency_key"("tenant_id", "id");
CREATE UNIQUE INDEX "idempotency_key_tenant_id_user_id_request_key_key" ON "idempotency_key"("tenant_id", "user_id", "request_key");
CREATE INDEX "idempotency_key_tenant_id_expires_at_idx" ON "idempotency_key"("tenant_id", "expires_at");

ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "idempotency_key"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Dọn dòng hết hạn: chỉ qua IdempotencyKeyRepository.purgeExpired() (luôn ép `tenant_id = ? AND expires_at < ?` trong câu lệnh), chỉ job nền gọi, không endpoint nào.
GRANT DELETE ON "idempotency_key" TO nexamed_app;
