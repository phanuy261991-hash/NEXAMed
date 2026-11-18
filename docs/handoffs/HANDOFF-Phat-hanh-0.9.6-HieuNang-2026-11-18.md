# HANDOFF — Phát hành 0.9.6, trình cài đặt "Dọn gói cũ", hiệu năng chuyển trang — chốt phiên 2026-11-18

(Bản bàn giao DUY NHẤT còn trong repo; thay bản `HANDOFF-HinhAnhTaiLieu-GD3-2026-11-16.md`. Chi tiết kỹ thuật từng việc ở `docs/DECISIONS.md` #301–#304 và `docs/CHANGELOG.md`.)

## 1. Trạng thái một câu
**`0.9.6` đã phát hành và giao được; phần hiệu năng A/B/C/F đã xong và đã push (HEAD `64b29efd`, CI của `4eb61c01` xanh); còn đúng MỘT việc code dở: D (tải trước chunk JS của trang) — mã + 11 test đã xong, typecheck/lint sạch nhưng CHƯA kiểm bằng Chrome và CHƯA commit.**

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục F/D ở cuối), `docs/DECISIONS.md` từ #301 đến #304 (cuối file), file này.
2. `git status` — phải thấy ĐÚNG 3 đường dẫn chưa commit: `apps/web/src/app/router.tsx`, `apps/web/src/shared/layout/Sidebar.tsx`, `apps/web/src/shared/routing/` (lazy-route.ts, route-prefetch.ts, 2 tệp spec). Đó là phần D. Kiểm CI của `64b29efd` (script GitHub REST qua Git Credential Manager, xem memory `reference_open_pr_via_git_credential`; máy KHÔNG có `gh`).
3. **Kiểm D bằng Chrome thật** (mục 5.1) rồi ghi kết quả vào #304, commit, push.
4. Hỏi chủ dự án có dựng `0.9.7` ngay không (mục 5.2).

