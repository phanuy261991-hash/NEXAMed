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

### Ma trận mặc định seed cho 5 vai trò hệ thống

Seed cụ thể nằm trong `apps/api/prisma/seed/permissions.seed.ts` (nguồn sự thật) — bảng dưới đây tóm tắt để đọc nhanh, **không tự suy ra ma trận khác khi seed đã tồn tại**:

| Permission | receptionist | nurse | doctor | clinic_admin | system_admin |
|---|---|---|---|---|---|
| `patient.read` | global | global | global | global | none |
| `patient.create` / `patient.update` | global | none | none | global | none |
| `patient.merge` | none | none | none | global | none |
| `appointment.read/create/update/cancel` | global | none | personal | global | none |
| `encounter.read` | none | personal | global | global | none |
| `vital_sign.create` | none | personal | personal | none | none |
| `diagnosis.create` | none | none | personal | none | none |
| `clinical_note.create/update/sign` | none | none | personal | none | none |
| `prescription.create/sign/print` | none | none | personal | none | none |
| `clinic_config.read/update` | none | none | none | global | none |
| `user_account.read/manage` | none | none | none | global | global |
| `role_permission.manage` | none | none | none | global | none |
| `audit_log.read` | none | none | none | global | global |

Lý do `doctor.encounter.read = global` (không phải `personal`+break-glass như ví dụ minh hoạ chung của ngành): PRD yêu cầu P0 **ENC-01** — bác sĩ phải xem được toàn bộ tiền sử khám của bệnh nhân ngay khi vào màn hình khám, kể cả lượt khám trước do bác sĩ khác phụ trách (phòng khám 1-3 bác sĩ, thường thay nhau khám cùng bệnh nhân). Bắt break-glass cho thao tác này sẽ phá vỡ chính giá trị cốt lõi sản phẩm. Break-glass dành cho tình huống **thật sự ngoài phạm vi công việc thường ngày** — xem mục dưới.

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

Bảng `audit_log` append-only: không endpoint sửa/xoá; quyền DB của app user chỉ `INSERT` và `SELECT`. Ghi audit nằm cùng transaction với thao tác nghiệp vụ — ghi audit lỗi thì rollback thao tác.

**Cách hiện thực (chốt ở S1-05, xem `docs/DECISIONS.md`)** — hai đường tuỳ loại thao tác, vì một interceptor HTTP không thể tham gia vào transaction Prisma mà service tự mở/đóng bên trong chính nó:

- **Thao tác ghi** (login, break-glass, tạo/sửa/soft-delete dữ liệu lâm sàng...): gọi tường minh `writeAuditLog(tx, tenantId, {...})` (`apps/api/src/infrastructure/persistence/audit-log.helper.ts`) ngay bên trong transaction service đang mở qua `UnitOfWorkService` — cùng transaction, đúng yêu cầu "ghi audit lỗi thì rollback thao tác". Ví dụ: `apps/api/src/modules/iam/auth.service.ts`, `break-glass.service.ts`.
- **Thao tác xem** (`GET`, không có transaction nghiệp vụ nào để đồng bộ cùng — bản thân việc xem không ghi gì): áp `@AuditView('entityType')` (`apps/api/src/common/audit-view.decorator.ts`) lên handler + `@UseInterceptors(AuditViewInterceptor)` (`apps/api/src/common/audit-view.interceptor.ts`). Interceptor tự mở transaction riêng của nó sau khi handler trả về thành công, ghi `<entityType>.viewed`; request lỗi thì không ghi; ghi audit tự nó lỗi thì lỗi đó nổi lên thành response lỗi, không nuốt.

Lưu trữ tối thiểu theo thời hạn quy định với bệnh án; thời hạn cụ thể chưa chốt với nghiệp vụ, không tự đặt job xoá audit.

## Chữ ký số (chưa triển khai ở v1)

v1 dùng chữ ký logic: `signed_at` + `signed_by` + ghi audit. Cột `signature_payload` và `SignaturePort` đã để sẵn, adapter hiện tại là no-op. Không tự ý tích hợp CA, không tự chọn chuẩn ký (PKCS#7, XAdES) — chờ chốt với nghiệp vụ, vì lựa chọn này ảnh hưởng tới định dạng lưu và quy trình xuất bệnh án.

## Ràng buộc khi viết code

- Không thêm endpoint trả danh sách bệnh nhân không phân trang hoặc không lọc `tenant_id`.
- Không `console.log` đối tượng `patient`, `encounter`, `prescription`.
- Không tắt guard ở môi trường dev bằng biến môi trường; dùng tài khoản seed đúng vai trò.
- File upload: chỉ nhận `pdf, jpg, png, dcm`; kiểm magic byte thay vì tin `Content-Type`; lưu ngoài web root; phục vụ qua signed URL có hạn.
- Rate limit riêng cho endpoint tra cứu bệnh nhân — chống dò dữ liệu bằng cách quét mã.
- Không hardcode kiểm tra `role.name === 'doctor'` trong service/controller — luôn tra `role_permission` (permission + data_scope) qua guard dùng chung. Hardcode theo tên vai trò làm ma trận cấu hình được ở `role_permission` mất tác dụng.
