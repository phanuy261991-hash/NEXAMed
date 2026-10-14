# HANDOFF — Tầng chi nhánh ĐỢT 2 (tiền + kho + kiểm nhận điều chuyển + đầu phiếu in) — 2026-10-14

> **ĐÃ HOÀN THÀNH (cùng ngày, phiên sau)**: mọi mục A–C bên dưới đã làm xong + test + verify Chrome thật; kết quả và các quyết định phát sinh ở `docs/DECISIONS.md` #233 (mục "Cập nhật 14/10/2026 cuối phiên"). File này giữ lại làm lịch sử, KHÔNG còn là việc treo. Còn lại duy nhất: dựng lại gói on-prem.

> Hội thoại luôn tiếng Việt. Commit + push **thẳng `master`**, không tạo nhánh/PR. Mockup đã DUYỆT (không dựng lại). Sau mỗi đợt chạy lại TOÀN BỘ test và báo kết quả; có bước kiểm tra cô lập tenant/chi nhánh. Ảnh chụp kiểm tra để ở thư mục tạm, KHÔNG lưu vào repo.
> **Commit này là trạng thái DỞ do hết phiên**: backend biên dịch sạch nhưng **web CHƯA biên dịch được**, 3 test API đỏ, migration CHƯA áp lên DB dev. CI trên `master` sẽ đỏ cho tới khi xong web + sửa test.

## 0. Nguồn sự thật

- **Mockup đã chốt (bản 2)**: https://claude.ai/artifact/EPa25ibLtA7jy8t2YG8soU (6 màn + mục 4b kiểm nhận/hoàn trả + Q1–Q8). Quyết định Q1–Q8 ghi ở `docs/DECISIONS.md` #233 và memory `project_branch_dot2_decisions`.
- Kế hoạch bám mockup ~95%; lệch phải báo.

## 1. Đã làm xong (backend, `pnpm exec tsc --noEmit` trong `apps/api` SẠCH)

