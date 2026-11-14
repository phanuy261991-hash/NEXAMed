# HANDOFF — Tab "Hình ảnh & Tài liệu" ở hồ sơ bệnh nhân, giai đoạn 1 XONG — 2026-11-14

## 1. Trạng thái một câu
**GĐ1 của tab "Hình ảnh & Tài liệu" (DECISIONS #299) đã XONG và đã commit + push** (backend + web 12 màn mockup + gộp hồ sơ + 3 việc chủ dự án chốt thêm). Không có việc dở trong code. Kế tiếp: **GĐ2** (tự gộp ảnh/PDF cận lâm sàng, thẻ BHYT, ảnh đại diện) rồi **GĐ3** (ảnh thu nhỏ riêng, công tắc, dung lượng).

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục "Tab Hình ảnh & Tài liệu" cuối file), `docs/DECISIONS.md` cuối file (#299 + bổ sung 1–2), `docs/product/patient-documents-plan.md`, file này.
2. Hỏi chủ dự án làm GĐ2 hay việc khác; xem 2 chỗ "khác mockup" cần chốt ở mục 5.
3. Môi trường khác (không phải máy dev) cần: `pnpm install`, `pnpm db:deploy` (2 migration mới nhất `20261113120000_patient_document`, `20261114100000_patient_document_name_unique`), `pnpm db:seed` (6 quyền mới), khởi động lại API.

## 3. Đã làm
- **Dữ liệu**: bảng `patient_document` + `patient_document_folder` (FORCE RLS, xoá mềm, chỉ mục duy nhất tên thư mục và tên tệp tải tay). `docs/ERD-3.md` mục 3.26 (ERD-2 đã quá ngưỡng ~80 KB nên mở file mới), ERD v1.99.
- **Máy chủ** (`apps/api/src/modules/patient-document/`): tải lên MỘT tệp mỗi lần (JPG/PNG/PDF/DICOM, magic byte ở `packages/core/src/storage/sniff-document-kind.ts`, ≤ 15 MB), danh sách con trỏ + tổng quan + thư mục + quyền, sửa (khoá lạc quan), xoá mềm có lý do, thư mục tự tạo, nhật ký có nhãn tiếng Việt không ghi tên tệp. Khoá đĩa `patient/<patientId>/documents/<uuid>.<ext>`; thư mục "ngày" nhóm lúc đọc theo `upload_date` (giờ VN). Gộp hồ sơ chuyển tệp + thư mục (`PatientDocumentRepository.moveAll`, trùng tên thêm hậu tố "(từ hồ sơ gộp)").
- **Quyền** (hai nhóm độc lập): `patient_document.read/upload/delete` (tệp lâm sàng) và `patient_contract.read/upload/delete` (hợp đồng và giấy tờ). Mặc định: quản lý cả hai; bác sĩ lâm sàng đủ 3; điều dưỡng đọc + tải; lễ tân chỉ hợp đồng. Nhãn ở `permission-grouping.ts`, `permission-companions.ts`.
- **Web** (`apps/web/src/features/patient-document/`): `PatientDocumentsTab` (hai kiểu xem Theo ngày/Theo loại, thư mục tự tạo), `DocumentDayView`, `DocumentTypeRoot`, `DocumentTable`, `DocumentUploadDialog`, `DocumentViewerDialog` (xem lớn + chi tiết tệp), `DocumentEditDialog`, `DocumentFolderDialogs`. Gắn vào `PatientDetailPage` (tab hiện khi có một trong hai quyền xem).
- **3 việc chốt thêm (bổ sung 2)**: ảnh JPG/PNG > 15 MB TỰ THU NHỎ ở trình duyệt (`shrink-image.ts`); tải tệp có khoá chống ghi trùng (`PatientDocumentService.uploadOnce`, `IdempotencyModule` nay export `IdempotencyService`); KHÔNG trùng tên tệp trong cùng bệnh nhân.
- **OpenAPI** đã đăng ký 8 đường dẫn (`apps/api/scripts/generate-openapi.ts`), schema web đã sinh lại.

## 4. Kiểm đã chạy
Full API **2390 xanh** (1 bỏ qua), core 893, shared 136, web 808, `pnpm typecheck` + `pnpm lint` sạch. API `patient-document-http.spec.ts` 26 ca (cô lập công ty khác + chi nhánh khác, hai nhóm quyền, magic byte, phân trang, khoá lạc quan, gộp hồ sơ, trùng tên, phát lại khoá). **Đột biến 3/3 bị bắt.** Chrome thật qua IP LAN `scripts/ui-audit/patient-document-check.cjs` **32/32** (kể cả mất mạng khi tải lên, gửi lại sau khi máy chủ đã ghi, lễ tân chỉ thấy hợp đồng).

## 5. Việc còn / cần chủ dự án
- **Chỗ khác mockup** (DECISIONS #299 bổ sung 1): nút trái hộp xoá tệp là "Đóng" (do `ReasonConfirmDialog` dùng chung); "Chuyển" và "Chuyển thư mục" mở cùng hộp Sửa; thêm nút "Xoá thư mục" (mockup không vẽ chỗ bấm); không có nhãn "trang 1/2" cho PDF; hình thu nhỏ đang là chính ảnh gốc (GĐ3). **Chưa xác nhận PDF vẽ đúng trong khung** vì Chrome chạy ngầm không vẽ được PDF — cần xem bằng Chrome có giao diện.
- **GĐ2**: dòng THAM CHIẾU chỉ đọc cùng `storage_key` (không nhân đôi tệp) cho ảnh CĐHA + PDF đối tác (`lab_partner_result_file`) + ảnh thẻ BHYT (`patient/<id>/insurance/…`, tôn trọng công tắc "Áp dụng BHYT") + ảnh đại diện (`patient/<id>/photo/`), migration nạp bù dữ liệu cũ, nút "Mở kết quả" ở xem lớn. Enum `patient_document_source` đã có sẵn đủ 5 giá trị.
- **GĐ3**: ảnh thu nhỏ tạo ở trình duyệt, lọc/tìm nâng cao, công tắc "Dùng Hình ảnh & Tài liệu" (mẫu `followUpEnabled`), dung lượng đã dùng ở Cấu hình chung (mockup màn 13), `docs/pilot-onboarding.md`.
- **Quy tắc thường trực**: mọi chức năng sau này có lưu file gắn bệnh nhân (nút "Đính ảnh" trong màn khám, Nha khoa/Sản khoa, DICOM/PACS, hợp đồng viện phí, phiếu đồng ý, giấy chuyển tuyến…) phải gộp về tab này qua một service dùng chung.
- Chưa thêm `docs/ERD-3.md` vào danh sách tài liệu của `CLAUDE.md` (hỏi chủ dự án có muốn không).
- Quét quyền theo vai trò (`role-access-sweep.cjs`) chưa chạy lại với 2 module quyền mới; nên chạy trước khi giao khách.

## 6. Bẫy đã gặp (đọc trước khi làm)
- **`apps/web` chỉ được import KIỂU từ `@nexamed/shared`** (ESLint chặn): hằng khai lại ở `patient-document-constants.ts`; `patient-document-constants-drift.spec.ts` (ở API) giữ hai bản khớp nhau — sửa `packages/shared/src/patient-document.ts` thì sửa cả file web.
- **Patch script chạy hai lần chèn trùng** — kiểm `grep -c` sau khi vá. Lệnh shell nhiều dòng có nháy/backtick hay lỗi: dùng Write + `node file.cjs` (đã gặp 4 lần).
- **Migration đã áp không sửa**: tên tệp duy nhất làm bằng migration MỚI, không sửa `20261113120000`.
- **`tenant-fixture.ts` cleanup** phải xoá `patient_document` + thư mục TRƯỚC encounter/patient (đã sửa).
- **Playwright route** khớp URL không có query: regex `/\/documents(\?.*)?$/` (glob `**/documents?*` không khớp `…/documents`).
- Kiểm Chrome: `pnpm --filter @nexamed/api run dev` + `node scripts/dev-lan.mjs`, tắt xong kiểm `apps/web/public/config.json` còn `apiBaseUrl: http://localhost:3001` và không còn `config.json.lan-backup`. `playwright-core` cài ở thư mục tạm, KHÔNG đưa vào repo. Dữ liệu thử tiền tố `KIEMTAILIEU` ở công ty thử.
- Tải tệp đi qua XMLHttpRequest (có tiến độ), không qua `uploadFile`; khoá chống ghi trùng cho multipart nằm ở service, KHÔNG ở interceptor toàn cục.

## 7. Quy tắc chủ dự án nhắc (đã ghi memory)
- **Tuân thủ mockup tuyệt đối, không tự lược bỏ khi chưa hỏi**; đối chiếu từng phần tử trước khi báo xong.
- Commit/push thẳng `master`, không PR.
