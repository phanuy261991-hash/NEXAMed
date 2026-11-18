# HANDOFF — Phát hành 0.9.7 (hiệu năng, tải trước chunk, logo dự phòng) — chốt phiên 2026-11-18 (phần 2)

(Bản bàn giao DUY NHẤT còn trong repo; thay bản `HANDOFF-Phat-hanh-0.9.6-HieuNang-2026-11-18.md`. Chi tiết kỹ thuật ở `docs/DECISIONS.md` #301–#304 và `docs/CHANGELOG.md`.)

## 1. Trạng thái một câu
**`0.9.7` đã phát hành, đã push và đã dựng gói giao khách; không còn việc code dở nào.** `master` = `origin/master` ở `f8ee1e18` (tag `v0.9.7` → `f2d42cf8`), cây git sạch.

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục F/D ở cuối), `docs/DECISIONS.md` từ #301 đến #304 (cuối file), file này.
2. `git status` phải sạch. Kiểm CI GitHub của `5da172d0`, `1ab5a87d`, `f2d42cf8`, `f8ee1e18` (chưa kiểm; máy KHÔNG có `gh`, dùng script GitHub REST qua Git Credential Manager, xem memory `reference_open_pr_via_git_credential`).
3. Hỏi chủ dự án việc kế tiếp (mục 5).

