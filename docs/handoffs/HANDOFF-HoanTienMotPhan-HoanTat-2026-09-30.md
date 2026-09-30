# HANDOFF — Hoàn tiền MỘT PHẦN: HOÀN TẤT + đã gộp vào `master` — 30/09/2026

> Thay thế `HANDOFF-HoanTienMotPhan-2026-09-30.md` (file đó chỉ còn giá trị lịch sử). Phiên sau bắt đầu từ mục 4 "Việc tiếp theo".

**Tóm tắt 1 câu**: #201 (in gộp), #202 (`invoiceId` cho thao tác ghi), #203 (hoàn tiền một phần theo dòng thuốc) và #204 (xử lý 4 điểm hở) đều xong, đã test + verify Chrome thật và đã gộp vào `master` (commit gộp `1689810`, đã push).

## 1. Đã làm trong phiên này
- **#203 Hoàn tiền một phần theo dòng thuốc** — `InvoiceRefundService` + `POST /billing/invoices/:encounterId/refund-items` (quyền `invoice.refund_drug`, mặc định lễ tân + quản trị); 2 bảng `invoice_refund`/`invoice_refund_line` + `payment.refund_id` (migration `20260930100000_invoice_partial_refund`); hoàn về ví trước rồi tiền mặt/CK; tuỳ chọn nhập lại kho (phiếu `RETURN_FROM_USE` tự sinh). Sửa `revertPayment` (chặn khi đã hoàn — 409 `INVOICE_HAS_REFUNDS`) và `refund()` toàn phần (chỉ hoàn phần còn lại). Web: `RefundDrugItemsDialog.tsx` (dạng BẢNG, "Nhập lại kho" **mặc định bật**, có dải tổng + chia ví/tiền mặt), khối "Đã hoàn một phần", cột "Đã hoàn" ở Thu ngân, bản in có "Đã hoàn/Thực thu".
- **#204 Điểm hở**: (1) popup "Mở ca" khi hoàn tiền mặt — verify UI xong; (2) "Phiếu trong ca của tôi" dựng từ dòng `payment` qua `GET /cashier-shifts/:id/invoice-payments`; (3) tổng kết ngày Thu ngân **giữ nguyên theo ngày tiếp nhận** (chủ dự án chọn); (4) phiếu nhập hoàn trả lập tay có "Phiếu xuất gốc" không nhập vượt số đã xuất (422).
- Tài liệu đã cập nhật: `docs/DECISIONS.md` #203/#204, `docs/ERD.md` (v1.61), `CHANGELOG`, `TASK`, `CURRENT`, `.claude/docs/clinical-workflow.md`, `CLAUDE.md`.

## 2. Trạng thái hiện tại
- Nhánh `master` = `origin/master` (`1689810`), sạch. Nhánh `feat/hoan-tien-mot-phan` và `fix/diem-ho-hoan-tien-mot-phan` đã gộp, còn tồn tại (xoá được).
- Test lần cuối: `apps/api` 1105/1105, `packages/core` 274/274, `packages/shared` 31/31, `apps/web` 5/5; `pnpm -w typecheck/lint/build` sạch (lint còn 8 cảnh báo cũ, 0 lỗi).
- **DB dev đã áp migration + seed.** Môi trường khác cần: `pnpm --filter @nexamed/api run db:deploy` rồi `db:seed` (permission mới `invoice.refund_drug`).
- **Dev server có thể còn chạy** (API 3001, web 5173) — tắt nếu không dùng. `apps/web/public/config.json` trỏ API `localhost:3001` + tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (`dev.admin` / `Dev@12345`).
- Dữ liệu thử còn lại ở tenant test (bệnh nhân "Phạm Quốc Bảo", nhiều hoá đơn thuốc/ví, NCC "NCC Refund…") — vô hại, đừng dọn bằng SQL role `nexamed` (xem quy tắc dưới).
- `dev.admin` đang có ca thu ngân mở từ 28/09 (banner đỏ "ca mở quá lâu" ở Thu ngân) — dữ liệu của chủ dự án, không tự đóng.

## 3. Đã kiểm gì / chưa kiểm gì
- Đã: 16 test HTTP hoàn tiền (kiểm đột biến 2 chỗ), test endpoint ca (4), test cận trên nhập hoàn trả (1), boot DI `billing ⇄ inventory` (`forwardRef`), Chrome thật cho dialog/khối đã hoàn/bản in/danh sách/popup Mở ca/danh sách ca.
- Chưa: bấm hoàn tiền thật qua UI với hoá đơn có chiết khấu từng dòng (chỉ test HTTP); in PDF thật (máy thiếu poppler, chỉ xem ảnh `emulateMedia print`).

