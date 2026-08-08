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
- [x] S1-03 — Tenant context: middleware `app.current_tenant_id`, RLS policy, unit of work. RLS/CHECK/thu hồi DELETE **đã bật thật** trên Postgres, xác minh bằng integration test 4/4 pass. Middleware tạm đọc header (chưa qua JWT — xem `docs/DECISIONS.md` #012, phải thay trước khi có controller thật ở S2)
- [ ] S1-04 — Auth: JWT + refresh rotation, Argon2id, khoá tài khoản
- [x] S1-04b — RBAC schema: `role`/`permission`/`role_permission`/`department`, seed danh mục permission (23) + 5 vai trò mặc định + ma trận, guard đọc `role_permission` — **đã xác minh thật** (`rbac.spec.ts`, 4/4 pass). Guard NestJS thật áp vào controller là việc của S2 (chưa có controller)
- [ ] S1-04c — Break-glass: endpoint xin vượt quyền, `break_glass_session`, tích hợp guard, ghi audit (bảng + RLS đã có từ S1-04b, chưa có endpoint/logic)
- [ ] S1-05 — Audit log: interceptor ghi trong cùng transaction, bảng append-only, quyền DB
- [ ] S1-06 — `packages/core`: khung entity, lớp lỗi + mã lỗi, `ports/` 6 interface, adapter no-op, đăng ký DI
- [ ] S1-07 — Test harness cách ly tenant: testcontainers Postgres, helper tạo 2 tenant, template test
- [ ] S1-08 — Web: app shell, router, provider, luồng đăng nhập, layout, design token
- [ ] S1-09 — Web: api client sinh từ OpenAPI, TanStack Query setup với cache key có `tenantId`

**Gate cuối sprint 1** (từ `plan.md`):
- [x] CI fail khi `packages/core` import NestJS/Prisma/React (đã kiểm chứng thủ công với ESLint; CI thật chỉ chạy khi có remote GitHub)
- [x] CI fail khi migration tạo bảng thiếu một trong 8 cột bắt buộc (`scripts/check-mandatory-columns.mjs`, đã kiểm chứng chặn được lỗi thật lúc viết script)
- [~] Test cách ly tenant chạy được: đăng nhập tenant A gọi ID của tenant B trả 404 — cơ chế RLS đã xác minh thật ở tầng repository (`tenant-isolation.spec.ts`), nhưng "đăng nhập" cần S1-04 (auth) chưa có; chưa test được xuyên qua một endpoint HTTP thật vì chưa có controller nào (S2)
- [ ] Mọi thao tác ghi mẫu đều sinh dòng `audit_log`; rollback audit thì rollback cả thao tác
- [~] Guard chặn đúng theo `data_scope` — RLS + ma trận đã xác minh thật ở tầng repository (`rbac.spec.ts`), nhưng chưa có guard NestJS thật gắn vào request/controller (cần S1-04 auth + S2 controller đầu tiên); break-glass (S1-04c) chưa làm

## Sprint 2+

Chưa bắt đầu — xem `docs/product/plan.md` mục 5 trở đi.