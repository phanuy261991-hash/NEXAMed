# Handoff — Redesign "Phiếu nhập kho"/"Phiếu xuất kho" (popup header + bố cục 2 cột) ĐÃ XONG 100%

**Ngày ghi**: 28/09/2026. **Trạng thái**: xong hoàn toàn trong phiên này — thuần `apps/web`, không đụng migration/API/DB. Xem `docs/DECISIONS.md` #194 để biết chi tiết đầy đủ. **Không còn việc nào treo từ phiên này.**

## Bối cảnh phiên này

Chủ dự án dùng thử `StockReceiptFormPage.tsx` (Phiếu nhập kho) thật và phản hồi liên tục qua nhiều vòng ảnh chụp màn hình — KHÔNG qua mockup/EnterPlanMode trước như quy trình thường lệ, vì mọi thay đổi được duyệt/chỉnh ngay trên bản chạy thật theo thời gian thực. Chuỗi phản hồi (tóm tắt theo thứ tự xảy ra):

1. Dropdown "Loại phiếu"/"Nhà cung cấp" dính nhau khó đọc, NCC tên dài bị chật
2. Khối "Chiết khấu"+"Thanh toán" chiếm hết chiều cao, đẩy hẹp khu vực thao tác chính
3. Hỏi có nên tách chiết khấu/thanh toán ra khỏi luồng chính không → `AskUserQuestion` chốt "accordion thu gọn"
4. Ngay sau đó đổi ý, đề nghị hẳn "2 cột cố định, luôn hiện cả hai" thay vì accordion → `AskUserQuestion` lần 2, đảo ngược quyết định #3
5. Ô tìm sản phẩm không nổi bật, vị trí sai (đặt cuối)
6. Đề nghị chuyển hẳn header sang popup, trang chính chỉ hiển thị tóm tắt
7. "Áp dụng tương tự cho Phiếu xuất kho" → rồi "áp dụng luôn kiểu hiển thị ô tìm kiếm cho các giao diện đang dùng" (Kiểm kê, Điều chuyển kho)

Xen giữa chuỗi trên là 3 vòng bug thật phát hiện qua ảnh chụp (xem mục dưới) — phải dừng redesign để sửa ngay vì chặn cả layout.

## Đã xong trong phiên này

### 1. Popup "Thông tin phiếu" thay khối ô nhập cố định

- **File mới**: `apps/web/src/features/inventory/StockReceiptHeaderDialog.tsx`, `StockIssueHeaderDialog.tsx`, `apps/web/src/shared/ui/SummaryField.tsx` (trích xuất dùng chung, lần lặp thứ 2 theo CLAUDE.md).
- Modal tự quản lý state cục bộ + validate riêng, chỉ commit vào state trang cha khi bấm "Lưu". Mở tự động khi tạo phiếu mới; sửa/xem phiếu đã có thì đóng mặc định, mở lại qua nút "Sửa" (ẩn khi `readOnly`).
- "Huỷ": lần mở đầu tiên lúc tạo mới (chưa chọn Kho) → điều hướng thẳng về danh sách; các lần sau chỉ đóng popup.
- Đổi "Loại phiếu" dù đã có dòng hàng KHÔNG chặn (dữ liệu an toàn, `buildPayload()` tự lọc field không áp dụng) — chỉ cảnh báo mềm inline, không dựng thêm confirm dialog lồng nhau.

### 2. Bố cục 2 cột cho `StockReceiptFormPage.tsx` (CHỈ khi `receiptType='PURCHASE'`)

Trái co giãn = ô tìm (nổi bật) + bảng dòng hàng; phải 380px cố định = Chiết khấu + Thanh toán xếp dọc, luôn hiện. `StockIssueFormPage.tsx` không có cột phải tương ứng.

### 3. Ba bug thật phát hiện + sửa ngay (đều chỉ lộ qua trình duyệt thật)

1. **Tên sản phẩm bị cắt** — cột `1.8fr` thuần không có sàn tối thiểu, bị bóp khi khung trái hẹp lại. Sửa: `minmax(180px, 1.8fr)` ở `lineGridCols`/`rowGridColumns`, áp cho **cả 4 trang** Kho Thuốc.
2. **Cả trang bị lệch/cuộn sai cấp** ("bị lệch phải cuộn") — CSS Grid mặc định không cho track `1fr` co dưới nội dung tối thiểu (`min-width:auto` ngầm định). Sửa: `minmax(0,1fr)` cho cột trái ở `lg:grid-cols-[...]`. Đã đo thật bằng `document.documentElement.scrollWidth` ở 1600px/1920px xác nhận hết overflow.
3. **Ô "Giá trị" chiết khấu (Số tiền) thiếu viền/padding** — bug CŨ có sẵn từ trước (không phải do redesign), `MoneyInput` thiếu hẳn `className` (mọi nơi khác trong app đều truyền). Đã bổ sung.

