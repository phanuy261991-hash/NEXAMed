-- "Số bệnh án" (docs/DECISIONS.md #269): mã riêng của từng lượt khám, tách khỏi `encounter_no` (mã lượt khám cấp lúc tiếp nhận), điền vào ô "Số bệnh án" của
-- mẫu bệnh án ngoại trú. Cấp lúc "Hoàn tất khám" (ký bệnh án) nên không bị "thủng số" do lượt khám bỏ về/không đến.
--
-- NULL = lượt khám chưa hoàn tất, hoặc đã hoàn tất TRƯỚC khi có tính năng (không cấp hồi tố — đánh số lại lịch sử đã ký là việc không đảo ngược được).
ALTER TABLE "encounter" ADD COLUMN "record_no" TEXT;

-- Duy nhất theo công ty. Partial: chỉ xét lượt có số và còn hiệu lực — cùng khuôn các mã hiển thị khác.
CREATE UNIQUE INDEX "encounter_record_no_uq"
  ON "encounter" ("tenant_id", "record_no")
  WHERE "record_no" IS NOT NULL AND "deleted_at" IS NULL;
