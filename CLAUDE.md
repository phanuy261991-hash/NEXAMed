# CLAUDE.md — NEXAMed

## Project Overview

NEXAMed là hệ thống quản lý phòng khám, kiến trúc multi-tenant (nhiều phòng khám dùng chung một instance, cách ly dữ liệu theo `tenant_id`). Hệ thống nhận yêu cầu đặt lịch qua REST API, đẩy bệnh nhân qua chuỗi trạng thái đặt lịch → tiếp nhận → khám bệnh → kê đơn, ghi mọi thay đổi dữ liệu lâm sàng vào bảng audit append-only, và xuất ra bệnh án điện tử cùng đơn thuốc in.

Monorepo: `apps/web` (SPA React), `apps/api` (NestJS), `packages/shared` (type + Zod schema dùng chung), `packages/core` (logic nghiệp vụ thuần, không phụ thuộc framework).

**Phạm vi v1 — 3 module nghiệp vụ**: Đặt lịch, Tiếp nhận, Khám bệnh (bao gồm kê đơn ở mức ghi nhận và in). Dược/kho, thanh toán — viện phí, BHYT, báo cáo doanh thu **không thuộc v1**. Không viết code cho các module ngoài phạm vi.

**Triển khai**: on-premise tại từng phòng khám. Code phải viết sẵn sàng cho triển khai tập trung/cloud sau này — mọi phụ thuộc hạ tầng đi qua port/adapter, xem `.claude/docs/project-structure.md`.

## Tech Stack

- React 18.3 + Vite 5.4 + TypeScript 5.6 (strict mode)
- Tailwind CSS — styling duy nhất cho `apps/web`. Không dùng CSS-in-JS, không viết class CSS tự do ngoài hệ thống token (xem `.claude/docs/ui-guidelines.md`)
- NestJS 10.4 trên Node 20 LTS, REST + OpenAPI
- PostgreSQL 18, Prisma 5.x làm ORM/migration
- Zod (validation dùng chung web/api), TanStack Query 5 (server state), Zustand (client state)
- pnpm 9 workspaces — bắt buộc, lockfile là `pnpm-lock.yaml`. Không dùng npm/yarn.
- Vitest (unit/integration), Playwright (e2e), ESLint + Prettier
- Docker Compose cho PostgreSQL local

## Dev Commands

```bash
pnpm install                        # cài dependency toàn workspace
docker compose up -d                # PostgreSQL 18 tại localhost:5432
pnpm db:migrate                     # prisma migrate dev + seed danh mục ICD-10
pnpm dev                            # chạy song song web (5173) + api (3000)
pnpm build                          # build production cả hai app
pnpm test                           # Vitest toàn workspace
```

Trước khi chạy lần đầu: copy `.env.example` → `.env`. API không khởi động nếu thiếu `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`.

## Core Logic Summary

Hai khối logic cốt lõi của v1:

1. **Vòng đời lượt khám (encounter)** — state machine một chiều `SCHEDULED → CHECKED_IN → IN_CONSULTATION → COMPLETED`, nhánh phụ `CANCELLED` / `NO_SHOW`. Không nhảy cóc, không có đường lùi.
2. **Bút toán hồ sơ bệnh án** — dữ liệu lâm sàng đã ký là bất biến; mọi sửa đổi tạo bản amendment mới trỏ về bản gốc, bản gốc soft-delete. Không ghi đè, không xoá cứng.

Chi tiết đầy đủ và edge case xem `.claude/docs/clinical-workflow.md`.

## Key Constraints

### Quy trình làm việc

