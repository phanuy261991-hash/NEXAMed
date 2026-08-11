# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

## 2026-08-11 (5)

S2-02 — Tìm kiếm bệnh nhân (PAT-02: theo tên không dấu, số điện thoại, mã bệnh nhân):

- **`packages/core/src/search/strip-vietnamese-diacritics.ts`**: bỏ dấu tiếng Việt + viết thường ở tầng ứng dụng, dùng `String.prototype.normalize('NFD')` xoá combining diacritical mark (U+0300–U+036F) + tự thay riêng chữ "đ"/"Đ" (U+0111/U+0110 — không phải ký tự tổ hợp, `unaccent` chuẩn của Postgres bỏ sót). Viết bằng hex code point/`String.fromCharCode` thay vì gõ trực tiếp ký tự tổ hợp trong regex literal — phát hiện lúc viết: gõ trực tiếp ký tự combining mark vào regex character class bị vỡ mã hoá qua nhiều lớp công cụ (không phải lỗi TypeScript/Node, mà là lỗi truyền chuỗi trước khi tới trình biên dịch). Unit test 5/5, gồm đủ 5 thanh điệu + nguyên âm mở rộng.
- **Migration `20260811055006_patient_search_s2_02`**: bật extension `unaccent`, `pg_trgm`, `btree_gin` (`btree_gin` cần để một cột kiểu thường như `uuid` — `tenant_id` — tham gia cùng một GIN index với cột `gin_trgm_ops`, vì GIN thuần không có opclass cho `uuid`). Hàm SQL `nexamed_unaccent_lower(text)` bọc `unaccent()` (vốn `STABLE`, không dùng được trong generated column hay index biểu thức) thành `IMMUTABLE` — đánh đổi đã ghi rõ trong migration (chấp nhận vì dictionary `unaccent` gần như không đổi). Cột `patient.search_key TEXT GENERATED ALWAYS AS (nexamed_unaccent_lower(full_name)) STORED`. GIN kết hợp `(tenant_id, search_key gin_trgm_ops)` — đúng `docs/ERD.md` mục 5 "Index cần có từ đầu".
- **Sự cố phát hiện khi scaffold migration**: `prisma migrate dev --create-only` tự đề xuất `DROP INDEX patient_tenant_id_phone_idx` — Prisma coi index này là "drift" vì nó chỉ tồn tại ở raw SQL (migration S2-01), không có khai báo tương ứng trong `schema.prisma` (schema.prisma không có cú pháp cho partial index/GIN/generated column nên nhiều index của `patient` chỉ tồn tại ở raw SQL). Đã phát hiện và bỏ dòng DROP INDEX đó trước khi merge — bài học ghi vào comment migration: mọi `--create-only` sau này trên bảng có index raw-SQL-only đều phải soát kỹ, Prisma không "biết" những gì nó không quản lý qua schema.prisma.
- **Prisma quirk khác**: khai `searchKey` là `String` (không nullable) trong `schema.prisma` khiến `PatientUncheckedCreateInput` bắt buộc phải truyền field này lúc `create()` — vô lý với generated column (DB tự tính, ghi vào sẽ lỗi, và Prisma không có khái niệm "generated column chỉ đọc"). Sửa bằng khai `String?` dù thực tế DB không bao giờ null (đã ghi rõ lý do trong comment schema).
- **`PatientRepository.list()`/`PatientService.listPatients()`**: mở rộng nhận `search` — `q` gốc khớp `patientCode`/`phone` (`startsWith`), bản đã chuẩn hoá qua `stripVietnameseDiacritics` khớp `searchKey` (`contains`). `listPatientsQuerySchema` (`packages/shared`) thêm field `q` (optional, max 100 ký tự).
- **Đo hiệu năng thật với 50.000 bản ghi** (`apps/api/scripts/perf-patient-search.ts`, script thủ công — `pnpm --filter @nexamed/api run perf:patient-search`, không chạy trong CI vì seed 50k dòng tốn thời gian): bulk INSERT 50k dòng "nhiễu" tên tiếng Việt ngẫu nhiên qua `generate_series` (nhanh hơn nhiều lần so với gọi `PatientRepository.create()` 50k lần), cộng 1 dòng "kim" cần tìm. Cả 3 kiểu tìm (tên/SĐT/mã) đều dưới 35ms qua đúng role app (`DATABASE_URL`, có RLS) — đạt mục tiêu "<1 giây" của `docs/product/prd.md` mục 5 với biên độ lớn.
  - **Phát hiện đáng chú ý**: lần đo đầu tiên (ngay sau bulk insert, chưa `ANALYZE`) planner chọn `patient_tenant_id_id_active_idx` (btree) thay vì GIN — do thống kê bảng còn cũ (gần như rỗng) từ trước khi bulk insert. Thêm `ANALYZE patient` sau bulk insert để mô phỏng đúng trạng thái ổn định của dữ liệu thật — sau đó planner chuyển sang **Seq Scan**, vẫn không dùng GIN. Đây là quyết định ĐÚNG của Postgres cho quy mô 50k dòng/tenant (bảng đủ nhỏ để nằm gọn trong shared buffers — quét tuần tự rẻ hơn tra index ngẫu nhiên), không phải lỗi index. Xác nhận GIN trigram index tồn tại và dùng được thật bằng cách ép `SET LOCAL enable_seqscan = off` — `EXPLAIN ANALYZE` xác nhận đúng `Bitmap Index Scan` trên `patient_tenant_id_search_key_trgm_idx`. Planner sẽ tự chuyển sang dùng GIN khi dữ liệu đủ lớn (nhiều tenant cộng dồn hoặc một tenant lâu năm) mà không cần đổi code — script ném lỗi nếu GIN index không dùng được thật khi ép chọn, để lần đo sau tự phát hiện nếu index bị hỏng.
