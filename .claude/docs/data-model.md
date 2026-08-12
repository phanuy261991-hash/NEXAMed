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

Thiếu một cột là migration không hợp lệ. Ngoại lệ duy nhất: bảng danh mục toàn hệ thống (`icd10_catalog`, `province`, `permission`, `reference_catalog`) và bảng append-only (`audit_log`, `break_glass_session` — không có `updated_at`, `deleted_at`, `version`, `created_at`, `created_by`, `updated_by`; dùng `occurred_at` làm mốc thời gian và `actor_id` làm actor, không có khái niệm "người tạo dòng log" khác với actor thực hiện hành động). `tenant` cũng là ngoại lệ với riêng cột `tenant_id` (bảng này là gốc của tenant, không tự tham chiếu chính mình).

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

### reference_catalog (`docs/DECISIONS.md` #037)

Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — đảo ngược `docs/DECISIONS.md` #034 phần `ethnicity`/`nationality`; `occupation` vẫn text tự do, không đổi). Cùng bản chất `permission`/`icd10_catalog`: không `tenant_id`, không đủ 8 cột bắt buộc. Thêm **không có `version`** (khác `room`/`user_account` — rủi ro ghi đè đồng thời thấp, `clinic_admin` sửa không thường xuyên).

`category` (enum `ETHNICITY`/`NATIONALITY`), `code` (mã chính thức: dân tộc "1".."54" theo Tổng cục Thống kê, quốc tịch ISO 3166-1 alpha-3 — đây là giá trị lưu trên `patient.ethnicity`/`patient.nationality`), `name` (tên hiển thị tiếng Việt), `sort_order` (thứ tự hiển thị), `is_active` (soft-delete — xem dưới). Unique `(category, code)`.

**Khác `permission`**: bảng này quản lý được qua chính API bởi `clinic_admin` (`reference_catalog.manage`), không chỉ qua seed script đặc quyền — vì vậy **không** REVOKE `INSERT`/`UPDATE` khỏi `nexamed_app` (giữ nguyên GRANT mặc định qua `ALTER DEFAULT PRIVILEGES`). `DELETE` đã bị revoke toàn cục cho `nexamed_app` từ migration `*_tenant_context` (áp dụng cho mọi bảng, kể cả bảng tạo sau) — "xoá" trong UI quản lý là `is_active=false` (soft), không phải `DELETE` thật.

Quyền: `reference_catalog.read` (`global`) cho mọi vai trò lâm sàng (`receptionist`/`nurse`/`doctor`/`clinic_admin` — ai điền form bệnh nhân cũng cần thấy dropdown); `reference_catalog.manage` (`global`) chỉ `clinic_admin`. **Giới hạn đã biết**: không có cách ly theo tenant (bảng không có `tenant_id`) — nếu triển khai tập trung nhiều phòng khám sau này (v3+), sửa ở một tenant ảnh hưởng mọi tenant khác. Chấp nhận có ý thức ở v1 (on-premise, một tenant/instance).

Seed dữ liệu thật (không phải placeholder) tại `packages/core/src/reference-catalog/data.ts` — 54 dân tộc + 30 quốc tịch, nguồn từ file chủ dự án cung cấp, không tự thêm/bớt/sửa chính tả.

### break_glass_session

`tenant_id`, `actor_id`, `entity_type`, `entity_id`, `reason`, `occurred_at`, `expires_at`. Append-only như `audit_log` (không `updated_at`/`deleted_at`/`version`/`created_by`/`updated_by`) — mỗi lần "phá kính" là một bản ghi mới, không sửa/gia hạn bản ghi cũ. Xem quy tắc đầy đủ ở `security-audit.md` mục Break-glass.