## 4. Việc tiếp theo (theo tài liệu, chưa ai giao)
1. **Chuẩn bị pilot**: S6-02 (diễn tập phục hồi trên máy chủ pilot thật) và S6-04 (đo p95 API trên cấu hình pilot thật) — 2 việc còn chặn điều kiện GA v1, cần phòng khám pilot cụ thể.
2. **S2-04 thẻ BHYT** (mã hoá số thẻ bằng `pii-encryption.ts`, hiển thị, không tính chi trả) — đã lùi từ Sprint 2.
3. **PRE-02** nâng cảnh báo trùng hoạt chất sang so theo mã (cố ý hoãn vì đụng luồng kê đơn đang chạy thật; dữ liệu nền `drug_ingredient` đã có).
4. Nhỏ/chờ chủ dự án quyết: toast "còn thuốc chưa tự phát được" sau khi ký đơn; trường VTYT riêng (#151); tổng kết ngày Thu ngân theo ngày thu/hoàn thật (đã chọn giữ nguyên — chỉ bàn lại nếu chủ dự án đổi ý).
→ Hỏi chủ dự án chọn hướng trước khi bắt đầu, và **đọc ERD/data-model/ui-guidelines đúng phần cần** (CLAUDE.md).

## 5. Bẫy đã gặp (đừng lặp lại)
- `timeout N node …` trong Git Bash **không kill** tiến trình node trên Windows → cổng 3001 bị giữ, `pnpm dev` báo `EADDRINUSE`. Kiểm bằng `Get-NetTCPConnection -LocalPort 3001` rồi `Stop-Process`.
- Máy **không có `gh` CLI**, GitHub MCP chưa được cấp quyền → không tạo PR từ đây; phiên trước gộp bằng `git merge --no-ff` cục bộ rồi push theo yêu cầu chủ dự án.
- Heredoc bash chứa nhiều dấu nháy/tiếng Việt dễ vỡ ("unexpected EOF") → dùng công cụ Write cho file `.tsx`/`.mjs` dài. File repo có thể là CRLF — script sửa file nên chuẩn hoá `\r\n`↔`\n`.
- Sửa `packages/core`/`shared` xong phải `pnpm --filter … build` trước khi typecheck `apps/api`/`web` (đọc `dist`).
- Test "Chốt ca": mở ca phải khớp vốn đầu ca (`previousClosedShift.keepForNextAmount`), lệch sẽ đòi lý do chênh lệch (400).
- Cấu hình hiện tại **1 két dùng chung** → mọi tài khoản coi như "có ca" của `dev.admin`; muốn thử cổng "Mở ca" phải bật tạm `cashierShiftMultiCashierEnabled` rồi khôi phục (đã làm và khôi phục).
- Lễ tân mặc định không có `cashier_shift.*` → cổng ca bị bỏ qua (thiết kế có sẵn).

## 6. Quy tắc làm việc của chủ dự án (nhắc lại)
Hội thoại **tiếng Việt**; báo trước khi code và **chờ "duyệt" rõ ràng** với mockup/thiết kế mới; không mutate dữ liệu bằng role `nexamed` (BYPASSRLS) — dựng dữ liệu qua HTTP API bằng `dev.admin`; `config.json` giữ tenant test cố định; commit/push/gộp chỉ khi được bảo; dùng `Button` dùng chung, form bọc `<form>` (Enter-to-submit), không `font-extrabold` cho tên; giao diện phải đồng nhất token/component sẵn có (chủ dự án từng phản hồi "AI look" với thẻ lồng thẻ + khung tím — ưu tiên bảng có đường kẻ).

## 7. Cập nhật cuối phiên (sau khi viết file này)
Thêm các commit giao diện đã push lên `master`: dialog "Đổi bác sĩ phụ trách" (rộng hơn, chọn Khoa bằng thẻ), ô "Chẩn đoán bệnh (ICD-10)" nổi bật ở màn khám, cùng tài liệu `docs/DECISIONS.md` #205 + `.claude/docs/ui-guidelines.md` mục 12 (quy tắc: không thanh tiêu đề tô đặc, danh sách ngắn dùng thẻ chọn, dialog nhiều dòng dạng bảng). Dev server có thể vẫn đang chạy (3001/5173).
