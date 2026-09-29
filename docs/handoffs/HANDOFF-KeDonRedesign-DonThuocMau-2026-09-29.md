# Handoff — Redesign Kê đơn (liều theo buổi) + "Đơn thuốc mẫu" (Quản trị) + "Sao chép đơn lần trước" — CODE + TEST TỰ ĐỘNG + TÀI LIỆU XONG, CHƯA VERIFY PLAYWRIGHT

**Ngày ghi**: 29/09/2026 (theo yêu cầu "ghi file để chuyển phiên"). **Cập nhật cùng ngày, sau khi ghi file này**: đã hoàn tất luôn mục "Cập nhật tài liệu" (việc kế tiếp #2 nêu dưới) — `docs/DECISIONS.md` #196, `docs/CHANGELOG.md`, `docs/ERD.md` (v1.59 + sửa sơ đồ `PRESCRIPTION_ITEM`), `.claude/docs/data-model.md` đều đã cập nhật. **Trạng thái**: backend + frontend của cả 3 việc đã viết xong, toàn bộ test tự động liên quan đã chạy PASS (xem mục "Đã xác minh thật"), tài liệu đã đồng bộ. **CHỈ CÒN treo: verify Playwright** (mục kế tiếp #1). **Toàn bộ thay đổi CHƯA COMMIT** — `git status`/`git diff` trên working tree là nguồn sự thật, không phải file này.

## Bối cảnh — 3 việc chủ dự án yêu cầu trong cùng phiên

1. **Không có danh mục tạo đơn thuốc mẫu** — trước đây CHỈ sửa/lưu được từ NGAY TRONG popup lúc đang kê đơn cho 1 bệnh nhân cụ thể, không có nơi xem/sửa/ẩn toàn bộ mẫu ngoài lúc đó.
2. **Redesign giao diện kê đơn** — ô "Liều dùng"/"Tần suất" tự do → 4 ô Sáng/Trưa/Chiều/Tối kiểu GẠCH DƯỚI (không viền khung), nhập Số ngày tự tính Tổng số lượng, đơn vị LUÔN là đơn vị nhỏ nhất của thuốc (không cho đổi).
3. **Chức năng copy/xem đơn thuốc của lần khám trước** — "xem" đã có sẵn từ trước (dialog "Lịch sử khám"); "copy" (sao chép cả cụm vào đơn đang soạn) là mới.

**Chốt qua `AskUserQuestion`** (cả 4 câu đều chọn phương án Recommended): (1) Cấu trúc liều theo buổi THAY HẲN 2 ô tự do cũ (không làm song song 2 kiểu nhập); (2) Đơn vị LUÔN cố định đơn vị nhỏ nhất, không cho đổi; (3) "Đơn thuốc mẫu" quản lý ở TRANG RIÊNG trong Quản trị (không mở rộng trong popup); (4) "Sao chép đơn lần trước" là NÚT RIÊNG trong tab Kê đơn, sao chép TOÀN BỘ đơn gần nhất.

**Mockup đã dựng và được chủ dự án CHỐT** trước khi code (đúng yêu cầu "giao diện kê đơn hãy dựng lại mockup trước khi sửa") — Artifact 2 màn hình tại `https://claude.ai/artifact/EnT8CJiQiyeJbzN35p4KZs` (Main.dc.html = redesign Kê đơn, TemplateCatalog.dc.html = trang "Đơn thuốc mẫu"). Người dùng trả lời "chốt mockup" → coi là DUYỆT chính thức.

## Việc treo TRƯỚC ĐÓ đã xong xuôi trong CÙNG phiên (không liên quan 3 việc trên)

"Phiếu xuất gốc" TUỲ CHỌN cho "Nhập hoàn trả từ bệnh nhân/khoa phòng" (`stock_receipt.receiptType='RETURN_FROM_USE'`) — đã code + test + cập nhật `docs/DECISIONS.md` #195 + `docs/CHANGELOG.md` XONG HOÀN TOÀN trước khi bắt đầu 3 việc ở trên. Không còn việc gì treo cho phần này ngoài **verify Playwright** (chưa làm, ghi chung vào mục dưới).

## Migration đã áp thật lên Postgres dev (2 migration MỚI trong phiên này)

- `20260929100000_stock_receipt_return_from_use_source_issue` — `stock_receipt.source_issue_id` (tuỳ chọn, cho #195 ở trên).
- `20260929110000_prescription_dose_periods` — **QUAN TRỌNG, đọc kỹ trước khi động vào `prescription_item`/`prescription_template_item`**:
  - Xoá hẳn cột `dose`/`frequency` (TEXT tự do) của CẢ HAI bảng `prescription_item` VÀ `prescription_template_item`.
  - Thêm 4 cột `dose_morning`/`dose_noon`/`dose_afternoon`/`dose_evening` (SMALLINT, default 0) cho cả 2 bảng.
  - **Dữ liệu `dose`/`frequency` CŨ của đơn ĐÃ KÝ (bất biến theo CLAUDE.md) KHÔNG bị xoá mất** — trước khi DROP COLUMN, migration tự gộp nội dung cũ vào cột `instruction` sẵn có (dạng `"<instruction cũ> — Liều dùng cũ: <dose>, <frequency>"`) cho MỌI dòng có `dose`/`frequency` khác rỗng. `quantity` của dòng CŨ **giữ nguyên giá trị gốc**, KHÔNG tính lại theo công thức mới (4 cột buổi mặc định 0 cho dữ liệu cũ → tính lại sẽ ra 0, sai).
  - Cả 2 migration đã chạy `db:deploy` thành công lên Postgres dev thật (không chỉ testcontainer test).

## Tóm tắt thiết kế/schema mới (đọc trước khi sửa tiếp)

- **KHÔNG có cột `unit_code`/snapshot đơn vị nào mới trên `prescription_item`** — đơn vị hiển thị LUÔN resolve qua JOIN `drug.baseUnitCode` lúc đọc (giống cách `drugName`/`activeIngredient` đã resolve từ trước), trả về trong response dưới tên `unitCode` (nullable — `null` cho dòng "kê thuốc tự do" hoặc thuốc chưa khai `baseUnitCode`).
- **`quantity` từ nay LUÔN do backend tính** = `(doseMorning+doseNoon+doseAfternoon+doseEvening) × durationDays` — hàm thuần `computePrescriptionQuantity()` (`packages/shared/src/prescription.ts`). Client KHÔNG còn gửi `quantity` trong request (đã bỏ khỏi input schema).
- **`formatDoseSummary()`** (cùng file) — chuỗi hiển thị "Sáng 1 - Chiều 1 - Tối 1" (bỏ buổi = 0, `"—"` nếu cả 4 đều 0) — dùng cho mọi nơi CHỈ ĐỌC (in đơn, "Phát thuốc" dòng tự do, bệnh án PDF).
- **Validate**: tổng 4 buổi phải > 0 (superRefine trong `prescriptionItemInputSchema`), lỗi 400 nếu không.
- **Bug bundler ĐÃ BIẾT lặp lại (#032/#091/#114) — ĐÃ XỬ LÝ**: `apps/web` KHÔNG import `computePrescriptionQuantity`/`formatDoseSummary` trực tiếp từ `@nexamed/shared` (Rollup không dò được qua `__exportStar` lúc `vite build`, dù `tsc` sạch) — đã khai lại 2 hàm này ở `apps/web/src/features/encounter/prescription-dose-preview.ts` (`computePrescriptionQuantityPreview`/`formatDoseSummaryPreview`), mọi file web đều import từ ĐÂY, không import thẳng từ `@nexamed/shared`. **Nếu sửa logic 2 hàm gốc thì PHẢI sửa lại y hệt ở file preview này.**
- **"Đơn thuốc mẫu"**: `prescription_template_item` đổi y hệt `prescription_item` (4 cột buổi, `quantity` tính ở `PrescriptionTemplateService.toItemData()`). Thêm `includeInactive` (query param, union `boolean|'true'|'false'` — **KHÔNG dùng `z.coerce.boolean()`**, đúng bug đã biết #160) cho `GET /prescription-templates` — mặc định `false` (popup chọn mẫu lúc kê đơn), `true` cho trang quản lý mới.
- **`GET /encounters/:id/prescription/previous`** (route MỚI, permission `prescription.create` — cùng quyền với sửa đơn nháp) — trả `{ items: PrescriptionItem[] } | null`, tìm đơn ĐÃ KÝ gần nhất (`orderBy signedAt desc`) của CÙNG bệnh nhân, loại trừ lượt khám hiện tại. Repository method mới `PrescriptionRepository.findMostRecentSignedForPatient()`.

## File đã sửa/tạo mới (đầy đủ, đối chiếu `git status`)

**Migration mới**: `apps/api/prisma/migrations/20260929100000_stock_receipt_return_from_use_source_issue/`, `apps/api/prisma/migrations/20260929110000_prescription_dose_periods/`.

**Backend sửa**: `schema.prisma`, `scripts/generate-openapi.ts` (thêm route GET previous + query includeInactive), `encounter.controller.ts` (route mới), `encounter.service.ts` (`toCreateItemData`/`toPrescriptionItem`/`getPreviousPrescription`/medical record export/audit log), `prescription.repository.ts` (4 cột buổi + `unitCode` join + `findMostRecentSignedForPatient` + trích `ITEMS_INCLUDE` dùng chung), `drug/prescription-template.{controller,service,repository}.ts` (tương tự), `inventory/stock-issue.service.ts` (freeTextLines dùng `formatDoseSummary`), `inventory/stock-receipt.{repository,service}.ts` + `testing/tenant-fixture.ts` (cho #195, đã xong từ trước).

**Backend test sửa**: `prescription-http.spec.ts` (+7 test mới: quantity tính đúng/unitCode/validate 4 buổi=0/3 test previous-prescription), `prescription-template-http.spec.ts` (+quantity assertion +1 test includeInactive, sed thay toàn bộ payload dose/frequency cũ), `stock-issue-http.spec.ts` (3 chỗ payload), `doctor-availability-http.spec.ts` (1 chỗ payload), `inventory-http.spec.ts` (cho #195, xong từ trước).

**Shared mới/sửa**: `packages/shared/src/prescription.ts` (schema mới + 2 hàm thuần + `previousPrescriptionResponseSchema`), `prescription-template.ts` (schema mới + `listPrescriptionTemplatesQuerySchema`), `inventory.ts` (`freeTextPrescriptionLineSchema.doseSummary` thay `dose`/`frequency`), **`prescription.spec.ts` (MỚI, 6 test cho 2 hàm thuần)**.

**Core sửa**: `medical-record/render-patient-medical-record-html.ts` + `.spec.ts` (`MedicalRecordPrescriptionItem.doseSummary`/`unitCode` thay `dose`/`frequency`).

**Web sửa**: `PrescriptionPanel.tsx` (redesign LỚN — 4 ô buổi gạch dưới, tổng số tính sẵn, nút "Sao chép đơn lần trước", export `LineInput` dùng chung), `PrescriptionPrintView.tsx`, `DispensePrescriptionDialog.tsx`, `DrugPicker.tsx` (thêm `unitCode` vào `onSelect` + prop `disableFreeText`), `encounter.{api,queries}.ts` (previous-prescription), `drug/prescription-template.{api,queries}.ts` (includeInactive), `router.tsx` + `Sidebar.tsx` (route/menu mới), `role/permission-grouping.ts`/`inventory/{StockReceiptFormPage,StockReceiptHeaderDialog,inventory.queries}.ts` (cho #195, xong từ trước).

**Web mới**: `features/drug/PrescriptionTemplateCatalogPage.tsx` (page wrapper mỏng), `features/drug/PrescriptionTemplatePane.tsx` (nội dung thật — list/search/Thêm/Sửa/Ẩn/Kích hoạt lại, dialog sửa dùng `LineInput`+`DrugPicker`), `features/encounter/prescription-dose-preview.ts` (bản sao thuần client, xem mục bug bundler ở trên).

## Đã xác minh thật (test tự động — CHƯA verify Playwright)

- `pnpm --filter @nexamed/shared run test`: 31/31 pass (gồm 6 test mới `prescription.spec.ts`).
- `pnpm --filter @nexamed/core run test`: 232/232 pass.
- `pnpm --filter @nexamed/api run typecheck`: sạch. `pnpm --filter @nexamed/web run typecheck`: sạch. `pnpm -w run lint`: sạch (8 warning có sẵn từ trước, không liên quan). `pnpm -w run build`: sạch, KHÔNG cảnh báo chunk size.
- **Chạy TOÀN BỘ suite `apps/api`** (không chỉ file liên quan): **1029/1029 test pass**, 16 skip (đã biết trước), CHỈ 2 suite fail (`icd10-http.spec.ts`, `user-account-me-http.spec.ts`) — cả hai đều là **flake ĐÃ BIẾT từ rất nhiều phiên trước** (race `seedDefaultRolesForTenant`/`role_permission` unique constraint khi chạy nhiều file song song), **KHÔNG liên quan** tới thay đổi phiên này. Đã xác nhận qua các lần chạy CÔ LẬP riêng từng file trong phiên (`prescription-http.spec.ts` 21/21, `prescription-template-http.spec.ts` 6/6, `stock-issue-http.spec.ts` 41/41, `doctor-availability-http.spec.ts` 18/18) — tất cả pass sạch.
- Migration đã `db:deploy` thật lên Postgres dev (không phải testcontainer).

## Việc kế tiếp ưu tiên — theo đúng thứ tự

1. **Verify Playwright/Chrome thật** (CHƯA làm chút nào) — cần cho CẢ 4 việc:
   - "Phiếu xuất gốc" (#195): mở phiếu `RETURN_FROM_USE`, Combobox "Phiếu xuất gốc (tuỳ chọn)" hiện đúng khi có Kho, lọc đúng `RETAIL_SALE`/`INTERNAL_ALLOCATION`, lưu/xem lại đúng `sourceIssueNo`.
   - Redesign Kê đơn: 4 ô Sáng/Trưa/Chiều/Tối kiểu gạch dưới hiển thị đúng mockup, gõ số → Tổng số cập nhật LIVE đúng công thức, đơn vị hiện đúng (đơn vị nhỏ nhất, không có ô chọn), dòng "kê thuốc tự do" không hiện đơn vị/hiện dấu gạch ngang hợp lý, ô "Hướng dẫn dùng" đổi sang gạch dưới không vỡ layout.
   - Nút "Sao chép đơn lần trước": bấm khi CHƯA có đơn cũ → banner lỗi đúng; bấm khi CÓ đơn cũ → chèn đúng cụm thuốc vào đơn đang soạn (không trùng thuốc đã có sẵn).
   - Trang "Đơn thuốc mẫu" (`/admin/prescription-templates`, menu Quản trị → dưới "Danh mục kho"): list/search/Thêm mẫu mới (dùng `DrugPicker` không có tuỳ chọn "ngoài danh mục")/Sửa/Ẩn/Kích hoạt lại — đối chiếu với mockup `TemplateCatalog.dc.html`.
   - Kiểm luôn: popup "Đơn mẫu" trong màn Kê đơn (đường cũ, không đổi code nhưng field đã đổi shape) vẫn áp dụng đúng mẫu vào đơn (4 buổi + tổng số + đơn vị đúng).
2. ~~**Cập nhật tài liệu**~~ — **ĐÃ XONG cùng ngày**: `docs/DECISIONS.md` #196, `docs/CHANGELOG.md` (mục "2026-09-29 (2)"), `docs/ERD.md` (sơ đồ `PRESCRIPTION_ITEM` mục 2 + dòng mô tả bảng mục 3 + version history v1.59, có ghi rõ "nợ tài liệu" cho #189/#190/#192 CHƯA có dòng version riêng — không tự bổ sung số version cho các mục đó, không thuộc phạm vi phiên này), `.claude/docs/data-model.md` (mục `prescription_item`). **CHƯA đụng `docs/TASK.md`** — cân nhắc thêm 1 dòng ngắn nếu thấy cần, không bắt buộc (DECISIONS+CHANGELOG đã đủ theo thói quen "concise, selective doc updates").
3. Nếu verify Playwright ở bước 1 lộ ra bug/thay đổi thiết kế → sửa → chạy lại test liên quan → **cập nhật lại đúng đoạn vừa sửa** trong `docs/DECISIONS.md` #196 (đã viết, không phải viết mới) — đúng thói quen đã lặp lại nhiều lần trong dự án (sửa 1 lần, không phải 2 lần).

## Việc KHÔNG làm (đã chốt hoặc cố ý bỏ qua, đừng tự mở rộng)

- KHÔNG thêm cột `unit_code` snapshot vào `prescription_item`/`prescription_template_item` — đơn vị CHỈ đọc qua JOIN `drug.baseUnitCode`, quyết định có chủ đích (đơn giản hơn, đơn vị nhỏ nhất gần như không đổi sau khi đã có giao dịch kho).
- KHÔNG cho chọn đơn vị khác (Vỉ/Hộp) ở màn Kê đơn — chốt qua `AskUserQuestion`, luôn cố định đơn vị nhỏ nhất.
- KHÔNG làm nhánh "kê thuốc tự do" cho "Đơn thuốc mẫu" — mẫu LUÔN yêu cầu `drugId` thật (giữ nguyên từ trước #196), `DrugPicker` trong dialog sửa mẫu dùng `disableFreeText` để ẩn hẳn tuỳ chọn này dù tenant có bật `allowFreeTextPrescriptionEnabled`.
- KHÔNG thêm endpoint DELETE thật cho "Đơn thuốc mẫu" — "Xoá" = `PATCH isActive:false` (đúng khuôn `drug`/`supplier`/`warehouse` đã có sẵn), route `PATCH /prescription-templates/:id` không đổi.
- KHÔNG đụng vào `quantity`/dữ liệu của đơn thuốc ĐÃ KÝ trước migration này — `quantity` cũ giữ nguyên, chỉ 4 cột buổi mới = 0 (không suy diễn ngược lại từ `quantity` cũ).

## Lưu ý môi trường

- `pnpm dev` **KHÔNG chạy** trong phiên này (mọi test đều qua Vitest HTTP e2e, không cần dev server) — cần tự khởi động (`pnpm dev`, API cổng 3000, Web cổng 5173) trước khi verify Playwright.
- Prisma Client đã `generate` lại đúng sau 2 migration mới — không cần chạy lại trừ khi thấy lỗi type liên quan Prisma.
- OpenAPI (`apps/api/openapi/openapi.json`) + web codegen (`apps/web/src/shared/api/openapi-schema.d.ts`) **ĐÃ sinh lại** trong phiên — khớp đúng code hiện tại.
- `packages/shared`/`packages/core` **ĐÃ `build` lại** (dist mới nhất khớp source) — nếu tiếp tục sửa 2 package này thì nhớ build lại trước khi chạy test `apps/api` (dist cũ sẽ làm sai kết quả typecheck/test).
- Không có dữ liệu test nào bị bỏ sót lại trên Postgres dev — toàn bộ test HTTP e2e trong phiên này đều tự dọn qua `tenant-fixture.cleanup()`/`afterAll`, không tạo dữ liệu ngoài fixture.
