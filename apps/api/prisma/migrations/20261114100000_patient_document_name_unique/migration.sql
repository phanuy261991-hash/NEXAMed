-- Không cho tải trùng tên tệp trong cùng một bệnh nhân (docs/DECISIONS.md #299, chủ dự án chốt 14/11/2026). Chỉ áp cho tệp TẢI TAY (UPLOAD): dòng tham chiếu từ nơi khác
-- (giai đoạn 2) có tên do hệ thống đặt nên không tham gia luật này. Không phân biệt hoa thường; chỉ tính tệp chưa xoá mềm (xoá rồi được dùng lại tên).
CREATE UNIQUE INDEX "patient_document_upload_name_key" ON "patient_document"("tenant_id", "patient_id", lower(btrim("display_name"))) WHERE "deleted_at" IS NULL AND "source_type" = 'UPLOAD';
