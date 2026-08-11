# Decisions — NEXAMed

Quyết định kiến trúc/nghiệp vụ đã chốt, ngoài những gì đã nằm sẵn trong `CLAUDE.md` và `.claude/docs/`. Không sửa lại quyết định cũ trong file này — nếu quyết định đổi, thêm mục mới ghi rõ "thay thế mục #N".

## 001 — Phân vai `docs/` và `.claude/docs/`

**Ngày**: 2026-08-07
**Quyết định**: `docs/` chứa tài liệu cho người (product, design, trạng thái dự án...); `.claude/docs/` chứa tài liệu kỹ thuật đã chốt cho agent (schema, state machine, contract...). CLAUDE.md chỉ tham chiếu `.claude/docs/`.
**Vì sao**: Tránh agent đọc nhầm tài liệu chưa chốt làm nguồn "đã chốt".

## 002 — Vị trí PRD và plan

**Ngày**: 2026-08-07
**Quyết định**: PRD và plan triển khai đặt tại `docs/product/prd.md` và `docs/product/plan.md`.
**Vì sao**: Vòng đời theo sprint/release, khác nhịp với tài liệu kỹ thuật lâu dài.

## 003 — Vị trí design system

**Ngày**: 2026-08-07
**Quyết định**: Design system ở v1 là tài liệu (không phải code triển khai), đặt tại `docs/design/design-system.md`.
**Vì sao**: Chưa cần token/theme chạy được trong code; khi cần sẽ bổ sung code triển khai riêng ở `packages/shared` hoặc `apps/web/src/shared`.

## 004 — `packages/core` và `packages/shared` build ra CommonJS, không phải ESM

**Ngày**: 2026-08-07
**Quyết định**: Cả hai package build bằng `tsc` ra `dist/` dạng CommonJS (`module: "CommonJS"`), export qua `main`/`types` trỏ vào `dist/index.js`/`dist/index.d.ts`. Không dùng ESM hay trỏ `main` thẳng vào file `.ts`.
**Vì sao**: `apps/api` (NestJS, `nest build`) chỉ biên dịch code của chính nó, không transpile ngược các package workspace phụ thuộc. Nếu `packages/core`/`packages/shared` là ESM hoặc trỏ `main` vào `.ts`, `node dist/main.js` của `apps/api` sẽ crash khi `require()` các package này ở runtime (`ERR_REQUIRE_ESM` hoặc không đọc được `.ts`). Dùng chung CommonJS với `apps/api` để interop an toàn; `apps/web` (Vite) vẫn tiêu thụ được CommonJS bình thường.
**Ảnh hưởng**: Mọi package mới trong `packages/` phải build ra `dist/` trước khi được `apps/*` import ở runtime — không import thẳng `src/*.ts` từ ngoài package.

## 005 — `created_by`/`updated_by` là cột UUID thuần, không khai báo `@relation` FK

**Ngày**: 2026-08-07
**Quyết định**: Mọi bảng có `created_by`/`updated_by` (uuid NOT NULL) nhưng **không** ràng buộc khoá ngoại tới `user_account` ở tầng Prisma/DB.
**Vì sao**: `tenant` là bảng gốc — bản ghi `tenant` đầu tiên cần một `created_by`, nhưng `user_account` đầu tiên lại cần `tenant_id` trỏ tới `tenant` đó. Nếu ép FK cả hai chiều sẽ không insert được bản ghi khởi tạo nào (vòng phụ thuộc). Không ràng buộc FK cho cột audit actor cũng là cách làm phổ biến (giữ được giá trị lịch sử kể cả khi tài khoản bị gộp/xoá sau này).
**Ảnh hưởng**: Tính toàn vẹn của `created_by`/`updated_by` phải đảm bảo ở tầng service, không phải DB constraint.

## 006 — `id` dùng `gen_random_uuid()` (UUID v4), chưa phải UUID v7 như `data-model.md` yêu cầu

**Ngày**: 2026-08-07
**Quyết định**: Tạm dùng `DEFAULT gen_random_uuid()` (hàm dựng sẵn từ PostgreSQL 13+, không cần extension) cho mọi cột `id`.
**Vì sao**: `.claude/docs/data-model.md` yêu cầu "UUID v7, sinh phía DB", nhưng PostgreSQL 16 (bản đã chốt trong `CLAUDE.md`) **không có hàm sinh UUID v7 built-in** (chỉ có từ PG 18). Muốn đúng UUID v7 cần cài extension ngoài (`pg_uuidv7`) — phải build lại Docker image Postgres cho cả local dev, CI, và on-prem sau này. Việc này chưa làm ở S1-02 để tránh chặn tiến độ nền tảng.
**Ảnh hưởng**: Index B-tree trên `id` sẽ phân mảnh hơn UUID v7 (v7 có tính chất time-ordered, insert tuần tự tốt hơn). Không ảnh hưởng tính đúng — chỉ ảnh hưởng hiệu năng ghi ở quy mô lớn. **Cần quyết định lại** trước khi có dữ liệu thật: (a) cài `pg_uuidv7` extension, hoặc (b) sinh UUID v7 ở tầng ứng dụng (`packages/core`) rồi truyền vào thay vì để DB tự sinh, hoặc (c) chấp nhận UUID v4 luôn.

