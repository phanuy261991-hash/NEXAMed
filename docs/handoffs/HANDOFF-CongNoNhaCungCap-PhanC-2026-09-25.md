**ĐÃ HOÀN TẤT (25/09/2026, cùng ngày, phiên tiếp theo) — xem `docs/DECISIONS.md` #186.** Toàn bộ "Việc kế tiếp" mục dưới đây (verify Playwright) đã làm xong, 13/13 assertion pass qua Chrome thật, 0 lỗi console. Giữ nguyên nội dung gốc bên dưới làm hồ sơ lịch sử.

# Handoff — Công nợ nhà cung cấp, Phần C "Trả hàng NCC" (CODE + TEST HTTP XONG — CHƯA verify Playwright) — chuyển phiên

**Ngày ghi**: 25/09/2026, dừng theo lựa chọn của chủ dự án (hỏi qua `AskUserQuestion` — không phải vì hết việc/bị chặn). Tiếp nối trực tiếp `docs/handoffs/HANDOFF-CongNoNhaCungCap-PhanB-2026-09-24.md` (Phần B, đã hoàn tất kể cả verify Playwright). Phiên này làm Phần C theo đúng mục "Việc kế tiếp" của handoff đó (mục 8 kế hoạch kỹ thuật `C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md`). **CHƯA COMMIT khi viết xong file này** — sẽ hỏi chủ dự án trước khi commit (xem cuối file).

## Việc đã xong trong phiên này (Phần C)

1. **Migration `20260924110000_supplier_debt_phase_c`** (đã áp thật lên Postgres dev qua `pnpm db:deploy`):
   - `stock_issue` thêm `supplier_id`/`source_receipt_id` (nullable, CHECK lỏng "chỉ ý nghĩa với `RETURN_TO_SUPPLIER`", cùng khuôn `department_id`/`INTERNAL_ALLOCATION`).
   - `stock_issue_line` thêm `return_unit_price` (nullable `bigint`, CHECK ≥0) — cột RIÊNG, không tái dùng `sell_price`.
   - `supplier_debt_entry` thêm `stock_issue_id` + siết lại CHECK nguồn (mở khoá `RETURN` bắt buộc `stock_issue_id`).
   - Vá `tenant-fixture.ts`: di chuyển khối cleanup `supplierDebtEntry`/`supplierDebtAccount` lên TRƯỚC `stockIssueLine`/`stockIssue` (FK mới `stock_issue_id` làm vỡ thứ tự cũ — lỗi thật phát hiện lúc chạy test, đã sửa).
2. **Backend** (`apps/api/src/modules/inventory/stock-issue.service.ts`):
   - `validateReturnSupplierRefs()` (mới) — NCC tồn tại; "Phiếu nhập gốc" (nếu chọn) phải là `PURCHASE` **ĐÃ DUYỆT** của đúng NCC.
   - `buildManualLineData()` mở rộng + `resolveReturnUnitPrice()` (mới) — ưu tiên giá client gửi → giá theo "Phiếu nhập gốc" (sau chiết khấu dòng, quy đổi đơn vị) → fallback giá vốn lô/bình quân gia quyền.
   - `approveManual()` thêm hook `SupplierDebtService.recordReturnApproval()` trong CÙNG transaction cho `RETURN_TO_SUPPLIER`.
   - Constructor thêm `SupplierRepository`/`SupplierDebtService`/`StockReceiptRepository` — KHÔNG cần sửa `inventory.module.ts` (đã có `forwardRef(SupplierDebtModule)` từ Phần A).
