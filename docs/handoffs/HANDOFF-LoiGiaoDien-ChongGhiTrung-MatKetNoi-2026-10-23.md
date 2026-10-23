# HANDOFF — Node 26, vitest 4/Vite 6, lỗi giao diện (#255), khảo sát mất kết nối + chống ghi trùng (#256) — 2026-10-23

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`**, không nhánh/PR. UI mới phải có mockup chủ dự án DUYỆT RÕ trước khi code (riêng màn lỗi toàn cục chủ dự án bảo "làm luôn" nên không qua mockup). Ảnh kiểm tra để ở thư mục tạm, KHÔNG vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test và báo kết quả (kèm cô lập tenant/chi nhánh); nghi chập chờn thì tìm nguyên nhân và chạy lặp ≥ 3 lượt. **Shell ăn dấu `\` khi vá mã**: dùng công cụ Edit/Write (hoặc Write + `node file.cjs`), đừng dán regex/chuỗi có `\` vào lệnh.
> Quy ước tài liệu dài (CLAUDE.md): chỉ đọc file gốc. `docs/DECISIONS.md` **#252–#256 là mới nhất** (phiên này).

## 0. Trạng thái một câu
Phiên 22–23/10/2026: dự án chạy **Node 26** (Dockerfile, CI, `engines`, `@types/node`), vitest 2→4 + web Vite 5→6 (`pnpm audit` 0 cảnh báo), Postgres dev 18.6, CI GitHub xanh trở lại (sửa 2 lỗi có sẵn); **làm hết #255** (mọi lỗi giao diện → màn/hộp thông báo tiếng Việt, không lộ mã/lỗi thô, `unwrap` lọc thông điệp theo mã HTTP, nginx/Caddy trả thông báo tiếng Việt); **đang dở**: khảo sát chống ghi trùng khi mạng đứt (#256) — chủ dự án yêu cầu kiểm toàn diện, riêng khâu nhập kết quả xét nghiệm; phần đọc mã xong, phần chạy thực nghiệm CHƯA làm.

## 1. Đã xong và đã push (HEAD `c352294` trước commit bàn giao)
| Commit | Nội dung |
|---|---|
| `324344e` | Node 26 (3 Dockerfile dùng `npm i -g pnpm@9.15.9` vì ảnh Node 25+ **không có corepack**), vitest 4.1.12 + Vite 6.4.5, `pnpm.overrides` (audit 0), `@types/node` tường minh, loại `dist` khỏi vitest, **tắt job nền khi test API** (nguyên nhân test liên thông chập chờn), HSTS 180 ngày ở Caddyfile `nexamed-setup`, `script:run`, luật ESLint chặn import giá trị từ shared ở web |
| `41f36b1` | Sửa CI đỏ: `TenantCodeAlias` miễn trừ `tenant_id` trong `scripts/check-mandatory-columns.mjs` (CI đỏ ≥ 12 commit từ #245) |
| `9114c42` | Sửa test chập chờn trình cài đặt: `readJson` không còn ném 413 giữa vòng `for await` (làm huỷ kết nối) — tái hiện được ở cả Node 20 và 26 |
| `8e96b85` | Màn lỗi toàn cục: `AppErrorScreen`/`AppErrorBoundary`/`RouteErrorScreen`, `app-error.ts` |
| `c352294` | Làm hết #255: `api-message.ts` + `unwrap`/`apiErrorFromResponse` (lọc thông điệp theo mã HTTP, `ApiError.status`), `SystemFailureDialog` + `MutationCache`, `NotFoundPage` thành màn thông báo, lời nhắn hết phiên, khung báo tĩnh `#boot-fallback`, nginx (`client_max_body_size 8m` + JSON tiếng Việt), Caddy `handle_errors` |
Kèm: cắt `DECISIONS.md` (#230–#241 → `docs/archive/DECISIONS-230-241.md`), CLAUDE.md (Tech Stack Node 26, quy tắc thường trực **checklist xử lý lỗi cho chức năng mới — ui-guidelines 17b, AI tự làm không đợi nhắc**), `docs/Deploy.md`/`demo.md`. Postgres dev nâng 18.4 → **18.6** (sao lưu trước, dữ liệu giữ nguyên).

## 2. Trạng thái kiểm (lần chạy cuối 23/10/2026)
typecheck sạch · lint exit 0 · `pnpm build` qua · `pnpm audit` 0 · shared 96 · core 528 · **web 301** · setup 79 · API 1687 (+1 bỏ qua) — chạy 3 lượt liên tiếp trên máy dev (Node 26.5) và 1 lượt trên Linux sạch Node 26 + trên Postgres 18.6 · **diễn tập nâng cấp Docker thật (ảnh Node 20 cũ → Node 26, giữ dữ liệu) 23/23** · Chrome thật: `scripts/ui-audit/error-states.cjs` 15/15, `error-sweep.cjs` 47/47 route. **CI GitHub: `9f346f6` XANH; CHƯA kiểm các commit sau (`9114c42`, `8e96b85`, `c352294`)** — việc đầu tiên của phiên sau (xem mục 3).

## 3. Việc kế tiếp (theo thứ tự)
1. **Kiểm CI GitHub xanh cho `c352294`** (máy không có `gh`: dùng Python + `git credential fill` gọi `GET /repos/phanuy261991-hash/NEXAMed/actions/runs?branch=master`, KHÔNG in token). Nếu đỏ thì xem log bước lỗi (tải log job: yêu cầu có `Authorization`, theo redirect `Location` KHÔNG kèm header).
2. **Hoàn tất kiểm tra chống ghi trùng (#256) — yêu cầu cuối của chủ dự án** ("kiểm tra chống ghi trùng toàn diện nhất là khi đột ngột mất mạng" + "khâu nhập kết quả xét nghiệm"):
   - **Khâu kết quả xét nghiệm/CĐHA — đã đọc mã (chưa chạy thực nghiệm)**: AN TOÀN nhờ `lockOrder` (khoá theo phiếu) + kiểm trạng thái: `startItems`/lấy mẫu (`collect`)/`approve`/`startAmendment`/`cancelAmendment`/`split`/`recollect`/`uncollect` — bấm lại hoặc bấm đồng thời chỉ MỘT lần thành công, lần sau nhận 4xx; `open` ống mẫu idempotent; `save` (PUT) là thay thế toàn bộ (idempotent, chạy lại ra cùng kết quả). **Khoảng trống**: (a) `addImage` CĐHA cộng dồn mỗi lần gọi (tối đa 8 ảnh) → bấm lại ra ảnh trùng; (b) `print` tem/phiếu tăng bộ đếm in mỗi lần ghi nhận (lệch số lần in, không hại dữ liệu); (c) `save` kết quả KHÔNG có kiểm tra phiên bản → hai người/hai yêu cầu đến lệch thứ tự thì ghi đè kết quả mới bằng bản cũ (last-write-wins).
   - **Chạy thực nghiệm**: khối kiểm thử đã viết sẵn (6 ca: lưu nháp ×2 + đồng thời, gửi duyệt/duyệt ×2, duyệt đồng thời, đính chính ×2 + đồng thời, lấy mẫu ×2 + đồng thời, in tem ×2, thêm ảnh ×2) ở `docs/handoffs/SNIPPET-paraclinical-chong-ghi-trung.spec.txt` — **CHƯA chèn, CHƯA biên dịch, CHƯA chạy**; chèn theo hướng dẫn trong đầu tệp rồi sửa theo kết quả thật (tên trường Prisma/nhãn audit là giả định).
   - **Quét toàn diện các nhóm khác**: đã đo trên máy dev (công ty thử `01a1628b-…`): thu tiền AN TOÀN (lần 2 → 409), tạo bệnh nhân có CCCD AN TOÀN (409), **tiếp nhận `POST /reception/direct` KHÔNG an toàn (2 lượt khám `LK2610000022` đã thu + `LK2610000023` chưa thu)**. CHƯA rà: lịch hẹn, phiếu thu/chi (`cash-vouchers`), nạp ví, phiếu kho (nhập/xuất/kiểm kê/điều chuyển), thanh toán NCC, hoàn tiền/giảm giá, kê đơn/ký đơn, chỉ định cận lâm sàng (`PUT clinical-orders`), đơn xin nghỉ/đăng ký ca, bệnh nhân không CCCD. Phương pháp: gửi CÙNG yêu cầu 2 lần liên tiếp và 2 lần đồng thời (`Promise.all`), đếm bản ghi tạo ra; ưu tiên tiền và kho. Có 227 thao tác ghi (167 POST) — rà theo rủi ro, không cần làm hết.
   - **Rồi xin chủ dự án chọn phương án** (đã nêu ở DECISIONS #256 mục 5): `Idempotency-Key` chung (bảng + bộ chặn API + giao diện giữ khoá khi bấm lại; cần migration) hoặc chặn riêng từng nơi (vd Tiếp nhận: "đã có lượt khám đang hoạt động trong ngày" — cần chốt nghiệp vụ vì có ca khám nhiều lần/ngày); cảnh báo khi đóng trang có dữ liệu nhập dở; nháp ngoại tuyến cho form dài.
3. **Chờ chủ dự án xác nhận (không tự quyết)**: lỗi 4xx kiểm tra hợp lệ giữ hiện TẠI CHỖ (đã làm vậy theo ui-guidelines 4.3) hay cũng dùng hộp đè; nút "Sao chép thông tin kỹ thuật gửi hỗ trợ" (không hiển thị, chỉ chép vào bộ nhớ tạm).
4. **Dựng gói on-prem chính thức** khi sắp giao khách: cần `node scripts/release.mjs` + tag; gói sẽ mang Node 26, nginx `client_max_body_size 8m` (khách đang chạy bản cũ vẫn bị chặn tệp > 1 MB cho tới khi cập nhật ảnh web), Postgres 18.6 (`docker pull postgres:18` trước khi dựng), Caddyfile có HSTS + `handle_errors`. Nâng cấp khách cũ làm như một lần cập nhật thường (đã diễn tập 23/23).
5. Việc ngoài (như bàn giao 22/10, vẫn đúng): máy chủ pilot (S6-02 diễn tập phục hồi, S6-04 đo tải thật, phát hành `1.0.0` sau pilot), hạ tầng SaaS (chờ báo giá), cổng đơn thuốc (chờ đơn vị vận hành), CSP vẫn Report-Only (giữ tới sau pilot), gói thuê bao/giấy phép, gói Nhi khoa (còn 6 câu).
6. Tuỳ chọn, để dành: nâng `@testcontainers/postgresql` lên 12 (Node 26 đã đủ điều kiện); `docs/DECISIONS.md` đang ~131 KB (ngưỡng cắt 150 KB).

## 4. Bẫy/bài học phiên này (đọc trước khi làm tiếp)
- **Ảnh Node 25+ không có `corepack`** — Dockerfile cài pnpm bằng `npm install -g pnpm@9.15.9`; máy dev trước đây chạy Node 26 nhưng `engines` ghi 20 nên mọi lần "test xanh" cũ là Node 26 (đã đồng bộ: dev = CI = Docker = 26).
- **vitest 4 bỏ `**/dist/**` khỏi loại trừ mặc định** (đã thêm `exclude` cho shared/core/api); **app trong test API từng chạy job nền thật** (đã thay `ScheduleModule` bằng module rỗng ở `apps/api/vitest.setup.ts`).
- **`ApiError.message` giờ luôn đã lọc** (`friendlyApiMessage`): đừng thêm chỗ hiện `error.message` của lỗi không phải `ApiError`; lỗi hệ thống (mất mạng/5xx khi ghi) tự có hộp qua `MutationCache` — lời hộp CỐ Ý không khẳng định "chưa thực hiện" (máy chủ có thể đã ghi xong).
- Màn lỗi toàn cục: route MỚI ngoài nhóm `AppShell` phải tự gắn `errorElement: <RouteErrorScreen />`; trong nhóm đó đã có sẵn.
- React 18 StrictMode chạy hàm khởi tạo `useState` HAI lần (dev): đọc cờ phải thuần, xoá cờ trong `useEffect` (lỗi thật tôi đã mắc ở lời nhắn hết phiên).
- Kịch bản Chrome: chặn mô-đun trang phải chặn ĐÚNG các trang lazy (lấy từ router), chặn nhầm trang tải sẵn → cả ứng dụng không khởi động (màn hình trắng) và kết quả 0/N sai.
- nginx mặc định chặn thân > 1 MB bằng HTML 413 thô — đã sửa trong repo, nhưng chỉ có tác dụng khi triển khai ảnh `nexamed-web` mới.
- `.dockerignore` nay loại `apps/api/.env`, `**/.scripts-dist` (lần đầu `apps/api/.env` của máy dev lọt vào ảnh kiểm tra).

## 5. Môi trường dev (trạng thái để lại)
- Đã TẮT: Vite 5173, API 3001, cửa sổ Chrome có giao diện, container thử. Postgres dev = container `nexamed-postgres-1` **18.6** (cổng 5433, dữ liệu giữ nguyên). Muốn chạy lại: `pnpm dev`, hoặc `node dist/main.js` (API) + `pnpm exec vite --port 5173`.
- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345`, `apps/web/public/config.json` giữ nguyên. **Công ty thử dùng một lần `01a1628b-3b77-702e-b929-2c4a75aaa460`** (cùng tài khoản; chứa dữ liệu thử `ZZPERF…`/`ZZDUP…`, có 2 lượt khám trùng của thử nghiệm) — dùng nó cho thử nghiệm ghi trùng/đo tải, đừng dùng công ty cố định. Tạo công ty thử mới: `pnpm --filter @nexamed/api run db:seed:dev-tenant`.
- Chạy kiểm giao diện: `playwright-core` cài ở một thư mục tạm có `package.json` (`npm i playwright-core@1.49.1`) rồi `PLAYWRIGHT_CORE=<thư mục>/node_modules/playwright-core node scripts/ui-audit/error-states.cjs` (xem `scripts/ui-audit/README.md`).
- Các kịch bản dùng một lần của phiên (đo RAM Node 20/24/26, diễn tập nâng cấp Docker, thử sập CSDL bằng `docker kill`, thử nginx/Caddy) nằm ở thư mục tạm của phiên và **sẽ mất**; kết quả và cách làm đã ghi ở DECISIONS #252/#253/#256.
- Máy khác cần: `pnpm install`, dùng Node 26.

## 6. Đọc gì trước khi tiếp tục
`docs/CURRENT.md` → `docs/DECISIONS.md` **#253 (Node 26), #254 (CI), #255 (lỗi giao diện + làm nốt), #256 (mất kết nối, đo thật)** → mục 3 của file này. Ghi nhớ của AI (`memory/`) đã cập nhật.
