# Handoff — Verify Điều chuyển kho + In phiếu + Thu gọn nhóm lô + Đổi cơ chế "Xem chi tiết" toàn app

**Ngày ghi**: 23/09/2026 (cuối phiên). **Trạng thái**: cả 4 việc trong phiên đã xong, verify Playwright qua Chrome thật, `pnpm -w typecheck/lint/build` sạch toàn workspace. **CHƯA COMMIT** — toàn bộ thay đổi còn ở working tree (xem mục "Trạng thái Git" bên dưới), chủ dự án chưa yêu cầu commit trong phiên này.

## Việc kế tiếp ưu tiên — theo đúng thứ tự

1. **Quyết định rồi commit** — tất cả thay đổi trong phiên (danh sách file ở dưới) đang ở working tree, chưa `git add`/`git commit`. Xem lại rồi commit khi sẵn sàng (gợi ý tách 2 commit theo 2 chủ đề: "Kho Thuốc GĐ4 Điều chuyển kho — verify + in phiếu + thu gọn nhóm lô" và "Đổi cơ chế Xem chi tiết toàn app", vì bản chất khác nhau — 1 cái tiếp nối GĐ4, 1 cái là quy ước UI toàn app).
2. **Câu hỏi còn treo (chưa hỏi chủ dự án)**: có retrofit phân quyền theo Khoa/Phòng cho `stock_receipt`/`stock_issue` hiện có ngay bây giờ hay để dành? Xem chi tiết ở `docs/handoffs/HANDOFF-KhoThuoc-GD4-DieuChuyenKho-2026-09-22.md` mục "Việc kế tiếp" #2 (nguyên văn câu hỏi + bối cảnh đầy đủ, phiên này chưa động vào).
3. **Chuyển sang phần 3/5 GĐ4 "Phiếu xuất kho mở rộng"** (Xuất dùng nội bộ/Xuất trả NCC/Xuất huỷ, Nháp→Duyệt) — **mockup CHƯA dựng, CHƯA duyệt**. Đọc mục 3 file kế hoạch `C:\Users\Administrator\.claude\plans\bright-bubbling-axolotl.md` trước, dựng mockup Artifact, chờ chủ dự án xác nhận rõ ràng ("duyệt"/"ok làm đi") trước khi code — đúng `feedback_explicit_mockup_approval` (bài học đã ghi trong bộ nhớ, KHÔNG suy diễn từ "tiếp tục công việc").
4. **2 phần còn lại của GĐ4 chưa bắt đầu**: Xuất-Nhập kho mở rộng (phần 3, đang xếp hàng ở trên), Báo cáo Nhập-Xuất-Tồn (phần 5).

## Tóm tắt việc đã làm trong phiên (đầy đủ ở `docs/DECISIONS.md` #173→#176)

