-- "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, chủ dự án yêu cầu trực tiếp 2026-09-03) —
-- cho phép reset bộ đếm mã nghiệp vụ (patient_code, encounter_no, booking_code, employee_code,
-- department.code, invoice_no, cashier_shift.shift_no) theo tháng/năm khi tenant tự cấu hình
-- khuôn mẫu có token ngày/tháng/năm — thêm chiều "chu kỳ" vào khoá duy nhất của bộ đếm.
--
-- TƯƠNG THÍCH NGƯỢC TUYỆT ĐỐI: `period_key` mặc định '' — mọi dòng `code_sequence` hiện có (kể
-- cả tại pilot đã cài) tự nhận '' qua DEFAULT, giữ NGUYÊN hành vi "chạy liên tục không bao giờ
-- reset" như hôm nay cho tới khi tenant chủ động cấu hình khuôn mẫu mới có token ngày/tháng/năm.
-- Không đổi bất kỳ giá trị `current_value` nào đang có.

ALTER TABLE "code_sequence" ADD COLUMN "period_key" TEXT NOT NULL DEFAULT '';

DROP INDEX "code_sequence_tenant_id_prefix_key";

CREATE UNIQUE INDEX "code_sequence_tenant_id_prefix_period_key_key" ON "code_sequence"("tenant_id", "prefix", "period_key");
