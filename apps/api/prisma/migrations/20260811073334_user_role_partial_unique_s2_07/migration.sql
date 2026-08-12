-- S2-07 — chuẩn bị cho gán lại vai trò (PATCH /users/:id): UNIQUE(tenant_id, user_id, role_id)
-- trên `user_role` đổi từ thường sang PARTIAL (WHERE deleted_at IS NULL). Cùng lý do C3
-- (patient.national_id_hash, migration *_patient_s2_01): unique thường sẽ chặn gán lại đúng
-- vai trò đã từng bị gỡ trước đó, vì dòng cũ đã soft-delete (deleted_at khác NULL) vẫn tính vào
-- unique thường. Prisma không hỗ trợ `@@unique` có điều kiện `WHERE` — bỏ khai báo trong
-- schema.prisma, viết thẳng SQL.
--
-- Diff thô từ `prisma migrate diff` còn kèm 3 dòng KHÔNG liên quan (cùng loại "drift giả" đã
-- gặp ở migration *_patient_search_s2_02/*_appointment_s2_05 — index raw-SQL-only không khai
-- báo trong schema.prisma): DROP INDEX appointment_tenant_id_doctor_id_scheduled_at_idx, DROP
-- INDEX patient_tenant_id_phone_idx, DROP INDEX patient_tenant_id_search_key_trgm_idx, ALTER
-- TABLE patient ALTER COLUMN search_key DROP DEFAULT — đã bỏ, KHÔNG đưa vào migration này.

DROP INDEX "user_role_tenant_id_user_id_role_id_key";

CREATE UNIQUE INDEX "user_role_tenant_id_user_id_role_id_key"
  ON "user_role" ("tenant_id", "user_id", "role_id")
  WHERE "deleted_at" IS NULL;
