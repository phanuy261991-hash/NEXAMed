# Handoff — Kho Thuốc GĐ5 + Redesign màn khám sang "Tab thật"

**Ngày ghi**: 28/09/2026. **Trạng thái**: backend + frontend code xong, `pnpm -w typecheck/lint/build` sạch toàn workspace, `apps/api` test HTTP đầy đủ (1016/1017 pass, 1 flake tiền nhiệm đã biết). **CHƯA VERIFY PLAYWRIGHT — đây là việc DUY NHẤT còn thiếu trước khi coi việc này hoàn tất 100%.**

Phiên trước bị ngắt kết nối đột ngột đúng lúc vừa `npm install playwright@1.48` vào scratchpad để chuẩn bị verify — không có lỗi gì xảy ra, chỉ là phiên dừng giữa chừng trước khi kịp viết script chạy thử. Toàn bộ code đã nằm trên đĩa (đã xác nhận qua `git status`), không mất gì.

## Bối cảnh đầy đủ — đọc `docs/DECISIONS.md` #190 trước khi làm gì tiếp

Quyết định #190 ghi đầy đủ: phạm vi đã chốt qua `AskUserQuestion` (macro/gõ tắt cả hai, chặn tồn qua công tắc tuỳ chọn mặc định tắt, tồn tính tổng toàn phòng khám, bàn phím cả ô tìm lẫn toàn dòng, công tắc "Có kho thuốc" riêng, không cho kê thuốc ngoài danh mục), xung đột kiến trúc `EncounterModule ↛ InventoryModule` (#165) giải quyết bằng `StockAvailabilityPort`, và bài học `onHandByDrugId: null` vs `{}` (khác ý nghĩa hoàn toàn, gây bug thật lúc code).

## Việc DUY NHẤT còn lại: Verify Playwright/Chrome thật

Theo đúng tiền lệ mọi phiên trước (xem các `HANDOFF-KhoThuoc-*.md` khác) — cài Playwright tạm vào scratchpad (không commit), dùng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (đã trỏ sẵn trong `apps/web/public/config.json`, đúng memory `feedback_fixed_test_tenant` — **không đụng tenant thật của chủ dự án**). Tài khoản `dev.admin`/`Dev@12345` (seed qua `pnpm --filter @nexamed/api exec tsx scripts/seed-dev-tenant.ts` nếu tenant test chưa có sẵn tài khoản/dữ liệu).

Cần dựng được: 1 lượt khám `IN_CONSULTATION` đã có chẩn đoán chính (đi qua Đặt lịch → Tiếp nhận check-in → Bắt đầu khám → thêm 1 chẩn đoán ICD-10 chính), vài thuốc test trong danh mục (1 thuốc có `shortcutCode`, tồn kho thấp cho 1 thuốc khác để test cảnh báo vượt tồn — nhập kho qua "Phiếu nhập kho" hoặc `privileged.stockBalance.create()` thẳng qua Prisma nếu muốn nhanh, giống cách `prescription-http.spec.ts` seed trong test).

