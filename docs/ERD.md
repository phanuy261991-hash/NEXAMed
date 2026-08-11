# ERD: NEXAMed v1

**Version**: v1.3 — 11/08/2026 (xem mục 9 để biết lịch sử thay đổi)
**Phạm vi**: chỉ các bảng thuộc v1 (Đặt lịch, Tiếp nhận, Khám bệnh, Kê đơn). Bảng của v2+ (viện phí, kho thuốc, BHYT) **không** tạo ở giai đoạn này.
**Căn cứ**: `docs/product/prd.md` v1.0, `docs/product/plan.md` v1.0, `.claude/docs/data-model.md`

---

## 1. Quy ước đọc sơ đồ

- Mọi bảng nghiệp vụ đều có đủ 8 cột bắt buộc: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `version`, `created_by`, `updated_by`. Trong sơ đồ chỉ vẽ `id`, `tenant_id` và các cột đặc thù để dễ đọc.
- Ngoại lệ: `icd10_catalog` (danh mục toàn hệ thống, không có `tenant_id`) và `audit_log` (append-only, không có `updated_at`, `deleted_at`, `version`).
- Khoá ngoại giữa các bảng nghiệp vụ là **composite** `(tenant_id, id)` để không thể trỏ chéo tenant.
- Tiền dùng `bigint` đơn vị đồng; thời gian dùng `timestamptz` lưu UTC.

---

## 2. Sơ đồ tổng thể