- **Đã xác minh thật**: `patient-http.spec.ts` thêm 6 test tìm kiếm (16/16 tổng pass) — tìm không dấu, tìm nguyên bản có dấu, tìm SĐT (prefix), tìm mã bệnh nhân (prefix, không phân biệt hoa/thường), không khớp gì → mảng rỗng không lỗi, cách ly tenant khi tìm kiếm (tenant B không thấy bệnh nhân tenant A dù cùng từ khoá). Testcontainers cũng áp migration mới thành công từ đầu (xác nhận 3 extension không phụ thuộc cài đặt thủ công trên máy dev). Toàn bộ 69 test `apps/api` + 25 test `packages/core` pass, không regress. `pnpm -w lint/typecheck/build` sạch toàn workspace. OpenAPI (`openapi:generate`) + web type (`api:codegen`) đã sinh lại cho query param `q` mới.
- Cập nhật `docs/TASK.md`, `docs/CURRENT.md`. Không đổi `.claude/docs/data-model.md`/`docs/ERD.md` (không đổi cấu trúc cột nghiệp vụ, `search_key` đã nằm trong kế hoạch mục Index từ trước).
- **Kế hoạch Tiếp nhận (Sprint 3)**: đã trao đổi và chốt sơ bộ với chủ dự án (chưa code) — xây đủ module `appointment` (S2-05/06) + màn hình lịch (S2-09) trước Tiếp nhận, đúng thứ tự `docs/product/plan.md`, không đi đường tắt "chỉ walk-in tối thiểu". Snapshot thẻ BHYT lúc check-in tạm luôn `self_pay=true` tới khi làm S2-04 (lùi lại sau Sprint 3, không chặn tiến độ Tiếp nhận). Đã trình bày plan schema/UI dựa đúng theo `docs/ERD.md`/`.claude/docs/clinical-workflow.md` đã chốt, không đề xuất trường mới.

## 2026-08-11 (4)

S2-01 — Module `patient` (CRUD, mã hoá CCCD) + `PermissionGuard` thật đầu tiên (Sprint 1 → Sprint 2):

