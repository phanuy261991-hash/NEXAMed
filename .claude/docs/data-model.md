# Data Model — NEXAMed

## Quy ước chung

### Cột bắt buộc trên MỌI bảng nghiệp vụ

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | `uuid` | UUID v7, sinh phía DB. Không dùng auto-increment làm khoá public |
| `tenant_id` | `uuid NOT NULL` | Cách ly dữ liệu, có RLS (xem `multi-tenancy.md`) |
| `created_at` | `timestamptz NOT NULL` | UTC |
| `updated_at` | `timestamptz NOT NULL` | UTC |
| `deleted_at` | `timestamptz NULL` | Soft delete. Kèm `deleted_reason text` |
| `version` | `integer NOT NULL DEFAULT 1` | Optimistic locking |
| `created_by` | `uuid NOT NULL` | User thực hiện |
| `updated_by` | `uuid NOT NULL` | User sửa gần nhất |

Thiếu một cột là migration không hợp lệ. Ngoại lệ duy nhất: bảng danh mục toàn hệ thống (`icd10_catalog`, `province`) và `audit_log` (append-only, không có `updated_at`, `deleted_at`, `version`).

Mọi `UPDATE` kèm điều kiện `WHERE version = ?` và tăng `version` lên 1; không khớp thì ném `CONCURRENT_MODIFICATION`, không ghi đè im lặng.

### Quy ước khác

- Mã hiển thị (`patient_code`, `encounter_no`) format `<prefix><yyMM><seq6>`, ví dụ `BN2508000123`, cấp từ `code_sequence` theo tenant.
- Bảng dữ liệu lâm sàng có thêm: `signed_at`, `signed_by`, `signature_payload` (null ở v1, để sẵn cho ký số), `supersedes_id`, `amendment_reason`.
- Tiền: `bigint` đơn vị đồng. **Cấm** `numeric`, `decimal`, `money`, `real`, `double precision` cho cột tiền. Tỷ lệ: `smallint` đơn vị 0.01% (80% lưu `8000`).
- Thời gian: `timestamptz` lưu UTC. **Cấm** `timestamp` không timezone.

## Bảng v1

### clinic / tenant_setting / room / user_account / user_role
Tenant và cấu hình. `tenant_setting (tenant_id, key, value_json)` giữ giờ làm việc, độ dài slot, ngưỡng `NO_SHOW`.

### patient
`full_name`, `dob`, `gender`, `phone`, `national_id`, `address_json`, `allergy_note`.
- `national_id` mã hoá at-rest; cột `national_id_hash` (SHA-256 + salt hệ thống) để tra trùng.
- Unique `(tenant_id, national_id_hash)`. Trùng họ tên + ngày sinh chỉ cảnh báo ở UI, không chặn.
- Có `merged_into_id` phục vụ luồng gộp hồ sơ trùng trong cùng tenant; không xoá bản ghi nguồn.
- **Chuẩn bị cho hồ sơ dùng chung liên tenant (v2+)**: cột `global_patient_ref uuid NULL` + `identity_verified_at timestamptz NULL`. v1 luôn để null, mọi truy vấn vẫn đi theo `(tenant_id, id)`. Việc phân giải danh tính đi qua `PatientIdentityPort` (adapter v1 trả chính `patient.id`), nên khi bật master patient index chỉ cần thay adapter, không sửa service. **Không** viết code đọc dữ liệu bệnh nhân xuyên tenant ở v1.

### insurance_card
`patient_id`, `card_no` (mã hoá), `valid_from`, `valid_to`, `benefit_rate`, `initial_facility_code`.
v1 **chỉ lưu và hiển thị**, không tính toán chi trả, không gọi cổng giám định.

### appointment
`patient_id`, `doctor_id`, `room_id`, `scheduled_at`, `duration_minutes`, `status`, `source` (walk-in / online / phone), `cancel_reason`.
Constraint chống trùng khung giờ cùng bác sĩ dùng `EXCLUDE USING gist` trên `(doctor_id WITH =, tstzrange(scheduled_at, scheduled_at + duration) WITH &&)` — kiểm tra ở DB, không chỉ ở service.

### encounter
`patient_id`, `doctor_id`, `appointment_id?`, `status`, `checked_in_at`, `started_at`, `completed_at`, `chief_complaint`, `insurance_snapshot_json`.
Bảng trung tâm; sinh hiệu, chẩn đoán, ghi chú, đơn thuốc đều trỏ về `encounter_id`.

### vital_sign
`encounter_id`, `temperature`, `pulse`, `blood_pressure_systolic`, `blood_pressure_diastolic`, `respiratory_rate`, `spo2`, `weight_gram`, `height_mm`, `measured_at`, `measured_by`.
Cân nặng/chiều cao lưu số nguyên (gram, mm) để tránh số thực.

### diagnosis
`encounter_id`, `icd10_code`, `type` (primary / secondary), `note`.
`icd10_code` FK tới `icd10_catalog` (danh mục toàn hệ thống, không có `tenant_id`, read-only runtime).

### clinical_note
`encounter_id`, `section` (subjective / objective / assessment / plan), `content`, `signed_at`.

### prescription / prescription_item
`prescription`: `encounter_id`, `signed_at`, `signed_by`, `signature_payload` (null ở v1), `printed_at`.
`prescription_item`: `drug_id`, `dose`, `frequency`, `duration_days`, `quantity`, `instruction`.
v1 không trừ tồn kho, không có `unit_price` — dược/kho ngoài phạm vi.

### audit_log
`tenant_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `user_agent`, `occurred_at`. Append-only — không `updated_at`, không `deleted_at`, không `version`.

## Index tối thiểu

- `encounter (tenant_id, patient_id, checked_in_at DESC)` — lịch sử khám.
- `appointment (tenant_id, doctor_id, scheduled_at)` — dựng lịch.
- `audit_log (tenant_id, entity_type, entity_id, occurred_at DESC)` — tra vết bệnh án.
- Partial index `WHERE deleted_at IS NULL` cho các bảng lâm sàng.

### drug
Danh mục thuốc **theo tenant** ở v1 (phòng khám tự nhập): `code`, `name`, `active_ingredient`, `unit`, `concentration`, `is_active`. Khi có danh mục thuốc dùng chung ở v2.1, thêm `drug_catalog` toàn hệ thống và cột `drug.catalog_code` tham chiếu.

Sơ đồ quan hệ đầy đủ và ràng buộc DB xem `ERD.md` ở thư mục gốc.

## Chỗ để sẵn cho v2

Không tạo bảng `invoice`, `payment`, `stock_movement`, `inventory_batch` ở v1. Khi thêm sau, gắn vào `encounter_id` và tuân thủ đủ bộ cột bắt buộc ở trên.

## Migration

Forward-only. Migration đã merge vào `main` là bất biến. Đổi kiểu cột trên bảng lớn làm 3 bước: thêm cột mới → backfill theo batch → chuyển đọc/ghi → drop cột cũ ở migration sau.
