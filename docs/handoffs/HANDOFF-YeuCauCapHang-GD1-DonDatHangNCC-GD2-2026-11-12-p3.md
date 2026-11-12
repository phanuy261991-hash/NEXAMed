# HANDOFF — Yêu cầu cấp hàng GĐ1 XONG và đã push; kế tiếp GĐ2 Đơn đặt hàng NCC — 2026-11-12 (phần 3)

## 1. Trạng thái một câu
**Yêu cầu cấp hàng (GĐ1, `docs/DECISIONS.md` #298)** đã làm xong, kiểm đủ (API 2332 xanh, core 869, web 778, Chrome LAN 26/26) và đã push `master` = `3a9acab`, CI GitHub xanh (build + pool-stress). Working tree sạch. **GĐ2 (Đơn đặt hàng NCC) CHƯA làm.**

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/product/stock-request-plan.md` (mục 3 điểm 8, 15; mục 4; mục 6) và mockup https://claude.ai/artifact/Ut7h7axLUPynLqwvPbaPBi (màn 7, 8, 9, 9b, 10, 11, 12, 13) — mockup đã duyệt cho CẢ hai giai đoạn.
2. Hỏi chủ dự án có làm GĐ2 ngay không. Nếu có: làm theo thứ tự ở mục 5. Mockup đã duyệt nên KHÔNG cần duyệt lại, nhưng mọi chỗ lệch mockup phải báo (quy tắc bám mockup ~95%).
3. Máy dev của phiên này: đã tắt API/Vite/dev:lan và khôi phục `apps/web/public/config.json` (còn `apiBaseUrl: http://localhost:3001`, tenant test cố định `01a0cc3c-…`). API gốc cổng 3001 của chủ dự án bị tắt trong phiên (không phải bản có code mới) — chạy lại `pnpm dev` và `pnpm db:seed` (quyền mới) khi cần.

## 3. Đã chốt (đừng bàn lại) — `docs/DECISIONS.md` #298 + `docs/product/stock-request-plan.md`
- Tên chức năng **"Yêu cầu cấp hàng"**, mã phiếu **YCCH**, KHÔNG còn dùng "Đề xuất hàng/PDX".
- Kho cấp suy ra theo cấp: kho phụ → kho chính cùng chi nhánh; kho chính chi nhánh phụ → kho chính chi nhánh chính (`branch.is_default`); kho chính chi nhánh chính không có cấp trên (lỗi 422 `STOCK_REQUEST_NO_SUPPLIER`).
- Số đã cấp/đã nhận của dòng SUY RA từ `stock_transfer_line.request_line_id`; dòng chỉ lưu quyết định (`PENDING/WAITING_STOCK/ALLOCATED/REJECTED/WITHDRAWN`). Chi nhánh kế thừa qua kho, không cột `branch_id`.
- Nhận thiếu: phiếu giữ "Đang xử lý" tới khi kho cấp xử lý chênh lệch trên phiếu điều chuyển. Phiếu điều chuyển nháp bị kho cấp từ chối → dòng yêu cầu quay về "Chờ xử lý".
- Mặc định công tắc: Dùng yêu cầu cấp hàng BẬT; **GĐ2**: "Cho phép chi nhánh đặt hàng NCC riêng" BẬT, "Cần chi nhánh chính duyệt" TẮT, "Cho phép nhận vượt số đặt" TẮT (chặn nhận vượt mặc định). Công ty một chi nhánh VẪN dùng Đơn đặt hàng, bỏ bước "Chờ duyệt" (người lập tự duyệt rồi bấm "Đã gửi nhà cung cấp"). Đơn giá dự kiến tuỳ chọn. Sổ công nợ NCC thêm cột "chi nhánh nhập" (chỉ hiện khi ≥ 2 chi nhánh).
- Rút dòng chờ đã gắn đơn NCC "Đã đặt": bên xin gửi **"Yêu cầu rút"**, kho cấp xác nhận (đơn NCC không bị huỷ; hàng về vẫn nhập kho cấp, không tự cấp cho phiếu đã rút) — thuộc GĐ2, chưa có cột/bảng nào cho việc này.

## 4. Đã làm ở GĐ1 (để biết chỗ tái dùng)
- **DB**: migration `20261112150000_stock_request` + `20261112160000_stock_request_force_rls`; bảng `stock_request`/`stock_request_line`/`stock_request_event`, `stock_transfer.request_id`, `stock_transfer_line.request_line_id`, `PrintDocumentType.STOCK_REQUEST`. `ERD-2.md` mục 3.24, `ERD.md` v1.97.
- **core**: `packages/core/src/inventory/stock-request-state.ts` (+spec, 28 ca: trạng thái dòng/phiếu, ma trận bên xin/kho cấp, `resolveSupplyingWarehouseId`), `errors/stock-request-errors.ts`.
- **shared**: `packages/shared/src/stock-request.ts`; mã `STOCK_REQUEST`→YCCH; mẫu in `STOCK_REQUEST`; công tắc `stockRequestEnabled` (+ `GET /clinic-settings/stock-request-enabled`); nhãn audit.
- **API** (`apps/api/src/modules/inventory/`): `stock-request.{controller,service,repository}.ts`, `stock-request-sync.service.ts` (phiếu điều chuyển gọi ngược trong cùng transaction), `stock-request-export.service.ts`, spec `stock-request-http.spec.ts` (24 ca). Route `inventory/requests` (tĩnh `pending-counts/options/low-stock/export` trước `:id`).
- **Web** (`apps/web/src/features/inventory/`): `StockRequest{List,Form,Detail}Page`, `StockRequestProcessPanel` (kho cấp; nút "Chuyển thành phiếu điều chuyển" portal xuống thanh nút đáy), `StockRequestDialogs`, `StockRequestPrintView`, `StockRequestFeatureGate`, `stock-request.{api,queries}.ts`, `stock-request-meta.ts`. Danh sách in qua `buildStockRequestListPrintSpec` (`report-print-builders.ts`).
- Kịch bản Chrome: `scripts/ui-audit/stock-request-check.cjs` (26/26).

## 5. Việc kế tiếp — GĐ2 Đơn đặt hàng NCC (theo mockup màn 7–13)
1. DECISIONS (mục bổ sung của #298) + ERD-2: `purchase_order`/`purchase_order_line` (trạng thái DRAFT→PENDING_APPROVAL→APPROVED→ORDERED→PARTIALLY_RECEIVED→RECEIVED/REJECTED/CANCELLED/đóng thiếu), `stock_receipt.purchase_order_id` + dòng nhận gắn dòng đơn, cột `wait_purchase_order_id` ở `stock_request_line`, cờ/bảng cho "Yêu cầu rút"; mã phiếu `DDH`, mẫu in `PURCHASE_ORDER`; quyền `purchase_order.create/read/approve`; công tắc `branchPurchasingEnabled`, `branchPurchaseNeedsMainApproval`, `allowOverReceipt`. Đơn theo CHI NHÁNH (kho nhận); công nợ NCC vẫn chung cả công ty.
2. Máy chủ: lập/sửa/duyệt/gửi NCC/huỷ đơn; nhận hàng bằng Phiếu nhập kho liên kết (nút "Nhận hàng" ở danh sách mở thẳng phiếu nhập điền sẵn, khoá NCC/kho/mặt hàng, chặn nhận vượt số còn thiếu); trạng thái đơn đổi theo phiếu nhập ĐƯỢC DUYỆT; liên kết dòng chờ hàng về của yêu cầu với đơn; "Yêu cầu rút"; chặn Phiếu nhập mua hàng ở chi nhánh phụ khi công tắc đặt riêng TẮT; cột chi nhánh ở sổ công nợ + cột/lọc "Từ đơn" ở danh sách Phiếu nhập.
3. Web: danh sách đơn (lọc, đếm, Excel, In, Xem/In/Nhận hàng), lập đơn, chi tiết/nhận hàng, bản in, 3 công tắc ở Cấu hình chung, màn 11 vòng đời đã làm sẵn ở phần yêu cầu.
4. Test: cô lập tenant B + chi nhánh khác cho mọi route mới, nhận nhiều đợt, nhận vượt bị chặn, công ty một chi nhánh bỏ "Chờ duyệt", quét quyền, Chrome qua IP LAN.

## 6. Quy tắc giao diện chủ dự án đã bắt buộc trong phiên này (áp cho GĐ2)
- Bám mockup sát: Diễn biến = danh sách chấm dọc (tiêu đề + dòng phụ "giờ, người/chi tiết"); dải bước MỘT hàng liền, bước hiện tại nền xanh đặc; số trong bảng căn GIỮA; ô số bỏ nút tăng/giảm (`[appearance:textfield]`…); bảng có `gap-x` giữa cột; thanh nút CỐ ĐỊNH đáy màn hình, khung bảng kéo dài tới đó và cuộn bên trong; KHÔNG chép chú thích dài của mockup vào sản phẩm.

## 7. Cách chạy lại kiểm Chrome
1. `pnpm dev` (API 3001) và `pnpm db:seed` rồi KHỞI ĐỘNG LẠI API (quyền mới chỉ vào vai trò lúc API khởi động).
2. `pnpm dev:lan` (in địa chỉ IP, đổi theo mạng). Cài `playwright-core@1.49.1` ở thư mục tạm (PowerShell, `npm i` trong thư mục có `package.json`).
3. `PLAYWRIGHT_CORE=<..>/node_modules/playwright-core UI_AUDIT_WEB=http://<IP>:5174 UI_AUDIT_OUT=<tạm> node scripts/ui-audit/stock-request-check.cjs`. Công ty thử `dev.admin / Dev@12345`; kịch bản tự tạo dữ liệu tiền tố KIEM298 (không xoá được vì không có xoá cứng).
4. Dọn: tắt API + dev:lan, **tắt cưỡng bức dev:lan làm `config.json` không tự khôi phục** — kiểm `apps/web/public/config.json` còn `apiBaseUrl` (xem `config.json.lan-backup`).

## 8. Bẫy đã gặp
- Chạy `pnpm db:generate` khi API dev đang chạy → lỗi `EPERM` khoá `query_engine-windows.dll.node`; tắt API trước.
- Test toàn bộ bắt được hai thứ dễ quên khi thêm tính năng mới: (1) route tự-phục vụ không khai quyền phải thêm vào danh sách cho phép ở `permission-matrix-enforcement-http.spec.ts`; (2) bảng mới phải `FORCE ROW LEVEL SECURITY` (test `rls-coverage`). Cũng nhớ sửa số đếm ở `business-code-http.spec.ts`/`print-template-http.spec.ts` khi thêm mã/mẫu in mới, và `no-show.spec.ts` (stub `ClinicConfigReaderPort`).
- `tenant-fixture.ts` phải xoá bảng mới TRƯỚC `drug`/`warehouse` (đã thêm cho 3 bảng yêu cầu; GĐ2 phải thêm bảng đơn đặt hàng).
- Cột `DATE` lưu `new Date('YYYY-MM-DDT00:00:00Z')`, KHÔNG dùng `vietnamDayStartUtc` (lệch một ngày).
- Selector Playwright `button:has-text("Tiếp nhận")` trùng nút nhóm menu "Tiếp nhận và Đặt lịch": dùng `main button:has-text(...)`.
- Heredoc Bash có dấu nháy lẻ/backtick lồng làm hỏng lệnh: ghi bản vá bằng công cụ Write ra tệp `.cjs` rồi chạy `node`.
- Không có `gh`: kiểm CI bằng `git credential fill` + API GitHub (script cũ ở thư mục tạm; cần SHA ĐẦY ĐỦ, SHA ngắn không khớp).
- Mặc định vai trò: bác sĩ/điều dưỡng có `stock_request.create/read`, clinic_admin đủ ba quyền — lựa chọn của AI, chủ dự án chưa xem.
