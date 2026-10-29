-- Loại giá dịch vụ mặc định (docs/DECISIONS.md #268): đánh dấu MỘT Loại giá (reference_catalog category PRICE_TYPE) là
-- mặc định của phòng khám để màn Tiếp nhận tự chọn sẵn. Cột theo category, cùng khuôn deactivates_account / counts_as_cash.
--
-- Không hồi tố: công ty đang có Loại giá KHÔNG bị tự đánh dấu — nếu đánh dấu nhầm mức (ví dụ VIP) thì Tiếp nhận điền sẵn
-- sai mức và thu sai tiền âm thầm. Chủ phòng khám tự tích một lần.

ALTER TABLE "reference_catalog" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Chỉ Loại giá dịch vụ mới có khái niệm mặc định, và mục đã ẩn không thể là mặc định (Tiếp nhận chỉ liệt kê mục đang dùng).
ALTER TABLE "reference_catalog"
  ADD CONSTRAINT "reference_catalog_default_price_type_chk"
  CHECK (NOT "is_default" OR ("category" = 'PRICE_TYPE' AND "is_active"));

-- Mỗi công ty tối đa MỘT Loại giá mặc định (chặn cả khi hai người cùng đặt đồng thời).
CREATE UNIQUE INDEX "reference_catalog_one_default_per_category_uq"
  ON "reference_catalog" ("tenant_id", "category")
  WHERE "is_default" AND "deleted_at" IS NULL;
