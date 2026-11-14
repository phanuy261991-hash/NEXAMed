# ERD — phần 3 (nhóm bảng mới từ 14/11/2026)

Phần tiếp của `docs/ERD-2.md` (file đó đã quá ngưỡng ~80 KB nên nhóm bảng mới ghi ở đây). Quy ước chung, 8 cột bắt buộc và nhóm bảng nền: xem `docs/ERD.md`.

### 3.26 Hình ảnh & Tài liệu của bệnh nhân (v1.99, `docs/DECISIONS.md` #299, giai đoạn 1)

Migration `20261113120000_patient_document` (FORCE RLS ngay trong migration). Tệp nằm NGOÀI DB (`StoragePort`, khoá `patient/<patientId>/documents/<uuid>.<ext>`); bảng chỉ giữ khoá lưu và thông tin hiển thị. Dữ liệu đi theo BỆNH NHÂN nên CHUNG cả công ty (xem được ở mọi chi nhánh); `branch_id` chỉ ghi chi nhánh nơi tải lên. Thư mục "ngày" KHÔNG có bản ghi: nhóm lúc đọc theo `upload_date` (ngày Việt Nam do server tính một lần). Chỉ thư mục tự tạo có bảng riêng.

| Bảng | Vai trò | Đặc thù |
|---|---|---|
| `patient_document` | Một tệp của bệnh nhân | `patient_id`, `branch_id` NOT NULL (FK ghép), `folder_id` NULL (thư mục tự tạo), `encounter_id` NULL, `category` (enum), `source_type` + `source_id` (UPLOAD = tải tay, không có nguồn; loại khác = dòng THAM CHIẾU chỉ đọc, giai đoạn 2), `storage_key`, `file_name` (tên gốc), `display_name` (sửa được, 1–200 ký tự), `content_type`, `size_bytes`, `sha256` NULL (64 ký tự hex), `note`, `uploaded_at`, `upload_date` DATE |
| `patient_document_folder` | Thư mục tự tạo của MỘT bệnh nhân (không lồng nhau) | `name` 1–60 ký tự; chỉ mục duy nhất `(tenant_id, patient_id, lower(btrim(name)))` khi chưa xoá mềm |

Enum DB mới: `patient_document_category` (PARACLINICAL, CLINICAL_PHOTO, CONTRACT, OTHER), `patient_document_source` (UPLOAD, PARACLINICAL_IMAGE, LAB_PARTNER_RESULT, INSURANCE_CARD, PATIENT_PHOTO). CHECK `(source_type = 'UPLOAD') = (source_id IS NULL)`. Xoá MỀM kèm `deleted_reason`, tệp trên đĩa giữ nguyên. Chỉ mục danh sách `(tenant_id, patient_id, upload_date DESC, id DESC)` khi chưa xoá.

Chỉ mục duy nhất một phần `patient_document_upload_name_key` `(tenant_id, patient_id, lower(btrim(display_name)))` khi `deleted_at IS NULL AND source_type = 'UPLOAD'` (migration `20261114100000_patient_document_name_unique`): không trùng tên tệp tải tay trong cùng bệnh nhân.

Quyền mới ở catalog quyền (không ở bảng nghiệp vụ), hai nhóm độc lập: `patient_document.read/upload/delete` (tệp lâm sàng: Kết quả cận lâm sàng, Ảnh lâm sàng, Khác) và `patient_contract.read/upload/delete` (Hợp đồng và giấy tờ). Sửa thông tin/xếp thư mục dùng quyền `upload` của nhóm. Gộp hồ sơ bệnh nhân chuyển mọi tệp và thư mục sang hồ sơ đích (thư mục trùng tên được nhập vào thư mục đích).

Giai đoạn 2 (v2.00, `docs/DECISIONS.md` #299 bổ sung 3): dòng THAM CHIẾU chỉ đọc (`source_type` ≠ UPLOAD) do máy chủ tự đối chiếu với nguồn mỗi lần mở trang đầu của tab — `PARACLINICAL_IMAGE` (ảnh/PDF của kết quả đã duyệt, kể cả PDF đối tác vì đã là một ảnh của kết quả; `source_id` = id `paraclinical_result_image`), `INSURANCE_CARD` (`source_id` = id thẻ, mặt trước/sau phân biệt bằng `storage_key`), `PATIENT_PHOTO` (`source_id` = id bệnh nhân). `LAB_PARTNER_RESULT` để sẵn, chưa dùng. Chỉ mục duy nhất một phần `patient_document_reference_key` `(tenant_id, patient_id, storage_key)` khi `deleted_at IS NULL AND source_type <> 'UPLOAD'` (migration `20261114120000_patient_document_reference_unique`): mỗi tệp gốc một dòng tham chiếu trong cùng bệnh nhân. Dòng mất nguồn bị gỡ mềm (`deleted_reason` = `source_removed`; `merged` khi gộp hồ sơ). Thẻ BHYT/ảnh đại diện lưu `branch_id` = chi nhánh mặc định nhưng không hiển thị chi nhánh. Không đổi cột.
