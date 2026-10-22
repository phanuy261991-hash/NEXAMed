# HANDOFF — Nét chữ ô nhập, vá thư viện, NestJS 11, đo tải đọc/ghi, danh sách trong ngày tải theo lô — 2026-10-22 (phần 2)

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`**, không nhánh/PR. UI mới phải có mockup chủ dự án DUYỆT RÕ ("duyệt"/"làm đi") rồi mới sửa code; mockup đăng bằng Artifact HTML thường (loại "Design canvas" bị chặn quyền đọc tệp). Ảnh kiểm tra để ở scratchpad, KHÔNG vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test và báo kết quả (kèm cô lập tenant/chi nhánh). Shell ăn dấu `\` và heredoc dài hay hỏng → dùng công cụ Write tạo file `.cjs` rồi `node`, đừng dán script dài vào lệnh.
> Quy ước tài liệu dài (CLAUDE.md): chỉ đọc file gốc. `docs/DECISIONS.md` **#246–#251 là mới nhất** (phiên này).

## 0. Trạng thái một câu
Phiên 22/10/2026 phần 2 đã xong: chuẩn nét chữ ô nhập 400 (#246), vá thư viện + nâng **NestJS 11** (`pnpm audit --prod` = 0 cảnh báo, #247/#249), công cụ đo tải **luồng ghi** + 2 lỗi mã đơn thuốc tìm ra và đã sửa (#248), hộp thoại "Đổi mã tên miền" làm lại theo mockup duyệt, tăng tốc + **tải theo lô khi cuộn** cho "Bệnh nhân trong ngày" và "Thu ngân" (#250/#251). **Không còn việc treo có thể làm một mình**; mọi việc còn lại cần máy chủ pilot / hạ tầng / đơn vị vận hành / quyết định mới của chủ dự án.

## 1. Đã xong và đã push (HEAD `acc0ba1`, working tree sạch)
| Commit | Nội dung |
|---|---|
| `7a51f03` | #246 — nét chữ giá trị MỌI ô nhập 600 → 400: luật `@media screen` ở `app/index.css`, ~140 chỗ/86 file, `weight-audit` có vai trò "giá-trị-ô-nhập" (270 ô đo 400), ui-guidelines 4.1c/16. Chủ dự án duyệt sau khi xem ảnh. |
| `2bbfa5c` | #247 — khối `pnpm.overrides` (multer, lodash, proxy-addr, brace-expansion, qs, body-parser, uuid): phần chạy thật từ 1 nghiêm trọng + 11 cao + 13 trung bình còn 0. |
| `14277c3` | #248 — `apps/api/scripts/perf-load-write.ts` (`pnpm --filter @nexamed/api run perf:load:write`, hướng dẫn `docs/Deploy.md` 2.5b). |
| `b62ebe6` | #248 — sửa ký đơn với khuôn mã tuỳ chỉnh có `[Mã cơ sở KCB]` (trước đó 400 mọi lần ký) + bộ đếm kỳ mới nối tiếp số đã cấp khi đổi khuôn giữa tháng (trước đó trùng mã → 500 kẹt mãi); spec `encounter/prescription-code-template-http.spec.ts`. Hộp thoại "Đổi mã tên miền" làm lại (`ModalHeader` + `tone="success"`), mockup https://claude.ai/artifact/KAAFi6LDmcdHgjCQSLDCtC. |
| `3dc9b3a`, `2540048` | #249 — NestJS 10 → 11 (Express 5), `forRoutes({ path: '{*splat}', method: ALL })`; kiểm thực tế 39 mục trên API chạy thật tìm ra 1 lỗi: thân yêu cầu quá lớn trả 500 thay vì 413 → `DomainExceptionFilter` nhận lỗi 4xx kiểu `http-errors` (spec `common/request-limits-http.spec.ts`). Đo argon2 3 bộ tham số → **chủ dự án chốt GIỮ NGUYÊN** (64 MB/3 vòng/song song 4). |
| `6935978` | #250 — `EncounterRepository.listForDay`, `ClinicalOrderRepository.progressForDay/progressByEncounterIds`, `InvoiceRepository.listForDay` viết lại bằng SQL gọn (cùng hợp đồng): reception p95 313 → 80 ms, thu ngân 560 → 75 ms ở 1.203 lượt/ngày. So 135 phản hồi cũ/mới trên dữ liệu thật: giống hệt (chỉ khác thứ tự các phiếu cùng một lượt khám, nay cố định). |
| `5de0818` | #251 — danh sách tải theo lô: API `limit/cursor/tab/q` (chỉ phân trang khi có `limit`), `counts`/`tabCounts`/`nextCursor`/`doctorIdsWithEncounters`; lõi `packages/core/src/list-paging/`; web `useInfiniteQuery` + `useInfiniteScrollSentinel` + `InfiniteListFooter`; spec `reception/day-list-paging-http.spec.ts` (16 ca, cô lập tenant+chi nhánh, 3 đột biến bị bắt). Mockup duyệt: https://claude.ai/artifact/7UcUL7EkvP5jV7KjR3k15b. Kiểm Chrome thật 1.203 dòng + bố cục 10 cỡ màn hình = 0 vấn đề. |
| `acc0ba1` | Ghi quyết định giữ nguyên argon2. |

## 2. Trạng thái kiểm (lần chạy cuối 22/10/2026, sau #251)
typecheck sạch · API **1687** (+1 bỏ qua) · core **528** · web **248** · shared **96** · setup **76** · lint chỉ còn 2 lỗi `any` CÓ SẴN ở `prescription-interop-gateway-http.spec.ts` (không do phiên này). Đo tải máy dev 8 CPU: đọc p95 59 ms; ghi 144–235 lượt khám trọn vẹn p95 65 ms 0 lỗi; trộn đọc+ghi: ghi p95 66 ms.

## 3. Việc kế tiếp (đều cần điều kiện ngoài — KHÔNG tự làm)
1. **Máy chủ pilot thật** (xếp đầu): chạy `perf:load` + `perf:load:write` (chỉ trên phòng khám thử!) ghi số vào `docs/GA-checklist.md` (S6-04); diễn tập phục hồi (S6-02); rồi phát hành `1.0.0` (`node scripts/release.mjs 1.0.0`).
2. **Dựng lại ảnh Docker + gói on-prem** khi sắp giao khách (chưa dựng lại cho mọi thay đổi từ 16/10, gồm NestJS 11): rồi kiểm **tắt êm bằng SIGTERM** (`docker stop` giữa lúc xuất PDF: log tắt êm, không còn Chromium mồ côi) — Windows không mô phỏng được.
3. **Hạ tầng SaaS** (chờ báo giá, `docs/product/saas-hosting-comparison.md`): DNS wildcard, chứng chỉ, proxy giữ `Host`; thử tấn công/đo qua proxy HTTPS thật. Mã tên miền địa chỉ thật = biến `PLATFORM_BASE_DOMAIN` ở `.env` của API (xem lời đáp ở hội thoại: web chỉ xem trước theo tên miền đang mở).
4. **Đơn vị vận hành cổng đơn thuốc**: gửi `docs/product/prescription-interop-questions.md`, rồi kiểm với cổng thật (liên thông GĐ3), API nhà thuốc 8e làm sau.
5. Việc nhỏ chờ chủ dự án: xoá artifact Design trống `https://claude.ai/artifact/1Zjghxuwzy22wM2CyhfttN` (tôi không tự xoá được); gói thuê bao + giấy phép ký số; gói Nhi khoa (còn 6 câu chưa chốt); CSP đang Report-Only — **chủ dự án chốt giữ tới sau pilot**.
6. Cơ hội kỹ thuật (không gấp): nâng vitest 2 → 3 (dev only, đang có cảnh báo chỉ khi bật Vitest UI); NestJS 12 đã ra (chủ dự án chọn 11); nếu một cơ sở có hàng nghìn bệnh nhân đang chờ/đang khám cùng lúc thì bảng "Tải theo Bác sĩ" (`tab=ACTIVE`, không phân trang) mới cần xem lại.

