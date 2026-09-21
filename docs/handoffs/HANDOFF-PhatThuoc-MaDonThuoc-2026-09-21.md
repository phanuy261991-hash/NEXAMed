# Handoff — "Mã đơn thuốc thật" + khối thông tin BS kê đơn/Ngày kê/Chẩn đoán trên giao diện Phát thuốc

**Ngày ghi**: 21/09/2026. **Trạng thái**: đã chốt phạm vi qua `AskUserQuestion` với chủ dự án, **CHƯA VIẾT DÒNG CODE NÀO**. Đọc kèm `docs/DECISIONS.md` #168 (bối cảnh đầy đủ của phiên vừa xong — sửa bug Đổi mật khẩu, redesign Phát thuốc, hiển thị Tồn kho, sửa OTC, guard `isBatchManaged`).

## Bối cảnh

Khi hỏi "tại sao không hiển thị mã đơn thuốc trên giao diện kê đơn", điều tra ra: bảng `prescription` **chưa từng có cột mã hiển thị nào** (không giống `patient.patientCode`/`encounter.encounterNo`). Mã kiểu `DT-2609-0341` chủ dự án nhớ chỉ là **mockup minh hoạ** ở #163 (Artifact `EFrHTSWbDiZrA2uLhpCXtK`), chưa từng được code thật. Chủ dự án gửi ảnh tham khảo (khối "Mã đơn thuốc: DT-883921 / BS Kê đơn: BS.CKI Phạm Minh Đức / Ngày kê: 21/09/2026 - 09:30" cạnh khung vàng "Chẩn đoán lâm sàng") và yêu cầu thêm lên giao diện "Phát thuốc" (`DispensePrescriptionDialog.tsx`).

Đã hỏi và chốt: **làm mã đơn thuốc THẬT** (không bỏ qua), cần migration.

## Việc cần làm — 3 phần

### 1. Migration + sinh mã (schema thay đổi thật — đọc kỹ trước khi code)

