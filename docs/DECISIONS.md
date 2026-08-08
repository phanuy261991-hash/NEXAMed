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