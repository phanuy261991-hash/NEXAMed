# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

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