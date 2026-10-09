-- Cận lâm sàng — "Kết quả mới" cho bác sĩ ở Hàng đợi khám (docs/DECISIONS.md #221).
-- Mốc bác sĩ phụ trách đã mở tab "Kết quả cận lâm sàng" xem kết quả của dòng chỉ định. NULL + status COMPLETED = kết quả mới chưa xem.
-- Chỉ thêm 1 cột nullable vào bảng có sẵn (không bảng mới, không đổi RLS/CHECK).

ALTER TABLE "clinical_order_item" ADD COLUMN "doctor_seen_at" TIMESTAMPTZ(6);

-- Kết quả đã duyệt TRƯỚC khi có tính năng coi như đã xem (tránh nhãn "Có kết quả mới" tràn ngập lúc nâng cấp).
UPDATE "clinical_order_item" SET "doctor_seen_at" = CURRENT_TIMESTAMP WHERE "status" = 'COMPLETED' AND "doctor_seen_at" IS NULL;
