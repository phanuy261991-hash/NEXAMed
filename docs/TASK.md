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
- [ ] S1-03 — Tenant context: middleware `app.current_tenant_id`, RLS policy, unit of work — **ưu tiên cao**, xem `docs/DECISIONS.md` #008 (RLS chưa bật)
- [ ] S1-04 — Auth: JWT + refresh rotation, Argon2id, khoá tài khoản, 5 vai trò, RBAC guard
- [ ] S1-05 — Audit log: interceptor ghi trong cùng transaction, bảng append-only, quyền DB
- [ ] S1-06 — `packages/core`: khung entity, lớp lỗi + mã lỗi, `ports/` 6 interface, adapter no-op, đăng ký DI
- [ ] S1-07 — Test harness cách ly tenant: testcontainers Postgres, helper tạo 2 tenant, template test
- [ ] S1-08 — Web: app shell, router, provider, luồng đăng nhập, layout, design token
- [ ] S1-09 — Web: api client sinh từ OpenAPI, TanStack Query setup với cache key có `tenantId`

**Gate cuối sprint 1** (từ `plan.md`):
- [x] CI fail khi `packages/core` import NestJS/Prisma/React (đã kiểm chứng thủ công với ESLint; CI thật chỉ chạy khi có remote GitHub)
- [x] CI fail khi migration tạo bảng thiếu một trong 8 cột bắt buộc (`scripts/check-mandatory-columns.mjs`, đã kiểm chứng chặn được lỗi thật lúc viết script)
- [ ] Test cách ly tenant chạy được: đăng nhập tenant A gọi ID của tenant B trả 404
- [ ] Mọi thao tác ghi mẫu đều sinh dòng `audit_log`; rollback audit thì rollback cả thao tác

## Sprint 2+

Chưa bắt đầu — xem `docs/product/plan.md` mục 5 trở đi.