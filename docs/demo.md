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
3. Bật PostgreSQL:
   ```bash
   docker compose up -d
   ```
   Container map ra cổng **5433**, không phải 5432 mặc định (máy dev có thể có sẵn Postgres native chiếm 5432 — xem ghi chú trong `docker-compose.yml` và `docs/DECISIONS.md`). Không cần đổi gì nếu dùng đúng `.env.example`.
4. Migrate + seed database:
   ```bash
   pnpm db:migrate
   ```
   Seed permission/role hiện chạy riêng qua `pnpm --filter @nexamed/api run db:seed` (script gọi `prisma/seed/index.ts`) — chưa gộp vào `db:migrate`.
5. Chạy song song web + api:
   ```bash
   pnpm dev
   ```
   - API: http://localhost:3000
   - Web: http://localhost:5173

## Trạng thái giao diện hiện tại

Cập nhật tới thời điểm viết (xem `docs/CURRENT.md` để biết trạng thái mới nhất — mục này có thể lạc hậu nếu sprint đã tiến thêm):

- `apps/web` mới chỉ có bootstrap tối thiểu (`App.tsx` render một dòng chữ tĩnh) — **chưa có** router, layout, luồng đăng nhập, design token, hay bất kỳ màn hình nghiệp vụ nào (những việc này thuộc S1-08, chưa làm).
- API chưa có domain module/controller nào nhận traffic thật; tenant context hiện đọc tạm từ header, chưa qua JWT (`docs/DECISIONS.md` #012) — chưa có gì để gọi từ giao diện dù có màn hình.
- Vì vậy `pnpm dev` lúc này chỉ xác nhận môi trường chạy được, **chưa dùng để demo giao diện nghiệp vụ**. Mục này phải cập nhật ngay khi S1-08 (app shell) hoàn thành.

## Khi đã có màn hình thật để demo (từ S1-08 trở đi — bổ sung khi tới lúc)

- Đăng nhập bằng tài khoản seed đúng vai trò (`receptionist`/`nurse`/`doctor`/`clinic_admin`/`system_admin`) — không tắt guard bằng biến môi trường (`.claude/docs/security-audit.md`).
- Cách seed dữ liệu mẫu (bệnh nhân, lịch hẹn...) để demo có nội dung, không demo trên DB rỗng.
- Cách reset lại DB dev về trạng thái sạch giữa các lần demo.

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| API crash lúc khởi động | Thiếu `DATABASE_URL`/`JWT_SECRET`/`ENCRYPTION_KEY` trong `apps/api/.env` | Copy lại từ `.env.example`, không xoá biến nào |
| Không kết nối được Postgres ở cổng 5432 | Container map ra 5433, không phải 5432 | Dùng đúng `.env.example` (đã trỏ 5433); nếu đổi máy dev không xung đột cổng, có thể đổi lại 5432 trong `docker-compose.yml` |
| pnpm cảnh báo Node version | Máy dev chạy Node khác 20 LTS | Chỉ warning, không chặn dev; dùng đúng Node 20 khi đóng gói triển khai |
| `pnpm dev` chạy nhưng web chỉ hiện chữ trống | Đúng như mô tả — `apps/web` chưa có màn hình nghiệp vụ | Không phải lỗi, xem mục "Trạng thái giao diện hiện tại" ở trên |

## Cập nhật tài liệu này

Cập nhật mỗi khi có màn hình mới đáng demo, có tài khoản/dữ liệu seed mới, hoặc cách chạy thay đổi. Không để tài liệu mô tả giao diện không còn khớp với code thật — nếu phát hiện lệch, sửa ngay trong cùng lúc phát hiện.