- **Trước khi bắt đầu bất kỳ công việc nào, phải đọc qua** `docs/product/prd.md`, `docs/product/plan.md`, `docs/ERD.md`, `docs/CURRENT.md`, `docs/TASK.md`, `docs/CHANGELOG.md`, `.claude/docs/ui-guidelines.md`.
- **Không tự ý thay đổi hay suy diễn cấu trúc đã chốt.** Schema, tên bảng/cột, state machine, ranh giới module, contract API trong `.claude/docs/` là đã chốt. Cần đổi thì dừng lại, nêu vấn đề và hỏi trước — không tự sửa rồi báo sau.
- Không viết code cho module ngoài phạm vi v1, kể cả khi schema đã để sẵn chỗ.
- Trước khi thêm hàm/component mới, tìm trong `packages/core` và `packages/shared` xem đã có chưa. Không tạo bản sao logic. Trùng lặp lần thứ hai là dấu hiệu phải trích xuất ra dùng chung.
- Code viết theo hướng tái sử dụng toàn hệ thống: logic nghiệp vụ thuần đặt ở `packages/core`, không nhét vào component React hay controller NestJS.
- **Viết component/hàm tiện ích ở nơi dùng chung (`packages/shared`, `packages/core`, `apps/web/src/shared`) với chủ đích tái dùng ngay từ lần viết đầu tiên**: nhận dữ liệu qua props/tham số thay vì gắn cứng chi tiết của màn hình/nghiệp vụ hiện tại, không hardcode text/logic riêng của một nơi gọi khi rõ ràng sẽ còn nơi khác cần — để tích hợp hệ thống khác sau này tái dùng được thay vì viết lại. Không mâu thuẫn với nguyên tắc "trùng lặp lần hai mới trích xuất" ở trên: quy tắc đó áp dụng cho *logic nghiệp vụ đặc thù* (chưa biết có dùng lại hay không); quy tắc này áp dụng cho *thành phần đã biết trước sẽ dùng chung* (UI primitive, hook tiện ích, adapter tích hợp). Không dựng abstraction cho tình huống hoàn toàn chưa xảy ra.
- **Trước khi thiết kế hoặc viết bất kỳ giao diện UI/UX nào, phải đọc** `.claude/docs/ui-guidelines.md` và mọi file trong `docs/design/` để nắm quy tắc thiết kế đã chốt, đảm bảo tính đồng nhất xuyên suốt sản phẩm. Nếu hai tài liệu mâu thuẫn nhau, `.claude/docs/ui-guidelines.md` (chi tiết, có hệ thống token) thắng — `docs/design/*.md` chỉ là nguyên tắc chung, không phải đặc tả. Cần điều chỉnh quy tắc hoặc có ý tưởng tốt hơn thì dừng lại hỏi trước, không tự đổi. Có quyết định thiết kế mới thì cập nhật lại đúng file liên quan trong cùng lúc, không để tài liệu lệch với thực tế.

### Cơ sở dữ liệu

- Mọi bảng nghiệp vụ **phải có đủ**: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `version`, `created_by`, `updated_by`. Thiếu một cột là migration không hợp lệ.
- Cột tiền dùng `bigint`, đơn vị đồng. **Cấm** `numeric`, `decimal`, `money`, `real`, `double precision` cho cột tiền. Làm tròn round-half-up về 1 đồng, chỉ làm tròn ở bước cuối, không làm tròn từng dòng trung gian.
- Cột thời gian dùng `timestamptz`, lưu UTC. **Cấm** `timestamp` không timezone. Quy đổi `Asia/Ho_Chi_Minh` chỉ ở tầng hiển thị; không dùng `new Date()` phía server để cắt mốc ngày.
- **Không xoá cứng dữ liệu nghiệp vụ.** Cấm `DELETE FROM` trong repository nghiệp vụ; dùng `deleted_at` + `deleted_reason`.
- **Bản ghi đã ký là bất biến**: `signed_at != null` thì không `UPDATE`. Sửa = bản ghi mới với `supersedes_id` + `amendment_reason` bắt buộc (yêu cầu lưu vết theo Thông tư 46/2018/TT-BYT).
- `version` dùng cho optimistic locking; mọi `UPDATE` phải kèm điều kiện `version = ?` và tăng lên 1.
- Migration forward-only: không sửa file migration đã merge vào `main`.

### Kiến trúc

- **Module không import trực tiếp module khác.** Giao tiếp qua interface khai báo trong `packages/core` hoặc qua event bus.
- **Không viết SQL ngoài tầng Repository.** Controller không chứa logic nghiệp vụ — chỉ validate input, gọi service, map response.
- Mọi truy vấn phải lọc `tenant_id` của phiên hiện tại ở tầng repository, không dựa vào giá trị do client gửi.
- Mọi phụ thuộc hạ tầng (lưu file, gửi tin nhắn, ký số, cổng BHYT) đi qua port trong `packages/core/ports`, adapter đặt ở `apps/api/src/infrastructure`. Không gọi thẳng SDK bên thứ ba từ service.
- `packages/shared` và `packages/core` không import từ `apps/*` (phụ thuộc một chiều).

