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

Thiếu một cột là migration không hợp lệ. Ngoại lệ duy nhất: bảng danh mục toàn hệ thống (`icd10_catalog`, `province`, `permission`) và bảng append-only (`audit_log`, `break_glass_session` — không có `updated_at`, `deleted_at`, `version`, `created_at`, `created_by`, `updated_by`; dùng `occurred_at` làm mốc thời gian và `actor_id` làm actor, không có khái niệm "người tạo dòng log" khác với actor thực hiện hành động). `tenant` cũng là ngoại lệ với riêng cột `tenant_id` (bảng này là gốc của tenant, không tự tham chiếu chính mình).

Mọi `UPDATE` kèm điều kiện `WHERE version = ?` và tăng `version` lên 1; không khớp thì ném `CONCURRENT_MODIFICATION`, không ghi đè im lặng.

### Quy ước khác

- Mã hiển thị (`patient_code`, `encounter_no`) format `<prefix><yyMM><seq6>`, ví dụ `BN2508000123`, cấp từ `code_sequence` theo tenant.
- Bảng dữ liệu lâm sàng có thêm: `signed_at`, `signed_by`, `signature_payload` (null ở v1, để sẵn cho ký số), `supersedes_id`, `amendment_reason`.
- Tiền: `bigint` đơn vị đồng. **Cấm** `numeric`, `decimal`, `money`, `real`, `double precision` cho cột tiền. Tỷ lệ: `smallint` đơn vị 0.01% (80% lưu `8000`).
- Thời gian: `timestamptz` lưu UTC. **Cấm** `timestamp` không timezone.

## Bảng v1

### clinic / tenant_setting / room / department / user_account
Tenant và cấu hình. `tenant_setting (tenant_id, key, value_json)` giữ giờ làm việc, độ dài slot, ngưỡng `NO_SHOW`, `break_glass_duration_minutes` (mặc định 120).
`department`: `name` — khoa/phòng trong tenant, phục vụ Data Scope `department` (xem `security-audit.md`). v1 phần lớn phòng khám không dùng nhưng bảng luôn tồn tại.
`user_account` có thêm `department_id uuid NULL` (FK `(tenant_id, id)` tới `department`).
`user_account` có thêm (S1-04) `failed_login_count int NOT NULL DEFAULT 0`, `last_failed_login_at timestamptz NULL`, `locked_until timestamptz NULL` — khoá tài khoản tạm sau 5 lần đăng nhập sai trong 15 phút, xem `security-audit.md` mục Xác thực và `packages/core/src/iam/lockout.ts` (nguồn sự thật của ngưỡng/logic).

### user_session (S1-04 — xem `security-audit.md` mục Xác thực, `docs/DECISIONS.md` #019)

Phiên refresh token, phục vụ "xoay vòng mỗi lần refresh" (rotation) + phát hiện token bị đánh cắp (reuse detection). Đủ 8 cột bắt buộc, cộng: `user_id` (composite FK `(tenant_id, user_id)` → `user_account`), `refresh_token_hash text UNIQUE NOT NULL` (SHA-256 của refresh token thật — **không** lưu token thô), `issued_at`, `expires_at`, `replaced_by_session_id uuid NULL` (composite FK `(tenant_id, replaced_by_session_id)` → chính bảng này — phiên kế tiếp trong chuỗi rotation), `ip`, `user_agent`.

Thu hồi = soft delete (`deleted_at` + `deleted_reason`: `logout`/`rotated`/`expired`/`reuse_detected`/`account_disabled`) — tái dùng đúng pattern sẵn có, không có cột `revoked` riêng. RLS + `CHECK(version >= 1)` như mọi bảng có `tenant_id`. Index `(tenant_id, user_id, expires_at DESC) WHERE deleted_at IS NULL`.

### role / permission / role_permission — RBAC + Data Scope (xem `security-audit.md` để biết quy tắc nghiệp vụ đầy đủ)

Thay thế mô hình vai trò cứng cũ (enum `UserRoleName` trực tiếp trên `user_role`) — quyết định 2026-08-08, `docs/DECISIONS.md` #013.