1. **Migration** `apps/api/prisma/migrations/20261015090000_branch_dot2/migration.sql` (đã diễn tập trên bản sao DB `nexamed_migtest`, backfill 0 dòng null): `branch_id NOT NULL` cho `warehouse`/`cash_account`/`cashier_shift`; unique "mặc định/ca mở" chuyển sang theo chi nhánh; 3 trạng thái điều chuyển mới (`VARIANCE_PENDING`, `RETURNING`, `RETURNED`); cột kiểm nhận/hoàn trả trên `stock_transfer` + `stock_transfer_line`; `stock_receipt_type` thêm `TRANSFER_RETURN`; `stock_ledger_reason` thêm `RECEIPT_TRANSFER_RETURN`. **CHƯA áp lên DB dev.**
2. **Kho**: `WarehouseRepository` (mọi tra cứu theo id bắt buộc `branchId`; `findByIdAnyBranch` chỉ cho điều chuyển/quản trị), service/controller (`?allBranches=true`, tạo/sửa kho ở chi nhánh được gán, đổi chi nhánh chỉ khi chưa có phát sinh). Phiếu nhập/xuất/kiểm kê/điều chuyển, tồn, lô, thẻ kho, báo cáo N-X-T, cảnh báo tồn khi kê đơn (`StockAvailabilityPort.getOnHandQuantities(tenantId, branchId, ...)`), hàng đợi phát thuốc: đều lọc theo chi nhánh qua kho.
3. **Điều chuyển kho** viết lại: `stock-transfer.repository/service/controller` — gửi/nhận khác chi nhánh, tab `direction=out|in`, **Kiểm nhận** (`POST :id/receive` có `varianceReason`), **Từ chối nhận cả phiếu** (`POST :id/reject-receipt` → RETURNING), **Xác nhận nhận lại** (`POST :id/confirm-return` → RETURNED), **Xử lý chênh lệch bên gửi** (`POST :id/resolve-variance` → COMPLETED; hàng về kho gửi sinh phiếu nhập `TRANSFER_RETURN`, hoặc ghi hao hụt), `GET pending-counts`, `GET shrinkage-report`. Chi nhánh nhận không thấy giá vốn (`unitCost` chỉ gửi cho bên gửi). Nhãn nhật ký tiếng Việt đã thêm.
4. **Tiền**: `CashAccountRepository/Service/Controller` (quỹ thuộc chi nhánh, kể cả ngân hàng; `?allBranches=true`), phiếu thu/chi (`cashAccount.branchId`), chuyển quỹ chặn khác chi nhánh, sổ quỹ + báo cáo dòng tiền (repository nhận **danh sách** `branchIds` để Đợt 3 chỉ thêm bộ chọn), ca thu ngân (`branch_id`, mỗi người tối đa 1 ca mở/chi nhánh, port `CashierShiftReaderPort` đổi chữ ký có `branchId`), hoá đơn/thanh toán/hoàn tiền (lọc theo `encounter.branchId`), ví tạm ứng (nạp/tất toán dùng quỹ chi nhánh), công nợ NCC ("Trả ngay"/thanh toán/hoàn tiền dùng quỹ chi nhánh).
5. **Seed/tạo chi nhánh**: `ensureDefaultCashAccount/Warehouse(tx, tenantId, actorId, branchId, name?)`; `provisionBranchDefaults` — tạo chi nhánh mới tự có 1 kho + 1 quỹ tiền mặt (Q2).
6. **Đầu phiếu in**: `GET /clinic-profile/print-header?branchId=` trả thêm `branchName` (CHỈ khi công ty ≥ 2 chi nhánh; 1 chi nhánh → null, đầu phiếu như cũ), địa chỉ/SĐT chi nhánh (rơi về của công ty nếu trống); `BranchDirectoryPort.getBranchPrintInfo`; mẫu in thêm `header.showBranchName` (mặc định bật). Bệnh án PDF dùng đầu trang công ty (`null`).
7. Web đã làm: **bỏ ảnh đại diện bệnh nhân** (xoá `PatientAvatarUpload.tsx`, gỡ ở `PatientFormFields`/`PatientEditDialog`/`ReceptionIntakeForm`/`patient.api`/`patient.queries`) — yêu cầu mới của chủ dự án; cột `photo_key` + `POST /patients/:id/photo` ở backend GIỮ NGUYÊN (chưa xoá, hỏi lại nếu muốn gỡ hẳn).
8. Docs/memory: `docs/DECISIONS.md` #233; CURRENT.md dọn mục "Đang chờ"; CSP Report-Only ở nginx (đã commit trước).

## 2. CÒN PHẢI LÀM — theo thứ tự đề xuất

### A. Hạ tầng
1. Dừng API dev nếu đang chạy (đã dừng 14/10; cổng 3001). `pnpm --filter @nexamed/shared build && pnpm --filter @nexamed/core build`; `cd apps/api && pnpm exec prisma generate` (phải dừng API trước, Windows khoá file engine).
2. Áp migration lên DB dev: `pnpm --filter @nexamed/api run db:deploy` + `db:seed` (không có quyền mới nhưng chạy cho chắc), build API (`pnpm --filter @nexamed/api build`), khởi động lại từ `apps/api/dist`.
3. Xoá DB rác `nexamed_migtest` trong container: `docker exec nexamed-postgres-1 psql -U nexamed -d postgres -c "DROP DATABASE IF EXISTS nexamed_migtest"`.
4. `apps/api/scripts/generate-openapi.ts`: đăng ký thêm endpoint (reject-receipt, confirm-return, resolve-variance, pending-counts, shrinkage-report), query `allBranches` (warehouses, cash-accounts), `branchId` cho print-header, schema mới; chạy `openapi:generate` + `api:codegen` (xem script ở `package.json`) để sinh lại `apps/web/src/shared/api/openapi-schema.d.ts`.
5. **Chưa có endpoint "kho đích liên chi nhánh"** cho ô chọn kho nhận ở form điều chuyển: cần `GET /warehouses/transfer-destinations` (mọi kho hoạt động của công ty: id, tên, chi nhánh; không cần quyền chi nhánh), vì `GET /warehouses` chỉ trả kho chi nhánh đang làm/được gán.