3. **`SupplierDebtService`**: `applyEntry()` thêm tham số `stockIssueId` (sửa 4 call site cũ truyền `null`). Thêm `recordReturnApproval()` (ghi `RETURN`, không sinh `cash_voucher`) và `recordRefund()` ("Thu tiền NCC hoàn lại", Q8 — chỉ khi `balance<0`, gọi thẳng `applyVoucherEntry()` đã tổng quát hoá sẵn từ Phần A vì voucher INCOME luôn `POSTED` ngay, không qua duyệt).
4. **Endpoint mới**: `POST /supplier-debt/:supplierId/refund` (permission `supplier_debt.pay`, tái dùng). Đăng ký trong `apps/api/scripts/generate-openapi.ts`, đã chạy lại `openapi:generate` + `api:codegen`.
5. **Web**:
   - `StockIssueFormPage.tsx` — field "Nhà cung cấp"/"Phiếu nhập gốc" (chỉ hiện `RETURN_TO_SUPPLIER`; đổi NCC bỏ chọn Phiếu nhập gốc; đổi Phiếu nhập gốc xoá giá mọi dòng về rỗng để backend tính lại); cột "Đơn giá trả" (để trống = tự động)/"Thành tiền" + tổng "Giá trị trừ công nợ". Mồi sẵn `returnUnitPrice` = giá vốn lô cho hàng theo lô (đã có sẵn từ `getDrugBatchBalances()`, không round-trip) — **đơn giản hoá có chủ đích**: qua UI nhánh "tính theo phiếu gốc" ở backend hiếm khi tự kích hoạt vì giá đã có sẵn; hàng không theo lô luôn để trống (web không biết `averageUnitCost`).
   - `useStockReceiptsQuery()` thêm tham số `enabled` (optional, mặc định `true`, tương thích ngược) để chỉ tải "Phiếu nhập gốc" khi đã chọn NCC.
   - `StockIssuePrintView.tsx`/`StockIssueDetailDialog.tsx` — hiển thị `returnUnitPrice` thay `sellPrice` (luôn 0) cho `RETURN_TO_SUPPLIER`, đổi nhãn "Tổng cộng"→"Giá trị trừ công nợ".
   - `SupplierDetailPage.tsx` — thêm tab "Phiếu trả hàng" (`useStockIssuesQuery({supplierId, issueType:'RETURN_TO_SUPPLIER'})`) + nút/dialog "Thu tiền NCC hoàn lại" (hiện khi `supplier_debt.pay` VÀ `balance<0`, cùng khuôn `PaymentDialog`).
