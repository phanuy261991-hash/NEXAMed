# Handoff — Công nợ nhà cung cấp, Phần D "Luồng xử lý sai sót" — Frontend + Verify Playwright

**Ngày ghi**: 25/09/2026. **Trạng thái**: Backend (schema + service + controller + test HTTP) đã xong hoàn toàn, `apps/api` 1007/1007 test pass, `pnpm -w typecheck/lint/build` sạch toàn workspace. **CHƯA có bất kỳ dòng frontend nào cho Phần D.** Đọc kèm `docs/DECISIONS.md` #187 (tóm tắt đầy đủ quyết định + việc đã làm) và kế hoạch gốc `C:\Users\Administrator\.claude\plans\clever-dazzling-bentley.md` (đặc tả chi tiết mục 7 "Frontend").

## Đã có sẵn ở backend (không cần đọc lại code, chỉ cần biết đủ để gọi)

4 endpoint mới, tất cả dưới `/api/v1/supplier-debt/`:
- `POST /adjustments` (perm `supplier_debt.adjust`) — body theo `createSupplierDebtAdjustmentRequestSchema` (`packages/shared/src/supplier-debt.ts`): `supplierId`, `kind: 'INCREASE'|'DECREASE'|'VOID_REQUEST'`, `amount` (bắt buộc cho INCREASE/DECREASE, CẤM cho VOID_REQUEST), `targetReceiptId`/`targetIssueId` (đúng 1 cho VOID_REQUEST, tuỳ chọn tham khảo cho INCREASE/DECREASE), `targetVoucherId` (chỉ INCREASE/DECREASE), `reason` (bắt buộc), `evidenceRef` (tuỳ chọn). Trả về `supplierDebtAdjustmentSchema`.
- `GET /adjustments` (perm `supplier_debt.read`) — query `supplierId?`/`status?`/`targetReceiptId?`/`targetIssueId?`. Dùng CẢ cho tab "Nhật ký điều chỉnh" (lọc `supplierId`) LẪN badge "Có điều chỉnh" trên phiếu nhập/xuất (lọc `targetReceiptId`/`targetIssueId`).
- `POST /adjustments/:id/approve` (perm `supplier_debt.approve`, body `{version}`) — CHỈ cần quyền này, không cần quyền duyệt phiếu gốc (đã test kỹ). Với `VOID_REQUEST`, hệ thống TỰ huỷ phiếu nhập/xuất gốc trong lúc duyệt (không cần gọi endpoint void nào thêm).
- `POST /adjustments/:id/reject` (perm `supplier_debt.approve`, body `{version, rejectionReason}`).

`supplierDebtAdjustmentSchema` có sẵn field `selfApproved: boolean` (người duyệt = người đề nghị) để hiện nhãn "Tự duyệt", và `status: 'PENDING_APPROVAL'|'APPROVED'|'REJECTED'`.

`supplierDebtSummarySchema` (response `GET /supplier-debt/:supplierId/summary` VÀ `GET /supplier-debt/summaries`) đã thêm 2 field mới: `pendingAdjustmentCount: number` (số đề nghị/điều chỉnh đang chờ duyệt của NCC này) và `balanceIntegrityOk: boolean` (false = sổ lệch, cần banner đỏ chặn Thanh toán/Thu tiền hoàn lại).

Nút "Huỷ phiếu" hiện có trên `StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx` (gọi `POST /inventory/receipts/:id/void`/`POST /inventory/issues/:id/void`) **hành vi đã đổi lặng lẽ ở backend** — nếu phiếu có `supplierId` (PURCHASE/RETURN_TO_SUPPLIER), huỷ xong sẽ TỰ ĐỘNG đảo công nợ luôn (trước đây không). Không cần đổi gì ở nút này ngoài việc thêm 1 dòng cảnh báo phụ trong dialog xác nhận huỷ khi `supplierId` có giá trị (xem mục 3 dưới).

## Việc cần làm — theo đúng mục 7 kế hoạch gốc (`clever-dazzling-bentley.md`)

### 1. `apps/web/src/features/supplier-debt/`
- `supplier-debt.api.ts`/`supplier-debt.queries.ts` — thêm hàm/hook cho 4 endpoint trên (đúng khuôn các hàm hiện có — xem `recordSupplierDebtPayment`/`useRecordSupplierDebtPaymentMutation` làm mẫu). Mutation phải invalidate: `supplier-debt-summary`, `supplier-debt-summaries`, `supplier-debt-ledger`, và query mới `supplier-debt-adjustments`.
- `SupplierDetailPage.tsx` — thêm tab `'adjustments'` vào `TabId` union hiện có (`'receipts' | 'returns' | 'ledger' | 'payments'`) + `TabBar` (label "Nhật ký điều chỉnh", dùng `shared/ui/TabBar.tsx` đã trích xuất). Nội dung tab: bảng Mã phiếu | Loại | Số tiền | Người đề nghị | Người duyệt (+ nhãn "Tự duyệt" nếu `selfApproved`) | Trạng thái | nút `RowActionButton icon={Eye}` → dialog chi tiết. Dialog chi tiết (mới, hoặc mở rộng dialog có sẵn) chứa nút Duyệt/Từ chối khi `status==='PENDING_APPROVAL' && canApprove` — copy khuôn khối lý do từ chối inline trong `CashVoucherDetailDialog.tsx` (dòng ~251-295, đã khảo sát sẵn ở phiên trước).
- Nút "Lập phiếu điều chỉnh công nợ" cạnh 2 nút hành động có sẵn ("Thanh toán công nợ"/"Thu tiền NCC hoàn lại"), gate `useHasPermission('supplier_debt', 'adjust')`.
- `AdjustmentDialog.tsx` (mới) — form Tăng/Giảm: Loại (Tăng/Giảm), Số tiền (`MoneyInput`), Phiếu nhập/Phiếu xuất/Phiếu chi liên quan (tuỳ chọn, `Combobox`), Lý do (bắt buộc), Số biên bản (tuỳ chọn). Copy khuôn `PaymentDialog`/`RefundDialog` đã có trong `SupplierDetailPage.tsx` (`BoxedSection`, banner xanh preview). Nút "Lưu & chuyển duyệt" (mặc định) + "Lưu & Duyệt ngay" (chỉ hiện nếu actor CŨNG có `supplier_debt.approve` — gọi `create` rồi `approve` nối tiếp).
- Banner đỏ "Số dư công nợ không khớp sổ — liên hệ quản trị" khi `summary.balanceIntegrityOk===false` (đặt cạnh banner amber "chờ duyệt" có sẵn) — disable nút "Thanh toán công nợ"/"Thu tiền NCC hoàn lại" khi banner này hiện.

