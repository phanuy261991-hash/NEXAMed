# Kế hoạch — Tab "Hình ảnh & Tài liệu" ở hồ sơ bệnh nhân

Trạng thái: **mockup ĐÃ CHỐT (13/11/2026); GĐ1 và GĐ2 đã xong (14/11/2026, `docs/DECISIONS.md` #299 bổ sung 1–3), còn GĐ3.** Mockup 14 màn: https://claude.ai/artifact/3kjLBzNBhTNYjGwfJsRSRn (phiên bản 2). Quyết định ghi ở `docs/DECISIONS.md` #299. Bước kế tiếp: GĐ1 (mục 6). Khi build tuân thủ mockup tuyệt đối, không tự lược bỏ gì khi chưa hỏi (mục 8).

## 1. Mục tiêu

Mỗi hồ sơ bệnh nhân có thêm tab **"Hình ảnh & Tài liệu"** — nơi tổng hợp lưu trữ: phim chụp (X-quang, siêu âm…), ảnh răng (nha khoa sau này), hợp đồng/giấy tờ dịch vụ, tài liệu khác. File xếp theo thư mục; ảnh cận lâm sàng cùng một ngày gom vào thư mục tên là ngày upload. Mọi file của một bệnh nhân nằm trong MỘT thư mục của bệnh nhân đó trên kho lưu trữ.

Không thuộc phạm vi: PACS/LIS (v3+), xem DICOM, OCR, chữ ký số lên tài liệu.

## 2. Đã chốt (13/11/2026)

1. **Tên tab**: "Hình ảnh & Tài liệu".
2. **Thư mục**: hai kiểu xem bấm chuyển được trên cùng dữ liệu — mặc định xem theo NGÀY (thư mục tên ngày upload), chuyển sang xem theo LOẠI (Chẩn đoán hình ảnh, Ảnh nha khoa, Hợp đồng/giấy tờ, Khác).
3. **Ảnh/PDF cận lâm sàng**: tự gộp vào tab, KHÔNG nhân đôi file (dòng tham chiếu cùng `storage_key`, chỉ đọc, nhãn "Từ kết quả CLS – tên dịch vụ", có nút mở kết quả; dữ liệu cũ nạp bù bằng migration).
4. **Quyền**: tách quyền riêng cho Hợp đồng/giấy tờ; mặc định quản lý + thu ngân + lễ tân. Ảnh lâm sàng chỉ người có quyền xem hồ sơ khám (`encounter.read_clinical`), lễ tân không thấy (khuôn #234).

5. **Bốn loại tệp ở bản đầu** (theo mockup, thay "Chẩn đoán hình ảnh/Ảnh nha khoa" của bản nháp): Kết quả cận lâm sàng (ảnh CĐHA + PDF đối tác), Ảnh lâm sàng, Hợp đồng và giấy tờ (gồm thẻ BHYT), Khác (gồm ảnh đại diện). "Ảnh nha khoa" thêm khi có gói Nha khoa.
6. **Hộp báo lỗi/cảnh báo** dùng đúng component dùng chung: `ConfirmDialog` (xoá tệp/thư mục, lý do bắt buộc), `SystemFailureDialog` (mất mạng/5xx khi tải lên), `ErrorBanner` (tải danh sách lỗi), lỗi nghiệp vụ 4xx hiện trong hộp (mockup màn 8, 10).

## 3. Hiện trạng đã kiểm (mã nguồn)

- `StoragePort` + `LocalDiskStorageAdapter`: `STORAGE_DIR/<tenantId>/<key>`, key dùng UUID, tên gốc nằm trong DB; đọc qua đường dẫn ký có hạn 60 phút (`/api/v1/files/:token`, `signed-url.ts`); bản đồ content-type của `public-file.controller.ts` chỉ có jpg/png/pdf.
- Nơi đang lưu: ảnh đại diện `patient/<id>/photo/…`; ảnh CĐHA `paraclinical/<resultId>/…` (bảng `paraclinical_result_image`, bất biến sau khi ký, trigger DB chặn); PDF đối tác `lab-partner/<uuid>.pdf` (bảng `lab_partner_result_file`, theo đối tác không theo bệnh nhân). Chưa có thư mục chung theo bệnh nhân.
- Giới hạn hiện hành: ảnh CĐHA 5 MB × 8 ảnh; PDF đối tác 10 MB; nginx `client_max_body_size 8m`; `sniffImageExtension` chỉ nhận jpg/png. `security-audit.md`: chỉ `pdf, jpg, png, dcm`, kiểm magic-byte.
- Sao lưu: dịch vụ `backup` đã đồng bộ cả thư mục storage (`docs/Deploy.md` mục 2.3c) — tính năng mới tự được sao lưu, dung lượng tăng.
- Server không có thư viện xử lý ảnh (không `sharp`); chỉ có `pdf-lib`.
- Tab hồ sơ hiện có: Thông tin cá nhân, Ví tạm ứng, Hồ sơ bệnh án, Lịch sử khám, Kết quả cận lâm sàng (`PatientDetailPage.tsx`).

## 4. Thiết kế đề xuất

**Lưu trữ**
- Khoá file mới: `patient/<patientId>/documents/<uuid>.<ext>` (một thư mục của bệnh nhân; ảnh đại diện đã ở `patient/<id>/photo/`). KHÔNG đưa ngày hay tên thư mục tự tạo vào đường dẫn đĩa.
- Thư mục là **thư mục ảo trong DB**: đổi tên/chuyển thư mục không đụng file thật, không dính ký tự tiếng Việt hay path traversal, đổi sang S3/MinIO không phải sửa gì.
- Thư mục ngày KHÔNG có bản ghi riêng: nhóm lúc đọc theo cột `upload_date` (ngày giờ Việt Nam, tính bằng hàm dùng chung ở `packages/core/src/date/`, cấm viết cứng `+07:00`).

**Dữ liệu** (đủ 8 cột bắt buộc, RLS, xoá mềm kèm `deleted_reason`)
- `patient_document`: `patient_id`, `folder_id` (null = chưa vào thư mục tự tạo), `category` (enum), `storage_key`, `file_name`, `content_type`, `size_bytes`, `sha256`, `note`, `encounter_id` (tuỳ chọn), `uploaded_at`, `upload_date`, `branch_id` (nơi upload), `source_type`/`source_id` (null = tải tay; trỏ về kết quả CLS/PDF đối tác khi tự gộp), `thumbnail_key` (tuỳ chọn).
- `patient_document_folder`: thư mục tự tạo (tên, `patient_id`), thư mục không lồng nhau ở bản đầu.
- Dòng tham chiếu CLS: chỉ đọc; muốn gỡ phải đính chính ở kết quả (kết quả đã ký là bất biến). Khi kết quả CLS được thêm ảnh/PDF, ghi thêm dòng tham chiếu trong cùng transaction. Migration nạp bù dữ liệu cũ, không di chuyển file.

**Giao diện**
- Tải lên nhiều file (kéo thả + nút chọn); trên máy tính bảng dùng `<input type="file" accept="image/*" capture>` — chạy được ở HTTP LAN (không dùng `getUserMedia`).
- Hai kiểu xem (Ngày/Loại), thư mục tự tạo, xem lớn (ảnh + PDF), tải về, đổi tên/ghi chú/chuyển thư mục, xoá mềm có lý do, tìm + lọc loại/ngày, gắn lượt khám.
- Thanh lọc, dải số, bảng: theo `ui-guidelines.md`; lỗi tải/ghi theo checklist mục 17b (giữ nguyên dữ liệu đang nhập).
- Kiểm bằng Chrome thật qua IP LAN HTTP; kiểm nhiều cỡ màn hình.

**Máy chủ**
- Endpoint đa phần: liệt kê (phân trang, theo ngày/loại), tải lên (multipart, nhiều file), sửa tên/ghi chú/thư mục, xoá mềm, lấy đường dẫn ký.
- Kiểm magic-byte cho jpg/png/pdf (thêm `sniff` cho PDF dùng chung; hiện PDF đối tác kiểm riêng), không tin `Content-Type`.
- Mọi POST đã tự có `Idempotency-Key` (#257). Không gọi port bên trong `runInTenantScope()` (#264): lưu file TRƯỚC khi mở transaction, ghi DB trong transaction, ghi DB lỗi thì dọn file (khuôn `addImage` của CLS).
- Audit: nhãn tiếng Việt cho mọi action/entityType (test `audit-labels-coverage.spec.ts` chặn), `@AuditView` cho GET chi tiết; không ghi tên file vào log (PII).

**Quyền** (mới, nhãn ở `permission-grouping`, `db:seed`, `role-access-sweep`, thử vai trò không quyền)
- `patient_document.read` / `.upload` / `.delete` cho ảnh/tài liệu lâm sàng (nhóm quyền xem hồ sơ khám).
- Quyền riêng cho loại Hợp đồng/giấy tờ (đọc/tải lên/xoá); mặc định quản lý + thu ngân + lễ tân.

**Chi nhánh** (4 câu #231)
1. Dữ liệu đi theo BỆNH NHÂN → CHUNG cả công ty.
2. Có `branch_id NOT NULL` ghi nơi upload (composite FK `(tenant_id, branch_id)`), dùng để hiển thị, không để lọc mất file.
3. Xem liên chi nhánh khi mở đúng hồ sơ bệnh nhân (như lịch sử khám); riêng Hợp đồng — chờ chốt (mục 5).
4. Công ty 1 chi nhánh: ẩn cột chi nhánh. Cần test cô lập 2 chi nhánh + tenant B.

**LAN HTTP on-prem** (#257): không `crypto.randomUUID` trần (dùng `generateUuid()`), không `navigator.clipboard`, không CDN cho trình xem; PDF/ảnh phục vụ cùng nguồn gốc qua `/api/v1/files/`.

## 5. Mặc định ĐÃ CHỐT cùng mockup (13/11/2026: "chốt mockup" gồm cả bảng mặc định cuối trang mockup)

1. Giới hạn **15 MB mỗi file** (đường upload của tính năng này được nginx cho phép lớn hơn 8m; các endpoint khác giữ nguyên); trình duyệt tự thu nhỏ ảnh quá lớn.
2. **Ảnh thu nhỏ tạo ở trình duyệt** lúc upload (canvas, gửi kèm ~20 KB), không thêm `sharp`/thư viện native ở máy chủ.
3. **DICOM (`.dcm`)** bản đầu chỉ lưu + tải về; trình xem DICOM (cần thư viện nặng) làm sau cùng PACS/LIS.
4. **Hợp đồng/giấy tờ liên chi nhánh**: đề xuất xem được ở mọi chi nhánh người dùng được gán (không phải "che" như tiền của chi nhánh không được gán) — cần chủ dự án xác nhận vì hợp đồng gắn tiền.
5. **Công tắc** "Dùng Hình ảnh & Tài liệu" ở Cấu hình chung (mặc định BẬT, tắt thì ẩn tab và máy chủ 409), theo mẫu `followUpEnabled` #285.
6. Hiển thị dung lượng đã dùng ở Cấu hình hệ thống (để nhắc ổ sao lưu đầy); hạn mức theo công ty cho SaaS để sau.

## 5b. Quy tắc cho chức năng TƯƠNG LAI — mọi hình ảnh/tài liệu của bệnh nhân phải về tab này (chủ dự án chốt 13/11/2026)

Tab "Hình ảnh & Tài liệu" là **nơi tổng hợp duy nhất** của mọi hình ảnh/tài liệu liên quan bệnh nhân hoặc phát sinh trong quá trình khám. Khi lên kế hoạch hoặc code bất kỳ chức năng nào có lưu file gắn với bệnh nhân, **phải trả lời câu hỏi: file này có hiện ở tab không, bằng cách nào?** Cách đưa về tab: file mới lưu vào `patient/<patientId>/documents/…` và ghi `patient_document`; hoặc file nằm chỗ khác thì ghi thêm dòng tham chiếu chỉ đọc (cùng `storage_key`, `source_type`/`source_id`), không nhân đôi file.

Đã có chỗ lưu riêng, sẽ gộp về tab dạng THAM CHIẾU CHỈ ĐỌC (làm khi có chức năng/giai đoạn tương ứng, sửa/xoá vẫn ở chỗ gốc):
- Ảnh thẻ BHYT (`patient/<id>/insurance/…`, nhãn "Thẻ BHYT"; tôn trọng công tắc "Áp dụng BHYT" và quy tắc số thẻ mã hoá).
- Ảnh đại diện bệnh nhân (`patient/<id>/photo/`, nhãn "Ảnh đại diện").
- Ảnh/PDF kết quả cận lâm sàng và PDF đối tác (đã chốt ở mục 2, GĐ2).

Chức năng sẽ có sau — ghi lại để không quên gộp về tab:
- **Nút "Đính ảnh" ngay trong màn khám** (chụp/đính ảnh lâm sàng: vết thương, da liễu, răng): tải thẳng vào tab, gắn sẵn lượt khám (`encounter_id`). Dự kiến GĐ3.
- Gói **Nha khoa**: ảnh răng theo vị trí răng/sơ đồ răng, phim panorama/cephalometric, ảnh trước-sau niềng.
- Gói **Sản khoa**: ảnh siêu âm thai (nếu khác luồng CLS thông thường).
- Trình xem **DICOM** / tích hợp PACS (v3+).
- Hợp đồng/báo giá điều trị khi có module viện phí (v2), ảnh phiếu đồng ý (consent) nếu làm.
- Bất kỳ chức năng mới nào khác có đính file vào bệnh nhân (ví dụ giấy chuyển tuyến, giấy ra viện scan).

Khi code những chức năng trên: dùng chung một service ghi `patient_document` (đừng mỗi nơi tự lưu file rời), và thêm vào checklist chức năng mới ("file bệnh nhân → đã về tab chưa").

## 6. Lộ trình

- **GĐ1** — Nền: migration + bảng, quyền, API liệt kê/tải lên/sửa/xoá mềm, tab web (xem theo Ngày + Loại, thư mục tự tạo, xem lớn). Test API (cô lập tenant B + chi nhánh, đột biến), Chrome IP LAN.
- **GĐ2** — Tự gộp ảnh/PDF cận lâm sàng + thẻ BHYT + ảnh đại diện thành dòng tham chiếu chỉ đọc. **XONG 14/11/2026**; khác kế hoạch ban đầu: thay "ghi dòng trong transaction của nguồn + migration nạp bù" bằng tab tự đối chiếu nguồn mỗi lần mở trang đầu (#299 bổ sung 3).
- **GĐ3** — Ảnh thu nhỏ, lọc/tìm nâng cao, ghi dung lượng, công tắc, tài liệu hướng dẫn (`docs/pilot-onboarding.md`).
- **Sau**: xem DICOM, sơ đồ răng/ảnh theo vị trí răng (cùng gói Nha khoa, đang bị chặn bởi module viện phí).

## 7. Quy trình trước khi code

(Mockup đã xong và chốt 13/11/2026, 14 màn — xem đầu file.) Mockup gồm (đủ mọi màn: tab Xem theo Ngày, Xem theo Loại, hộp tải lên, xem lớn, hộp tạo/đổi tên thư mục, hộp xoá, trạng thái rỗng/lỗi, dòng tham chiếu CLS, màn khi không đủ quyền) → chủ dự án duyệt rõ ("ok làm đi") → ghi DECISIONS #299 + ERD (`docs/ERD-2.md`) → code. Đối chiếu từng phần tử mockup trước khi báo xong.

## 8. Quy tắc khi build (chủ dự án nhắc lại 13/11/2026)

Tuân thủ mockup tuyệt đối: KHÔNG tự lược bỏ, thu gọn, hoãn hay đổi bất kỳ phần tử nào của 14 màn (cột, nút, dải thông báo, trạng thái, nhãn, hộp thoại) khi chưa hỏi chủ dự án. Muốn bỏ, hoãn hoặc làm khác thì dừng lại, hỏi bằng câu hỏi lựa chọn rồi mới làm. Trước khi báo xong từng màn: đối chiếu từng phần tử từ HTML thô của mockup với bản thật và liệt kê mọi chỗ lệch. Phần nào của mockup chưa dựng kịp thì nói rõ, không ẩn lặng lẽ.