### 4. Đồng bộ ô tìm thuốc "nổi bật" — 4 trang Kho Thuốc

`StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx`/`StockCountFormPage.tsx`/`StockTransferFormPage.tsx`: khung `border-2 border-blue-200 bg-blue-50`, nhãn đậm "Thêm thuốc / vật tư vào phiếu", icon/viền `blue-500`/`blue-300`. Bỏ dòng chú thích phụ thừa ở Issue/Transfer.

### 5. Bug thật ở component dùng chung `shared/ui/Combobox.tsx`

Option khai cứng `h-9` (36px) — nhãn dài (tên NCC, "Nhập hoàn trả từ bệnh nhân/khoa phòng"...) tự xuống dòng nhưng tràn đè option kế bên. Sửa `h-9`→`min-h-9` + `py-1.5`/`leading-snug` cho cả option thường và dòng "+ Thêm mới" — **tự áp dụng cho MỌI Combobox toàn app**, không riêng 2 trang đang sửa.

### 6. Nhân tiện đầu phiên (không liên quan việc chính)

Pill "Loại thu chi" ở `CatalogAdminPage.tsx` khai trong mảng `PILLS` nhưng thiếu nhánh JSX render — bấm vào không hiện gì. Thêm đúng 1 dòng còn thiếu.

## Tài liệu đã cập nhật

`docs/DECISIONS.md` (#194), `docs/CHANGELOG.md` (2026-09-28 (4)), `docs/CURRENT.md`. Không cập nhật `docs/TASK.md` — việc này không map vào task S-nào cụ thể, thuần polish UI của tính năng đã hoàn tất từ trước (Kho Thuốc GĐ2/GĐ3).

## Current state

- **Branch**: `master`. Chưa commit — phiên này sẽ commit + push ngay sau khi ghi xong handoff.
- **File thay đổi**: xem `git status`/`git diff --stat` — 6 file sửa (`CatalogAdminPage.tsx`, `StockCountFormPage.tsx`, `StockIssueFormPage.tsx`, `StockReceiptFormPage.tsx`, `StockTransferFormPage.tsx`, `shared/ui/Combobox.tsx`) + 3 file mới (`StockIssueHeaderDialog.tsx`, `StockReceiptHeaderDialog.tsx`, `shared/ui/SummaryField.tsx`).
- **Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace (build web không cảnh báo chunk size). Không có test tự động mới — phiên này thuần frontend, không đụng API/DB, nên xác minh hoàn toàn qua Playwright/Chrome thật (nhiều vòng, tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`): popup mở đúng lúc/dải tóm tắt đúng dữ liệu/bố cục 2 cột đúng ở 1600px+1920px/tên sản phẩm không cắt/dropdown hết đè chữ/ô tìm 4 trang đồng bộ, 0 lỗi console.

## Việc kế tiếp

**Không có việc nào đang treo từ phiên này.** Theo `docs/CURRENT.md`, các mảng lớn khác còn treo trong dự án:

- **S6-02**/**S6-04** — cần máy chủ pilot thật, chưa làm được trên máy dev.
- **S2-04** (thẻ BHYT) — vẫn lùi lại theo quyết định cũ.
- Kho Thuốc GĐ1-5, "Sổ quỹ & Thu chi", "Công nợ nhà cung cấp" đều đã hoàn tất 100%.

Chưa có việc cụ thể nào được chủ dự án giao tiếp theo — phiên sau nên hỏi chủ dự án muốn làm gì kế tiếp trước khi tự chọn hướng. Nếu chủ dự án tiếp tục dùng thử các trang Kho Thuốc khác (Kiểm kê/Điều chuyển kho) và phát hiện thêm lỗi tương tự (dính chữ/lệch layout), áp dụng đúng 2 fix CSS Grid đã ghi ở mục 3.1/3.2 trên — đây là lớp lỗi có khả năng lặp lại ở bất kỳ layout Grid nào có cột co giãn cạnh tranh không gian với cột cố định.

## Môi trường lúc kết thúc phiên

- API dev (`localhost:3001`) + Web dev (`localhost:5173`) đang chạy nền (có thể còn sống khi phiên mới bắt đầu — kiểm tra trước khi khởi động lại).
- `apps/web/public/config.json` vẫn trỏ đúng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (theo quy ước `feedback_fixed_test_tenant`, không đụng tenant chủ dự án).
- Không có dữ liệu test tạm nào cần dọn (phiên này chỉ đọc/xem dữ liệu có sẵn trên tenant test để verify UI, không tạo tài khoản/dữ liệu nghiệp vụ mới).
