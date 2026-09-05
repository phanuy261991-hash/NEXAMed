-- "Loại thu chi" — danh mục dùng chung mới, chủ dự án yêu cầu trực tiếp 2026-09-05, chuẩn bị cho
-- chức năng "Thu chi tại quầy"/Sổ quỹ sắp làm (CHƯA xây ở migration này — chỉ danh mục). Không có
-- nguồn dữ liệu chính thức — KHÔNG seed cứng, để clinic_admin tự thêm qua UI, cùng cách UNIT đã
-- làm ở migration 20260826090000_reference_catalog_unit.
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này nên an toàn chạy
-- trong 1 transaction — cùng lý do đã ghi ở 20260826090000_reference_catalog_unit.
ALTER TYPE "reference_catalog_category" ADD VALUE 'INCOME_EXPENSE_TYPE';

-- Cột "Loại" (Chi tiền/Thu tiền) — CHỈ có ý nghĩa với category INCOME_EXPENSE_TYPE, NULL với
-- category khác (cùng bản chất description/counts_as_cash). CHỈ 2 giá trị cố định, không quản lý
-- qua UI (khác chính code/name của category này) nên dùng Postgres ENUM thay vì tham chiếu
-- reference_catalog khác.
CREATE TYPE "reference_catalog_direction" AS ENUM ('EXPENSE', 'INCOME');

ALTER TABLE "reference_catalog" ADD COLUMN "direction" "reference_catalog_direction";