- **Trước khi viết migration**: phát hiện `docs/ERD.md` (sơ đồ mermaid) lệch với `.claude/docs/data-model.md` (mô tả chi tiết) cho bảng `patient` — thiếu `address_json` (PRD PAT-01, P0) và `identity_verified_at` (đi cùng `global_patient_ref`, liên-tenant v3+). Hỏi và xác nhận với chủ dự án trước khi tự chọn (theo `CLAUDE.md` — cấu trúc đã chốt lệch nhau thì dừng lại hỏi): thêm cả hai cột, sửa `docs/ERD.md` khớp lại (v1.3). Ghi `docs/DECISIONS.md` #024.
- **Migration `20260811024047_patient_s2_01`**: bảng `patient` đủ 8 cột bắt buộc + cột đặc thù (`patient_code`, `full_name`, `dob`, `gender`, `phone`, `national_id_enc`, `national_id_hash`, `address_json`, `allergy_note`, `merged_into_id`, `global_patient_ref`, `identity_verified_at`), RLS, `CHECK(version>=1)`, `UNIQUE(tenant_id, patient_code)`, partial `UNIQUE(tenant_id, national_id_hash) WHERE national_id_hash IS NOT NULL` (C3 — viết raw SQL, Prisma `@@unique` không biểu diễn được điều kiện `WHERE`), index `(tenant_id, phone)`, composite FK tự tham chiếu `merged_into_id` (chưa dùng, để sẵn PAT-04/S2-03).
- **Mã hoá PII**: `apps/api/src/infrastructure/crypto/pii-encryption.ts` — `encryptPii`/`decryptPii` (AES-256-GCM, khoá từ `ENCRYPTION_KEY` chuẩn hoá 32 byte qua SHA-256), `hashForLookup` (HMAC-SHA256, tra trùng chính xác không cần giải mã hàng loạt). Viết cho tái dùng ngay từ đầu — sẽ dùng lại cho `insurance_card.card_no` ở S2-04.
- **Mã hiển thị**: `apps/api/src/infrastructure/persistence/code-sequence.repository.ts` (đăng ký global trong `PersistenceModule`, dùng chung mọi domain sinh mã tuần tự) — cấp số bằng `INSERT ... ON CONFLICT DO UPDATE` atomic. `packages/core/src/code-sequence/format-display-code.ts` — định dạng `<prefix><yyMM><seq6>` (`BN2608000001`), tính tháng theo giờ Việt Nam (UTC+7 cố định, không dùng thư viện timezone) thay vì UTC server — tránh sai tháng ở khung nửa đêm tới 7h sáng UTC (đúng CLAUDE.md: "không dùng `new Date()` phía server để cắt mốc ngày").
- **`PermissionGuard` thật** (`apps/api/src/common/permission.guard.ts` + `require-permission.decorator.ts` + `infrastructure/persistence/permission-lookup.helper.ts`) — việc treo từ Sprint 1 (docs/TASK.md "Đang chờ"), giờ hiện thực vì `patient` là controller nghiệp vụ đầu tiên. Đọc `role_permission` gộp theo mọi vai trò user đang giữ (`packages/core/src/rbac/data-scope.ts` — `maxDataScope`, unit test 3/3); `none` → thử `BreakGlassService.tryConsume()` nếu route có `entityIdParam` (chỉ áp dụng route thao tác một bản ghi cụ thể), không có phiên hợp lệ thì `403 { error: { code: 'PERMISSION_DENIED', details: { breakGlassAvailable: true } } }`. `IamModule` đổi thành `@Global()` — lý do kỹ thuật: Nest resolve dependency của `PermissionGuard` (đặt ở `CommonModule`, cũng global) theo context của module ĐANG DÙNG guard (`PatientModule`), không phải module định nghĩa guard, nên `BreakGlassService` phải tự nó global thay vì chỉ "chảy qua" `CommonModule.imports` — phát hiện qua lỗi DI thật lúc chạy test lần đầu, không phải suy đoán trước.
- **`DomainExceptionFilter` mở rộng**: nhánh `HttpException` chung giờ gói field lạ ngoài `message`/`code`/`statusCode`/`error` mặc định của Nest vào `error.details` (phục vụ `breakGlassAvailable`) — không đổi hình dạng response cho exception không có field lạ (đã xác minh qua toàn bộ test cũ vẫn pass nguyên).
- **DTO** (`packages/shared/src/patient.ts`): `createPatientRequestSchema`, `updatePatientRequestSchema` (bắt buộc kèm `version`), `patientSummarySchema` (danh sách — không lộ CCCD, chỉ `hasNationalId`), `patientDetailSchema` (chi tiết — kèm CCCD đã giải mã), `listPatientsQuerySchema`/`listPatientsResponseSchema` (cursor, không offset — theo `.claude/docs/architecture.md`). `packages/core/src/errors/`: `PatientDuplicateNationalIdError` (409), `ConcurrentModificationError` (409, dùng chung mọi module, không riêng `patient`).
- **`PATCH /patients/:id`**: optimistic locking qua `updateMany` + kiểm `count` thay vì `update()` (Prisma `update()` chỉ nhận unique field làm điều kiện, không ghép thêm được `version` vào cùng `WHERE`).
- **API + web**: `PatientController` (`POST/GET/GET:id/PATCH:id /api/v1/patients`), tất cả qua `JwtAuthGuard` + `PermissionGuard` + `@RequirePermission()`; `GET :id` thêm `@AuditView('patient')` (lần dùng thật đầu tiên của `AuditViewInterceptor`, viết từ S1-05). OpenAPI (`apps/api/scripts/generate-openapi.ts`, S1-09) thêm 4 path — cần `extendZodWithOpenApi(z)` trước khi dùng `request.params`/`request.query` (khác `request.body`, không cần) mới phát hiện lúc chạy generator lần đầu cho path có param. Sinh lại `openapi.json` + `openapi-schema.d.ts` (web).
- **Đã xác minh thật** (không mock, Postgres thật qua testcontainers): `patient-http.spec.ts` (10/10, HTTP e2e qua toàn bộ stack) — tạo hồ sơ có/không CCCD, CCCD mã hoá thật ở DB (kiểm tra trực tiếp cột `national_id_enc` không chứa plaintext), trùng CCCD → 409, danh sách không lộ CCCD, optimistic lock (version cũ → 409 `CONCURRENT_MODIFICATION`, version đúng → 200), vai trò thiếu quyền (`doctor` thiếu `patient.create`, `system_admin` không có `patient.*` nào) → 403 kèm `breakGlassAvailable`, user tenant B (có `patient.read=global`) gọi ID của tenant A → 404 không phải 403 (đúng cả `PermissionGuard` lẫn RLS/lọc `tenantId` ở repository). `code-sequence.repository.spec.ts` (3/3 — tăng dần đúng, tenant riêng biệt không cộng dồn, cấp đồng thời 10 lần không trùng số). `pii-encryption.spec.ts` (5/5). `data-scope.spec.ts`, `format-display-code.spec.ts` (`packages/core`). Toàn bộ 63 test `apps/api` + 20 test `packages/core` pass, không regress test Sprint 1. `pnpm -w lint/typecheck/build` sạch toàn workspace.
- Cập nhật `docs/DECISIONS.md` (#024), `docs/TASK.md`, `docs/CURRENT.md`, `docs/ERD.md` (v1.3), `.claude/docs/data-model.md`, `.claude/docs/security-audit.md` (mục Data Scope — mô tả `PermissionGuard` đã hiện thực).

## 2026-08-11 (3)

S1-09 — API client sinh từ OpenAPI + TanStack Query cache-key infra (Sprint 1 hoàn tất toàn bộ 11 việc):

- `apps/api/scripts/generate-openapi.ts`: dựng `OpenAPIRegistry` (`@asteasolutions/zod-to-openapi@^7.3.0` — ghim bản 7 vì bản 9 mới nhất yêu cầu peer `zod@^4`, dự án đang ghim `zod@^3.23.8`) trực tiếp từ các Zod schema đã có ở `@nexamed/shared` (`loginRequestSchema`, `loginResponseSchema`, `refreshResponseSchema`, `logoutResponseSchema`, `meResponseSchema`, `breakGlassRequestSchema`, `breakGlassResponseSchema`) — không viết lại contract theo trí nhớ, đúng `.claude/docs/coding-standards.md`. Không dùng `@nestjs/swagger` (scan decorator trên DTO class) vì hệ thống validate bằng `schema.parse(body)` ngay trong controller, không có DTO class nào để scan. Script xuất `apps/api/openapi/openapi.json` (5 endpoint: `/auth/login|refresh|logout|me`, `/break-glass`, đúng envelope `{data,meta}`/`{error}` theo `architecture.md`, có `securitySchemes.bearerAuth`). Chạy: `pnpm --filter @nexamed/api run openapi:generate`.
- `packages/shared/src/auth.ts`: thêm `refreshResponseSchema`, `logoutResponseSchema` — hai response trước đây (`/auth/refresh`, `/auth/logout`) trả object ad-hoc trong controller, không có schema Zod tương ứng để làm nguồn cho registry.
- `apps/web`: `openapi-typescript` sinh `src/shared/api/openapi-schema.d.ts` từ `apps/api/openapi/openapi.json` (không cần API đang chạy — chạy: `pnpm --filter @nexamed/web run api:codegen`). `src/shared/api/client.ts` viết lại hoàn toàn bằng `openapi-fetch` — thay wrapper `fetch` tối giản tự viết ở S1-08: giữ nguyên `ApiError` và việc bóc envelope `{data,meta}`/`{error}` (hàm `unwrap()`), nhưng đính `Authorization: Bearer` qua `openapi-fetch` middleware (`setAccessToken()`) thay vì truyền tham số `accessToken` ở từng lời gọi như trước. `src/shared/api/query-keys.ts`: factory cache key `[tenantId, domain, ...]` đúng quy ước `.claude/docs/architecture.md` mục "Luồng dữ liệu phía web" — chưa có nơi dùng thật (auth vẫn là session state qua Zustand theo quyết định đã có ở S1-08, không phải server entity data), sẵn sàng cho hook `useQuery` của `patient`/`appointment` ở S2.
- `apps/web/src/features/auth/auth.api.ts` đổi chữ ký `getMe()` (bỏ tham số `accessToken`); `apps/web/src/app/AppBootstrap.tsx` cập nhật theo.
- **Quyết định commit cả `openapi.json` lẫn `openapi-schema.d.ts`** vào repo (không gitignore) — xem `docs/DECISIONS.md` #023: `apps/web` phải build được độc lập, không phụ thuộc `apps/api` đang chạy hay đã build trước (chưa có bước CI nào đảm bảo thứ tự đó).
- **Đã xác minh thật**: `pnpm -w lint/typecheck/build` sạch toàn workspace; 45 test `apps/api` + 14 test `packages/core` pass nguyên, không đổi hành vi backend (chỉ thêm 2 schema Zod). Chạy `pnpm dev` thật (api :3000 + web :5173) + Playwright (headless Chromium, cài tạm ở scratchpad — môi trường vẫn chưa có project skill `run`) xác nhận qua ảnh chụp màn hình: đăng nhập đúng → Dashboard; F5 (reload) giữ nguyên phiên qua đúng luồng `refresh` → `/auth/me` bằng client mới; đăng xuất → `/login`; kiểm `console --errors` không có lỗi ngoài dự kiến (chỉ 401 ở lần `/auth/refresh` đầu tiên khi trang chưa từng có phiên, giống hành vi đã ghi nhận ở S1-08).
- Cập nhật `docs/DECISIONS.md` (#023), `docs/TASK.md`, `docs/CURRENT.md` — Sprint 1 nay đã xong toàn bộ 11 việc (S1-01 → S1-09), sẵn sàng Sprint 2.

## 2026-08-11 (2)

S1-08 — Web app shell (router, luồng đăng nhập, layout, menu, design token):

- Trước khi code, hỏi chốt với chủ dự án về luồng/menu (yêu cầu mới, ghi vào memory): menu sidebar kết hợp theo luồng nghiệp vụ + ẩn/hiện theo vai trò; có Dashboard chung dạng empty-state; Quản trị là mục sidebar riêng (không gộp avatar) chỉ hiện với `clinic_admin`/`system_admin`; chỉ hiện menu module đã có backend thật; màu/token theo `.claude/docs/ui-guidelines.md`; `tenantId` nạp runtime qua `config.json`. Đọc `docs/design/UI_GUIDELINE.md` theo yêu cầu chủ dự án — dùng làm tham khảo cho cấu trúc menu/layout (sidebar cố định không collapse, không "3 card ngang bằng nhau"...), không dùng bảng màu/font riêng của tài liệu đó.
- **Backend mở rộng nhỏ** (`docs/DECISIONS.md` #022, tiền đề bắt buộc cho menu theo vai trò): `packages/shared/src/auth.ts` — `loginResponseSchema.user` thêm `roles: UserRole[]`, tách `currentUserSchema` dùng chung với response mới. `apps/api/src/modules/iam/`: `user-account-auth.repository.ts` thêm `findRoleNamesForUser()`; `auth.service.ts` thêm `getCurrentUser()`, `login()` trả kèm `roles`; `auth.controller.ts` thêm `GET /auth/me` (`JwtAuthGuard` — lần dùng thật thứ hai sau `POST /break-glass`) phục vụ khôi phục danh tính lúc web reload trang (chỉ còn refresh cookie). Không migration mới. Test mở rộng: `auth.spec.ts` (11/11, seed vai trò `doctor`), `auth-login-http.spec.ts` (5/5, seed vai trò `nurse` + test `/auth/me` có/không token).
- **Frontend** — `apps/web` từ bare Vite+React scaffold thành app shell đầy đủ:
  - Dependencies: `react-router-dom` v7, `@phosphor-icons/react` (khai báo tường minh, trước chỉ có ở root), Tailwind **v4** qua `@tailwindcss/vite` — phát hiện lúc cài rằng v4 không cần `tailwind.config.js`/`postcss.config.js` như giả định ban đầu (kế hoạch viết cho v3), chỉ cần `@import 'tailwindcss'` trong CSS + plugin Vite; cùng lớp class Tailwind utility nên không ảnh hưởng token đã chốt.
  - `apps/web/public/config.json` (gitignore) + `config.example.json`: runtime config `{apiBaseUrl, tenantId}`, Vite copy nguyên vào `dist/` — sửa trực tiếp lúc deploy on-prem không cần rebuild.
  - `apps/web/src/shared/api/client.ts`: wrapper `fetch` tối giản (`credentials:'include'` cho cookie refresh, parse envelope `{data,meta}`/`{error}`) — chỉ đủ cho auth flow, S1-09 thay hẳn bằng client sinh từ OpenAPI + TanStack Query.
  - `apps/web/src/features/auth/`: Zustand `auth.store.ts` (session state, không phải server entity — đúng `.claude/docs/architecture.md`), `auth.api.ts`, `LoginPage.tsx` (theo `ui-guidelines.md` mục 4.1: required `*` đỏ, focus ring, nút loading), `RequireAuth.tsx`.
  - `apps/web/src/app/AppBootstrap.tsx`: khôi phục phiên lúc app khởi động — gọi `/auth/refresh` (cookie) rồi `/auth/me` (roles).
  - `apps/web/src/shared/layout/`: `AppShell.tsx` (sidebar `w-60 bg-slate-900` cố định + nội dung `max-w-[1400px]`), `Sidebar.tsx` (active state `weight="fill"`, Quản trị lọc theo vai trò), `UserMenu.tsx`.
  - `apps/web/src/features/dashboard/DashboardPage.tsx`, `.../admin/AdminPage.tsx`: empty-state đúng `ui-guidelines.md` mục 3 (không bịa số liệu).
  - `apps/web/src/shared/ui/`: `Button.tsx`, `EmptyState.tsx` dùng chung.
  - Dùng skill `ui-ux-pro-max` (theo yêu cầu chủ dự án) tra cứu icon/layout/empty-state cho enterprise dashboard mật độ dữ liệu cao — chỉ lấy phần layout/spacing/icon, không lấy bảng màu (đã có token riêng).
- **Sự cố kỹ thuật gặp và xử lý lúc build**:
  - `@nestjs/testing` bị pnpm resolve nhầm bản `11.x` (dự án dùng NestJS 10.4) — gỡ, cài lại ghim `^10.4.15`.
  - `vite.config.ts` build lỗi `ESM-only` vì `@tailwindcss/vite` là gói ESM thuần nhưng Vite bundle config theo CJS — đổi tên file sang `vite.config.mts` (cách sửa chính thức của Vite).
  - `main.tsx`: TypeScript không narrow được `HTMLElement | null` xuyên qua closure của hàm `bootstrap()` khai báo riêng — sửa bằng truyền `rootElement` làm tham số thay vì đọc biến ngoài closure.
- **Phát hiện + sửa 1 race condition lúc kiểm bằng trình duyệt thật** (không phải bug nghiệp vụ, chỉ dev-only): React StrictMode gọi effect 2 lần khiến `AppBootstrap` bắn 2 request `/auth/refresh` gần đồng thời, có thể đụng cơ chế phát hiện reuse-token (S1-04, thu hồi toàn bộ phiên khi token đã rotate bị dùng lại) — chặn bằng `useRef` guard đảm bảo effect chỉ chạy thật một lần.
- **Xác minh thật bằng trình duyệt**: môi trường chưa có project skill `run` cho dự án này — tự cài Playwright + Chromium headless (npm trong thư mục scratchpad, không thêm vào dependencies của dự án), chạy `pnpm dev` thật (api :3000 + web :5173), tạo 1 tenant + user `clinic_admin` thử qua script tạm (xoá sau khi xong, không commit), lái trình duyệt qua toàn bộ luồng: chưa đăng nhập → `/login`; đăng nhập đúng → Dashboard đúng token màu, thấy đủ Tổng quan + Quản trị; empty-state đúng cả hai trang; F5 giữ nguyên phiên; đăng xuất → `/login`. Chụp ảnh màn hình xác nhận từng bước, kiểm `console --errors` không có lỗi thật (chỉ 401 dự kiến ở lần refresh đầu tiên khi chưa có phiên).
- `pnpm -w lint/typecheck/build` sạch toàn workspace; `apps/api` 45 test pass (11 auth.spec.ts + 5 auth-login-http.spec.ts, còn lại giữ nguyên).
- Cập nhật `docs/DECISIONS.md` (#022), `docs/TASK.md`, `docs/CURRENT.md`.

## 2026-08-11

S1-07 — Test harness cách ly tenant (testcontainers + HTTP e2e đầu tiên):

- `apps/api/src/testing/global-setup.ts`: Vitest `globalSetup` — dựng Postgres 18 tạm bằng `@testcontainers/postgresql`, chạy `prisma migrate deploy` thật lên đó, set `DATABASE_URL`/`MIGRATE_DATABASE_URL` TRƯỚC khi Vitest tách worker chạy từng file test. Vì 6 spec đã có (`tenant-isolation`, `rbac`, `auth`, `break-glass`, `audit-view.interceptor`, `jwt-auth.guard`) đều đọc hai biến này qua `process.env`/Prisma datasource mặc định, không phải sửa lại file nào — `pnpm test` giờ tự dựng DB sạch, không cần `docker compose up -d` trước. CI service Postgres (`db:check-schema`/`db:deploy`/`db:seed`) giữ nguyên, không đụng — vẫn xác minh migration/seed chạy được độc lập.
- `apps/api/src/testing/tenant-fixture.ts`: `createTwoTenantFixture()` — helper tạo 2 tenant + `cleanup()` đúng thứ tự FK, thay cho boilerplate lặp lại 4 lần ở các spec cũ (không retrofit spec cũ — dùng cho test mới từ S2 trở đi).
- `apps/api/src/modules/iam/auth-login-http.spec.ts`: test HTTP e2e thật đầu tiên của dự án — boot toàn bộ `AppModule` qua `@nestjs/testing` (đúng wiring của `main.ts`: prefix, cookie-parser, interceptor, filter) rồi gọi qua supertest, khác `auth.spec.ts` (S1-04) gọi thẳng service bỏ qua controller/guard/filter. Dùng làm template cho endpoint nghiệp vụ đầu tiên ở S2.
- Hai vấn đề hạ tầng test mới lộ ra khi viết test HTTP e2e đầu tiên (đã xác minh cả hai chỉ là artifact môi trường Vitest, KHÔNG phải bug thật — kiểm bằng `node dist/main.js` + `curl` trên production build):
  1. **DI âm thầm ra `undefined`**: Vitest transform TypeScript bằng esbuild mặc định, esbuild không emit `design:paramtypes` (decorator metadata) mà NestJS DI cần để suy ra kiểu tham số constructor không có `@Inject()` tường minh. `Test.createTestingModule` vẫn compile thành công nhưng inject `undefined` thay vì lỗi rõ ràng. Sửa bằng `unplugin-swc` + `apps/api/.swcrc` (`decoratorMetadata: true`) thay esbuild — đúng khuyến nghị chính thức NestJS (docs.nestjs.com/recipes/swc mục Vitest). Chỉ ảnh hưởng lúc test; build production vẫn `tsc`/`nest build` như cũ.
  2. **`exception instanceof ZodError` sai qua ranh giới package**: `loginRequestSchema` định nghĩa ở `@nexamed/shared` (build sẵn CommonJS), còn `domain-exception.filter.ts` ở `apps/api` (transform qua SWC/ESM lúc test) — hai bên nạp gói `zod` qua hai đường module khác nhau trong Vitest, khiến `instanceof` sai dù đúng là `ZodError`. Đổi `apps/api/src/common/domain-exception.filter.ts` sang `isZodError()` kiểm theo cấu trúc (`err.name === 'ZodError'` + `issues` là mảng) thay vì `instanceof` — bền vững hơn qua mọi ranh giới module/bundler, không chỉ vá cho môi trường test.
- Thêm devDependencies `apps/api`: `@testcontainers/postgresql`, `@nestjs/testing` (ghim đúng `^10.4.x` khớp NestJS 10.4 — lần đầu cài bị pnpm resolve nhầm `11.x`, đã sửa lại), `supertest`, `@types/supertest`, `unplugin-swc`, `@swc/core`.
- Cũng thêm `import 'reflect-metadata'` vào `vitest.setup.ts` (trước nay chỉ `main.ts` cần vì các test trước giờ đều `new Service(...)` tay, không qua NestJS DI container thật).
- **Đã xác minh thật**: toàn bộ 41 test `apps/api` pass (38 cũ giữ nguyên hành vi + 3 mới), chạy lại nhiều lần ổn định không flaky; lint/typecheck/build sạch toàn workspace.
- Cập nhật `docs/TASK.md`, `docs/CURRENT.md`.

## 2026-08-10 (5)

S1-06 — Hoàn thiện `packages/core` (khung entity + 5 port còn lại + đăng ký DI):

- `packages/core/src/entity/base-entity.ts`: `BaseEntity` (8 cột bắt buộc), `AppendOnlyEntity` (audit_log/break_glass_session), `SignableEntity` (dữ liệu lâm sàng ký được) + hàm thuần `isSigned()` — nguồn sự thật duy nhất cho quy tắc "bản ghi đã ký bất biến" (`.claude/docs/clinical-workflow.md`), unit test 2/2.
- `packages/core/src/ports/`: thêm 5 interface còn lại (`NotificationPort` đã có từ S1-04c) — `StoragePort`, `EventBusPort`, `SignaturePort`, `InsuranceGatewayPort`, `PatientIdentityPort`. Mỗi port có docstring trỏ về đúng mục trong `.claude/docs/project-structure.md`/`multi-tenancy.md`/`security-audit.md`/`clinical-workflow.md` giải thích lý do tồn tại và adapter v1 tương ứng.
- `apps/api/src/infrastructure/`: 5 adapter — `storage/local-disk.adapter.ts` (ghi/đọc/xoá file thật dưới `STORAGE_DIR/<tenantId>/<key>`, chặn key chứa `..`), `eventbus/in-memory.adapter.ts` (publish/subscribe đồng bộ, handler lỗi ném lên để service rollback transaction gốc — đúng quy ước ở `.claude/docs/coding-standards.md` mục Event), `signature/noop.adapter.ts` (chữ ký logic, `signaturePayload: null`), `insurance/noop.adapter.ts` (ném `NOT_IMPLEMENTED`, đúng bảng port/adapter đã chốt), `patient-identity/same-tenant.adapter.ts` (trả chính `patient.id`). `ports.module.ts` (`@Global()`) đăng ký DI cho cả 5 — không đụng `NOTIFICATION_PORT` (vẫn ở `IamModule` như S1-04c), wire vào `AppModule`.
- Thêm `STORAGE_DIR` vào `apps/api/src/config/env.schema.ts` (mặc định `./storage`) + `.env.example`; thêm `/storage/` vào `.gitignore`.
- Không có folder `patient-identity/` sẵn trong cây thư mục minh hoạ ở `project-structure.md` (chỉ liệt kê storage/eventbus/signature/insurance/notification) — tạo thêm đúng theo pattern "một thư mục cho mỗi port" đã có sẵn cho 5 port kia, không phải suy diễn lại cấu trúc đã chốt.
- Test thật (không mock): `base-entity.spec.ts` (2/2), `local-disk.adapter.spec.ts` (4/4, ghi/đọc/xoá file thật trên disk tạm + chặn path traversal), `in-memory.adapter.spec.ts` (3/3, đúng thứ tự handler + rollback khi handler lỗi). Build thật (`node dist/main.js`) xác nhận `PortsModule dependencies initialized` + `Nest application successfully started` qua NestJS DI container thật — khác các test trước chỉ `new Service(...)` tay bỏ qua Nest, nên đây là lần đầu DI thật của `AppModule` được xác minh chạy được từ đầu đến cuối.
- Toàn bộ 52 test trên workspace (14 `packages/core` + 38 `apps/api`, cộng 9 test mới trong đó) pass; lint/typecheck/build sạch toàn workspace.
- Cập nhật `docs/TASK.md`, `docs/CURRENT.md`.

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