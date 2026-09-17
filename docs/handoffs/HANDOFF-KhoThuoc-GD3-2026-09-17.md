# Handoff — Kho Thuốc & Vật tư y tế, Giai đoạn 3 (17/09/2026)

## Tóm tắt 1 câu

Kho Thuốc GĐ3 (Xuất kho theo đơn + FEFO + tiền thuốc) đã **code + test xong hoàn toàn** (backend + frontend), toàn bộ đã commit-ready trên `master`; việc còn lại duy nhất trước khi coi là "xong" theo chuẩn dự án là **verify Playwright/Chrome thật**.

## Session overview

- Phạm vi: tiếp nối lộ trình 5 giai đoạn Kho Thuốc (`docs/DECISIONS.md` #146). GĐ1/GĐ2 đã xong từ trước; phiên này làm GĐ3 theo đúng kế hoạch kỹ thuật đã duyệt sẵn từ phiên trước (`C:\Users\Administrator\.claude\plans\fluttering-scribbling-liskov.md`, `docs/DECISIONS.md` #163) — không cần hỏi lại, chỉ code.
- Không có gì dở dang giữa chừng — mọi việc trong phiên đã hoàn tất trọn vẹn theo từng bước (schema → migration → backend → ripple → frontend → test → docs).

## Việc đã hoàn thành

### Database / migration
- `apps/api/prisma/migrations/20260917110000_pharmacy_dispense_gd3/` — bảng mới `stock_issue`/`stock_issue_line`; `stock_ledger` thêm `source_issue_id`; `invoice` thêm cột `invoice_type` (enum `SERVICE`/`DRUG`) + đổi `UNIQUE(tenant_id, encounter_id)` từ toàn cục sang **partial** `WHERE invoice_type='SERVICE' AND deleted_at IS NULL`; `invoice_line.source_service_item_id` đổi nullable + thêm `source_stock_issue_line_id` + CHECK đúng-1-trong-2.
- `apps/api/prisma/migrations/20260917120000_stock_ledger_issue_void_reason/` — tách riêng vì `ALTER TYPE stock_ledger_reason ADD VALUE 'ISSUE_VOID'` không dùng được ngay trong cùng migration (bài học lặp lại từ #085/#159).
- Cả 2 migration đã `db:deploy` thật lên Postgres dev (`localhost:5433`) và `db:generate` lại Prisma Client — **đã áp dụng, không phải chỉ viết file**.

### Backend (`apps/api`)
- `apps/api/src/modules/inventory/stock-issue.{controller,service,repository}.ts` — module mới, luồng **1 bước** (khác Nháp→Duyệt của `stock_receipt` GĐ2): 6 endpoint (`POST/GET /inventory/issues`, `GET /inventory/issues/:id`, `POST /inventory/issues/:id/void`, `GET /inventory/prescriptions/:id/dispense-status`, `GET /inventory/dispense-queue`).
- `apps/api/src/modules/billing/invoice.repository.ts` — thêm `appendLines()`/`createDrugInvoice()`/`findOpenDrugInvoiceForEncounter()`/`findByStockIssueLineIds()`/`removeStockIssueLines()`; `findByEncounterId()` lọc tường minh `invoiceType='SERVICE'`.
- `apps/api/src/modules/encounter/encounter.repository.ts` — `Encounter.invoice` (Prisma 1-1) đổi thành `invoices Invoice[]` (1-N, hệ quả của bỏ unique toàn cục); mọi call site lọc `invoiceType:'SERVICE'` rồi map lại field `invoice` đơn để KHÔNG phải sửa tầng Service.
- `apps/api/src/modules/encounter/encounter.service.ts` — `signPrescription()` gọi `StockIssueService.autoDispenseForPrescription()` trong CÙNG transaction khi bật `autoDispenseOnSignEnabled` — **không rollback chữ ký** nếu thiếu tồn, chỉ ghi audit log riêng.
- `apps/api/src/modules/inventory/inventory.module.ts` ↔ `apps/api/src/modules/encounter/encounter.module.ts` — vòng phụ thuộc THẬT ở mức Service (đầu tiên trong dự án ngoài `CashierShiftModule`↔`BillingModule`), xử lý bằng `forwardRef()` 2 chiều.
- `packages/core/src/inventory/select-fefo-batches.ts` — hàm thuần `selectFefoBatches()`/`sortBatchesByFefo()` (greedy theo hạn dùng tăng dần, lô không hạn xếp cuối).
- `packages/core/src/errors/inventory-errors.ts` — 4 lỗi domain mới (`StockIssueExceedsPrescribedQuantityError`, `..OtcRequiresNonPrescriptionDrugError`, `..InsufficientStockError`, `..VoidNotAllowedError`).
- Permission mới `stock_issue.create`/`stock_issue.read` (`packages/core/src/rbac/permissions.ts` + `DEFAULT_ROLE_PERMISSIONS`): clinic_admin/doctor/nurse cả 2 (global), receptionist chỉ `.read`.
- `tenant_setting` mới `pharmacy_separate_invoice_enabled`/`auto_dispense_on_sign_enabled` — đúng khuôn `ClinicConfigReaderPort` sẵn có, PATCH qua `/clinic-settings` có sẵn.
- Ripple đã làm đủ: `permission-grouping.ts` (nhãn "Phiếu xuất kho"), `apps/api/src/testing/tenant-fixture.ts` (thứ tự xoá dọn test — phải dời khối "Kho Thuốc" lên SỚM HƠN vì `stock_issue` nay phụ thuộc `prescription`), `check-mandatory-columns.mjs` (pass), `openapi:generate` + `apps/web` `api:codegen` (đã chạy lại).

### Frontend (`apps/web`)
- `apps/web/src/features/inventory/DispenseQueuePage.tsx` (route `/inventory/dispense`) + `DispensePrescriptionDialog.tsx` (dùng chung) — trang riêng cho quầy thuốc.
- `apps/web/src/features/encounter/PrescriptionPanel.tsx` — nút "Phát thuốc" mới, chỉ hiện khi đơn đã ký VÀ actor có `stock_issue.create`.
- `apps/web/src/features/clinic/PaymentConfigPane.tsx` — khối "Kho Thuốc" mới, 2 công tắc (`pharmacySeparateInvoiceEnabled`, `autoDispenseOnSignEnabled`).
- `apps/web/src/shared/layout/Sidebar.tsx` + `apps/web/src/app/router.tsx` — mục "Phát thuốc" trong nhóm "Quản lý kho".
- `apps/web/src/features/drug/DrugCatalogPane.tsx` — tab "Thẻ kho"/"Lịch sử giao dịch" nối thêm nhãn `ISSUE_VOID` + hiện `sourceIssueNo` (đúng ghi chú treo sẵn từ GĐ2).

### Tài liệu dự án (đã cập nhật cùng phiên, không phải việc riêng)
- `docs/DECISIONS.md` #164 (chi tiết đầy đủ mọi quyết định kỹ thuật phát sinh lúc code, kể cả các điểm lệch nhỏ so với kế hoạch #163).
- `docs/CURRENT.md`, `docs/TASK.md`, `docs/CHANGELOG.md` (2026-09-17 (4)), `CLAUDE.md` — đã đồng bộ trạng thái GĐ3.

## Test & kiểm tra đã chạy (đều xanh)

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @nexamed/core run test` | 207/207 pass (bao gồm 7 test FEFO mới) |
| `pnpm --filter @nexamed/api run test` (toàn bộ suite) | 846/847 pass, 1 flake `icd10-http.spec.ts` đã biết từ trước (race `role_permission` khi chạy song song nhiều spec) — **pass 100% khi chạy riêng**, xác nhận không phải regression |
| `apps/api/src/modules/inventory/stock-issue-http.spec.ts` (mới) | 14/14 pass — đủ tồn/thiếu tồn/vượt kê đơn/nhiều lô FEFO/OTC/huỷ phiếu/huỷ khi đã thu bị chặn/race 2 phiếu cùng lô/tách hoá đơn DRUG/cách ly tenant/hàng đợi |
| `apps/api/src/modules/encounter/prescription-http.spec.ts` (+2 test auto-dispense) | 10/10 pass |
| `pnpm --filter @nexamed/web run test` | 5/5 pass |
| `pnpm --filter @nexamed/shared run test` | 25/25 pass |
| `pnpm run typecheck` (toàn workspace) | sạch |
| `pnpm run lint` (toàn workspace) | 0 lỗi, 7 warning có sẵn từ trước (không liên quan) |
| `pnpm run build` (api + web) | sạch, chunk khởi động web 175.77 kB + vendor 339.37 kB (không vượt trần 500 kB) |

## Trạng thái hiện tại của máy/môi trường

- Git: nhánh `master`, chưa commit gì trong phiên này (toàn bộ thay đổi đang ở working tree — **cần review + commit** trước khi coi là xong).
- Database dev (`localhost:5433`) đã áp cả 2 migration mới — schema DB đã là bản mới nhất.
- **Quan trọng**: trong phiên này đã dừng tay 2 tiến trình `nest start --watch` (PID cũ) để giải phóng khoá file `query_engine-windows.dll` cho `prisma generate` chạy được. Nếu trước đó có `pnpm dev` đang chạy, **cần khởi động lại** (`pnpm dev`) — API dev server hiện KHÔNG còn chạy.
- Chưa chạy `db:seed`/sync permission cho tenant pilot/dev thật (chỉ test tự seed tenant riêng) — lần đầu chạy `pnpm dev` sau phiên này, cơ chế `syncRolePermissionsForAllTenants()` sẽ tự vá quyền `stock_issue.*` cho tenant có sẵn lúc khởi động (không cần thao tác tay, đã có cơ chế từ trước).

## Việc tiếp theo (ưu tiên theo thứ tự)

1. **Review + commit** toàn bộ thay đổi trong phiên (chưa commit) — khối lượng lớn, nên xem qua `git status`/`git diff` trước khi commit.
2. **Verify Playwright/Chrome thật** — chưa chạy trong phiên này. Cần kiểm: luồng phát thuốc từ cả 2 điểm vào (trang riêng + nút trong màn khám), huỷ phiếu xuất, bật `autoDispenseOnSignEnabled` xác nhận tự trừ kho + tự cộng tiền khi ký đơn, bật `pharmacySeparateInvoiceEnabled` xác nhận tách hoá đơn riêng — đúng mục "Verify" trong kế hoạch gốc #163.
3. **UI xem hoá đơn DRUG riêng khi 1 lượt khám có nhiều hoá đơn** — CHƯA LÀM (đã ghi rõ trong #163 là "chưa có mockup, chốt lúc dựng mockup Artifact"). Cần hỏi/dựng mockup riêng khi chủ dự án sẵn sàng — không tự suy diễn.
4. (Tuỳ chọn, không bắt buộc) Toast chủ động báo "còn N thuốc chưa tự phát được" ngay sau khi ký đơn (hiện chỉ biết qua trang "Phát thuốc" hoặc Nhật ký hoạt động) — cân nhắc thêm nếu chủ dự án thấy cần khi dùng thử.
5. Sau khi verify xong: tiếp tục **Giai đoạn 4** (Kiểm kê, điều chuyển, báo cáo Nhập-Xuất-Tồn) — chưa lập kế hoạch.

## Rủi ro / điểm cần lưu ý khi tiếp tục

- GĐ3 là giai đoạn **duy nhất chạm bảng `invoice` đang chạy thật tại pilot** — khuyến nghị thử tại 1 phòng khám pilot trước khi GA rộng (đã ghi trong kế hoạch gốc, chưa thay đổi).
- `Encounter.invoice` đã đổi từ quan hệ 1-1 sang 1-N trong Prisma schema — nếu có code MỚI nào sau này query `encounter.invoice` (số ít) trực tiếp qua Prisma include mà quên lọc `invoiceType`, sẽ lỗi biên dịch ngay (Prisma không còn field đó) — không phải lỗi ẩn.
- Giá bán dòng xuất kho luôn lấy `drug.defaultSellPrice` (đơn vị nhỏ nhất), bất kể `unitPricingEnabled` — quyết định đơn giản hoá so với logic `stock_receipt` (đã ghi rõ lý do trong #164), không phải thiếu sót.

## Tham chiếu

- Kế hoạch kỹ thuật gốc: `C:\Users\Administrator\.claude\plans\fluttering-scribbling-liskov.md`
- Quyết định đầy đủ: `docs/DECISIONS.md` #163 (kế hoạch) + #164 (hoàn tất code, có mọi điểm phát sinh/lệch kế hoạch)
- Trạng thái dự án: `docs/CURRENT.md`, `docs/TASK.md`
- File mới quan trọng: `apps/api/src/modules/inventory/stock-issue.*`, `packages/core/src/inventory/select-fefo-batches.ts`, `apps/web/src/features/inventory/Dispense*.tsx`
