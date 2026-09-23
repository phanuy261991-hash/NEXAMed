# Handoff — Công nợ nhà cung cấp (mockup đã duyệt, CHƯA CODE) — chuyển phiên

**Ngày ghi**: 24/09/2026, chuyển phiên theo yêu cầu chủ dự án (không phải vì hết việc/bị chặn). **Trạng thái**: mockup đã duyệt rõ ràng ("mình duyệt mockup" — không phải suy diễn), quyết định nghiệp vụ đầy đủ đã ghi ở `docs/DECISIONS.md` #180, kế hoạch kỹ thuật đầy đủ đã lưu tại `C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md` (máy cục bộ, ngoài repo). **CHƯA VIẾT DÒNG CODE NÀO cho tính năng này** — phiên bị chuyển hướng giữa chừng sang làm "Lịch làm việc của tôi" (đã xong hoàn toàn, xem mục cuối) rồi kết thúc theo yêu cầu chủ dự án.

## Việc kế tiếp — bắt đầu từ đây, theo đúng thứ tự

1. **Đọc lại 3 nguồn trước khi code, không suy diễn lại từ đầu**:
   - `docs/DECISIONS.md` #180 — toàn bộ quyết định nghiệp vụ đã chốt qua `AskUserQuestion` (2 vòng, Q1-Q9): xác nhận mở rộng phạm vi v1 (công nợ PHẢI TRẢ nhà cung cấp — khác hẳn công nợ/trả góp bệnh nhân vẫn ngoài v1); cách trả nợ (trả ngay lúc Duyệt phiếu nhập + trả sau trên TỔNG công nợ, phân bổ FIFO ngầm không cần chọn phiếu nhưng vẫn truy vết được); trả hàng NCC (bắt buộc chọn NCC, giá mặc định = giá vốn lô, phiếu nhập gốc tuỳ chọn); duyệt phiếu chi theo ĐÚNG cấu hình chung `cashVoucherApprovalEnabled` có sẵn; Khai nợ đầu kỳ (không backfill dữ liệu cũ); NCC nợ lại (cho số dư âm, tự cấn trừ hoặc Thu tiền hoàn lại); và đặc biệt **luồng dự phòng sai sót 3 tầng** (Nháp/Chờ duyệt sửa tự do → Huỷ chứng từ đảo bút toán khi hàng chưa dùng → Phiếu điều chỉnh công nợ khi không huỷ được), nguyên tắc "không có nút Sửa trên chứng từ đã duyệt".
   - File kế hoạch kỹ thuật đầy đủ: `C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md` — có sẵn schema 3 bảng mới (`supplier_debt_account`/`supplier_debt_entry`/`supplier_debt_adjustment`), cột mới trên `stock_receipt`/`stock_issue`/`cash_voucher`, thuật toán phân bổ FIFO, tích hợp với `StockReceiptService`/`StockIssueService`/`CashVoucherService` (cần `forwardRef` 2 chiều `cash-book`↔`supplier-debt`, cùng tiền lệ `inventory`↔`encounter` #164), phân quyền (`supplier_debt.read/pay/adjust/approve`), và chia sẵn 4 giai đoạn triển khai A/B/C/D (mục 8) — mỗi giai đoạn code → test HTTP → verify Playwright → cập nhật docs trước khi sang giai đoạn kế tiếp, đúng nhịp độ Kho Thuốc GĐ2-4.
   - Mockup đã duyệt: `https://claude.ai/artifact/WvZtCgwbdEKAb9LcCzyCfh` — đọc lại bằng `Artifact({action:"read", url:...})` trước khi dựng UI. Chủ dự án đã yêu cầu rõ **"bám sát mockup tối đa, làm cho giống đã duyệt"** — không tự sáng tạo lại bố cục.

2. **Bắt đầu code Phần A — "Nền sổ công nợ"** (mục 8 file kế hoạch): 2 bảng `supplier_debt_account`/`supplier_debt_entry` (bảng `supplier_debt_adjustment` để dành Phần D) + cột "Trả ngay" trên `stock_receipt` (`prepaid_amount`/`prepaid_payment_method_code`/`prepaid_cash_account_id`/`prepaid_voucher_id`) + hàm thuần `allocateSupplierDebt()` (FIFO, `packages/core`, có unit test đầy đủ mọi kịch bản) + hook ghi bút toán `PURCHASE`/trả ngay lúc Duyệt phiếu nhập + endpoint "Khai nợ đầu kỳ" + trang chi tiết NCC + cột "Còn nợ" ở danh sách NCC.

3. **Chốt 4 câu hỏi mở (mục 10 file kế hoạch) trước hoặc trong lúc code phần liên quan — KHÔNG tự chọn phương án**:
   - Tự duyệt: người lập phiếu điều chỉnh có quyền duyệt thì có được tự duyệt luôn không (phòng khám nhỏ chỉ 1 quản lý)?
   - Huỷ phiếu nhập đã "trả ngay": giữ nguyên phiếu chi đã sinh (NCC nợ lại phòng khám) hay huỷ kèm luôn?
   - "Đối chiếu & chốt công nợ theo kỳ" (mục 4.3, giống "Khoá bảng ca" #110): làm trong đợt này hay để sau?
   - Quyền mặc định `supplier_debt.*` cho vai trò khác ngoài `clinic_admin` (thủ kho được `read`+`adjust`? thu ngân được `pay`?).

## Việc KHÔNG làm (đã chốt hoặc cố ý hoãn, đừng tự mở rộng)

- KHÔNG hỏi lại "có mở rộng phạm vi v1 không" — đã chốt rõ ở #180 qua `AskUserQuestion`, chỉ cần trích dẫn khi cập nhật `CLAUDE.md`/`docs/product/prd.md` (mục "Vẫn KHÔNG thuộc v1" cần sửa lại làm rõ chỉ loại trừ công nợ BỆNH NHÂN — **việc này CHƯA làm, cần làm khi bắt đầu Phần A**).
- KHÔNG tự chọn phương án cho 4 câu hỏi mở ở mục 3 trên.
- KHÔNG động vào Sổ quỹ/Chốt ca/Báo cáo dòng tiền — thiết kế đã đảm bảo tự nhận phiếu thu/chi mới không cần sửa gì thêm (đúng tiền lệ #136 Ví tạm ứng).

## Phát hiện phụ chưa xử lý (ghi lại để không quên, không liên quan trực tiếp)

- `CashVoucherService.voidVoucher()` có vẻ cho huỷ phiếu nạp/tất toán "Ví tạm ứng" (`PATIENT_ADVANCE`) ở trang "Phiếu thu/chi" chung mà KHÔNG đảo số dư ví theo — ghi ở mục 11 file kế hoạch, **CHƯA kiểm chứng bằng test, chưa sửa**. Có thể tái dùng cơ chế hook (mục 5 file kế hoạch) để vá nếu chủ dự án yêu cầu, nhưng không tự ý sửa khi chưa hỏi (ngoài phạm vi Công nợ NCC).
- Câu hỏi treo thật (Q10 ở #180): làm sao quản lý biết NCC nào cần duyệt khi đang đứng ở màn hình KHÁC trong app (không phải "Công nợ nhà cung cấp")? Rà code xác nhận đây là vấn đề CHUNG của cả app — "Phiếu thu/chi" (Sổ quỹ GĐ1) cũng có `pendingApprovalCount` y hệt nhưng chỉ hiện trong chính trang đó, sidebar (`Sidebar.tsx`) chưa từng có khái niệm badge số. Đã thử 1 phương án (badge số lặp lại ở TÊN NHÓM sidebar "Quản lý nhà cung cấp") nhưng **chủ dự án yêu cầu bỏ, giữ bản cũ** — chưa rõ lý do từ chối cụ thể, chưa có giải pháp thay thế. Để dành bàn riêng (ảnh hưởng rộng hơn 1 tính năng), không tự vá trong lúc code Công nợ NCC.

## Việc khác đã xong trong phiên này (không liên quan Công nợ NCC — đã code/test/verify xong, sắp commit cùng lúc)

"Lịch làm việc của tôi" — redesign lưới tuần Ca × Ngày + widget "Đã đăng ký N/M ca" theo ảnh tham khảo chủ dự án gửi giữa chừng phiên. Đã code, test HTTP (+4 test), typecheck/lint/build sạch, verify Playwright/Chrome thật đầy đủ (lưới, widget, "Nghỉ" theo giờ làm việc, luồng "Chọn nhiều ngày" — kể cả 1 bug thật phát hiện lúc verify đã sửa: thanh chọn ngày bị `SelectionToolbar` nổi đáy trang che mất). Không có việc gì treo cho phần này — xem đầy đủ ở `docs/DECISIONS.md` #181 và `docs/CHANGELOG.md` mục 2026-09-24.
