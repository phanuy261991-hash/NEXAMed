# HANDOFF — #297 GĐ4 "Chi phí vật tư theo dịch vụ" + "Kho trừ" XONG và đã push — 2026-11-12

## 1. Trạng thái một câu
Mã GĐ4 + Kho trừ đã push lên `origin/master` (`e8d9be9`, 12/11/2026; 6 commit: `16c909c` GĐ3, `f580591` + `7943420` GĐ4, `b03e39a`, `3b1c823` Kho trừ, `e8d9be9`; sau đó thêm commit tài liệu bàn giao). Không còn tệp chưa commit. **CI GitHub của `e8d9be9` XANH (completed/success, kiểm 12/11/2026).** Dev server đã tắt, `apps/web/public/config.json` nguyên trạng, dữ liệu thử `KIEM297*` (vật tư, dịch vụ, bác sĩ, kho phụ) ở tenant thử đã ẩn/khoá.

## 2. Việc đầu tiên của phiên sau
1. CI của `e8d9be9` đã XANH. Chỉ cần kiểm CI của các commit tài liệu đẩy sau đó (không có `gh`; dùng REST API với thông tin Git đã lưu, không in token: script nhỏ gọi `GET /repos/phanuy261991-hash/NEXAMed/actions/runs?branch=master`); nếu đỏ thì sửa trước mọi việc khác.
2. Rồi theo thứ tự ở mục 3.

