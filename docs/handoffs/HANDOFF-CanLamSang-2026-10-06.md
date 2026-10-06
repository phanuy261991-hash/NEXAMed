# HANDOFF — Cận lâm sàng (decision #212) — 2026-10-06

> Nhánh: `feat/paraclinical` (tách từ `feat/print-template`, nhánh đó đã push + chờ chủ dự án mở PR vào `master`). **GĐ1 (Danh mục) XONG + verify Chrome thật. GĐ2, GĐ3, GĐ4 CHƯA BẮT ĐẦU.**
> Hội thoại luôn tiếng Việt. Chủ dự án dặn: **"tuyệt đối tuân thủ các giao diện đã chốt, không thay đổi, làm giống 95%"**.

## 1. Bối cảnh & quyết định đã chốt (chi tiết: `docs/DECISIONS.md` #212 — ĐỌC TRƯỚC)

Mở rộng phạm vi v1: Cận lâm sàng (Xét nghiệm / Chẩn đoán hình ảnh / Thăm dò chức năng) + Bảng giá có thời hạn. PRD cũ xếp LIS/PACS vào v3+ → chỉ làm phần NGHIỆP VỤ (nhập kết quả tay), KHÔNG tích hợp máy xét nghiệm/PACS. `CLAUDE.md` đã thêm 2 đoạn phạm vi.

**Mockup đã duyệt ("chốt mockup")**: Artifact `https://claude.ai/artifact/BPXwUuXzxPYEgnebhQDuN7` — 14 artboard: 1 Danh mục dịch vụ, 2 Form dịch vụ, 3 Chỉ số + tham chiếu, 3b Mẫu kết quả, 4 Gói dịch vụ, 5 Tab Chỉ định (màn khám), 6 Hàng đợi, 7 Nhập kết quả XN, 8 Nhập kết quả CĐHA, 9/9b Phiếu kết quả XN (theo **phiếu mẫu thật** `C:\Users\Administrator\Downloads\26020695088_vi.pdf`), 9c Phiếu chỉ định, 10 Danh sách bảng giá + Tra thử giá, 11 Chi tiết bảng giá. Đọc lại bằng Artifact `read` (path `project/<Tên>.dc.html`); bản local ở scratchpad phiên cũ có thể mất.