```mermaid
erDiagram
    TENANT ||--o{ TENANT_SETTING : "cau hinh"
    TENANT ||--o{ ROOM : "co"
    TENANT ||--o{ USER_ACCOUNT : "co"
    TENANT ||--o{ CODE_SEQUENCE : "cap ma"
    TENANT ||--o{ PATIENT : "quan ly"
    TENANT ||--o{ DRUG : "danh muc thuoc"
    TENANT ||--o{ DEPARTMENT : "co"
    TENANT ||--o{ ROLE : "co"

    DEPARTMENT ||--o{ USER_ACCOUNT : "thuoc ve"
    ROLE ||--o{ USER_ROLE : "gan cho"
    ROLE ||--o{ ROLE_PERMISSION : "duoc cau hinh"
    PERMISSION ||--o{ ROLE_PERMISSION : "ap dung"

    USER_ACCOUNT ||--o{ USER_ROLE : "duoc gan"
    USER_ACCOUNT ||--o{ APPOINTMENT : "bac si phu trach"
    USER_ACCOUNT ||--o{ ENCOUNTER : "bac si kham"
    USER_ACCOUNT ||--o{ AUDIT_LOG : "thuc hien"
    USER_ACCOUNT ||--o{ BREAK_GLASS_SESSION : "pha kinh"
    USER_ACCOUNT ||--o{ USER_SESSION : "dang nhap"
    USER_SESSION ||--o| USER_SESSION : "replaced_by"

    PATIENT ||--o{ INSURANCE_CARD : "co the"
    PATIENT ||--o{ APPOINTMENT : "dat lich"
    PATIENT ||--o{ ENCOUNTER : "den kham"
    PATIENT ||--o| PATIENT : "merged_into"

    APPOINTMENT ||--o| ENCOUNTER : "sinh ra"
    ROOM ||--o{ APPOINTMENT : "dien ra tai"

    ENCOUNTER ||--o{ VITAL_SIGN : "sinh hieu"
    ENCOUNTER ||--o{ DIAGNOSIS : "chan doan"
    ENCOUNTER ||--o{ CLINICAL_NOTE : "ghi chu SOAP"
    ENCOUNTER ||--o{ PRESCRIPTION : "don thuoc"

    ICD10_CATALOG ||--o{ DIAGNOSIS : "ma benh"
    PRESCRIPTION ||--o{ PRESCRIPTION_ITEM : "dong thuoc"
    DRUG ||--o{ PRESCRIPTION_ITEM : "thuoc"

    PRESCRIPTION ||--o| PRESCRIPTION : "supersedes"
    CLINICAL_NOTE ||--o| CLINICAL_NOTE : "supersedes"

    TENANT {
        uuid id PK
        text name
        text tax_code
        text address
        text license_no
        boolean is_active
    }

    USER_ACCOUNT {
        uuid id PK
        uuid tenant_id FK
        uuid department_id FK
        text username UK
        text password_hash
        text full_name
        text license_no
        boolean is_active
        int failed_login_count
        timestamptz last_failed_login_at
        timestamptz locked_until
    }

    USER_SESSION {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        text refresh_token_hash UK
        timestamptz issued_at
        timestamptz expires_at
        uuid replaced_by_session_id FK
        text ip
        text user_agent
    }

    DEPARTMENT {
        uuid id PK
        uuid tenant_id FK
        text name
    }

    ROLE {
        uuid id PK
        uuid tenant_id FK
        text name
        boolean is_system_default
    }

    PERMISSION {
        uuid id PK
        text module
        text action
        text description
    }

    ROLE_PERMISSION {
        uuid id PK
        uuid tenant_id FK
        uuid role_id FK
        uuid permission_id FK
        text data_scope
    }

    USER_ROLE {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        uuid role_id FK
    }

    BREAK_GLASS_SESSION {
        uuid id PK
        uuid tenant_id FK
        uuid actor_id FK
        text entity_type
        uuid entity_id
        text reason
        timestamptz occurred_at
        timestamptz expires_at
    }

    PATIENT {
        uuid id PK
        uuid tenant_id FK
        text patient_code UK
        text full_name
        date dob
        text gender
        text phone
        bytea national_id_enc
        text national_id_hash
        jsonb address_json
        text allergy_note
        uuid merged_into_id FK
        uuid global_patient_ref
        timestamptz identity_verified_at
    }

    INSURANCE_CARD {
        uuid id PK
        uuid tenant_id FK
        uuid patient_id FK
        bytea card_no_enc
        date valid_from
        date valid_to
        smallint benefit_rate
    }

    APPOINTMENT {
        uuid id PK
        uuid tenant_id FK
        uuid patient_id FK
        uuid doctor_id FK
        uuid room_id FK
        timestamptz scheduled_at
        int duration_minutes
        text status
        text source
        text cancel_reason
    }

    ENCOUNTER {
        uuid id PK
        uuid tenant_id FK
        uuid patient_id FK
        uuid doctor_id FK
        uuid appointment_id FK
        text encounter_no UK
        text status
        timestamptz checked_in_at
        timestamptz started_at
        timestamptz completed_at
        text chief_complaint
        jsonb insurance_snapshot
    }

    VITAL_SIGN {
        uuid id PK
        uuid tenant_id FK
        uuid encounter_id FK
        smallint pulse
        smallint temperature_deci_c
        smallint bp_systolic
        smallint bp_diastolic
        smallint respiratory_rate
        smallint spo2
        int weight_gram
        int height_mm
        timestamptz measured_at
    }

    DIAGNOSIS {
        uuid id PK
        uuid tenant_id FK
        uuid encounter_id FK
        text icd10_code FK
        text type
        text note
    }

    CLINICAL_NOTE {
        uuid id PK
        uuid tenant_id FK
        uuid encounter_id FK
        text section
        text content
        timestamptz signed_at
        uuid signed_by FK
        uuid supersedes_id FK
        text amendment_reason
    }

    PRESCRIPTION {
        uuid id PK
        uuid tenant_id FK
        uuid encounter_id FK
        timestamptz signed_at
        uuid signed_by FK
        bytea signature_payload
        timestamptz printed_at
        uuid supersedes_id FK
        text amendment_reason
    }

    PRESCRIPTION_ITEM {
        uuid id PK
        uuid tenant_id FK
        uuid prescription_id FK
        uuid drug_id FK
        text dose
        text frequency
        smallint duration_days
        int quantity
        text instruction
    }

    DRUG {
        uuid id PK
        uuid tenant_id FK
        text code UK
        text name
        text active_ingredient
        text unit
        text concentration
        boolean is_active
    }

    ICD10_CATALOG {
        text code PK
        text name_vi
        text name_en
        text search_key
        text chapter
        boolean is_billable
    }

    ROOM {
        uuid id PK
        uuid tenant_id FK
        text name
        boolean is_active
    }

    TENANT_SETTING {
        uuid id PK
        uuid tenant_id FK
        text key UK
        jsonb value
    }

    CODE_SEQUENCE {
        uuid id PK
        uuid tenant_id FK
        text prefix UK
        bigint current_value
    }

    AUDIT_LOG {
        uuid id PK
        uuid tenant_id FK
        uuid actor_id FK
        text action
        text entity_type
        uuid entity_id
        jsonb before_json
        jsonb after_json
        inet ip
        timestamptz occurred_at
    }
```