6. **Quyết định có chủ đích**: Huỷ phiếu xuất trả ĐÃ DUYỆT (`POST /inventory/issues/:id/void`, endpoint chung có từ GĐ3) đảo tồn kho đúng (generic, dựa `stock_ledger`) nhưng **KHÔNG đảo bút toán công nợ** — cùng lỗ hổng có chủ đích với "Huỷ phiếu nhập" (`StockReceiptService.voidReceipt()`, Phần A). Lý do: cơ chế "Huỷ chứng từ" đầy đủ (đảo bút toán + "Sao chép thành phiếu mới" + phân vai duyệt/đề nghị huỷ) là khối việc RIÊNG của Phần D — làm nửa vời ở Phần C sẽ lệch thiết kế. Đã khoá hành vi này bằng characterization test ở CẢ 2 module (`stock-issue-http.spec.ts` mới, `supplier-debt-http.spec.ts` đã có từ Phần A).
7. **Test HTTP**: `stock-issue-http.spec.ts` +7 test Phần C (40/40 file, gồm 1 test cũ sửa lại vì `supplierId` nay bắt buộc cho `RETURN_TO_SUPPLIER`); `supplier-debt-http.spec.ts` +8 test refund (37/37 file). **Toàn bộ suite `apps/api` 991/991 pass** (1 flake `appointment-work-shift-http.spec.ts` không liên quan, race `rolePermission` unique khi chạy song song nhiều spec — pass riêng 5/5).
8. **Toàn workspace**: `pnpm -w typecheck/lint/build` sạch — build web không cảnh báo chunk size (`index` 197.41 kB + `vendor` 339.37 kB, `SupplierDetailPage`/`StockIssueFormPage` đều lazy chunk riêng).
9. **Đã cập nhật tài liệu**: `CLAUDE.md` (dòng Phần C), `docs/ERD.md` (v1.57, mục 3.10 mở rộng + C35/C36), `docs/CURRENT.md` (đoạn Phần C mới), `docs/CHANGELOG.md` (mục 2026-09-25 mới), `docs/TASK.md` (Phần C đánh dấu `[x]`), `docs/DECISIONS.md` (mục #185 mới, chi tiết đầy đủ), tiêu đề `C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md`.

## Việc CHƯA làm — Playwright

Không cài `playwright-core` trong phiên này (môi trường mới, chưa có sẵn). Chủ dự án chọn dừng ở bước code+test qua `AskUserQuestion` thay vì cài lại ngay.

## Việc kế tiếp — theo đúng thứ tự

1. **Verify Playwright cho Phần C** (bắt buộc trước khi coi Phần C hoàn tất, đúng nhịp độ dự án):
   - Cài `playwright-core` trỏ Chrome hệ thống (đúng khuôn mọi lần trước — `executablePath` trỏ Chrome cài sẵn trên máy, KHÔNG tự tải Chromium bundled).
   - Khởi động `pnpm dev` (web 5173 + api 3000).
   - Dùng **tenant test riêng** `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (đã dùng ở #177/#183/#184, đúng bài học #166 — KHÔNG đụng tenant chủ dự án `01a070f4-...`). Nhớ trả `config.json` (không track git) về tenant thật sau khi xong.
   - Luồng cần kiểm:
     a. Tạo phiếu "Xuất trả nhà cung cấp" KHÔNG chọn "Phiếu nhập gốc" → giá tự mồi theo giá vốn lô, sửa tay được → Duyệt → công nợ NCC giảm đúng (trang chi tiết NCC: `StatCardRow`/tab "Phiếu trả hàng"/"Sổ công nợ").
     b. Tạo phiếu CÓ chọn "Phiếu nhập gốc" (có chiết khấu dòng ở phiếu gốc đó) → đổi Phiếu nhập gốc thì giá các dòng tự xoá về rỗng → để trống bấm Lưu → xem lại phiếu đã Duyệt, giá hiện đúng SAU chiết khấu (không phải giá gốc).
     c. "Thu tiền NCC hoàn lại" — cần NCC có `balance<0` trước (Trả hàng vượt số nợ, hoặc Khai nợ đầu kỳ số âm) → nút chỉ hiện khi âm → lập phiếu → "Còn nợ lại" giảm đúng, xuất hiện ở tab "Thanh toán" lẫn `/suppliers/payments`.
     d. Huỷ phiếu xuất trả đã Duyệt → xác nhận tồn kho đảo lại đúng NHƯNG công nợ giữ nguyên (đúng thiết kế đã chốt ở mục 6 trên — không phải bug).
   - Nếu phát hiện bug thật, sửa NGAY trong phiên đó rồi verify lại — đúng nhịp độ mọi phần trước.
2. Sau khi Phần C verify Playwright xong → **Phần D — Luồng xử lý sai sót** (mục 8 kế hoạch: Phiếu điều chỉnh, Đề nghị huỷ, hàng chờ duyệt + badge, Nhật ký điều chỉnh, kiểm tra toàn vẹn số dư, "Sao chép thành phiếu mới") — **đây cũng là nơi xử lý ĐỒNG BỘ 2 lỗ hổng "Huỷ không đảo công nợ"** (phiếu nhập từ Phần A + phiếu xuất trả từ Phần C) qua cơ chế "Huỷ chứng từ" đầy đủ.
3. Sau Phần D → Phần E (Đối chiếu & chốt công nợ theo kỳ) — CHƯA có mockup, dựng Artifact riêng trước khi code.

## Việc KHÔNG làm (đừng tự mở rộng)

- KHÔNG bắt đầu Phần D trước khi Phần C verify Playwright xong.
- KHÔNG tự thêm cơ chế đảo công nợ khi Huỷ phiếu xuất trả/phiếu nhập — đây là việc CÓ CHỦ ĐÍCH để dành Phần D làm đồng bộ cho MỌI loại chứng từ, không vá riêng lẻ từng chỗ.
- KHÔNG quên đăng ký route mới vào `apps/api/scripts/generate-openapi.ts` khi thêm endpoint Phần D — OpenAPI ở dự án này không tự sinh.
- KHÔNG dùng tenant chủ dự án để test Playwright — luôn tenant test riêng, đúng bài học #166.

## Phát hiện phụ chưa xử lý (từ handoff Phần A/B, vẫn còn treo, không liên quan trực tiếp)

- `CashVoucherService.voidVoucher()` có thể không đảo số dư "Ví tạm ứng" khi huỷ phiếu nạp/tất toán (`PATIENT_ADVANCE`) — chưa kiểm chứng bằng test, chưa sửa, ngoài phạm vi Công nợ NCC.
- Q10 (#180): chưa có cơ chế badge "chờ duyệt" hiển thị được ở MỌI trang trong app — để dành bàn riêng.

## Trạng thái Git lúc ghi file này

Nhánh `master`, đồng bộ `origin/master` trước phiên. Toàn bộ thay đổi Phần C (schema/backend/frontend/test/docs) đang ở working tree, **CHƯA add/commit**. File handoff này cũng chưa commit. Sẽ hỏi chủ dự án xác nhận nội dung commit trước khi tạo commit + push (đúng quy tắc — chỉ commit khi được yêu cầu).