**Danh sách cần xác nhận bằng mắt** (đối chiếu đúng mockup Artifact "Bố cục màn khám bệnh" đã duyệt trong phiên trước, và các quyết định trong #190):

1. Vào `/encounters/:id` (màn khám) — thấy đúng 2 tab thật ("Khám & Chẩn đoán", "Kê đơn thuốc"), KHÔNG còn 2 tab "Sắp ra mắt". Bấm qua lại 2 tab đổi nội dung NGAY (không cuộn/không giật/không nhấp nháy).
2. Tab "Khám & Chẩn đoán" thêm 1 chẩn đoán chính → dấu tick xanh hiện cạnh tên tab đó.
3. Chuyển sang tab "Kê đơn thuốc" — thấy thanh chẩn đoán dính (sticky) ngay trên đỉnh khi cuộn nội dung dài xuống. Thấy khối "Mã đơn thuốc: Cấp khi ký đơn / BS kê đơn: {tên bác sĩ đang đăng nhập} / Ngày kê: Đang soạn" + khối vàng "Chẩn đoán lâm sàng" đúng tên+mã ICD-10 vừa chọn.
4. Ô tìm thuốc (`DrugPicker`): gõ không dấu (vd "viem" khớp thuốc tên có "Viêm") — khớp đúng. Gõ đúng `shortcutCode` của 1 thuốc test — thuốc đó hiện kèm badge "gõ tắt: ...". Dùng phím `↓`/`↑` di chuyển giữa kết quả (viền teal đổi đúng dòng), `Enter` thêm đúng dòng đang chọn vào đơn, `Escape` xoá ô tìm.
5. Thêm 1 thuốc có tồn kho đã seed → dòng thuốc trong bảng nháp hiện đúng badge "Tồn {số}" (xanh) hoặc "Hết hàng" (đỏ).
6. Gõ "Số lượng" vượt quá tồn kho đã seed rồi bấm "Lưu đơn nháp" → cảnh báo hổ phách "Kê vượt tồn kho: {tên thuốc} — cần {X}, còn {Y}" hiện đúng, vẫn ký đơn được (mặc định `prescriptionStockBlockEnabled=false`).
7. Bấm "Đơn mẫu" → modal mở, danh sách rỗng lúc đầu → bấm "+ Lưu đơn hiện tại thành mẫu mới" (chỉ hiện khi có `prescription_template.manage`, đơn đang kê có ≥1 dòng) → đặt tên → Lưu → quay lại danh sách thấy mẫu vừa tạo. Mở lại modal ở 1 đơn khác (hoặc xoá dòng rồi mở lại), bấm "Dùng mẫu" → đúng các dòng thuốc của mẫu được chèn thêm vào đơn (không trùng thuốc đã có sẵn).
8. Vào Cấu hình chung (`/admin/system-config`, pill "Cấu hình thanh toán") — khối "Kho Thuốc" có đúng 2 công tắc mới "Có kho thuốc" (mặc định BẬT) và "Chặn kê vượt tồn" (mặc định TẮT, disable khi "Có kho thuốc" đang tắt). Bật "Chặn kê vượt tồn" → quay lại đơn đang vượt tồn ở bước 6, bấm "Ký đơn" → bị chặn lỗi 422 rõ ràng (kiểm UI hiện thông báo lỗi hợp lý, không phải màn trắng/lỗi console khó hiểu). Tắt lại "Có kho thuốc" → quay lại màn Kê đơn, cột tồn kho + mọi cảnh báo `stock_insufficient` biến mất hoàn toàn dù tồn thật đang thiếu. **Nhớ trả 2 công tắc về đúng mặc định (BẬT/TẮT) sau khi test xong** — tenant test dùng chung nhiều phiên.
9. `console --errors` (hoặc tương đương) sạch, không lỗi JS nào phát sinh từ code mới xuyên suốt các bước trên.

## Nếu phát hiện bug lúc verify

Sửa ngay trong cùng phiên (đúng tiền lệ mọi lần verify Playwright trước — luôn phát hiện + sửa 1-2 bug nhỏ), viết thêm test HTTP nếu bug ở backend, rồi verify lại đúng đúng bước đã lỗi trước khi coi xong.

## Sau khi verify xong

- Cập nhật `docs/DECISIONS.md` #190 (hoặc thêm entry mới nối tiếp) — đổi "CHƯA VERIFY PLAYWRIGHT" thành đã xong, liệt kê bug đã sửa nếu có.
- Cập nhật `docs/CHANGELOG.md`/`docs/CURRENT.md`/`docs/TASK.md` (bỏ dòng "còn treo").
- Xoá handoff này (hoặc để nguyên làm lịch sử — tuỳ, các handoff cũ trong `docs/handoffs/` đều được giữ lại làm lịch sử, không xoá).