---

## 3. Nhóm bảng theo vai trò

### 3.1 Nền tảng và tenant

| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `tenant` | Một phòng khám | Bảng gốc; `tenant_id` của chính nó là `id` |
| `tenant_setting` | Cấu hình theo phòng khám | Giờ làm việc, `slot_duration_minutes`, ngưỡng no-show, ngưỡng sinh hiệu, mẫu in. Unique `(tenant_id, key)` |
| `room` | Phòng khám vật lý | |
| `department` | Khoa/phòng trong tenant | Phục vụ Data Scope `department`; v1 phần lớn phòng khám không dùng nhưng bảng luôn tồn tại |
| `user_account` | Tài khoản người dùng | `password_hash` Argon2id; `license_no` cho bác sĩ; `department_id` tuỳ chọn |
| `role` | Vai trò theo tenant | Seed 5 vai trò mặc định lúc tạo tenant, `clinic_admin` tạo thêm được. Unique `(tenant_id, name)` |
| `permission` | Danh mục hành động toàn hệ thống | Không có `tenant_id`, seed cố định theo code (giống `icd10_catalog`). Unique `(module, action)` |
| `role_permission` | Ma trận phân quyền | `(role_id, permission_id) → data_scope` (`none`/`personal`/`department`/`global`). Unique `(tenant_id, role_id, permission_id)` |
| `user_role` | Gán vai trò cho user | Bảng nối, một người có nhiều vai trò. Unique `(tenant_id, user_id, role_id)` |
| `break_glass_session` | Phiên vượt quyền tạm thời | Append-only, `expires_at` giới hạn thời hạn (mặc định 2 giờ, cấu hình qua `tenant_setting`) |
| `user_session` | Phiên refresh token | Rotation + reuse detection (S1-04); thu hồi = soft delete (`deleted_reason`: `logout`/`rotated`/`expired`/`reuse_detected`/`account_disabled`) |
| `code_sequence` | Cấp mã hiển thị theo tenant | `SELECT ... FOR UPDATE` trong transaction |
| `audit_log` | Nhật ký | Append-only, quyền DB chỉ `INSERT`/`SELECT` |

### 3.2 Bệnh nhân

| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `patient` | Hồ sơ hành chính | `national_id_enc` mã hoá AES-256-GCM; `national_id_hash` để tra trùng; `address_json` lưu địa chỉ (PAT-01) |
| `insurance_card` | Thẻ BHYT | v1 chỉ lưu và hiển thị, không tính chi trả |

`patient.merged_into_id` tự trỏ về `patient` trong cùng tenant, dùng cho luồng gộp hồ sơ trùng (PAT-04). Bản ghi nguồn không xoá, chỉ ngừng cho tạo lượt khám mới.

`patient.global_patient_ref` và `patient.identity_verified_at` luôn `NULL` ở v1. Hai cột này để sẵn cho hồ sơ dùng chung liên tenant ở v3+ (`identity_verified_at` ghi thời điểm xác minh danh tính khi bật master patient index); mọi tra cứu hiện tại đi qua `PatientIdentityPort`.

