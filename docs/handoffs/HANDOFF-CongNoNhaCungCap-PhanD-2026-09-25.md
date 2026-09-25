# Handoff — Công nợ nhà cung cấp, Phần A+B+C ĐỀU ĐÃ HOÀN TẤT 100% (đã commit + push) — chuyển phiên, sắp sang Phần D

**Ngày ghi**: 25/09/2026, chuyển phiên theo yêu cầu chủ dự án (không phải vì hết việc/bị chặn) — Phần C vừa verify Playwright xong, đã commit + push, đang ở điểm dừng tự nhiên trước khi sang Phần D. Tiếp nối trực tiếp `docs/handoffs/HANDOFF-CongNoNhaCungCap-PhanC-2026-09-25.md` (phiên trước, dừng ở code+test HTTP, chưa verify Playwright) — phiên này làm nốt việc kế tiếp của handoff đó (verify Playwright), rồi chủ dự án tranh thủ phản hồi UI trực tiếp qua `pnpm dev` song song lúc verify.

## Việc đã xong trong phiên này

1. **Verify Playwright Phần C — 100% xong** (xem đầy đủ `docs/DECISIONS.md` #186): cài `playwright-core` tạm (đã gỡ lại trước khi kết thúc phiên, không commit — đúng quy ước "chỉ cài tạm mỗi phiên"), setup dữ liệu test qua HTTP API (`dev.admin`) trên tenant test — 1 mặt hàng quản lý theo lô mới (`DRG-PHANC01`) + 2 Phiếu nhập kho PURCHASE đã Duyệt cho NCC00001 (1 phiếu chiết khấu dòng 10%, 1 phiếu không) + NCC00003 khai nợ đầu kỳ ÂM (-800.000đ) để có `balance<0` test "Thu tiền hoàn lại". 2 script Playwright (headless Chrome thật) đi qua ĐÚNG UI thật cho cả 4 kịch bản — **13/13 assertion PASS, 0 lỗi console**:
   - (a) Trả hàng KHÔNG chọn "Phiếu nhập gốc" → giá tự mồi đúng giá vốn lô (100.000đ), sửa tay được, Duyệt → công nợ giảm đúng.
   - (b) Trả hàng CÓ chọn "Phiếu nhập gốc" — đổi từ phiếu không chiết khấu sang phiếu có chiết khấu 10% → giá dòng tự XOÁ về rỗng đúng thiết kế → để trống, Duyệt → giá tính ra ĐÚNG sau chiết khấu (90.000đ/đơn vị, khác giá vốn lô thô 100.000đ) — xác nhận qua API, không suy luận.
   - (d) Huỷ phiếu trả đã Duyệt ở (a) → tồn kho đảo đúng (+5) NHƯNG công nợ GIỮ NGUYÊN — đúng đặc tả có chủ đích (không phải bug).
   - (c) "Thu tiền NCC hoàn lại" khi `balance<0` → nút chỉ hiện đúng lúc âm, lập phiếu 300.000đ → balance tăng đúng, nút vẫn hiện vì còn âm.
   - **Phần C coi như hoàn tất 100%** (schema, backend, frontend, test HTTP, verify Playwright).
2. **Loạt polish UI ngoài kế hoạch** (chủ dự án phản hồi trực tiếp qua ảnh chụp lúc dùng `pnpm dev` song song): sửa `StatCardRow` bị kẹt `flex-1` trong layout cột ở `SupplierDetailPage.tsx` (KPI bị kéo giãn quá to); đổi `PaymentDialog`/`RefundDialog` sang bố cục ngang `max-w-2xl` (2 cột); thêm `p-6` còn thiếu ở trang chi tiết NCC; sửa breadcrumb bị TREO tên trang cũ (trang thiếu `useBreadcrumb(...)`, đúng lỗi đã ghi ở `ui-guidelines.md` mục 8.3); làm đẹp nút "← Nhà cung cấp" (chủ dự án xác nhận GIỮ nút này dù theo mục 8.2 breadcrumb đáng lẽ đã đủ thay thế); sửa icon+tên lệch dòng (`items-start`→`items-center`); **trích xuất `shared/ui/TabBar.tsx` dùng chung** (trùng lặp lần 4) — đổi kiểu tab gạch-chân sang nền-đặc (`bg-blue-50`) đồng bộ CẢ 4 nơi (`SupplierDetailPage`/`CashierShiftListPage`/`InvoiceListPage`/`DrugCatalogPane`, chủ dự án xác nhận qua `AskUserQuestion`); thêm dialog "Xem nhanh" tại chỗ cho tab "Phiếu trả hàng"/"Thanh toán" (tái dùng `StockIssueDetailDialog`/`CashVoucherDetailDialog` có sẵn, không viết mới); nới `CashVoucherDetailDialog` (dùng chung toàn app) từ `max-w-2xl`→`max-w-3xl` vì 1 dòng bị wrap 2 dòng lệch nhịp.
3. **Đổi quy trình tenant test theo yêu cầu trực tiếp của chủ dự án**: `apps/web/public/config.json` (không track git) từ nay LUÔN giữ nguyên trỏ tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` — **KHÔNG còn tự động trả về tenant thật cuối phiên** như quy tắc cũ học từ sự cố #166. Đã lưu vào memory hệ thống (`feedback_fixed_test_tenant.md`) để các phiên sau tự áp dụng đúng, không cần hỏi lại. Muốn xem dữ liệu thật qua `pnpm dev` thì chủ dự án tự đổi tay `config.json` lúc cần.
4. **Đã xác minh thật**: `pnpm --filter @nexamed/web run typecheck/build` sạch (không cảnh báo chunk size, `index` 197.48 kB + `vendor` 339.37 kB), `pnpm -w run lint` chỉ còn 8 warning cũ có sẵn không liên quan (0 lỗi). Không đụng backend nên KHÔNG re-run 991 test `apps/api` (chỉ đổi `apps/web`).
5. **Đã cập nhật tài liệu**: `docs/DECISIONS.md` (#186, chi tiết đầy đủ), `docs/CHANGELOG.md` (mục 2026-09-25 "phiên mới"), `docs/CURRENT.md` (đoạn Phần C sửa thành "ĐÃ HOÀN TẤT 100%", bản ghi cũ giữ lại bên dưới làm lịch sử), handoff Phần C cũ đánh dấu "ĐÃ HOÀN TẤT" ở đầu file, tiêu đề `C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md`.
6. **Đã commit + push**: commit `49583a6` "feat(web): Cong no nha cung cap Phan C - verify Playwright + polish UI" trên `master`, đã push lên `origin/master` thành công (theo yêu cầu trực tiếp "commit và push đi").

## Việc kế tiếp — theo đúng thứ tự

1. **Phần D — Luồng xử lý sai sót** (mục 8 kế hoạch kỹ thuật `supplier-debt-cong-no-ncc.md`): Huỷ chứng từ (đảo bút toán công nợ ĐỒNG BỘ cho CẢ 2 lỗ hổng có chủ đích đang tồn tại — `StockReceiptService.voidReceipt()` từ Phần A và `voidIssue()` cho `RETURN_TO_SUPPLIER` từ Phần C, cả hai hiện KHÔNG đảo công nợ, chỉ đảo tồn kho) + Phiếu điều chỉnh công nợ (hàng đã dùng một phần, không huỷ được) + Đề nghị huỷ (không có quyền duyệt) + phân vai duyệt. **Chưa có mockup/kế hoạch kỹ thuật chi tiết cho riêng Phần D** — đọc lại mục 8 kế hoạch trước, hỏi/xác nhận với chủ dự án các điểm chưa rõ trước khi dựng mockup/code (đúng nhịp độ dự án — luôn hỏi trước khi làm UI mới).
2. Sau Phần D → **Phần E — Đối chiếu & chốt công nợ theo kỳ** (CHƯA có mockup, phải dựng Artifact riêng trước khi code, đúng khuôn "Khoá bảng ca" #110).
3. **Môi trường dev**: lúc kết thúc phiên trước, `pnpm dev` (API cổng 3001) đã không còn phản hồi (process bị dừng cùng phiên) — web (cổng 5173) vẫn còn sống độc lập lúc kiểm tra đầu phiên này nhưng KHÔNG đáng tin cậy, nên chạy lại `pnpm dev` từ đầu trước khi làm bất kỳ việc gì cần trình duyệt/API thật.

## Việc KHÔNG làm (đừng tự mở rộng)

- KHÔNG bắt đầu code Phần D trước khi đọc lại mục 8 kế hoạch kỹ thuật + xác nhận với chủ dự án các điểm chưa rõ (đặc biệt: cơ chế "Sao chép thành phiếu mới" và phân vai duyệt/đề nghị huỷ — 2 khái niệm mới hoàn toàn so với Phần A/B/C).
- KHÔNG tự trả `config.json` về tenant thật nữa — quy tắc đã đổi, xem mục 3 trên + memory `feedback_fixed_test_tenant.md`.
- KHÔNG quên đăng ký route mới vào `apps/api/scripts/generate-openapi.ts` khi thêm endpoint Phần D.

## Phát hiện phụ chưa xử lý (từ các handoff trước, vẫn còn treo, không liên quan trực tiếp)

- `CashVoucherService.voidVoucher()` có thể không đảo số dư "Ví tạm ứng" khi huỷ phiếu nạp/tất toán (`PATIENT_ADVANCE`) — chưa kiểm chứng bằng test, chưa sửa, ngoài phạm vi Công nợ NCC.
- Q10 (#180): chưa có cơ chế badge "chờ duyệt" hiển thị được ở MỌI trang trong app — để dành bàn riêng.

## Trạng thái Git lúc ghi file này

Nhánh `master`, **đã đồng bộ `origin/master`** — commit `49583a6` đã push xong (toàn bộ thay đổi Phần C verify + polish UI). Working tree sạch, không có gì chưa commit. File handoff này ghi SAU khi đã push — sẽ commit riêng (đúng tiền lệ tách commit `docs` cho file handoff).
