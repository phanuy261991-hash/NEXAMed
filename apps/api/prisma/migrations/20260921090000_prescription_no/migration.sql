-- "Mã đơn thuốc thật" (docs/DECISIONS.md #169) — prescription.prescription_no, sinh lúc KÝ (NULL
-- khi còn nháp). Prisma không biểu diễn được unique có điều kiện, khai raw SQL (cùng lý do C3
-- patient.national_id_hash, C14 role.name, stock_balance batch_id). Viết tay, môi trường không có
-- TTY (không chạy được `prisma migrate dev` tương tác).

ALTER TABLE "prescription" ADD COLUMN "prescription_no" TEXT;

-- KHÁC C3 (patient.national_id_hash) — thêm điều kiện "deleted_at IS NULL": đính chính GIỮ NGUYÊN
-- mã gốc theo thiết kế (xem cột `supersedes_id`/`EncounterService.amendPrescription()`), nên bản
-- gốc đã bị đính chính (soft-delete lúc `supersede()`) và bản đính chính đang HIỆU LỰC cố ý mang
-- CÙNG mã — chỉ cấm 2 bản ĐANG hiệu lực (deleted_at IS NULL) trùng mã, không cấm trùng với lịch sử.
CREATE UNIQUE INDEX "prescription_tenant_id_prescription_no_key"
  ON "prescription" ("tenant_id", "prescription_no")
  WHERE "prescription_no" IS NOT NULL AND "deleted_at" IS NULL;

-- Backfill đơn ĐÃ KÝ trước khi có cột này. Đúng khuôn mã mặc định của BusinessCodeService
-- (DEFAULT_BUSINESS_CODE_TEMPLATE.PRESCRIPTION = "DT[Năm 2 số][Tháng][Số đếm]", 6 chữ số đếm,
-- period_key='' vì đây là loại mã MỚI — chưa tenant nào có khuôn tự cấu hình nên generate() luôn
-- dùng period_key rỗng, kể cả bản ghi CŨ lẫn MỚI, cho tới khi tenant chủ động lưu khuôn riêng).
--
-- Bước 1: gán mã cho bản GỐC (supersedes_id IS NULL) theo thứ tự signed_at tăng dần trong từng
-- tenant — KHÔNG lọc deleted_at vì bản gốc đã bị đính chính (soft-delete) vẫn cần mã để chuỗi đính
-- chính bên dưới kế thừa đúng.
WITH ordered_roots AS (
  SELECT id, tenant_id, signed_at,
         row_number() OVER (PARTITION BY tenant_id ORDER BY signed_at ASC, id ASC) AS seq
  FROM "prescription"
  WHERE supersedes_id IS NULL AND signed_at IS NOT NULL
)
UPDATE "prescription" p
SET prescription_no = 'DT' ||
  to_char(o.signed_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMM') ||
  lpad(o.seq::text, 6, '0')
FROM ordered_roots o
WHERE p.id = o.id;

-- Bước 2: lan truyền mã gốc xuống toàn bộ chuỗi đính chính (GIỮ NGUYÊN mã gốc, đúng quyết định đã
-- chốt qua AskUserQuestion — đính chính không sinh mã mới) qua recursive CTE, đi qua bao nhiêu cấp
-- đính chính cũng đúng (supersedes_id chỉ trỏ tới bản NGAY TRƯỚC, không phải bản gốc).
WITH RECURSIVE chain AS (
  SELECT id, prescription_no
  FROM "prescription"
  WHERE supersedes_id IS NULL AND prescription_no IS NOT NULL
  UNION ALL
  SELECT p.id, c.prescription_no
  FROM "prescription" p
  JOIN chain c ON p.supersedes_id = c.id
  WHERE p.signed_at IS NOT NULL
)
UPDATE "prescription" p
SET prescription_no = chain.prescription_no
FROM chain
WHERE p.id = chain.id AND p.prescription_no IS NULL;

-- Bước 3: khởi tạo code_sequence để lần KÝ MỚI tiếp theo tiếp nối đúng mạch đếm (không trùng số
-- vừa backfill) — đúng cơ chế atomic của CodeSequenceRepository.next() (INSERT ... ON CONFLICT).
INSERT INTO code_sequence (tenant_id, prefix, period_key, current_value, created_by, updated_by)
SELECT tenant_id, 'DT', '', count(*), '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'
FROM "prescription"
WHERE supersedes_id IS NULL AND signed_at IS NOT NULL
GROUP BY tenant_id
ON CONFLICT (tenant_id, prefix, period_key) DO NOTHING;