- Thêm cột `prescription.prescription_no` (kiểu giống `encounter.encounter_no`/`stock_issue.issue_no` — text, unique theo `(tenant_id, prescription_no)`).
- Đăng ký `codeType` mới ở `BusinessCodeService` (đúng khuôn `STOCK_ISSUE`→`PNK`/`STOCK_RECEIPT`, xem `apps/api/src/modules/clinic/business-code.service.ts`) — tiền tố gợi ý `DT` (Đơn thuốc), định dạng `<prefix><yyMM><seq>` đồng nhất các mã khác trong hệ thống (KHÔNG bịa định dạng `DT-883921` trong ảnh tham khảo — đó chỉ là ảnh minh hoạ của chủ dự án, không phải đặc tả).
- **Sinh mã lúc KÝ đơn** (`EncounterService.signPrescription()`, không phải lúc tạo nháp — đơn nháp có thể sửa/xoá nhiều lần, không cần mã; đúng nguyên tắc "đơn thuốc là y lệnh" #146 — mã chỉ có ý nghĩa khi đã ký).
- **Backfill đơn cũ đã ký** chưa có mã (script migration hoặc `db:seed`-style, xem tiền lệ `20260916140000_drug_manufacturer_catalog_backfill`).
- Cân nhắc: đơn đính chính (`amend()`, tạo bản mới ĐÃ KÝ NGAY theo #146) có cần mã MỚI hay giữ mã gốc? Gợi ý: **giữ mã gốc** (đính chính là bản sửa của cùng 1 y lệnh, không phải đơn mới) — nhưng đây là quyết định nghiệp vụ, **hỏi lại chủ dự án nếu không chắc**, không tự suy diễn.
- Thêm `prescriptionNo` vào `packages/shared` (schema đơn thuốc hiện có, tìm `prescriptionResponseSchema`/tương đương ở `packages/shared/src/prescription.ts` hoặc file đơn thuốc liên quan).

### 2. Mở rộng API — KHÔNG cần schema mới (đơn giản hơn phần 1)

Mở rộng `GetPrescriptionDispenseStatusResponse` (`packages/shared/src/inventory.ts`, đã có field `prescriptionId`/`encounterId`/`signedAt`/`lines` — vừa thêm `warehouseStockOnHand` ở phiên trước, xem #168) thêm 2 field cấp đơn (không phải cấp dòng thuốc):

- `prescriptionNo: string | null` — từ phần 1 ở trên (null nếu backfill chưa chạy/lỗi, không nên xảy ra sau backfill).
- `signedByName: string | null` — tên bác sĩ ký, resolve `prescription.signedBy` qua `DoctorDirectoryPort.getUserFullNames()` (đã dùng ở nhiều nơi, ví dụ `StockIssueService.getById()`).
- `primaryDiagnosisLabel: string | null` — chẩn đoán CHÍNH của lượt khám (`diagnosis` table, `type='PRIMARY'`, đã có từ S3-05) — format `"{tên bệnh} ({mã ICD-10})"`, tham khảo cách `EncounterHistoryItem`/panel tiền sử đang hiển thị chẩn đoán chính ở đâu đó trong `encounter` module để tái dùng đúng cách format, không viết lại.

Sửa `StockIssueService.getDispenseStatus()` (`apps/api/src/modules/inventory/stock-issue.service.ts`) — thêm 2-3 query nhỏ, KHÔNG đổi cấu trúc `lines` hiện có.

### 3. Giao diện — thêm khối thông tin vào `DispensePrescriptionDialog.tsx`

Theo đúng bố cục ảnh chủ dự án gửi (lưu ở lịch sử chat phiên trước, không có file — mô tả lại): 2 khối cạnh nhau ngay dưới `ModalHeader`, TRÊN danh sách dòng thuốc:
- **Khối trái** (nền trắng/viền nhạt): "Mã đơn thuốc: {prescriptionNo}" / "BS Kê đơn: {signedByName}" / "Ngày kê: {signedAt định dạng DD/MM/YYYY - HH:mm}".
- **Khối phải** (nền vàng nhạt `bg-amber-50` viền `border-amber-200`, giống khung cảnh báo): "Chẩn đoán lâm sàng" (tiêu đề) + `{primaryDiagnosisLabel}`.

Đặt cạnh nhau `grid grid-cols-1 sm:grid-cols-2 gap-3` hoặc `flex gap-3`, tuỳ độ dài nội dung thực tế lúc code — **không có mockup Artifact chính thức cho khối này**, tự ước lượng theo đúng token màu/spacing ở `.claude/docs/ui-guidelines.md` (đã đọc ở phiên trước), KHÔNG cần dựng lại Artifact riêng cho việc nhỏ này trừ khi muốn chắc chắn trước khi code.

## Việc KHÔNG làm (ngoài phạm vi đã chốt)

- Không đổi định dạng `signedAt` hiện có ở nơi khác (subtitle `ModalHeader` vẫn dùng label cũ "Đã ký ...").
- Không động vào `DispenseQueuePage.tsx` (trang danh sách hàng đợi) trừ khi muốn hiện thêm cột `prescriptionNo` — chưa được yêu cầu, để dành nếu chủ dự án hỏi tiếp.

## Xác minh khi xong

- `apps/api`: test mới cho sinh mã lúc ký + backfill; test `getDispenseStatus` trả đúng 3 field mới.
- `pnpm -w typecheck/lint/build` sạch toàn workspace; OpenAPI + web codegen sinh lại (đổi contract).
- Playwright/Chrome thật xác nhận khối thông tin hiện đúng, kèm luôn việc **verify Playwright còn nợ từ phiên trước** cho "Tồn kho hiển thị" + "mua thêm OTC" (xem #168) — làm chung 1 lượt cho đỡ mất công dựng lại dữ liệu test.
