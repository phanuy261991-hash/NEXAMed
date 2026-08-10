# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

## 2026-08-10 (4)

S1-05 — Audit log (interceptor + helper dùng chung):

- Không có gì mới ở bảng `audit_log`/quyền DB — đã xong từ S1-03 (append-only, `nexamed_app` chỉ `INSERT`/`SELECT`).
- Làm rõ và ghi lại một điểm kiến trúc quan trọng (`docs/DECISIONS.md` #021): một NestJS interceptor chạy ở tầng HTTP không thể tham gia vào transaction Prisma mà service tự mở/đóng kín bên trong chính nó (`UnitOfWorkService.runInTenantScope` là callback trọn vẹn) — nên "interceptor ghi audit cho mọi thao tác" theo cách đọc chữ nghĩa ban đầu của `docs/product/plan.md` S1-05 là không khả thi an toàn cho thao tác **ghi**. Chốt hai cơ chế: ghi → lời gọi tường minh trong transaction (đã dùng đúng ở S1-04/S1-04c); xem → interceptor thật (không có transaction nghiệp vụ nào để đồng bộ cùng nên an toàn).
- Dời `writeAuditLog` từ `apps/api/src/modules/iam/audit-log.helper.ts` sang `apps/api/src/infrastructure/persistence/audit-log.helper.ts` — đây là hạ tầng cross-cutting mọi module domain tương lai (patient/appointment/encounter/prescription, S2+) đều cần gọi, để trong `modules/iam/` buộc module khác import xuyên qua domain `iam`, sát ranh giới cấm trong `coding-standards.md`. Cập nhật import ở `auth.service.ts`, `break-glass.service.ts` — hành vi giữ nguyên, test cũ (`auth.spec.ts`, `break-glass.spec.ts`) pass y nguyên sau khi dời.
- `apps/api/src/common/`: `audit-view.decorator.ts` (`@AuditView(entityType, {paramName?})`), `audit-view.interceptor.ts` (`AuditViewInterceptor` — đọc `tenantId`/`actorId` từ `tenantContextStorage` đã có sẵn từ JWT, `entityId` từ route param; dùng `mergeMap` không phải `tap` để đợi ghi audit xong mới trả response và để lỗi ghi audit nổi lên; handler lỗi thì không audit; không có metadata `@AuditView` thì passthrough). Đăng ký vào `CommonModule` — **chưa áp vào controller nào** (chưa có controller nghiệp vụ, S2).
- Cập nhật `.claude/docs/security-audit.md` mục Audit log: ghi rõ quy ước hai cơ chế trên cho S2 trở đi theo, tránh mỗi module tự nghĩ cách khác nhau.
- Integration test thật trên Postgres (`audit-view.interceptor.spec.ts`, 3/3 pass, không mock): handler thành công + có `@AuditView` → ghi đúng 1 dòng `<entityType>.viewed`; handler ném lỗi → không ghi audit; không có `@AuditView` → passthrough không ghi audit.
- Toàn bộ 31 test trên `apps/api` (bao gồm 3 test mới) pass; typecheck/lint/build sạch toàn workspace.

## 2026-08-10 (3)

S1-04c — Break-glass (vượt quyền tạm thời):

- Không cần migration mới: `break_glass_session` đã đủ cột/RLS/revoke `UPDATE` từ migration `*_rbac_data_scope` (S1-04b).
- `packages/core/src/iam/break-glass.ts`: hằng số `DEFAULT_BREAK_GLASS_DURATION_MINUTES=120`, hàm thuần `computeExpiresAt`/`isSessionActive`, unit test 3/3. `packages/core/src/ports/notification.port.ts`: `NotificationPort` + DI token `NOTIFICATION_PORT` — chỉ 1/6 port của S1-06 được kéo lên trước (giống cách S1-04 đã kéo trước một phần `errors/`), 5 port còn lại vẫn để dành S1-06.
- `apps/api/src/infrastructure/notification/noop.adapter.ts`: adapter no-op (chỉ log `tenantId`/`type`, không log nội dung).
- `apps/api/src/modules/iam/`: `break-glass.repository.ts` (đọc/ghi `break_glass_session` + đọc `tenant_setting` key `break_glass_duration_minutes` với fallback mặc định), `break-glass.service.ts` (`request()`: xác thực lại mật khẩu — tái dùng `UserAccountAuthRepository.findById` + `InvalidCredentialsError` đã có từ S1-04, không tạo lỗi mới; `tryConsume()`: primitive kiểm tra phiên còn hiệu lực + ghi `audit_log` `break_glass.access`, tự mở transaction riêng vì một guard tương lai không có sẵn transaction của service nghiệp vụ), `break-glass.controller.ts` (`POST /break-glass`, `@UseGuards(JwtAuthGuard, ThrottlerGuard)` — lần đầu `JwtAuthGuard` viết ở S1-04 được dùng thật).
- `packages/shared/src/break-glass.ts`: Zod `breakGlassRequestSchema`/`breakGlassResponseSchema`.
- Integration test thật trên Postgres (`break-glass.spec.ts`, 6/6 pass, không mock — cùng pattern `auth.spec.ts`): đúng mật khẩu tạo phiên đúng hạn (mặc định 120 phút và theo `tenant_setting` tuỳ chỉnh), sai mật khẩu không tạo phiên/không gọi `NotificationPort`, `tryConsume` đúng entity trong hạn → `granted:true` + có dòng audit, entity khác/hết hạn → `granted:false`.
- Kiểm thử thủ công qua curl trên server thật: không có access token → 401; sai mật khẩu → 401 kèm rate-limit header; đúng mật khẩu → 200 kèm `expiresAt` đúng +120 phút.
- Cập nhật `docs/TASK.md`, `docs/CURRENT.md`. Không đổi `.claude/docs/data-model.md`/`docs/ERD.md` (không đổi schema).

## 2026-08-10 (2)

S1-04 — Auth (JWT + refresh rotation, Argon2id, khoá tài khoản):

- Migration `20260810150400_auth_sessions`: bảng mới `user_session` (refresh token đã hash, rotation chain qua `replaced_by_session_id`, RLS + `CHECK(version>=1)` + index `(tenant_id,user_id,expires_at DESC) WHERE deleted_at IS NULL`); `user_account` thêm `failed_login_count`/`last_failed_login_at`/`locked_until`. Xem `docs/DECISIONS.md` #019-#020 (2 quyết định đã hỏi và chốt với chủ dự án trước khi code: bảng session thay vì bộ đếm `token_version`, client gửi `tenantId` tường minh lúc đăng nhập).
- `packages/core/src/iam/`: `lockout.ts` (ngưỡng khoá 5 lần sai/15 phút, hàm thuần `isAccountLocked`/`recordFailedLogin`/`resetLoginAttempts`, unit test 9/9 — mọi cạnh của ngưỡng/cửa sổ) + `constants.ts` (TTL token). `packages/core/src/errors/`: `DomainError` (lớp gốc) + 5 lỗi auth cụ thể — khởi đầu tối thiểu của lớp lỗi nghiệp vụ mà `coding-standards.md` yêu cầu (S1-06 mở rộng thêm sau, không làm lại).
- `packages/shared/src/auth.ts`: Zod schema `loginRequestSchema`/`loginResponseSchema`/`jwtPayloadSchema` dùng chung controller và web (S1-09).
- `apps/api/src/modules/iam/`: `AuthController` (`POST /auth/login|refresh|logout`), `AuthService` (điều phối, mở transaction qua `UnitOfWorkService`), `TokenService` (ký/verify JWT, một `JWT_SECRET` dùng chung phân biệt bằng claim `typ`), `SessionRepository`, `UserAccountAuthRepository`, `audit-log.helper.ts` (ghi trực tiếp các sự kiện auth mà `security-audit.md` liệt kê tên rõ — chưa phải interceptor tổng quát, đó là S1-05).
- **Phát hiện quan trọng lúc viết test**: `prisma.$transaction(async (tx) => ...)` rollback toàn bộ nếu callback throw — kể cả khi throw đó là một kết quả nghiệp vụ bình thường (sai mật khẩu, phát hiện refresh token bị dùng lại) mà cần **commit** (đếm số lần sai, thu hồi phiên). Sửa bằng cách để callback trả về một outcome thay vì throw, transaction luôn commit, rồi throw `DomainError` tương ứng sau khi transaction đã xong — áp dụng cho cả `login()` và `refresh()`.
- `apps/api/src/common/`: `tenant-context.middleware.ts` đổi hẳn sang đọc JWT access token thật qua `Authorization: Bearer` (không còn header tạm `x-tenant-id`/`x-actor-id` — hoàn thành cam kết ở `docs/DECISIONS.md` #012, vì đây là controller thật đầu tiên nhận traffic). Thêm `jwt-auth.guard.ts` (xác thực tối thiểu, viết + test sẵn, chưa áp vào controller nào), `response.interceptor.ts` + `domain-exception.filter.ts` (response envelope `{data,meta}`/`{error}` theo `architecture.md` — lần đầu cần dùng tới).
- `main.ts`: `cookie-parser`, CORS (`WEB_ORIGIN`, `credentials:true` cho cookie refresh token), wire global interceptor/filter, đọc `PORT` qua `ConfigService` thay vì hard-code.
- Rate limit riêng cho `/auth/login` (`@nestjs/throttler`, 10 request/phút/IP) — không áp toàn cục.
- Integration test thật trên Postgres (`auth.spec.ts`, 9/9 pass, không mock — cùng pattern `rbac.spec.ts`/`tenant-isolation.spec.ts`): login đúng/sai mật khẩu, khoá tài khoản đúng ngưỡng, tài khoản vô hiệu hoá, sai `tenantId` bị coi như sai thông tin đăng nhập, refresh rotation, phát hiện reuse thu hồi toàn bộ phiên, logout, token hỏng. `jwt-auth.guard.spec.ts` (5/5 pass).
- Cập nhật `.claude/docs/data-model.md`, `docs/ERD.md` (v1.2) trong cùng lúc theo `coding-standards.md`.

## 2026-08-10

- Thêm `docs/product/future-modules-reference.md`: gom ý tưởng kiến trúc từ 3 tài liệu đặc tả HIS/EMR tổng quát do chủ dự án cung cấp (Dược/kho FEFO + BOM tiêu hao tự động, Viện phí/bảng giá đa đối tượng, danh mục dùng chung — địa giới hành chính/BHYT/ICD-10/đường dùng thuốc..., luồng khám mở rộng). Tài liệu **chưa chốt**, chỉ tham khảo cho v2/v2.1/v3 — đã ghi rõ 6 điểm mâu thuẫn với schema/state machine/quy ước đặt tên đã chốt ở v1 (state `encounter` khác, PascalCase vs snake_case, thiếu `tenant_id`/RLS, thiếu 8 cột bắt buộc, đề xuất module ngoài phạm vi v1, tiền dùng `Decimal` thay vì `bigint`) để không bị dùng nhầm làm nguồn đã chốt.

## 2026-08-08 (5)

- Thêm `docs/demo.md`: hướng dẫn chạy `pnpm dev` để xem giao diện lúc phát triển, ghi rõ trạng thái thật hiện nay (`apps/web` mới có bootstrap tối thiểu, chưa tới S1-08 nên chưa có màn hình nghiệp vụ để demo) và sự cố thường gặp.
- Thêm `docs/Deploy.md`: hướng dẫn triển khai on-premise (mục tiêu chính thức v1, dựa theo kiến trúc đã chốt ở `.claude/docs/project-structure.md`, ghi rõ S4-05 chưa bắt đầu nên đây là kế hoạch chứ chưa chạy được ngay) và cloud (v3+, chưa có quyết định — chỉ liệt kê phần kiến trúc port/adapter đã chuẩn bị sẵn).

## 2026-08-08 (4)

- `CLAUDE.md`: thêm `.claude/docs/ui-guidelines.md` vào danh sách tài liệu bắt buộc đọc trước khi bắt đầu bất kỳ công việc nào (trước đây chỉ bắt buộc đọc khi làm UI/UX) — đảm bảo agent nắm token/quy tắc thiết kế xuyên suốt, không chỉ khi chạm trực tiếp vào `apps/web`.

## 2026-08-08 (3)

- `CLAUDE.md`: thêm Tailwind CSS vào Tech Stack (`docs/DECISIONS.md` #017); thêm quy định bắt buộc đọc `.claude/docs/ui-guidelines.md` + `docs/design/*.md` trước khi thiết kế UI/UX, hỏi trước khi điều chỉnh, cập nhật tài liệu khi đổi quyết định thiết kế; thêm tham chiếu `docs/Hybrid Authorization.md` (định hướng platform/đa module v3+, chưa triển khai, chỉ tham khảo).
- Phát hiện và xử lý mâu thuẫn giữa `ui-guidelines.md` và `docs/design/AI_AVOID_RULES.md` (số lượng màu, độ đậm shadow) — chốt `ui-guidelines.md` thắng, ghi chú ngay trong `AI_AVOID_RULES.md` (`docs/DECISIONS.md` #018).

## 2026-08-08 (2)

S1-04b — Thay mô hình vai trò cứng bằng RBAC + Data Scope (theo yêu cầu chủ dự án, tài liệu `PhanQuyen.md`):

- Cập nhật tài liệu chốt trước khi code: `.claude/docs/security-audit.md` (mô hình mới, ma trận mặc định, break-glass), `.claude/docs/data-model.md`, `docs/ERD.md` (v1.1), `docs/product/prd.md` (v1.1 — ADM-06, ADM-07, R10), `docs/product/plan.md` (v1.1 — S1-04b/S1-04c, sprint 1 tăng 34→40 dev-day), `docs/DECISIONS.md` #013-#016.
- Schema: bỏ enum `UserRoleName` cứng, thêm `department`, `role` (theo tenant), `permission` (danh mục toàn hệ thống, 23 permission), `role_permission` (ma trận `role × permission → data_scope`), `break_glass_session`. Enum `data_scope`: `none`/`personal`/`department`/`global` — **không có `branch`** (đa chi nhánh hoãn, khớp PRD Q6).
- Migration `20260808015619_rbac_data_scope`: đổi `user_role` từ cột `role` enum sang `role_id` FK; RLS + `CHECK(version>=1)` cho bảng mới; `permission` read-only cho role app (`REVOKE INSERT, UPDATE`); `break_glass_session` không cho `UPDATE` (append-only).
- Gặp sự cố khi áp migration: bảng `_prisma_migrations` bị mất dấu vết dù dữ liệu bảng cũ vẫn còn — baseline lại 2 migration cũ bằng `prisma migrate resolve --applied` trước khi áp migration mới.
- Logic nghiệp vụ thuần (danh mục permission + ma trận mặc định) đặt ở `packages/core/src/rbac/permissions.ts` — nguồn sự thật duy nhất, dùng chung cho seed script, guard sau này, và có thể dùng lại ở web. `packages/shared/src/data-scope.ts`: enum Data Scope dùng chung web/api.
- `apps/api/src/infrastructure/persistence/seed-permissions.ts`, `seed-tenant-roles.ts`: seed danh mục + seed 5 vai trò/ma trận cho một tenant (`prisma/seed/index.ts` là entrypoint mỏng gọi vào, chạy bằng role đặc quyền vì `permission` đã revoke ghi từ role app).
- Integration test thật (`rbac.spec.ts`, 4/4 pass, không mock): seed đúng 5 vai trò/tenant; RLS cách ly `role`/`role_permission` theo tenant; `permission` đọc được nhưng không ghi được qua role app; `doctor.encounter.read = global` đúng thiết kế (không bắt break-glass cho tiền sử — khớp PRD ENC-01 P0, khác ví dụ minh hoạ chung của ngành).
- CI: thêm bước seed sau `migrate deploy` (không tự seed như `migrate dev`).

## 2026-08-08

S1-03 — Tenant context (RLS, unit of work):

- Migration `20260807170922_tenant_context`: role Postgres mới `nexamed_app` (không superuser/BYPASSRLS/CREATEDB/CREATEROLE), chỉ `SELECT`/`INSERT`/`UPDATE` (không `DELETE`; `audit_log` không cả `UPDATE`); `CHECK (version >= 1)` trên 6 bảng; Row Level Security thật (policy `USING`+`WITH CHECK`) trên 6 bảng có `tenant_id` (không áp cho `tenant`, xem `docs/DECISIONS.md` #011).
- **Phát hiện quan trọng**: role cũ `nexamed` là superuser nên **luôn bypass RLS** dù policy đúng — API runtime phải chuyển sang role mới `nexamed_app`. Tách `DATABASE_URL` (app, runtime) khỏi `MIGRATE_DATABASE_URL` (đặc quyền, chỉ migration) — xem `docs/DECISIONS.md` #010. Thêm `apps/api/scripts/with-migrate-url.mjs` chạy migrate bằng đúng role.
- `apps/api/src/infrastructure/persistence/`: `prisma.service.ts`, `unit-of-work.service.ts` (mở transaction + `SET LOCAL app.current_tenant_id`, validate UUID chống injection), `tenant-context.store.ts` (AsyncLocalStorage), `persistence.module.ts` — wire vào `AppModule`.
- `apps/api/src/common/tenant-context.middleware.ts`: tạm đọc `x-tenant-id`/`x-actor-id` từ header, chờ JWT thật ở S1-04 (xem `docs/DECISIONS.md` #012) — **không dùng khi có controller thật nhận traffic ngoài**.
- Integration test thật trên Postgres (`tenant-isolation.spec.ts`, 4/4 pass, không mock): cách ly tenant đúng; quên set tenant context → lỗi (fail closed, không rò dữ liệu); không xoá được; không insert xuyên tenant được (RLS `WITH CHECK`).
- `apps/api/vitest.config.ts` + `vitest.setup.ts`: tự nạp `.env` cho test, khớp luồng `pnpm test` đã ghi trong `CLAUDE.md`.
- CI: tách `DATABASE_URL`/`MIGRATE_DATABASE_URL`, thêm bước `Prisma generate` sau `migrate deploy` (trước đây thiếu — `migrate deploy` không tự generate client như `migrate dev`, có thể làm build/typecheck CI fail nếu chạy trên máy sạch).

## 2026-08-07 (5)

Xác minh migration trên Postgres thật (sau khi cài Docker lên máy dev):

- Phát hiện và sửa lỗi: image `postgres:18` đổi quy ước thư mục data (mount `/var/lib/postgresql`, không phải `.../data` như PG16) — `docker-compose.yml` mount sai sẽ khiến container restart-loop.
- Phát hiện máy dev có sẵn Postgres native (Windows service, không thuộc dự án) chiếm cổng 5432 — đổi cổng container Docker sang **5433** trong `docker-compose.yml`, `.env.example`, `.env`.
- Chạy `prisma migrate deploy` thật lên Postgres 18.4 — thành công. Insert thử xác nhận `id` sinh đúng UUID v7 (time-ordered).
- `docs/TASK.md`/`docs/CURRENT.md`: bỏ ghi chú "chưa xác minh trên DB thật".

## 2026-08-07 (4)

Chốt các điểm treo từ S1-02:

- Nâng PostgreSQL 16 → **18** trong `CLAUDE.md`, `docker-compose.yml`, `.github/workflows/ci.yml` để dùng `uuidv7()` built-in thay vì `gen_random_uuid()`. Sinh lại migration (`prisma/migrations/20260807090207_init`).
- Xác nhận cột `audit_log` (không có `created_at`/`created_by`/`updated_by`) và sửa câu tóm tắt mâu thuẫn trong `.claude/docs/data-model.md` cho khớp.
- `docs/DECISIONS.md`: thêm #009 (thay thế #006), xác nhận #007, ghi rõ #008 phải hoàn thiện đầy đủ khi tới S1-03.

## 2026-08-07 (3)

S1-02 — Prisma schema nền:

- `apps/api/prisma/schema.prisma`: 7 bảng nền tảng (`tenant`, `tenant_setting`, `room`, `user_account`, `user_role`, `code_sequence`, `audit_log`), đủ 8 cột bắt buộc trừ ngoại lệ đã ghi trong `.claude/docs/data-model.md`. Composite FK `(tenant_id, user_id)` cho `user_role` chống trỏ chéo tenant.
- Migration đầu tiên — sinh bằng `prisma migrate diff` (không có Docker trong môi trường build nên chưa áp thử lên Postgres thật).
- `scripts/check-mandatory-columns.mjs`: kiểm tra mọi model có đủ 8 cột bắt buộc, nối vào CI.
- `apps/api/src/config`: Zod env schema (`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `PORT`, `NODE_ENV`), `ConfigModule` chặn khởi động khi thiếu biến — đã kiểm chứng cả hai chiều (thiếu → crash, đủ → chạy).
- `docker-compose.yml` (gốc, chỉ Postgres, cho local dev — khác với `deploy/on-prem/docker-compose.yml` đầy đủ ở S4-05), `apps/api/.env.example`.
- `packages/shared/src/roles.ts`: enum 5 vai trò (Zod + TS), khớp enum `UserRoleName` trong Prisma schema.
- CI (`ci.yml`): thêm service Postgres, bước `db:check-schema` và `prisma migrate deploy` trước lint/typecheck/build/test.
- 4 quyết định kỹ thuật ghi vào `docs/DECISIONS.md` (#005-#008): không FK cho `created_by`/`updated_by`, UUID v4 tạm thay UUID v7, cách xử lý mâu thuẫn nội bộ về cột `audit_log`, RLS/CHECK/DELETE-revoke để dành cho S1-03.
- Thêm quy định "viết component/hàm tiện ích hướng tái sử dụng ngay từ đầu" vào `CLAUDE.md`.

## 2026-08-07 (2)

S1-01 — Khởi tạo monorepo:

- pnpm workspace gốc: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`, `tsconfig.base.json`.
- `apps/api`: NestJS 10.4, bootstrap tối thiểu (`main.ts`, `app.module.ts`), cấu trúc thư mục `modules/`, `infrastructure/{persistence,storage,eventbus,signature,insurance,notification}`, `common/`, `config/`.
- `apps/web`: React 18.3 + Vite 5.4, bootstrap tối thiểu (`src/app/main.tsx`, `App.tsx`), cấu trúc `features/`, `shared/`, `app/`.
- `packages/core`, `packages/shared`: khung package, `ports/`, `errors/` (rỗng, chờ S1-06).
- ESLint flat config (`eslint.config.js`) với boundary rule chặn `packages/core` import `@nestjs/*`, `@prisma/*`, `react`, `axios`/HTTP client, và đọc `process.env` — đã kiểm chứng thật sự chặn được.
- CI: `.github/workflows/ci.yml` (install → lint → typecheck → build → test).
- `pnpm install`, `build`, `typecheck`, `lint`, `test` chạy sạch trên toàn workspace.
- Đổi tên `docs/product/PRD.md`/`PLAN.md` → `prd.md`/`plan.md` (chữ thường) để khớp đường dẫn tham chiếu trong `CLAUDE.md`.

## 2026-08-07

- Thêm `CLAUDE.md`.
- Thêm `.claude/docs/`: `project-structure.md`, `architecture.md`, `coding-standards.md`, `multi-tenancy.md`, `data-model.md`, `clinical-workflow.md`, `security-audit.md`.
- Thêm `docs/product/prd.md`, `docs/product/plan.md`.
- Thêm `docs/design/design-system.md`.
- Thêm `docs/CURRENT.md`, `docs/TASK.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`.