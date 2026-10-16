# HANDOFF — Màn đăng nhập mới, kiểm đa kích thước màn hình, chuẩn độ đậm chữ, ConfirmDialog, khoá đăng nhập luỹ tiến, phương án mã đơn thuốc — 2026-10-16

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`** (không nhánh/PR), CHỈ khi chủ dự án bảo. Mockup mới phải được "duyệt"/"chốt mockup" rõ ràng trước khi code. Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh. **Từ nay mọi UI mới phải theo `.claude/docs/ui-guidelines.md` mục 15 (kiểm 1280/1366/1536/1920/2560/3440) và mục 16 (độ đậm TỐI ĐA semibold — ESLint chặn `font-bold`).**

## 0. Trạng thái một câu

Phiên 16/10/2026 làm xong và đã commit + push: (a) S6-04 công cụ đo tải `perf:load`; (b) khoá đăng nhập luỹ tiến → vĩnh viễn + "Mở khoá" (#239); (c) màn đăng nhập mới (cửa sổ nổi + nền biểu tượng y khoa lơ lửng, đếm lùi khi khoá, Caps Lock, responsive 1 cột dưới 900px); (d) kiểm giao diện toàn app 53 trang × 10 cỡ màn hình; (e) **chuẩn độ đậm chữ** (792 chỗ `font-bold`→`font-semibold`, ESLint chặn, CSS nền hạ `<b>/<strong>/<th>`); (f) **`ConfirmDialog`** dùng chung thay hộp xác nhận kiểu cũ (đã chuyển nhóm ngưng/ẩn/xoá, nhập lý do, huỷ/trả lượt khám; còn 9 hộp, mục 2); (g) sửa nhãn khối bị cắt ở 7 hộp thoại, đổi tên menu "Danh mục Cận lâm sàng", sửa cột bị cắt ở Điều chuyển kho; (h) **phương án mã đơn thuốc theo Bộ Y tế** viết xong ở `docs/product/prescription-code-moh.md` — CHƯA code, chờ chủ dự án chốt 8 câu.

## 1. Kiểm chứng đã làm

- Test: API 1497 (93 file), core 443, shared 31, web 116 (lần chạy cuối web/core 16/10; API chạy lần cuối sau khi thêm `retryAfterSeconds`); lint toàn repo + typecheck sạch.
- Chrome thật: các luồng đăng nhập (sai/khoá 5 phút + đếm lùi/khoá vĩnh viễn/mất mạng/đúng, Caps Lock bằng sự kiện có cờ), nút Mở khoá, hộp thoại Sửa hồ sơ bệnh nhân, 14 cỡ màn hình cho trang đăng nhập, 53 trang × 10 cỡ cho toàn app (`scripts/ui-audit/`).
- **Chưa kiểm bằng mắt** các hộp xác nhận vừa chuyển sang `ConfirmDialog` (chỉ Mở khoá đã chụp; còn lại mới qua typecheck/lint).

## 2. VIỆC CÒN DỞ (làm tiếp theo thứ tự này)

**A. Chuyển nốt 9 hộp xác nhận cũ sang `ConfirmDialog`** (tìm `max-w-sm rounded-lg bg-white p-5 shadow-xl`): `features/billing/InvoiceDetailPage.tsx` (2 chỗ ~1037, ~1083), `features/paraclinical-result/ParaclinicalAmendDialogs.tsx:81`, `features/patient/MedicalRecordExportDialog.tsx:30`, `features/patient-wallet/SettleWalletDialog.tsx:68`, `features/reception/ReceptionIntakeForm.tsx` (2 chỗ ~1270, ~1289), `features/role/RolePermissionPane.tsx:380` (form tên vai trò — dùng form dựng riêng với ô nhập), `features/user-account/UserAccountPane.tsx:395` (`ResetPasswordDialog` — có ô mật khẩu). Quy tắc chữ: tiêu đề = TÊN HÀNH ĐỘNG ngắn (không hỏi "…?"), đối tượng vào `rows`, hậu quả = MỘT câu `note`. Mẫu: `shared/ui/ConfirmDialog.tsx`, `shared/ui/ReasonConfirmDialog.tsx`. Sau đó chụp ảnh Chrome vài hộp (xoá/ẩn, từ chối có lý do, huỷ lượt khám, trả về hàng chờ).

**B. Lỗi bố cục còn lại từ lượt kiểm đa kích thước** (chi tiết `docs/DECISIONS.md` #240):
1. **Mẫu in ở 1280px** (`features/print-template/PrintTemplatePreviewPanel.tsx`): khung xem trước cắt mép phải tờ giấy (mức thu/phóng mặc định 75% rộng hơn panel ~340px) và thanh "− 75% +" chật. Đề xuất: tự vừa khổ giấy bằng `ResizeObserver` (hàm thuần `fitPreviewZoom(availablePx, paperWidthMm)` chọn bậc `ZOOM_STEPS` lớn nhất ≤ vừa khít, có test), người dùng bấm +/− thì chuyển sang chế độ tay; header `whitespace-nowrap`, ẩn nhãn "Dữ liệu mẫu" dưới 1440px.
2. **Phiếu nhập kho chi tiết `/inventory/receipts/:id` ở 1280–1536px**: vùng `overflow-x-hidden` rộng 1296 > 1250 (phần tử "PDC2610000001 Kho chính…" tức phiếu nhập sinh từ điều chuyển kho). CHƯA tái hiện được trên dữ liệu dev hiện tại — mở một phiếu nhập có mã `PDC…` (lấy từ một phiếu điều chuyển hoàn tất), đo bằng `scripts/ui-audit/layout-audit.cjs` (`ONLY=inventory/receipts/...`) rồi đổi cột px cứng sang `minmax` ở `StockReceiptFormPage.tsx` (`lineGridCols`).
3. **Máy tính bảng dọc 768px**: thanh đường dẫn đầu trang (`TopBar`/breadcrumb, `div.flex.min-w-0.flex-1`) bị cắt ~20px ở hầu hết trang — cần `truncate`; `/patients` bảng cắt, `/cash-book/report` và `/suppliers/:id` ở 1024px cắt vài chục px. Ứng dụng nhắm tới máy tính, mức ưu tiên thấp.
4. **Màn rất rộng (3440px)**: bảng `/patients` giãn hết bề ngang, cột "Họ tên" và "Địa chỉ" cách xa dữ liệu. Đề xuất giới hạn bề rộng nội dung (`max-w` ~2200px căn giữa ở `AppShell` vùng `<main>`) hoặc đặt trần cho các cột `1fr` (`GRID_COLUMNS` ở `PatientListPage.tsx`); kiểm thêm các bảng khác ở 2560/3440.

**C. Chạy lại bộ kiểm sau khi xong A, B**: `node scripts/ui-audit/layout-audit.cjs` và `weight-audit.cjs` (mong đợi 0 vấn đề ở ≥1366px và không có độ đậm ≥ 700); xem README ở thư mục đó.

**D. Soi lại phân cấp sau chuẩn độ đậm**: tên chính và nhãn đều semibold nên một số khối có thể mất tương phản — nếu chủ dự án thấy phẳng, nâng cỡ chữ/đổi màu (KHÔNG tăng độ đậm). Kiểm các trang: Chi nhánh, Nhà cung cấp, Danh sách bệnh nhân, Hoá đơn chi tiết, Màn khám.

**E. Mã đơn thuốc theo Bộ Y tế** (`docs/product/prescription-code-moh.md`): chủ dự án chốt 8 câu ở mục 7 của tài liệu → mockup (cấu hình mã chế độ chuẩn, xem trước "sẽ ký thành N đơn", cờ thuốc cổ truyền) → code GĐ1 (mã KCB theo chi nhánh + token + chế độ chuẩn + cột `national_code`/`prescription_kind`) → GĐ2 (cờ `drug.is_traditional`, tách đơn khi ký, bảng `prescription_document`) → GĐ3 (port liên thông + outbox, chưa gửi thật). **Đừng code trước khi chốt** (đụng schema, in đơn, kho, đính chính).

**F. Việc treo cũ**: S6-04 chạy `perf:load` trên máy chủ pilot thật (`docs/Deploy.md` 2.5a); S6-02; BHYT (S2-04); phát hành `1.0.0` sau pilot; ảnh nền đăng nhập do phòng khám tự tải (câu 7 trong mockup — chưa làm, ẩn); chọn nhà cung cấp hạ tầng SaaS (chờ báo giá). Gói on-prem CHƯA dựng lại cho các thay đổi này (đúng quy ước chỉ dựng khi sắp giao khách).

## 3. Bẫy đã gặp / điều cần biết

- **Tailwind v4**: `md:max-w-*` và `min-[1920px]:max-w-*` xếp chồng thì `md:` ĐÈ do thứ tự CSS — dùng biến CSS (`--login-w`) hoặc biến thể tuỳ biến. Mốc `desktop:` (≥900px VÀ ≥560px cao) khai bằng `@custom-variant` ở `app/index.css`.
- **ESLint chặn `font-bold/extrabold/black`** (kể cả trong template string) — bản in (`*PrintView.tsx`, `shared/print/PrintDocument.tsx`, `PrintDocumentPreview.tsx`) được miễn. Nhãn khối nhô lên (`-top-3` của `BoxedSection`/`sectionBadgeClassName`) bị CẮT nếu vùng cuộn cha không có lề trên — thêm `pt-4`.
- **Công cụ Bash**: heredoc/`node -e` làm mất dấu `\` và hỏng regex — viết script bằng công cụ Write rồi chạy; tên đường dẫn `/xyz` truyền làm đối số bị Git Bash đổi thành `C:/Program Files/Git/xyz` (dùng không có `/` đầu). Tài liệu `docs/*.md` và nhiều file mã dùng CRLF — script vá phải đọc, đổi `\r\n`→`\n`, sửa, ghi lại đúng kiểu.
- **Chạy nền**: không chạy hai bản `layout-audit` song song (refresh token xoay vòng → phiên bị thu hồi). `pkill` không dừng được tiến trình Windows — dùng PowerShell `Get-CimInstance Win32_Process`/`Stop-Process`.
- Đăng nhập giới hạn 10 lần/phút/IP; tìm bệnh nhân 50 lần/phút/IP — giữ nguyên theo chủ dự án, theo dõi khi pilot thật có nhiều máy chung IP.
- Tenant test dev còn ~3.020 bệnh nhân "PERFLOAD…" và vài tài khoản "unlockui…" đã vô hiệu hoá (hệ thống không xoá được).
- Dev: `pnpm dev` (web 5173 + API 3001); tài khoản `dev.admin` / `Dev@12345` ở tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`. Môi trường khác cần `db:deploy` + `db:seed` (migration `20261016100000_staff_progressive_lockout`, quyền `user_account.unlock`).

## 4. Tài liệu đã cập nhật phiên này

`docs/DECISIONS.md` #239 (khoá luỹ tiến) và #240 (đăng nhập mới + kiểm đa kích thước + chuẩn độ đậm + ConfirmDialog), `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/CURRENT.md`, `docs/ERD.md` (v1.76), `docs/Deploy.md` (2.5a), `docs/GA-checklist.md`, `docs/product/prescription-code-moh.md` (mới), `.claude/docs/ui-guidelines.md` (mục 15, 15b, 16), `.claude/docs/security-audit.md`, `.claude/docs/data-model.md`, `scripts/ui-audit/` (mới). Memory: `feedback_font_weight_scale.md`, `feedback_test_multiple_screen_sizes.md`.
