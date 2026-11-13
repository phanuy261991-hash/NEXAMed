# HANDOFF — Đơn đặt hàng NCC (GĐ2) xong code, đang dở "Thêm nhanh mặt hàng" — 2026-11-13

> **CẬP NHẬT cuối ngày 13/11/2026: MỌI VIỆC DỞ TRONG FILE NÀY ĐÃ XONG** — "Thêm nhanh mặt hàng" làm xong (Chrome 25/25), cột "Diễn giải" sổ công nợ làm theo mockup, tài liệu đã sửa, full API 2357 + web 795 xanh, đã commit. Phần dưới giữ làm lịch sử (mục 6–7 vẫn dùng được: cách chạy kiểm Chrome, bẫy đã gặp).

## 1. Trạng thái một câu
**Đơn đặt hàng NCC (#298 giai đoạn 2) đã làm xong máy chủ + web, kiểm Chrome IP LAN 38/38, NHƯNG TOÀN BỘ CHƯA COMMIT** (working tree còn nguyên ~70 tệp sửa/mới trên `master` = `9ccc4a5`). Đang dở giữa chừng việc **"Thêm nhanh mặt hàng"** (chủ dự án đã chốt 4 câu, xem mục 4). Chủ dự án bảo DỪNG công việc để chuyển phiên.

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #298), `docs/DECISIONS.md` cuối file (#298 bổ sung 1) và file này.
2. **Kiểm máy dev**: API (cổng 3001) và `pnpm dev:lan` (cổng 5174) có thể VẪN ĐANG CHẠY từ phiên trước. Tắt nếu còn, rồi kiểm `apps/web/public/config.json` còn `apiBaseUrl: http://localhost:3001` (dev:lan tự khôi phục khi thoát; tệp sao lưu `config.json.lan-backup` không được còn lại).
3. Chạy `pnpm --filter @nexamed/shared build` (và `core` nếu đổi) trước khi chạy test API/web; `pnpm --filter @nexamed/api run db:generate` nếu Prisma báo thiếu client (tắt API trước, tránh EPERM).
4. Hoàn tất mục 3 (nối hộp thêm nhanh), chạy `pnpm typecheck`, `pnpm lint`, full API test MỘT lượt, kiểm Chrome, sửa tài liệu (mục 5), rồi HỎI chủ dự án có commit + push không.

## 3. QUY TẮC MỚI từ chủ dự án phiên này (rất quan trọng)
**TUYỆT ĐỐI không tự cắt/hoãn bất kỳ phần nào của mockup đã duyệt để kịp tiến độ.** Muốn bỏ hay hoãn phải HỎI bằng câu hỏi lựa chọn (AskUserQuestion) trước, không ghi thành "điểm khác mockup" rồi bỏ qua. Phiên này tôi đã cắt 3 chỗ của mockup Đơn đặt hàng và bị chủ dự án phản đối gay gắt; đã làm bù (mục 4.1). Trước khi báo xong một chức năng có mockup: rà TỪNG màn của mockup đối chiếu với bản đã làm.

## 4. Đã làm / đang dở

### 4.1 Đơn đặt hàng NCC (xong code + test, chưa commit)
- **DB**: migration `20261113090000_purchase_order` (đã áp lên DB dev; FORCE RLS trong migration): `purchase_order`, `purchase_order_line`, `stock_receipt.purchase_order_id`, `stock_receipt_line.purchase_order_line_id`, `stock_request_line.wait_purchase_order_id` + 3 cột "Yêu cầu rút"; enum `purchase_order_status`, `PrintDocumentType.PURCHASE_ORDER`.
- **Máy chủ** (`apps/api/src/modules/inventory/`): `purchase-order.{controller,service,repository}.ts`, `purchase-order-link.service.ts` (cầu nối với Phiếu nhập: kiểm khớp đơn, chặn nhận vượt, tính lại trạng thái đơn khi phiếu nhập Duyệt/Huỷ), `purchase-order-export.service.ts`; sửa `stock-receipt.{service,repository}.ts`, `stock-request.{service,repository,controller}.ts` ("Yêu cầu rút", liên kết dòng chờ với đơn, endpoint `GET /inventory/requests/restock`), 3 công tắc ở `clinic-settings.*` + port `getPurchaseOrderSettings`, quyền `purchase_order.*` (chỉ clinic_admin), mã `DDH`, mẫu in, nhãn audit, `tenant-fixture.ts` dọn bảng mới, `permission-matrix-enforcement-http.spec.ts` (route `purchase-order-settings`).
- **Dùng chung**: `packages/shared/src/purchase-order.ts`, `packages/core/src/inventory/purchase-order-state.ts` (+spec 13 ca), `purchase-order-errors.ts`.
- **Web** (`apps/web/src/features/inventory/`): `PurchaseOrder{List,Form,Detail}Page`, `PurchaseOrderPrintView`, `purchase-order.{api,queries}`, `purchase-order-meta`, `StockRequestRestockTab` (tab "Hàng cần bổ sung"), chỉnh `StockReceiptFormPage` (`?fromOrder=`, khoá theo đơn, cột "Còn thiếu theo đơn", "(đợt nhận N)"), `StockReceiptListPage` (cột/bộ lọc "Từ đơn"), `StockRequest{ListPage,DetailPage,ProcessPanel,Dialogs}`, `Sidebar`, `router`, `GeneralConfigPane` (3 công tắc), `supplier-debt/SupplierDetailPage` ("Nhập từ đơn … (đợt N)").
- **Làm bù mockup (sau khi bị phản ánh)**: tab "Hàng cần bổ sung" (màn 4), chip "Chờ chi nhánh chính duyệt" (màn 7), dải 5 ô + ô lọc "Trạng thái" (màn 7), cột "Nhận đợt này" (màn 9), cột "Còn thiếu theo đơn" + "(đợt nhận N)" (màn 9b), diễn giải đơn/đợt ở sổ công nợ (màn 12, làm dưới dạng dòng phụ dưới "Chứng từ", KHÔNG dựng cột "Diễn giải" riêng).
- **Dòng quy đổi "= N viên"**: `features/drug/{base-quantity.ts,.spec.ts,BaseQuantityHint.tsx}`, đã gắn ở form đơn, chi tiết đơn, Phiếu nhập kho (web test 4 ca).
- **Test**: `purchase-order-http.spec.ts` 19 ca (đột biến 2/2), `stock-request-http.spec.ts` +3 ca (restock), core +13, web +3 +4; Chrome `scripts/ui-audit/purchase-order-check.cjs` 38/38.
- **Lần full API gần nhất**: 2351 xanh (trước đợt làm bù); đợt làm bù + mã tự sinh CHƯA chạy lại full.

### 4.2 Thêm nhanh mặt hàng (DỞ) — chủ dự án đã CHỐT 4 câu theo khuyến nghị
Mockup: https://claude.ai/artifact/QbAVzmLxYuNkA2TE5rXAaU (tệp `scratchpad/them-nhanh-mat-hang.html`). **Chốt**: (1) cả Thuốc lẫn Vật tư; (2) phương án A — điền đủ mục bắt buộc ngay, KHÔNG làm màn 5 "Chờ bổ sung hồ sơ"; (3) dùng quyền thêm thuốc/vật tư hiện có (`drug.create`), không tạo quyền mới; (4) chỉ Đơn đặt hàng NCC + Phiếu nhập kho (kiểm kê/xuất kho để sau).
- **Đã làm**: mã mặt hàng tự sinh — `createDrugRequestSchema.code` thành tuỳ chọn, `DrugService.createInTx` gọi `BusinessCodeService.generate('DRUG')` (tiền tố `MH`), `DrugModule` import `ClinicModule`, thêm loại mã `DRUG` (spec đếm mã 33), test `drug-http.spec` +1 (helper có `omitCode`); đã tách `useCatalogCombobox` sang `features/reference-catalog/useCatalogCombobox.ts` (DrugCatalogPane import lại); đã viết `features/drug/QuickAddItemDialog.tsx` (hộp theo mockup màn 3 + 4).
- **CHƯA làm**: (a) typecheck/lint `QuickAddItemDialog.tsx` (mới viết, chưa kiểm); (b) nối vào ô tìm hàng của `PurchaseOrderFormPage` và `StockReceiptFormPage`: khi gõ không ra kết quả và có quyền `drug.create` hiện dòng "Thêm mặt hàng mới "…"" (mockup màn 2; Enter cũng mở), người không có quyền vẫn thấy "Không tìm thấy" kèm gợi ý nhờ quản lý thêm; lưu xong tự thêm dòng vào đơn/phiếu; (c) test web/Chrome cho luồng này; (d) cập nhật tài liệu (mục 5).

## 5. Tài liệu còn phải sửa/ghi
- `docs/DECISIONS.md` #298 bổ sung 1: **dòng "Điểm khác mockup" đang GHI SAI** (nói không có Diễn biến ở đơn — thực ra mockup màn 9 không vẽ Diễn biến nên đúng, nhưng 3 điểm khác đã được làm bù ở 4.1) → viết lại cho đúng sự thật; thêm "bổ sung 2": Thêm nhanh mặt hàng (4 câu đã chốt, mã tự sinh `MH`, quy đổi "= N viên"), tab Hàng cần bổ sung, chip, cột Nhận đợt này...
- `docs/CHANGELOG.md` (thêm mục 13/11 phần làm bù + thêm nhanh), `docs/CURRENT.md` (đã trỏ handoff này), `docs/TASK.md` (mục #298: tick phần đã làm, thêm việc dở), `docs/ERD.md`/`ERD-2.md` không đổi thêm (không migration mới sau v1.98).
- Môi trường khác cần: `pnpm install`, `db:deploy` (1 migration), `db:seed` (3 quyền `purchase_order.*`), khởi động lại API.

## 6. Cách chạy lại kiểm Chrome
1. `pnpm --filter @nexamed/api run db:seed`, bật API: `pnpm --filter @nexamed/api run dev` (cổng 3001), rồi `pnpm dev:lan` (in địa chỉ IP, ví dụ `http://192.168.1.114:5174`).
2. playwright-core 1.49.1 đã cài ở `scratchpad/pw/node_modules` (phiên trước); nếu mất: `npm i playwright-core@1.49.1` trong thư mục tạm.
3. `PLAYWRIGHT_CORE=<..>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<tạm> node scripts/ui-audit/purchase-order-check.cjs` (công ty thử `dev.admin / Dev@12345`; dữ liệu thử tiền tố KIEMDDH, không xoá được). Kịch bản chưa có phần "thêm nhanh" — cần thêm.
4. Tắt API + dev:lan khi xong; kiểm `config.json`.

## 7. Bẫy đã gặp phiên này
- Heredoc Bash có dấu nháy lẻ/backtick làm hỏng lệnh: ghi script vá bằng công cụ Write ra `.tmp-*.cjs` rồi `node` (đã dùng nhiều lần); regex trong `node -e` qua shell hay hỏng, dùng Edit/Write.
- `prisma format` căn lại nhiều dòng `schema.prisma` (diff phình ~150 dòng, vô hại).
- Spec cũ đếm số loại mã/mẫu in: thêm loại mới phải sửa `business-code-http.spec.ts` (đếm + danh sách) và `print-template-http.spec.ts` (đếm).
- Route tự-phục vụ không khai quyền phải thêm vào danh sách cho phép ở `permission-matrix-enforcement-http.spec.ts`.
- `PATCH /drugs/:id` bắt buộc `version`; `POST /drugs` không nhận `minStockAlert: null`.
- Playwright: `innerText` KHÔNG gồm giá trị ô `<input>` (nhãn Combobox không nằm trong text); tiêu đề cột in HOA bằng CSS; route chặn glob `?` khớp cả `/`.
- Mặt hàng có mức tối thiểu và tồn 0 ở MỌI kho nên tab "Hàng cần bổ sung" của kho nào cũng hiện nó (đúng thiết kế).
