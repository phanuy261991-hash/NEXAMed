-- "Đơn vị tính" — danh mục dùng chung mới, chủ dự án yêu cầu trực tiếp 2026-08-26. Không có nguồn
-- dữ liệu chính thức — KHÔNG seed cứng, để clinic_admin tự thêm qua UI, cùng cách OCCUPATION đã
-- làm ở migration 20260820160000_reference_catalog_occupation.
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này nên an toàn chạy
-- trong 1 transaction — cùng lý do đã ghi ở 20260820160000_reference_catalog_occupation.

ALTER TYPE "reference_catalog_category" ADD VALUE 'UNIT';