### 3.3 Lịch hẹn và lượt khám

| Bảng | Vai trò |
|---|---|
| `appointment` | Lịch hẹn; `status`: `SCHEDULED`, `CANCELLED`, `NO_SHOW`, `CONVERTED` |
| `encounter` | Lượt khám; `status`: `SCHEDULED`, `CHECKED_IN`, `IN_CONSULTATION`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |

`encounter.appointment_id` cho phép `NULL` để hỗ trợ walk-in tạo trực tiếp. Quan hệ là một-một: mỗi lịch hẹn sinh tối đa một lượt khám.

`encounter.insurance_snapshot` là bản chụp thẻ BHYT tại thời điểm check-in (số thẻ đã che, tỷ lệ hưởng, nơi đăng ký, hạn thẻ, `self_pay`). Không join động về `insurance_card` khi in hay tra cứu về sau.

### 3.4 Dữ liệu lâm sàng

| Bảng | Vai trò | Đặc thù |
|---|---|---|
| `vital_sign` | Sinh hiệu | Lưu số nguyên: nhiệt độ theo phần mười độ C (`temperature_deci_c`, 37.5°C → `375`), cân nặng theo gram, chiều cao theo mm |
| `diagnosis` | Chẩn đoán | `type`: `PRIMARY` hoặc `SECONDARY`; bắt buộc có đúng một `PRIMARY` khi hoàn tất lượt khám |
| `clinical_note` | Ghi chú SOAP | `section`: `SUBJECTIVE`, `OBJECTIVE`, `ASSESSMENT`, `PLAN` |
| `prescription` | Đơn thuốc | Ký logic ở v1; `signature_payload` để sẵn cho chữ ký số, luôn `NULL` |
| `prescription_item` | Dòng thuốc | v1 không có cột giá, không trừ kho |

`clinical_note` và `prescription` có `supersedes_id` + `amendment_reason` cho luồng đính chính: bản mới trỏ về bản cũ, bản cũ đặt `deleted_at` + `deleted_reason`.

### 3.5 Danh mục

| Bảng | Phạm vi | Ghi chú |
|---|---|---|
| `icd10_catalog` | Toàn hệ thống | Không có `tenant_id`, read-only lúc chạy, seed từ danh mục Bộ Y tế. `search_key` là tên tiếng Việt đã bỏ dấu và viết thường, phục vụ tìm kiếm không dấu |
| `drug` | Theo tenant | v1 phòng khám tự nhập danh mục thuốc của mình (theo PRD mục 8). Khi có danh mục thuốc quốc gia dùng chung, thêm bảng `drug_catalog` toàn hệ thống và cho `drug.catalog_code` tham chiếu tới |

---

## 4. Ràng buộc ở tầng cơ sở dữ liệu

Những ràng buộc này đặt ở DB, không chỉ ở tầng ứng dụng.

