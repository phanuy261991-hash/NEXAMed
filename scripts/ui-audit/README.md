# Kiểm giao diện (đa kích thước màn hình + độ đậm chữ)

Hai script Playwright chạy trên Chrome thật. Xem quy tắc ở `.claude/docs/ui-guidelines.md` mục 15 (đa kích thước) và mục 16 (độ đậm), quyết định ở `docs/DECISIONS.md` #240.

## Chuẩn bị
1. `pnpm dev` (web 5173 + API 3001) và DB dev có dữ liệu mẫu.
2. Cài `playwright-core` ở MỘT thư mục tạm (không đưa vào repo): `npm i playwright-core@1.49.1`, rồi đặt `PLAYWRIGHT_CORE=<thư-mục-tạm>/node_modules/playwright-core`.
3. Có Chrome (đặt `CHROME_PATH` nếu không ở đường dẫn Windows mặc định).

## Chạy
```
node scripts/ui-audit/layout-audit.cjs     # ~53 trang × 10 cỡ màn hình: cuộn ngang, cuộn dọc cả trang (phần tử `absolute`/`sr-only` thiếu tổ tiên `relative`), tràn phải, chữ bị cắt, bó hẹp, trang trắng, lỗi JS → ui-audit-out/report.json + ảnh
ONLY=inventory/transfers,suppliers node scripts/ui-audit/layout-audit.cjs   # chỉ vài trang (không có / đầu)
node scripts/ui-audit/weight-audit.cjs     # font-weight THẬT theo vai trò (tiêu đề, đầu cột, ô bảng, nhãn, nút, giá trị trong ô nhập): mong đợi KHÔNG có giá trị >= 700; ô nhập = 400 (#246)
```
Biến môi trường: `UI_AUDIT_EXTRA` (thêm trang cần dữ liệu riêng, dạng `/nhan|/duong-dan,...`), `UI_AUDIT_WEB`, `UI_AUDIT_API`, `UI_AUDIT_TENANT`, `UI_AUDIT_USER`, `UI_AUDIT_PASS`, `UI_AUDIT_OUT`. Chạy TUẦN TỰ một phiên đăng nhập (refresh token xoay vòng — không chạy hai bản cùng lúc). Mặc định dùng tài khoản dev của tenant test cố định.

## Phạm vi chưa phủ
Tab/pill con trong trang, hộp thoại, trạng thái có dữ liệu lớn, trang cần dữ liệu riêng chưa có ở tenant dev.

## Kiểm các trạng thái lỗi (#255, thêm 23/10/2026)

- `error-states.cjs` — URL lạ, lưu gặp 503/mất mạng (hộp thông báo, dữ liệu form còn nguyên), lỗi nghiệp vụ 409 hiện tại chỗ, thông điệp tiếng Anh của máy chủ bị thay, hết phiên, mã khởi động hỏng → khung báo tĩnh. Kỳ vọng 15/15.
- `error-sweep.cjs` — quét MỌI route tĩnh của router, giả lập "không tải được mã trang": mỗi route phải hiện màn "Phần mềm vừa được cập nhật" trong khung ứng dụng. Kỳ vọng 47/47 (đổi theo số route).
- Cùng biến môi trường như trên + `UI_AUDIT_OUT` (nơi lưu ảnh chụp, mặc định thư mục tạm, KHÔNG để trong repo). Quy tắc xử lý lỗi cho chức năng mới: `.claude/docs/ui-guidelines.md` mục 17b.
