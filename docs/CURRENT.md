# Current — NEXAMed

Trạng thái hiện tại của dự án. Cập nhật file này mỗi khi trạng thái thay đổi đáng kể (không phải log từng commit — đó là việc của `CHANGELOG.md`).

## Giai đoạn

Sprint 1 — Nền tảng (tuần 1-2 theo `docs/product/plan.md`). S1-01 (khởi tạo monorepo) đã xong.

## Đã có

- `CLAUDE.md` — quy tắc và ràng buộc dự án.
- `.claude/docs/` — 7 tài liệu kỹ thuật đã chốt.
- `docs/product/prd.md`, `docs/product/plan.md` — đã có nội dung đầy đủ.
- `docs/ERD.md` — sơ đồ quan hệ dữ liệu đầy đủ.
- **S1-01 xong**: monorepo pnpm (`apps/api` NestJS, `apps/web` React+Vite, `packages/core`, `packages/shared`), cấu trúc thư mục theo `.claude/docs/project-structure.md`, ESLint boundary rule chặn `packages/core` import NestJS/Prisma/React/`process.env` (đã kiểm chứng thật sự chặn được), CI (`.github/workflows/ci.yml`): install → lint → typecheck → build → test. `pnpm install`, `build`, `typecheck`, `lint`, `test` đều chạy sạch.
- `docs/design/` — trống, chủ đích chờ bổ sung sau.

## Đang chờ

- S1-02: Prisma schema nền (8 cột bắt buộc, `code_sequence`).
- S1-03: Tenant context (RLS, middleware `app.current_tenant_id`).
- S1-04: Auth (JWT, Argon2id, RBAC).
- S1-06: `packages/core` ports thật (6 interface) + adapter no-op + đăng ký DI.

## Lưu ý môi trường

Máy dev hiện chạy Node v26.5.0, khác Node 20 LTS ghi trong `CLAUDE.md`/`package.json.engines`. Chưa gây lỗi (chỉ warning khi `pnpm install`/build), nhưng cần dùng đúng Node 20 khi triển khai thật — `engine-strict` đang để `false` trong `.npmrc` để không chặn dev trên máy khác Node.