-- Truy vấn có tham số của API (Prisma gửi câu lệnh chuẩn bị sẵn) bị Postgres chuyển sang "kế hoạch chung" sau 5 lần chạy trên cùng một kết nối.
-- Kế hoạch chung KHÔNG thấy giá trị thật của tham số nên ước lượng sai số dòng (ví dụ cho rằng khoảng ngày chỉ khớp 1 lượt khám) và chọn vòng lặp lồng
-- với bảng lớn ở vế trong: báo cáo doanh thu quét lại toàn bộ hoá đơn cho MỖI lượt khám (1.423 lượt × 1.494 hoá đơn, 2 triệu dòng bị loại), ~550 ms thay vì
-- ~5 ms ở dữ liệu thử, và tăng theo BÌNH PHƯƠNG số hoá đơn (đo 18/11/2026, docs/DECISIONS.md #304).
-- `force_custom_plan`: luôn lập kế hoạch theo giá trị tham số thật của từng lần chạy. Chi phí lập kế hoạch (~0,1–2 ms) nhỏ hơn rất nhiều so với rủi ro ở trên.
-- Đặt ở mức role ứng dụng (áp cho mọi kết nối mới; kết nối đang mở nhận sau khi khởi động lại API). Role do migration 20260807170922_tenant_context tạo.
ALTER ROLE nexamed_app SET plan_cache_mode = 'force_custom_plan';