### B. Backend còn thiếu
- DTO thêm `branchId` để đầu phiếu in đúng chi nhánh của chứng từ: `InvoiceDto`, `CashVoucher`, phiếu nhập/xuất/kiểm kê/điều chuyển (kho gửi), phiếu chỉ định (mặc định rơi về chi nhánh đang làm nếu không truyền — chấp nhận được).
- Q4: sổ công nợ NCC trả thêm `sourceBranchId/Name` cho dòng có chứng từ gốc để web hiện số tiền nhưng khoá nút mở phiếu chi nhánh khác.
- Q5: giao dịch ví (`/cash-book/wallets`, `listTransactions`) ẩn tên quỹ/không mở phiếu với giao dịch ở chi nhánh khác; số dư giữ nguyên.
- Test cô lập 2 chi nhánh cùng tenant (BẮT BUỘC, kèm kiểm đột biến bỏ lọc → test đỏ) cho: kho, phiếu nhập/xuất/kiểm kê, tồn/lô/thẻ kho, điều chuyển (gửi/nhận khác chi nhánh, bên nhận không thấy Nháp, không thấy giá vốn), quỹ/phiếu thu-chi/chuyển quỹ khác chi nhánh, ca thu ngân, hoá đơn/phiếu thu, ví, kê đơn vượt tồn. Test luồng điều chuyển mới: kiểm nhận đủ/thiếu/lý do bắt buộc/nhận vượt bị chặn, từ chối nhận cả phiếu, xác nhận nhận lại (đủ/thiếu), xử lý chênh lệch (về kho gửi/hao hụt), báo cáo hao hụt, đếm chờ xử lý. Test `provisionBranchDefaults`, print-header theo chi nhánh/1 chi nhánh.
- **3 test đang đỏ (đã biết nguyên nhân)**: `stock-transfer-http.spec.ts` ×2 ("nhận THIẾU không kèm ghi chú", "nhận THẤP hơn…") — nay phải gửi `varianceReason` và trạng thái sau nhận thiếu là `VARIANCE_PENDING`; `print-template-http.spec.ts` "Thiết lập nhanh MONEY_A5_REST_A4" — thêm `showBranchName` vào đầu trang ghi đè. Chạy lại toàn bộ API (~6 phút): `cd apps/api && pnpm exec vitest run`; trước đó `rls-coverage`, `tenant-isolation`, `branch-http` phải xanh.
- Kiểm tra lại `permission-matrix-enforcement-http.spec.ts` (route mới `pending-counts`, `shrinkage-report`, `reject-receipt`, `confirm-return`, `resolve-variance`).