1. **Verify Playwright "Điều chuyển kho" (#173, tiếp nối phiên 22/09)** — cả 3 màn hình (danh sách 4 trạng thái, tạo phiếu search-and-pick kể cả tự tách theo lô, Xác nhận nhận hàng tô màu/bắt buộc ghi chú khi thiếu/chặn nhận vượt) + phân quyền Khoa/Phòng qua UI thật (2 tài khoản tuỳ biến tạo riêng: `pw.khoachung`/`pw.khoanhi`). **Đúng thiết kế, không phát hiện bug sản phẩm.** Phát hiện + vá lại bug vận hành quen thuộc (#087/#089/#162/#166...): `stock_transfer.*` chưa có trong `role_permission` dev tenant do thiếu `pnpm db:seed` + restart API — đã seed + kích hoạt `syncRolePermissionsForAllTenants()`.
2. **"In phiếu" cho Điều chuyển kho (#174)** — `StockTransferPrintView.tsx` mới (file mới, chưa `git add`), dùng chung `.print-area` có sẵn. Nút "In phiếu" hiện khi `IN_TRANSIT` (kho nguồn in ngay sau Duyệt xuất) và `COMPLETED` (kho đích in sau khi Xác nhận nhận hàng) — không hiện `DRAFT`/`REJECTED`. Không đổi backend/schema.
3. **Thu gọn/xổ ra nhóm "1 tiêu đề sản phẩm + N dòng lô" (#175, chủ dự án yêu cầu kèm ảnh chụp màn hình Kiểm kê)** — `shared/hooks/useCollapsedGroups.ts` mới (file mới, chưa `git add`). Mặc định LUÔN xổ ra, bấm caret để thu gọn. Rà soát xác nhận kiểu hiển thị này CHỈ có ở đúng 2 nơi: `StockCountFormPage.tsx`, `StockReceiptFormPage.tsx` (Điều chuyển kho/Chi tiết thanh toán dùng bố cục khác — không đụng).
4. **Đổi cơ chế "Xem chi tiết" toàn app (#176, chủ dự án yêu cầu trực tiếp)** — thống nhất về 1 nút icon `Eye`/"Xem" (`RowActionButton`) luôn đứng đầu cột "Thao tác", bỏ hẳn bấm-mã/double-click-hàng/click-cả-hàng cũ. Khảo sát bằng Explore agent + xác nhận phạm vi qua `AskUserQuestion` trước khi sửa (bảng master-detail như `RoomPane`/`Icd10Pane`/`RolePermissionPane`... **giữ nguyên**, khác bản chất "chọn/lọc" so với "mở chi tiết"). **12 file đã sửa**: `StockTransferListPage.tsx`, `StockCountListPage.tsx`, `StockReceiptListPage.tsx`, `StockIssueListPage.tsx`, `InvoiceListPage.tsx`, `CashVoucherListPage.tsx`, `CashierShiftListPage.tsx`, `DispenseQueuePage.tsx`, `MyShiftVouchersDialog.tsx`, `AppointmentListView.tsx`, `WalletListPage.tsx`, `StockBalancePage.tsx`. Cập nhật `.claude/docs/ui-guidelines.md` mục 9 làm quy tắc chốt mới (đã sửa file, tính đúng 1 lần cho toàn app, không lặp lại quyết định này ở phiên sau).

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace (0 lỗi, chỉ còn 8 warning ESLint có sẵn từ trước, không liên quan). Playwright + Chrome thật (`playwright-core` + `executablePath` Chrome cài sẵn trên máy — không có Chromium bundled, môi trường này tải bị treo) trên hầu hết trang đã sửa: Điều chuyển kho, Kiểm kê, Phiếu nhập kho, Phiếu xuất kho, Tồn kho, Thu ngân, Phiếu chốt ca, Ví tạm ứng, Lịch hẹn (tạo riêng 1 lịch hẹn test vì tenant dev không có dữ liệu hôm nay). Không phát hiện bug nào ở cả 4 việc.

## Trạng thái Git — CHƯA COMMIT

```
 M .claude/docs/ui-guidelines.md
 M apps/web/src/features/appointment/AppointmentListView.tsx
 M apps/web/src/features/billing/InvoiceListPage.tsx
 M apps/web/src/features/cash-book/CashVoucherListPage.tsx
 M apps/web/src/features/cash-book/MyShiftVouchersDialog.tsx
 M apps/web/src/features/cashier-shift/CashierShiftListPage.tsx
 M apps/web/src/features/inventory/DispenseQueuePage.tsx
 M apps/web/src/features/inventory/StockBalancePage.tsx
 M apps/web/src/features/inventory/StockCountFormPage.tsx
 M apps/web/src/features/inventory/StockCountListPage.tsx
 M apps/web/src/features/inventory/StockIssueListPage.tsx
 M apps/web/src/features/inventory/StockReceiptFormPage.tsx
 M apps/web/src/features/inventory/StockReceiptListPage.tsx
 M apps/web/src/features/inventory/StockTransferFormPage.tsx
 M apps/web/src/features/inventory/StockTransferListPage.tsx
 M apps/web/src/features/patient-wallet/WalletListPage.tsx
 M docs/CHANGELOG.md
 M docs/CURRENT.md
 M docs/DECISIONS.md
 M docs/TASK.md
?? apps/web/src/features/inventory/StockTransferPrintView.tsx
?? apps/web/src/shared/hooks/useCollapsedGroups.ts
```
(File handoff này ghi ngay sau — cũng chưa `git add`.)

## Lưu ý môi trường

- **`pnpm dev` đang chạy** ở cuối phiên (API cổng **3001**, Web cổng **5173**, health check `{"status":"ok","db":"ok"}` xác nhận lúc ghi file này) — phiên sau kiểm tra còn sống không trước khi tự khởi động lại; nếu tắt, nhớ chạy lại `pnpm dev` từ gốc repo trước khi test tay/Playwright.
- **Dữ liệu test để lại trong DB dev** (không dọn, theo đúng tiền lệ dữ liệu test tích luỹ như `PW-TEST-001`): Khoa "Khoa Nhi (test PW)", Kho "Kho Nhi (test PW)", 2 vai trò tuỳ biến "PW Kho - Khoa Chung"/"PW Kho - Khoa Nhi" (scope `department` cho `stock_transfer.*` + `drug.read=global`), 2 tài khoản `pw.khoachung`/`pw.khoanhi` (mật khẩu `Pw@Test1234`), ~15 phiếu điều chuyển kho test (PDC2609000001-016), 1 lịch hẹn test "Test PW Appointment" (mã `LH2609000003`, hôm nay 23/09/2026 16:00-16:15).
- Migration/schema: **không đổi gì** trong phiên này — thuần frontend + tài liệu.
- OpenAPI/codegen: **không cần chạy lại** — không đổi contract API nào.

## Việc KHÔNG làm (đã chốt hoặc cố ý hoãn, đừng tự mở rộng)

- Chưa retrofit phân quyền Khoa/Phòng cho `stock_receipt`/`stock_issue` — cần HỎI chủ dự án trước (xem mục "Việc kế tiếp" #2).
- Chưa dựng mockup "Phiếu xuất kho mở rộng" (phần 3/5 GĐ4) — việc kế tiếp sau khi xử lý xong 2 mục trên.
- Chưa mở khoá lưu `barcode` cho Vật tư y tế — vẫn treo từ phiên 22/09, chưa ai động vào.
- Không tự ý commit thay đổi trong phiên này — chủ dự án chưa yêu cầu, để nguyên ở working tree chờ xác nhận.
