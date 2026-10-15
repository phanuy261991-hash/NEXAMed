# HANDOFF — Trình cài đặt/nâng cấp dùng chung XONG (kiểm Docker thật), bỏ `install.*` cũ, thêm lệnh đặt lại mật khẩu quản trị — 2026-10-15

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`** (không nhánh/PR) và CHỈ khi chủ dự án bảo. **KHÔNG dựng gói on-prem liên tục** — chỉ dựng khi chủ dự án nói sắp giao khách hoặc cho phép rõ (phiên này được phép một lần để kiểm chứng). Mockup mới phải được "duyệt"/"chốt mockup" rõ ràng trước khi code. Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh. File này tiếp nối `HANDOFF-Dot4-SaaS-TrinhCaiDat-2026-10-15.md` (giờ là lịch sử: mục 2 của nó — trình cài đặt — đã xong).

## 0. Trạng thái một câu

Trình cài đặt/nâng cấp (`apps/setup`, lệnh `nexamed-setup`) đã code xong phần chính, đã kiểm chứng bằng Docker thật + Chrome (cài LAN, cài SaaS, nâng cấp, quay lui, tự quay lui khi lỗi, chạy `nexamed-setup.sh` trong container Linux từ gói dựng thật); hai script cũ `install.ps1/.cmd/.sh` đã BỎ; `docs/Deploy.md` mục 2.3/2.3b viết lại; thêm lệnh `db:reset-admin-password`. Đã commit + push `master`: `ed814dc` (trình cài đặt + đặt lại mật khẩu), `5543a00` (ép LF cho `.sh`), `5814f2a` (file `VERSION` của gói + quay lui về bản trước 0.9 + kiểm chứng nâng cấp từ hệ thống cài bằng script cũ và `db:reset-admin-password` trên ảnh thật), `e5d90b7` (chốt `1.0.0` sau pilot + khung so sánh nhà cung cấp SaaS). Cây làm việc sạch lúc chuyển phiên. Việc làm tiếp: mục 7 (các giai đoạn còn lại + đề xuất bước kế tiếp).

## 1. Đã làm (chi tiết ở `docs/DECISIONS.md` #238 + phần bổ sung)

- **`apps/setup`** (Node thuần, giao diện tĩnh `public/`, chạy trong container `nexamed-setup` điều khiển Docker qua docker.sock): máy chủ HTTP (mã `?key=` → cookie, kiểm Host chống DNS rebinding, JSON-only, giới hạn 512 KB); `service.ts` (điều phối, giữ trạng thái trong bộ nhớ); `lib/`: `profiles` (sinh `.env`/`config.json`/Caddyfile cho 3 kiểu LAN/VPS/SaaS + `validateAnswers`), `install` (6–7 bước có trạng thái, nút Thử lại tiếp tục từ bước lỗi), `upgrade` (sao lưu `pg_dump -Fc` → nạp ảnh → đổi `NEXAMED_VERSION` → `compose up -d` → kiểm tra phiên bản đúng JSON; lỗi thì tự khôi phục: drop/create DB + `pg_restore`; nút "Quay lui về bản cũ"), `cert` (kiểm chứng chỉ wildcard bằng `node:crypto`), `dns`, `docker` (bọc CLI, không đặt `-p`), `handoff` (file .txt bàn giao, không chứa khoá hệ thống), `job`, `package-files`, `validators`, `secrets`, `totp`, `qr`, `env-file`, `shell`. Giao diện: 7 bước + OTP (SaaS) + màn nâng cấp, bám mockup v2 (lệch đã ghi ở #238).
- **Đóng gói**: `apps/setup/Dockerfile`; `deploy/on-prem/docker-compose.yml` thêm `caddy` (profile `https`), `WEB_BIND_IP`, `DEPLOYMENT_MODE`/`PLATFORM_*`, `ENCRYPTION_KEY` cho `migrate`; script `nexamed-setup.cmd/.ps1/.sh`; `build-and-export.ps1` đóng thêm ảnh `nexamed-setup`, `third-party-postgres`, `third-party-caddy`; `.env.example` thêm khoá mới; `eslint.config.js` khai biến trình duyệt cho `apps/setup/public`.
- **Bỏ `install.ps1/.cmd/.sh`** (chủ dự án quyết). Mất khả năng cài không tương tác bằng tham số dòng lệnh — chưa có nhu cầu.
- **Hai script seed** (`seed-pilot-tenant.ts`, `seed-platform-operator.ts`) in thêm dòng `NEXAMED_RESULT {json}`; operator nhận `OPERATOR_TOTP_SECRET`.
- **`config.json.apiBaseUrl` luôn để TRỐNG** ở cả 3 kiểu (cùng nguồn gốc) → IP máy đổi (router không giữ IP cố định) ứng dụng vẫn chạy; bước "Thông tin" kiểu LAN có mục hướng dẫn đặt IP tĩnh (tìm dải DHCP, chọn IP ngoài dải).
- **`db:reset-admin-password`** (`apps/api/scripts/reset-admin-password.ts` + `infrastructure/persistence/reset-admin-password.ts`): khôi phục khi quản trị viên duy nhất quên mật khẩu. `docker compose run --rm -e ADMIN_USERNAME=<tên> migrate pnpm run db:reset-admin-password` (+ `NEW_PASSWORD`, `TENANT_ID` tuỳ chọn). Chạy bằng role ứng dụng trong `runInTenantScope` (không role đặc quyền), thu hồi phiên, ghi audit `user_account.password_reset` (actorId null). 6 test Postgres thật, đã kiểm đột biến.
- **Tài liệu**: `docs/Deploy.md` (2.0b, 2.1b, 2.2, 2.3 dựng gói + cài Windows/Linux + "Quên mật khẩu quản trị" + sự cố, 2.3a, 2.3b nâng cấp, 3.0 thêm "Thay chứng chỉ wildcard"), DECISIONS #238, CHANGELOG, TASK, CURRENT, CLAUDE.md, `.claude/docs/project-structure.md`.

## 2. Đã kiểm chứng thật

- 73 test `apps/setup` (đã kiểm đột biến: bỏ quay lui, bỏ kiểm khoá chứng chỉ, đưa mật khẩu lên dòng lệnh → đỏ). **Toàn bộ workspace chạy lại (lần commit đầu), tất cả đạt**: API 1486 (92 file), core 434, shared 31, web 103, setup 73 (sau đó thêm 3 test, `apps/setup` = 76, chạy lại riêng đạt); lint toàn repo sạch, typecheck sạch.
- Docker thật + Chrome điều khiển wizard: cài LAN (đăng nhập được bằng mật khẩu tạm), nâng cấp 9.9.9→9.9.10 (tự sao lưu), quay lui bằng nút (dữ liệu về đúng), nâng cấp lỗi (bản mới báo sai phiên bản) tự quay lui, cài SaaS với chứng chỉ wildcard thử (Caddy phục vụ đúng chứng chỉ, tên miền lạ → `TENANT_NOT_FOUND`, người vận hành đăng nhập mật khẩu + OTP do wizard sinh), tải lại trang giữa chừng vẫn nối lại, tick "đã lưu" + Hoàn tất làm container tự thoát.
- Dựng gói thật: `build-and-export.ps1 -Version 0.9.1-beta.1 -AllowUnreleased` ra gói 1,1 GB (6 ảnh + compose + script); xoá ảnh cùng phiên bản trên máy rồi chạy `nexamed-setup.sh` trong container Linux (alpine) → ảnh nạp từ `.tar.gz`, link `?key=` đúng, cài LAN xong (0.9.1-beta.1).
- **Cô lập tenant**: không đổi truy vấn dữ liệu; lệnh đặt lại mật khẩu có test tài khoản trùng tên ở công ty khác không bị đổi; SaaS giữ test cô lập đợt #237.

## 3. CHƯA kiểm chứng (đừng nói là đã xong)

1. **Let's Encrypt thật** (kiểu VPS): cần tên miền công khai + VPS thật; máy dev có cổng 80 bị dịch vụ hệ thống Windows chiếm (PID 4) nên cũng không thử được cổng 80/443 cục bộ.
2. **Linux/NAS thật** (mới thử trong container Linux), **máy Windows sạch**.
3. ~~Nâng cấp hệ thống cài bằng `install.*` cũ~~ **ĐÃ KIỂM CHỨNG** (xem #238 "Kiểm chứng bổ sung 2": nâng cấp + quay lui đúng; sửa 2 lỗi: file `VERSION` của gói, quay lui về bản trước 0.9). Vẫn nên dặn khách sao lưu tay trước lần nâng cấp đầu.
4. ~~Lệnh `db:reset-admin-password` trên ảnh thật~~ **ĐÃ KIỂM CHỨNG** (mật khẩu mới đăng nhập được + bắt đổi, mật khẩu cũ bị từ chối, audit đúng, các lỗi báo đúng).
5. Thay chứng chỉ wildcard (`certs/*` + `docker compose restart caddy`): mới viết hướng dẫn, chưa thử.

## 4. Việc treo / chờ quyết định

- **"Chế độ bảo trì"** trong trình cài đặt (thay chứng chỉ, đặt lại mật khẩu bằng giao diện): chủ dự án hỏi "có cần không" — đã tư vấn KHÔNG cần ngay (thay chứng chỉ làm tay 2 phút, đặt lại mật khẩu đã có lệnh). Chờ chốt.
- Tên máy (`http://TEN-MAY`): chủ dự án quyết KHÔNG làm.
- Nút "Cập nhật ngay" trong ứng dụng vẫn tắt (không tự bật được trình cài đặt — cần tiến trình nền, chờ chủ dự án).
- **Chọn nhà cung cấp máy chủ/tên miền trong nước cho SaaS**: đã lập khung so sánh `docs/product/saas-hosting-comparison.md` (nhu cầu hạ tầng, dữ liệu đã kiểm, mẫu 8 câu yêu cầu báo giá, điểm pháp lý, gợi ý DNS tách khỏi máy chủ + certbot tự gia hạn ghi vào `certs/`). **Chỉ có giá Viettel IDC** (4 vCPU/8 GB: 799.000 đ gói T1.Base 05, 1.200.000 đ gói T2.Gen 02, theo whtop.com, kiểm lại); VNPT/FPT/CMC/hosting khác tra không ra — CHỜ chủ dự án gửi mẫu báo giá cho 3 đến 4 nhà cung cấp rồi đưa lại để điền bảng thật. Chặn gói SaaS thật. Điểm pháp lý (dữ liệu sức khoẻ ra nước ngoài, Luật BVDLCN 91/2025/QH15 hiệu lực 1/1/2026) mới tra một phần, cần luật sư.
- **Phát hành `1.0.0` (chủ dự án chốt 15/10/2026: SAU pilot)**: giữ `0.9.0`; chỉ chạy `node scripts/release.mjs 1.0.0` khi pilot ngừng dùng sổ giấy, S6-02 và S6-04 đạt, gói cài đã kiểm trên máy khách thật; cần ghi chú phát hành `apps/api/release-notes/1.0.0.json`. Chi tiết `docs/DECISIONS.md` #238 phần "Chốt".
- Khu quản trị: menu "Tài khoản vận hành" (hiện tạo bằng script), nhật ký chưa phân trang, phiên không refresh, chưa chống dùng lại OTP trong 30 giây; bước 3 cập nhật phần mềm (máy chủ phát hành); CSP Report-Only; S6-02/S6-04; BHYT (S2-04). Chủ dự án bảo BỎ QUA việc bật chi nhánh 2 ở khách thật.
- Dọn tay (không phải của dự án): 5 container dừng `package-*` + `modest_leakey` từ các lần thử cũ trên máy dev (`docker rm ...`), volume `package_*` chưa xoá vì chưa chắc có dữ liệu cần giữ.

## 5. Điều cần biết / bẫy

- **Dựng gói**: chạy từ `deploy\on-prem` bằng PowerShell/Command Prompt (KHÔNG Git Bash), `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-and-export.ps1 -Version X.Y.Z -PackageDir <ngoài repo>`; bản giao khách cần `node scripts/release.mjs` (tag + cây sạch), dựng thử dùng `-AllowUnreleased`. Docker 29.8.2 + Compose v5.6.0 trên máy dev.
- **Compose chạy từ trong container chỉ nhận đường dẫn máy dạng `/c/Users/...`** (dạng `C:\...` bị hiểu thành đường dẫn tương đối) — script Windows và `backupDirForCompose` tự đổi. KHÔNG đặt `-p` cho compose (tên dự án = tên thư mục như các lần cài cũ).
- **Công cụ**: máy không có Python. **Heredoc/`node -e` qua công cụ Bash làm mất một nửa dấu `\` và hỏng chuỗi có `\n`/backtick** — sửa file có dấu gạch ngược bằng công cụ Edit/Write (hoặc viết file `.cjs` bằng Write rồi chạy). Tài liệu `docs/*.md`, `docker-compose.yml`, `.env.example` dùng CRLF (script vá phải đọc, đổi `\r\n`→`\n`, sửa, ghi lại đúng kiểu). `docs/CURRENT.md` (380 KB) và `docs/DECISIONS.md` quá lớn để Read cả file — dùng offset/limit hoặc Grep. `build-and-export.ps1` có BOM UTF-8.
- **Cách kiểm Docker thật cho trình cài đặt** (script ở scratchpad sẽ mất): dựng ảnh thử `nexamed-setup/api/web:<số thử>` bằng `docker build` (cache nhanh), tag `nexamed-backup` từ bản sẵn có, tạo thư mục thử với `docker-compose.yml`, `.env.example`, `nexamed-setup.*` và file giả `images/nexamed-*-<số>.tar.gz`, chạy `nexamed-setup.ps1 -NoBrowser -Port 8091`, điều khiển wizard bằng `playwright-core@1.49.1` + Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe` (ô nhập có id `f_<tên>`, nút theo chữ). Kiểu SaaS thử cục bộ: sửa cổng Caddy trong compose của thư mục thử sang 8880/8443, dùng chứng chỉ thử `apps/setup/src/testing/cert1.pem`+`key1.pem` (bao `example.test`, `*.example.test`) và `curl --resolve admin.example.test:8443:127.0.0.1 -k`. Xong dọn: `docker compose -p <tên> down -v`, `docker rmi` ảnh thử. KHÔNG đụng DB dev (cổng 5433) và container `nexamed-postgres-1`.
- **Dòng `.sh` phải là LF**: máy Windows có `core.autocrlf=true` sẽ đổi `nexamed-setup.sh` thành CRLF khi checkout, gói dựng từ đó chạy hỏng trên Linux. Đã thêm `.gitattributes` (`*.sh text eol=lf`) và bit thực thi cho file này; nếu dựng gói từ bản checkout cũ, kiểm `file nexamed-setup.sh` không có "CRLF".
- **File `VERSION` ở gốc gói** (do `build-and-export.ps1` ghi): trình cài đặt và 2 script khởi động dùng nó để chọn bản mới. Bắt buộc có vì số phiên bản kiểu ngày của bản cài cũ (`2026.10.15`) lớn hơn SemVer (`0.9.0`) khi so theo số, và giải nén đè lên thư mục cũ làm ảnh cũ còn sót. Gói dựng trước khi có file này (hiếm, chỉ gói thử) thì rơi về so theo số.
- `apps/setup/src/testing/key1.pem` là khoá giả chỉ cho test (một khoá riêng + 3 chứng chỉ công khai) — công cụ quét bí mật nếu báo thì bỏ qua.
- `apps/web` chỉ import KIỂU từ `@nexamed/shared`; `@nexamed/shared`/`core` phải `pnpm --filter … build` trước khi chạy test/typecheck API. Test API ~8 phút, không chạy Chrome/Docker song song.
- **Sai lầm đã mắc phiên này (đừng lặp)**: trả lời câu hỏi của chủ dự án bằng hành động (sửa code) mà quên trả lời bằng chữ — phải trả lời thẳng câu hỏi trước; nói "3 file khoá" trong khi chỉ có 1 khoá riêng (nói sai khi chưa kiểm).

## 7. Các giai đoạn còn lại (tổng hợp theo `docs/TASK.md`, `docs/CURRENT.md`) và đề xuất bước kế tiếp

Sprint 1–6 và mọi phần mở rộng ngoài kế hoạch (kho thuốc, công nợ NCC, cận lâm sàng, chi nhánh, SaaS nền, trình cài đặt) ĐÃ XONG. Còn:

- **A. Cần phòng khám pilot thật (chặn GA)**: S6-02 diễn tập phục hồi trên máy chủ pilot; S6-04 đo hiệu năng p95 (< 500 ms, 10 người dùng) trên máy chủ pilot; thử máy in tem + súng quét mã vạch thật.
- **B. Nợ phát hành/cài đặt**: Let's Encrypt thật (VPS), Linux/NAS thật, máy Windows sạch, thử thay chứng chỉ wildcard, chốt `1.0.0` sau pilot.
- **C. Chờ quyết định/nhà cung cấp**: nhà cung cấp hạ tầng SaaS (mục 4); bước 3 cập nhật phần mềm (máy chủ phát hành, ký số; nút "Cập nhật ngay" đang tắt); "chế độ bảo trì" (đã tư vấn chưa cần); bật chi nhánh 2 ở khách thật (chủ dự án bảo bỏ qua).
- **D. Chức năng chưa làm**: **S2-04 Lưu thẻ BHYT** (mã hoá số thẻ bằng `pii-encryption.ts`, hiển thị, không tính chi trả; cần hỏi chốt quy trình + mockup được duyệt trước khi code); trường VTYT riêng (phân loại rủi ro NĐ 98/2021, tái sử dụng, nhóm VTYT, số đăng ký, model) và trường thuốc chưa quyết (`national_pharmacy_code`, `vat_rate`); khu quản trị SaaS còn thiếu menu "Tài khoản vận hành", phân trang nhật ký, refresh phiên, chống dùng lại OTP 30 giây; chuyển CSP từ Report-Only sang chặn sau khi pilot sạch cảnh báo; script/giao diện đặt lại mật khẩu đã có (lệnh), không còn nợ.
- **E. Ngoài phạm vi v1**: viện phí đa đối tượng, BHYT đầy đủ, báo cáo doanh thu theo kỳ, công nợ/trả góp bệnh nhân, LIS/PACS, PWA offline toàn diện.

**Đề xuất bước kế tiếp (theo thứ tự)**: (1) chủ dự án gửi mẫu báo giá hạ tầng → khi có báo giá, điền `saas-hosting-comparison.md` thành bảng thật và đề xuất nhà cung cấp; (2) chọn phòng khám pilot để làm nhóm A; (3) S2-04 BHYT nếu pilot cần (hỏi chốt quy trình theo quy tắc "xác nhận workflow trước mỗi tính năng", rồi mockup, chờ "duyệt").

## 6. Tài liệu/memory đã cập nhật phiên này

`docs/DECISIONS.md` #238 (tiến độ + bổ sung đặt lại mật khẩu + kiểm chứng bổ sung 2 + chốt `1.0.0` sau pilot), `docs/product/saas-hosting-comparison.md` (mới), `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/CURRENT.md`, `docs/Deploy.md`, `CLAUDE.md`, `.claude/docs/project-structure.md`. Memory: `project_installer_wizard_mockup.md` (đã xong), `project_release_and_saas_hosting.md` (mới: chốt 1.0.0 sau pilot + chờ báo giá SaaS), dòng bàn giao trong `MEMORY.md`.
