-- Điều trị & Hẹn tái khám (docs/DECISIONS.md #222): thêm 2 mục ghi chú khám — Kết luận và Lời dặn bác sĩ. "Nội dung điều trị" dùng lại `PLAN` đã để sẵn.
-- `ALTER TYPE ... ADD VALUE` phải ở migration RIÊNG (không dùng được giá trị mới trong cùng transaction).
ALTER TYPE "clinical_note_section" ADD VALUE IF NOT EXISTS 'CONCLUSION';
ALTER TYPE "clinical_note_section" ADD VALUE IF NOT EXISTS 'DOCTOR_ADVICE';
