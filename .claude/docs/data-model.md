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

`tenant` — ngoài `name`/`address`/`taxCode`/`licenseNo` có sẵn, thêm (2026-08-13, trang "Thông tin phòng khám"): `phone text NULL`, `email text NULL`, `currency text NOT NULL DEFAULT 'VND'`, `timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'`, `logo_key text NULL` (logo chính 220×110, khoá lưu trên `StoragePort`, cùng mẫu `patient.photo_key`), `print_logo_key text NULL` (logo dùng cho mẫu in 110×110, chuẩn bị cho PRE-04/S4-04). **`currency`/`timezone` chỉ lưu giá trị hiển thị** — chưa nối vào logic tính tiền (viện phí là v2+, hiện chưa có nơi nào hiển thị/tính tiền trong hệ thống) hay logic ngày giờ hệ thống (vẫn hard-code UTC+7 ở `packages/core/src/date/vietnam-day-range.ts` và các nơi khác — xem `docs/DECISIONS.md` #041). Không permission mới — dùng lại `clinic_config.read`/`clinic_config.update`.
`room` có thêm (2026-08-19, `docs/DECISIONS.md` #055) `floor_id uuid NULL` (composite FK → `floor`, xem mục "floor / exam_station" dưới) — "Tầng" tùy chọn, không bắt buộc gán.

`department`: `name` — khoa/phòng trong tenant, phục vụ Data Scope `department` (xem `security-audit.md`). v1 phần lớn phòng khám không dùng nhưng bảng luôn tồn tại.
`user_account` có thêm `department_id uuid NULL` (FK `(tenant_id, id)` tới `department`).
`user_account` có thêm (S1-04) `failed_login_count int NOT NULL DEFAULT 0`, `last_failed_login_at timestamptz NULL`, `locked_until timestamptz NULL` — khoá tài khoản tạm sau 5 lần đăng nhập sai trong 15 phút, xem `security-audit.md` mục Xác thực và `packages/core/src/iam/lockout.ts` (nguồn sự thật của ngưỡng/logic).

### doctor_room_session (`docs/DECISIONS.md` #054)

"Phòng làm việc hôm nay" của bác sĩ — mô hình định tuyến theo phòng vật lý (tham khảo chủ dự án gửi), tách bác sĩ khỏi phòng cố định. Đủ 8 cột bắt buộc, cộng `doctor_id` (composite FK `(tenant_id, id)` → `user_account`), `room_id` (composite FK → `room`), `work_date date NOT NULL` (ngày lịch Việt Nam, tính 1 lần lúc ghi qua `getVietnamDateString()` — **không phải** `timestamptz`, khác mọi cột thời điểm khác trong hệ thống vì đây là khái niệm "ngày lịch", không phải một mốc thời gian).

Partial unique `(tenant_id, work_date, doctor_id) WHERE deleted_at IS NULL` — 1 phòng/bác sĩ/ngày hiệu lực, cùng arbiter cho `INSERT ... ON CONFLICT DO UPDATE` (không khai `@@unique` trong Prisma được vì điều kiện `WHERE`, cùng lý do `user_role`/`patient.national_id_hash`). **Không phải dữ liệu lâm sàng** — đổi phòng giữa ngày là UPDATE tại chỗ (tăng `version`), không tạo bản ghi mới giữ lịch sử như `appointment`/`prescription`.

**Chỉ điều phối/hiển thị UI — KHÔNG dùng để lọc `data_scope`/hàng đợi khám.** `doctor.encounter.* = personal` vẫn lọc theo `encounter.doctor_id` trực tiếp như trước (`docs/DECISIONS.md` #042), không đọc bảng này. Bảng này chỉ phục vụ: (1) `GET /appointments/doctors` (đã có từ S2-09) mở rộng thêm `currentRoomName` để lễ tân thấy bác sĩ đang ở phòng nào lúc chọn; (2) badge "Đang ở: {phòng}" ở "Hàng đợi khám".

Endpoint tự-phục vụ, không permission mới: `GET /rooms/options` (danh sách phòng active, chiếu tối thiểu), `GET/PUT /rooms/my-session` (đọc/ghi đúng phiên của actor — `req.user.userId`, không nhận `doctorId` từ client) — chỉ `JwtAuthGuard`, không `@RequirePermission` (route thiếu decorator được `PermissionGuard` cho qua, cùng nguyên tắc `GET /auth/me`).

**Tự động ẩn ở quy mô 1-3 bác sĩ**: 0-1 phòng active thì `GET /rooms/options` trả ≤1 phần tử, web không hiện bất kỳ UI nào liên quan phòng (không popup chọn phòng lúc đăng nhập, không badge, không nhãn phòng cạnh tên bác sĩ) — không cần cấu hình bật/tắt riêng, tự suy ra từ dữ liệu. Bảng `room` (S2-07) trước đây chưa từng có UI web quản lý — thêm pane "Phòng khám" tối thiểu trong `/admin/system-config` để bật được tính năng này (tận dụng nguyên `RoomController` có sẵn, không đổi backend `room`).

### floor / exam_station (`docs/DECISIONS.md` #055)

Mở rộng `room` thành cấp bậc không gian vật lý — "Tầng phòng" trong Quản trị (tích hợp chung 1 màn hình, không tách pill/mục riêng từng cấp). **Cả hai bảng THUẦN mô tả/tổ chức, không có hành vi nghiệp vụ nào phụ thuộc** — đơn vị điều phối thật của `doctor_room_session` (#054) và `appointment.room_id` (S2-05) vẫn dừng ở cấp `room`, không xuống tới `floor`/`exam_station`.

`floor` (Tầng, **tùy chọn**): đủ 8 cột bắt buộc + `name`, `sort_order`, `is_active`. `room.floor_id` (composite FK `(tenant_id, floor_id)` → `floor`, **nullable** — C13) — phòng không gán tầng vẫn hợp lệ, cùng mẫu `user_account.department_id`. Tenant chưa tạo tầng nào (đa số phòng khám 1-3 bác sĩ) thì web tự ẩn hoàn toàn UI liên quan tầng, trừ đúng 1 nút "+" luôn hiện (lối vào duy nhất để tạo tầng đầu tiên — không giấu sau bất kỳ thao tác nào khác, tránh bẫy không lối ra).

`exam_station` (Bàn khám/Ghế, cấp con **bắt buộc** thuộc 1 `room`): đủ 8 cột bắt buộc + `room_id` (composite FK, NOT NULL), `name`, `sort_order`, `is_active`. `RoomSummary.examStationCount` (đếm qua `GROUP BY`, không load toàn bộ danh sách) hiện badge số đếm ở danh sách Phòng — quản lý chi tiết qua modal riêng scoped theo `roomId` (`GET /exam-stations?roomId=`).

Quyền: dùng lại `clinic_config.read`/`.update` như `room` — không thêm permission mới (cùng lý do PRD ADM-02 gộp chung "phòng" vào một yêu cầu cấu hình).

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

Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — đảo ngược `docs/DECISIONS.md` #034 phần `ethnicity`/`nationality`; `occupation` vẫn text tự do, không đổi). Sprint 3 mở rộng thêm 2 category: `PATIENT_SOURCE` (Nguồn khách hàng) và `EXAM_TYPE` (Loại khám) — phục vụ trang "Tiếp nhận bệnh nhân", tái dùng nguyên bảng này thay vì tạo bảng riêng (cùng hình dạng: danh sách tên có sắp xếp, quản lý qua Cấu hình). Thiết kế lại "Tiếp nhận bệnh nhân" (`docs/DECISIONS.md` #052, mockup đã duyệt) mở rộng thêm 4 category nữa: `RECEPTION_TYPE` (Loại tiếp nhận), `EXAM_FORM` (Hình thức khám), `PRIORITY_REASON` (Lý do ưu tiên), `PRICE_TYPE` (Loại giá dịch vụ) — cùng lý do tái dùng bảng này, quản lý qua UI (`/admin/catalog`), không seed sẵn (do `clinic_admin` tự tạo, giống `PATIENT_SOURCE`/`EXAM_TYPE`). Cùng bản chất `permission`/`icd10_catalog`: không `tenant_id`, không đủ 8 cột bắt buộc. Thêm **không có `version`** (khác `room`/`user_account` — rủi ro ghi đè đồng thời thấp, `clinic_admin` sửa không thường xuyên).

`category` (enum `ETHNICITY`/`NATIONALITY`/`PATIENT_SOURCE`/`EXAM_TYPE`/`RECEPTION_TYPE`/`EXAM_FORM`/`PRIORITY_REASON`/`PRICE_TYPE`), `code` (mã chính thức: dân tộc "1".."54" theo Tổng cục Thống kê, quốc tịch ISO 3166-1 alpha-3, các category còn lại tự đặt bởi `clinic_admin` — đây là giá trị lưu trên `patient.ethnicity`/`patient.nationality`/`encounter.patient_source_code`/`encounter.exam_type_code`/`encounter.reception_type_code`/`encounter.exam_form_code`/`encounter.priority_reason_code`/`encounter.price_type_code`), `name` (tên hiển thị tiếng Việt), `sort_order` (thứ tự hiển thị), `is_active` (soft-delete — xem dưới), `price` (bigint, đồng, nullable — CHỈ có ý nghĩa với category `EXAM_TYPE`, `NULL` với category khác; v1 chỉ lưu để hiển thị, KHÔNG tính toán/xuất hoá đơn — viện phí ngoài phạm vi CLAUDE.md), `unit` (text, nullable — CHỈ có ý nghĩa với category `EXAM_TYPE`, ví dụ "Lượt"/"Buổi", cùng khuôn `price`). Unique `(category, code)`.

**Khác `permission`**: bảng này quản lý được qua chính API bởi `clinic_admin` (`reference_catalog.manage`), không chỉ qua seed script đặc quyền — vì vậy **không** REVOKE `INSERT`/`UPDATE` khỏi `nexamed_app` (giữ nguyên GRANT mặc định qua `ALTER DEFAULT PRIVILEGES`). `DELETE` đã bị revoke toàn cục cho `nexamed_app` từ migration `*_tenant_context` (áp dụng cho mọi bảng, kể cả bảng tạo sau) — "xoá" trong UI quản lý là `is_active=false` (soft), không phải `DELETE` thật.

Quyền: `reference_catalog.read` (`global`) cho mọi vai trò lâm sàng (`receptionist`/`nurse`/`doctor`/`clinic_admin` — ai điền form bệnh nhân cũng cần thấy dropdown); `reference_catalog.manage` (`global`) chỉ `clinic_admin`. **Giới hạn đã biết**: không có cách ly theo tenant (bảng không có `tenant_id`) — nếu triển khai tập trung nhiều phòng khám sau này (v3+), sửa ở một tenant ảnh hưởng mọi tenant khác. Chấp nhận có ý thức ở v1 (on-premise, một tenant/instance).

Seed dữ liệu thật (không phải placeholder) tại `packages/core/src/reference-catalog/data.ts` — 54 dân tộc + 30 quốc tịch, nguồn từ file chủ dự án cung cấp, không tự thêm/bớt/sửa chính tả.

### province / ward (`docs/DECISIONS.md` #038)

Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống (theo sáp nhập hành chính 2025, mã Bộ Nội vụ) — dùng để điền `patient.address_json.province`/`.ward`. Cùng bản chất `icd10_catalog`: không `tenant_id`, không đủ 8 cột bắt buộc, không `version`/`is_active`. **Khác `reference_catalog`**: read-only lúc chạy (không có endpoint create/update/delete) — dữ liệu hành chính chính thức, không ai cần sửa qua UI; vì vậy REVOKE `INSERT`/`UPDATE` khỏi `nexamed_app` (giống `permission`), chỉ seed script (role đặc quyền) ghi được.

`province`: `code` (PK, "1".."34" theo mã Bộ Nội vụ), `name`, `sort_order`.
`ward`: `code` (PK, 8 chữ số — **duy nhất toàn quốc**, không chỉ trong phạm vi tỉnh, đã xác nhận lúc soạn seed nên không cần composite key), `name`, `province_code` (FK → `province.code`), `sort_order`. Index `(province_code)`.

Quyền: dùng lại `patient.read` (không thêm permission mới) — v1 danh mục này chỉ phục vụ điền `patient.address_json`, cùng đối tượng vai trò (`receptionist`/`nurse`/`doctor`/`clinic_admin`) như ma trận mặc định của `patient.read`, tránh lặp lại vấn đề "chưa có cơ chế backfill `role_permission` cho tenant cũ" đã ghi ở `docs/CURRENT.md`.

Seed dữ liệu thật tại `packages/core/src/geo/data.ts` — 34 tỉnh/thành + 3321 phường/xã, nguồn từ file chủ dự án cung cấp (`docs/data/Danh-muc-Phuong-xa_moi.md`), không tự thêm/bớt/sửa chính tả.

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
- **`address_json.province`/`.ward` (`docs/DECISIONS.md` #038, đảo ngược tiếp phần Tỉnh/Xã của #034)**: cùng cách làm với `ethnicity`/`nationality` ở trên — lưu **mã** tham chiếu bảng `province`/`ward` mới (ví dụ `"1"`, `"10105001"`), không lưu tên, chọn qua Combobox cascading (chọn Tỉnh trước để lọc Xã) thay vì gõ tay. Không FK thật trong `address_json` (giá trị nằm trong JSON, không phải cột quan hệ) và không validate khớp danh mục ở tầng Zod — hồ sơ cũ có giá trị dạng tên tự do (trước #038) vẫn hiển thị đúng qua `withLegacyValueOption()` ở web, không mất dữ liệu.

### insurance_card
`patient_id`, `card_no` (mã hoá), `valid_from`, `valid_to`, `benefit_rate`, `initial_facility_code`.
v1 **chỉ lưu và hiển thị**, không tính toán chi trả, không gọi cổng giám định.

### appointment
`patient_id` (NULL — xem dưới), `doctor_id`, `room_id`, `booking_code`, `full_name`, `phone`, `reason`, `scheduled_at`, `duration_minutes`, `status` (`SCHEDULED`/`CANCELLED`/`NO_SHOW`/`CONVERTED`/`RESCHEDULED`), `source` (walk-in / online / phone), `cancel_reason`, `rescheduled_from_id` (uuid, NULL — xem dưới).
Constraint chống trùng khung giờ cùng bác sĩ dùng `EXCLUDE USING gist` trên `(doctor_id WITH =, tstzrange(scheduled_at, scheduled_at + duration) WITH &&)` — kiểm tra ở DB, không chỉ ở service; chỉ áp cho `status='SCHEDULED'` nên tự nhả khung giờ khi lịch chuyển `CANCELLED`/`RESCHEDULED`.

**Đặt lịch "lead capture" (`docs/DECISIONS.md` #032)**: v1 **không** tạo/gắn `patient` lúc đặt lịch — chỉ ghi nhận `full_name`/`phone`/`reason` (tuỳ chọn) trực tiếp trên `appointment`. `patient_id` **nullable**, để sẵn cho lúc Tiếp nhận (Sprint 3, chưa xây) gắn/tạo hồ sơ `patient` thật khi khách check-in tại quầy — hiện tại luôn `NULL`. `booking_code` (mã đặt lịch khách trình lúc đến, `UNIQUE (tenant_id, booking_code)`, prefix `LH`, cùng khuôn `patient_code`/`encounter_no` qua `formatDisplayCode()`/`code_sequence`). Index `(tenant_id, phone)` phục vụ tra cứu lịch sử đặt lịch theo SĐT (tự điền tên, cảnh báo spam ≥5 lần huỷ — ngưỡng này chỉ so sánh ở `apps/web`, `apps/api` không tự chặn). Check-in chuyển thẳng `status: SCHEDULED → CONVERTED`, không sinh trạng thái mới trong enum.

**"Sửa lịch" và "Dời lịch" — 2 thao tác tách biệt, tồn tại song song (`docs/DECISIONS.md` #053)**: "Sửa lịch" (`PATCH /appointments/:id`) đổi giờ/bác sĩ/thời lượng TẠI CHỖ, cùng `id`, không đổi `status` — chỉ trong NGÀY hiện có (ép ở tầng UI, không có ô chọn ngày, không validate lại ở schema/service). "Dời lịch" (`POST /appointments/:id/reschedule`, thay hẳn `PATCH .../reschedule` cũ của S2-09) đổi sang NGÀY KHÁC: lịch cũ chuyển `status='RESCHEDULED'` (giữ nguyên làm lịch sử, không sửa/xoá), một `appointment` MỚI được tạo (id/`booking_code` mới qua `code_sequence`, kế thừa `full_name`/`phone`/`reason`/`room_id`/`duration_minutes`/`source` từ lịch cũ, chỉ nhận `doctorId`+`scheduledAt` mới từ client). `rescheduled_from_id` (composite FK tự tham chiếu `(tenant_id, id)`, không có unique constraint — cùng lựa chọn đã có ở `patient.merged_into_id`) trên lịch MỚI trỏ về lịch CŨ. Cả 2 bước (đánh dấu cũ + tạo mới) chạy trong CÙNG transaction.

### encounter (đã hiện thực — Sprint 3, phần Tiếp nhận)
`patient_id`, `doctor_id`, `appointment_id?` (nullable, composite FK), `encounter_no` (mã hiển thị, prefix `LK`, `UNIQUE(tenant_id, encounter_no)`), `status` (enum 6 giá trị — xem `.claude/docs/clinical-workflow.md`), `specialty`, `checked_in_at`, `started_at?`, `completed_at?`, `chief_complaint?`, `insurance_snapshot` (jsonb — đúng tên cột theo `docs/ERD.md`, không phải `insurance_snapshot_json`), `cancel_reason?`, `patient_source_code?`, `exam_type_code?`, `exam_type_name?`, `exam_type_price?` (4 cột — xem dưới), `reception_type_code?`, `exam_form_code?`, `is_priority`, `priority_reason_code?`, `price_type_code?`, `exam_type_unit?`, `service_quantity` (7 cột mới — thiết kế lại "Tiếp nhận bệnh nhân", xem dưới).
Bảng trung tâm; sinh hiệu (đã có), chẩn đoán/ghi chú/đơn thuốc (chưa xây, giai đoạn Khám bệnh) đều trỏ về `encounter_id`.

**Thiết kế lại "Tiếp nhận bệnh nhân" (`docs/DECISIONS.md` #052, mockup đã duyệt)** — 7 cột mới, tất cả nullable/có default an toàn (áp dụng dần cho encounter mới, không phá dữ liệu cũ): `reception_type_code`/`exam_form_code` (mã danh mục `RECEPTION_TYPE`/`EXAM_FORM`, **bắt buộc ở tầng Zod** cho encounter mới dù cột DB nullable — cùng cách xử lý các trường "bắt buộc ở ứng dụng, nullable ở DB" trước đó). `is_priority` (boolean, default `false`) + `priority_reason_code?` (mã danh mục `PRIORITY_REASON`, **bắt buộc khi `is_priority=true`** — ràng buộc ở `packages/shared` qua `.superRefine()`, không phải DB CHECK). `price_type_code?` (mã danh mục `PRICE_TYPE`, tuỳ chọn, CHỈ để ghi chú — v1 KHÔNG có bảng giá đa mức theo loại khám, việc đó là "Price Book" thật thuộc module Viện phí v2, ngoài phạm vi v1) + `exam_type_unit?`/`service_quantity` (SNAPSHOT Đơn vị/Số lượng tại thời điểm tạo, cùng tinh thần `exam_type_code/name/price` — `service_quantity` default `1`). Toàn bộ nhóm "Chỉ định dịch vụ khám" (`exam_type_*`/`price_type_code`/`service_quantity`) chỉ lưu để hiển thị trong bảng dịch vụ ở web, KHÔNG tính viện phí/xuất hoá đơn (ngoài phạm vi v1, CLAUDE.md).

**`cancel_reason`** — bổ sung ngoài đặc tả ERD gốc: "bỏ về" (`CHECKED_IN→CANCELLED`, bắt buộc lý do, `.claude/docs/clinical-workflow.md`) không soft-delete (giữ `deleted_at = NULL`, cùng cách `appointment.status='CANCELLED'` không soft-delete) nên cần cột riêng lưu lý do, cùng khuôn `appointment.cancel_reason`. ERD gốc (trước Sprint 3) chưa liệt kê cột này vì viết trước khi luồng "bỏ về" được thiết kế cụ thể — xem `docs/DECISIONS.md`.

**`patient_source_code`/`exam_type_code`/`exam_type_name`/`exam_type_price`** — CẢ HAI luồng tạo `encounter` (check-in từ lịch hẹn lẫn "Tiếp nhận bệnh nhân") đều lưu được các cột này (`docs/DECISIONS.md` #044 — trước đó chỉ luồng trực tiếp có, đã đồng bộ để dùng chung 1 biểu mẫu web). `patient_source_code` lưu mã danh mục `reference_catalog` category `PATIENT_SOURCE` (cùng convention `patient.ethnicity`: lưu `code`, không lưu tên), tuỳ chọn. `exam_type_code`/`exam_type_name`/`exam_type_price` là **snapshot** của category `EXAM_TYPE` tại thời điểm tạo (copy nguyên giá trị từ `reference_catalog` lúc web gửi lên, KHÔNG JOIN lại lúc đọc) — cùng tinh thần `insurance_snapshot`, đổi giá/tên danh mục sau này không ảnh hồ sơ cũ. `exam_type_price` (bigint, đồng) chỉ lưu để hiển thị, v1 KHÔNG tính toán/xuất hoá đơn.

**Partial unique `(tenant_id, appointment_id) WHERE appointment_id IS NOT NULL AND deleted_at IS NULL`** — chặn double check-in trên cùng một appointment (phòng vệ race, `ENCOUNTER_ALREADY_EXISTS`). Không khai `@unique` ở Prisma schema (như `patient.nationalIdHash`) — Prisma không biểu diễn được unique có điều kiện `WHERE`. `appointment_id = NULL` (luồng "Tiếp nhận bệnh nhân") không bị index này áp — nhiều encounter cùng `appointment_id=NULL` là bình thường.

**v1 tạo dòng thẳng ở `CHECKED_IN` qua HAI luồng khác nhau**: (1) `ReceptionService.checkIn()` (module `reception`) đọc `appointment` đã `SCHEDULED`, tạo `encounter`, chuyển `appointment` sang `CONVERTED`, gắn `patient_id` (đã resolve ở web trước đó) — tất cả atomic trong 1 transaction (2 module chia sẻ Repository qua Nest `exports`, xem `docs/DECISIONS.md`); (2) `ReceptionService.registerDirect()` — tạo thẳng `encounter` với `appointment_id=NULL`, không đụng `appointment`, đơn giản hơn vì không có bước cập nhật kèm theo. `insurance_snapshot` v1 luôn `{ selfPay: true }` (module `insurance_card`/S2-04 chưa làm). `SCHEDULED`/`NO_SHOW` chưa có luồng nào ghi tới cho riêng bảng này — không phải state machine sai, chỉ chưa có use case.

**"Bắt đầu khám" (`CHECKED_IN→IN_CONSULTATION`) và "bỏ về" (`CHECKED_IN→CANCELLED`)** thuộc module `encounter` (`apps/api/src/modules/encounter/`, KHÁC `reception` — đúng ranh giới `architecture.md`: `reception` = tạo encounter + sinh hiệu ban đầu, `encounter` = state machine + transition).

**Khung tối thiểu cho đa chuyên khoa (`docs/DECISIONS.md` #033, chưa triển khai ở v1)**: `specialty` (text, mặc định `'general'`) — chuyên khoa của lượt khám này, không phải của tenant. v1 luôn `'general'`. Không thêm bảng tầng cha dài hạn (thai kỳ, lộ trình điều trị) hay logic rẽ nhánh theo chuyên khoa ở v1 — chỉ chuẩn bị cột để Sprint 3 không phải retrofit sau. Màn hình khám (S3-06, chưa xây) và mọi component liên quan phải nhận cấu hình trường qua props, không hard-code riêng cho một chuyên khoa.

### vital_sign (đã hiện thực — Sprint 3, REC-02/03)
`encounter_id`, `pulse?`, `temperature_deci_c?`, `bp_systolic?`, `bp_diastolic?`, `respiratory_rate?`, `spo2?`, `weight_gram?`, `height_mm?`, `measured_at`.
Cân nặng/chiều cao lưu số nguyên (gram, mm) để tránh số thực; nhiệt độ lưu phần mười độ C (37.5°C → `375`). Mọi chỉ số đo NULLABLE — cho phép nhập từng phần, không bắt buộc đủ mọi chỉ số trong một lần ghi.

**Ghi lúc tiếp nhận (`docs/DECISIONS.md` #044)**: `ReceptionService.checkIn()`/`registerDirect()` đều nhận kèm sinh hiệu tuỳ chọn ngay trên biểu mẫu tiếp nhận — có nhập thì tạo 1 dòng `vital_sign` trong CÙNG transaction với `encounter` (không tính `warnings`, khác endpoint dưới). `POST /reception/encounters/:id/vital-signs` (REC-02/03, có `warnings` theo ngưỡng tuổi) vẫn là hạ tầng RIÊNG cho lúc bổ sung/ghi thêm sau (module Khám bệnh tương lai gọi lại) — không còn giao diện độc lập trên "Danh sách tiếp nhận" nữa (đã bỏ `VitalSignForm.tsx`).

**Không có cột `measured_by` riêng** — mô tả tóm tắt trước đây của tài liệu này có nhắc cột này nhưng `docs/ERD.md` (bản chi tiết) chưa từng có; dùng `created_by` (đã là 1 trong 8 cột bắt buộc) thay thế, tránh cột trùng ý nghĩa khi chưa có nhu cầu "ghi hộ" thật (cùng cách xử lý mâu thuẫn 2 tài liệu như `docs/DECISIONS.md` #007/#024 — theo bản chi tiết hơn).

**Ngưỡng cảnh báo ngoài giới hạn sinh lý (REC-03)** — `packages/core/src/vital-sign/vital-sign-thresholds.ts` (`evaluateVitalSignWarnings()`), theo 3 nhóm tuổi (< 1 tuổi / 1–12 tuổi / ≥13 tuổi) cho mạch + nhịp thở, ngưỡng chung cho nhiệt độ/SpO2, 2 nhóm cho huyết áp (dưới/từ 13 tuổi) — hằng số cố định trong code, **không** đọc từ `tenant_setting` (khác ngưỡng no-show). Luôn chỉ cảnh báo, không bao giờ chặn lưu — xem `docs/DECISIONS.md`.

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
