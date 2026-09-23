# Handoff — Kho Thuốc GĐ4, phần "Điều chuyển kho" (CODE + TEST XONG, chưa verify Playwright)

**Ngày ghi**: 22/09/2026 (cuối phiên), đọc lại đầu phiên mới ngày 23/09/2026. **Trạng thái**: phần "Điều chuyển kho" (2/5 phần của GĐ4) đã **code + test xong hoàn toàn**, mockup đã duyệt trong phiên (xem `docs/DECISIONS.md` #173). Commit: `a60ab18`. **Còn treo duy nhất cho phần này: verify Playwright/trình duyệt thật** — phiên vừa rồi không có công cụ browser automation khả dụng.

## Việc kế tiếp ưu tiên — theo đúng thứ tự

1. **Verify Playwright/Chrome thật cho phần "Điều chuyển kho"** (chưa làm, cần làm TRƯỚC khi coi phần này xong 100%):
   - `pnpm dev` **KHÔNG còn chạy** (đã tắt/mất giữa phiên) — khởi động lại từ gốc repo trước khi test tay/Playwright.
   - Tạo tenant test riêng hoặc dùng `dev.admin` (đúng bài học #166 — KHÔNG đụng tenant chủ dự án đang dùng thật nếu có dữ liệu thật trên đó).
   - Kịch bản cần xác nhận trực quan (đã pass ở tầng HTTP qua `stock-transfer-http.spec.ts`, chưa ai NHÌN THẤY chạy đúng trên UI thật):
     - `/inventory/transfers` (danh sách): 4 trạng thái hiện đúng badge màu (Nháp/Đang vận chuyển tô nền vàng nhạt + nút nổi bật "Xác nhận nhận hàng"/Hoàn tất/Từ chối), nút thao tác đúng theo trạng thái + quyền.
     - `/inventory/transfers/new`: chọn Kho nguồn → search-and-pick mặt hàng (tự tách N dòng theo lô hiện có tại kho nguồn, đúng khuôn `StockCountFormPage.tsx`) → nhập SL dự kiến chuyển → "Duyệt (Xuất kho ngay)" → xác nhận tồn kho nguồn giảm đúng ngay, phiếu chuyển "Đang vận chuyển".
     - Vào lại phiếu "Đang vận chuyển" → bảng "Xác nhận nhận hàng": SL thực nhận mặc định = SL đã xuất, sửa xuống thấp hơn → dòng tô vàng + ô "Ghi chú chênh lệch" bắt buộc hiện ra; thử nhập cao hơn số đã xuất → phải bị chặn (input `max` + lỗi 422 khi submit); "Xác nhận đã nhận hàng" → tồn kho đích tăng đúng số thực nhận, phiếu "Hoàn tất".
     - "Từ chối" phiếu Nháp (nút trong danh sách hoặc trên trang chi tiết) → bắt buộc lý do, không đụng tồn.
     - **Phân quyền theo Khoa/Phòng nhìn trên UI thật** (đã pass ở tầng HTTP, describe "Phân quyền theo Khoa/Phòng" trong `stock-transfer-http.spec.ts`) — tạo 2 vai trò tuỳ biến gán `stock_transfer.*`→scope `department` cho 2 Khoa khác nhau (đúng khuôn đã làm ở #170 cho Kiểm kê), xác nhận: actor Khoa A không Duyệt xuất được phiếu của Khoa B (404, không phải 403); actor Khoa nguồn không Xác nhận nhận hàng được (phải là actor Khoa đích); xem (GET) thì cả 2 phía đều thấy được.
   - Sau khi verify xong, cập nhật `docs/DECISIONS.md` #173 (thêm đoạn "Verify Playwright hoàn tất — kết quả...") + `docs/CHANGELOG.md`, rồi mới coi phần "Điều chuyển kho" xong 100%.

2. **Rà lại 1 điểm CHƯA làm đúng kế hoạch gốc** (tự phát hiện lúc viết handoff, chưa hỏi chủ dự án): kế hoạch kỹ thuật #170 mục 0 nói phân quyền theo Khoa/Phòng phải áp dụng ĐỒNG BỘ cho cả 4 module kho (`stock_receipt`/`stock_issue`/`stock_transfer`/`stock_count`) "1 lượt khi làm Điều chuyển kho". Phiên này **chỉ thêm phân quyền Khoa/Phòng cho `stock_transfer` (module mới)** — **CHƯA retrofit** cho `stock_receipt.service.ts`/`stock_issue.service.ts` hiện có (list/get/create/approve của 2 module đó vẫn mặc định `global`, không kiểm `dataScope==='department'` gì cả, y như trước phiên này). Cần hỏi chủ dự án: làm retrofit ngay bây giờ (trước khi sang phần 3), hay để dành tới lúc thật cần (tenant có nhiều Kho theo nhiều Khoa quản lý Nhập/Xuất riêng)? Chưa tự ý quyết — đây là câu hỏi cần đặt ra đầu phiên mới, không phải lỗi cần sửa gấp (mặc định `global` vẫn đúng/an toàn cho phòng khám 1 kho).

3. **Chuyển sang phần 3/5 "Phiếu xuất kho mở rộng"** (Xuất dùng nội bộ/Xuất trả NCC/Xuất huỷ, Nháp→Duyệt — khác `RETAIL_SALE` giữ nguyên 1 bước) — **mockup CHƯA duyệt**, phải qua đúng quy trình dựng mockup → hỏi → chờ xác nhận rõ ràng ("duyệt"/"ok làm đi", KHÔNG suy diễn từ "tiếp tục công việc" — bài học `feedback_explicit_mockup_approval` đã ghi trong bộ nhớ) trước khi code.

## Tài liệu tham khảo bắt buộc đọc trước khi tiếp tục

- **Kế hoạch kỹ thuật đầy đủ GĐ4 (cả 5 phần)**: `C:\Users\Administrator\.claude\plans\bright-bubbling-axolotl.md` — chứa kiến trúc từng phần, ripple checklist, thứ tự dựng mockup. Mục 3 ("Mở rộng Phiếu xuất kho") là phần cần đọc kỹ tiếp theo.
- **Quyết định đã chốt cho phần "Điều chuyển kho" vừa code xong**: `docs/DECISIONS.md` #173 (chi tiết đầy đủ: schema, lý do KHÔNG thêm cột forward `generatedIssueId`/`generatedReceiptId` như plan gốc, cơ chế tự sinh chứng từ, phân quyền theo Khoa/Phòng, kết quả test, sửa `RECEIPT_TYPE_TO_LEDGER_REASON` — bug thật phát hiện lúc rà soát).
- **Mockup "Điều chuyển kho" đã duyệt** (tham khảo nếu cần đối chiếu lại UI): `https://claude.ai/artifact/47Fa4sh8sVawAbbPAhmzj9` — đọc qua `Artifact({action:"read", url:...})`.

## Tóm tắt việc đã làm trong phiên này (đầy đủ ở #173, đây chỉ liệt kê nhanh)

- Schema: `stock_transfer`/`stock_transfer_line` (migration `20260922130000_stock_transfer_ge4`) + cột `transfer_id` trên `stock_receipt`/`stock_issue` (trỏ ngược, cùng bản chất `count_id`). 3 CHECK mới C32 (khác kho)/C33 (không nhận vượt xuất)/C34 (bắt buộc ghi chú khi thiếu) — xem `docs/ERD.md` mục 3.9.
- Backend: `stock-transfer.{controller,service,repository}.ts` mới; `StockReceiptService.createTransferInReceipt()`/`StockIssueService.createTransferOutIssue()` mới (trích `createSystemGeneratedIssue()` dùng chung với `createCountShortageIssue()`); sửa bug thật `RECEIPT_TYPE_TO_LEDGER_REASON` (map tường minh, tránh fallback sai reason cho `TRANSFER_IN`); permission `stock_transfer.{create,read,approve}` mới; business code `STOCK_TRANSFER` (prefix `PDC`).
- **Phân quyền theo Khoa/Phòng cho `stock_transfer`** — kiểm ĐÚNG kho của từng bước (nguồn cho Tạo/Sửa/Từ chối/Duyệt xuất, đích cho Xác nhận nhận hàng; XEM nới hơn — 1-trong-2 phía đều xem được). **CHƯA retrofit `stock_receipt`/`stock_issue` hiện có** — xem mục "Việc kế tiếp" #2 ở trên.
- Frontend: `StockTransferListPage.tsx`/`StockTransferFormPage.tsx` (dùng chung 4 chế độ theo trạng thái phiếu)/`StockTransferRejectDialog.tsx` mới, route `/inventory/transfers*`, mục Sidebar "Điều chuyển kho" (icon `ArrowsLeftRight`, nhóm "Quản lý kho").
- **Ngoài kế hoạch, chủ dự án yêu cầu trực tiếp giữa phiên**: thêm tìm theo **mã vạch** vào ô tìm thuốc/vật tư dùng chung (sửa đúng 1 chỗ `DrugRepository.list()`, tự áp dụng mọi nơi gọi). Phát hiện lúc rà soát, CHƯA sửa (cần hỏi trước): `barcode` hiện chỉ lưu được cho Thuốc (`itemType='MEDICINE'`) lúc tạo mới, Vật tư y tế chưa nhập được qua form dù cũng thường có mã vạch thật.
- Docs đã cập nhật: `docs/TASK.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md` (#173), `docs/ERD.md` (mục 3.9 + C32-C34 + version v1.53 — **lưu ý**: mục 3 của ERD vẫn còn nợ tài liệu từ trước cho GĐ3 (`stock_issue`)/GĐ4-Kiểm kê (`stock_count`), đã ghi chú rõ trong ERD, KHÔNG phải việc của phiên này). **CHƯA đụng** `CLAUDE.md`/`docs/product/prd.md`/`docs/product/plan.md` — đúng tiền lệ #072/#146...#170, đợi xong TOÀN BỘ GĐ4 (cả 5 phần) mới đồng bộ tài liệu cấu trúc 1 lần.
- **Đã xác minh**: `pnpm -w typecheck/lint/build` sạch toàn workspace, `stock-transfer-http.spec.ts` 23/23 mới, toàn bộ suite `apps/api` (906 test) + `packages/core` (212) + `packages/shared` (25) + `apps/web` (5) pass (sửa 2 hồi quy đúng dự kiến: đếm loại mã nghiệp vụ 16→17 trong `business-code-http.spec.ts`, 1 flake race `icd10-http.spec.ts` đã biết không liên quan). Migration đã áp thật lên Postgres dev.

## Lưu ý môi trường

- **`pnpm dev` KHÔNG chạy** ở đầu phiên mới — phải tự khởi động lại (`pnpm dev` từ gốc repo) trước khi verify Playwright/test tay. API cổng **3001**, Web cổng **5173**.
- Trong phiên trước, đã phải DỪNG TẠM `pnpm dev` một lần để chạy `prisma generate` (Windows khoá `query_engine.dll.node` khi có tiến trình dev đang chạy — đúng lỗi đã biết #087/#171), đã hỏi và được đồng ý trước khi dừng, khởi động lại ngay sau khi `db:generate`+`db:deploy` xong — nhưng tiến trình đó không còn sống tới đầu phiên mới (có thể do đổi ngày/refresh môi trường giữa 2 phiên).
- Migration `20260922130000_stock_transfer_ge4` đã áp thật lên Postgres dev (`db:deploy`) — không cần chạy lại.
- OpenAPI (`apps/api/openapi/openapi.json`) + web codegen (`apps/web/src/shared/api/openapi-schema.d.ts`) đã sinh lại đúng, khớp code hiện tại — không cần chạy lại trừ khi đổi thêm contract.
- File kế hoạch `bright-bubbling-axolotl.md` và 2 mockup (Kiểm kê + Điều chuyển kho) nằm NGOÀI repo (máy cục bộ Claude/Artifact) — đọc qua đường dẫn/URL ghi ở trên, không tìm trong `docs/`.

## Việc KHÔNG làm (đã chốt hoặc cố ý hoãn, đừng tự mở rộng)

- Chưa retrofit phân quyền Khoa/Phòng cho `stock_receipt`/`stock_issue` hiện có — xem mục "Việc kế tiếp" #2, cần HỎI chủ dự án trước, không tự quyết.
- Chưa mở khoá lưu `barcode` cho Vật tư y tế (`itemType='SUPPLY'`) — chỉ ghi nhận, chưa sửa (thay đổi phạm vi dữ liệu bắt buộc hỏi trước theo `CLAUDE.md`).
- Chưa dựng mockup "Phiếu xuất kho mở rộng" (phần 3/5) — đây là việc kế tiếp sau khi verify Playwright phần "Điều chuyển kho" xong.
- Không thêm cột `generatedIssueId`/`generatedReceiptId` (forward) trên `stock_transfer` dù bản kế hoạch kỹ thuật gốc có nhắc tới — đã đơn giản hoá lúc code (chỉ dùng quan hệ ngược `transferId` trên receipt/issue, đúng khuôn `stock_count`), xem lý do đầy đủ ở #173. Không phải thiếu sót, là quyết định có chủ đích.
