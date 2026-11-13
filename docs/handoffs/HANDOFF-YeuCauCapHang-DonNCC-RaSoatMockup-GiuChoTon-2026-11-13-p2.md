# HANDOFF — Yêu cầu cấp hàng + Đơn đặt hàng NCC: rà soát mockup xong, giữ chỗ tồn — 2026-11-13 (phần 2)

## 1. Trạng thái một câu
**Mọi việc của #298 (Yêu cầu cấp hàng GĐ1 + Đơn đặt hàng NCC GĐ2 + Thêm nhanh mặt hàng + cột Diễn giải sổ công nợ + rà soát 16 màn mockup) đã XONG, đã push, CI GitHub XANH.** `master` = `38670add`, working tree sạch. **Không có việc dở nào trong code.** Bản bàn giao trước (`HANDOFF-DonDatHangNCC-GD2-ThemNhanhMatHang-2026-11-13.md`) đã được bản này thay thế.

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #298 gần cuối file), `docs/DECISIONS.md` cuối file (#298 bổ sung 1–4) và file này.
2. Hỏi chủ dự án muốn làm phần nào tiếp theo (chưa chọn). Gợi ý theo `docs/CURRENT.md` mục "Đang chờ / việc treo": các việc "cần chủ dự án" (xem 6 điểm khác mockup Tổng quan bác sĩ đã xong; chốt gói thuê bao + giấy phép ký số; chữ ký điện tử bệnh án Thông tư 13/2025 mốc 31/12/2026; gói Nhi khoa còn 6 câu chưa chốt) và các việc "cần máy/đơn vị bên ngoài" (pilot thật S6-02/S6-04, hạ tầng SaaS, bộ cài trên máy sạch/NAS, liên thông cổng thật).
3. Môi trường khác (không phải máy dev) sau khi lấy mã mới cần: `pnpm install`, `pnpm db:deploy` (migration mới nhất `20261113090000_purchase_order`), `pnpm db:seed` (3 quyền `purchase_order.*`), khởi động lại API. **Không có migration/seed mới trong đợt rà soát mockup.**

