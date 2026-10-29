-- Dòng đơn thuốc dùng cấu hình "Cách kê liều" của thuốc (docs/DECISIONS.md #267, phần 2): kiểu "Khi cần" (liều mỗi lần + số lượng nhập thẳng, không có số ngày)
-- và liều theo đơn vị khác đơn vị kho (ml → số Hộp/chai làm tròn lên).
--
-- prescription_item: thêm kiểu kê, liều mỗi lần, TÊN đơn vị liều ("ml") + dung tích CHỤP lúc lưu (đơn đã ký không đổi khi thuốc đổi cấu hình); số ngày cho phép NULL (chỉ khi "Khi cần").
-- prescription_template_item: thêm kiểu kê + liều mỗi lần (đơn mẫu mang theo kiểu kê; đơn vị liều luôn đọc từ thuốc khi áp mẫu).
-- Dòng cũ đều là "Theo buổi" (mặc định) nên không đổi nội dung nào.

-- ============ prescription_item ============
ALTER TABLE "prescription_item" ADD COLUMN "dose_mode" "drug_dose_mode" NOT NULL DEFAULT 'SCHEDULED';
-- NUMERIC có chủ đích (liều, không phải tiền), bội của 0,25 như liều theo buổi (#241).
ALTER TABLE "prescription_item" ADD COLUMN "single_dose" DECIMAL(5,2);
ALTER TABLE "prescription_item" ADD COLUMN "dose_unit_name" TEXT;
ALTER TABLE "prescription_item" ADD COLUMN "dose_per_base_unit" DECIMAL(8,2);
ALTER TABLE "prescription_item" ALTER COLUMN "duration_days" DROP NOT NULL;

-- "Theo buổi": có số ngày, không có liều mỗi lần. "Khi cần": không số ngày, 4 liều theo buổi đều 0, liều mỗi lần (nếu có) là bội của 0,25.
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_dose_mode_check" CHECK (
  (dose_mode = 'SCHEDULED' AND duration_days IS NOT NULL AND single_dose IS NULL)
  OR (
    dose_mode = 'AS_NEEDED' AND duration_days IS NULL
    AND dose_morning = 0 AND dose_noon = 0 AND dose_afternoon = 0 AND dose_evening = 0
    AND (single_dose IS NULL OR (single_dose >= 0 AND (single_dose * 4) = trunc(single_dose * 4)))
  )
);
-- Đơn vị liều và dung tích CÙNG có hoặc CÙNG không; dung tích dương và là bội của 0,25 (khớp drug_dose_unit_pair_check).
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_dose_unit_pair_check" CHECK (
  (dose_unit_name IS NULL AND dose_per_base_unit IS NULL)
  OR (dose_unit_name IS NOT NULL AND dose_per_base_unit IS NOT NULL AND dose_per_base_unit > 0 AND (dose_per_base_unit * 4) = trunc(dose_per_base_unit * 4))
);

-- ============ prescription_template_item ============
ALTER TABLE "prescription_template_item" ADD COLUMN "dose_mode" "drug_dose_mode" NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "prescription_template_item" ADD COLUMN "single_dose" DECIMAL(5,2);
ALTER TABLE "prescription_template_item" ALTER COLUMN "duration_days" DROP NOT NULL;
ALTER TABLE "prescription_template_item" DROP CONSTRAINT "prescription_template_item_duration_days_check";
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_dose_mode_check" CHECK (
  (dose_mode = 'SCHEDULED' AND duration_days IS NOT NULL AND duration_days > 0 AND single_dose IS NULL)
  OR (
    dose_mode = 'AS_NEEDED' AND duration_days IS NULL
    AND dose_morning = 0 AND dose_noon = 0 AND dose_afternoon = 0 AND dose_evening = 0
    AND (single_dose IS NULL OR (single_dose >= 0 AND (single_dose * 4) = trunc(single_dose * 4)))
  )
);
