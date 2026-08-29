-- S5-05 (ADM-03) + S5-06 (PAT-04) — index còn thiếu, đã tài liệu hoá ở docs/ERD.md mục 5 nhưng chưa
-- từng tạo. Thuần additive (CREATE INDEX), không đổi dữ liệu, viết tay theo đúng tên Prisma tự sinh
-- cho @@index (tránh "drift giả" khi chạy `prisma migrate dev --create-only` không tương tác được
-- trong môi trường CI/agent hiện tại — cùng lý do các migration viết tay trước đó).

-- Tra vết audit_log theo entity cụ thể (đúng entityType+entityId) — dùng cho "Nhật ký hoạt động"
-- lọc theo bệnh nhân/lượt khám và mọi tra cứu "ai sửa X" khác.
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_occurred_at_idx"
  ON "audit_log" ("tenant_id", "entity_type", "entity_id", "occurred_at" DESC);

-- Tra vết audit_log theo người dùng.
CREATE INDEX "audit_log_tenant_id_actor_id_occurred_at_idx"
  ON "audit_log" ("tenant_id", "actor_id", "occurred_at" DESC);

-- Tra "các lượt khám thuộc bệnh nhân X" — dùng cho Nhật ký hoạt động (join sang audit_log qua
-- encounterId) và Gộp hồ sơ trùng (chuyển patientId hàng loạt).
CREATE INDEX "encounter_tenant_id_patient_id_idx"
  ON "encounter" ("tenant_id", "patient_id");
