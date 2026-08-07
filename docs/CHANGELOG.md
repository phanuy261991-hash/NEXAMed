# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

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