### Dữ liệu và bảo mật

- Mã bệnh dùng chuẩn **ICD-10** (danh mục BYT, seed sẵn, read-only runtime). Không tự sinh, tự map, tự đoán mã; không cho nhập mã tự do.
- **Không log PII/PHI** (họ tên, CCCD, số thẻ BHYT, chẩn đoán) ra console, file log hay hệ thống giám sát. Chỉ log ID dạng UUID.
- Mã hiển thị (`patient_code`, `encounter_no`) sinh từ sequence DB theo tenant. Không sinh phía client, không dùng `Math.random()` hay timestamp.
- **Chữ ký số chưa triển khai ở v1**: dùng chữ ký logic (`signed_at`, `signed_by`). Cột và port đã để sẵn — không tự ý cài đặt tích hợp CA.

## Additional Documentation

- `.claude/docs/project-structure.md` — dùng khi tạo file/thư mục mới hoặc khi cần biết code nào đặt ở đâu.
- `.claude/docs/architecture.md` — dùng khi cần biết luồng gọi giữa các tầng và ranh giới module.
- `.claude/docs/coding-standards.md` — dùng khi viết code mới: quy ước đặt tên, tái sử dụng, xử lý lỗi, test.
- `.claude/docs/multi-tenancy.md` — dùng khi viết query, guard, hoặc bất kỳ code nào chạm dữ liệu của một tenant.
- `.claude/docs/data-model.md` — dùng khi viết migration, sửa schema, thiết kế bảng mới.
- `.claude/docs/clinical-workflow.md` — dùng khi làm tính năng đặt lịch, tiếp nhận, khám bệnh, kê đơn.
- `.claude/docs/security-audit.md` — dùng khi làm phân quyền, audit log, mã hoá, xử lý dữ liệu định danh.
- `.claude/docs/ui-guidelines.md` — dùng khi thiết kế hoặc viết bất kỳ UI/UX nào ở `apps/web`: token màu, spacing, trạng thái loading/empty/error, chi tiết component, a11y. Đặc tả chi tiết, thắng nếu mâu thuẫn với `docs/design/*.md`.
- `docs/design/UI_GUIDELINE.md`, `docs/design/AI_AVOID_RULES.md` — nguyên tắc chung về phong cách thiết kế (tránh phong cách nào, cảm giác sản phẩm nên giống gì). Đọc cùng lúc với `ui-guidelines.md`.
- `docs/product/prd.md` — dùng để biết yêu cầu sản phẩm, mục tiêu, tiêu chí chấp nhận.
- `docs/product/plan.md` — dùng để biết kế hoạch theo giai đoạn/sprint, thứ tự ưu tiên.
- `docs/ERD.md` — dùng để biết sơ đồ quan hệ dữ liệu đầy đủ, ràng buộc DB, index, thứ tự tạo bảng theo sprint.
- `docs/CURRENT.md` — dùng để biết trạng thái hiện tại của dự án trước khi bắt đầu việc mới.
- `docs/TASK.md` — dùng để biết việc nào đang làm, việc nào đã xong theo phase.
- `docs/CHANGELOG.md` — dùng để tra lịch sử thay đổi; cập nhật khi hoàn thành một thay đổi đáng kể.
- `docs/DECISIONS.md` — dùng để tra quyết định kiến trúc/nghiệp vụ đã chốt ngoài phạm vi `.claude/docs/`; cập nhật khi có quyết định mới cần lưu vết.
- `docs/Hybrid Authorization.md` — định hướng kiến trúc phân quyền cho giai đoạn platform/đa module (v3+): Centralized Identity (SSO) + Module-Specific Authorization. **Chưa triển khai ở v1** — chỉ tham khảo, chủ động gợi ý khi thấy phù hợp (ví dụ khi bàn về mở rộng đa module/tenant liên hệ thống), không tự ý bắt đầu code theo hướng này.
