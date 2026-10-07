# HANDOFF — Cận lâm sàng GĐ2 + GĐ3 + Rà soát log kiểm toán — 2026-10-07

> Nhánh: `feat/paraclinical-gd2` (tách từ `feat/paraclinical`; PR #1 = GĐ1, PR #2 = print-template — xem `HANDOFF-CanLamSang-2026-10-06.md` mục link PR/cách mở PR khi không có `gh`). **GĐ2 XONG + verify Chrome. GĐ3 code + 12 test HTTP xong, CHƯA verify Chrome. GĐ4 chưa bắt đầu.**
> Hội thoại luôn tiếng Việt. Chủ dự án dặn: **"tuyệt đối tuân thủ các giao diện đã chốt, không thay đổi, làm giống 95%"** — mockup Artifact `https://claude.ai/artifact/BPXwUuXzxPYEgnebhQDuN7` (14 artboard, đã duyệt); lệch phải báo.
> Phiên này đã bị compact 1 lần — file này là nguồn sự thật, đọc cùng `docs/DECISIONS.md` #212 (GĐ1/GĐ2/GĐ3) và #213 (rà soát log).

## 1. Đã làm trong phiên (tất cả nằm trong 1 commit trên `feat/paraclinical-gd2`)

### GĐ2 — Gói dịch vụ + Bảng giá có thời hạn + Đơn vị kết quả XN (XONG, verify Chrome thật)
- Migration `20261007090000_service_package_price_list` (4 bảng: `service_package`, `service_package_item`, `price_list`, `price_list_item`) + `20261007100000_lab_result_unit_enum`.
- `packages/core/src/pricing/resolve-effective-price.ts` (+spec 23 test): ưu tiên CAO thắng → ngày bắt đầu muộn hơn → tạo sau; hết hạn tự rơi về bảng thấp hơn rồi giá mặc định; "Bảng giá chung" = giá nhập trực tiếp trên mặt hàng (không lưu bản sao).
- `apps/api/src/modules/pricing/` (ServicePackage/PriceList/Pricing/PriceableCatalog/PriceListExport service + controller + repository), `PricingPort` (`packages/core/src/ports/pricing.port.ts`) + `PricingAdapter` + `PricingPortModule` (`@Global()`). **Thứ tự `AppModule` quan trọng**: `PricingModule`/`PricingPortModule` phải đứng TRƯỚC `InventoryModule`.
- Áp giá thật: Tiếp nhận (xem trước + chốt giá theo ngày tiếp nhận) và Phát thuốc (`StockIssueService`, ghi đúng `sell_price` sau bảng giá).
- Web: `apps/web/src/features/pricing/*`, pill "Gói dịch vụ" + "Đơn vị kết quả" ở `/admin/catalog-paraclinical`, trang `/admin/price-lists`(+`/:id`|`new`), menu "Bảng giá".
- Danh mục `LAB_RESULT_UNIT` (mã `KQ`, seed 20 đơn vị), ô "Đơn vị" của chỉ số XN đổi sang Combobox.
- Đã bỏ khung xanh "Hai điều mẫu KHÔNG làm" theo yêu cầu chủ dự án.

### GĐ3 — Chỉ định của bác sĩ (code + test xong, **CHƯA verify Chrome**)
- Migration: `20261007110000_clinical_order_invoice_type` (`invoice_type` +`PARACLINICAL`), `20261007110100_clinical_order` (3 bảng + 3 enum), `20261007110200_print_document_type_clinical_order` (`PrintDocumentType` +`CLINICAL_ORDER`).
- API: `apps/api/src/modules/clinical-order/` (`GET|PUT /encounters/:encounterId/clinical-orders`, `POST .../print`); `invoice.repository.ts`/`invoice.service.ts` (gắn dòng hoá đơn, `lineSource = PARACLINICAL`, `clinicalOrderNo`); `domain-exception.filter.ts` (`CLINICAL_ORDER_ITEM_LOCKED` → 409); `packages/core/src/errors/clinical-order-errors.ts`; `packages/shared/src/clinical-order.ts`.
- Luật hoá đơn: SERVICE `UNPAID` → nối dòng; không thì PARACLINICAL `UNPAID` mở → nối; không thì tạo PARACLINICAL mới. Gỡ chỉ khi hoá đơn `UNPAID` + dòng `ORDERED`, còn lại 409. PARACLINICAL rỗng tự `CANCELLED`. `pg_advisory_xact_lock` theo lượt khám. Gói = 1 dòng hoá đơn (giá gói chốt), dịch vụ con không giá riêng. Ra ngoài/tên tự do: không giá, không hàng đợi.
- Web: `apps/web/src/features/clinical-order/{clinical-order.api,clinical-order.queries,ClinicalOrderPanel,ClinicalOrderPrintView}`, tab thứ 3 + badge ở `EncounterConsultationPage.tsx`, `InvoiceDetailPage`/`InvoiceCombinedPrintView`/`DispensePrescriptionDialog` hiểu nhóm "Cận lâm sàng — Phiếu chỉ định CLS…", `print-samples.ts`/`PrintDocumentPreview.tsx` thêm mẫu CLINICAL_ORDER, `shared/format/strip-diacritics.ts`.

### Rà soát log kiểm toán (#213) — yêu cầu cuối của chủ dự án: "kiểm tra log hệ thống theo quy định cho module mới + kho + nhà cung cấp"
- Mọi thao tác GHI của module mới + Kho + NCC + Công nợ NCC đều có `writeAuditLog(tx…)` cùng transaction, không PII, không `console.*`. 
- **Sửa**: bù nhãn tiếng Việt cho 57 action + 18 entityType (`packages/shared/src/audit/action-labels.ts`, `entity-type-labels.ts`); `GET clinical-orders` thêm `@AuditView('clinical_order', { paramName: 'encounterId' })`.
- **Test chốt chặn mới**: `apps/api/src/common/audit-labels-coverage.spec.ts` (quét mã nguồn, đỏ nếu action/entityType ghi audit thiếu nhãn). **BẪY**: API dùng `@nexamed/shared` qua `dist` → sửa nhãn xong phải `pnpm --filter @nexamed/shared build` rồi mới chạy test API.
- **ĐÃ CHỐT sau commit đầu (07/10/2026)**: chủ dự án chọn đưa 10 entityType danh mục vào System Log 90 ngày (`log-retention.ts` + spec). (b) before/afterJson cho `supplier.*`/`warehouse.*` ĐÃ bổ sung (chỉ trường đổi; liên hệ NCC chỉ ghi tên trường, không ghi giá trị). Ghi chú cũ: (a) xếp `entityType` danh mục (technical_service, lab_indicator, result_template, service_package, price_list, supplier, warehouse, cash_account, prescription_template, print_template) vào "System Log" 90 ngày (`packages/core/src/audit/log-retention.ts`) hay giữ vĩnh viễn như hiện tại (mặc định an toàn; `drug` đang là System Log); (b) bổ sung `beforeJson/afterJson` cho `supplier.*`/`warehouse.*` (hiện chỉ ghi ai/khi nào, không ghi sửa gì).

### Sửa test đi kèm
- `print-template-http.spec.ts`: 11 → 12 mẫu in. `business-code-http.spec.ts`: 27 loại mã, thêm `CLINICAL_ORDER` (CLS) vào danh sách mong đợi.

## 2. Kiểm thử đã chạy
- `pnpm -r typecheck` sạch (shared/core/web/api); `pnpm lint` 0 lỗi (8 cảnh báo `exhaustive-deps` cũ, không liên quan).
- Spec chạy xanh sau thay đổi cuối: `audit-labels-coverage` (3), `business-code-http` (11), `print-template-http` (20), `clinical-order-http` (12). Lần chạy gộp trước đó: 248 pass; 3 fail đều đã xử lý (2 do đếm 11→12, 1 do DB test tạm mất kết nối `localhost:32777` — chạy lại xanh).
- Bộ test đầy đủ API chạy nền cuối phiên: xem kết quả ghi ở mục 5 (nếu trống = chưa kịp, chạy lại `pnpm --filter @nexamed/api test`; `rbac.spec`/`sync-role-permissions.spec`/`icd10-http`/`user-account-me-http` có race đã biết khi chạy cả bộ — chạy lẻ thì xanh).
- **KHÔNG làm**: không có test HTTP khẳng định dòng `clinical_order.viewed` thật sự vào `audit_log` (chỉ có `audit-view.interceptor.spec` chung) — nên thêm.

## 3. Việc kế tiếp (thứ tự)
1. **Verify Chrome (Playwright) tab "Chỉ định cận lâm sàng"** (bắt buộc trước khi coi GĐ3 xong): dev server web 5173 + api 3001 (`pnpm dev`; **không tắt** nếu đang chạy; test tenant cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345`; xem memory `feedback_fixed_test_tenant`). Quy trình: sau khi có permission mới phải `pnpm db:seed` **và khởi động lại API**; tạo bệnh nhân + lượt khám qua HTTP (`POST /reception/direct`, `dev.admin` phải là bác sĩ của chính lượt khám — `clinical_order.create` là `personal`), "Bắt đầu khám" → tab 3: thêm dịch vụ tại phòng khám / ra ngoài / tên tự do / "+ Thêm theo gói" → Lưu → mở hoá đơn xem nhóm "Cận lâm sàng — Phiếu chỉ định CLS…" → xem trước in → thu tiền rồi thử gỡ dòng (409) và thêm dòng mới (hoá đơn PARACLINICAL riêng). Đối chiếu mockup (màn "Chỉ định"), báo mọi lệch.
2. Lỗ hổng GĐ3 đã biết cần xử lý: huỷ lượt khám chưa tự huỷ dòng chỉ định/hoá đơn PARACLINICAL (cân nhắc làm cùng GĐ4); dịch vụ con của gói đang hiện "trong giá gói"; phiếu in chưa có ô "Dặn dò" riêng.
3. **GĐ4 — Thực hiện & kết quả** (chưa bắt đầu; mockup màn HangDoi, 7, 8, 9/9b): hàng đợi cận lâm sàng (chặn vào hàng đợi nếu hoá đơn chưa thu), bước Lấy mẫu / Gọi vào phòng, nhập + duyệt kết quả (`lab_result`/`lab_result_value`/`imaging_result` — bản ký bất biến, sửa sau duyệt = bản đính chính `supersedes_id` + `amendment_reason`), mở rộng `clinical_order_item_status` (migration RIÊNG vì `ALTER TYPE … ADD VALUE`), vai trò mặc định "Kỹ thuật viên", nhóm sidebar "Cận lâm sàng" (Hàng đợi / Phiếu chỉ định / Tra cứu kết quả), in phiếu kết quả. **BẮT BUỘC (chủ dự án nhắc 2 lần)**: giá trị vượt khoảng tham chiếu **in ĐẬM + gạch chân trên phiếu in**, và badge ▲Cao/▼Thấp trên màn nhập — dùng `evaluateLabValue()`/`selectLabReference()` ở `packages/core/src/lab/lab-reference.ts`, lưu snapshot khoảng tham chiếu lúc nhập. Mẫu kết quả chỉ chèn Nhận xét/Kết luận, KHÔNG điền giá trị chỉ số.
4. Hỏi chủ dự án 2 câu treo ở mục 1 (System Log + before/afterJson supplier/warehouse) và trạng thái merge PR #1/#2.

## 4. Bài học / bẫy kỹ thuật
- Bash heredoc/`node -e` chứa tiếng Việt + dấu nháy đôi khi hỏng im lặng → tạo file bằng công cụ Write, vá file có sẵn bằng script `.cjs` (xử lý CRLF: đọc → đổi `\r\n`→`\n` → sửa → ghi lại đúng kiểu).
- `apps/web` KHÔNG import được GIÁ TRỊ từ `@nexamed/shared`/`@nexamed/core` (ESLint, #073) — nhãn/hằng đặt ở file riêng của web; `stripDiacritics` bản web ở `apps/web/src/shared/format/strip-diacritics.ts`.
- Migration `ALTER TYPE … ADD VALUE` phải ở file riêng; migration forward-only, không sửa file đã merge.
- API không khởi động/đăng ký đủ provider nếu sai thứ tự module (`PRICING_PORT`); xem mục GĐ2.
- Test API cần DB test; nếu báo `Can't reach database server at localhost:32777` là DB test tạm chưa lên — chạy lại.

## 5. Ghi chú cuối phiên
Bộ test đầy đủ `apps/api` (07/10/2026, sau thay đổi cuối): **1227 pass / 11 skipped / 70 file, 1 file fail = `icd10-http.spec.ts` do race đã biết khi chạy cả bộ — chạy riêng 11/11 xanh.** Typecheck + lint sạch. Chưa chạy lại `pnpm build` web + test `apps/web`/`packages/*` sau thay đổi cuối (thay đổi cuối chỉ ở API + nhãn shared + docs).
