# Handoff — Kho Thuốc GĐ4, phần "Kiểm kê" (cập nhật cuối phiên, đã CODE + TEST XONG)

**Ngày ghi**: 22/09/2026 (cập nhật lần 3, cùng ngày — file này đã có từ đầu phiên ghi "CHƯA VIẾT DÒNG CODE NÀO", nay ghi đè lại toàn bộ vì trạng thái đã đổi hẳn). **Trạng thái**: phần "Kiểm kê" (1/5 phần của GĐ4) đã **code + test xong hoàn toàn**, xem `docs/DECISIONS.md` #170. **Còn treo duy nhất: verify Playwright/trình duyệt thật** — phiên vừa rồi không có công cụ browser automation khả dụng.

## Việc kế tiếp ưu tiên — theo đúng thứ tự

1. **Verify Playwright/Chrome thật cho phần "Kiểm kê"** (chưa làm, cần làm TRƯỚC khi coi phần này xong 100%):
   - Tạo tenant test riêng (đúng bài học #166 — KHÔNG đụng tenant chủ dự án đang dùng thật). Dùng `pnpm --filter @nexamed/api run db:seed:dev-tenant` hoặc tạo tenant mới qua UI/API.
   - Kịch bản cần xác nhận trực quan (đã pass ở tầng HTTP, chưa ai NHÌN THẤY chạy đúng trên UI thật):
     - Ô tìm-và-chọn 1 bước ở `/inventory/counts/new`: gõ → dropdown kết quả → click hoặc Enter/Tab thêm dòng, ↑/↓ đổi dòng tô sáng. **Vừa sửa 1 bug thật trong phiên** (icon kính lúp lệch khỏi khung, đổi `input type="search"`→`type="text"`) — cần xác nhận icon đã nằm đúng vị trí sau khi sửa (chưa ai nhìn lại kể từ lúc sửa).
     - Panel "Thêm theo nhóm" (nút → mở panel → chọn Loại/Nhóm thuốc → đếm đúng số khớp bộ lọc → bấm "Thêm N sản phẩm" → tất cả tự tách đúng dòng theo lô).
     - 1 sản phẩm nhiều lô tự tách N dòng dưới 1 tiêu đề nhóm; nút "+ Thêm lô mới" trên tiêu đề nhóm cho lô hoàn toàn lạ (nhập tay Số lô + Hạn dùng).
     - Pill dư/thiếu/khớp đổi màu đúng theo số đếm nhập vào (xanh/đỏ/xám).
     - Bấm "Duyệt" → xem lại phiếu đã Duyệt hiện đúng `difference` đã lưu (không tính lại theo số cũ).
     - Danh sách `/inventory/counts`: Duyệt/Từ chối ngay trong hàng, filter Kho/Trạng thái/tìm mã phiếu.
     - **Phân quyền theo Khoa/Phòng nhìn trên UI thật** (đã pass ở tầng HTTP, `stock-count-http.spec.ts` describe "Phân quyền theo Khoa/Phòng", 5/5) — tạo 1 vai trò tuỳ biến gán `stock_count.*`→scope `department`, gán actor vào 1 Khoa có Kho riêng, xác nhận: dropdown "Kho kiểm kê" ở form tự lọc chỉ còn kho đúng Khoa (không hiện kho khác để chọn rồi mới báo lỗi); vào thẳng URL phiếu kiểm kê ngoài Khoa → trang báo "Không tìm thấy" (404), không phải 403.
   - Sau khi verify xong, cập nhật `docs/DECISIONS.md` #170 (thêm đoạn "Verify Playwright hoàn tất — kết quả...") + `docs/CHANGELOG.md` (thêm dòng xác nhận), rồi mới coi phần "Kiểm kê" xong 100%.

2. **Chuyển sang phần 2 "Điều chuyển kho"** (5 phần của GĐ4, xem thứ tự đầy đủ trong file kế hoạch bên dưới) — **mockup CHƯA duyệt**, phải qua đúng quy trình dựng mockup → hỏi → chờ xác nhận rõ ràng ("duyệt"/"ok làm đi", KHÔNG suy diễn từ "tiếp tục công việc" — bài học `feedback_explicit_mockup_approval` đã ghi trong bộ nhớ) trước khi code, KHÔNG áp dụng "đã duyệt" của Kiểm kê sang phần này.

## Tài liệu tham khảo bắt buộc đọc trước khi tiếp tục

- **Kế hoạch kỹ thuật đầy đủ GĐ4 (cả 5 phần)**: `C:\Users\Administrator\.claude\plans\bright-bubbling-axolotl.md` — chứa kiến trúc từng phần, ripple checklist, thứ tự dựng mockup.
- **Quyết định đã chốt cho phần "Kiểm kê" vừa code xong**: `docs/DECISIONS.md` #170 (chi tiết đầy đủ: schema, ripple trên `stock_receipt`/`stock_issue`, cơ chế tự sinh chứng từ, phân quyền theo Khoa/Phòng, kết quả test).
- **Mockup phần "Kiểm kê" đã duyệt** (tham khảo nếu cần đối chiếu lại UI): `https://claude.ai/artifact/Sa9GixpRz4CjLwq5xK66jQ` — đọc qua `Artifact({action:"read", url:...})`.

## Tóm tắt việc đã làm trong phiên này (đầy đủ ở #170, đây chỉ liệt kê nhanh)

- Schema: `stock_count`/`stock_count_line` (migration `20260922100000_stock_count_ge4`) + `count_id` trên `stock_receipt`/`stock_issue` + `stock_issue.prescription_id` nới NULLABLE.
- Backend: `stock-count.{controller,service,repository}.ts` mới; `StockReceiptService.createCountSurplusReceipt()`/`StockIssueService.createCountShortageIssue()` mới (dùng lại logic cộng/trừ tồn có sẵn); `stock-issue.service.ts`/`repository.ts` sửa để chịu được `prescription=null`; permission `stock_count.{create,read,approve}` mới.
- **Phân quyền theo Khoa/Phòng làm THẬT lần đầu tiên trong dự án** cho module `stock_count` (chưa retrofit `stock_receipt`/`stock_issue` — cố ý để dành khi làm "Điều chuyển kho", áp dụng đồng bộ 1 lượt cho cả 4 module kho theo đúng kế hoạch #170 mục 0).
- `currentUserSchema` (`packages/shared`) thêm `departmentId` — field dùng chung được cho các module sau.
- Frontend: `StockCountListPage.tsx`/`StockCountFormPage.tsx`/`StockCountRejectDialog.tsx` mới, route `/inventory/counts*`, mục Sidebar "Kiểm kê" (nhóm "Quản lý kho").
- Docs đã cập nhật: `docs/TASK.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md` (#170). **CHƯA đụng** `CLAUDE.md`/`docs/ERD.md`/`docs/product/prd.md`/`docs/product/plan.md` — đúng tiền lệ #072/#146...#151, đợi xong TOÀN BỘ GĐ4 (cả 5 phần) mới đồng bộ tài liệu cấu trúc 1 lần.
- **Đã xác minh**: `pnpm -w typecheck/lint/build` sạch toàn workspace, `packages/core` 212/212, `apps/api` `stock-count-http.spec.ts` 20/20 + toàn suite 878-881/881 ổn định (3 lỗi còn lại là flake race `seedDefaultRolesForTenant` đã biết, không liên quan — xác nhận qua chạy cô lập + quan sát file fail đổi ngẫu nhiên qua nhiều lượt chạy). API dev thật khởi động sạch (`GET /health` → `{"status":"ok","db":"ok"}`).

## Chuỗi sửa lỗi giao diện trực tiếp cuối phiên (chủ dự án dùng `pnpm dev` thật, gửi ảnh chụp)

1. Icon kính lúp ở ô tìm kiếm `StockCountFormPage.tsx` lệch ra ngoài khung — nguyên nhân nghi do `input type="search"` tự vẽ decoration riêng của Chrome/Windows xung đột với icon `absolute` đè lên — đã đổi sang `type="text"` + chỉnh lại `left-3`/`pl-9`. **CHƯA được xác nhận lại bằng ảnh chụp mới** (sửa xong cuối phiên, chưa kịp chủ dự án xem lại) — ưu tiên kiểm tra lại đầu tiên khi vào phiên mới.
2. Xoá cả 3 dòng ghi chú hướng dẫn màu xám nhạt trong `StockCountFormPage.tsx` (hướng dẫn phím ↑↓, giải thích "1 sản phẩm nhiều lô...", lưu ý "Bấm Duyệt sẽ đọc lại tồn kho...") theo yêu cầu trực tiếp — chỉ giữ lại thông báo trạng thái chức năng thật (ví dụ "Không tìm thấy, hoặc đã có sẵn trong phiếu"). Khác mockup gốc (mockup CÓ các dòng ghi chú này) — đây là phản hồi trực tiếp ghi đè lên mockup, đúng tinh thần "phản hồi trực tiếp trên bản chạy thật thắng mockup tĩnh" đã áp dụng nhiều lần trong dự án.

## Lưu ý môi trường

- **`pnpm dev` đang chạy NỀN** (khởi động cuối phiên để smoke-test + phục vụ chủ dự án xem trực tiếp) — API cổng **3001**, Web cổng **5173**. Nếu phiên mới không thấy tiến trình này còn sống, chạy lại `pnpm dev` từ gốc repo.
- Migration `20260922100000_stock_count_ge4` đã áp thật lên Postgres dev (`db:deploy`) + đã chạy `db:seed` (permission catalog có `stock_count.*`).
- OpenAPI (`apps/api/openapi/openapi.json`) + web codegen (`apps/web/src/shared/api/openapi-schema.d.ts`) đã sinh lại đúng, khớp code hiện tại — không cần chạy lại trừ khi đổi thêm contract.
- File kế hoạch `bright-bubbling-axolotl.md` và mockup Kiểm kê nằm NGOÀI repo (máy cục bộ Claude) — đọc qua đường dẫn/URL ghi ở trên, không tìm trong `docs/`.

## Việc KHÔNG làm (đã chốt, đừng tự mở rộng)

- Chưa retrofit phân quyền Khoa/Phòng cho `stock_receipt`/`stock_issue` hiện có — để dành làm 1 lượt khi code "Điều chuyển kho" (đúng kế hoạch #170 mục 0 "áp dụng ĐỒNG BỘ cả 4 module kho").
- Chưa thêm UI "xem chứng từ gốc" cho `count_id` mới trên `StockReceiptFormPage.tsx`/`DispenseQueuePage.tsx` — mockup Kiểm kê không yêu cầu, tránh chỉnh sửa ngoài phạm vi đã duyệt.
- Chưa dựng mockup "Điều chuyển kho" (phần 2/5) — đây là việc kế tiếp sau khi verify Playwright phần Kiểm kê xong.
