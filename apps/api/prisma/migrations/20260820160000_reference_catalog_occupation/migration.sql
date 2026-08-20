-- "Nghề nghiệp" — danh mục dùng chung mới, đảo ngược tiếp phần `occupation` của
-- docs/DECISIONS.md #034 (trước đây cố ý để text tự do, thiếu nguồn dữ liệu chính thức). Cùng
-- category không FK cứng như ETHNICITY/NATIONALITY, patient.occupation vẫn String? thuần.
--
-- Không có nguồn dữ liệu chính thức (khác Dân tộc/Quốc tịch) — KHÔNG seed cứng, để clinic_admin
-- tự thêm qua UI "Danh mục hành chính", cùng cách PATIENT_SOURCE/EXAM_TYPE/RECEPTION_TYPE/
-- EXAM_FORM/PRIORITY_REASON/PRICE_TYPE đã làm.
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này (không insert/
-- update dòng nào dùng nó) nên an toàn chạy trong 1 transaction — cùng lý do đã ghi ở migration
-- 20260818150000_appointment_reschedule_status.

ALTER TYPE "reference_catalog_category" ADD VALUE 'OCCUPATION';