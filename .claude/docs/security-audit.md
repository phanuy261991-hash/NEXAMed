# Security & Audit — NEXAMed

## Mô hình phân quyền: RBAC + Data Scope (thay thế mô hình vai trò cứng)

**Quyết định 2026-08-08** (xem `docs/DECISIONS.md` #013-#016): thay mô hình "5 vai trò cứng, quyền hardcode trong service" bằng RBAC kết hợp phạm vi dữ liệu (Data Scope) cấu hình qua bảng, cộng cơ chế break-glass. Chi tiết bảng/migration xem `data-model.md`. Phần này mô tả **quy tắc nghiệp vụ**.

### Bảng cốt lõi

- `role` — vai trò, theo tenant (mỗi tenant có bản sao riêng, cho phép `clinic_admin` tạo vai trò tuỳ biến sau này). Seed sẵn 5 vai trò mặc định (`is_system_default = true`) khi tenant được tạo: `receptionist`, `nurse`, `doctor`, `clinic_admin`, `system_admin`.
- `permission` — danh mục hành động, **toàn hệ thống** (giống `icd10_catalog`, không có `tenant_id`, seed sẵn, không do phòng khám tự định nghĩa). Định dạng `<module>.<action>`, ví dụ `clinical_note.sign`.
- `role_permission` — ma trận: `(tenant_id, role_id, permission_id) → data_scope`.
- `department` — khoa/phòng trong 1 tenant, phục vụ scope `department`. v1 phần lớn phòng khám không dùng (1-3 bác sĩ, không chia khoa), nhưng bảng luôn tồn tại.

### Data Scope (4 mức — **không có mức `branch`**, xem `docs/DECISIONS.md` #013)

| Scope | Ý nghĩa |
|---|---|
| `none` | Không được phép |
| `personal` | Chỉ bản ghi do mình tạo hoặc được gán phụ trách (`owner_id`/`assigned_to` — với `encounter` là `doctor_id`, với `vital_sign`/`clinical_note` kế thừa `encounter.doctor_id`) |
| `department` | Toàn bộ bản ghi của khoa/phòng mình trực thuộc (`user_account.department_id`) |
| `global` | Toàn bộ dữ liệu trong tenant |

Không có mức `branch` — v1 một phòng khám một địa điểm (`docs/product/prd.md`, PRD Q6 đã hoãn đa chi nhánh). Nếu sau này cần đa chi nhánh, thêm scope `branch` giữa `department` và `global`, không đổi 4 mức hiện có.

> **Cập nhật 2026-08-25 (`docs/DECISIONS.md` #075)**: hướng đa chi nhánh **đã chốt** — `tenant` = công ty, chi nhánh là `branch` bên trong (mô hình B), bệnh nhân + mã dùng chung toàn công ty. Mức `branch` vẫn **chưa hiện thực** (chỉ code khi có khách chuỗi thật), nhưng nay đã biết trước hình dạng: chèn giữa `department` và `global` đúng như dòng trên. Xem ràng buộc thiết kế bắt buộc ở `docs/Deploy.md` Phần 0.1.

### Ma trận mặc định seed cho 5 vai trò hệ thống

Seed cụ thể nằm trong `apps/api/prisma/seed/permissions.seed.ts` (nguồn sự thật) — bảng dưới đây tóm tắt để đọc nhanh, **không tự suy ra ma trận khác khi seed đã tồn tại**:

| Permission | receptionist | nurse | doctor | clinic_admin | system_admin |
|---|---|---|---|---|---|
| `patient.read` | global | global | global | global | none |
| `patient.create` | global | none | none | global | none |
| `patient.update` | global | none | global | global | none |
| `patient.merge` | none | none | none | global | none |
| `appointment.read/create/update/cancel` | global | none | personal | global | none |
| `encounter.read` | global | global | global | global | none |
| `encounter.create` | global | none | none | global | none |
| `encounter.update` | none | none | personal | none | none |
| `encounter.cancel` | global | none | personal | global | none |
| `vital_sign.create` | none | global | personal | none | none |
| `diagnosis.create/sign` | none | none | personal | none | none |
| `clinical_note.create/update/sign` | none | none | personal | none | none |
| `prescription.create/sign/print` | none | none | personal | none | none |
| `clinic_config.read/update` | none | none | none | global | none |
| `user_account.read/manage` | none | none | none | global | global |
| `role_permission.manage` | none | none | none | global | none |
| `audit_log.read` | none | none | none | global | global |
| `reference_catalog.read` | global | global | global | global | none |
| `reference_catalog.manage` | none | none | none | global | none |

Lý do `doctor.encounter.read = global` (không phải `personal`+break-glass như ví dụ minh hoạ chung của ngành): PRD yêu cầu P0 **ENC-01** — bác sĩ phải xem được toàn bộ tiền sử khám của bệnh nhân ngay khi vào màn hình khám, kể cả lượt khám trước do bác sĩ khác phụ trách (phòng khám 1-3 bác sĩ, thường thay nhau khám cùng bệnh nhân). Bắt break-glass cho thao tác này sẽ phá vỡ chính giá trị cốt lõi sản phẩm. Break-glass dành cho tình huống **thật sự ngoài phạm vi công việc thường ngày** — xem mục dưới.

**Sprint 3 (Tiếp nhận) — vá 2 lỗ hổng ma trận seed từ S1-04b, ghi lại vì đây là thay đổi trên ma trận đã "chốt" trước đó (`docs/DECISIONS.md`)**:
- Thêm 3 permission mới `encounter.create`/`encounter.update`/`encounter.cancel` — ma trận cũ chỉ có `encounter.read`, chưa từng tính actor nào thực sự TẠO hay CHUYỂN TRẠNG THÁI encounter (module này chưa tồn tại lúc S1-04b seed ma trận mặc định). `encounter.create` (check-in, module `reception`) chỉ receptionist/clinic_admin — không phải bác sĩ, khớp PRD REC-01 (lễ tân tiếp nhận). `encounter.update` ("bắt đầu khám") chỉ bác sĩ, `personal` (chỉ lượt khám của chính mình) — mirror `appointment.update`. `encounter.cancel` ("bỏ về") mirror `appointment.cancel`.
- Đổi `encounter.read`/`vital_sign.create` của **nurse** từ `personal`→`global`: theo định nghĩa `personal` ở trên (chủ = `doctor_id`), điều dưỡng không phải bác sĩ nên scope `personal` trên 2 permission này **chưa từng thật sự cho phép truy cập gì** kể từ khi seed lần đầu (luôn tương đương `none` trên thực tế) — không phải một hành vi cố ý đã kiểm chứng. Đổi sang `global` vì phòng khám 1-3 bác sĩ, một điều dưỡng phục vụ mọi bác sĩ trong ca trực — cùng lý do `doctor.encounter.read=global` đã chốt ở trên. Đồng thời thêm `receptionist.encounter.read=global` (trước là `none`) để lễ tân xem được hàng đợi Tiếp nhận (chính là danh sách encounter `CHECKED_IN`/`IN_CONSULTATION`) — không phải dữ liệu lâm sàng nhạy cảm (chẩn đoán/ghi chú SOAP vẫn chưa cấp quyền nào ở đây, thuộc module Khám bệnh chưa xây).
- **Tenant cũ (dev)**: 3 permission mới tự được `syncRolePermissionsForAllTenants()` (chạy mỗi lần API khởi động) thêm vào — không cần vá thủ công. Nhưng scope ĐÃ ĐỔI của nurse (2 dòng đã tồn tại) sẽ KHÔNG được sync tự động sửa (hàm này cố ý chỉ-thêm, không sửa/xoá dòng đã có, để không đè tuỳ biến ADM-07 tương lai) — đã vá thủ công 1 lần cho các tenant dev hiện có bằng `UPDATE role_permission`, ghi lại ở `docs/DECISIONS.md`.

**`doctor.patient.update = global` (2026-08-20, xem `docs/DECISIONS.md`)**: thêm mới — màn hình khám có mục "Tiền sử dị ứng" (nhóm "Tiền sử") đọc/ghi thẳng `patient.allergyNote`, không lưu riêng cho từng lượt khám. `global` (không phải `personal`) vì hệ thống chưa có quyền theo từng trường riêng — bác sĩ có `patient.update` sẽ sửa được TOÀN BỘ hồ sơ hành chính qua `PATCH /patients/:id` hiện có, không chỉ riêng trường dị ứng, cùng mức receptionist/clinic_admin. Tenant cũ tự vá qua `syncRolePermissionsForAllTenants()` (chỉ thêm dòng thiếu, không đổi dòng đã tồn tại — dòng này là MỚI thêm nên tự vá được, khác trường hợp nurse ở trên).

**"Hàng đợi ảo" — "Nhận ca" tái dùng `encounter.update` (`personal`, đã có), KHÔNG thêm permission mới (`docs/DECISIONS.md` #064)**: pull một ticket đang chờ trong hàng chờ chung Khoa (`encounter.doctor_id IS NULL`) coi là một dạng "Bắt đầu khám" khác — cùng permission, cùng scope `personal`. Guard vẫn kiểm bình thường qua `role_permission`; ràng buộc "chỉ bác sĩ CÙNG Khoa với ticket mới claim được" nằm ở tầng service (`EncounterService.startConsultation()`, so `department_id` của actor với của ticket), không phải một scope/permission riêng — cùng tinh thần "không hardcode theo vai trò, luôn tra `role_permission`" nhưng ràng buộc theo-Khoa là quy tắc nghiệp vụ cụ thể của tính năng này, không phải một mức data_scope tổng quát mới. `GET /departments/options` (chiếu tối thiểu `{id,name}` cho khu vực Điều phối lúc Tiếp nhận) dùng lại `reference_catalog.read` thay vì `user_account.read` — đúng lý do đã áp dụng cho `GET /appointments/doctors` (#030): lễ tân/bác sĩ/điều dưỡng có `reference_catalog.read` nhưng không có `user_account.read`.

**`reference_catalog.*` (`docs/DECISIONS.md` #037)**: danh mục dùng chung Dân tộc/Quốc tịch — toàn hệ thống, không `tenant_id`, không cách ly theo tenant (chấp nhận có ý thức ở v1 on-premise một tenant/instance, xem ghi chú trong `data-model.md`). `PermissionGuard` áp dụng bình thường (không lệch pattern) nhưng **không** gắn `entityIdParam` cho `PATCH`/`DELETE` — break-glass không có ý nghĩa với dữ liệu không có chủ sở hữu/không nhạy cảm lâm sàng, `none` bị chặn hẳn.

**Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — 3 permission mới `invoice.read`/`invoice.update`/`invoice.print`, cả 3 chỉ `global` cho `receptionist`/`clinic_admin`** (không có bác sĩ/điều dưỡng — đúng khung PRD mục 4.7 "Là lễ tân..."). **Không có `invoice.create` riêng** — phiếu thu luôn tạo tự động kèm `encounter.create` (check-in/tiếp nhận trực tiếp, cùng transaction), không có endpoint tạo riêng nên không cần permission riêng. Tenant cũ tự vá qua `syncRolePermissionsForAllTenants()` (chỉ thêm dòng thiếu, 3 dòng này đều MỚI nên tự vá được, không rơi vào trường hợp phải vá tay như nurse ở trên).

**Ký hồ sơ khám (Sprint 5, S5-02/03, `docs/DECISIONS.md` #089) — thêm permission mới `diagnosis.sign` (`personal`, chỉ `doctor`)**, đối xứng `clinical_note.sign` đã seed sẵn từ S1-04b nhưng chưa từng dùng tới cho lượt tính năng này. Dùng làm quyền gác cho `POST .../diagnoses/amend` (đính chính) — mirror cách `prescription.sign` tái dùng cho cả hành động ký lẫn đính chính, không tách permission riêng cho "amend". Bản thân việc KÝ (side-effect của "Hoàn tất khám") không kiểm riêng permission này — vẫn gác bởi `encounter.update` sẵn có. Tenant cũ tự vá qua `syncRolePermissionsForAllTenants()` (dòng mới, tự vá được).

### Break-glass (phá kính — vượt quyền tạm thời)

Áp dụng khi một request bị chặn bởi scope `personal`/`department` (ví dụ điều dưỡng cần xem ghi chú của một lượt khám không do mình phụ trách trong ca trực đột xuất).

- Bị chặn → API trả `403` kèm `breakGlassAvailable: true` thay vì `403` thường.
- Client gọi endpoint break-glass riêng: nhập **lại mật khẩu đăng nhập** (Argon2id verify — không thêm PIN riêng, xem `docs/DECISIONS.md` #014) + lý do bắt buộc (free text, tối thiểu ý nghĩa — ví dụ "cấp cứu").
- Tạo bản ghi `break_glass_session` (`actor_id`, `entity_type`, `entity_id`, `reason`, `expires_at` = `occurred_at + 2 giờ`, cấu hình được qua `tenant_setting`).
- Trong thời hạn, request tới đúng `(actor_id, entity_type, entity_id)` được cho qua, ghi thêm dòng `audit_log` action `break_glass.access` mỗi lần dùng phiên.
- Gọi `NotificationPort` báo `clinic_admin`/`system_admin` — **v1 adapter vẫn no-op** (chỉ ghi log), gửi thật (SMS/Zalo) là việc của giai đoạn sau khi `NotificationPort` có adapter thật (xem `docs/DECISIONS.md` #015). Không tự ý cài adapter thật ở v1.
- `break_glass_session` append-only như `audit_log` — không sửa/xoá.

Nguyên tắc chung: quyền kiểm ở tầng service/repository (guard đọc `role_permission` + lọc theo `data_scope`), không chỉ ẩn nút trên UI. `system_admin` **không** có `patient.read`/`encounter.read` nào ở mức nào — không có đường tắt xem dữ liệu lâm sàng thường trực, chỉ qua break-glass như mọi vai trò khác.

**Hiện thực (chốt ở S2-01, `apps/api/src/common/permission.guard.ts`)**: `PermissionGuard` + decorator `@RequirePermission(module, action, { entityIdParam? })`. Guard gộp `data_scope` từ mọi vai trò user đang giữ (`maxDataScope`, lấy scope rộng nhất — `packages/core/src/rbac/data-scope.ts`); `none`/không có dòng `role_permission` nào → nếu route có `entityIdParam` thì thử `BreakGlassService.tryConsume()`, không có phiên hợp lệ thì `403` với `error.details.breakGlassAvailable: true`; route list/create không có `entityIdParam` nên bị chặn `none` là chặn hẳn, không break-glass được (đúng tinh thần "break-glass áp dụng khi bị chặn bởi scope cho một bản ghi cụ thể"). Scope khác `none` (`personal`/`department`/`global`) được gắn vào `req.dataScope` cho service/repository tự quyết định có cần lọc thêm hay không — **giới hạn đã biết**: các bảng chưa có khái niệm "chủ sở hữu" rõ ràng trong tài liệu này (ví dụ `patient`) coi `personal`/`department` tương đương `global` (không lọc), vì ma trận mặc định seed sẵn (`packages/core/src/rbac/permissions.ts`) không dùng hai scope đó cho các permission như vậy — chỉ trở thành vấn đề thật nếu `clinic_admin` tự cấu hình vai trò tuỳ biến qua ADM-07 (P1, chưa hiện thực).

## Xác thực

- JWT access token 15 phút + refresh token httpOnly cookie, xoay vòng mỗi lần refresh.
- Mật khẩu hash Argon2id. Không dùng bcrypt/MD5/SHA cho mật khẩu.
- Khoá tài khoản tạm sau 5 lần đăng nhập sai trong 15 phút.
- Đổi vai trò hoặc chuyển tenant thu hồi toàn bộ phiên đang mở.
- JWT chứa `tenantId`; middleware set `app.current_tenant_id` cho phiên DB từ giá trị này (xem `multi-tenancy.md`).

## Dữ liệu định danh

- Mã hoá at-rest AES-256-GCM (khoá từ `ENCRYPTION_KEY`): `patient.national_id`, `insurance_card.card_no`, file đính kèm.
- Tra cứu theo giá trị mã hoá dùng cột hash riêng; không giải mã hàng loạt để so sánh.
- Không đưa PII/PHI vào: log ứng dụng, message lỗi trả client, URL/query string, tên file export, hệ thống giám sát bên thứ ba.
- Export dữ liệu ghi audit kèm phạm vi bản ghi và lý do export.

## Audit log

Ghi bắt buộc cho: đăng nhập/đăng xuất, **xem hồ sơ bệnh nhân**, tạo/sửa/soft-delete dữ liệu lâm sàng, ký ghi chú và đơn thuốc, chuyển trạng thái encounter, in đơn, gộp hồ sơ, đổi vai trò người dùng, sửa `role_permission`, dùng break-glass (`break_glass.request`, `break_glass.access`), export.

Bảng `audit_log` append-only: không endpoint nào sửa/xoá. Quyền DB của app user (`nexamed_app`) là `INSERT`+`SELECT`, cộng **duy nhất 1 ngoại lệ đã chốt** (S5-05, `docs/DECISIONS.md` #091): `GRANT DELETE` phục vụ job nền xoá "System Log" quá hạn (xem mục "Lưu trữ" dưới đây) — quyền này CHỈ được dùng qua đúng 1 chỗ code (`AuditLogRepository.purgeSystemLogsOlderThan()`, `WHERE` ép cứng theo entityType + cutoff), không controller/endpoint nào gọi tới. Ghi audit nằm cùng transaction với thao tác nghiệp vụ — ghi audit lỗi thì rollback thao tác.

**Cách hiện thực (chốt ở S1-05, xem `docs/DECISIONS.md`)** — hai đường tuỳ loại thao tác, vì một interceptor HTTP không thể tham gia vào transaction Prisma mà service tự mở/đóng bên trong chính nó:

- **Thao tác ghi** (login, break-glass, tạo/sửa/soft-delete dữ liệu lâm sàng...): gọi tường minh `writeAuditLog(tx, tenantId, {...})` (`apps/api/src/infrastructure/persistence/audit-log.helper.ts`) ngay bên trong transaction service đang mở qua `UnitOfWorkService` — cùng transaction, đúng yêu cầu "ghi audit lỗi thì rollback thao tác". Ví dụ: `apps/api/src/modules/iam/auth.service.ts`, `break-glass.service.ts`.
- **Thao tác xem** (`GET`, không có transaction nghiệp vụ nào để đồng bộ cùng — bản thân việc xem không ghi gì): áp `@AuditView('entityType')` (`apps/api/src/common/audit-view.decorator.ts`) lên handler + `@UseInterceptors(AuditViewInterceptor)` (`apps/api/src/common/audit-view.interceptor.ts`). Interceptor tự mở transaction riêng của nó sau khi handler trả về thành công, ghi `<entityType>.viewed`; request lỗi thì không ghi; ghi audit tự nó lỗi thì lỗi đó nổi lên thành response lỗi, không nuốt.

**Lưu trữ 2 tầng (chốt S5-05, `docs/DECISIONS.md` #091, `packages/core/src/audit/log-retention.ts`)**: "Log nghiệp vụ" (gắn hồ sơ bệnh án — `entityType` `patient`/`encounter`/`appointment`/`invoice`/`vital_sign`, và mọi `entityType` chưa biết trong tương lai — mặc định AN TOÀN) giữ **VĨNH VIỄN**, thời hạn cụ thể theo quy định bệnh án vẫn CHƯA chốt với pháp lý (PRD Q1) nên chưa có job xoá nào đụng tới nhóm này. "System Log" (`user_account`/`role`/`reference_catalog`/`allergen`/`allergen_group`/`department`/`department_type`/`room`/`floor`/`exam_station`/`drug`/`doctor_room_session`/`tenant` — thuần vận hành hệ thống, không phải hồ sơ bệnh án) chỉ giữ 90 ngày, xoá qua `SystemLogPurgeJob` (`@Cron`, `apps/api/src/modules/audit/`). Thêm `entityType` mới cho domain business KHÔNG cần sửa gì (mặc định rơi vào nhóm giữ vĩnh viễn); muốn xếp vào "System Log" phải chủ động thêm vào danh sách trong `log-retention.ts`.
`auth.refresh` (làm mới phiên thường) **không ghi audit_log** (quá thường xuyên, không phải một lượt truy cập mới có ý nghĩa) — `auth.refresh_reuse_detected` (sự cố bảo mật) vẫn ghi như cũ.

## Chữ ký số (chưa triển khai ở v1)

v1 dùng chữ ký logic: `signed_at` + `signed_by` + ghi audit. Cột `signature_payload` và `SignaturePort` đã để sẵn, adapter hiện tại là no-op. Không tự ý tích hợp CA, không tự chọn chuẩn ký (PKCS#7, XAdES) — chờ chốt với nghiệp vụ, vì lựa chọn này ảnh hưởng tới định dạng lưu và quy trình xuất bệnh án.

## Ràng buộc khi viết code

- Không thêm endpoint trả danh sách bệnh nhân không phân trang hoặc không lọc `tenant_id`.
- Không `console.log` đối tượng `patient`, `encounter`, `prescription`.
- Không tắt guard ở môi trường dev bằng biến môi trường; dùng tài khoản seed đúng vai trò.
- File upload: chỉ nhận `pdf, jpg, png, dcm`; kiểm magic byte thay vì tin `Content-Type`; lưu ngoài web root; phục vụ qua signed URL có hạn.
- Rate limit riêng cho endpoint tra cứu bệnh nhân — chống dò dữ liệu bằng cách quét mã.
- Không hardcode kiểm tra `role.name === 'doctor'` trong service/controller — luôn tra `role_permission` (permission + data_scope) qua guard dùng chung. Hardcode theo tên vai trò làm ma trận cấu hình được ở `role_permission` mất tác dụng.
