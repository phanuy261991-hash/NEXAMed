-- S2-02 (PAT-02) — xem .claude/docs/data-model.md, docs/ERD.md mục 5 "Index cần có từ đầu".
--
-- LƯU Ý: bản scaffold gốc do `prisma migrate dev --create-only` sinh ra có kèm
-- `DROP INDEX "patient_tenant_id_phone_idx"` — Prisma coi index này là "drift" vì nó được tạo
-- bằng raw SQL ở migration *_patient_s2_01, không có khai báo tương ứng trong schema.prisma
-- (schema.prisma không có cú pháp cho GENERATED COLUMN/partial index/GIN nên nhiều index của
-- patient chỉ tồn tại ở raw SQL). Đã bỏ dòng DROP INDEX đó — giữ nguyên index cũ.

-- unaccent: bỏ dấu tổ hợp (phần lớn dấu tiếng Việt). pg_trgm: so khớp trigram cho tìm kiếm
-- không dấu kiểu ILIKE '%...%' hiệu quả trên GIN. btree_gin: cho phép cột kiểu thường (uuid) như
-- tenant_id tham gia cùng một GIN index với cột dùng gin_trgm_ops — GIN thuần không có opclass
-- cho uuid.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- unaccent()/unaccent(text) của Postgres là STABLE (phụ thuộc dictionary trong catalog), không
-- dùng được trong GENERATED COLUMN (yêu cầu IMMUTABLE) hay index biểu thức thông thường. Bọc lại
-- thành hàm IMMUTABLE — cách làm chuẩn phổ biến cho tình huống này, chấp nhận đánh đổi: nếu sau
-- này ai đó ALTER TEXT SEARCH DICTIONARY "unaccent" (rất hiếm khi xảy ra, không có trong kế
-- hoạch), search_key của các dòng cũ sẽ không tự cập nhật theo — chấp nhận được.
--
-- unaccent() không xử lý chữ "đ"/"Đ" (không phải ký tự tổ hợp, là chữ cái riêng U+0111/U+0110)
-- nên phải tự replace thêm — khớp đúng packages/core/src/search/strip-vietnamese-diacritics.ts
-- (tầng ứng dụng chuẩn hoá chuỗi tìm kiếm người dùng nhập bằng cùng quy tắc).
CREATE OR REPLACE FUNCTION nexamed_unaccent_lower(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(replace(replace(unaccent(input), 'đ', 'd'), 'Đ', 'D'))
$$;

-- Cột dẫn xuất — tính sẵn lúc ghi (STORED), không tính lại trong câu truy vấn (đúng
-- .claude/docs/data-model.md mục Index tối thiểu). full_name NOT NULL nên search_key không bao
-- giờ null trên thực tế dù cột không khai báo NOT NULL ở DB (tránh rủi ro cú pháp GENERATED +
-- NOT NULL trên một số bản Postgres).
ALTER TABLE "patient"
  ADD COLUMN "search_key" TEXT GENERATED ALWAYS AS (nexamed_unaccent_lower(full_name)) STORED;

-- GIN kết hợp (tenant_id, search_key) — đúng docs/ERD.md mục 5: lọc theo tenant VÀ tìm không dấu
-- trong cùng một index scan, không phải quét toàn bộ rồi lọc tenant sau.
CREATE INDEX "patient_tenant_id_search_key_trgm_idx"
  ON "patient" USING GIN ("tenant_id", "search_key" gin_trgm_ops);