Chốt qua `AskUserQuestion`: bảng `technical_service` THEO TENANT (khuôn `drug`, không nhét `reference_catalog`, không gộp `EXAM_TYPE`) · Gói = giá cố định HOẶC tổng trừ chiết khấu (chọn theo gói), gói chứa Dịch vụ khám + Dịch vụ kỹ thuật (KHÔNG thuốc/vật tư) · Luồng có bước **Lấy mẫu/Gọi vào phòng** riêng + công tắc "cho thực hiện trước khi thu tiền" · Tham chiếu theo **giới tính × khoảng tuổi (năm)** · Chỉ định **2 đường** (làm tại phòng khám / ra ngoài, kèm tên tự do — đúng khuôn "Kê thuốc tự do" #192) · Mẫu kết quả dùng chung, chỉ lời Nhận xét/Kết luận, **không khoá nội dung, không điền giá trị chỉ số** · Bảng giá: độ ưu tiên số (cao thắng), 1 bảng trộn đủ **5 loại** (Dịch vụ khám, DV kỹ thuật, Gói, Thuốc, VTYT), mỗi dòng Giảm % hoặc Giá mới, "Bảng giá chung" = giá nhập trực tiếp trên mặt hàng (ưu tiên 0, không lưu bản sao).

**Yêu cầu bắt buộc cho GĐ4 (chủ dự án nhắc 2 lần):** giá trị vượt khoảng tham chiếu phải **in ĐẬM + gạch chân trên phiếu in** (đúng phiếu mẫu thật) và có badge ▲ Cao/▼ Thấp trên màn nhập. Cờ do `evaluateLabValue()` tính; bản đã duyệt phải SNAPSHOT khoảng tham chiếu đã dùng.

## 2. GĐ1 đã làm (commit trên `feat/paraclinical`)

- **DB**: migration `20261006100000_paraclinical_catalog_enums` (2 giá trị enum `TECH_SERVICE_CATEGORY`, `SPECIMEN_TYPE`) + `20261006100100_paraclinical_catalog` (6 bảng `technical_service`, `technical_service_price` [exclusion constraint, dùng lại `nexamed_exam_type_price_range()`], `lab_indicator`, `lab_indicator_reference`, `technical_service_indicator`, `result_template`; 4 enum; RLS; partial unique). Đã `db:deploy` vào DB dev.
- **Shared**: `packages/shared/src/technical-service.ts`; thêm 2 category vào `reference-catalog.ts`; 4 loại mã `TECH_SERVICE_LAB/IMAGING/FUNCTIONAL` (XN/CD/TD) + `LAB_INDICATOR` (CS) ở `business-code.ts`; nhãn audit.
- **Core**: `packages/core/src/lab/lab-reference.ts` (+ spec 15 test): `selectLabReference`, `evaluateLabValue`, `parseLabNumber`, `formatLabReferenceText`; lỗi `TechnicalServicePriceOverlapError`, `LabIndicatorValueTypeLockedError`; quyền `technical_service.read/create/update` + `result_template.read/manage` (ma trận 4 vai trò); mã ngắn danh mục `NK`/`MB`.
- **API**: `apps/api/src/modules/technical-service/` (3 controller + 3 service + 3 repository + module, `technical-service-http.spec.ts` 30 test); đăng ký `app.module.ts`, `domain-exception.filter.ts`, OpenAPI (`generate-openapi.ts`, đã regenerate `openapi.json` + `openapi-schema.d.ts`); `testing/tenant-fixture.ts` dọn 6 bảng mới; `business-code-http.spec.ts` đếm 24 loại mã.
- **Web**: `apps/web/src/features/paraclinical/` — `CatalogParaclinicalPage` (5 pill), `TechnicalServicePane`, `TechnicalServiceFormDialog`, `LabIndicatorPane`, `ResultTemplatePane`, `paraclinical.api.ts/.queries.ts`, `paraclinical-labels.ts`; route `/admin/catalog-paraclinical` đổi từ `ComingSoonPage`; `admin-permissions.ts` thêm `PARACLINICAL_CATALOG_PERMISSIONS`; `Sidebar.tsx` gate theo quyền thật.
- **Docs**: `DECISIONS.md` #212 (+ phần GĐ1), `CHANGELOG`, `TASK` (mục Cận lâm sàng), `CURRENT`, `ERD.md` v1.64, `data-model.md`, `architecture.md`, `CLAUDE.md`.

**Lệch có chủ đích so với mockup GĐ1** (đã ghi ở #212): bỏ Nhập/Xuất Excel + "Thêm theo nhóm chỉ số"; ẩn pill "Gói dịch vụ" tới GĐ2; thêm bộ chọn `≥/>`, `≤/<` cạnh ngưỡng + dòng phụ "Chữ in trên phiếu" ở bảng tham chiếu; chưa có ô "Diễn giải" cho từng chỉ số của dịch vụ (backend đã lưu `interpretation_text`).

## 3. Kiểm thử đã chạy

- `pnpm -w typecheck` / `lint` (0 lỗi, 8 cảnh báo cũ không liên quan) / `build` sạch; `check-mandatory-columns.mjs` pass; chunk `CatalogParaclinicalPage` lazy 56,6 kB.
- `packages/core` 303/303 (46 file, gồm `lab-reference.spec.ts` 15 test mới), `packages/shared` 31/31, `apps/web` 8/8.
- `apps/api` full suite: **1181 pass / 1 fail / 16 skipped** (67 file). 3 file báo lỗi khi chạy CẢ BỘ (`icd10-http`, `user-account-me-http`, `sync-role-permissions`) — đều là race khi nhiều spec seed vai trò/tenant song song (2 file đầu là flake đã biết từ trước, file thứ 3 quét MỌI tenant trong DB nên dính tenant của spec chạy cùng lúc); **chạy riêng 2 lần liên tiếp đều pass 20/20**. Spec mới `technical-service-http.spec.ts` 30/30; `business-code-http.spec.ts` đã sửa đếm 20→24 loại mã và pass.
- Chưa chạy lại toàn bộ khi có thay đổi cuối cùng ở phần web (chỉ typecheck/lint/build + Chrome thật) — thay đổi cuối chỉ là chỉnh độ rộng cột danh sách.

Chrome thật (Playwright, tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345`): đủ luồng tạo chỉ số HGB kèm 3 khoảng tham chiếu → tạo dịch vụ XN (nhóm, mẫu bệnh phẩm, đơn giá, gắn chỉ số) → "Xem" (chỉ đọc, có nút Sửa) → tạo mẫu kết quả; 0 lỗi console. Script ở scratchpad phiên cũ (`verify-cls-flow.cjs`) có thể mất — viết lại nếu cần (Playwright qua `C:/Projects/NEXAMed/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core`, Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`).

Dữ liệu thử trên tenant test: 2 dịch vụ "Tổng phân tích tế bào máu ngoại vi" (XN2610000001/2), chỉ số HGB (CS2610000001), mẫu "Thiếu máu nhược sắc" ×2–3, danh mục Nhóm "Huyết học"/"Siêu âm", Mẫu bệnh phẩm "Máu EDTA" — tạo qua UI/HTTP, không SQL superuser. Có thể ẩn bớt.

Dev server: web 5173 + api 3001 đang chạy (`pnpm dev` nền) — **không tắt** (chủ dự án dặn). Sau khi thêm permission mới phải `db:seed` **và khởi động lại API** (đồng bộ `role_permission` lúc startup).

## 4. Việc kế tiếp (thứ tự)

1. **PR đã mở (chưa merge):** #1 `feat/print-template` → `master` (mẫu in #211 + Excel thuốc #210 + điều dưỡng xem lịch hẹn #209): https://github.com/phanuy261991-hash/NEXAMed/pull/1 · #2 `feat/paraclinical` → base `feat/print-template` (draft, xếp chồng, chỉ diff GĐ1): https://github.com/phanuy261991-hash/NEXAMed/pull/2. Máy này KHÔNG có `gh`; PR được mở qua REST API với token Git Credential Manager (chủ dự án đã đồng ý cách này) — dùng lại cách đó nếu cần mở PR tiếp (script nằm ở scratchpad phiên cũ, viết lại: `git credential fill` → `POST /repos/phanuy261991-hash/NEXAMed/pulls`, KHÔNG in/ghi token). Sau khi PR #1 merge, đổi base PR #2 sang `master` nếu GitHub chưa tự đổi, rồi bỏ draft. **Trước khi sang GĐ2: hỏi chủ dự án PR #1 đã merge chưa; nếu rồi thì `git checkout master && git pull`, tách nhánh GĐ2 từ `master`.**
2. **GĐ2 — Gói dịch vụ + Bảng giá có thời hạn** (mockup 4, 10, 11): `service_package(_item)`, `price_list(_item)`; hàm thuần `resolveEffectivePrice(mặt hàng, ngày)` ở `packages/core` dùng chung Tiếp nhận / chỉ định / hoá đơn thuốc; pill "Gói dịch vụ" vào `CatalogParaclinicalPage`; trang `/admin/price-lists` ("Bảng giá" trong Quản trị) + ô "Tra thử giá". **Rủi ro cao nhất**: chạm luồng tạo hoá đơn ĐANG CHẠY THẬT tại pilot (Tiếp nhận #080, hoá đơn thuốc #164/#202) — đọc lại các quyết định đó + `invoice` trước khi sửa; cần mockup đã duyệt (có sẵn) nhưng hỏi chốt phạm vi từng bước.
3. **GĐ3 — Chỉ định của bác sĩ** (mockup 5, 9c): `clinical_order(_item)`, tab thứ 3 màn khám, in phiếu chỉ định (dùng `PrintDocument`/`PrintButton` của #211; thêm loại chứng từ mới vào registry `packages/shared/src/print-template.ts`).
4. **GĐ4 — Thực hiện & kết quả** (mockup 6, 7, 8, 9/9b): hàng đợi, lấy mẫu/gọi vào phòng, `lab_result(_value)`/`imaging_result` (bản KÝ, đính chính kèm lý do — khuôn `prescription` C8), **in đậm + gạch chân chỉ số vượt mức**, phiếu kết quả nhiều trang (header + thông tin BN lặp mọi trang, `x/y`, "- KẾT THÚC -", QR tra cứu, chữ ký), vai trò "Kỹ thuật viên", nhóm menu "Cận lâm sàng". Hỗ trợ kết quả dạng CHỮ (Âm tính/Bình thường); đơn vị thứ hai của chỉ số (µmol/L + mg/dL) đã CHỦ ĐỘNG hoãn.

## 5. Bẫy kỹ thuật đã gặp (đừng lặp lại)

- **`apps/web` KHÔNG import được GIÁ TRỊ từ `@nexamed/shared`** (chỉ `import type`) — lỗi "does not provide an export" lúc chạy. Hằng số/hàm dùng ở web phải có bản cục bộ (`paraclinical-labels.ts`, `business-code-preview.ts`, `patient-form.utils`).
- **Bash heredoc chứa tiếng Việt/dấu nháy hay fail im lặng** (cả lệnh không chạy) → dùng công cụ Write tạo file `.py` rồi chạy; sửa file CRLF bằng Python (`newline=''` + chuẩn hoá `\r\n`). Không chạy `prettier --write` trên file lớn.
- Prisma generate KHÔNG bị khoá khi dev server chạy (phiên này chạy được); migration viết tay (không TTY), kiểm bằng `node scripts/check-mandatory-columns.mjs` (đã pass).
- Exclusion constraint Postgres → Prisma trả `PrismaClientUnknownRequestError` (không phải Known) chứa `23P01` + tên constraint.
- Test fixture `tenant-fixture.ts` phải dọn bảng con trước bảng cha (đã thêm 6 bảng).
- Mã dịch vụ mặc định dạng `XN2610000001` (khuôn `<prefix><yyMM><seq6>`) dài hơn mã minh hoạ `XN0001` trong mockup — tenant tự đổi khuôn ở "Cấu hình hệ thống"; có thể đề xuất khuôn mặc định ngắn riêng cho 4 loại mã này nếu chủ dự án muốn.
- Quy tắc UI: nút dùng `Button`/`RowActionButton` chung, nhãn `text-sm font-semibold text-slate-800`, tên người `font-bold`, tránh "AI look" (bảng + đường kẻ), Enter-to-submit (`<form>` + submit), đọc `.claude/docs/ui-guidelines.md` trước khi làm UI.