| # | Ràng buộc | Bảng | Lý do |
|---|---|---|---|
| C1 | RLS policy `tenant_id = current_setting('app.current_tenant_id')::uuid` | Mọi bảng có `tenant_id` | Lớp phòng thủ cuối chống rò rỉ giữa tenant |
| C2 | `EXCLUDE USING gist (doctor_id WITH =, tstzrange(scheduled_at, scheduled_at + duration) WITH &&) WHERE (status = 'SCHEDULED' AND deleted_at IS NULL)` | `appointment` | Chống đặt trùng khung giờ khi hai lễ tân thao tác đồng thời |
| C3 | `UNIQUE (tenant_id, national_id_hash) WHERE national_id_hash IS NOT NULL` | `patient` | Chặn trùng CCCD trong cùng phòng khám, vẫn cho phép bệnh nhân không có CCCD |
| C4 | `UNIQUE (tenant_id, patient_code)`, `UNIQUE (tenant_id, encounter_no)` | `patient`, `encounter` | Mã hiển thị duy nhất trong phạm vi tenant |
| C5 | Composite FK `(tenant_id, id)` cho mọi quan hệ nghiệp vụ | Toàn bộ | Không thể trỏ chéo tenant kể cả khi code sai |
| C6 | `CHECK (version >= 1)` và mọi `UPDATE` kèm `WHERE version = ?` | Mọi bảng nghiệp vụ | Optimistic locking |
| C7 | Partial index `WHERE deleted_at IS NULL` | Bảng lâm sàng | Truy vấn mặc định chỉ đọc bản còn hiệu lực |
| C8 | Trigger chặn `UPDATE` khi `signed_at IS NOT NULL` | `clinical_note`, `prescription` | Bản ghi đã ký bất biến, không phụ thuộc vào việc ứng dụng nhớ kiểm tra |
| C9 | Không cấp quyền `DELETE` cho app user trên mọi bảng nghiệp vụ | Toàn bộ | Ép soft delete ở tầng quyền, không chỉ ở code |
| C10 | `CHECK (type IN ('PRIMARY','SECONDARY'))` và unique partial một `PRIMARY` mỗi encounter | `diagnosis` | Bắt buộc đúng một chẩn đoán chính |

---

## 5. Index cần có từ đầu

| Index | Phục vụ |
|---|---|
| `patient (tenant_id, phone)` | Tìm bệnh nhân theo số điện thoại (PAT-02) |
| GIN trên `patient (tenant_id, search_key)` dùng `pg_trgm` | Tìm theo tên không dấu, mục tiêu dưới 1 giây với 50k bản ghi |
| `encounter (tenant_id, patient_id, checked_in_at DESC)` | Tải tiền sử ở màn hình khám (ENC-01), mục tiêu dưới 2 giây |
| `appointment (tenant_id, doctor_id, scheduled_at)` | Lịch theo bác sĩ theo ngày (APP-01) |
| `appointment (tenant_id, status, scheduled_at) WHERE deleted_at IS NULL` | Job đánh dấu no-show (APP-05) |
| GIN trên `icd10_catalog (search_key)` dùng `pg_trgm` | Tìm mã ICD-10 theo tên tiếng Việt (ENC-03) |
| `audit_log (tenant_id, entity_type, entity_id, occurred_at DESC)` | Tra vết sửa đổi hồ sơ (ADM-03) |
| `audit_log (tenant_id, actor_id, occurred_at DESC)` | Tra nhật ký theo người dùng |
| `user_session (tenant_id, user_id, expires_at DESC) WHERE deleted_at IS NULL` | Tra phiên còn hiệu lực của một user (thu hồi hàng loạt) |

`patient.search_key` là cột dẫn xuất (tên đã bỏ dấu, viết thường), cập nhật bằng trigger hoặc generated column — không tính lại trong câu truy vấn.

---

## 6. Thứ tự tạo bảng theo sprint

Khớp với `docs/product/plan.md`.

| Sprint | Bảng tạo mới |
|---|---|
| S1 (tuần 1-2) | `tenant`, `tenant_setting`, `room`, `user_account`, `code_sequence`, `audit_log` |
| S1 (bổ sung, RBAC — 2026-08-08) | `department`, `role`, `permission`, `role_permission`, `user_role`, `break_glass_session` — thay mô hình vai trò cứng, xem `docs/DECISIONS.md` #013 |
| S1 (bổ sung, Auth — 2026-08-10) | `user_session` (S1-04, rotation + reuse detection); `user_account` thêm `failed_login_count`/`last_failed_login_at`/`locked_until` — xem `docs/DECISIONS.md` #019 |
| S2 (tuần 3-4) | `patient`, `insurance_card`, `appointment` |
| S3 (tuần 5-6) | `icd10_catalog`, `encounter`, `vital_sign`, `diagnosis`, `clinical_note` |
| S4 (tuần 7-8) | `drug`, `prescription`, `prescription_item` |
| S5-S6 | Không thêm bảng mới; chỉ thêm cột `supersedes_id`, `amendment_reason` nếu chưa tạo, và trigger C8 |

