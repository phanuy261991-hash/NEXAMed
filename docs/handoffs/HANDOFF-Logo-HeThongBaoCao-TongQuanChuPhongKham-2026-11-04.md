# HANDOFF — Logo thương hiệu (#281) + Hệ thống báo cáo Đợt 0 và Tổng quan chủ phòng khám (#282) — 2026-11-04

> Hội thoại luôn tiếng Việt. Commit/push thẳng `master` (không PR). Trước khi push: `pnpm typecheck` + `pnpm lint` + test liên quan; full API ĐÚNG 1 lượt (tắt dev server trước). Chữ giao diện ngắn, không viết HOA nhấn mạnh. Mockup phải được duyệt bằng chữ "duyệt/chốt" rõ ràng mới code. Kiểm Chrome thật qua IP LAN HTTP, không chỉ localhost.

## Trạng thái một câu
**Mọi việc của phiên đã commit và push lên `master`.** Logo/favicon (#281) xong, CI xanh (`eedf473`). Hệ thống báo cáo: **Đợt 0 xong** (`4e9269a`) và **Đợt 1 lát 1 = Trang Tổng quan chủ phòng khám xong** (#282, commit ngay sau file bàn giao này). Không có việc dở giữa chừng. Việc kế tiếp: lát Tổng quan **thu ngân → lễ tân → bác sĩ**, rồi **Báo cáo ngày + nhóm menu "Báo cáo"**.

## 1. Đã làm trong phiên

### 1a. Logo, favicon thương hiệu mới (#281, `eedf473`, CI xanh)
- Favicon NEXAMed (SVG/ICO/PNG/apple-touch-icon) ở `apps/web/public/`; bộ logo ở `apps/web/public/brand/` (`nexamed-icon(-inverse).svg`, `nexamed-logo-horizontal(-white).svg`).
- **Logo chính** (`tenant.logo_key`) hiện ở đầu thanh menu, đặt thẳng lên nền tối (không dải/ô trắng — chủ dự án chê); chưa tải thì logo NEXAMed bản nền tối; menu thu gọn = biểu tượng N+. Màn đăng nhập dùng logo NEXAMed CỐ ĐỊNH (không đổi theo phòng khám). Khung xem trước logo chính ở trang cấu hình có nền tối. Ghi chú cho khách: logo ngang 480×120px, chữ sáng, nền trong suốt.
- **Logo mẫu in** (`print_logo_key`): nhận cả logo ngang dài (cao 64px, rộng tối đa 45% tờ); **PDF bệnh án / In bộ hồ sơ nhúng logo** (data URI) khi mẫu in Bệnh án bật "Hiện logo". Tem nhãn thuốc KHÔNG có logo (chủ dự án chốt).
- `GET /clinic-profile/print-header` có thêm `logoUrl` (mọi vai trò đọc được); URL ảnh ổn định theo mốc 15 phút; tải logo xong làm mới cache `print-header` (lỗi cũ: menu không tự đổi). Trang Thông tin phòng khám xếp lại cột dưới 1280px. Có test cô lập logo giữa hai công ty.
- Chi tiết: `docs/DECISIONS.md` #281, `docs/CHANGELOG.md` 2026-11-03.

### 1b. Hệ thống báo cáo — Đợt 0 (`4e9269a`)
- Ghi phạm vi báo cáo vào `CLAUDE.md`, `docs/product/prd.md`, `docs/product/plan.md`.
- `packages/core/src/date/vietnam-period.ts`: mốc đầu/cuối ngày VN, kỳ ngày/tuần/tháng/quý/năm, kỳ trước, cùng kỳ tháng trước, liệt kê ngày (DÙNG LẠI `addDaysToDateString`/`diffDateStrings` ở `encounter/follow-up-date` và `vietnamDateOf` ở `prescription-interop/submission`, không nhân bản). Đã thay 7 chỗ viết cứng `+07:00`; **cấm viết cứng `+07:00` mới**.
- `apps/api/src/common/report-excel-header.ts` (`addReportExcelHeader`): đầu chuẩn cho bản Excel báo cáo MỚI (chưa áp cho 2 báo cáo cũ — để nguyên).

### 1c. Đợt 1 lát 1 — Tổng quan CHỦ PHÒNG KHÁM (#282)
- `GET /api/v1/reports/dashboard/owner?period=today|week|month`, quyền mới **`dashboard.owner`** (mặc định `clinic_admin`; **môi trường khác phải `pnpm --filter @nexamed/api run db:seed`**). Module `apps/api/src/modules/report/` (chỉ ĐỌC; `DashboardRepository` SQL phẳng, `DashboardService`, controller). Tính toán thuần: `packages/core/src/report/dashboard-math.ts`. Schema: `packages/shared/src/report-dashboard.ts`.
- Web: `features/dashboard/` (`OwnerDashboardPage`, `dashboard-model`, hook, api), `shared/ui/ReportPanel.tsx`, `shared/ui/charts/` (`Sparkline`, `AreaLineChart`, `ColumnChart`, `niceScale`), `StatCardRow` có thêm `delta` + `trend`. `DashboardPage` chọn bản theo quyền (vai trò khác thấy khung trống).
- **Định nghĩa số** (đọc kỹ trong `docs/DECISIONS.md` #282): lượt khám theo ngày tiếp nhận; bệnh nhân mới = lượt đầu tiên của bệnh nhân; thực thu = thu − hoàn theo ngày THU (KHÔNG `invoice.total_amount`); chờ thu = UNPAID sau chiết khấu; thực thu theo nhóm = chia theo tỉ trọng dòng (phần dư lớn nhất); dịch vụ đếm theo DÒNG, không gồm thuốc.
- **Khác mockup đã chốt** (5 điểm, ghi ở #282): ô Chờ thu không có "giảm N phiếu"; link "Mở báo cáo dòng tiền" thay "báo cáo doanh thu"; hàng đợi có "Hàng chờ chung" thay dòng "Xét nghiệm"; dòng tổng dịch vụ ghi "chiếm N%"; chưa dựng nhóm menu "Báo cáo".
- Kiểm: HTTP `dashboard-http.spec.ts` 15 ca + đột biến (2/2 bị bắt); core +16; web +16; Chrome IP LAN 18/18 + bản số liệu giống mockup ở 1280/1440/1920.

## 2. Việc kế tiếp (đề nghị theo thứ tự)
1. **Tổng quan THU NGÂN** (mockup `project/ThuNgan.dc.html` trong https://claude.ai/artifact/TmC456MFRXBGAWYPkWFPs1) → **LỄ TÂN** (`LeTan.dc.html`) → **BÁC SĨ** (`BacSi.dc.html`). Mỗi vai trò quyền riêng `dashboard.cashier/reception/doctor`; `DashboardPage` chọn bản theo quyền (xem `features/dashboard/DashboardPage.tsx`). Bác sĩ chỉ thấy số của chính mình; tiền hiện theo **công tắc cấu hình** (mockup mặc định KHÔNG hiện tiền) — cần thêm công tắc ở Cấu hình. Đọc file mockup đã lưu: dùng `Artifact action:read` với `paths` (không có sẵn trong repo). Tái dùng `ReportPanel`, `StatCardRow` (`delta`/`trend`), `charts/*`, `dashboard-model` (mở rộng).
2. **Báo cáo ngày (A2)** một trang in được + **nhóm menu "Báo cáo"** (dựng cùng lúc, vì lúc này mới có báo cáo mới để chứa) + xuất Excel dùng `addReportExcelHeader` + in bằng `PrintDocument`.
3. Các đợt sau: `docs/product/reporting-plan.md` mục 7 (Đợt 2 sổ khám bệnh/dịch vụ/thuốc đã phát → Đợt 3 doanh thu theo kỳ 2 cột Ghi nhận/Thực thu + theo bác sĩ → Đợt 4 vận hành/bệnh nhân → Đợt 5 nhiều chi nhánh "Toàn hệ thống": dùng lại `ReportBranchScopeService`/`useReportScope`, quyền `company_report.read`).
4. **Việc treo cũ**: dựng bản demo `0.9.4` khi chủ dự án bảo (ghi chú phát hành `release-notes/<số>.json` TRƯỚC; demo 0.9.3 chưa có #278/#280/#281/#282); chữ ký điện tử Thông tư 13/2025 (làm sau, mốc 31/12/2026); kiểm bộ cài trên máy sạch/Linux-NAS; chủ dự án quyết dựng giao diện điện thoại cho trang cấu hình (menu 240px cố định nên ở 390px trang bị bóp — hạn chế có từ trước, ngoài logo).

## 3. Bẫy và bài học
1. **Full API test trên máy này có thể báo lỗi "Memory allocation error"** (argon2 hết bộ nhớ khi chạy cả bộ) làm vài file `*-http.spec.ts` rớt hàng loạt ("Cannot read properties of undefined (reading 'accessToken')", `expected 500 to be 200`). Phiên này: full API 1840 đạt, 5 file rớt do lỗi này, **chạy lại riêng 5 file → 207/207 đạt**. Cách xử lý: tắt dev server/Chrome, chạy lại riêng các file rớt; đừng sửa mã.
2. **IP LAN của máy dev đổi** (`192.168.3.14` → `192.168.3.15` giữa phiên): `pnpm dev:lan` in IP hiện tại — đọc từ `lan.log`, đừng cứng IP trong script kiểm. `pnpm dev:lan` cần API chạy trước (`pnpm --filter @nexamed/api run dev`, cổng 3001) và tự khôi phục `config.json` khi thoát/kill.
3. **Vá file**: dùng `node scripts/patch-file.mjs edits.json` (an toàn CRLF/dấu `\`), ghi `edits.json` bằng công cụ Write. KHÔNG `prettier --write` file web có sẵn.
4. **Tên hàm ngày trùng**: `addDaysToDateString` (trả `string|null`), `vietnamDateOf`, `diffDateStrings` đã có ở core; trước khi thêm hàm ngày mới, grep `packages/core/src` (lỗi TS2308 do trùng tên khi `export *`).
5. **Báo cáo mới**: module `report` chỉ ĐỌC, SQL phẳng một repository, công thức tiền ở `@nexamed/core`; lọc `tenant_id` + `branch_id` (`requireBranchId`); một request MỘT transaction; không `catch {}` rỗng; trạng thái lỗi/trống/loading đủ (checklist `.claude/docs/ui-guidelines.md` 17b). Test HTTP dựng dữ liệu bằng Prisma đặc quyền với mốc giờ VN cố định, có đột biến.
6. **Seed dữ liệu thử cho Tổng quan**: dev hôm nay thường trống (không có lượt khám); để xem biểu đồ có số, chặn phản hồi API trong Playwright bằng số liệu mockup (xem kịch bản kiểu `dash-rich.cjs`, KHÔNG đưa ảnh/kịch bản tạm vào repo) hoặc dựng dữ liệu qua HTTP.
7. Chủ dự án thích xem Chrome CÓ CỬA SỔ khi kiểm (`headless:false`, `slowMo`). Ảnh chụp để ở scratchpad, không vào repo.

## 4. Môi trường lúc kết thúc phiên
- `master` = commit "docs(handoff)…" + commit #282 (đã push). Working tree sạch. Dev server API/Vite đã tắt; `apps/web/public/config.json` đã khôi phục (`apiBaseUrl: http://localhost:3001`).
- Docker `nexamed-postgres-1` (cổng 5433) chạy; DB dev đã `db:seed` (có quyền `dashboard.owner`). Tenant dev `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin`/`Dev@12345`. Logo thử NEXAMed đang gắn ở cả hai ô logo của tenant dev (thay bằng logo thật nếu cần).
- Playwright: `playwright-core@1.49.1` cài sẵn ở `C:\Users\Administrator\AppData\Local\Temp\claude\c--Projects-NEXAMed\11ac2ade-23c5-43f6-8aaf-345845f63ea2\scratchpad\pw\node_modules\playwright-core` (có thể bị dọn — cài lại theo `scripts/ui-audit/README.md`).

## 5. Tệp quan trọng mới/đổi
`packages/core/src/date/vietnam-period.ts`, `packages/core/src/report/dashboard-math.ts`, `packages/shared/src/report-dashboard.ts`, `apps/api/src/modules/report/{dashboard.repository,dashboard.service,dashboard.controller,report.module,dashboard-http.spec}.ts`, `apps/api/src/common/report-excel-header.ts`, `apps/web/src/features/dashboard/*`, `apps/web/src/shared/ui/{ReportPanel,StatCard}.tsx`, `apps/web/src/shared/ui/charts/*`, `apps/web/src/shared/layout/SidebarBrand.tsx`, `apps/web/public/brand/*`, `docs/product/reporting-plan.md`.
