-- Danh mục "Hình thức thanh toán" (chủ dự án yêu cầu trực tiếp 2026-08-27) — đổi
-- payment.method/invoice.pending_payment_method từ Postgres ENUM cố định (CASH/BANK_TRANSFER)
-- sang mã tham chiếu reference_catalog category PAYMENT_METHOD (text, KHÔNG FK cứng — cùng khuôn
-- exam_type_code/price_type_code/unit_code) để clinic_admin thêm/sửa/ẩn hình thức thanh toán qua
-- UI thay vì cố định trong code.
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này (cùng lý do đã ghi
-- ở 20260826090000_reference_catalog_unit) — 2 dòng mặc định CASH/BANK_TRANSFER seed ở migration
-- kế tiếp (20260827121000_seed_payment_method_catalog) sau khi giá trị enum đã commit.
ALTER TYPE "reference_catalog_category" ADD VALUE 'PAYMENT_METHOD';

-- Đổi cột method/pending_payment_method từ enum "payment_method" sang TEXT — cast thẳng giữ
-- nguyên giá trị hiện có ('CASH'/'BANK_TRANSFER'), đúng 2 code sẽ seed ở migration kế tiếp nên
-- không mồ côi dữ liệu cũ.
ALTER TABLE "payment" ALTER COLUMN "method" TYPE TEXT USING "method"::TEXT;
ALTER TABLE "invoice" ALTER COLUMN "pending_payment_method" TYPE TEXT USING "pending_payment_method"::TEXT;

DROP TYPE "payment_method";