## 3. Đã làm trong phần 2 của phiên 18/11/2026
- **D — tải trước chunk JS** (#304): kiểm Chrome thật, commit `5da172d0`. Lượt vào trang đầu: 167 tệp JS rải 43/45 trang → 0; không tải trùng (204 tệp, mỗi tệp 1 yêu cầu); rê chuột menu tải ngay; không lỗi Console. **Lợi ích thời gian NHỎ**: localhost không khác biệt, mạng giả lập trễ 60 ms trung vị nhanh hơn 43 ms; đổi lại tải nền ~1,1 MB gzip trong phiên đầu. Giữ lại vì an toàn và có lợi trên VPS/SaaS. Chưa chạy `role-access-sweep.cjs` cho D. Bộ đo `nav-perf-audit.cjs` thêm `WARMUP_MS`, `NET_LATENCY_MS`, `NET_KBPS`.
- **Logo dự phòng ở đầu menu** (`1ab5a87d`): khi phòng khám chưa tải logo, logo NEXAMed dự phòng cao 24px nhỏ hơn logo phòng khám (32px); đã chỉnh lên `h-8` (`SidebarBrand.tsx`). Nguyên nhân chủ dự án thấy "logo nhỏ đi": bản on-prem thử (công ty "Phòng Khám Sushine") không có `logo_key`, không phải lỗi bản beta.
- **Bản beta**: `0.9.7-beta.1` rồi `0.9.7-beta.2` (thêm logo) dựng ở `C:\Projects\NEXAMed-demo-package\0.9.7-beta.*`; chủ dự án nâng cấp thử ở `C:\NEXAMed-onprem-test` và báo `beta.2` ổn.
- **Phát hành `0.9.7`**: ghi chú `apps/api/release-notes/0.9.7.json` (`88d98e34`), `node scripts/release.mjs 0.9.7` (`f2d42cf8`), push cùng tag. Gói giao khách dựng từ đúng tag bằng `git worktree` (bản dựng 425; worktree đã gỡ): thư mục nguồn `C:\Projects\NEXAMed-demo-package\NEXAMed-0.9.7`; **ZIP + SHA-256 + hướng dẫn ở `C:\Projects\NEXAMed-demo-package\giao-khach-0.9.7`** (ZIP 1.072 MB, SHA-256 `252eb973aa3d1ebcb75866ca38a8a670d7d7967d3a6becb69b316c887b99d457`, kiểm toàn vẹn đạt). Thư mục `giao-khach` cũ vẫn giữ gói 0.9.6.

## 4. Trạng thái môi trường
- Dev DB (`nexamed-postgres-1`, cổng 5433) đã `db:deploy` mọi migration đến `20261118090000`. Máy thử `C:\NEXAMed-onprem-test` đang ở `0.9.7-beta.2` (nâng lên `0.9.7` bằng cách chép nội dung gói đè vào đó rồi chạy `nexamed-setup.cmd` Ở ĐÓ). Tiến trình đo (API 3001, preview 4173/4174) ĐÃ dừng; nếu cổng bận là sót.
- Kiểm cuối trước push: typecheck + lint toàn kho sạch; web routing 11 test đạt (full test chưa chạy lại sau D vì D chỉ đổi web).

## 5. Việc còn
- **Chờ chủ dự án**: thêm số liên hệ hỗ trợ vào `HUONG-DAN-CAI-DAT.txt` rồi tải 3 tệp lên Drive/OneDrive (chia sẻ theo email); chưa thử **cài MỚI từ ZIP** trên thư mục trống (mới thử nâng cấp); gỡ luật tường lửa "NEXAMed LAN test 8181" (cần Administrator).
- **Đề xuất hiệu năng chưa làm**: E logo in chỉ tải khi in (Sổ quỹ, Tồn kho tải logo ngay cả khi không in); `inventory/dispense-queue` phân trang máy chủ (~260 ms/378 KB với 959 đơn — chỉ khi cần); lưới Lịch làm việc (~4.200 phần tử) và `/admin/catalog-pharmacy` còn nặng; đo thêm trên bản on-prem thử (cần mật khẩu).
- **Việc cũ còn mở (không đổi)**: S6-02 diễn tập phục hồi + S6-04 đo tải trên máy chủ pilot thật rồi `1.0.0`; hạ tầng SaaS (báo giá; khi làm: adapter S3 cho `StoragePort` cùng MỘT ảnh Docker, hạn mức dung lượng theo công ty, giới hạn tải DICOM 50 MB ở bộ chia tải — memory `project_saas_storage_s3_one_image`); kiểm bộ cài trên Windows sạch/Linux/NAS/Let's Encrypt; liên thông đơn thuốc cổng thật; gói Nhi khoa (tạm dừng); chữ ký điện tử bệnh án (làm sau); kiểm "Dọn gói cũ" qua `nexamed-setup` đầy đủ trên Docker Desktop thật.

## 6. Bẫy đã gặp (đọc trước khi làm)
- **Quy trình bản dev đồng hành** (#301): ghi chú `apps/api/release-notes/<số>-beta.N.json` (bản sao đổi `version`, KHÔNG commit, xoá trước `release.mjs`), mỗi lần dựng lại ĐỔI số (trình cài đặt từ chối cùng số), dựng bằng `powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/on-prem/build-and-export.ps1 -Version X -AllowUnreleased -PackageDir "<ngoài repo, thư mục mới>"`; bản giao khách dựng KHÔNG `-AllowUnreleased` từ `git worktree` đúng tag (script đòi HEAD = commit của tag và cây sạch). Chép gói sang máy khác dùng **Copy, KHÔNG Cut** (gói 0.9.6 từng bị Cut làm thư mục trống).
- Logo menu: ảnh phòng khám `max-h-8`, dự phòng NEXAMed `h-8`; menu thu gọn luôn hiện biểu tượng N+.
- **Heredoc bash + tiếng Việt / chuỗi `EOF` lồng nhau cắt cụt tệp im lặng**. Viết script bằng công cụ **Write** rồi `node tệp.cjs`; vá tài liệu dùng `scripts/patch-file.mjs` (JSON, giữ CRLF/LF, chỉ thay chuỗi thuần).
- **`execFileSync` trong vòng lặp chặn vòng lặp sự kiện** → dùng `execFile` bất đồng bộ cho bộ lấy mẫu.
- **KHÔNG chạy full test API cùng lúc với typecheck/build/đo đạc nặng**: test bị HẾT THỜI GIAN CHỜ giả. Chạy full API một mình, ~7 phút; lỗi timeout thì chạy riêng tệp.
- Windows có **sàn đo ~15 ms**: chỉ tin số > ~30 ms khi đo API. Đăng nhập giới hạn **10 lần/phút/tài khoản**. Tiền tố API là `/api/v1` (`/api/health` trả 404, đừng dùng làm kiểm sức khoẻ).
- Postgres "kế hoạch chung": `EXPLAIN` bằng giá trị cụ thể KHÔNG tái hiện lỗi; phải `PREPARE` + `EXECUTE` ≥ 6 lần (#304). `ALTER ROLE … SET` chỉ áp cho kết nối MỚI → khởi động lại API sau `db:deploy`.
- `pnpm db:deploy` chạy trong `apps/api`. Tệp test web chỉ là `.spec.ts` (môi trường node, KHÔNG có DOM). `pnpm --filter @nexamed/web ...` có lúc báo "No projects matched" khi cwd lạ — `cd apps/web && pnpm exec tsc --noEmit`.
- Dựng bản đo production: `pnpm --filter @nexamed/web build`, sửa `apps/web/dist/config.json` đặt `apiBaseUrl` rỗng, API `cd apps/api && NODE_ENV=production node dist/main.js` (cổng 3001), web `cd apps/web && VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite preview --port 4173`; `playwright-core` ở `C:\Users\Administrator\node_modules` (`PLAYWRIGHT_CORE=...`). Dùng nohup/Start-Process, KHÔNG `sleep` dài. Đo CẶP trang khác nhau cho `content` (cùng route hai lượt liền cho 20 giây giả).
- Container cũ đã dừng giữ ảnh Docker nên không gỡ được ảnh (đúng thiết kế); `docker rm` rồi dọn lại.
- Từ bản giao cũ, vẫn đúng: tải tệp lớn phải kiểm qua nginx THẬT; `apps/web` chỉ import KIỂU từ `@nexamed/shared`; `prisma generate` EPERM khi còn tiến trình Node giữ engine; script kiểm "dọn xong" phải liệt kê lại theo đúng tiền tố; hộp chồng nhau cùng nghe Esc cần bắt ở capture + `stopImmediatePropagation`.
- Công cụ Edit cần Read tệp trước.

## 7. Quy tắc chủ dự án nhắc (đã ghi memory)
Tuân thủ mockup tuyệt đối và đối chiếu từng phần tử; **"tiếp tục"/"làm luôn" KHÔNG phải duyệt mockup** ("chốt" thì được code); chú thích duyệt mockup không chép vào sản phẩm; commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt; trước mỗi push chạy `pnpm typecheck` + `pnpm lint` toàn kho; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất); giữ nguyên màu chữ xám hiện trạng; giao khách bằng ZIP + SHA-256 + hướng dẫn, lưu ở Drive/OneDrive theo email.
