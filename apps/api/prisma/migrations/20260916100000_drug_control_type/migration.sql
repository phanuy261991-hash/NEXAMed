-- Kho Thuốc & Vật tư y tế — bổ sung "Yêu cầu kê đơn (Rx/OTC)" + "Phân loại kiểm soát đặc biệt"
-- (docs/DECISIONS.md #151) — viết tay, môi trường không có TTY (cùng cách 20260915140000/
-- 20260916090000). Enum drug_control_type CỐ ĐỊNH theo Thông tư 20/2017/TT-BYT, không dùng
-- reference_catalog (tenant không được tự thêm/sửa).
CREATE TYPE "drug_control_type" AS ENUM ('NORMAL', 'TOXIC', 'NARCOTIC', 'PSYCHOTROPIC', 'PRECURSOR');

ALTER TABLE "drug" ADD COLUMN "control_type" "drug_control_type" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "drug" ADD COLUMN "is_prescription_only" BOOLEAN NOT NULL DEFAULT true;
