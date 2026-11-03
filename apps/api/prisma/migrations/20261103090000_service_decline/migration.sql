-- "Khách không làm dịch vụ" (docs/DECISIONS.md #280) — bác sĩ đã chỉ định dịch vụ kỹ thuật nhưng ra
-- quầy khách không muốn làm. Trước đây chỉ bác sĩ (phạm vi `personal`) và quản lý phòng khám gỡ được
-- dòng chỉ định, nên người đứng ở quầy phải gọi bác sĩ quay lại hoặc lách bằng chiết khấu (làm sai
-- thống kê dịch vụ). Migration này chuẩn bị dữ liệu cho luồng mới ở màn Thu ngân.
--
-- 1) Danh mục lý do: `SERVICE_DECLINE_REASON`. Postgres KHÔNG cho dùng giá trị enum mới trong CÙNG
--    transaction với `ADD VALUE`, nên 5 dòng lý do mặc định được nạp bằng seed ứng dụng
--    (`seedSystemReferenceDataForTenant`, chạy sau migration qua `db:seed`) chứ không INSERT ở đây.
--    Mã lý do là mã CỐ ĐỊNH vì nó được lưu lên dòng chỉ định và in ra bệnh án.
--
-- 2) Bốn cột trên `clinical_order_item`: CHỈ có giá trị khi `status='CANCELLED'` do thu ngân bỏ ở
--    quầy. Dòng KHÔNG bị soft-delete — khác hẳn việc bác sĩ tự gỡ một dòng vừa thêm sai (đó là sửa
--    nhầm, dòng biến mất hẳn). Giữ dòng lại để hiện ở khối "Đã huỷ" màn khám và in mục "Đã chỉ định
--    nhưng không thực hiện" trên bệnh án, đúng ba khái niệm tách bạch ở #280.
--    `decline_reason_code` không FK cứng tới `reference_catalog` (đúng khuôn `payment.method`,
--    `exam_type_code`): đổi/ẩn mục danh mục về sau không được làm hỏng dòng đã ghi.
--    `declined_by` là uuid trần như `collected_by`/`created_by` — không FK.
--
-- Viết tay, môi trường không có TTY. Forward-only.

ALTER TYPE "reference_catalog_category" ADD VALUE 'SERVICE_DECLINE_REASON';

ALTER TABLE "clinical_order_item"
  ADD COLUMN "decline_reason_code" TEXT,
  ADD COLUMN "decline_note" TEXT,
  ADD COLUMN "declined_at" TIMESTAMPTZ(6),
  ADD COLUMN "declined_by" UUID;

-- KHÔNG thêm index: các dòng đã huỷ luôn được nạp cùng toàn bộ dòng của phiếu chỉ định (đã có
-- `@@unique([tenant_id, id])` và truy vấn theo `clinical_order_id`), nên index riêng không giúp gì —
-- và index có `WHERE` thì Prisma không khai được trong `schema.prisma`, sẽ gây lệch schema.
