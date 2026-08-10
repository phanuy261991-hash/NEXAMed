# Task — NEXAMed

Danh sách công việc theo phase. Nguồn ưu tiên/mốc thời gian là `docs/product/plan.md` — file này chỉ theo dõi trạng thái từng việc cụ thể.

Quy ước trạng thái: `[ ]` chưa làm, `[~]` đang làm, `[x]` xong.

## Phase 0 — Thiết lập tài liệu

- [x] `CLAUDE.md`
- [x] `.claude/docs/*` (7 file)
- [x] `docs/product/prd.md`
- [x] `docs/product/plan.md`
- [x] `docs/ERD.md`
- [~] `docs/design/design-system.md` (chủ đích để trống, chờ bổ sung)

## Sprint 1 — Nền tảng (tuần 1-2, theo `docs/product/plan.md` mục 4)

- [x] S1-01 — Khởi tạo monorepo pnpm, cấu trúc thư mục theo `project-structure.md`, ESLint boundary rules, CI
- [x] S1-02 — Prisma schema nền: 8 cột bắt buộc, base model, quy ước migration, `code_sequence` (migration **đã áp thật lên Postgres 18.4** qua `prisma migrate deploy`, xác minh `uuidv7()` sinh đúng UUID v7)
- [x] S1-03 — Tenant context: middleware `app.current_tenant_id`, RLS policy, unit of work. RLS/CHECK/thu hồi DELETE **đã bật thật** trên Postgres, xác minh bằng integration test 4/4 pass. Middleware ban đầu đọc header tạm (chưa qua JWT — xem `docs/DECISIONS.md` #012) — đã thay bằng JWT thật ở S1-04
- [x] S1-04 — Auth: JWT (access 15 phút + refresh httpOnly cookie xoay vòng), Argon2id, khoá tài khoản tạm sau 5 lần sai/15 phút. Bảng mới `user_session` (rotation + reuse detection — xem `docs/DECISIONS.md` #019), `user_account` thêm 3 cột lockout. `TenantContextMiddleware` đổi sang đọc JWT access token thật (không còn header tạm). Module `iam` (`auth.controller/service`, `token.service`, `session.repository`) — **đã xác minh thật** (`auth.spec.ts`, 9/9 pass): login đúng/sai, khoá tài khoản, tài khoản vô hiệu hoá, sai tenantId, refresh rotation, phát hiện reuse thu hồi toàn bộ phiên, logout, token hỏng. `JwtAuthGuard` (xác thực tối thiểu, chưa áp controller nào) + `lockout.spec.ts` (9/9 pass, unit thuần). Response envelope `{data,meta}`/`{error}` + `DomainExceptionFilter` (theo `architecture.md`, chưa từng có controller nào cần tới trước S1-04)
- [x] S1-04b — RBAC schema: `role`/`permission`/`role_permission`/`department`, seed danh mục permission (23) + 5 vai trò mặc định + ma trận, guard đọc `role_permission` — **đã xác minh thật** (`rbac.spec.ts`, 4/4 pass). Guard NestJS thật áp vào controller là việc của S2 (chưa có controller)
- [x] S1-04c — Break-glass: `POST /api/v1/break-glass` (yêu cầu `JwtAuthGuard` — nơi dùng thật đầu tiên), xác thực lại mật khẩu + lý do bắt buộc, tạo `break_glass_session` (bảng đã có sẵn từ S1-04b, không cần migration mới), thời hạn đọc `tenant_setting` (`break_glass_duration_minutes`, mặc định 120 phút), ghi `audit_log` (`break_glass.request`), gọi `NotificationPort` (no-op — kéo trước 1 port của S1-06, xem `packages/core/src/ports/notification.port.ts`). Primitive `BreakGlassService.tryConsume()` (kiểm tra phiên còn hiệu lực + ghi `audit_log` `break_glass.access`) viết + test sẵn cho guard `data_scope` thật của S2 gọi — **đã xác minh thật** (`break-glass.spec.ts`, 6/6 pass; `break-glass.spec.ts` ở `packages/core`, 3/3 pass, unit thuần).
- [x] S1-05 — Audit log: bảng append-only + quyền DB đã xong từ S1-03. Hai cơ chế ghi (xem `docs/DECISIONS.md` #021): thao tác **ghi** → gọi tường minh `writeAuditLog(tx, ...)` trong transaction của service (dời từ `modules/iam/` sang `infrastructure/persistence/audit-log.helper.ts` — hạ tầng dùng chung, không phải riêng domain `iam`); thao tác **xem** → `AuditViewInterceptor` + decorator `@AuditView('entityType')` (`apps/api/src/common/`), tự mở transaction riêng sau khi handler thành công, không ghi khi handler lỗi. **Đã xác minh thật** (`audit-view.interceptor.spec.ts`, 3/3 pass) — chưa áp vào controller nào (chưa có controller nghiệp vụ, S2)
- [x] S1-06 — `packages/core`: khung entity (`BaseEntity`/`AppendOnlyEntity`/`SignableEntity` + `isSigned`), lớp lỗi + mã lỗi (đã có từ S1-04), `ports/` đủ 6 interface (5 port còn lại: Storage/EventBus/Signature/Insurance/PatientIdentity, cộng `NotificationPort` đã có từ S1-04c), adapter no-op/thật + đăng ký DI qua `PortsModule` (global) — **đã xác minh thật**: unit test `base-entity.spec.ts` (2/2), integration test `local-disk.adapter.spec.ts` (4/4), `in-memory.adapter.spec.ts` (3/3); build thật (`node dist/main.js`) log `PortsModule dependencies initialized` + `Nest application successfully started`, xác nhận DI wire đúng qua NestJS container thật (không chỉ new service tay như các test trước)
- [ ] S1-07 — Test harness cách ly tenant: testcontainers Postgres, helper tạo 2 tenant, template test
- [ ] S1-08 — Web: app shell, router, provider, luồng đăng nhập, layout, design token
- [ ] S1-09 — Web: api client sinh từ OpenAPI, TanStack Query setup với cache key có `tenantId`

**Gate cuối sprint 1** (từ `plan.md`):
- [x] CI fail khi `packages/core` import NestJS/Prisma/React (đã kiểm chứng thủ công với ESLint; CI thật chỉ chạy khi có remote GitHub)
- [x] CI fail khi migration tạo bảng thiếu một trong 8 cột bắt buộc (`scripts/check-mandatory-columns.mjs`, đã kiểm chứng chặn được lỗi thật lúc viết script)
- [~] Test cách ly tenant chạy được: đăng nhập tenant A gọi ID của tenant B trả 404 — RLS đã xác minh thật ở tầng repository (`tenant-isolation.spec.ts`) và đăng nhập sai tenant đã xác minh (`auth.spec.ts`, coi như sai thông tin đăng nhập); vẫn chưa có test HTTP e2e thật xuyên qua một controller nghiệp vụ trả 404 (cần S2 có controller đầu tiên + S1-07 test harness)
- [x] Mọi thao tác ghi mẫu đều sinh dòng `audit_log`; rollback audit thì rollback cả thao tác — đúng cho các sự kiện auth/break-glass đã có (ghi trong cùng transaction); cơ chế dùng chung (`writeAuditLog` + `AuditViewInterceptor`) đã sẵn sàng cho mọi module ghi/xem từ S2 trở đi (S1-05)
- [~] Guard chặn đúng theo `data_scope` — RLS + ma trận đã xác minh thật ở tầng repository (`rbac.spec.ts`); `JwtAuthGuard` (xác thực) đã có nơi dùng thật đầu tiên (`POST /break-glass`); break-glass hoàn chỉnh (S1-04c, `BreakGlassService.tryConsume()` sẵn sàng cho guard gọi); guard đọc `role_permission` theo `data_scope` và tự trả `breakGlassAvailable:true` khi bị chặn vẫn là việc của S2 (cần controller nghiệp vụ đầu tiên)

## Sprint 2+

Chưa bắt đầu — xem `docs/product/plan.md` mục 5 trở đi.