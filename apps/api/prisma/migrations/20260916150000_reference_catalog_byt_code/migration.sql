-- Thêm cột "Mã liên thông BHYT" (Quyết định 130/QĐ-BYT) cho reference_catalog (docs/DECISIONS.md
-- #152) — chuẩn bị cho tích hợp liên thông BHYT sau này (BHYT ngoài phạm vi v1 theo CLAUDE.md, cột
-- này CHỈ lưu, chưa dùng ở đâu), cùng tinh thần drug.national_code (#147). CHỈ có ý nghĩa với
-- category DRUG_GROUP/DRUG_ROUTE/DOSAGE_FORM, NULL với category khác. Viết tay, môi trường không
-- có TTY.
ALTER TABLE "reference_catalog" ADD COLUMN "byt_code" TEXT;
