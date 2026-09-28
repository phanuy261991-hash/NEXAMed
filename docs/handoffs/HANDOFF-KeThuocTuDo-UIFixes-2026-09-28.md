# Handoff — "Kê thuốc tự do, không qua danh mục" ĐÃ HOÀN TẤT 100% + 3 lỗi giao diện "dính chữ" đã sửa

**Ngày ghi**: 28/09/2026. **Trạng thái**: cả 2 việc trong phiên này đều xong hoàn toàn — thiết kế (EnterPlanMode + AskUserQuestion) + backend + frontend + test + verify Playwright, tất cả trong cùng phiên. Xem `docs/DECISIONS.md` #192 (tính năng) và #193 (3 lỗi giao diện) để biết chi tiết đầy đủ. **Không còn việc nào treo từ phiên này.**

## Đã xong trong phiên này

### 1. "Kê thuốc tự do, không qua danh mục" (mở rộng ngoài kế hoạch của Kho Thuốc GĐ5, đảo ngược 1 điểm của #190)

Bác sĩ kê được thuốc hoàn toàn không có trong danh mục khi tenant bật công tắc riêng "Cho phép kê thuốc ngoài danh mục" (Cấu hình chung → pill "Kho Thuốc", mặc định **TẮT**). Dòng tự do: không tính tiền/hoá đơn, không có khái niệm tồn kho, không phát được qua "Phát thuốc" (hiện đọc-only kèm ghi chú "Ngoài danh mục — không xử lý ở đây"), in đơn y hệt các dòng khác.

- **Schema**: `prescription_item.drug_id` đổi nullable + cột mới `free_text_drug_name` — migration `20260928100000_prescription_item_free_text` (CHECK đúng-1-trong-2, cùng khuôn `invoice_line_source_exactly_one_check`) đã áp thật lên Postgres dev.
- **Backend**: công tắc `tenant_setting.allow_free_text_prescription_enabled` (đủ port/repository/service/controller, đúng khuôn `pharmacyStockTrackingEnabled`), gate server-side chặn bypass (`PrescriptionFreeTextDisabledError`, 422). PRE-03 (dị ứng) vẫn áp dụng cho dòng tự do; PRE-02/tồn kho tự động bỏ qua. `StockIssueService.getDispenseStatus()` tách dòng tự do vào `freeTextLines` riêng.
- **Frontend**: `DrugPicker.tsx` thêm "option ảo" cuối danh sách kết quả "+ Thêm '...' vào đơn (ngoài danh mục)" dùng chung cơ chế điều hướng bàn phím; `PrescriptionPanel.tsx` đổi khoá cục bộ từ `drugId` sang `key` riêng (nhiều dòng tự do đều `drugId=null`); badge "Ngoài danh mục" ở màn soạn/xem, **không đổi `PrescriptionPrintView.tsx`**; `DispensePrescriptionDialog.tsx` thêm khối đọc-only mới.
- **Đã xác minh thật**: `apps/api` 1021/1022 (+4 test mới, 1 flake tiền-nhiệm đã biết), `packages/core` 232/232, `packages/shared` 25/25, `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch toàn workspace. Playwright qua Chrome thật trên tenant test cố định: bật công tắc → gõ tên lạ → thêm vào đơn nháp (badge đúng) → lưu → ký (mã đơn thuốc thật sinh đúng, bảng đã ký hiện đủ 3 dòng kèm badge) → khôi phục công tắc về mặc định TẮT.

### 2. 3 lỗi giao diện "dính chữ" + đồng bộ nhãn "Vật tư y tế" (chủ dự án phát hiện qua ảnh chụp lúc dùng thử, không liên quan việc #1)

Cùng 1 lớp lỗi: ô trong bảng CSS Grid tự viết tay thiếu `min-w-0`/`truncate`, chữ dài tràn đè cột kế bên.

- **`CashVoucherListPage.tsx`** (Sổ quỹ & Thu chi → Phiếu thu/chi) — cột "Loại thu chi" dùng `inline-flex` sai cách khiến `truncate` vô tác dụng. Sửa `flex w-full min-w-0` + `title` hover, nới tỷ lệ cột.
- **`StockBalancePage.tsx`** (Quản lý kho → Tồn kho, cả 2 view) — cột "Mã"/"Số lô" thiếu hẳn `truncate`. Thêm `min-w-0 truncate` + `title` + `gap-x-3` giữa các cột + nới cột "Mã" `110px→130px`.
- **`StockLedgerReportPage.tsx`** (Báo cáo Nhập-Xuất-Tồn) — cùng lỗi cột "Mã", sửa giống trên.
- **Đồng bộ nhãn**: phát hiện `itemType` (Thuốc/Vật tư) hiển thị khác nhau giữa `DrugCatalogPane.tsx` ("Vật tư y tế") và `StockBalancePage.tsx` ("Vật tư") — trích xuất `apps/web/src/features/drug/drug-item-type.tsx` (mới): `ITEM_TYPE_LABEL` (nguồn duy nhất) + `DrugItemTypeBadge` (pill nền đặc, đúng khuôn `StatusBadge`/`ControlTypeBadge` — cột "Loại" ở `DrugCatalogPane.tsx` trước đó là chữ trần không nền, không đồng bộ với "Trạng thái"/"Quản lý lô" cùng bảng).
- **Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, Playwright qua Chrome thật xác nhận cả 3 màn hình hết dính chữ, nhãn đồng nhất, cột "Loại" có nền pill đúng.

## Tài liệu đã cập nhật

`docs/DECISIONS.md` (#192, #193), `docs/CHANGELOG.md` (2026-09-28 (3)), `docs/TASK.md` (Kho Thuốc GĐ5), `docs/CURRENT.md`. Kế hoạch kỹ thuật đầy đủ của việc #1 lưu tại `C:\Users\Administrator\.claude\plans\jiggly-hugging-wombat.md`.

## Việc kế tiếp

**Không có việc nào đang treo từ phiên này.** Theo `docs/CURRENT.md`, các mảng lớn khác còn treo trong dự án:

- **S6-02** (diễn tập phục hồi trên pilot thật) / **S6-04** (đo hiệu năng trên pilot thật) — cần máy chủ pilot thật, chưa làm được trên máy dev.
- **S2-04** (thẻ BHYT) — vẫn lùi lại theo quyết định cũ, không chặn gì.
- Kho Thuốc & Vật tư y tế, "Sổ quỹ & Thu chi", "Công nợ nhà cung cấp" đều đã hoàn tất 100% (không còn phần nào treo).

Chưa có việc cụ thể nào được chủ dự án giao tiếp theo — phiên sau nên hỏi chủ dự án muốn làm gì kế tiếp trước khi tự chọn hướng.

## Môi trường lúc kết thúc phiên

- API dev (`localhost:3001`) + Web dev (`localhost:5173`) đang chạy nền (có thể còn sống khi phiên mới bắt đầu — kiểm tra trước khi khởi động lại).
- `apps/web/public/config.json` vẫn trỏ đúng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (theo quy ước `feedback_fixed_test_tenant`, không đụng tenant chủ dự án).
- Công tắc `allowFreeTextPrescriptionEnabled` đã khôi phục về mặc định TẮT. Tài khoản bác sĩ test (`verify.gd5.doctor.*`) đã vô hiệu hoá lại. Dữ liệu nghiệp vụ test (bệnh nhân/lượt khám/thuốc test tạo trong lúc verify GĐ5 + phiên này) giữ nguyên trong DB tenant test, không đụng dữ liệu thật.
