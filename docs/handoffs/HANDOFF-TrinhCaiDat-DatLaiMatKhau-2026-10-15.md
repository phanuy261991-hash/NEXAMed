# HANDOFF — Trình cài đặt/nâng cấp dùng chung XONG (kiểm Docker thật), bỏ `install.*` cũ, thêm lệnh đặt lại mật khẩu quản trị — 2026-10-15

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`** (không nhánh/PR) và CHỈ khi chủ dự án bảo. **KHÔNG dựng gói on-prem liên tục** — chỉ dựng khi chủ dự án nói sắp giao khách hoặc cho phép rõ (phiên này được phép một lần để kiểm chứng). Mockup mới phải được "duyệt"/"chốt mockup" rõ ràng trước khi code. Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh. File này tiếp nối `HANDOFF-Dot4-SaaS-TrinhCaiDat-2026-10-15.md` (giờ là lịch sử: mục 2 của nó — trình cài đặt — đã xong).

## 0. Trạng thái một câu

Trình cài đặt/nâng cấp (`apps/setup`, lệnh `nexamed-setup`) đã code xong phần chính, đã kiểm chứng bằng Docker thật + Chrome (cài LAN, cài SaaS, nâng cấp, quay lui, tự quay lui khi lỗi, chạy `nexamed-setup.sh` trong container Linux từ gói dựng thật); hai script cũ `install.ps1/.cmd/.sh` đã BỎ; `docs/Deploy.md` mục 2.3/2.3b viết lại; thêm lệnh `db:reset-admin-password`. Đã commit + push `master` (xem `git log`). Việc làm tiếp: các mục chưa kiểm chứng ở mục 3 và quyết định ở mục 4.

## 1. Đã làm (chi tiết ở `docs/DECISIONS.md` #238 + phần bổ sung)

- **`apps/setup`** (Node thuần, giao diện tĩnh `public/`, chạy trong container `nexamed-setup` điều khiển Docker qua docker.sock): máy chủ HTTP (mã `?key=` → cookie, kiểm Host chống DNS rebinding, JSON-only, giới hạn 512 KB); `service.ts` (điều phối, giữ trạng thái trong bộ nhớ); `lib/`: `profiles` (sinh `.env`/`config.json`/Caddyfile cho 3 kiểu LAN/VPS/SaaS + `validateAnswers`), `install` (6–7 bước có trạng thái, nút Thử lại tiếp tục từ bước lỗi), `upgrade` (sao lưu `pg_dump -Fc` → nạp ảnh → đổi `NEXAMED_VERSION` → `compose up -d` → kiểm tra phiên bản đúng JSON; lỗi thì tự khôi phục: drop/create DB + `pg_restore`; nút "Quay lui về bản cũ"), `cert` (kiểm chứng chỉ wildcard bằng `node:crypto`), `dns`, `docker` (bọc CLI, không đặt `-p`), `handoff` (file .txt bàn giao, không chứa khoá hệ thống), `job`, `package-files`, `validators`, `secrets`, `totp`, `qr`, `env-file`, `shell`. Giao diện: 7 bước + OTP (SaaS) + màn nâng cấp, bám mockup v2 (lệch đã ghi ở #238).
- **Đóng gói**: `apps/setup/Dockerfile`; `deploy/on-prem/docker-compose.yml` thêm `caddy` (profile `https`), `WEB_BIND_IP`, `DEPLOYMENT_MODE`/`PLATFORM_*`, `ENCRYPTION_KEY` cho `migrate`; script `nexamed-setup.cmd/.ps1/.sh`; `build-and-export.ps1` đóng thêm ảnh `nexamed-setup`, `third-party-postgres`, `third-party-caddy`; `.env.example` thêm khoá mới; `eslint.config.js` khai biến trình duyệt cho `apps/setup/public`.
- **Bỏ `install.ps1/.cmd/.sh`** (chủ dự án quyết). Mất khả năng cài không tương tác bằng tham số dòng lệnh — chưa có nhu cầu.
- **Hai script seed** (`seed-pilot-tenant.ts`, `seed-platform-operator.ts`) in thêm dòng `NEXAMED_RESULT {json}`; operator nhận `OPERATOR_TOTP_SECRET`.
- **`config.json.apiBaseUrl` luôn để TRỐNG** ở cả 3 kiểu (cùng nguồn gốc) → IP máy đổi (router không giữ IP cố định) ứng dụng vẫn chạy; bước "Thông tin" kiểu LAN có mục hướng dẫn đặt IP tĩnh (tìm dải DHCP, chọn IP ngoài dải).
- **`db:reset-admin-password`** (`apps/api/scripts/reset-admin-password.ts` + `infrastructure/persistence/reset-admin-password.ts`): khôi phục khi quản trị viên duy nhất quên mật khẩu. `docker compose run --rm -e ADMIN_USERNAME=<tên> migrate pnpm run db:reset-admin-password` (+ `NEW_PASSWORD`, `TENANT_ID` tuỳ chọn). Chạy bằng role ứng dụng trong `runInTenantScope` (không role đặc quyền), thu hồi phiên, ghi audit `user_account.password_reset` (actorId null). 6 test Postgres thật, đã kiểm đột biến.
- **Tài liệu**: `docs/Deploy.md` (2.0b, 2.1b, 2.2, 2.3 dựng gói + cài Windows/Linux + "Quên mật khẩu quản trị" + sự cố, 2.3a, 2.3b nâng cấp, 3.0 thêm "Thay chứng chỉ wildcard"), DECISIONS #238, CHANGELOG, TASK, CURRENT, CLAUDE.md, `.claude/docs/project-structure.md`.

## 2. Đã kiểm chứng thật

- 73 test `apps/setup` (đã kiểm đột biến: bỏ quay lui, bỏ kiểm khoá chứng chỉ, đưa mật khẩu lên dòng lệnh → đỏ). **Toàn bộ workspace chạy lại cuối phiên, tất cả đạt**: API 1486 (92 file), core 434, shared 31, web 103, setup 73; lint toàn repo sạch, typecheck sạch.
- Docker thật + Chrome điều khiển wizard: cài LAN (đăng nhập được bằng mật khẩu tạm), nâng cấp 9.9.9→9.9.10 (tự sao lưu), quay lui bằng nút (dữ liệu về đúng), nâng cấp lỗi (bản mới báo sai phiên bản) tự quay lui, cài SaaS với chứng chỉ wildcard thử (Caddy phục vụ đúng chứng chỉ, tên miền lạ → `TENANT_NOT_FOUND`, người vận hành đăng nhập mật khẩu + OTP do wizard sinh), tải lại trang giữa chừng vẫn nối lại, tick "đã lưu" + Hoàn tất làm container tự thoát.
- Dựng gói thật: `build-and-export.ps1 -Version 0.9.1-beta.1 -AllowUnreleased` ra gói 1,1 GB (6 ảnh + compose + script); xoá ảnh cùng phiên bản trên máy rồi chạy `nexamed-setup.sh` trong container Linux (alpine) → ảnh nạp từ `.tar.gz`, link `?key=` đúng, cài LAN xong (0.9.1-beta.1).
- **Cô lập tenant**: không đổi truy vấn dữ liệu; lệnh đặt lại mật khẩu có test tài khoản trùng tên ở công ty khác không bị đổi; SaaS giữ test cô lập đợt #237.

## 3. CHƯA kiểm chứng (đừng nói là đã xong)

1. **Let's Encrypt thật** (kiểu VPS): cần tên miền công khai + VPS thật; máy dev có cổng 80 bị dịch vụ hệ thống Windows chiếm (PID 4) nên cũng không thử được cổng 80/443 cục bộ.
2. **Linux/NAS thật** (mới thử trong container Linux), **máy Windows sạch**.
3. **Nâng cấp một hệ thống đã cài bằng script `install.*` cũ** (về lý thuyết nhận ra qua `.env`, giữ tên dự án = tên thư mục nên nhận volume cũ). Lần đầu trên máy khách đã cài cách cũ: dặn sao lưu tay trước.
4. Lệnh `docker compose run ... db:reset-admin-password` trên ảnh thật (chỉ test spec; cùng cách gọi với bước tạo phòng khám đã chạy thật).
5. Thay chứng chỉ wildcard (`certs/*` + `docker compose restart caddy`): mới viết hướng dẫn, chưa thử.

## 4. Việc treo / chờ quyết định

- **"Chế độ bảo trì"** trong trình cài đặt (thay chứng chỉ, đặt lại mật khẩu bằng giao diện): chủ dự án hỏi "có cần không" — đã tư vấn KHÔNG cần ngay (thay chứng chỉ làm tay 2 phút, đặt lại mật khẩu đã có lệnh). Chờ chốt.
- Tên máy (`http://TEN-MAY`): chủ dự án quyết KHÔNG làm.
- Nút "Cập nhật ngay" trong ứng dụng vẫn tắt (không tự bật được trình cài đặt — cần tiến trình nền, chờ chủ dự án).
- SaaS tự gia hạn chứng chỉ (Caddy xin riêng từng tên miền phụ, hoặc API DNS) — phụ thuộc nhà cung cấp tên miền/máy chủ trong nước, **chưa chọn, chưa lập bảng so sánh** (việc nợ chặn gói SaaS thật).
- Khu quản trị: menu "Tài khoản vận hành" (hiện tạo bằng script), nhật ký chưa phân trang, phiên không refresh, chưa chống dùng lại OTP trong 30 giây; bước 3 cập nhật phần mềm (máy chủ phát hành); CSP Report-Only; S6-02/S6-04; BHYT (S2-04). Chủ dự án bảo BỎ QUA việc bật chi nhánh 2 ở khách thật.
- Dọn tay (không phải của dự án): 5 container dừng `package-*` + `modest_leakey` từ các lần thử cũ trên máy dev (`docker rm ...`), volume `package_*` chưa xoá vì chưa chắc có dữ liệu cần giữ.

## 5. Điều cần biết / bẫy

- **Dựng gói**: chạy từ `deploy\on-prem` bằng PowerShell/Command Prompt (KHÔNG Git Bash), `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-and-export.ps1 -Version X.Y.Z -PackageDir <ngoài repo>`; bản giao khách cần `node scripts/release.mjs` (tag + cây sạch), dựng thử dùng `-AllowUnreleased`. Docker 29.8.2 + Compose v5.6.0 trên máy dev.
- **Compose chạy từ trong container chỉ nhận đường dẫn máy dạng `/c/Users/...`** (dạng `C:\...` bị hiểu thành đường dẫn tương đối) — script Windows và `backupDirForCompose` tự đổi. KHÔNG đặt `-p` cho compose (tên dự án = tên thư mục như các lần cài cũ).
- **Công cụ**: máy không có Python. **Heredoc/`node -e` qua công cụ Bash làm mất một nửa dấu `\` và hỏng chuỗi có `\n`/backtick** — sửa file có dấu gạch ngược bằng công cụ Edit/Write (hoặc viết file `.cjs` bằng Write rồi chạy). Tài liệu `docs/*.md`, `docker-compose.yml`, `.env.example` dùng CRLF (script vá phải đọc, đổi `\r\n`→`\n`, sửa, ghi lại đúng kiểu). `docs/CURRENT.md` (380 KB) và `docs/DECISIONS.md` quá lớn để Read cả file — dùng offset/limit hoặc Grep. `build-and-export.ps1` có BOM UTF-8.
- **Cách kiểm Docker thật cho trình cài đặt** (script ở scratchpad sẽ mất): dựng ảnh thử `nexamed-setup/api/web:<số thử>` bằng `docker build` (cache nhanh), tag `nexamed-backup` từ bản sẵn có, tạo thư mục thử với `docker-compose.yml`, `.env.example`, `nexamed-setup.*` và file giả `images/nexamed-*-<số>.tar.gz`, chạy `nexamed-setup.ps1 -NoBrowser -Port 8091`, điều khiển wizard bằng `playwright-core@1.49.1` + Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe` (ô nhập có id `f_<tên>`, nút theo chữ). Kiểu SaaS thử cục bộ: sửa cổng Caddy trong compose của thư mục thử sang 8880/8443, dùng chứng chỉ thử `apps/setup/src/testing/cert1.pem`+`key1.pem` (bao `example.test`, `*.example.test`) và `curl --resolve admin.example.test:8443:127.0.0.1 -k`. Xong dọn: `docker compose -p <tên> down -v`, `docker rmi` ảnh thử. KHÔNG đụng DB dev (cổng 5433) và container `nexamed-postgres-1`.
- **Dòng `.sh` phải là LF**: máy Windows có `core.autocrlf=true` sẽ đổi `nexamed-setup.sh` thành CRLF khi checkout, gói dựng từ đó chạy hỏng trên Linux. Đã thêm `.gitattributes` (`*.sh text eol=lf`) và bit thực thi cho file này; nếu dựng gói từ bản checkout cũ, kiểm `file nexamed-setup.sh` không có "CRLF".
- `apps/setup/src/testing/key1.pem` là khoá giả chỉ cho test (một khoá riêng + 3 chứng chỉ công khai) — công cụ quét bí mật nếu báo thì bỏ qua.
- `apps/web` chỉ import KIỂU từ `@nexamed/shared`; `@nexamed/shared`/`core` phải `pnpm --filter … build` trước khi chạy test/typecheck API. Test API ~8 phút, không chạy Chrome/Docker song song.
- **Sai lầm đã mắc phiên này (đừng lặp)**: trả lời câu hỏi của chủ dự án bằng hành động (sửa code) mà quên trả lời bằng chữ — phải trả lời thẳng câu hỏi trước; nói "3 file khoá" trong khi chỉ có 1 khoá riêng (nói sai khi chưa kiểm).

## 6. Tài liệu/memory đã cập nhật phiên này

`docs/DECISIONS.md` #238 (tiến độ + bổ sung đặt lại mật khẩu), `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/CURRENT.md`, `docs/Deploy.md`, `CLAUDE.md`, `.claude/docs/project-structure.md`. Memory: `project_installer_wizard_mockup.md` (đã xong), dòng bàn giao trong `MEMORY.md`.
