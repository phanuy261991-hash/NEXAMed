# Current — NEXAMed

Trạng thái hiện tại của dự án. Cập nhật file này mỗi khi trạng thái thay đổi đáng kể (không phải log từng commit — đó là việc của `CHANGELOG.md`).

## Giai đoạn

Sprint 1 — Nền tảng (tuần 1-2 theo `docs/product/plan.md`). S1-01, S1-02 đã xong.

## Đã có

- `CLAUDE.md` — quy tắc và ràng buộc dự án (đã bổ sung quy định viết code hướng tái sử dụng).
- `.claude/docs/` — 7 tài liệu kỹ thuật đã chốt.
- `docs/product/prd.md`, `docs/product/plan.md` — đã có nội dung đầy đủ.
- `docs/ERD.md` — sơ đồ quan hệ dữ liệu đầy đủ.
- **S1-01 xong**: monorepo pnpm (`apps/api` NestJS, `apps/web` React+Vite, `packages/core`, `packages/shared`), cấu trúc thư mục theo `.claude/docs/project-structure.md`, ESLint boundary rule chặn `packages/core` import NestJS/Prisma/React/`process.env`, CI (`.github/workflows/ci.yml`).
- **S1-02 xong**: `apps/api/prisma/schema.prisma` với 7 bảng nền tảng (`tenant`, `tenant_setting`, `room`, `user_account`, `user_role`, `code_sequence`, `audit_log`), migration đầu tiên (`prisma/migrations/20260807090207_init`), script kiểm 8 cột bắt buộc (`scripts/check-mandatory-columns.mjs`, nối vào CI), Zod env validation ở `apps/api/src/config` (đã kiểm chứng: API crash đúng khi thiếu `DATABASE_URL`/`JWT_SECRET`/`ENCRYPTION_KEY`, chạy được khi đủ), `docker-compose.yml` gốc cho Postgres local dev, `apps/api/.env.example`. `packages/shared` có enum 5 vai trò (`roles.ts`).
- **Postgres nâng lên bản 18** (từ 16) để dùng `uuidv7()` thật cho mọi `id` — xem `docs/DECISIONS.md` #009.
- `docs/design/` — có `UI_GUIDELINE.md`, `AI_AVOID_RULES.md`.

## Đang chờ

- S1-03: Tenant context (RLS, middleware `app.current_tenant_id`, unit of work) — **bắt buộc** trước khi có dữ liệu thật, xem `docs/DECISIONS.md` #008.
- S1-04: Auth (JWT, Argon2id, RBAC).
- S1-05: Audit log interceptor.
- S1-06: `packages/core` ports thật (6 interface) + adapter no-op + đăng ký DI.
- S1-07: Test harness cách ly tenant (testcontainers).

## Lưu ý môi trường

- Máy dev hiện chạy Node v26.5.0, khác Node 20 LTS ghi trong `CLAUDE.md`/`package.json.engines`. Chưa gây lỗi (chỉ warning), nhưng cần dùng đúng Node 20 khi triển khai thật.
- Docker đã cài trên máy dev. Migration `20260807090207_init` **đã được áp thật lên Postgres 18.4** qua `prisma migrate deploy` và xác minh bằng insert thử — `id` sinh ra đúng UUID v7 (time-ordered, ví dụ `019fdc38-6d2f-7ff2-...`). Không còn là "chưa test".
- **Postgres container map ra cổng 5433, không phải 5432 mặc định** — máy dev này có sẵn một Postgres native (Windows service `postgres.exe`, không liên quan tới dự án) đang chiếm 5432. `DATABASE_URL` trong `.env.example`/`.env` đã trỏ sang `5433`. Nếu đổi máy dev khác không có xung đột này, có thể đổi lại 5432 trong `docker-compose.yml`.
- UUID v7 (`DECISIONS.md` #009) và cột `audit_log` (`DECISIONS.md` #007) đã chốt xong, không còn treo.