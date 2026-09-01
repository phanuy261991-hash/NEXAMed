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

`department`: `name` — khoa/phòng trong tenant, phục vụ Data Scope `department` (xem `security-audit.md`). v1 phần lớn phòng khám không dùng nhưng bảng luôn tồn tại. `user_account` có thêm `department_id uuid NULL` (FK `(tenant_id, id)` tới `department`). `is_default boolean NOT NULL DEFAULT false` ("Hàng đợi ảo", `docs/DECISIONS.md` #064) — đúng 1 Khoa "mặc định" ("Khoa chung")/tenant (partial unique `(tenant_id) WHERE is_default`), tự seed lúc tạo tenant (`seedDefaultRolesForTenant()`) — dùng làm fallback `encounter.department_id` khi bác sĩ chưa gán Khoa.
`user_account` có thêm (S1-04) `failed_login_count int NOT NULL DEFAULT 0`, `last_failed_login_at timestamptz NULL`, `locked_until timestamptz NULL` — khoá tài khoản tạm sau 5 lần đăng nhập sai trong 15 phút, xem `security-audit.md` mục Xác thực và `packages/core/src/iam/lockout.ts` (nguồn sự thật của ngưỡng/logic).

**Mở rộng ADM-01 — hồ sơ nhân sự + Quản lý tài khoản (yêu cầu chủ dự án 2026-08-20)**: lần đầu có UI web thật cho `department` (trước đó chỉ có bảng, không module/API), và `user_account` mở rộng thêm hồ sơ nhân sự đầy đủ.

- `department` thêm: `code text NULL` (mã hiển thị tự sinh qua `code_sequence`, prefix `KP`, đúng khuôn `patient_code`/`employee_code` — **không nhập tay**, nullable vì phòng ban tạo trước tính năng này không backfill), `department_type_id uuid NULL` (composite FK `(tenant_id, id)` → `department_type`, xem dưới), `is_active boolean NOT NULL DEFAULT true` (quản lý Thêm/Sửa/Ẩn qua UI, cùng khuôn `room` — **không** soft-delete `deleted_at`, giữ nguyên lịch sử gán trên `user_account.department_id` khi ẩn).
- `department_type` (bảng mới — "Loại Khoa/Phòng", theo yêu cầu chủ dự án tham khảo mẫu `floor`/`room`): đủ 8 cột bắt buộc + `name`, `is_active`. Cấp cha **tùy chọn** của `department` (`department.department_type_id` nullable, C13-style) — THUẦN phân loại/tổ chức, không ảnh hưởng logic nghiệp vụ nào khác. Web bố cục master-detail (cột trái "Loại Khoa/Phòng" lọc cột phải "Khoa/Phòng"), tham khảo nguyên `RoomPane.tsx` (Tầng lọc Phòng).
- `user_account` thêm hồ sơ nhân sự (tất cả nullable, tài khoản cũ không backfill): `employee_code text NULL` (mã hiển thị tự sinh, prefix `NV`, đúng khuôn `patient_code`), `phone`, `personal_email`, `company_email`, `academic_title_code`/`position_code`/`employment_status_code`/`employment_type_code` (4 cột lưu `code` tham chiếu `reference_catalog`, category tương ứng — xem dưới, không FK cứng, cùng khuôn `patient.ethnicity`/`occupation`), `can_sign_medical_record boolean NOT NULL DEFAULT false` ("Được ký HSBA" — **chỉ lưu metadata ở v1**, chưa gắn logic chặn nào, chữ ký số/chữ ký logic thật là Sprint 5), `must_change_password boolean NOT NULL DEFAULT false` (bắt đổi mật khẩu ở lần đăng nhập kế tiếp — **enforce thật**, xem `auth.service.ts#changePassword` + `RequireAuth.tsx` chặn điều hướng phía web).
- `reference_catalog` thêm 4 category mới: `ACADEMIC_TITLE` (Học vị/học hàm), `STAFF_POSITION` (Chức danh) — không seed cứng, `clinic_admin` tự thêm qua UI (cùng lý do `OCCUPATION`); `EMPLOYMENT_STATUS` (Trạng thái làm việc), `EMPLOYMENT_TYPE` (Hình thức làm việc) — CÓ seed 3/4 giá trị mặc định (`packages/core/src/reference-catalog/data.ts`, chủ dự án cho sẵn) nhưng vẫn quản lý được qua UI. Cột mới `deactivates_account boolean NOT NULL DEFAULT false` — CHỈ có ý nghĩa với category `EMPLOYMENT_STATUS` (cùng khuôn `price`/`unit` chỉ có ý nghĩa với `EXAM_TYPE`): khi `true` (ví dụ "Nghỉ việc"), tài khoản gán trạng thái đó tự động `is_active=false` (xem `resolveAccountActiveState`, `packages/core/src/iam/employment-status.ts`) — tách cột riêng thay vì so khớp `code` cố định vì `code` sửa được qua UI (`ReferenceCatalogPane`), so khớp chuỗi sẽ hỏng ngầm khi admin đổi mã. **4 category nhân sự này KHÔNG cho nhập tay `code`** — server tự sinh (`generateReferenceCatalogCode`, `packages/core/src/reference-catalog/generate-code.ts`, dùng `crypto.randomUUID()` + tiền tố 2 ký tự category, retry khi trùng ngẫu nhiên) khi client không gửi `code`; web tương ứng ẩn hẳn ô/cột "Mã" cho 4 category này (`AUTO_CODE_CATEGORIES` trong `ReferenceCatalogPane.tsx`) — khác các category cũ (Dân tộc/Quốc tịch...) vẫn nhập mã tay.

**Redesign form "Thêm tài khoản" sang 3-tab (2026-08-27, `docs/DECISIONS.md` #082)** — chủ dự án gửi mockup chi tiết theo 3 nhóm "Thông tin chung"/"Chuyên môn và Pháp lý"/"Cấu hình và Vai trò" (duyệt qua Artifact tương tác nhiều vòng trước khi code). Migration `20260827100000_user_account_profile_tabs` viết tay (RENAME COLUMN giữ dữ liệu `personal_email`→`email`, không để Prisma tự DROP+ADD):

- **Gộp Email**: `personal_email`/`company_email` cũ → 1 cột `email` duy nhất (đổi tên `personal_email`, xoá hẳn `company_email` — không backfill, chốt qua `AskUserQuestion`, chấp nhận vì chưa có tenant production).
- **Trường mới, tất cả nullable** (tài khoản cũ không backfill): `dob date NULL`, `gender text NULL` (2 giá trị `male`/`female` — khác `patient.gender` có thêm `other`, kiểm ở tầng Zod `userAccountGenderSchema`, không CHECK constraint DB, cùng cách các mã `*_code` khác trong bảng này), `license_issued_at date NULL`/`license_issued_place text NULL` (đi cùng `license_no` có sẵn từ ADM-01 nhưng UI trước đây chưa từng hiển thị), `display_name text NULL` (**bắt buộc ở tầng Zod lúc tạo mới** dù cột DB nullable — web tự gợi ý ghép Học vị/Học hàm + Họ tên, người dùng sửa lại tự do; dùng khi in đơn thuốc/HSBA và mọi nơi hiển thị tên tài khoản, thay `full_name` cho mục đích hiển thị), `signature_key text NULL` (ảnh chữ ký PNG, khoá lưu `StoragePort` — cùng khuôn `patient.photo_key`/`tenant.logo_key`, endpoint riêng `POST /users/:id/signature` vì cần `id` có sẵn để đặt tên key, **chỉ nhận PNG** qua `sniffImageExtension()` — khác `patient.photoKey` nhận cả JPG, không kiểm được thật sự "nền trong suốt" ở server), `default_room_id uuid NULL` (composite FK `(tenant_id, id)` → `room`, ON DELETE RESTRICT ON UPDATE CASCADE, cùng mẫu `department_id` — "Phòng khám mặc định" THUẦN gợi ý hiển thị, **không** đụng cơ chế điều phối thật "Phòng làm việc hôm nay" `doctor_room_session` #054).
- **Danh sách tài khoản** (`UserAccountPane.tsx`) thêm nút "Vô hiệu hoá" nhanh (icon, kèm modal xác nhận — cùng mẫu "Xoá" ở `ReferenceCatalogPane.tsx`) và "Kích hoạt lại" (trực tiếp, không xác nhận) — cả hai chỉ gọi `PATCH /users/:id` với `isActive`, không endpoint mới. Logic "Trạng thái làm việc tự-vô-hiệu-hoá tài khoản" (`resolveAccountActiveState`, ADM-01) giữ nguyên không đổi.

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

### work_shift (`docs/DECISIONS.md` #101)

Danh mục "Ca làm việc" — mẫu ca (Ca sáng/Ca chiều...) do `clinic_admin` tự quản lý qua UI, mục con "Ca làm việc" trong pill "Cấu hình phòng khám". **Ban đầu định tái dùng `reference_catalog` (đã dùng cho EXAM_TYPE/PATIENT_SOURCE/UNIT...) nhưng đổi hướng lúc duyệt mockup**: `reference_catalog` là danh mục TOÀN HỆ THỐNG (không `tenant_id`, giống `icd10_catalog`/`province`) — mỗi phòng khám tự đặt giờ ca của riêng mình, không phải danh mục chia sẻ nhiều tenant, nên phải là bảng RIÊNG tenant-scoped, cùng khuôn `room`/`department` (đủ 8 cột bắt buộc bao gồm `tenant_id`, RLS, `CHECK(version>=1)`).

Cột đặc thù: `name`, `code` (tự sinh — tái dùng `generateReferenceCatalogCode()`, không nhập tay), `start_time`/`end_time` (`text` dạng `"HH:mm"`, so sánh chuỗi đủ dùng — cùng khuôn `tenant_setting.business_hours`/`DayHours.open-close`, không cần kiểu `time` của Postgres), `color` (`text`, enum 8 giá trị cố định ở tầng Zod — `blue`/`teal`/`emerald`/`amber`/`rose`/`purple`/`cyan`/`slate`, không color-picker tự do), `rest_start_time`/`rest_end_time` (`text` `"HH:mm"`, **tuỳ chọn**, độc lập với `rest_minutes` — không bắt buộc khớp nhau), `rest_minutes`/`standard_work_minutes` (`int`, đơn vị PHÚT — "Tổng thời gian nghỉ"/"Số giờ công chuẩn" đều nhập ở web theo giờ/phút rồi quy đổi về phút lúc gửi, nhất quán với `durationMinutes`/`GRID_STEP_MINUTES` đã dùng trong hệ thống, không dùng kiểu decimal riêng), `sort_order`, `is_active`. Unique `(tenant_id, code)`.

Validate `endTime > startTime` và (khi có cả `restStartTime`/`restEndTime`) `restEnd > restStart` + cả hai nằm trong `[startTime, endTime]` — ở tầng SERVICE (`WorkShiftService`), không phải Zod thuần, vì cần so sánh 2 field với nhau (lỗi mới `WorkShiftInvalidTimeRangeError`, 422). Modal riêng `WorkShiftFormModal.tsx` (không dùng chung `ItemFormModal` của `reference_catalog` — schema khác hẳn), theo Boxed Section Form Pattern (`.claude/docs/ui-guidelines.md` mục 9b) vì đủ 9 trường.

Quyền: dùng lại `clinic_config.read`/`.update` như `room` — không permission mới. CRUD qua `PATCH` kèm `isActive`+`version` (đúng khuôn `RoomController`, không endpoint deactivate/reactivate riêng như `reference_catalog`).

**Chỉ là Giai đoạn 1 (danh mục mẫu ca).** Giai đoạn kế tiếp (chưa xây, chưa thiết kế chi tiết): bác sĩ đăng ký ca theo tuần/tháng từ danh mục này (bảng mới, ví dụ `doctor_shift_assignment`, ràng buộc không vượt `business_hours` của đúng ngày trong tuần — validate lúc ĐĂNG KÝ chứ không phải lúc tạo mẫu ca vì mẫu ca không gắn thứ nào), bảng lịch làm việc toàn thể nhân viên (phân quyền xem), lọc cột bác sĩ ở lưới Lịch hẹn theo ca đã đăng ký, và chặn đặt lịch ngoài ca (lỗi 422 mới ở `AppointmentService`). Không nhầm với `doctor_room_session` (#054, chọn phòng vật lý mỗi ngày) hay `doctor_availability` (#094, trạng thái tức thời ACTIVE/BREAK/ENDED) — "ca làm việc" là recurring/đăng ký trước, trục hoàn toàn khác.

### user_session (S1-04 — xem `security-audit.md` mục Xác thực, `docs/DECISIONS.md` #019)

Phiên refresh token, phục vụ "xoay vòng mỗi lần refresh" (rotation) + phát hiện token bị đánh cắp (reuse detection). Đủ 8 cột bắt buộc, cộng: `user_id` (composite FK `(tenant_id, user_id)` → `user_account`), `refresh_token_hash text UNIQUE NOT NULL` (SHA-256 của refresh token thật — **không** lưu token thô), `issued_at`, `expires_at`, `replaced_by_session_id uuid NULL` (composite FK `(tenant_id, replaced_by_session_id)` → chính bảng này — phiên kế tiếp trong chuỗi rotation), `ip`, `user_agent`.

Thu hồi = soft delete (`deleted_at` + `deleted_reason`: `logout`/`rotated`/`expired`/`reuse_detected`/`account_disabled`) — tái dùng đúng pattern sẵn có, không có cột `revoked` riêng. RLS + `CHECK(version >= 1)` như mọi bảng có `tenant_id`. Index `(tenant_id, user_id, expires_at DESC) WHERE deleted_at IS NULL`.

### role / permission / role_permission — RBAC + Data Scope (xem `security-audit.md` để biết quy tắc nghiệp vụ đầy đủ)

Thay thế mô hình vai trò cứng cũ (enum `UserRoleName` trực tiếp trên `user_role`) — quyết định 2026-08-08, `docs/DECISIONS.md` #013.

- `role`: `tenant_id`, `name`, `is_system_default boolean`. Theo tenant — seed 5 vai trò mặc định (`receptionist`, `nurse`, `doctor`, `clinic_admin`, `system_admin`) khi tạo tenant. **ADM-07 (đã hiện thực)**: `clinic_admin` tạo/đổi tên/ẩn được vai trò tuỳ biến (`is_system_default=false`) qua `POST/PATCH/POST :id/hide /api/v1/roles`; vai trò mặc định chỉ sửa ma trận quyền, không đổi tên/ẩn (`RoleImmutableError`). Unique `(tenant_id, name)` là **PARTIAL** (`WHERE deleted_at IS NULL`, migration `20260820090000_role_management`) — cùng lý do `user_role`/`patient.national_id_hash`, cho phép tạo lại đúng tên vai trò đã từng bị ẩn.
- `permission`: **toàn hệ thống**, không có `tenant_id` (giống `icd10_catalog`) — `module`, `action`, `description`. Seed cố định theo code, không do phòng khám tự thêm. Unique `(module, action)`.
- `role_permission`: `tenant_id`, `role_id`, `permission_id`, `data_scope` (enum `none`/`personal`/`department`/`global`). Composite FK `(tenant_id, role_id)` → `role`. Unique `(tenant_id, role_id, permission_id)`.
- `user_role`: bảng nối `user_account` ↔ `role` (giữ tên cũ, đổi bản chất từ "user + enum vai trò" sang "user + role_id" — xem `docs/DECISIONS.md` #013). `tenant_id`, `user_id`, `role_id`. Composite FK cả hai chiều `(tenant_id, user_id)` → `user_account`, `(tenant_id, role_id)` → `role`. Unique `(tenant_id, user_id, role_id)` — một user có thể có nhiều vai trò.

### reference_catalog (`docs/DECISIONS.md` #037)

Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — đảo ngược `docs/DECISIONS.md` #034 phần `ethnicity`/`nationality`). Sprint 3 mở rộng thêm 2 category: `PATIENT_SOURCE` (Nguồn khách hàng) và `EXAM_TYPE` (Loại khám) — phục vụ trang "Tiếp nhận bệnh nhân", tái dùng nguyên bảng này thay vì tạo bảng riêng (cùng hình dạng: danh sách tên có sắp xếp, quản lý qua Cấu hình). Thiết kế lại "Tiếp nhận bệnh nhân" (`docs/DECISIONS.md` #052, mockup đã duyệt) mở rộng thêm 4 category nữa: `RECEPTION_TYPE` (Loại tiếp nhận), `EXAM_FORM` (Hình thức khám), `PRIORITY_REASON` (Lý do ưu tiên), `PRICE_TYPE` (Loại giá dịch vụ) — cùng lý do tái dùng bảng này, quản lý qua UI (`/admin/catalog`), không seed sẵn (do `clinic_admin` tự tạo, giống `PATIENT_SOURCE`/`EXAM_TYPE`). `OCCUPATION` (Nghề nghiệp, `docs/DECISIONS.md` #061) — đảo ngược tiếp phần `occupation` của #034 (trước đây cố ý để text tự do), cũng không seed sẵn. Cùng bản chất `permission`/`icd10_catalog`: không `tenant_id`, không đủ 8 cột bắt buộc. Thêm **không có `version`** (khác `room`/`user_account` — rủi ro ghi đè đồng thời thấp, `clinic_admin` sửa không thường xuyên).

`category` (enum `ETHNICITY`/`NATIONALITY`/`PATIENT_SOURCE`/`EXAM_TYPE`/`RECEPTION_TYPE`/`EXAM_FORM`/`PRIORITY_REASON`/`PRICE_TYPE`), `code` (mã chính thức: dân tộc "1".."54" theo Tổng cục Thống kê, quốc tịch ISO 3166-1 alpha-3, các category còn lại tự đặt bởi `clinic_admin` — đây là giá trị lưu trên `patient.ethnicity`/`patient.nationality`/`encounter.patient_source_code`/`encounter.exam_type_code`/`encounter.reception_type_code`/`encounter.exam_form_code`/`encounter.priority_reason_code`/`encounter.price_type_code`), `name` (tên hiển thị tiếng Việt), `sort_order` (thứ tự hiển thị), `is_active` (soft-delete — xem dưới), `price` (bigint, đồng, nullable — CHỈ có ý nghĩa với category `EXAM_TYPE`, `NULL` với category khác; v1 chỉ lưu để hiển thị, KHÔNG tính toán/xuất hoá đơn — viện phí ngoài phạm vi CLAUDE.md), `unit` (text, nullable — CHỈ có ý nghĩa với category `EXAM_TYPE`, ví dụ "Lượt"/"Buổi", cùng khuôn `price`). Unique `(category, code)`.

**Khác `permission`**: bảng này quản lý được qua chính API bởi `clinic_admin` (`reference_catalog.manage`), không chỉ qua seed script đặc quyền — vì vậy **không** REVOKE `INSERT`/`UPDATE` khỏi `nexamed_app` (giữ nguyên GRANT mặc định qua `ALTER DEFAULT PRIVILEGES`). `DELETE` đã bị revoke toàn cục cho `nexamed_app` từ migration `*_tenant_context` (áp dụng cho mọi bảng, kể cả bảng tạo sau) — "xoá" trong UI quản lý là `is_active=false` (soft), không phải `DELETE` thật.

Quyền: `reference_catalog.read` (`global`) cho mọi vai trò lâm sàng (`receptionist`/`nurse`/`doctor`/`clinic_admin` — ai điền form bệnh nhân cũng cần thấy dropdown); `reference_catalog.manage` (`global`) chỉ `clinic_admin`. **Giới hạn đã biết**: không có cách ly theo tenant (bảng không có `tenant_id`) — nếu triển khai tập trung nhiều phòng khám sau này (v3+), sửa ở một tenant ảnh hưởng mọi tenant khác. Chấp nhận có ý thức ở v1 (on-premise, một tenant/instance).

Seed dữ liệu thật (không phải placeholder) tại `packages/core/src/reference-catalog/data.ts` — 54 dân tộc + 30 quốc tịch, nguồn từ file chủ dự án cung cấp, không tự thêm/bớt/sửa chính tả.

**Mở rộng ADM-01 (2026-08-20)** — thêm 4 category `ACADEMIC_TITLE`/`STAFF_POSITION`/`EMPLOYMENT_STATUS`/`EMPLOYMENT_TYPE` + cột `deactivates_account` + cơ chế tự sinh `code` — xem chi tiết đầy đủ ở mục "clinic / tenant_setting / room / department / user_account" phía trên (đặt cùng chỗ mô tả `user_account` mở rộng, vì 2 thay đổi này gắn liền nhau).

**`UNIT` (Đơn vị tính, 2026-08-26, chủ dự án yêu cầu trực tiếp)** — category mới, mã tự sinh (cùng cơ chế 4 category ADM-01 ở trên), quản lý qua trang "Danh mục dùng chung" (đổi tên từ "Danh mục hành chính" cùng đợt). Thêm cột `description` (text, nullable — CHỈ có ý nghĩa với category `UNIT`, cùng khuôn `price`/`unit`/`deactivates_account`). Trang quản lý cho phép set `is_active` ngay trong form Thêm/Sửa cho riêng category này (category khác vẫn chỉ qua action Xoá/Khôi phục — không đổi hành vi cũ).

### allergen_group / allergen (`docs/DECISIONS.md` #069)

Danh mục "Dị nguyên" — TOÀN HỆ THỐNG, cùng bản chất `reference_catalog`: không `tenant_id`, không đủ 8 cột bắt buộc, không `version`. `allergen_group` (`id`, `code` unique, `name`, `is_active`); `allergen` (`id`, `allergen_group_id` FK bắt buộc — mỗi Dị nguyên luôn thuộc đúng 1 Nhóm, `code` unique, `name`, `is_active`). Quản lý qua API (`allergen_catalog.manage`/`.create` — tách quyền tạo mới cho lễ tân/điều dưỡng/bác sĩ, #076). Bệnh nhân gán dị nguyên qua bảng nối `patient_allergen` (theo tenant, đủ 8 cột bắt buộc, migration `20260825100000_patient_allergen`).

### exam_type_price (`docs/DECISIONS.md` #079)

"Đơn giá dịch vụ" — bảng giá đa mức THEO TENANT cho một mục `reference_catalog` category `EXAM_TYPE` (mở rộng phạm vi v1 có giới hạn, 2026-08-26 — KHÔNG phải "Price Book" đầy đủ, xem CLAUDE.md). Khác `reference_catalog` cha (toàn hệ thống, không đủ 8 cột bắt buộc): bảng này TÁCH THEO TENANT vì giá dịch vụ khác nhau thật giữa các phòng khám dù cùng tên dịch vụ — đủ 8 cột bắt buộc + RLS như mọi bảng nghiệp vụ khác.

`exam_type_code`/`price_type_code`/`unit_code` (text, tham chiếu `reference_catalog.code` theo category `EXAM_TYPE`/`PRICE_TYPE`/`UNIT` — KHÔNG FK composite thật, cùng cách mọi cột khác tham chiếu bảng đa-category này), `amount` (bigint, đồng), `effective_from`/`effective_to` (`@db.Date` — ngày lịch, không phải mốc thời gian; `effective_to` nullable = vô thời hạn).

Sửa/xoá tự do (không phải `SignableEntity`, không giữ lịch sử giá — chốt qua `AskUserQuestion` 2026-08-26). Quản lý bằng **bulk-replace** (đúng khuôn `diagnosis.replaceForEncounter()`): mỗi lần Lưu gửi TOÀN BỘ danh sách đơn giá, server xoá mềm hết dòng cũ rồi tạo lại — không diff từng dòng.

**C20** — `EXCLUDE USING gist` trên `(tenant_id, exam_type_code, price_type_code, daterange(effective_from, COALESCE(effective_to,'infinity'),'[]'))` chặn 2 dòng cùng dịch vụ + cùng Loại giá dịch vụ có khoảng ngày hiệu lực chồng lấn, kể cả ghi đồng thời (cùng kỹ thuật C2 — `appointment_doctor_slot_excl`, cần `btree_gist`, hàm `nexamed_exam_type_price_range()` đánh dấu `IMMUTABLE`). Vi phạm ném `PrismaClientUnknownRequestError`, map thành `ExamTypePriceOverlapError` (409 `EXAM_TYPE_PRICE_OVERLAP`).

Quyền: dùng chung `reference_catalog.read`/`reference_catalog.manage` (không thêm permission mới) — quản lý qua CÙNG modal Thêm/Sửa "Dịch vụ khám" (`ExamTypeFormModal.tsx`), bulk-replace trong CÙNG transaction tạo/sửa `reference_catalog` (không phải endpoint riêng).

### icd10_catalog (`docs/DECISIONS.md` #056)

Danh mục ICD-10 toàn hệ thống (S3-01, mở khoá một phần — hiện seed ĐỦ Chương I-XXII, 15.844 mã, qua cơ chế seed idempotent). Cùng bản chất `province`/`ward`: không `tenant_id`, không đủ 8 cột bắt buộc, không `version`. Read-only lúc chạy (khác `reference_catalog`) — danh mục Bộ Y tế, không ai cần sửa qua UI; vì vậy REVOKE `INSERT`/`UPDATE` khỏi `nexamed_app`, chỉ seed script (role đặc quyền) ghi được. `chapter_code` là số La Mã ("I".."XXII") — thứ tự hiển thị đúng phải sắp lại ở tầng ứng dụng qua `romanToInt()` (`packages/core/src/icd10/roman-numeral.ts`), sắp trực tiếp theo thứ tự chuỗi ở DB sẽ sai ("IX" đứng trước "V").

`code` (PK, ví dụ `A00`, `A00.0`) — dòng có `code === group_code` là dòng cấp Nhóm (3 ký tự), các dòng khác là mã chi tiết (4-5 ký tự) thuộc nhóm đó. `name_vi`/`name_en`, `search_key` (generated column, tái dùng nguyên hàm `nexamed_unaccent_lower()` đã tạo từ `patient` S2-02 — không định nghĩa lại). `chapter_code`/`chapter_name`, `block_code`/`block_name`, `group_code`/`group_name` — 3 cấp phân loại của WHO (thay field `chapter` đơn lẻ ở bản thiết kế trước v1.17 của `docs/ERD.md`). `is_billable` (suy từ ghi chú "Dùng mã 4–5 ký tự chi tiết hơn" trong dữ liệu nguồn — `false` cho dòng cấp Nhóm). `gender_restriction` (`male`/`female`/null), `usage_restriction` (`limited_primary`/`not_primary`/null) — chỉ hiển thị cảnh báo mềm ở trang tra cứu, KHÔNG có logic chặn (thuộc bộ chọn chẩn đoán ở màn khám, S3-06/07, chưa xây). `who_note` — nội dung cột "Hướng dẫn WHO 2019" của dữ liệu nguồn, nullable.

Ký hiệu chéo `†` (dagger, mã nguyên nhân) và `*` (asterisk, mã biểu hiện) — hệ thống dagger/asterisk của WHO — trong file nguồn đã bị tách khỏi `code` (và `group_code` khi dòng Nhóm chính nó bị đánh dấu, ví dụ `F00*` ở Chương V) lúc parse — không phải một phần của mã ICD-10 thật, giữ lại sẽ làm PK sai định dạng chuẩn. Không mất thông tin: các mã `*`/`†` liên quan vẫn hiện nguyên trong `name_vi`/`name_en`.

Quyền: dùng lại `patient.read` (không thêm permission mới) — cùng lý do đã chốt cho `province`/`ward`, tránh vấn đề "chưa có cơ chế backfill `role_permission` cho tenant cũ".

Seed dữ liệu thật tại `packages/core/src/icd10/data.ts` — sinh bằng script dùng-một-lần đọc TOÀN BỘ file khớp mẫu `docs/data/icd10-chuong-*.md` (file gốc chủ dự án cung cấp, copy byte-for-byte, không tự gõ tay), không phải placeholder. Thêm chương mới chỉ cần thêm file đúng tên rồi chạy lại script.

### province / ward (`docs/DECISIONS.md` #038)

Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống (theo sáp nhập hành chính 2025, mã Bộ Nội vụ) — dùng để điền `patient.address_json.province`/`.ward`. Cùng bản chất `icd10_catalog`: không `tenant_id`, không đủ 8 cột bắt buộc, không `version`/`is_active`. **Khác `reference_catalog`**: read-only lúc chạy (không có endpoint create/update/delete) — dữ liệu hành chính chính thức, không ai cần sửa qua UI; vì vậy REVOKE `INSERT`/`UPDATE` khỏi `nexamed_app` (giống `permission`), chỉ seed script (role đặc quyền) ghi được.

`province`: `code` (PK, "1".."34" theo mã Bộ Nội vụ), `name`, `sort_order`.
`ward`: `code` (PK, 8 chữ số — **duy nhất toàn quốc**, không chỉ trong phạm vi tỉnh, đã xác nhận lúc soạn seed nên không cần composite key), `name`, `province_code` (FK → `province.code`), `sort_order`. Index `(province_code)`.

Quyền: dùng lại `patient.read` (không thêm permission mới) — v1 danh mục này chỉ phục vụ điền `patient.address_json`, cùng đối tượng vai trò (`receptionist`/`nurse`/`doctor`/`clinic_admin`) như ma trận mặc định của `patient.read`, tránh lặp lại vấn đề "chưa có cơ chế backfill `role_permission` cho tenant cũ" đã ghi ở `docs/CURRENT.md`.

Seed dữ liệu thật tại `packages/core/src/geo/data.ts` — 34 tỉnh/thành + 3321 phường/xã, nguồn từ file chủ dự án cung cấp (`docs/data/Danh-muc-Phuong-xa_moi.md`), không tự thêm/bớt/sửa chính tả.

### break_glass_session

`tenant_id`, `actor_id`, `entity_type`, `entity_id`, `reason`, `occurred_at`, `expires_at`. Append-only như `audit_log` (không `updated_at`/`deleted_at`/`version`/`created_by`/`updated_by`) — mỗi lần "phá kính" là một bản ghi mới, không sửa/gia hạn bản ghi cũ. Xem quy tắc đầy đủ ở `security-audit.md` mục Break-glass.

### patient
`full_name`, `dob`, `gender`, `phone`, `national_id`, `address_json`, `allergy_note`, `personal_history`, `family_history`.
- `personal_history`/`family_history` (nullable, `docs/DECISIONS.md` #068) — đúng khuôn `allergy_note`: dữ liệu chung của bệnh nhân, sửa tại chỗ qua `PATCH /patients/:id`, KHÔNG gắn theo từng `encounter_id` (trước đây là 2 giá trị `PERSONAL_HISTORY`/`FAMILY_HISTORY` của `clinical_note.section`, đã chuyển sang đây vì bác sĩ phải nhập lại từ đầu mỗi lượt khám mới dù nội dung hầu như không đổi).
- `national_id` mã hoá at-rest (AES-256-GCM, `apps/api/src/infrastructure/crypto/pii-encryption.ts`); cột `national_id_hash` (HMAC-SHA256 dùng chính `ENCRYPTION_KEY` làm khoá — tương đương "SHA-256 + salt hệ thống") để tra trùng.
- Partial unique `(tenant_id, national_id_hash) WHERE national_id_hash IS NOT NULL` (CCCD tuỳ chọn ở tầng DB — không thể `UNIQUE` thường vì sẽ chặn nhiều bệnh nhân cùng NULL). Trùng họ tên + ngày sinh chỉ cảnh báo ở UI, không chặn (S2-03).
- **Ràng buộc nghiệp vụ (`docs/DECISIONS.md` #036, không phải ràng buộc DB)**: `createPatientRequestSchema` (`packages/shared/src/patient.ts`) bắt buộc `national_id` khi bệnh nhân >= 18 tuổi tại thời điểm tạo hồ sơ (tính từ `dob`); dưới 18 vẫn tuỳ chọn. **Chỉ áp cho tạo mới**, không áp lại cho `updatePatientRequestSchema` — sửa hồ sơ người lớn cũ chưa có CCCD (tạo trước ràng buộc này) không bị chặn.
- Có `merged_into_id` phục vụ luồng gộp hồ sơ trùng trong cùng tenant; không xoá bản ghi nguồn.
- **Chuẩn bị cho hồ sơ dùng chung liên tenant (v3+)**: cột `global_patient_ref uuid NULL` + `identity_verified_at timestamptz NULL`. v1 luôn để null, mọi truy vấn vẫn đi theo `(tenant_id, id)`. Việc phân giải danh tính đi qua `PatientIdentityPort` (adapter v1 trả chính `patient.id`), nên khi bật master patient index chỉ cần thay adapter, không sửa service. **Không** viết code đọc dữ liệu bệnh nhân xuyên tenant ở v1.
- **Mở rộng hồ sơ hành chính (`docs/DECISIONS.md` #034)**: `photo_key` (text null — key trên `StoragePort`, không phải URL; phục vụ qua signed URL có hạn, xem `apps/api/src/infrastructure/storage/signed-url.ts`), `national_id_issued_at` (date), `national_id_issued_place`, `occupation` (ban đầu text tự do — đã đảo ngược sang mã tham chiếu `reference_catalog`, xem #061 bên dưới), `insurance_number` (text độc lập, **không** liên kết `insurance_card`/S2-04), `relative_full_name`, `relative_relationship`, `relative_phone`, `relative_address` (1 bộ người thân trên mỗi `patient`, không tách bảng). `address_json` có thêm khoá `neighborhood` (Khu phố); khoá `district` (Quận/Huyện) vẫn hợp lệ trong schema (dữ liệu cũ) nhưng không còn input trên UI (đã sáp nhập 2 cấp Tỉnh→Xã).
- **`ethnicity`/`nationality`/`occupation` (`docs/DECISIONS.md` #037/#061, đảo ngược #034 cho 3 field này)**: vẫn cột `String?` tự do ở tầng DB/Zod, nhưng nay lưu **mã (`code`)** tham chiếu bảng `reference_catalog` (ví dụ `"VNM"`, `"1"`), chọn qua dropdown ở web thay vì gõ tay. Không có FK thật (bảng `reference_catalog` không tenant_id, composite FK `(tenant_id, id)` không áp dụng được) và không validate khớp danh mục ở tầng Zod — tránh chặn sửa hồ sơ cũ có giá trị dạng tên tự do (ví dụ `"Việt Nam"`) lưu trước #037/#061. `occupation` (category `OCCUPATION`) không seed sẵn, khác `ethnicity`/`nationality` (có nguồn dữ liệu chính thức) — `clinic_admin` tự thêm qua UI.
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
`patient_id`, `doctor_id?` (nullable — xem "Hàng đợi ảo" dưới), `department_id` (**bắt buộc**, xem dưới), `appointment_id?` (nullable, composite FK), `encounter_no` (mã hiển thị, prefix `LK`, `UNIQUE(tenant_id, encounter_no)`), `status` (enum 6 giá trị — xem `.claude/docs/clinical-workflow.md`), `specialty`, `checked_in_at`, `started_at?`, `completed_at?`, `chief_complaint?`, `insurance_snapshot` (jsonb — đúng tên cột theo `docs/ERD.md`, không phải `insurance_snapshot_json`), `cancel_reason?`, `patient_source_code?`, `reception_type_code?`, `exam_form_code?`, `is_priority`, `priority_reason_code?`. **DEPRECATED (`docs/DECISIONS.md` #080)**: `exam_type_code?`/`exam_type_name?`/`exam_type_price?`/`price_type_code?`/`exam_type_unit?`/`service_quantity` — 6 cột này GIỮ NGUYÊN trong DB (dữ liệu cũ vẫn đọc được) nhưng Tiếp nhận mới NGỪNG ghi, thay bằng bảng con `encounter_service_item` (xem dưới, sau `vital_sign`).
Bảng trung tâm; sinh hiệu (đã có), chẩn đoán/ghi chú/đơn thuốc (chưa xây, giai đoạn Khám bệnh) đều trỏ về `encounter_id`.

**"Hàng đợi ảo" (`docs/DECISIONS.md` #064)** — `doctor_id` đổi thành **nullable**: `NULL` nghĩa là lượt khám đang chờ trong hàng chờ CHUNG của một Khoa, chưa được bác sĩ nào nhận qua "Nhận ca". `department_id` (composite FK → `department`) **bắt buộc** trên mọi encounter — resolve ở `ReceptionService.resolveRouting()` TRƯỚC khi mở transaction chính (đọc port `DoctorDirectoryPort.getDoctorDepartmentId()`/`getDefaultDepartmentId()`, tự mở transaction RIÊNG — không gọi lồng bên trong transaction check-in, tránh `$transaction` lồng nhau, cùng nguyên tắc đã áp dụng cho `AppointmentRepository`/`EncounterRepository` share ở trên): chọn "đích danh bác sĩ" thì server TỰ SUY `department_id` từ `user_account.department_id` của bác sĩ đó (fallback Khoa mặc định nếu bác sĩ chưa gán Khoa — KHÔNG throw), KHÔNG tin `departmentId` client có thể gửi kèm cho nhánh này; chọn "theo Khoa, chưa rõ bác sĩ" thì `doctor_id=NULL`, `department_id` lấy thẳng từ client. "Hàng đợi khám" là filter thuần trên cột này: "của tôi" = `doctor_id=actor`; "hàng chờ chung" = `department_id=Khoa actor AND doctor_id IS NULL` (query `EncounterRepository.listForDay()` với `poolDepartmentId`, chỉ áp khi client truyền `includeDepartmentPool=true` — không đổi hành vi "Danh sách tiếp nhận" mặc định). "Nhận ca" (mở rộng `POST /encounters/:id/start`, `EncounterRepository.claimFromPool()`) — ghi có điều kiện `WHERE doctor_id IS NULL AND version=?` (chống trùng fallback, không WebSocket): người thắng set `doctor_id=actor` + chuyển `IN_CONSULTATION` atomic; người thua `count=0` được service đọc lại bản ghi để phân biệt `EncounterAlreadyClaimedError` (409, đã bị người khác nhận) với `ConcurrentModificationError` (version lệch thường) — chỉ bác sĩ CÙNG Khoa với ticket mới claim được.

**Thiết kế lại "Tiếp nhận bệnh nhân" (`docs/DECISIONS.md` #052, mockup đã duyệt)** — 7 cột mới, tất cả nullable/có default an toàn (áp dụng dần cho encounter mới, không phá dữ liệu cũ): `reception_type_code`/`exam_form_code` (mã danh mục `RECEPTION_TYPE`/`EXAM_FORM`, **bắt buộc ở tầng Zod** cho encounter mới dù cột DB nullable — cùng cách xử lý các trường "bắt buộc ở ứng dụng, nullable ở DB" trước đó). `is_priority` (boolean, default `false`) + `priority_reason_code?` (mã danh mục `PRIORITY_REASON`, **bắt buộc khi `is_priority=true`** — ràng buộc ở `packages/shared` qua `.superRefine()`, không phải DB CHECK). `price_type_code?` (mã danh mục `PRICE_TYPE`, tuỳ chọn, CHỈ để ghi chú — v1 KHÔNG có bảng giá đa mức theo loại khám, việc đó là "Price Book" thật thuộc module Viện phí v2, ngoài phạm vi v1) + `exam_type_unit?`/`service_quantity` (SNAPSHOT Đơn vị/Số lượng tại thời điểm tạo, cùng tinh thần `exam_type_code/name/price` — `service_quantity` default `1`). Toàn bộ nhóm "Chỉ định dịch vụ khám" (`exam_type_*`/`price_type_code`/`service_quantity`) chỉ lưu để hiển thị trong bảng dịch vụ ở web, KHÔNG tính viện phí/xuất hoá đơn (ngoài phạm vi v1, CLAUDE.md).

**`cancel_reason`** — bổ sung ngoài đặc tả ERD gốc: "bỏ về" (`CHECKED_IN→CANCELLED`, bắt buộc lý do, `.claude/docs/clinical-workflow.md`) không soft-delete (giữ `deleted_at = NULL`, cùng cách `appointment.status='CANCELLED'` không soft-delete) nên cần cột riêng lưu lý do, cùng khuôn `appointment.cancel_reason`. ERD gốc (trước Sprint 3) chưa liệt kê cột này vì viết trước khi luồng "bỏ về" được thiết kế cụ thể — xem `docs/DECISIONS.md`.

**`patient_source_code`** — CẢ HAI luồng tạo `encounter` (check-in từ lịch hẹn lẫn "Tiếp nhận bệnh nhân") đều lưu được cột này (`docs/DECISIONS.md` #044 — trước đó chỉ luồng trực tiếp có, đã đồng bộ để dùng chung 1 biểu mẫu web). Lưu mã danh mục `reference_catalog` category `PATIENT_SOURCE` (cùng convention `patient.ethnicity`: lưu `code`, không lưu tên), tuỳ chọn. "Chỉ định dịch vụ khám" (snapshot Loại khám/Loại giá/Đơn vị/Đơn giá/Số lượng) đã chuyển sang bảng con `encounter_service_item` — xem mục riêng sau `vital_sign`.

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

### encounter_service_item (đã hiện thực — ngoài kế hoạch sau Sprint 4, `docs/DECISIONS.md` #080)
`encounter_id`, `exam_type_code`, `exam_type_name` (2 cột bắt buộc, snapshot Loại khám), `price_type_code?`, `unit_code?`, `exam_type_price?` (bigint, 3 cột NULLABLE — dịch vụ chưa cấu hình đơn giá hiệu lực ở `exam_type_price` vẫn thêm được), `quantity` (default 1).

**"Chỉ định dịch vụ khám" đổi từ 1 dịch vụ/lượt khám sang danh sách NHIỀU dịch vụ** — đảo ngược `docs/DECISIONS.md` #052 điểm 6 (khi đó cố ý làm phẳng "Loại giá dịch vụ", không cascade thật, vì bảng `exam_type_price` chưa tồn tại). Web (`ReceptionIntakeForm.tsx`) chọn Loại khám → lọc `reference_catalog.prices[]` (của `exam_type_price`, #079) còn hiệu lực HÔM NAY → "Loại giá dịch vụ" chỉ hiện đúng các mức đã cấu hình cho dịch vụ đó → chọn xong tự điền Đơn vị/Đơn giá từ đúng dòng giá. Mỗi lần bấm "+ Thêm" đẩy 1 dòng vào danh sách nháp cục bộ (không autosave từng dòng, khác `PrescriptionPanel.tsx`) — gửi nguyên mảng `services[]` (bắt buộc ít nhất 1 dòng) lúc "Lưu tiếp nhận"/"Xác nhận tiếp nhận", tạo N dòng trong CÙNG transaction check-in/tiếp nhận trực tiếp (`EncounterServiceItemRepository.createMany()`, module `reception` sở hữu — đúng khuôn `VitalSignRepository`, không có khái niệm ký/bất biến).

**Mọi field SNAPSHOT lúc thêm** (copy từ `reference_catalog`/`exam_type_price` lúc web gửi lên, KHÔNG JOIN lại lúc đọc — cùng tinh thần `insurance_snapshot`). `exam_type_price` chỉ lưu để hiển thị, v1 KHÔNG tính toán/xuất hoá đơn (CLAUDE.md). Không endpoint đọc lại riêng — chưa có màn hình nào hiển thị lại danh sách này sau khi tạo (để dành lúc code Thu ngân cơ bản, Sprint 5/6, sẽ cần SUM nhiều dòng thay vì đọc 1 giá trị đơn như thiết kế cũ).

### diagnosis (đã hiện thực — Sprint 3, S3-05→07; ký + đính chính Sprint 5, S5-02/03)
`encounter_id`, `icd10_code`, `type` (`PRIMARY`/`SECONDARY`), `note?`, `signed_at?`, `signed_by?`, `supersedes_id?`, `amendment_reason?`.
`icd10_code` FK thường (không composite) tới `icd10_catalog.code` — danh mục toàn hệ thống, không có `tenant_id`, read-only runtime.

**Đúng một `PRIMARY` mỗi encounter (C10, `docs/ERD.md` mục 4)** — ép bằng unique partial index `(tenant_id, encounter_id) WHERE type='PRIMARY' AND deleted_at IS NULL` (raw SQL trong migration, không khai `@unique` ở Prisma — cùng lý do `patient.nationalIdHash`), kèm validate ở Zod (`saveDiagnosesRequestSchema.refine()`) trước khi chạm DB. `PUT /encounters/:id/diagnoses` thay thế TOÀN BỘ danh sách mỗi lần lưu (xoá mềm dòng cũ + tạo lại) — đơn giản hơn diff từng dòng vì khối lượng nhỏ (vài dòng/encounter). Bắt buộc `encounter.status='IN_CONSULTATION'` mới ghi được — `409 ENCOUNTER_NOT_IN_CONSULTATION` nếu chưa tới, `409 CLINICAL_RECORD_ALREADY_SIGNED` nếu đã `COMPLETED` (đã ký).

**Ký + đính chính (Sprint 5, S5-02/03, migration `20260829090000_diagnosis_clinical_note_signing`)** — 4 cột mới, đúng khuôn `SignableEntity`/`prescription` (khác `clinical_note` là đã có sẵn cột này từ trước). "Hoàn tất khám" ký NGAY mọi dòng active (trigger C8 chặn UPDATE nội dung sau ký, exempt `deleted_at`/`deleted_reason`/`version`/`updated_at`/`updated_by`). Đính chính (`POST .../diagnoses/amend`, quyền `diagnosis.sign`) thay TOÀN BỘ danh sách + ký ngay — `supersedes_id` từng dòng mới ghép theo `(icd10_code, type)` không đổi so với danh sách cũ (`pairDiagnosisAmendment`, `packages/core`, thuần — vì `diagnosis` là danh sách không có "slot"/"header" cố định như `clinical_note`/`prescription`), mã thực sự mới thì `supersedes_id=null`.

### clinical_note (đã hiện thực — Sprint 3, S3-05→07; đổi section 2026-08-20, rút gọn 2026-08-21 #068)
`encounter_id`, `section` (6 giá trị — xem dưới), `content`, `signed_at?`, `signed_by?`, `supersedes_id?`, `amendment_reason?`.

**`section` KHÔNG còn là 4 mục SOAP (S/O/A/P)** — đổi theo yêu cầu chủ dự án 2026-08-20 sang nhóm "Thăm khám": `REASON_FOR_VISIT` (Lý do khám, bắt buộc)/`ILLNESS_PROGRESS` (Quá trình bệnh lý)/`PRELIMINARY_DIAGNOSIS` (Chẩn đoán sơ bộ — hiển thị web là "Chuẩn đoán", bắt buộc)/`GENERAL_EXAM` (Khám toàn thân)/`REGIONAL_EXAM` (Khám bộ phận), và `PLAN` (Kế hoạch điều trị & lời dặn — để sẵn cho tab riêng chưa xây, không đổi tên). Migration `20260820150000_clinical_note_sections_v2` (`DELETE FROM clinical_note` rồi đổi enum — chỉ có dữ liệu demo/dev, không có tenant production). **"Tiền sử dị ứng"/"bản thân"/"gia đình" KHÔNG có section riêng** — đọc/ghi thẳng `patient.allergy_note`/`personal_history`/`family_history` qua `PATCH /patients/:id` (một nguồn sự thật, không nhân đôi dữ liệu, không gắn theo lượt khám). `PERSONAL_HISTORY`/`FAMILY_HISTORY` (2 trong 8 giá trị ban đầu) đã chuyển sang `patient.*` ở migration `20260821150000_patient_history_fields` (`docs/DECISIONS.md` #068) — lý do: gắn theo `encounter_id` khiến bác sĩ phải nhập lại từ đầu mỗi lượt khám mới dù nội dung hầu như không đổi, khác bản chất dữ liệu (thuộc về bệnh nhân, không thuộc về một lần khám).

**Đúng một dòng hiệu lực mỗi `(encounter_id, section)`** — unique partial index `(tenant_id, encounter_id, section) WHERE deleted_at IS NULL`, cơ sở cho `PUT /encounters/:id/clinical-note` upsert tìm-hoặc-tạo (thiếu `version` trong payload = tạo mới, có `version` = update kèm optimistic lock). Lưu cả 6 mục trong MỘT request (khớp form bấm "Lưu nháp" một lần, không autosave — ENC-06 lưu nháp offline là P1/Sprint 6).

**`signed_at`/`signed_by`/`supersedes_id`/`amendment_reason` (Sprint 5, S5-02/03) — KHÔNG còn luôn NULL.** "Hoàn tất khám" ký NGAY mọi section active (trigger C8 áp dụng đúng khuôn `diagnosis` ở trên). Đính chính từng section (`POST .../clinical-note/amend`, quyền `clinical_note.sign`) — mỗi section là 1 "slot" cố định nên `supersedes_id` ghép 1-1 trực tiếp (khác `diagnosis` không cần thuật toán ghép cặp); chỉ section THỰC SỰ đổi nội dung mới tạo dòng mới, section không đổi giữ nguyên bản đã ký (không tạo lịch sử vô ích).

**"Hoàn tất khám" (`POST /encounters/:id/complete`, `IN_CONSULTATION→COMPLETED`) chỉ yêu cầu đúng 1 `diagnosis.type='PRIMARY'`** — KHÔNG phụ thuộc đơn thuốc tồn tại (module `prescription`, Sprint 4) dù PRD mô tả luồng "happy path" là Kê đơn rồi mới Hoàn tất; đây là quyết định đã hỏi và chốt với chủ dự án (`docs/DECISIONS.md` #059) — tái dùng permission `encounter.update` (không thêm permission mới cho transition, coi đây là một dạng chuyển trạng thái khác của "bắt đầu khám"). Từ Sprint 5 (S5-02/03), `complete()` còn ký NGAY `diagnosis`/`clinical_note` trong CÙNG transaction (1 lần gọi `SignaturePort.sign()`, dùng chung `signed_at`/`signed_by` cho cả hai bảng).

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