### 2. `Sidebar.tsx`
Mở rộng công thức `supplierDebtPendingCount` (dòng ~219, hiện tính `pendingApprovalAmount>0`) — cộng thêm NCC có `pendingAdjustmentCount>0` (đã có sẵn trong response `listSummaries()`, không cần query mới).

### 3. `apps/web/src/features/inventory/` — `StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx`
- Nút "Huỷ phiếu" hiện có (actor có `stock_receipt.approve`/`stock_issue.create`): giữ nguyên, chỉ thêm dòng cảnh báo phụ trong dialog xác nhận khi phiếu có `supplierId` — "Công nợ nhà cung cấp sẽ tự đảo lại tương ứng".
- **Nút MỚI "Đề nghị huỷ"**: hiện khi actor KHÔNG có quyền void hiện hữu NHƯNG có `supplier_debt.adjust`, VÀ phiếu gắn NCC (`receiptType==='PURCHASE' && supplierId` hoặc `issueType==='RETURN_TO_SUPPLIER'`), VÀ `status` đang duyệt được (chưa huỷ). Mở dialog lý do bắt buộc (copy khuôn `CancelEncounterDialog.tsx`) → gọi `createAdjustment({kind:'VOID_REQUEST', targetReceiptId hoặc targetIssueId, reason})`.
- **Badge "Có điều chỉnh"**: khi xem phiếu có `supplierId`, gọi `useSupplierDebtAdjustmentsQuery({targetReceiptId: id})` (hoặc `targetIssueId`) — nếu có dòng nào, hiện badge nhỏ cạnh trạng thái phiếu + danh sách rút gọn mở dialog chi tiết Y HỆT dialog dùng ở tab "Nhật ký điều chỉnh" (tái dùng component, không viết 2 lần).
- **"Sao chép thành phiếu mới"**: hiện khi `status` = đã huỷ (`voided===true`), điều hướng `navigate('/inventory/receipts/new', {state:{copyFromReceipt: receiptDetail}})` (hoặc `/inventory/issues/new`) — trang New đọc `location.state?.copyFromReceipt` để mồi `supplierId`/`warehouseId`/`receiptType`/từng dòng (drugId, unit, quantity, unitCost) NHƯNG để trống `batchNo` (bắt nhập lại lô mới, tránh trùng lô ảo). Chỉ mồi khi trang New đang rỗng (không ghi đè nếu người dùng đã gõ gì).

## Xác minh khi xong

- `pnpm --filter @nexamed/web run typecheck/build` sạch — kiểm chunk size (`index`/`vendor` đều nên dưới ngưỡng cảnh báo Vite, 2 dialog mới nên nằm gọn trong chunk lazy có sẵn của `SupplierDetailPage`/`StockReceiptFormPage`/`StockIssueFormPage`).
- Playwright qua Chrome thật trên **tenant test cố định** `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (đúng quy ước mới #186, KHÔNG đụng tenant chủ dự án):
  1. Phiếu điều chỉnh Tăng/Giảm — tạo, duyệt, "Tự duyệt" hiện đúng nhãn, balance đúng.
  2. Đề nghị huỷ — tài khoản không có quyền duyệt phiếu nhập tạo đề nghị → banner "chờ duyệt" + badge sidebar hiện đúng → tài khoản `clinic_admin` (hoặc vai trò chỉ có `supplier_debt.approve`) duyệt → phiếu gốc chuyển Đã huỷ + công nợ giảm đúng, không cần thao tác gì thêm.
  3. Huỷ trực tiếp bởi `clinic_admin` (có đủ quyền) → công nợ tự đảo ngay, không cần bước 2.
  4. Badge "Có điều chỉnh" hiện đúng trên `StockReceiptFormPage`/`StockIssueFormPage`.
  5. "Sao chép thành phiếu mới" mồi đúng dữ liệu (trừ batchNo để trống).
  6. Banner lệch số dư — có thể bỏ qua nếu khó dựng dữ liệu lệch qua UI thật (backend đã có test HTTP riêng cho phần này).
