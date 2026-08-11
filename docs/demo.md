# Demo — Xem giao diện trong quá trình phát triển

Hướng dẫn chạy NEXAMed ở máy dev để xem/thử giao diện trong lúc phát triển. Đây **không phải** hướng dẫn triển khai — xem `docs/Deploy.md` cho on-premise/cloud.

## Yêu cầu môi trường

- Node **20.x LTS** (`package.json` → `engines.node`). Máy dev hiện tại có thể chạy bản khác (xem ghi chú trong `docs/CURRENT.md`) — chỉ cảnh báo, chưa chặn chạy, nhưng nên dùng đúng 20 LTS khi có thể.
- pnpm 9 (`packageManager: pnpm@9.15.9` trong `package.json`). Không dùng npm/yarn.
- Docker Desktop (chạy PostgreSQL qua `docker-compose.yml`).

## Các bước chạy

1. Cài dependency toàn workspace:
   ```bash
   pnpm install
   ```
2. Tạo file env cho API: copy `apps/api/.env.example` → `apps/api/.env`. Giá trị mẫu dùng được thẳng cho dev/local (không dùng cho production — xem `docs/Deploy.md`).
3. Tạo file cấu hình runtime cho web — **chỉ làm nếu chưa có** `apps/web/public/config.json` (copy đè lên file đã điền `tenantId` thật sẽ làm mất cấu hình, gây lỗi đăng nhập "sai thông tin" dù đúng mật khẩu — vì `tenantId` sai): copy `apps/web/public/config.example.json` → `apps/web/public/config.json`. `tenantId` điền ở bước 6.
4. Bật PostgreSQL:
   ```bash
   docker compose up -d
   ```
   Container map ra cổng **5433**, không phải 5432 mặc định (máy dev có thể có sẵn Postgres native chiếm 5432 — xem ghi chú trong `docker-compose.yml` và `docs/DECISIONS.md`). Không cần đổi gì nếu dùng đúng `.env.example`.
5. Migrate + seed database:
   ```bash
   pnpm db:migrate
   pnpm --filter @nexamed/api run db:seed
   ```
   `db:seed` seed danh mục `permission` toàn hệ thống (23 permission) — chạy riêng, chưa gộp vào `db:migrate`.
6. **Tạo tenant + tài khoản đăng nhập thử** (chưa có màn hình "tạo phòng khám mới" — đó là module `clinic` ở S2, chưa làm):
   ```bash
   pnpm --filter @nexamed/api run db:seed:dev-tenant
   ```
   Script in ra `tenantId`, `username` (`dev.admin`), `password` (`Dev@12345`) — vai trò `clinic_admin`. Dán `tenantId` vào `apps/web/public/config.json` (đè lên giá trị mẫu ở bước 3). Chạy lại script này bất cứ lúc nào để tạo thêm tenant/tài khoản khác (mỗi lần chạy tạo một tenant mới, không dùng chung).
7. Chạy song song web + api:
   ```bash
   pnpm dev
   ```
   - API: http://localhost:3000
   - Web: http://localhost:5173 — vào thẳng sẽ tự chuyển tới `/login`; đăng nhập bằng tài khoản ở bước 6.

## Trạng thái giao diện hiện tại

Cập nhật tới thời điểm viết (xem `docs/CURRENT.md` để biết trạng thái mới nhất — mục này có thể lạc hậu nếu sprint đã tiến thêm):

- **S1-08 đã xong**: `apps/web` có app shell đầy đủ — router, luồng đăng nhập (kèm khôi phục phiên khi reload trang), layout với sidebar cố định trái, design token theo `.claude/docs/ui-guidelines.md`.
- Sau đăng nhập thấy 2 mục sidebar: **Tổng quan** (Dashboard, mọi vai trò) và **Quản trị** (chỉ `clinic_admin`/`system_admin`) — cả hai hiện dạng "chưa có dữ liệu" (empty state), vì patient/appointment/encounter/prescription và các màn hình quản trị thật (tài khoản, cấu hình, nhật ký) đều thuộc S2 trở đi, chưa làm.
- Menu Đặt lịch/Tiếp nhận/Khám bệnh/Kê đơn **chưa hiện** — chỉ hiện menu module đã có backend thật, thêm dần đúng sprint có module tương ứng.
- API client phía web hiện là bản tối giản tự viết, chỉ đủ cho luồng đăng nhập (S1-09 sẽ thay bằng client sinh từ OpenAPI + TanStack Query).

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| API crash lúc khởi động | Thiếu `DATABASE_URL`/`JWT_SECRET`/`ENCRYPTION_KEY` trong `apps/api/.env` | Copy lại từ `.env.example`, không xoá biến nào |
| Không kết nối được Postgres ở cổng 5432 | Container map ra 5433, không phải 5432 | Dùng đúng `.env.example` (đã trỏ 5433); nếu đổi máy dev không xung đột cổng, có thể đổi lại 5432 trong `docker-compose.yml` |
| pnpm cảnh báo Node version | Máy dev chạy Node khác 20 LTS | Chỉ warning, không chặn dev; dùng đúng Node 20 khi đóng gói triển khai |
| Web hiện lỗi đỏ "Không tải được /config.json" hoặc "/config.json không hợp lệ" | Chưa copy `config.example.json` → `config.json` (bước 3), hoặc `tenantId` không phải UUID hợp lệ | Copy lại file, dán đúng `tenantId` in ra ở bước 6 |
| Đăng nhập báo sai thông tin dù đúng `username`/`password` | `tenantId` trong `apps/web/public/config.json` không khớp tenant chứa tài khoản đó | Chạy `pnpm --filter @nexamed/api run db:seed:dev-tenant`, dán đúng `tenantId` mới in ra |
| Đăng nhập xong không thấy mục "Quản trị" | Tài khoản không có vai trò `clinic_admin`/`system_admin` | Bình thường nếu test tài khoản khác — `db:seed:dev-tenant` luôn tạo tài khoản vai trò `clinic_admin` |

## Cập nhật tài liệu này

Cập nhật mỗi khi có màn hình mới đáng demo, có tài khoản/dữ liệu seed mới, hoặc cách chạy thay đổi. Không để tài liệu mô tả giao diện không còn khớp với code thật — nếu phát hiện lệch, sửa ngay trong cùng lúc phát hiện.