## 3. Đã làm trong phiên này (tóm tắt, chi tiết ở DECISIONS #298 bổ sung 1–4)
- **Thêm nhanh mặt hàng** (Thuốc + Vật tư, ở ô tìm hàng của Đơn đặt hàng NCC và Phiếu nhập kho; mã `MH…` tự sinh; quyền `drug.create`): `features/drug/QuickAddItemDialog.tsx`, `QuickAddItemRow.tsx`, `quick-add-search.ts`. Hộp dựng bằng portal + `stopPropagation` ở submit (nếu không Enter lưu nhầm cả đơn). Sửa luôn `SystemFailureDialog` lên `z-[80]` (bị hộp khác đè).
- **Cột "Diễn giải" sổ công nợ NCC** (`supplier-debt/ledger-labels.ts#describeLedgerEntry`), cột "Chi nhánh nhập".
- **Rà soát từng màn mockup 16 màn** (https://claude.ai/artifact/Ut7h7axLUPynLqwvPbaPBi) rồi làm bù: danh sách (cột Tiến độ cấp/Người xin/Việc cần làm, dải đếm, dải vàng, tìm theo mặt hàng, lọc kho xin, màu trạng thái, Tiếp nhận ngay tại hàng), màn 4, màn 5/5b (hộp Chờ hàng về liên kết `childRequestId`, xác nhận + hộp kết quả `StockRequestTransferResult` có lô gợi ý/Sửa lô/Duyệt xuất, "Thông tin phiếu" cột phải, dải "Bên xin vừa cập nhật"), màn 6b, đơn NCC (dải đếm, cột Nhận đợt này), bản in (Trưởng phòng, STT), form có khung nhãn.
- **"Hàng đã về" giữ chỗ tồn theo thứ tự phiếu** (chủ dự án chốt): `computeReadyRequestIds` ở `packages/core/src/inventory/stock-request-state.ts`; tính trên mọi phiếu cùng tranh một kho cấp + mặt hàng. Chấm số "Cần duyệt" = `actionable` (phiếu KHÁC NHAU cần làm), thêm `ready`.
- Máy chủ mới: `listActiveSupplierStubs`, `listWaitingLinesForSuppliers`, `findChildBrief`; summary phiếu thêm `requestingDepartmentName`, `activeLineCount/allocatedLineCount/waitingLineCount/pendingLineCount`, `earliestWaitDate`; detail thêm `childRequests`; lọc kho ở cả hai tab là **kho xin**; ô tìm `q` khớp số phiếu hoặc tên/mã mặt hàng.
- **Chủ dự án chốt GIỮ NGUYÊN 7 chỗ khác mockup** (nút icon dùng chung thay nút chữ; tab Cần duyệt giữ lọc + lịch sử; màn 5 lý do từ chối trong hộp/nút rời/"Từ chối cả phiếu" thanh trên; ô gõ tìm thay nút "Thêm mặt hàng"; phiếu nhập theo đơn dùng trang có sẵn; hộp thoại có biểu tượng đầu hộp; thanh lọc ngắt hai hàng ở 1440px). Không còn việc treo.
- Trả lời chủ dự án (đã đúng trong mã, không cần sửa): phiếu điều chuyển nội bộ Duyệt xuất/Kiểm nhận/Từ chối nhận/Nhận lại/Xử lý chênh lệch **tự đồng bộ** phiếu xin (diễn biến, trạng thái dòng, tự "Đã hoàn thành"); chỉ **nhận thiếu** (kho cấp "Xử lý chênh lệch") và **"Cấp tiếp"** dòng chờ hàng về là thao tác tay. Ma trận bên xin 6b khớp lõi/máy chủ/giao diện, đã có test.

## 4. Kiểm đã chạy
Full API **2362 xanh** (1 lượt), core xanh (+6), web 798, typecheck + lint toàn workspace sạch, Chrome IP LAN: `scripts/ui-audit/quick-add-item-check.cjs` 25/25 và `purchase-order-check.cjs` 38/38; chụp đối chiếu từng màn bằng script tạm (không đưa vào repo). CI GitHub xanh ở `ba2a6d2d`, `c341f7a6`, `d240a3da`, `38670add`.

## 5. Bẫy đã gặp (đọc trước khi làm)
- **`pnpm --filter … exec vitest` từ thư mục gốc báo "No projects matched … c:\Projects\NEXAMed"** (ổ đĩa chữ thường) → chạy test API bằng `cd apps/api && npx vitest run`; typecheck/lint web: `cd apps/web && npx tsc --noEmit` / `npx eslint <thư mục>`.
- **Docker Desktop có thể tự tắt giữa phiên** → test API báo "Could not find a working container runtime strategy". Bật lại: `Start-Process "C:\Users\Administrator\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"` rồi chờ `docker ps` chạy.
- **Máy không có `gh`**: kiểm CI bằng REST API với token lấy từ `git credential fill` (không in token), `GET /repos/phanuy261991-hash/NEXAMed/actions/runs?branch=master`.
- Sửa tài liệu: dùng `node scripts/patch-file.mjs <edits.json>` (an toàn CRLF), grep `=> m` sau khi ghi.
- Selector kiểm Chrome: `button:has-text("Tiếp nhận")` khớp nhầm mục menu "Tiếp nhận và Đặt lịch" — dùng `button:text-is("Tiếp nhận")`.
- Khi kiểm Chrome: `pnpm dev:lan` + API (`pnpm --filter @nexamed/api run dev`), tắt xong phải kiểm `apps/web/public/config.json` còn `apiBaseUrl: http://localhost:3001` và không còn `config.json.lan-backup`. Dữ liệu thử tiền tố KIEMNHANH/KIEMDDH/"Công ty VTYT Hải Long" nằm lại ở công ty thử (không xoá cứng).
- Tài khoản thử `dev.admin` vừa là bên xin vừa là kho cấp nên chi tiết phiếu hiện chung hai khung; muốn kiểm riêng một phía cần tài khoản/vai trò khác.

## 6. Quy tắc chủ dự án nhắc (đã ghi memory)
- **Không tự lược bỏ bất cứ phần nào của mockup đã duyệt**; muốn bỏ/hoãn phải hỏi bằng câu hỏi lựa chọn.
- **Trước khi báo xong màn có mockup: đối chiếu TỪNG phần tử** (cột, tab, nút, dải thông báo, nhãn) từ HTML thô của mockup với bản thật, liệt kê mọi chỗ lệch cho chủ dự án (memory `feedback_mockup_element_by_element`).
- Commit/push thẳng `master`, không PR (chỉ khi chủ dự án yêu cầu).
