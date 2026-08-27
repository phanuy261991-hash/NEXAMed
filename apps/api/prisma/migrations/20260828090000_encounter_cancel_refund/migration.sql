-- Huỷ lượt khám + hoàn tiền (docs/DECISIONS.md #085) — xử lý 3 tình huống vận hành thật chủ dự án
-- nêu: (1) khách đã tiếp nhận nhưng bỏ về không khám, (2) khách đã đóng tiền rồi huỷ, phải trả lại
-- tiền, (3) khách rút khỏi hàng đợi khi bác sĩ đã nhận ca.
--
-- Trước migration này: `POST /encounters/:id/cancel` chỉ đổi encounter.status, KHÔNG đụng gì tới
-- phiếu thu — phiếu UNPAID của ca đã huỷ treo vĩnh viễn ở tab "Chờ thu" và vẫn cộng vào tổng kết
-- cuối ngày (sai BIL-04); còn phiếu đã PAID thì không có đường hoàn tiền nào ngoài "Đánh dấu chưa
-- thu" (vốn là cơ chế SỬA THAO TÁC NHẦM — xoá hẳn vết đã từng thu, sai bản chất kế toán).
--
-- ALTER TYPE ... ADD VALUE không dùng được giá trị mới ngay trong CÙNG migration (bài học đã ghi ở
-- 20260826090000_reference_catalog_unit và 20260827120000_reference_catalog_payment_method) —
-- backfill payment.type cho dòng cũ tách sang migration kế tiếp (20260828091000).

-- (1) invoice_status: 2 → 4 giá trị.
--   CANCELLED = lượt khám bị huỷ khi CHƯA thu tiền (không còn gì để thu, rớt khỏi "Chờ thu" và
--               khỏi tổng kết cuối ngày, nhưng VẪN tra cứu lại được theo mã phiếu — khác hẳn
--               soft-delete, vì phiếu có thể đã in đưa khách trước lúc huỷ).
--   REFUNDED  = lượt khám bị huỷ khi ĐÃ thu tiền VÀ đã hoàn trả xong (có dòng payment type=REFUND
--               đối ứng). Trạng thái PAID trung gian được GIỮ NGUYÊN sau khi huỷ ca cho tới lúc
--               hoàn tiền thật — chủ đích: lễ tân (không có quyền invoice.refund) vẫn đánh dấu
--               khách bỏ về được ngay, tiền để người có quyền xử lý sau, không kẹt chờ admin.
ALTER TYPE "invoice_status" ADD VALUE 'CANCELLED';
ALTER TYPE "invoice_status" ADD VALUE 'REFUNDED';

-- (2) payment.type — tách "thu vào" khỏi "trả ra" trên CÙNG bảng payment (bảng này ngay từ đầu đã
-- được thiết kế tách khỏi invoice để không phải đổi schema khi cần nhiều đợt thanh toán, xem
-- comment model Payment trong schema.prisma). Hoàn tiền là một dòng payment MỚI còn SỐNG
-- (deleted_at IS NULL), KHÔNG phải soft-delete dòng thu cũ — giữ đủ vết 2 chiều "thu 200k lúc
-- 9:00 / hoàn 200k lúc 9:15", đối soát két tiền cuối ngày mới khớp.
CREATE TYPE "payment_type" AS ENUM ('PAYMENT', 'REFUND');

-- DEFAULT 'PAYMENT' cho dòng đã tồn tại (mọi dòng payment trước migration này đều là tiền thu
-- vào — chưa từng có đường hoàn tiền). Giá trị enum vừa ADD ở trên chưa commit nên chưa dùng được
-- làm DEFAULT ngay ở đây; cột khai NULL trước, backfill + SET NOT NULL ở migration kế tiếp.
ALTER TABLE "payment" ADD COLUMN "type" "payment_type";

-- Lý do hoàn tiền (bắt buộc ở tầng service khi type=REFUND, nullable ở DB vì dòng PAYMENT không
-- dùng). KHÁC "deleted_reason" 8-cột-bắt-buộc: dòng REFUND không bị xoá, đây là lý do nghiệp vụ
-- in được lên phiếu chi cho khách ký nhận.
ALTER TABLE "payment" ADD COLUMN "reason" TEXT;