## 007 — Cột thật của `audit_log`: theo `docs/ERD.md` (danh sách chi tiết), không theo câu tóm tắt trong `data-model.md`

**Ngày**: 2026-08-07
**Quyết định**: `audit_log` chỉ có: `id`, `tenant_id`, `actor_id` (nullable — cho phép sự kiện hệ thống không có actor), `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `user_agent`, `occurred_at`. **Không có** `created_at`, `created_by`, `updated_by` (ngoài `updated_at`/`deleted_at`/`version` đã được `data-model.md` nêu rõ là loại trừ).
**Vì sao**: `.claude/docs/data-model.md` có hai chỗ không khớp nhau: câu tóm tắt ("ngoại lệ duy nhất... audit_log không có `updated_at`, `deleted_at`, `version`") ngụ ý vẫn giữ `created_at`/`created_by`/`updated_by`; nhưng danh sách cột chi tiết ngay bên dưới, và toàn bộ khối `AUDIT_LOG` trong `docs/ERD.md`, đều không liệt kê ba cột đó — dùng `occurred_at` làm mốc thời gian, `actor_id` làm actor. Tôi theo danh sách chi tiết hơn (khớp giữa hai tài liệu) thay vì câu tóm tắt.
**Xác nhận**: Đã xác nhận với chủ dự án (2026-08-07) — giữ như trên. Đã sửa câu tóm tắt trong `.claude/docs/data-model.md` cho khớp với danh sách chi tiết, không còn mâu thuẫn nội bộ.

## 008 — RLS, `CHECK (version >= 1)`, thu hồi quyền `DELETE` chưa áp dụng ở S1-02

**Ngày**: 2026-08-07
**Quyết định**: Migration S1-02 chỉ tạo bảng + FK + unique index. Chưa bật Row Level Security (C1 trong `docs/ERD.md`), chưa thêm `CHECK (version >= 1)` (C6), chưa thu hồi quyền `DELETE` của app user (C9).
**Vì sao**: `docs/product/plan.md` chia rõ: RLS và tenant context thuộc **S1-03** ("Tenant context: middleware set `app.current_tenant_id`, RLS policy, unit of work"), không phải S1-02 ("Prisma schema nền"). Giữ đúng ranh giới việc theo plan đã chốt.
**Ảnh hưởng**: Trước khi có dữ liệu thật hoặc trước gate cuối Sprint 1, S1-03 **bắt buộc** phải bật RLS cho mọi bảng — nếu bỏ sót, đây là lỗ hổng cách ly tenant nghiêm trọng. Chủ dự án đã xác nhận (2026-08-07): khi làm S1-03 phải hoàn thiện đầy đủ cả ba (RLS + CHECK + thu hồi DELETE), không được để dở dang.
**Hoàn thành**: Đã làm đủ cả ba trong migration `20260807170922_tenant_context`, xác minh thật qua integration test (`apps/api/src/infrastructure/persistence/tenant-isolation.spec.ts`) — xem #010.

## 009 — Thay thế #006: nâng lên PostgreSQL 18, dùng `uuidv7()` thật thay vì `gen_random_uuid()`

**Ngày**: 2026-08-07
**Quyết định**: Nâng phiên bản Postgres đã chốt trong `CLAUDE.md` từ 16 lên **18**. Đổi `id` mọi bảng sang `DEFAULT uuidv7()` (hàm dựng sẵn trong core PostgreSQL 18, RFC 9562). Cập nhật `CLAUDE.md` (Tech Stack + Dev Commands), `docker-compose.yml`, `.github/workflows/ci.yml` sang `postgres:18`. Sinh lại migration `prisma/migrations/*_init` (an toàn vì chưa từng áp lên DB thật).
**Vì sao**: Chủ dự án chọn nâng version thay vì cài extension `pg_uuidv7` — sạch hơn, không phải build/maintain Docker image tuỳ biến cho local dev/CI/on-prem, có index insert tuần tự tốt như thiết kế ban đầu của `data-model.md` ("UUID v7, sinh phía DB").
**Ảnh hưởng**: PostgreSQL 18 mới hơn PG16 (ít track record sản xuất hơn tại thời điểm chốt), cần lưu ý khi chọn base image cho `deploy/on-prem` sau này (S4-05). Giải quyết dứt điểm #006 — không cần quyết định lại trước khi có dữ liệu thật.

## 010 — Hai role DB tách biệt: `nexamed` (migration) và `nexamed_app` (runtime)

**Ngày**: 2026-08-08
**Quyết định**: Thêm role Postgres mới `nexamed_app` (không `SUPERUSER`, không `BYPASSRLS`, không `CREATEDB`/`CREATEROLE`), chỉ có `SELECT`/`INSERT`/`UPDATE` (không `DELETE`; `audit_log` không có cả `UPDATE`). API runtime (`DATABASE_URL`) kết nối bằng role này. Role cũ `nexamed` (superuser, tạo bởi `POSTGRES_USER` của image Postgres) chỉ dùng để chạy migration, qua biến `MIGRATE_DATABASE_URL` mới và script `apps/api/scripts/with-migrate-url.mjs`.
**Vì sao**: Phát hiện khi thật sự thử nghiệm RLS — role `nexamed` là **superuser**, và superuser **luôn bypass RLS bất kể policy**, kể cả khi RLS đã "bật" đúng cú pháp. Nếu API runtime tiếp tục dùng role `nexamed` như ở S1-02, mọi policy RLS viết ra sẽ vô tác dụng một cách âm thầm — không có cách nào phát hiện qua đọc code, chỉ lộ ra khi test thật trên DB thật. Đây là lý do S1-07 (test cách ly tenant trên Postgres thật) quan trọng hơn review code.
**Ảnh hưởng**: Mọi migration mới tạo bảng phải nằm trong phạm vi `ALTER DEFAULT PRIVILEGES` đã set (tự động cấp SELECT/INSERT/UPDATE cho `nexamed_app`) — nếu bảng cần hành vi khác (ví dụ bảng append-only như `audit_log` cần thu hồi thêm `UPDATE`), phải tự thêm REVOKE trong chính migration đó. Mật khẩu `nexamed_app` hiện hard-code trong migration (`'nexamed_app'`) — chỉ dùng được cho local dev/CI; khi triển khai on-prem thật (S4-05) **bắt buộc** đổi bằng `ALTER ROLE ... PASSWORD` ngoài version control, không dùng giá trị trong migration.

## 011 — `tenant` không bật Row Level Security

**Ngày**: 2026-08-08
**Quyết định**: RLS chỉ áp cho 6 bảng có cột `tenant_id` (`tenant_setting`, `room`, `user_account`, `user_role`, `code_sequence`, `audit_log`). Bảng `tenant` không có policy nào.
**Vì sao**: `.claude/docs/multi-tenancy.md` ràng buộc 2 nói "Bật RLS cho tất cả bảng có `tenant_id`" — `tenant` không có cột này (nó là gốc của tenant, không tự tham chiếu chính mình, xem #005/`data-model.md`). Ngoài ra `system_admin` cần thấy được nhiều/mọi tenant (`.claude/docs/security-audit.md`), nên hạn chế mỗi phiên chỉ thấy một `tenant` bằng RLS sẽ mâu thuẫn với vai trò đó.
**Ảnh hưởng**: Việc ai được xem/sửa bản ghi `tenant` nào phải kiểm ở tầng service/guard theo vai trò (`clinic_admin` chỉ sửa tenant của mình, `system_admin` xem được nhiều tenant) — không có lớp phòng thủ RLS ở tầng DB cho riêng bảng này. Cần nhớ khi viết module `clinic`/`tenant` (chưa tới lượt).

## 012 — Tenant context tạm thời đọc từ header, chưa qua JWT

**Ngày**: 2026-08-08
**Quyết định**: `TenantContextMiddleware` (`apps/api/src/common`) đọc `tenantId`/`actorId` từ header `x-tenant-id`/`x-actor-id` thay vì claim JWT đã xác thực.
**Vì sao**: S1-04 (auth/JWT) chưa làm, nhưng S1-03 cần middleware "set `app.current_tenant_id`" tồn tại và test được ngay theo `docs/product/plan.md`. Tách nguồn dữ liệu (header tạm) khỏi cơ chế (`AsyncLocalStorage` + `UnitOfWorkService`) để S1-04 chỉ cần đổi *nguồn đọc*, không đổi middleware hay unit-of-work.
**Ảnh hưởng**: **Không được dùng cơ chế này khi có endpoint thật nhận traffic ngoài** — bất kỳ client nào cũng tự set header tuỳ ý, không có xác thực, giả mạo tenant khác dễ dàng. Bắt buộc thay bằng JWT claim trước khi có domain module/controller đầu tiên nhận request thật (S2). Không phải rủi ro ở S1-03 vì chưa có controller nào expose ra ngoài.

## 013 — Thay mô hình vai trò cứng bằng RBAC + Data Scope (4 mức, không có `branch`)

**Ngày**: 2026-08-08
**Quyết định**: Theo yêu cầu chủ dự án (tài liệu `PhanQuyen.md`), thay `user_role.role` (enum `UserRoleName` cứng) bằng mô hình RBAC + Data Scope: bảng `role` (theo tenant), `permission` (toàn hệ thống), `role_permission` (ma trận `role × permission → data_scope`), `department` (phục vụ scope `department`). `data_scope` chỉ có **4 mức**: `none`/`personal`/`department`/`global` — **không có mức `branch`**. Áp dụng đầy đủ ngay ở v1 (không phải bản rút gọn), thay thế hoàn toàn mô tả "5 vai trò cố định" trong `security-audit.md`/`PRD` v1.0.
**Vì sao**: Chủ dự án xác nhận muốn mô hình phân quyền cấu hình được (không hardcode) làm nền tảng lâu dài, chấp nhận tăng chi phí S1-04 (xem #016). Bỏ `branch`: PRD (Q6, mục 10) đã hoãn đa chi nhánh cho v1 — phòng khám 1-3 bác sĩ, 1 địa điểm, thêm scope `branch` bây giờ là dựng abstraction cho tình huống chưa xảy ra (trái nguyên tắc trong `CLAUDE.md`). Giữ `department`: dù v1 hầu hết không dùng, khái niệm "khoa/phòng trong 1 phòng khám" thực tế hơn "chi nhánh" — có thể cần sớm hơn (ví dụ tách khám nội/ngoại) nên giữ lại, khác với `branch` (chắc chắn chưa cần).
**Ảnh hưởng**: Migration `20260807090207_init`/`20260807170922_tenant_context` (đã áp thật) giữ nguyên (forward-only, không sửa) — thêm migration mới thay đổi cấu trúc `user_role`, xoá enum `UserRoleName`. Cập nhật đồng bộ: `security-audit.md`, `data-model.md`, `docs/ERD.md`, `docs/product/prd.md` (ADM-06, ADM-07, R10), `docs/product/plan.md` (S1-04b, S1-04c, sprint 1 tăng lên 40 dev-day).

## 014 — Break-glass xác thực bằng mật khẩu đăng nhập, không thêm PIN riêng

**Ngày**: 2026-08-08
**Quyết định**: Endpoint break-glass yêu cầu nhập lại mật khẩu tài khoản hiện tại (verify Argon2id, không tạo bí mật mới) + lý do bắt buộc.
**Vì sao**: Chủ dự án chọn phương án này thay vì PIN riêng — tránh thêm một hệ thống bí mật/màn hình đặt PIN mới, giảm việc cần làm mà vẫn đạt mục đích xác nhận chính chủ trước khi vượt quyền.
**Ảnh hưởng**: Không cần cột/bảng lưu PIN. Endpoint break-glass phải áp rate-limit riêng (giống endpoint login) để tránh dò mật khẩu qua đường này.

## 015 — Alert break-glass v1 vẫn qua `NotificationPort` no-op, chưa gửi SMS/Zalo thật

**Ngày**: 2026-08-08
**Quyết định**: Khi break-glass được dùng, hệ thống gọi `NotificationPort` (adapter no-op hiện tại — chỉ ghi log) để "báo" `clinic_admin`, **không** tích hợp SMS/Zalo/email thật ở v1.
**Vì sao**: Chủ dự án chọn giữ đúng phạm vi v1 đã chốt trong `project-structure.md` (adapter thật cho `NotificationPort` là việc của giai đoạn sau). Tài liệu `PhanQuyen.md` yêu cầu "bắn Alert ngay lập tức" nhưng đây là goal chung của ngành, không phải ràng buộc kỹ thuật bắt buộc phải làm ngay.
**Ảnh hưởng**: `clinic_admin` v1 biết có break-glass qua xem nhật ký/`audit_log`, không có thông báo đẩy thời gian thực. Ghi rõ trong PRD (ADM-06) để không hiểu nhầm là đã có alert thật.

## 016 — Sprint 1 tăng từ 34 lên 40 dev-day vì RBAC mở rộng

**Ngày**: 2026-08-08
**Quyết định**: Thêm S1-04b (RBAC schema, 3 dev-day) và S1-04c (break-glass, 3 dev-day) vào Sprint 1, giữ nguyên các việc khác. Nếu cần cắt để giữ tiến độ, cắt ADM-07 (UI cấu hình ma trận, P1) trước — không cắt S1-04b/S1-04c (P0, nền tảng an toàn dữ liệu lâm sàng).
**Vì sao**: Thay đổi #013 là mở rộng phạm vi thật, không phải chi tiết triển khai — phải phản ánh vào ước lượng thay vì âm thầm nhét vào S1-04 cũ (5 dev-day, không đủ cho cả JWT lẫn RBAC schema lẫn break-glass).
**Ảnh hưởng**: Tổng dev-day dự án tăng tương ứng; mốc tuần 8 (pilot)/tuần 12 (GA) trong PRD **chưa được tính lại** — cần chủ dự án xem lại timeline tổng nếu Sprint 1 trễ do việc thêm này.

## 017 — Thêm Tailwind CSS vào Tech Stack

**Ngày**: 2026-08-08
**Quyết định**: Tailwind CSS là giải pháp styling duy nhất cho `apps/web`. Không dùng CSS-in-JS, không viết CSS tự do ngoài hệ thống token trong `.claude/docs/ui-guidelines.md`.
**Vì sao**: `.claude/docs/ui-guidelines.md` (do chủ dự án cung cấp) viết toàn bộ bằng class Tailwind, nhưng `CLAUDE.md` v1.0 chưa từng liệt kê Tailwind trong Tech Stack — để tài liệu thiết kế giả định một công nghệ chưa chốt là mâu thuẫn tiềm ẩn. Chủ dự án xác nhận chốt luôn Tailwind.
**Ảnh hưởng**: `apps/web` cần cài `tailwindcss` + cấu hình PostCSS/Vite plugin khi bắt đầu S1-08 (web app shell) — chưa cài ở thời điểm quyết định này (S1-08 chưa tới lượt).

## 018 — `ui-guidelines.md` thắng khi mâu thuẫn với `docs/design/*.md`

**Ngày**: 2026-08-08
**Quyết định**: `.claude/docs/ui-guidelines.md` là đặc tả chi tiết, thắng khi mâu thuẫn với `docs/design/UI_GUIDELINE.md`/`AI_AVOID_RULES.md` (nguyên tắc chung). Đã phát hiện 2 mâu thuẫn cụ thể lúc quyết định: số lượng màu tối đa (`AI_AVOID_RULES.md` nói ≤5, `ui-guidelines.md` mục 2.1 định nghĩa nhiều hơn) và độ đậm shadow (`AI_AVOID_RULES.md` nói tránh shadow lớn, `ui-guidelines.md` mục 2.2 định nghĩa `shadow-lg`/`shadow-xl` cho dropdown/modal).
**Vì sao**: Chủ dự án chọn phương án này thay vì tự sửa lại 2 file hoặc để tôi tự hoà giải nội dung — `ui-guidelines.md` có hệ thống token cụ thể hơn nên dùng làm nguồn thực thi.
**Ảnh hưởng**: Đã ghi chú thứ tự ưu tiên này ngay trong `docs/design/AI_AVOID_RULES.md` để không bị hiểu nhầm khi đọc riêng file đó. Khi thực sự viết UI (S1-08 trở đi), theo đúng token/quy tắc trong `ui-guidelines.md`; các câu "Avoid" trong `AI_AVOID_RULES.md` chỉ áp dụng ở những chỗ `ui-guidelines.md` không nói tới.

## 019 — S1-04 Auth: bảng `user_session` cho refresh token rotation + reuse detection, một `JWT_SECRET` dùng chung phân biệt bằng claim `typ`

**Ngày**: 2026-08-10
**Quyết định**: Thêm bảng `user_session` (không có trong `docs/ERD.md` trước đây) lưu refresh token đã hash (SHA-256), theo chuỗi rotation (`replaced_by_session_id`). Mỗi lần refresh: phiên cũ soft-delete (`deleted_reason='rotated'`) trỏ sang phiên mới; nếu một hash **đã bị rotate** còn bị dùng lại, coi là token rò rỉ — thu hồi (soft-delete) toàn bộ phiên của user (`reuse_detected`), không chỉ từ chối request đó. `user_account` thêm `failed_login_count`/`last_failed_login_at`/`locked_until` để khoá tạm sau 5 lần sai/15 phút. Access và refresh JWT dùng chung một `JWT_SECRET` (đã có sẵn từ S1-02), phân biệt bằng claim `typ: 'access'|'refresh'` — không thêm secret thứ hai.
**Vì sao**: Được hỏi và xác nhận với chủ dự án trước khi code (xem lịch sử hội thoại 2026-08-10) — `.claude/docs/security-audit.md` yêu cầu "refresh token... xoay vòng mỗi lần refresh", đây là cơ chế bảo mật cụ thể (rotation + phát hiện reuse) chứ không chỉ "thu hồi được toàn bộ", nên cần trạng thái phía server (bảng), không dùng được bộ đếm `token_version` đơn giản trên `user_account` (không đăng xuất được một thiết bị riêng lẻ, không phát hiện được reuse). Một `JWT_SECRET` dùng chung đơn giản hơn quản lý hai secret, tách sau vẫn được mà không đổi kiến trúc.
**Ảnh hưởng**: Migration mới (`*_auth_sessions`) thêm bảng `user_session` (đủ 8 cột bắt buộc, RLS, `CHECK(version>=1)`, index `(tenant_id,user_id,expires_at DESC) WHERE deleted_at IS NULL`) và 3 cột trên `user_account`. Đã cập nhật `.claude/docs/data-model.md`, `docs/ERD.md` (v1.2) trong cùng lúc. `SessionRepository.revokeAllForUser()` đã viết sẵn nhưng S1-04 chưa có nơi gọi cho tình huống "đổi vai trò/tenant" (an accounts management chưa tồn tại) — S2-07 sẽ gọi khi có endpoint đổi vai trò.

## 020 — Client gửi `tenantId` tường minh trong request đăng nhập

**Ngày**: 2026-08-10
**Quyết định**: `POST /api/v1/auth/login` nhận `tenantId` trong body (cùng `username`/`password`), không tự tra cứu tenant qua subdomain/slug.
**Vì sao**: `user_account.username` chỉ unique theo `(tenant_id, username)`, không unique toàn hệ thống — RLS bắt buộc biết `tenant_id` trước khi query tìm user, nên không có cách nào tra "user này thuộc tenant nào" mà không có thông tin tenant từ trước. Được hỏi và xác nhận với chủ dự án: v1 on-premise một tenant một máy chủ, web app biết sẵn tenant của mình qua cấu hình triển khai — tra cứu qua subdomain/slug là việc hợp lý hơn khi làm module `clinic`/`tenant` (S2), không phải chặn đường nâng cấp UX sau này.
**Ảnh hưởng**: `packages/shared/src/auth.ts` (`loginRequestSchema`) có field `tenantId: string().uuid()` bắt buộc. Web (S1-08/S1-09) cần biết `tenantId` của phòng khám mình trước khi gọi đăng nhập — cách truyền giá trị này vào build/deploy của `apps/web` chưa quyết định, để dành khi làm S1-08.

## 021 — S1-05 Audit log: hai cơ chế ghi khác nhau cho thao tác ghi và thao tác xem

**Ngày**: 2026-08-10
**Quyết định**: Audit cho **thao tác ghi** (login, break-glass, mọi ghi nghiệp vụ từ S2 trở đi) tiếp tục là lời gọi tường minh `writeAuditLog(tx, tenantId, {...})` bên trong transaction của service (đã dùng đúng ở S1-04/S1-04c). Audit cho **thao tác xem** dùng một interceptor thật (`AuditViewInterceptor` + decorator `@AuditView('entityType')`, cả hai ở `apps/api/src/common/`). Đồng thời dời `writeAuditLog` từ `apps/api/src/modules/iam/audit-log.helper.ts` sang `apps/api/src/infrastructure/persistence/audit-log.helper.ts`.
**Vì sao**: `.claude/docs/coding-standards.md` yêu cầu "ghi audit nằm cùng transaction với thao tác nghiệp vụ". Một NestJS interceptor chạy ở tầng HTTP không thể tham gia vào transaction Prisma mà service tự mở/đóng kín bên trong chính nó (`UnitOfWorkService.runInTenantScope` là một lời gọi callback trọn vẹn, không kéo dài ra ngoài được) — cố ép làm "interceptor ghi audit cho mọi thao tác" như cách đọc chữ nghĩa ban đầu của `docs/product/plan.md` S1-05 sẽ phải tự quản lý `BEGIN`/`COMMIT` thủ công, rủi ro rò transaction, đi ngược lý do `UnitOfWorkService` được thiết kế theo kiểu callback an toàn. Thao tác xem (GET thuần) không có transaction nghiệp vụ nào để "ghi cùng" — đây mới là chỗ interceptor an toàn và đúng việc. Dời `writeAuditLog` vì đây là hạ tầng cross-cutting mọi module domain tương lai (patient/appointment/encounter/prescription) đều cần gọi — để trong `modules/iam/` sẽ buộc các module khác import xuyên qua domain `iam`, sát ranh giới cấm "module không import trực tiếp module khác".
**Ảnh hưởng**: `.claude/docs/security-audit.md` mục Audit log đã cập nhật ghi rõ quy ước này cho S2 trở đi theo. `AuditViewInterceptor` viết + test sẵn (`audit-view.interceptor.spec.ts`, 3/3 pass) nhưng **chưa áp vào controller nào** — chưa có controller nghiệp vụ (S2). Không có migration mới, không đổi schema.

## 022 — S1-08: mở rộng login response thêm `roles`, thêm `GET /auth/me`

**Ngày**: 2026-08-11
**Quyết định**: `loginResponseSchema.user` (`packages/shared/src/auth.ts`) thêm trường `roles: UserRole[]` — đổi tên type nội bộ thành `currentUserSchema` (`{id, username, fullName, roles}`), dùng chung cho cả login response lẫn response mới `GET /api/v1/auth/me` (`@UseGuards(JwtAuthGuard)`, lần thứ hai `JwtAuthGuard` được dùng thật sau `POST /break-glass`).
**Vì sao**: Web app (S1-08) cần ẩn/hiện menu Quản trị theo vai trò đăng nhập (`clinic_admin`/`system_admin`) nhưng login response cũ không mang thông tin vai trò. Được hỏi và xác nhận với chủ dự án: thêm ngay vào login response (không hoãn lại chờ S2). `GET /auth/me` thêm riêng vì lúc web reload trang chỉ còn refresh cookie (không có `user`/`roles` trong bộ nhớ) — gọi `/auth/refresh` lấy access token mới rồi gọi `/auth/me` để khôi phục danh tính, tránh bắt đăng nhập lại mỗi lần tải lại trang. Không gộp `roles` vào response của `/auth/refresh` để giữ nguyên contract cũ (tránh sửa lại logic rotation/reuse-detection đã test kỹ ở S1-04).
**Ảnh hưởng**: `apps/api/src/modules/iam/user-account-auth.repository.ts` thêm `findRoleNamesForUser()` (đọc `user_role` + `role`, không phải guard phân quyền thật — đó vẫn là việc của S2 đọc `role_permission`/`data_scope`). `auth.service.ts` thêm `getCurrentUser()`. `auth.controller.ts` thêm route `GET /auth/me`. Không migration mới (chỉ đọc bảng `role`/`user_role` đã có từ S1-04b). Test mở rộng: `auth.spec.ts` (11/11, seed vai trò `doctor` cho user test), `auth-login-http.spec.ts` (5/5, seed vai trò `nurse`, thêm test `GET /auth/me` có/không token).

## 023 — S1-09: OpenAPI sinh từ Zod schema (`@asteasolutions/zod-to-openapi` v7 + `openapi-typescript` + `openapi-fetch`), không dùng `@nestjs/swagger`

**Ngày**: 2026-08-11
**Quyết định**: Pipeline sinh API client cho `apps/web`: (1) `apps/api/scripts/generate-openapi.ts` dựng `OpenAPIRegistry` từ chính các Zod schema đã có ở `@nexamed/shared` (không viết lại request/response theo trí nhớ), xuất `apps/api/openapi/openapi.json` (commit vào repo, không gitignore); (2) `apps/web` chạy `openapi-typescript` trên file JSON đó, sinh `apps/web/src/shared/api/openapi-schema.d.ts` (commit, có header "không sửa tay"); (3) `apps/web/src/shared/api/client.ts` dùng `openapi-fetch` (thay hẳn wrapper `fetch` tự viết ở S1-08) — vẫn giữ nguyên việc bóc envelope `{data,meta}`/`{error}` và class `ApiError` theo `.claude/docs/architecture.md`. Dùng `@asteasolutions/zod-to-openapi` bản `^7.3.0`, không phải bản mới nhất (`^9.x`) — bản 9 yêu cầu peer `zod@^4`, dự án đang ghim `zod@^3.23.8` (bản 7 hỗ trợ zod v3, không có cảnh báo peer dependency).
**Vì sao**: Hệ thống validate bằng `schema.parse(body)` ngay trong controller (Zod), không dùng DTO class + `class-validator` — `@nestjs/swagger` (scan decorator trên class) không có chỗ bám nếu dùng theo cách thông thường. Xây `OpenAPIRegistry` thủ công từ Zod schema là cách chuẩn của hệ sinh thái Zod-first, giữ đúng nguyên tắc "quy tắc nghiệp vụ khai báo một chỗ trong `packages/shared`" (`.claude/docs/coding-standards.md`) — không có schema thứ hai nào phải đồng bộ tay. Commit cả `openapi.json` lẫn file `.d.ts` sinh ra (thay vì gitignore + sinh lúc build) vì `apps/web` phải build được độc lập, không phụ thuộc `apps/api` đang chạy hay đã build trước trong CI.
**Ảnh hưởng**: Đổi contract của bất kỳ endpoint nào trong 5 endpoint hiện có (`/auth/login|refresh|logout|me`, `/break-glass`) phải chạy lại `pnpm --filter @nexamed/api run openapi:generate` rồi `pnpm --filter @nexamed/web run api:codegen` — không tự sửa tay file `openapi.json`/`openapi-schema.d.ts`. `packages/shared/src/auth.ts` thêm `refreshResponseSchema`/`logoutResponseSchema` (trước đây `/auth/refresh`/`/auth/logout` trả object ad-hoc không có schema Zod tương ứng) để có nguồn cho registry. `auth.api.ts` đổi chữ ký `getMe()` (bỏ tham số `accessToken` — client tự đính token qua middleware, xem `client.ts`). Thêm `apps/web/src/shared/api/query-keys.ts` — factory cache key `[tenantId, domain, ...]` theo đúng quy ước `.claude/docs/architecture.md`, sẵn sàng cho các hook `useQuery` của module `patient`/`appointment` ở S2 (S1-09 chưa có server entity data thật để dùng, auth là session state theo quyết định đã có ở S1-08).

## 024 — S2-01: vá lệch `docs/ERD.md` ↔ `.claude/docs/data-model.md` cho bảng `patient` — thêm `address_json`, `identity_verified_at`

**Ngày**: 2026-08-11
**Quyết định**: Bảng `patient` có thêm 2 cột mà sơ đồ mermaid ở `docs/ERD.md` không vẽ nhưng mô tả chi tiết ở `.claude/docs/data-model.md` đã liệt kê từ trước: `address_json jsonb NULL` (địa chỉ) và `identity_verified_at timestamptz NULL` (đi cùng `global_patient_ref`, chuẩn bị cho hồ sơ dùng chung liên tenant ở v3+). Đã sửa `docs/ERD.md` (mermaid + bảng 3.2 + chú thích) khớp lại, đồng thời sửa "v2+" thành "v3+" cho đúng với cách gọi ở `.claude/docs/multi-tenancy.md` và `docs/product/prd.md` Appendix A.
**Vì sao**: Được hỏi và xác nhận với chủ dự án trước khi viết migration (theo `CLAUDE.md` — cấu trúc đã chốt lệch nhau giữa hai tài liệu thì dừng lại hỏi, không tự chọn rồi báo sau). `address_json`: PRD PAT-01 (P0) yêu cầu rõ "tạo hồ sơ bệnh nhân... địa chỉ" — không có cột này thì không hiện thực được yêu cầu P0. `identity_verified_at`: giữ cùng cặp với `global_patient_ref` (đã có sẵn trong ERD) vì cùng một mục đích chuẩn bị hạ tầng `PatientIdentityPort`/master patient index, tách rời hai cột trong cùng một tính năng tương lai không có lý do rõ ràng.
**Ảnh hưởng**: `Patient` model trong `apps/api/prisma/schema.prisma` (migration S2-01) có đủ hai cột trên, luôn `NULL` ở v1. Không ảnh hưởng logic nghiệp vụ v1 nào khác — `identity_verified_at` chưa có code nào đọc/ghi tới khi thật sự làm liên-tenant.

## 025 — S2-01: kiến trúc `PermissionGuard` — `IamModule` chuyển thành `@Global()`, `personal`/`department` coi tương đương `global` cho bảng không có "chủ sở hữu"

**Ngày**: 2026-08-11
**Quyết định**: Hai quyết định kỹ thuật khi hiện thực `PermissionGuard` (guard `data_scope` treo từ Sprint 1, xem `docs/TASK.md`):
1. `apps/api/src/modules/iam/iam.module.ts` thêm `@Global()`. `PermissionGuard` (đặt ở `CommonModule`, cũng `@Global()`) inject `BreakGlassService` (provider của `IamModule`) — ban đầu thử cách "`CommonModule.imports: [IamModule]`" (giống cách `JwtAuthGuard` dùng `JwtModule.register({})` riêng của từng module tiêu thụ) nhưng gặp lỗi DI thật lúc chạy test đầu tiên (`patient-http.spec.ts`): NestJS resolve dependency của một provider `@Global()` theo context của module ĐANG DÙNG guard đó (ví dụ `PatientModule` gọi `@UseGuards(PermissionGuard)`), không phải theo context của module định nghĩa guard (`CommonModule`) — nên `BreakGlassService` phải tự nó `@Global()` mới resolve được từ bất kỳ module nghiệp vụ nào, không chỉ "chảy qua" import của `CommonModule`.
2. `data_scope` `personal`/`department` không có ngữ nghĩa lọc cụ thể cho bảng `patient` — `.claude/docs/security-audit.md` chỉ định nghĩa "chủ sở hữu" cho `encounter`/`vital_sign`/`clinical_note` (qua `doctor_id`), không nhắc tới `patient`. Guard coi mọi scope khác `none` (`personal`/`department`/`global`) là "cho qua, không lọc thêm" cho riêng các bảng như vậy — ghi rõ giới hạn này trong code + tài liệu thay vì tự bịa một quy tắc lọc cho `patient` (ví dụ lọc theo người tạo) mà PRD/security-audit.md không yêu cầu.
**Vì sao**: #1 là phát hiện thật qua lỗi khi chạy test, không phải quyết định trước — ghi lại để module domain tiếp theo (appointment/encounter/prescription ở S2-05 trở đi) không lặp lại cùng lỗi khi cũng cần `PermissionGuard`. #2 tránh dựng abstraction cho tình huống chưa xảy ra (`CLAUDE.md`): ma trận mặc định (`packages/core/src/rbac/permissions.ts`) chỉ dùng `global`/không-cấp cho `patient.*`, nên giới hạn "không lọc theo personal/department" chưa có tác động thật — chỉ đáng lo nếu `clinic_admin` tự cấu hình vai trò tuỳ biến gán `personal`/`department` cho `patient.*` qua ADM-07 (P1, chưa hiện thực).
**Ảnh hưởng**: Mọi module domain mới từ S2 trở đi dùng `PermissionGuard` qua `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission(module, action, { entityIdParam? })` mà không cần tự `imports: [IamModule]` trong module của mình (đã global). Khi làm `encounter`/`vital_sign`/`clinical_note` (S3, có khái niệm chủ sở hữu thật qua `doctor_id`) — **phải** tự lọc theo `req.dataScope` ở tầng repository, không thể tái dùng nguyên trạng cách "coi personal/department như global" của `patient`.