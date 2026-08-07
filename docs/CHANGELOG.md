# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

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