## 3. Đã làm trong phiên 17–18/11/2026
- **Phát hành `0.9.6`** (#301): tag `v0.9.6` → commit `25daa5e6`, đã push. Gói giao khách `0.9.6+415` dựng từ bản làm việc riêng của tag (`git worktree`, đã gỡ). **Gói giao khách**: `C:\Projects\NEXAMed-demo-package\giao-khach\` gồm `NEXAMed-0.9.6.zip` (1.072 MB, có thư mục `NEXAMed-0.9.6` bên trong), `NEXAMed-0.9.6.sha256.txt` (SHA-256 `0f9bda650f976f7b8bd853aba544520aebb3533b89fe3209c8818281e6bdd287`), `HUONG-DAN-CAI-DAT.txt`. Thư mục nguồn của gói là `...\NEXAMed-demo-package\NEXAMed-0.9.6` (đã đổi tên từ `0.9.6`). Chủ dự án đã nâng cấp thử `beta.3` → `0.9.6` ở `C:\NEXAMed-onprem-test` đạt.
- **Trình cài đặt `apps/setup`** (#301): `compareVersions` theo SemVer (`0.9.6-beta.1` < `0.9.6`); mục **"Dọn gói cũ"** ở bước "Bản đang chạy" (giữ bản đang chạy + bản trước theo lần nâng cấp gần nhất + bản mới trong gói; hộp xác nhận có ô tích; bản bị container cũ giữ ảnh hiện "Giữ · có container cũ…" kèm tên container; sao lưu `upgrade-backups` chỉ hiện dung lượng, không có nút xoá); **khung nhật ký bước Đang cài/nâng cấp giãn sát chân trang** (`8c15d9bc`, CHƯA có trong gói `0.9.6`).
- **Quy trình bản dev đồng hành** (chủ dự án muốn): `-AllowUnreleased -Version <số>-beta.N`, ghi chú `apps/api/release-notes/<số>-beta.N.json` (bản sao đổi `version`, KHÔNG commit, xoá trước `release.mjs`), nâng cấp thử ở `C:\NEXAMed-onprem-test`, ổn mới `node scripts/release.mjs <số>` rồi dựng bản giao khách từ tag.
- **Màu chữ xám**: chủ dự án xem mockup so sánh rồi chọn **giữ nguyên** (#302, memory `feedback_keep_text_colors_as_is`) — đừng đề xuất lại.
- **Hiệu năng** (#303 + #304): đo thật bằng Chrome (45 trang, CPU ×4). Máy chủ không chậm; phần chậm là dựng giao diện + một lỗi kế hoạch truy vấn.
  - A: gzip ở `deploy/on-prem/nginx.conf` (kiểm nginx thật + `nginx-gzip.spec.ts`).
  - B: `staleTime` cho 27 hook theo quy ước `shared/api/stale-time.ts` (KHÔNG đặt toàn cục — sẽ lộ chỗ thiếu làm mới cache).
  - C: `shared/hooks/useWindowedRows.ts` (cuộn ảo) cho Phát thuốc, Tồn kho, Sổ kho; `ReportGridTable` tự cuộn ảo > 80 dòng. Phát thuốc 1.773 → 101 ms ở CPU ×4.
  - F: migration `20261118090000_app_role_custom_plans` (`ALTER ROLE nexamed_app SET plan_cache_mode = 'force_custom_plan'`): Postgres chuyển "kế hoạch chung" sau 5 lần chạy → vòng lặp lồng quét lại cả bảng hoá đơn cho từng lượt khám. Doanh thu theo kỳ 1.069 → 61 ms, theo dịch vụ 1.015 → 58, tổng quan 1.702 → 132. **Sau `db:deploy` phải khởi động lại API.**
- Tài liệu: `DECISIONS.md` đã cắt #291–#295 sang `docs/archive/DECISIONS-291-295.md` (file gốc ~115 KB, ngưỡng 150 KB).
- Bộ đo mới ở `scripts/ui-audit/` (xem README): `nav-perf-audit.cjs`, `windowed-tables-check.cjs`, `api-endpoint-timing.cjs`.

## 4. Trạng thái git và môi trường
- `master` = `origin/master` ở `64b29efd`, trừ 3 đường dẫn của D chưa commit. CI: `4eb61c01` xanh (build + pool-stress); `64b29efd` chưa kiểm.
- Dev DB (`nexamed-postgres-1`, cổng 5433) đã `db:deploy` migration mới. Máy test `C:\NEXAMed-onprem-test` đang ở `0.9.6`. Các tiến trình đo (API 3001, vite preview 4173) ĐÃ dừng; nếu thấy cổng đang bận thì là sót.
- Kiểm cuối: web 844 test (chưa tính 11 test mới của D → web ~855), API full 2431 đạt (2 tệp hết thời gian chờ khi máy quá tải, chạy riêng 95/95 đạt), typecheck + lint toàn kho sạch.

## 5. Việc còn
### 5.1 D — tải trước chunk JS (dở)
Mã đã viết: `lazyRoute` (React.lazy + `preload()` dùng chung một lời hứa), `route-prefetch.ts` (`registerRouteTable`, `prefetchRoute` khi rê chuột/focus/chạm mục Sidebar, `queueIdlePrefetch` tải dần mỗi lúc MỘT chunk khi rảnh, bỏ qua 2G/tiết kiệm dữ liệu/tab ẩn), 68 route đổi sang `lazyRoute`, `NavItem` gắn tải trước. **Phải kiểm**: build web production + chạy `nav-perf-audit.cjs` (CHỜ ~20–30 giây sau đăng nhập rồi mới đo): lượt vào trang đầu tiên phải gần như không còn yêu cầu JS (`js 0/…`) cho các trang đã được tải trước; không tải trùng chunk; không làm chậm trang đang mở (so `content` lượt 1 trước/sau); Sidebar rê chuột vẫn bình thường; mọi vai trò vào được trang (quét `role-access-sweep.cjs` nếu nghi ngờ). Rủi ro cần để mắt: `route.element` bị bọc nhiều lớp (đã có test), route có tham số.
### 5.2 Dựng `0.9.7` (chủ dự án quyết)
Nội dung chưa nằm trong gói giao khách: khung nhật ký bước cài, gzip nginx (nginx đổi → dựng lại ảnh web), `staleTime`, cuộn ảo, migration plan cache (có thể làm nâng cấp chậm vài giây — vô hại), D nếu kiểm đạt. Cần viết `apps/api/release-notes/0.9.7.json` trước. Quy trình ở mục 3. Chép gói sang máy khác dùng **Copy, KHÔNG Cut** (gói `0.9.6` từng bị Cut làm thư mục trống).
### 5.3 Chờ chủ dự án
- Thêm số liên hệ hỗ trợ vào `HUONG-DAN-CAI-DAT.txt`; tải 3 tệp lên Drive/OneDrive (đã tư vấn: chia sẻ theo email, ZIP + mã băm + hướng dẫn).
- Chưa thử **cài MỚI từ ZIP** trên thư mục trống (mới thử nâng cấp) — chủ dự án từ chối làm lúc đó.
- Gỡ luật tường lửa "NEXAMed LAN test 8181" (cần Administrator).
### 5.4 Đề xuất chưa làm
E: logo in chỉ tải khi in (Sổ quỹ, Tồn kho tải logo ngay cả khi không in); `inventory/dispense-queue` phân trang máy chủ (~260 ms/378 KB với 959 đơn — chỉ khi cần); lưới Lịch làm việc (~4.200 phần tử) và `/admin/catalog-pharmacy` còn nặng; đo thêm trên bản on-prem thử (cần mật khẩu).
### 5.5 Việc cũ còn mở (không đổi)
S6-02 diễn tập phục hồi + S6-04 đo tải trên máy chủ pilot thật rồi `1.0.0`; hạ tầng SaaS (báo giá; khi làm: adapter S3 cho `StoragePort` cùng MỘT ảnh Docker, hạn mức dung lượng theo công ty, giới hạn tải DICOM 50 MB ở bộ chia tải — memory `project_saas_storage_s3_one_image`); kiểm bộ cài trên Windows sạch/Linux/NAS/Let's Encrypt; liên thông đơn thuốc cổng thật; gói Nhi khoa (tạm dừng); chữ ký điện tử bệnh án (làm sau).

## 6. Bẫy đã gặp (đọc trước khi làm)
- **Heredoc bash + tiếng Việt / chuỗi `EOF` lồng nhau cắt cụt tệp im lặng** (nhiều lần). Viết script bằng công cụ **Write** rồi `node tệp.cjs`; script vá tài liệu phải giữ kiểu xuống dòng (nhiều `docs/*.md` là CRLF) và chỉ thay chuỗi thuần.
- **`execFileSync` trong vòng lặp chặn luôn vòng lặp sự kiện** (bộ lấy mẫu `pg_stat_activity` treo vì yêu cầu API không chạy được) → dùng `execFile` bất đồng bộ.
- **KHÔNG chạy full test API cùng lúc với typecheck/build/đo đạc nặng**: test bị HẾT THỜI GIAN CHỜ giả (lần chạy mất 1.128 s thay vì ~7 phút). Chạy full API một mình, ~7 phút; lỗi timeout thì chạy riêng tệp để phân biệt.
- Windows có **sàn đo ~15 ms** (độ phân giải đồng hồ): chỉ tin số > ~30 ms khi đo API. Đăng nhập giới hạn **10 lần/phút/tài khoản** nên script đo đừng đăng nhập lặp liên tục.
- Postgres "kế hoạch chung": `EXPLAIN` bằng giá trị cụ thể KHÔNG tái hiện lỗi; phải `PREPARE` + `EXECUTE` ≥ 6 lần (xem #304). `ALTER ROLE … SET` chỉ áp cho kết nối MỚI.
- `pnpm db:deploy` chạy trong `apps/api` (root không có lệnh này). Tệp test web chỉ là `.spec.ts` (môi trường node, KHÔNG có `@testing-library/react`, KHÔNG có DOM) — đừng viết `.spec.tsx` render.
- Dựng bản đo production: `pnpm --filter @nexamed/web build`, sửa `apps/web/dist/config.json` đặt `apiBaseUrl` rỗng, API `cd apps/api && NODE_ENV=production node dist/main.js` (cổng 3001), web `cd apps/web && VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite preview --port 4173`; `playwright-core` ở `C:\Users\Administrator\node_modules` (`PLAYWRIGHT_CORE=...`). Dùng Start-Process/nohup, KHÔNG `sleep` dài trong một lệnh (bị chặn). Đo trang cùng route hai lượt liền cho `content` 20 giây giả (nội dung không đổi) — dùng CẶP trang khác nhau.
- Container cũ đã dừng giữ ảnh Docker nên không gỡ được ảnh (đúng thiết kế, không dùng `-f`); `docker rm` container rồi dọn lại.
- Từ bàn giao cũ, vẫn đúng: tải tệp lớn phải kiểm qua nginx THẬT (Vite proxy che lỗi 413); `apps/web` chỉ import KIỂU từ `@nexamed/shared`; `prisma generate` EPERM khi còn tiến trình Node giữ engine; `prisma format` căn lại cả model khác; script kiểm "dọn xong" phải liệt kê lại theo đúng tiền tố; hộp chồng nhau cùng nghe Esc cần bắt ở capture + `stopImmediatePropagation`.
- Công cụ Edit cần Read tệp trước (tệp tôi tạo bằng Write trong cùng phiên thì Edit được).

## 7. Quy tắc chủ dự án nhắc (đã ghi memory)
Tuân thủ mockup tuyệt đối và đối chiếu từng phần tử; **"tiếp tục"/"làm luôn" KHÔNG phải duyệt mockup** ("chốt" thì được code); chú thích duyệt mockup không chép vào sản phẩm; commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt; trước mỗi push chạy `pnpm typecheck` + `pnpm lint` toàn kho; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất); giữ nguyên màu chữ xám hiện trạng; chủ dự án chốt giao khách bằng ZIP + SHA-256 + hướng dẫn, lưu ở Drive/OneDrive theo email.
