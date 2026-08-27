-- Bước 2 của "huỷ lượt khám + hoàn tiền" (docs/DECISIONS.md #085) — tách khỏi migration
-- 20260828090000 vì giá trị enum "payment_type" chỉ dùng được sau khi migration tạo nó đã commit.

-- Mọi dòng payment tồn tại trước #085 đều là tiền THU VÀO (chưa từng có đường hoàn tiền trong hệ
-- thống) — backfill toàn bộ, kể cả dòng đã soft-delete bởi "Đánh dấu chưa thu" (deleted_at khác
-- NULL): dòng đó vẫn mang bản chất một lần thu, chỉ là đã bị đánh dấu là thao tác nhầm.
UPDATE "payment" SET "type" = 'PAYMENT' WHERE "type" IS NULL;

ALTER TABLE "payment" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "payment" ALTER COLUMN "type" SET DEFAULT 'PAYMENT';