## 3. Việc kế tiếp (chưa làm)
1. **Chủ dự án yêu cầu 12/11/2026 — KHÔNG tự làm, cần mockup duyệt trước**: rà soát báo cáo lợi nhuận hiện có (lãi gộp thuốc/vật tư #287, Tổng quan chủ phòng khám, So sánh chi nhánh, Doanh thu) → rồi cột "Doanh thu dịch vụ" + "Lãi gộp dịch vụ" ở báo cáo Chi phí vật tư, tab "Theo vật tư", tab "Theo chi nhánh". Câu cần chốt: chi phí tiêu hao có vào lãi gộp không (hiện thiết kế #297 chốt KHÔNG), doanh thu theo "thực thu" hay "ghi nhận". Chi tiết cuối `docs/TASK.md`.
2. GĐ5 của #297: tài liệu hướng dẫn nhập liệu (Vật tư, định mức, ghi tiêu hao, Kho trừ).
3. Chủ dự án chưa xem 6 quyết định kỹ thuật GĐ4 (`docs/DECISIONS.md` #297 bổ sung 2) và câu cũ "Excel để trống Tính chất sử dụng có tự điền Dùng 1 lần không".
4. Dọn tài liệu theo ngưỡng cắt (CLAUDE.md): `DECISIONS.md` ~230 KB (ngưỡng 150 KB), `ERD.md` ~85 KB (ngưỡng 80 KB), `ERD-2.md` sắp tới ngưỡng — chưa cắt vì chưa được yêu cầu.

## 4. Đã chốt trong phiên (đừng bàn lại)
- **Giữ nguyên** quy tắc "việc đã làm chắc chắn phải trả tiền" (#280): hộp "Khách không làm dịch vụ" chỉ bỏ được dịch vụ còn `ORDERED`; khối vật tư ở hộp huỷ vì vậy hiếm xuất hiện — đúng ý chủ dự án.
- **Kho trừ** (#297 bổ sung 3, mockup https://claude.ai/artifact/Y9CKzPtb8eQ4exGDQm5mRy): người ghi chọn mỗi lần; mặc định LUÔN kho chính; chỉ kho đang hoạt động của chi nhánh đang làm việc, quyền Khoa/Phòng thì kho chính + kho Khoa mình; chi nhánh một kho thì ẩn ô; thiếu tồn → báo lỗi nêu tên kho, không lấy bù kho khác. Không migration (dùng `warehouse.is_default` = kho chính, các kho khác của chi nhánh = kho phụ).
- **KHÔNG tách quyền "Quản lý kho"** khỏi quyền danh mục thuốc: tạo kho = `drug.create`, mặc định chỉ `clinic_admin`; thủ kho muốn tạo kho thì được cấp `drug.create` qua vai trò tuỳ biến. Quản lý chỉ tạo kho cho chi nhánh được gán (ô "Chi nhánh" trong form khi công ty nhiều chi nhánh, mặc định chi nhánh đang chọn ở thanh trên).
- Chi phí vật tư KHÔNG vào lãi gộp (thiết kế đã chốt); số liệu chỉ gồm lượt đã ghi tiêu hao (ghi là tuỳ chọn).

## 5. Kiểm đã chạy (12/11/2026)
Full API 2298 xanh (1 lượt, trước phần Kho trừ) + 38 file liên quan 578 xanh sau Kho trừ; core 831, shared 127, web 766; typecheck + lint toàn cục sạch. Cô lập tenant/chi nhánh/Khoa-Phòng có test + đột biến (báo cáo 2/2, hộp huỷ 2/2, Kho trừ 3/3). Chrome IP LAN HTTP `scripts/ui-audit/service-consumption-check.cjs` 41/41; quét quyền 7 vai trò + vai trò tuỳ biến + route có tham số ĐẠT; trang báo cáo không tràn ở 6 cỡ màn hình. Môi trường khác sau khi lấy mã: `pnpm install`, `db:deploy` (migration `20261112090000_service_consumption`), `db:seed` (5 quyền `service_consumption.*`), khởi động lại API.

## 6. Cách chạy lại kiểm Chrome
1. `pnpm --filter @nexamed/api run db:seed`; bật API `pnpm --filter @nexamed/api run dev` (đổi `packages/core` thì phải khởi động lại API vì quyền đi kèm nạp từ `dist`).
2. `pnpm dev:lan` (in địa chỉ IP, **IP máy đổi giữa các phiên**); cài `playwright-core@1.49.1` ở thư mục tạm.
3. `PLAYWRIGHT_CORE=<..> UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<tạm> node scripts/ui-audit/service-consumption-check.cjs` → 41/41. Kịch bản tự tạo bác sĩ thử `kiem297.bs.*`, kho phụ thử, 2 lượt khám, thu tiền, gọi vào phòng, tạm tắt "ngày trước phải đóng ca" rồi trả lại, và ẩn dữ liệu thử khi xong.
4. Quét quyền: `provision-sweep-accounts.cjs` rồi `UI_AUDIT_ONLY=service-consumption UI_AUDIT_SECTIONS=default,custom node scripts/ui-audit/role-access-sweep.cjs`.
5. Tắt server xong thì `config.json` tự khôi phục (nếu còn `config.json.lan-backup` thì chạy lại `pnpm dev:lan` một lần để khôi phục).

## 7. Bẫy đã gặp
- PATCH thuốc/dịch vụ/tài khoản/kho cần `version` (khoá lạc quan); thiếu thì 400 và đoạn dọn `.catch(() => {})` âm thầm không chạy.
- Ô chọn vật tư chỉ hiện 8 kết quả đầu: dữ liệu thử còn sót làm kịch bản không thấy mặt hàng của lần chạy này → dùng tên đầy đủ có mã lần chạy.
- Ô chọn vật tư từng chọn nhầm khi gõ nhanh rồi Enter (kết quả trễ 300 ms) → nay chỉ chọn khi từ khoá đã ổn định.
- `innerText` trả chữ HOA của đầu bảng (CSS): so khớp không phân biệt hoa thường. `getByLabel` khớp chuỗi con (nhiều phần tử) — dùng `getByRole('table', {name})`. `getByText(...).first()` có thể trúng phần tử ẩn của bản in.
- Sau khi có 2 chi nhánh, tài khoản mới tạo phải gán chi nhánh (`userBranch`) nếu không đăng nhập bị 409.
- Shell nuốt `\` và `"`: vá tệp CRLF bằng `scripts/patch-file.mjs` với JSON viết bằng công cụ Write.
- Cổng `ServiceConsumptionDeclinePort` (core) + adapter `infrastructure/inventory` + `ServiceConsumptionDeclineModule` (`@Global()`): đảo phiếu cùng giao dịch với việc huỷ dịch vụ; port nhận `tx`, không tự mở giao dịch (#264).
