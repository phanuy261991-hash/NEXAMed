# HANDOFF — Tab "Hình ảnh & Tài liệu", giai đoạn 2 XONG — 2026-11-14 (phần 2)

## 1. Trạng thái một câu
**GĐ2 (DECISIONS #299 bổ sung 3) đã code + test + kiểm Chrome thật xong, CHƯA COMMIT.** Ảnh/PDF kết quả cận lâm sàng đã duyệt, ảnh thẻ BHYT và ảnh đại diện tự hiện ở tab dạng dòng tham chiếu chỉ đọc. Kế tiếp: **GĐ3** (ảnh thu nhỏ riêng, lọc/tìm nâng cao, công tắc "Dùng Hình ảnh & Tài liệu" + dung lượng đã dùng ở Cấu hình chung, `docs/pilot-onboarding.md`).

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #299), `docs/DECISIONS.md` cuối file (#299 bổ sung 1–3), `docs/product/patient-documents-plan.md`, file này.
2. Hỏi chủ dự án: commit + push GĐ2 chưa; làm GĐ3 hay việc khác; mục 4 bên dưới.
3. Môi trường khác cần: `pnpm install`, `pnpm db:deploy` (migration mới nhất `20261114120000_patient_document_reference_unique`), khởi động lại API. Không cần `db:seed`.

## 3. Đã làm
- **Cách làm (khác kế hoạch gốc, đã ghi ở DECISIONS #299 bổ sung 3)**: không chèn lệnh ghi vào 4 module nguồn và không có migration nạp bù. `PatientDocumentService.list` (chỉ trang ĐẦU, không có con trỏ) gọi `PatientDocumentReferenceSync.sync` trong cùng transaction: đọc các nguồn, so với dòng tham chiếu hiện có bằng hàm thuần `planReferenceSync` (`packages/core/src/patient-document/`), rồi thêm/cập nhật/gỡ mềm. Dữ liệu cũ tự xuất hiện ở lần mở tab đầu tiên của từng bệnh nhân.
- **Nguồn**: ảnh/PDF của `paraclinical_result_image` thuộc kết quả đã ký và còn hiệu lực (PDF đối tác đã là một ảnh của kết quả nên không cần nguồn `LAB_PARTNER_RESULT`); `insurance_card.photo_front_key/photo_back_key` (chỉ khi công tắc "Áp dụng BHYT" bật); `patient.photo_key`. Dung lượng thẻ/ảnh đại diện đọc từ kho lần đầu; người đặt + ngày lấy từ nhật ký kiểm toán.
- **Một tệp gốc một dòng** (chỉ mục duy nhất `patient_document_reference_key`); gộp hồ sơ gỡ mềm dòng tham chiếu của hồ sơ nguồn (không chuyển).
- **Máy chủ**: `patient-document-reference.repository.ts` (SQL đọc nguồn/ghi dòng), `patient-document-reference-sync.service.ts`, `patient-document.service.ts` (gọi sync, trả `sourceLabel` + `sourceRef`, ảnh thẻ/ảnh đại diện không hiện chi nhánh), `patient-document.repository.ts` (`moveAll`). **Shared**: `patientDocumentSchema` thêm `sourceLabel`, `sourceRef {orderItemId, encounterId, group}`.
- **Web**: `DocumentTable`, `DocumentViewerDialog`, `PatientDocumentsTab`, `patient-document-view.ts` — cột Nguồn, nút "Mở kết quả" (mở `ParaclinicalResultViewDialog`, chỉ khi `useCanSeePatientParaclinicalTab`), câu giải thích dòng chỉ đọc.
- **Kiểm**: API `patient-document-reference-http.spec.ts` 14 ca + đột biến 9/9 bị bắt (`src/testing/cls-result-fixture.ts` dựng kết quả cận lâm sàng dùng chung); ca GĐ1 "chỉ đọc" viết lại bằng dữ liệu thật; core +7; web +2; Chrome IP LAN `scripts/ui-audit/patient-document-reference-check.cjs` 31/31 (dữ liệu dựng bằng API thật, tiền tố KIEMGD2); `pnpm typecheck` + `pnpm lint` sạch; OpenAPI + kiểu web đã sinh lại.

## 4. Việc còn / cần chủ dự án
- **Chủ dự án xem**: (a) cách đồng bộ thay vì migration nạp bù (DECISIONS #299 bổ sung 3, mục "Chỗ khác kế hoạch gốc"); (b) 3 chỗ khác mockup của GĐ2 ở cùng mục; (c) giới hạn đã biết: phạm vi theo Khoa/Phòng của `lab_result`/`imaging_result` không áp lên danh sách tài liệu; (d) 5 chỗ khác mockup của GĐ1 và việc xem PDF trong khung bằng Chrome có giao diện (còn treo từ GĐ1).
- **GĐ3** như mục 1. Quy tắc thường trực không đổi: mọi file gắn bệnh nhân làm sau phải gộp về tab này (nút "Đính ảnh" trong màn khám, Nha khoa/Sản khoa, DICOM/PACS...).
- Chưa chạy lại quét quyền theo vai trò (`role-access-sweep.cjs`) với 2 nhóm quyền `patient_document.*`/`patient_contract.*`; nên chạy trước khi giao khách.
- Chưa thêm `docs/ERD-3.md` vào danh sách tài liệu của `CLAUDE.md` (hỏi chủ dự án).

## 5. Bẫy đã gặp (đọc trước khi làm)
- **Shell ăn dấu `\`** (lần thứ 5): regex `\d`, `\/` trong script vá chạy qua heredoc/`node file.cjs` vẫn bị mất — vá bằng công cụ Edit rồi `node --check`.
- **Kiểm Chrome cần dữ liệu thật tạo qua API** (không ghi thẳng CSDL bằng role cao — quy tắc đã ghi); luồng dựng kết quả: tạo dịch vụ → `reception/direct` → bác sĩ `start` → `PUT clinical-orders` → thu tiền → `paraclinical/imaging/start` → `POST .../items/:id/images` → `POST .../items/:id/result/approve`.
- **Kiểm lỗi mạng của một hộp**: bộ nhớ đệm (react-query) làm phiếu đã mở hiện lại không lỗi — phải tải lại trang trước khi chặn mạng, và chặn theo `/api/v1/paraclinical/` (đường dẫn đọc theo hồ sơ khác đường dẫn theo dịch vụ).
- **Tắt `dev-lan` bằng `taskkill /T` thì `config.json` KHÔNG được trả về** — khôi phục tay từ `apps/web/public/config.json.lan-backup` rồi xoá file sao lưu (đã làm; kiểm `git status apps/web/public` sạch).
- **Cổng 3001 từng chạy `dist/main` bản cũ** nên phải `pnpm --filter @nexamed/api build` rồi chạy lại để kiểm bằng mã mới. Sau phiên này API KHÔNG còn chạy (tắt để chạy full test).
- **Kiểm đột biến** (`scratchpad/mutate.cjs` mẫu): mỗi đột biến sửa một file, chạy spec, khôi phục trong `finally`. Một đột biến sống sót từng lộ lỗ hổng test (người xem ở chi nhánh mặc định che mất lỗi chi nhánh) — luôn kiểm cả người xem ở chi nhánh KHÔNG phải mặc định.
- Trigger DB chặn gỡ/sửa ảnh của kết quả đã ký — spec dựng dữ liệu theo đúng thứ tự: kết quả nháp → thêm ảnh → ký.

## 6. Quy tắc chủ dự án nhắc (đã ghi memory)
- Tuân thủ mockup tuyệt đối, đối chiếu từng phần tử; commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt.
