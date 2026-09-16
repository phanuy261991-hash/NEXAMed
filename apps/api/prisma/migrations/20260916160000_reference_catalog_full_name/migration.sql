-- Thêm cột "Tên đầy đủ chuẩn" cho reference_catalog (docs/DECISIONS.md #152, chủ dự án yêu cầu
-- nạp đầy đủ mọi cột theo file gốc thay vì chỉ giữ "Tên ngắn UI" ở `name`) — CHỈ có ý nghĩa với
-- category DRUG_GROUP/DRUG_ROUTE/DOSAGE_FORM, NULL với category khác, cùng bản chất `byt_code`.
-- Cột "Mô tả / Ví dụ" (chỉ có ở Đường dùng/Dạng bào chế) TÁI DÙNG cột `description` có sẵn (đã
-- generic theo category, không cần cột mới). Viết tay, môi trường không có TTY.
ALTER TABLE "reference_catalog" ADD COLUMN "full_name" TEXT;
