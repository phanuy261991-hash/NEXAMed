-- Hồ sơ bệnh án điện tử (docs/DECISIONS.md #269): thêm 2 mục ghi chú khám TUỲ CHỌN — Tóm tắt bệnh án và Tiên lượng (mục VI và IX của mẫu bệnh án ngoại trú).
-- Cùng khuôn "Kết luận"/"Lời dặn" (#222): không chặn "Hoàn tất khám", ký cùng lúc, đính chính qua `POST .../clinical-note/amend`.
-- `ALTER TYPE ... ADD VALUE` phải ở migration RIÊNG (không dùng được giá trị mới trong cùng transaction).
ALTER TYPE "clinical_note_section" ADD VALUE IF NOT EXISTS 'SUMMARY';
ALTER TYPE "clinical_note_section" ADD VALUE IF NOT EXISTS 'PROGNOSIS';