## 4. Rủi ro / bẫy đã gặp (đọc trước khi làm tiếp)
- **Truyền danh sách id lớn qua Prisma rất tốn** (~1.200 mã → ~45 ms chỉ riêng chuyển tham số, không phụ thuộc cách viết `ANY`/chuỗi/JSON). Ưu tiên lọc theo khoảng ngày/khoá. **Truy vấn trên bảng có chỉ mục từng phần PHẢI kèm `deleted_at IS NULL`** (`invoice`, `clinical_order*`…) nếu không Postgres quét tuần tự (đo 186 ms thay vì 26 ms).
- **`tsx` không dựng được DI của Nest** (thiếu metadata decorator): script cần `NestFactory` phải chạy trên `dist` bằng `node` (`pnpm --filter @nexamed/api build` trước). Script đo tải (`perf-load*.ts`) không dùng DI nên chạy `tsx` bình thường.
- **Đăng nhập giới hạn 10 lần/phút theo (IP + công ty)**: chạy hai script đo song song dễ dính 429 → cho đăng nhập xong rồi mới vào script thứ hai. Công cụ ghi **ghi dữ liệu lâm sàng không xoá được** (đã ký): chỉ chạy trên tenant thử.
- **Test API dùng container Postgres tạm**: chạy full suite KHI máy đang chạy nhiều thứ nặng khác từng làm container chết giữa chừng ("Can't reach database server") → dọn tiến trình (`taskkill //F //IM node.exe`) rồi chạy lại một mình.
- **Khuôn mã (`business_code_templates`)**: lưu khuôn tường minh đổi cách chia kỳ giờ tự nâng bộ đếm kỳ mới (`carryCounterIntoNewPeriod`); khuôn đơn thuốc có `[Mã cơ sở KCB]` cần chi nhánh/công ty có mã KCB (nếu không → 422 `PRESCRIPTION_FACILITY_CODE_MISSING`).
- **Web chỉ import KIỂU từ `@nexamed/shared`** (bản dist CommonJS): hằng/hàm giá trị dùng ở web phải khai riêng; sửa `packages/shared` hay `packages/core` thì `pnpm --filter … build` trước khi chạy API/web; sửa hợp đồng API thì `pnpm --filter @nexamed/api run openapi:generate` rồi `pnpm --filter @nexamed/web run api:codegen`.
- Chân danh sách/phần tử nằm TRONG vùng cuộn ngang của bảng bị cắt mép phải khi màn hẹp (chủ dự án phát hiện) → luôn đặt ngoài vùng cuộn ngang (ui-guidelines 9h).

