# HANDOFF — Menu "Phiếu chỉ định" + "Tra cứu kết quả", vá lọc chi nhánh cận lâm sàng, hoàn thiện Đợt 1 chi nhánh — 2026-10-14

> Hội thoại luôn tiếng Việt. Commit + push **thẳng `master`**, KHÔNG tự tạo nhánh/PR. Dựng mockup → chờ chủ dự án "duyệt/chốt" rồi mới code. Mỗi đợt rà soát có bước kiểm tra cô lập tenant. Chủ dự án dặn: sau mỗi đợt chạy lại TOÀN BỘ test và báo kết quả. **Quy tắc thường trực mới (13/10/2026): mọi chức năng mới phải trả lời đủ 4 câu hỏi về chi nhánh — xem `CLAUDE.md` mục Kiến trúc.** Ảnh chụp kiểm tra để ở thư mục tạm, KHÔNG lưu vào repo.

## 0. Trạng thái

- **Tầng chi nhánh Đợt 1 "Nền": XONG** (backend + web + verify Chrome) — `docs/DECISIONS.md` #231. Đợt 2 (tiền, kho, hoá đơn, quỹ, ca thu ngân, đầu phiếu in theo chi nhánh) **chưa làm, cần mockup duyệt trước khi code**. **KHÔNG bật chi nhánh thứ 2 ở khách thật trước khi xong Đợt 2.**
- **Menu "Phiếu chỉ định" + "Tra cứu kết quả": XONG** — `docs/DECISIONS.md` #232. Không migration.
- Kết quả test lần cuối (14/10/2026): **API 83 file / 1398 test pass, core 399, shared 31, web 59; `pnpm -w typecheck` + `lint` sạch.** Cô lập tenant/chi nhánh: `rls-coverage`, `tenant-isolation`, `branch-http`, `paraclinical-lookup-http` (15 test, đã kiểm đột biến) đều pass. Nhớ `pnpm --filter @nexamed/shared build && pnpm --filter @nexamed/core build` trước khi chạy test API.
- Môi trường dev: API cổng 3001 chạy từ `apps/api/dist`, vite 5173 (cả hai khởi động lại bằng tay nếu tắt); tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345` (được gán cả 2 chi nhánh; "Chi nhánh 2" là dữ liệu chủ dự án tạo, đừng sửa). Migration chi nhánh + `db:seed` ĐÃ áp lên DB dev. Quyền mới thêm vào danh mục quyền → bắt buộc `db:seed` + khởi động lại API, và thêm nhãn ở `apps/web/src/features/role/permission-grouping.ts` (test `permission-grouping.spec.ts` chặn).

## 1. Đã làm phiên này

1. **Hoàn thiện web Đợt 1 chi nhánh**: mục "Chi nhánh" ở Cấu hình hệ thống (hiện cả khi 1 chi nhánh), màn "Chọn chi nhánh làm việc", bộ chuyển ở thanh đỉnh (xác nhận khi đang ở màn khám), ô "Chi nhánh làm việc" dạng chip ở form tài khoản, tab Lịch sử khám: cột Chi nhánh + "Cột hiển thị" cho mọi cột (mặc định đúng mockup Màn 4, `table-layout: fixed`).
2. **Trang "Không có quyền xem nội dung này"** (`shared/ui/AccessDeniedState.tsx`, `RecordLoadError.tsx`) thay 404/trang trống ở trang chi tiết lượt khám, phiếu thu, 4 phiếu kho, kết quả cận lâm sàng; có "Quay lại trang trước". `PermissionDeniedPage` dùng chung.
3. **Nhãn bảng phân quyền** cho 6 module cận lâm sàng/bảng giá bị thiếu + test chặn.
4. **Vá lọc chi nhánh cận lâm sàng** (`ResultAccessScope.branchId`; `findQueueItemsByIds/ByOrder/listQueueItems`, ống mẫu, bác sĩ duyệt, chấm số "kết quả mới").
5. **Hai menu mới** (API `GET /clinical-orders`, `GET /paraclinical/{lab,imaging}/results`; web `ClinicalOrderBookPage`, `ClinicalOrderDetailDialog`, `ParaclinicalResultLookupPage`, in nhanh qua `PrintButton renderTrigger`, `SegmentedToggle` dùng chung). Chi tiết quyết định ở #232.
6. Tài liệu: ERD v1.73, data-model, multi-tenancy, security-audit, Deploy, CLAUDE.md, CHANGELOG, CURRENT, TASK, DECISIONS #231 cập nhật + #232 mới.

## 2. Việc kế tiếp (theo thứ tự đề xuất)

1. **Đợt 2 chi nhánh — cần dựng mockup trước, chờ chủ dự án duyệt**: `invoice` (kế thừa chi nhánh lượt khám), `cash_account` (loại tiền mặt), `cashier_shift`, `warehouse` (`branch_id NOT NULL`, mỗi chi nhánh 1 kho mặc định, kho hiện có gán chi nhánh mặc định), đầu phiếu in lấy tên/địa chỉ/SĐT chi nhánh của lượt khám. Chủ dự án đã chốt: **cho phép điều chuyển kho giữa hai chi nhánh** (người ở chi nhánh nhận phải thấy phiếu "đang đến" để xác nhận); danh mục thuốc, NCC, công nợ NCC, ví vẫn chung cả công ty; cảnh báo kê vượt tồn chỉ cộng tồn kho của chi nhánh. Nên diễn tập migration trên bản sao DB dev (`CREATE DATABASE nexamed_migtest TEMPLATE nexamed`, cần dừng API) như Đợt 1. Sau Đợt 2: trang phiếu thu mở phiếu chi nhánh khác phải trả 404 (hiện trả "chưa có phiếu").
2. Đợt 3 báo cáo nhiều chi nhánh; Đợt 4 SaaS (đăng nhập chọn công ty, cấp tenant tự động).
3. Còn treo cũ: CSP `Report-Only` ở `deploy/on-prem/nginx.conf`; kiểm kết quả CI GitHub (không có quyền từ CLI); dựng lại gói on-prem (đang `2026.10.08.3`).

## 3. Bẫy kỹ thuật đã gặp (tránh lặp lại)

- Heredoc bash chứa dấu backtick/backslash/tiếng Việt dài hay **hỏng im lặng** (mất `\`, cắt cụt file) → ghi script bằng công cụ Write rồi chạy; kiểm lại file sau khi sinh. `sed -i` với backtick từng chèn dấu vào đầu mọi dòng.
- Máy không có Python. Playwright-core cài ở thư mục tạm của phiên (mất khi sang phiên mới → `npm i playwright-core@1.49` ở thư mục tạm); Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`; đăng nhập rate-limit 10/phút/IP.
- Kiểm tra thủ công qua HTTP: `GET /users` bỏ qua `q` và phân trang 20/trang (cursor) — dọn dữ liệu thử phải quét hết trang và lọc ĐÚNG tiền tố (`zztest.`), in danh sách trước khi sửa.
- Trigger DB chặn thêm chỉ số vào kết quả ĐÃ KÝ và ràng buộc `clinical_order_item_pricing_check` (dòng lẻ tại phòng khám bắt buộc có đơn giá) → khi dựng dữ liệu test qua Prisma: tạo nháp, thêm chỉ số, rồi mới ký.
- API test chạy ~7 phút (`cd apps/api && pnpm exec vitest run`); 2 test (`invoice-refund-http` đồng thời, dọn dữ liệu `supplier-warehouse-http`) từng lỗi chập chờn khi chạy cả bộ, chạy riêng đều pass.