Khuyến nghị: tạo đủ 8 cột bắt buộc **ngay từ migration đầu tiên của mỗi bảng**, kể cả khi tính năng dùng tới chúng ở sprint sau. Thêm cột vào bảng đã có dữ liệu thật tốn hơn nhiều.

---

## 7. Bảng của v2+ — không tạo ở v1

Ghi ra đây để không ai vô tình tạo sớm, và để thiết kế v1 không cản đường v2.

| Bảng dự kiến | Phase | Điểm neo vào v1 |
|---|---|---|
| `service`, `service_order` | v2 | `encounter_id` |
| `invoice`, `invoice_line`, `payment` | v2 | `encounter_id` |
| `inventory_batch`, `stock_movement` | v2.1 | `drug_id`, `prescription_item_id` |
| `insurance_claim` | v3 | `encounter_id`, `insurance_card_id` |
| `drug_catalog` (toàn hệ thống) | v2.1 | `drug.catalog_code` |
| `lab_order`, `lab_result` | v3+ | `encounter_id` |

Khi thêm, các bảng này vẫn phải đủ 8 cột bắt buộc và tuân thủ C1-C10.

---

## 8. Điểm chưa chốt ảnh hưởng tới ERD

| # | Vấn đề | Ảnh hưởng | Hạn |
|---|---|---|---|
| E1 | Yêu cầu chữ ký số (Q2 trong PRD) | Nếu bắt buộc, `signature_payload` phải tách thành bảng riêng lưu chứng thư và chuỗi ký, không để cột `bytea` đơn giản | Tuần 2 |
| E2 | Thời hạn lưu trữ (Q1 trong PRD) | Ảnh hưởng chiến lược phân vùng `audit_log` theo thời gian. Nếu lưu trên 10 năm, nên partition theo năm ngay từ đầu | Tuần 2 |
| E3 | Danh mục thuốc quốc gia | Nếu có nguồn dùng chung, `drug` chuyển thành bảng ánh xạ thay vì danh mục độc lập | Tuần 5 |
| E4 | Nhiều chi nhánh của cùng chủ (Q6) | Nếu cần ở v1, phải thêm khái niệm `organization` trên `tenant` và bảng nối người dùng với nhiều tenant | Tuần 4 |

---

## 9. Lịch sử phiên bản

| Version | Ngày | Thay đổi |
|---|---|---|
| v1.0 | 07/08/2026 | Bản đầu tiên, dựng từ PRD v1.0 và PLAN v1.0 |
| v1.1 | 08/08/2026 | Thay mô hình vai trò cứng (`user_role.role` enum) bằng RBAC + Data Scope: thêm `department`, `role`, `permission`, `role_permission`, `break_glass_session`; `user_role` đổi sang trỏ `role_id`. Xem `docs/DECISIONS.md` #013-#016. Scope `branch`/đa chi nhánh (liên quan E4) vẫn hoãn — chỉ giữ 4 mức `none`/`personal`/`department`/`global`. |
| v1.2 | 10/08/2026 | S1-04 (Auth): thêm `user_session` (refresh token, rotation + reuse detection); `user_account` thêm `failed_login_count`/`last_failed_login_at`/`locked_until` (khoá tài khoản tạm). Xem `docs/DECISIONS.md` #019-#020. |
| v1.3 | 11/08/2026 | S2-01 (patient): vá lệch giữa sơ đồ mermaid và mô tả chi tiết ở `.claude/docs/data-model.md` — thêm `address_json` (PRD PAT-01, P0) và `identity_verified_at` (cột chờ sẵn liên-tenant v2+, đi cùng `global_patient_ref`) vào bảng `PATIENT`. Xem `docs/DECISIONS.md` #024. |
