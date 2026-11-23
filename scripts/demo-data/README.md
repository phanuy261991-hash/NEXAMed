# Dữ liệu mẫu để chụp ảnh giới thiệu

Dựng công ty "Phòng khám Đa khoa Hòa Hưng" với dữ liệu sạch (tên, địa chỉ, lý do khám thật; không có chữ test hay mã ngẫu nhiên) để chụp màn hình quảng cáo. Chỉ gọi API HTTP, không ghi cơ sở dữ liệu bằng SQL.

## Chạy

1. Bật cơ sở dữ liệu và API: `docker compose up -d`, rồi bản build production của API (`cd apps/api && NODE_ENV=production PORT=3001 node dist/main.js`) hoặc `pnpm dev`.
2. Dựng dữ liệu: `node scripts/demo-data/seed-demo-clinic.mjs`
   - `--days=5` số ngày lịch hẹn kể từ hôm nay (mặc định 5, bỏ Chủ nhật)
   - `--patients=170` tổng số bệnh nhân
   - `--no-reception` chỉ dựng lịch hẹn, không dựng danh sách tiếp nhận hôm nay
3. Xem trên trình duyệt (không đụng `apps/web/public/config.json` đang trỏ công ty thử nghiệm cố định):
   - `pnpm --filter @nexamed/web build`, rồi đặt `apps/web/dist/config.json` thành `{ "apiBaseUrl": "", "tenantId": "01a1c100-5884-7bdb-8558-0981f8cbf306" }`
   - `cd apps/web && VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite preview --port 4173`, mở `http://localhost:4173`
   - Đăng nhập `giamdoc` / `HoaHung@2026` (đủ 155 quyền).

Script chạy lại được: bệnh nhân, ca làm việc, lịch hẹn đã có thì bỏ qua; danh sách tiếp nhận hôm nay chỉ dựng khi chưa có từ 25 lượt trở lên.

## Kho thuốc & vật tư

`node scripts/demo-data/seed-demo-pharmacy.mjs` thêm khoảng 60 thuốc (kháng sinh, giảm đau, hô hấp, tim mạch, tiêu hoá, nội tiết, vitamin, da liễu, nhỏ mắt/mũi...), 12 vật tư y tế, 4 nhà cung cấp, rồi nhập kho nhiều lô có hạn dùng (có vài mặt hàng tồn thấp và vài lô sắp hết hạn để trang cảnh báo có dữ liệu). Chạy sau khi đã dựng công ty bằng `seed-demo-clinic.mjs`; chạy lại không tạo trùng.

## Lưu ý về giờ

Danh sách "Bệnh nhân trong ngày" và hàng chờ dựng theo giờ máy lúc chạy (giờ chờ tính từ lúc tiếp nhận), nên chạy ngay trước khi chụp, tốt nhất trong giờ làm việc 08:30–17:00. Lịch hẹn các ngày sau luôn ở tương lai nên chụp lịch hẹn lúc nào cũng đẹp.

## Tài khoản (mật khẩu chung `HoaHung@2026`)

| Tài khoản | Vai trò |
|---|---|
| `giamdoc` | Quản trị toàn quyền (vai trò "Quản trị toàn quyền", đủ mọi quyền) |
| `hoangnam` | Quản lý phòng khám |
| `bs.thanhphong`, `bs.quocviet`, `bs.maianh`, `bs.giabao`, `bs.minhchau` | Bác sĩ (Nội, Tai Mũi Họng, Nhi, Tim mạch, Da liễu) |
| `letan.thuha`, `letan.ngoctram` | Lễ tân / thu ngân |
| `dd.kimngan`, `xn.minhkhang` | Điều dưỡng, kỹ thuật viên xét nghiệm |

Màn "Hàng đợi khám" chỉ hiện hàng đợi của chính người đăng nhập, nên muốn chụp danh sách chờ khám hãy đăng nhập bằng tài khoản bác sĩ (lần đầu trong ngày hiện hộp "Chọn phòng làm việc hôm nay": chọn một phòng rồi Xác nhận). Mỗi bác sĩ có ít nhất 8 người chờ (tuỳ chọn `--waiting=8`), 1 người đang khám và nhiều lượt đã khám.

Không dùng cho môi trường thật: mật khẩu cố định và công ty này chỉ để chụp ảnh.