### C. Web (CHƯA biên dịch được — chạy `cd apps/web && pnpm exec tsc -b --noEmit`)
Lỗi hiện tại: `inventory.api.ts` (kiểu cũ — hết sau khi sinh lại openapi), `StockTransferListPage.tsx`/`StockTransferFormPage.tsx` (bảng nhãn trạng thái thiếu 3 trạng thái mới), `print-samples.ts`/`SpecimenLabelSheet.tsx`/`PrintDocument.tsx` (thiếu `showBranchName` trong đối tượng `header`, `branchName` trong `ClinicPrintHeader`).
Màn cần làm đúng mockup (artifact ở mục 0):
1. **Danh mục Kho** (`drug/WarehousePane.tsx`): cột "Chi nhánh", bộ lọc "Chi nhánh: Tất cả" (`allBranches`), ô "Chi nhánh *" trong form (chỉ khi ≥ 2 chi nhánh).
2. **Quỹ** (`cash-book/CashAccountPane.tsx`): cột Chi nhánh + lọc + ô chọn chi nhánh khi tạo; chuyển quỹ chỉ liệt kê quỹ cùng chi nhánh.
3. **Mở ca thu ngân** (`cashier-shift/OpenShiftDialog.tsx`): dòng "Chi nhánh" chỉ đọc; nhắc ca đang mở ở chi nhánh khác khi đổi chi nhánh (`BranchSwitcher`).
4. **Điều chuyển kho**: danh sách 2 tab "Phiếu đi/Phiếu đến" (+ chấm số từ `pending-counts` ở menu), chọn kho nhận liên chi nhánh, màn **Kiểm nhận hàng** (cột SL phiếu/Thực nhận/Chênh lệch/Lý do/Ghi chú, "Nhận đủ tất cả", "Từ chối nhận cả phiếu"), hộp thoại **Từ chối nhận cả phiếu**, màn **Xử lý chênh lệch** (bên gửi, có giá trị), **Xác nhận đã nhận lại hàng**, biên bản kiểm nhận in được, **báo cáo hao hụt điều chuyển** (trang mới, quyền `stock_receipt.report`). Chi nhánh nhận không hiện giá vốn.
5. **Đầu phiếu in**: `PrintDocument` thêm prop `branchId?`, `useClinicPrintHeaderQuery(branchId?)` (khoá cache có branchId), in dòng tên chi nhánh đậm dưới tên phòng khám khi `branchName != null` và `header.showBranchName`; công tắc "Tên chi nhánh" trong `PrintTemplateConfigPanel` + mẫu xem trước dùng chi nhánh mẫu; truyền `branchId` của chứng từ cho các `*PrintView`.
6. Công ty 1 chi nhánh: KHÔNG hiện cột/ô/bộ chọn chi nhánh nào (dùng `hasMultipleBranches` ở `features/branch/branch-visibility.ts`).
7. Verify Chrome thật (Playwright-core cài lại ở thư mục tạm; `dev.admin`/`Dev@12345`, tenant test `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, "Chi nhánh 2" là dữ liệu của chủ dự án — đừng sửa): kho, quỹ, mở ca, điều chuyển liên chi nhánh đủ vòng đời, in phiếu 2 chi nhánh.

### D. Tài liệu (ngắn, chọn file liên quan)
ERD (v1.74: 3 cột `branch_id`, cột/trạng thái điều chuyển), `.claude/docs/data-model.md`, `multi-tenancy.md`, CHANGELOG, CURRENT, TASK, `CLAUDE.md` (Đợt 2 xong), DECISIONS #233 cập nhật trạng thái. Dựng lại gói on-prem sau cùng (`deploy/on-prem/build-and-export.ps1 -Version <ngày>`; CHẠY QUA BASH: `powershell -NoProfile -ExecutionPolicy Bypass -File ./build-and-export.ps1 -Version X > log 2>&1`, KHÔNG chạy trực tiếp trong PowerShell tool — stderr của Docker bị coi là lỗi và `$PSScriptRoot` rỗng làm ghi nhầm `C:\package`). Gói `2026.10.14` hiện có trong `deploy/on-prem/package/images` là TRƯỚC Đợt 2.

### E. Việc đã chốt nhưng làm SAU Đợt 2
- **Tab "Kết quả cận lâm sàng" trong hồ sơ bệnh nhân + biểu đồ diễn biến chỉ số** (chủ dự án chốt 14/10/2026): cần mockup duyệt trước khi code; memory `project_cls_results_tab_queued`.
- Câu hỏi chưa chốt: xem tổng sổ quỹ/dòng tiền cả công ty — đề xuất Đợt 3 bằng bộ chọn "Tất cả chi nhánh của tôi" (truy vấn đã nhận danh sách chi nhánh sẵn).
- CSP chuyển từ Report-Only sang chặn sau khi pilot sạch cảnh báo Console.

## 3. Bẫy kỹ thuật đã gặp phiên này

- File nguồn dùng **CRLF**: sửa nhiều dòng phải chuẩn hoá `\r\n`. Tôi dùng script `lib.cjs` (hàm `patch(path, [[từ, thành, tất cả?]])`, ném lỗi nếu mẫu không khớp) — script nằm ở thư mục tạm của phiên, đã mất; viết lại nếu cần.
- `node -e "..."` và heredoc bash có `\n`/backtick/dấu nháy lồng **hỏng im lặng** → dùng công cụ Write rồi chạy file `.cjs`.
- Đổi chữ ký có tham số cùng kiểu `string` có thể **lọt qua tsc** (ví dụ `listWithBalanceForDrug` thêm `branchId` — đã sửa tay): sau mỗi lần thêm tham số, `grep` mọi nơi gọi.
- `prisma generate` lỗi EPERM khi API dev đang chạy; migration thêm giá trị enum không dùng được trong cùng migration.
- Test API ~6 phút (`vitest run`), kết quả lần cuối **1395/1398** (3 đỏ đã nêu).