### patient
`full_name`, `dob`, `gender`, `phone`, `national_id`, `address_json`, `allergy_note`.
- `national_id` mã hoá at-rest (AES-256-GCM, `apps/api/src/infrastructure/crypto/pii-encryption.ts`); cột `national_id_hash` (HMAC-SHA256 dùng chính `ENCRYPTION_KEY` làm khoá — tương đương "SHA-256 + salt hệ thống") để tra trùng.
- Partial unique `(tenant_id, national_id_hash) WHERE national_id_hash IS NOT NULL` (CCCD tuỳ chọn ở tầng DB — không thể `UNIQUE` thường vì sẽ chặn nhiều bệnh nhân cùng NULL). Trùng họ tên + ngày sinh chỉ cảnh báo ở UI, không chặn (S2-03).
- **Ràng buộc nghiệp vụ (`docs/DECISIONS.md` #036, không phải ràng buộc DB)**: `createPatientRequestSchema` (`packages/shared/src/patient.ts`) bắt buộc `national_id` khi bệnh nhân >= 18 tuổi tại thời điểm tạo hồ sơ (tính từ `dob`); dưới 18 vẫn tuỳ chọn. **Chỉ áp cho tạo mới**, không áp lại cho `updatePatientRequestSchema` — sửa hồ sơ người lớn cũ chưa có CCCD (tạo trước ràng buộc này) không bị chặn.
- Có `merged_into_id` phục vụ luồng gộp hồ sơ trùng trong cùng tenant; không xoá bản ghi nguồn.
- **Chuẩn bị cho hồ sơ dùng chung liên tenant (v3+)**: cột `global_patient_ref uuid NULL` + `identity_verified_at timestamptz NULL`. v1 luôn để null, mọi truy vấn vẫn đi theo `(tenant_id, id)`. Việc phân giải danh tính đi qua `PatientIdentityPort` (adapter v1 trả chính `patient.id`), nên khi bật master patient index chỉ cần thay adapter, không sửa service. **Không** viết code đọc dữ liệu bệnh nhân xuyên tenant ở v1.
- **Mở rộng hồ sơ hành chính (`docs/DECISIONS.md` #034)**: `photo_key` (text null — key trên `StoragePort`, không phải URL; phục vụ qua signed URL có hạn, xem `apps/api/src/infrastructure/storage/signed-url.ts`), `national_id_issued_at` (date), `national_id_issued_place`, `occupation` (text tự do, **không** danh mục DB — thiếu nguồn dữ liệu chính thức, cùng lý do tạm hoãn ICD-10 ở S3-01), `insurance_number` (text độc lập, **không** liên kết `insurance_card`/S2-04), `relative_full_name`, `relative_relationship`, `relative_phone`, `relative_address` (1 bộ người thân trên mỗi `patient`, không tách bảng). `address_json` có thêm khoá `neighborhood` (Khu phố); khoá `district` (Quận/Huyện) vẫn hợp lệ trong schema (dữ liệu cũ) nhưng không còn input trên UI (đã sáp nhập 2 cấp Tỉnh→Xã).
- **`ethnicity`/`nationality` (`docs/DECISIONS.md` #037, đảo ngược #034 cho riêng 2 field này)**: vẫn cột `String?` tự do ở tầng DB/Zod, nhưng nay lưu **mã (`code`)** tham chiếu bảng `reference_catalog` (ví dụ `"VNM"`, `"1"`), chọn qua dropdown ở web thay vì gõ tay. Không có FK thật (bảng `reference_catalog` không tenant_id, composite FK `(tenant_id, id)` không áp dụng được) và không validate khớp danh mục ở tầng Zod — tránh chặn sửa hồ sơ cũ có giá trị dạng tên tự do (ví dụ `"Việt Nam"`) lưu trước #037.

### insurance_card
`patient_id`, `card_no` (mã hoá), `valid_from`, `valid_to`, `benefit_rate`, `initial_facility_code`.
v1 **chỉ lưu và hiển thị**, không tính toán chi trả, không gọi cổng giám định.

### appointment
`patient_id` (NULL — xem dưới), `doctor_id`, `room_id`, `booking_code`, `full_name`, `phone`, `reason`, `scheduled_at`, `duration_minutes`, `status`, `source` (walk-in / online / phone), `cancel_reason`.
Constraint chống trùng khung giờ cùng bác sĩ dùng `EXCLUDE USING gist` trên `(doctor_id WITH =, tstzrange(scheduled_at, scheduled_at + duration) WITH &&)` — kiểm tra ở DB, không chỉ ở service.

**Đặt lịch "lead capture" (`docs/DECISIONS.md` #032)**: v1 **không** tạo/gắn `patient` lúc đặt lịch — chỉ ghi nhận `full_name`/`phone`/`reason` (tuỳ chọn) trực tiếp trên `appointment`. `patient_id` **nullable**, để sẵn cho lúc Tiếp nhận (Sprint 3, chưa xây) gắn/tạo hồ sơ `patient` thật khi khách check-in tại quầy — hiện tại luôn `NULL`. `booking_code` (mã đặt lịch khách trình lúc đến, `UNIQUE (tenant_id, booking_code)`, prefix `LH`, cùng khuôn `patient_code`/`encounter_no` qua `formatDisplayCode()`/`code_sequence`). Index `(tenant_id, phone)` phục vụ tra cứu lịch sử đặt lịch theo SĐT (tự điền tên, cảnh báo spam ≥5 lần huỷ — ngưỡng này chỉ so sánh ở `apps/web`, `apps/api` không tự chặn). Check-in chuyển thẳng `status: SCHEDULED → CONVERTED`, không sinh trạng thái mới trong enum.

### encounter
`patient_id`, `doctor_id`, `appointment_id?`, `status`, `specialty`, `checked_in_at`, `started_at`, `completed_at`, `chief_complaint`, `insurance_snapshot_json`.
Bảng trung tâm; sinh hiệu, chẩn đoán, ghi chú, đơn thuốc đều trỏ về `encounter_id`.

**Khung tối thiểu cho đa chuyên khoa (`docs/DECISIONS.md` #033, chưa triển khai ở v1)**: `specialty` (text, mặc định `'general'`) — chuyên khoa của lượt khám này, không phải của tenant. v1 luôn `'general'`. Không thêm bảng tầng cha dài hạn (thai kỳ, lộ trình điều trị) hay logic rẽ nhánh theo chuyên khoa ở v1 — chỉ chuẩn bị cột để Sprint 3 không phải retrofit sau. Màn hình khám (S3-06) và mọi component liên quan phải nhận cấu hình trường qua props, không hard-code riêng cho một chuyên khoa.

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
- `appointment (tenant_id, phone)` — tra cứu lịch sử đặt lịch theo SĐT (`docs/DECISIONS.md` #032).
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