- `role`: `tenant_id`, `name`, `is_system_default boolean`. Theo tenant — seed 5 vai trò mặc định (`receptionist`, `nurse`, `doctor`, `clinic_admin`, `system_admin`) khi tạo tenant, `clinic_admin` tạo thêm được vai trò tuỳ biến sau này. Unique `(tenant_id, name)`.
- `permission`: **toàn hệ thống**, không có `tenant_id` (giống `icd10_catalog`) — `module`, `action`, `description`. Seed cố định theo code, không do phòng khám tự thêm. Unique `(module, action)`.
- `role_permission`: `tenant_id`, `role_id`, `permission_id`, `data_scope` (enum `none`/`personal`/`department`/`global`). Composite FK `(tenant_id, role_id)` → `role`. Unique `(tenant_id, role_id, permission_id)`.
- `user_role`: bảng nối `user_account` ↔ `role` (giữ tên cũ, đổi bản chất từ "user + enum vai trò" sang "user + role_id" — xem `docs/DECISIONS.md` #013). `tenant_id`, `user_id`, `role_id`. Composite FK cả hai chiều `(tenant_id, user_id)` → `user_account`, `(tenant_id, role_id)` → `role`. Unique `(tenant_id, user_id, role_id)` — một user có thể có nhiều vai trò.

### break_glass_session

`tenant_id`, `actor_id`, `entity_type`, `entity_id`, `reason`, `occurred_at`, `expires_at`. Append-only như `audit_log` (không `updated_at`/`deleted_at`/`version`/`created_by`/`updated_by`) — mỗi lần "phá kính" là một bản ghi mới, không sửa/gia hạn bản ghi cũ. Xem quy tắc đầy đủ ở `security-audit.md` mục Break-glass.

### patient
`full_name`, `dob`, `gender`, `phone`, `national_id`, `address_json`, `allergy_note`.
- `national_id` mã hoá at-rest (AES-256-GCM, `apps/api/src/infrastructure/crypto/pii-encryption.ts`); cột `national_id_hash` (HMAC-SHA256 dùng chính `ENCRYPTION_KEY` làm khoá — tương đương "SHA-256 + salt hệ thống") để tra trùng.
- Partial unique `(tenant_id, national_id_hash) WHERE national_id_hash IS NOT NULL` (CCCD tuỳ chọn — không thể `UNIQUE` thường vì sẽ chặn nhiều bệnh nhân cùng NULL). Trùng họ tên + ngày sinh chỉ cảnh báo ở UI, không chặn (S2-03).
- Có `merged_into_id` phục vụ luồng gộp hồ sơ trùng trong cùng tenant; không xoá bản ghi nguồn.
- **Chuẩn bị cho hồ sơ dùng chung liên tenant (v3+)**: cột `global_patient_ref uuid NULL` + `identity_verified_at timestamptz NULL`. v1 luôn để null, mọi truy vấn vẫn đi theo `(tenant_id, id)`. Việc phân giải danh tính đi qua `PatientIdentityPort` (adapter v1 trả chính `patient.id`), nên khi bật master patient index chỉ cần thay adapter, không sửa service. **Không** viết code đọc dữ liệu bệnh nhân xuyên tenant ở v1.

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
- `role_permission (tenant_id, role_id)` — tra ma trận quyền lúc mỗi request, cần nhanh.
- `break_glass_session (tenant_id, actor_id, entity_type, entity_id, expires_at DESC)` — kiểm tra phiên còn hạn lúc mỗi request.
- `user_session (tenant_id, user_id, expires_at DESC) WHERE deleted_at IS NULL` — tra phiên còn hiệu lực của một user (thu hồi hàng loạt khi đổi vai trò/tenant, S2-07).
- Partial index `WHERE deleted_at IS NULL` cho các bảng lâm sàng.

### drug
Danh mục thuốc **theo tenant** ở v1 (phòng khám tự nhập): `code`, `name`, `active_ingredient`, `unit`, `concentration`, `is_active`. Khi có danh mục thuốc dùng chung ở v2.1, thêm `drug_catalog` toàn hệ thống và cột `drug.catalog_code` tham chiếu.

Sơ đồ quan hệ đầy đủ và ràng buộc DB xem `ERD.md` ở thư mục gốc.

## Chỗ để sẵn cho v2

Không tạo bảng `invoice`, `payment`, `stock_movement`, `inventory_batch` ở v1. Khi thêm sau, gắn vào `encounter_id` và tuân thủ đủ bộ cột bắt buộc ở trên.

## Migration

Forward-only. Migration đã merge vào `main` là bất biến. Đổi kiểu cột trên bảng lớn làm 3 bước: thêm cột mới → backfill theo batch → chuyển đọc/ghi → drop cột cũ ở migration sau.