## 5. Môi trường dev (trạng thái để lại)
- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345`; `apps/web/public/config.json` đã khôi phục về tenant này + `apiBaseUrl http://localhost:3001` (khi dựng thử SaaS cục bộ phải đổi tạm thành `{"apiBaseUrl": ""}` + `DEPLOYMENT_MODE=saas PLATFORM_BASE_DOMAIN=localhost TRUST_PROXY_HOPS=1` + `VITE_DEV_API_PROXY=http://localhost:3001 npx vite`, rồi KHÔI PHỤC).
- Dữ liệu thử do đo tải: ~1.200 bệnh nhân/lượt khám `ZZPERF …` ngày 22/10 (đã ký/hoàn tất, không xoá được), 11 tài khoản `zzperf.*` (mật khẩu `Perf@12345678`), khuôn mã đơn thuốc đang là `DTQ[Năm 2 số][Tháng][Số đếm]` (chế độ CUSTOM) để tránh đụng mã cũ. Tài khoản vận hành nền tảng thử `zz.vanhanh.kiem` / `Kiem@Dev12345` (bí mật OTP chỉ ở scratchpad phiên, KHÔNG trong repo) và công ty thử đã đổi mã vài lần — chỉ DB dev.
- `nexamed_app` từng mất quyền `DELETE` trên `user_session` dù migration đã áp (nguyên nhân chưa rõ, không do mã trong repo): đã cấp lại bằng `GRANT DELETE ON user_session TO nexamed_app` — nếu job dọn phiên báo `permission denied` ở môi trường nào, chạy lại câu này.
- Máy khác cần `pnpm install` (overrides + NestJS 11), `db:deploy` (các migration đã nêu ở CURRENT.md), `db:seed`, rồi khởi động lại API. Không có migration mới trong phiên này.

## 6. Đọc gì trước khi tiếp tục
`docs/CURRENT.md` → `docs/DECISIONS.md` #246–#251 → file này. Ghi nhớ của AI (`memory/`) đã cập nhật.
