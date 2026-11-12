# HANDOFF — #297 GĐ4 "Chi phí vật tư theo dịch vụ" XONG (máy chủ + web + báo cáo) — 2026-11-12

## 1. Trạng thái một câu
GĐ4 đã xong code, test và kiểm Chrome thật (màn 7, 8, 9, 10 của mockup https://claude.ai/artifact/KcYSjc9SJUJ3xRKrpK5aNc). Phần máy chủ commit `f580591`; phần còn lại (hộp huỷ dịch vụ, ghi tiêu hao ở web, báo cáo, tài liệu) commit ngay sau đó. `16c909c` (GĐ3) và các commit GĐ4 **chưa push**. Dev server đã tắt, `config.json` nguyên trạng, dữ liệu thử `KIEM297*` ở tenant thử đã ẩn/khoá.

## 2. Việc kế tiếp
1. Push + kiểm CI GitHub (chủ dự án chưa nói "push" trong phiên này).
2. **Việc chủ dự án yêu cầu 12/11/2026 (KHÔNG tự làm, cần mockup duyệt)**: rà soát báo cáo lợi nhuận hiện có → "lãi gộp theo dịch vụ" (cột Doanh thu dịch vụ, Lãi gộp dịch vụ) + tab "Theo vật tư" + tab "Theo chi nhánh" của báo cáo chi phí vật tư. Chi tiết và câu cần chốt ở cuối `docs/TASK.md`.
3. GĐ5 của #297: tài liệu hướng dẫn nhập liệu (Vật tư, định mức, ghi tiêu hao).
4. Chủ dự án chưa xem 6 quyết định kỹ thuật GĐ4 (`docs/DECISIONS.md` #297 bổ sung 2) và câu cũ "Excel để trống Tính chất sử dụng có tự điền Dùng 1 lần không".
5. Dọn tài liệu theo ngưỡng cắt: `DECISIONS.md` ~225 KB (ngưỡng 150 KB), `ERD.md` ~85 KB (ngưỡng 80 KB; `ERD-2.md` cũng sắp tới ngưỡng) — chưa cắt vì chưa được yêu cầu.

## 3. Cần biết
- **Giới hạn nghiệp vụ**: hộp "Khách không làm dịch vụ" chỉ bỏ được dịch vụ còn `ORDERED`, mà màn nhập kết quả CĐHA chỉ mở sau "gọi vào phòng", nên khối vật tư ở hộp huỷ hiếm khi xuất hiện trong luồng thật (xem DECISIONS #297 bổ sung 2). Nếu chủ dự án muốn xử lý, cần bàn lại quy tắc "việc đã làm vẫn phải trả tiền" (#280).
- Cổng `ServiceConsumptionDeclinePort` (core) + adapter `infrastructure/inventory` + `ServiceConsumptionDeclineModule` (`@Global()`), đảo phiếu cùng giao dịch với việc huỷ dịch vụ.
- Phiếu tiêu hao KHÔNG huỷ được ở danh sách phiếu xuất (409); đảo ở dịch vụ, cần `service_consumption.reverse` + lý do.
- Đã sửa `migrateSupplierPermissions` (#291) chỉ áp vai trò tuỳ biến.
- Môi trường khác: `db:deploy` (1 migration), `db:seed` (5 quyền), khởi động lại API.

## 4. Cách chạy lại kiểm Chrome (đã dùng)
1. `pnpm --filter @nexamed/api run db:seed`; bật API: `pnpm --filter @nexamed/api run dev` (đổi `packages/core` thì phải khởi động lại API — quyền đi kèm do API trả về, nạp từ `dist`).
2. `pnpm dev:lan` (in địa chỉ IP, **IP máy đổi giữa các phiên**); cài `playwright-core@1.49.1` ở thư mục tạm.
3. `PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<tạm> node scripts/ui-audit/service-consumption-check.cjs` → mong đợi 36/36. Kịch bản tự tạo bác sĩ thử `kiem297.bs.*`, 2 lượt khám, thu tiền, gọi vào phòng, tạm tắt "ngày trước phải đóng ca" và trả lại, rồi ẩn dữ liệu thử.
4. Quét quyền: `provision-sweep-accounts.cjs` rồi `UI_AUDIT_ONLY=service-consumption UI_AUDIT_SECTIONS=default,custom node scripts/ui-audit/role-access-sweep.cjs`.

## 5. Bẫy đã gặp
- PATCH thuốc/dịch vụ/tài khoản cần `version` (khoá lạc quan); thiếu thì 400 và đoạn dọn `.catch(() => {})` âm thầm không chạy.
- Ô chọn vật tư chỉ hiện 8 kết quả đầu: dữ liệu thử còn sót làm kịch bản không thấy mặt hàng của lần chạy này → dùng tên đầy đủ có mã lần chạy.
- `innerText` trả chữ HOA của đầu bảng (CSS): so khớp không phân biệt hoa thường. `getByLabel` khớp chuỗi con (nhiều phần tử) — dùng `getByRole('table', {name})`. `getByText(...).first()` có thể trúng phần tử ẩn của bản in.
- Sau khi có 2 chi nhánh, tài khoản mới tạo phải gán chi nhánh (`userBranch`) nếu không đăng nhập bị 409.
- Shell nuốt `\` và `"`: vá tệp CRLF bằng `scripts/patch-file.mjs` với JSON viết bằng công cụ Write.
