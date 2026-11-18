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

## Tab Hình ảnh & Tài liệu (#299, 14/11/2026)

- `patient-document-check.cjs` — rỗng, tải lên nhiều tệp (kể cả tệp quá 15 MB), xem theo ngày/theo loại, thư mục tự tạo, xem lớn, xoá có lý do, lỗi tải danh sách, mất mạng khi tải lên, lễ tân chỉ thấy hợp đồng và giấy tờ. Cũng kiểm ảnh lớn tự thu nhỏ, trùng tên tệp và gửi lại sau mất mạng (không tạo tệp thứ hai). Kỳ vọng 32/32. Dữ liệu thử tiền tố KIEMTAILIEU.
- `patient-document-reference-check.cjs` — giai đoạn 2: ảnh kết quả cận lâm sàng đã duyệt, thẻ BHYT, ảnh đại diện hiện dạng dòng tham chiếu chỉ đọc (nhãn nguồn, cột Nguồn, "Mở kết quả" kể cả khi mất mạng, không Sửa/Xoá), tắt "Áp dụng BHYT" thì ẩn, lễ tân chỉ thấy giấy tờ. Dữ liệu dựng bằng API thật (không ghi thẳng CSDL), tiền tố KIEMGD2. Kỳ vọng 31/31.
- `patient-document-settings-check.cjs` — giai đoạn 3: khối "Hình ảnh & Tài liệu" ở Cấu hình chung (công tắc, dung lượng đã dùng, lỗi tải kèm Thử lại), ảnh tải lên có ảnh thu nhỏ (lưới dùng ảnh nhỏ, xem lớn dùng ảnh gốc), tắt công tắc thì tab biến mất (quản trị và lễ tân) và máy chủ trả 409, bật lại còn đủ tệp. Thêm kịch bản ảnh thu nhỏ BÙ (tệp cũ → trình duyệt tự gửi ảnh nhỏ → lần mở sau dùng ảnh nhỏ). Tiền tố KIEMGD3; cuối chạy trả công tắc về như cũ và khoá tài khoản thử. Kỳ vọng 25/25.

## Kiểm các trạng thái lỗi (#255, thêm 23/10/2026)

- `error-states.cjs` — URL lạ, lưu gặp 503/mất mạng (hộp thông báo, dữ liệu form còn nguyên), lỗi nghiệp vụ 409 hiện tại chỗ, thông điệp tiếng Anh của máy chủ bị thay, hết phiên, mã khởi động hỏng → khung báo tĩnh. Kỳ vọng 15/15.
- `error-sweep.cjs` — quét MỌI route tĩnh của router, giả lập "không tải được mã trang": mỗi route phải hiện màn "Phần mềm vừa được cập nhật" trong khung ứng dụng. Kỳ vọng 47/47 (đổi theo số route).
- Cùng biến môi trường như trên + `UI_AUDIT_OUT` (nơi lưu ảnh chụp, mặc định thư mục tạm, KHÔNG để trong repo). Quy tắc xử lý lỗi cho chức năng mới: `.claude/docs/ui-guidelines.md` mục 17b.

## Thanh tab màn khám (#300, 17/11/2026)

- `consultation-tabs-check.cjs` — thanh tab màn khám không cuộn ở 1280/1366/1440/1536/1920/2560, nút "Thêm" + menu + chọn tab trong menu ở 1000 px, rất hẹp 760 px. Tạo lượt khám thử tiền tố KIEMTAB, cuối chạy khoá bác sĩ thử. Kỳ vọng 23/23.
- `encounter-images-check.cjs` — tab "Hình ảnh" + hộp "Đính ảnh" ở màn khám (#299 bổ sung 6): rỗng, hộp Đính ảnh, dán Ctrl+V, số trên tab, lọc, xem lớn, ảnh nằm ở hồ sơ bệnh nhân, bổ sung sau hoàn tất, chỉ xem thì nút mờ, lỗi tải/lỗi đính, công tắc tắt ẩn tab. Tiền tố KIEMIMG. Kỳ vọng 25/25.
- `dicom-check.cjs` — chế độ DICOM tuỳ chọn (#299 bổ sung 6): công tắc, khối "Tệp DICOM gốc" ở màn nhập kết quả, trình xem (vẽ ảnh thật, công cụ, nhiều khung), tên khác hồ sơ, kiểu nén chưa đọc được, mất mạng + Thử lại, đã duyệt, tab Hình ảnh, tệp hỏng, ảnh lớn. Dựng DICOM tổng hợp trong script. Tiền tố KIEMDCM. Kỳ vọng 41/41 (gồm dải "Tệp DICOM gốc" ở hộp Xem kết quả).

## Hiệu năng chuyển trang (#303, 18/11/2026)

- `nav-perf-audit.cjs` — chuyển SPA qua từng trang menu, hai lượt (chunk chưa có/đã có trong cache): paint, hết skeleton, số yêu cầu API/JS, yêu cầu chậm nhất, long task, endpoint chậm nhất và bị gọi lặp. `CPU=4` giả lập máy cũ, `ONLY=chuoi1,chuoi2` đo vài trang (nên đo CẶP trang khác nhau để lượt 2 có nội dung đổi). Cần bản PRODUCTION: `pnpm --filter @nexamed/web build`, đặt `apiBaseUrl` rỗng ở `apps/web/dist/config.json`, chạy API (`node apps/api/dist/main.js`) + `VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite preview --port 4173`.
- `windowed-tables-check.cjs` — các bảng cuộn ảo (Phát thuốc, Tồn kho, Sổ kho, Chất lượng): chỉ dựng ít hàng, cuộn tới cuối đúng hàng cuối, cột thẳng đầu bảng, bấm nút trong hàng, không lỗi Console.
