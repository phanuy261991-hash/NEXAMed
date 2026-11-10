# HANDOFF — Nâng zod 3 → 4 (ĐANG DỞ, chưa commit) + #291 hoàn tất — 2026-11-10 (phần 11)

## 1. Trạng thái một câu
`master` = `d5a3351`, đã push, CI các commit trước xanh. **Việc nâng zod 3 → 4 đang dở: 11 file ĐÃ SỬA NHƯNG CHƯA COMMIT** trong `C:\Projects\NEXAMed`. Mọi kiểm tra đã chạy đều đạt, còn vài bước chốt (mục 4). Gói #291 (gửi mẫu đối tác) đã xong hết.

## 2. Đã xong và đã push trong phiên này (chi tiết ở `docs/DECISIONS.md` #291 bổ sung 7–10)
- Kết quả PDF của đối tác hiện đúng ở màn kết quả + bản in (`contentType` ở phiếu kết quả).
- GĐ4: bảng kê mẫu gửi đối tác (tab "Mẫu đã gửi" trang chi tiết đối tác), phụ lục ở hộp "Lập biên bản đối chiếu", dải số, Excel + In. Đột biến 15/15.
- Excel giá trả đối tác (file riêng, menu "Giá trả (Excel)" ở Danh mục Cận lâm sàng › Đối tác xét nghiệm). Mockup https://claude.ai/artifact/4AtH14tpo6mdrCAU3mvxVV đã chốt + 5 câu. Đột biến 14/15 (1 tương đương).
- Bộ hồ sơ bệnh án một lượt khám ghép nguyên PDF đối tác vào cuối (`pdf-lib` 1.17.1, `apps/api/src/common/pdf-merge.ts`). Đột biến 5/5.
- Nâng `multer` ^2.5.0 và `body-parser` ^2.4.0 qua `pnpm.overrides`.
- Commit 8 script `docs/handoffs/assets/hoahung-seed/` (lint bỏ qua `docs/handoffs/assets/**`); chúng chứa mật khẩu demo `HoaHung@2026`.
- Thẻ số `StatCardRow` (dùng chung 15 nơi) đổi nhãn sang 15px đậm 600 chữ tối, không in HOA (chủ dự án nhắc).

## 3. ĐANG DỞ — nâng zod 4 (chưa commit)
Lý do: `pnpm audit --prod` báo zod `<4.6.6` (hết bộ nhớ khi kiểm mảng quá lớn); bản vá chỉ có ở 4.x.

**11 file đã sửa:**
- `apps/api/package.json` (zod `^4.6.7`, `@asteasolutions/zod-to-openapi` `^9.1.0`, `puppeteer-core` `^25.16.0` — bản này kéo `chromium-bidi` dùng zod 4, dứt điểm đường zod 3 còn lại), `apps/web/package.json`, `packages/shared/package.json`, `pnpm-lock.yaml`.
- `eslint.config.js`: luật `no-restricted-syntax` chặn `z.record(<Identifier>, …)` ở shared/core/api (không-spec).
- `apps/api/src/modules/clinic/clinic-settings.repository.ts`: `z.record` → `z.partialRecord` (xem bẫy dưới).
- `packages/shared/src/paraclinical-result.ts`, `print-template.ts`: thêm `eslint-disable-next-line` giải thích (hai chỗ này luôn trả đủ khoá).
- `apps/api/src/common/jwt-auth.guard.spec.ts`: UUID giả → UUID hợp lệ (`…-4111-8111-…`).
- `apps/api/openapi/openapi.json`, `apps/web/src/shared/api/openapi-schema.d.ts`: sinh lại (chỉ khác lành tính: enum nullable có thêm `null`; thêm `pdfCount` đã lệch từ trước).

**Bẫy duy nhất tìm thấy (zod 4 đổi ngữ nghĩa, KHÔNG báo lỗi biên dịch):** `z.record(<enum>, v)` bắt buộc đủ mọi khoá. Cấu hình lưu thưa (mẫu mã phát sinh `business_code_templates`) đọc bằng `z.record` bị coi là sai và **rơi về mặc định một cách im lặng** (34 test đỏ ở 7 file prescription/business-code/interop). Đã sửa + có luật lint. Cũng lưu ý: `z.string().uuid()` kiểm bit phiên bản/biến thể (UUID thật từ `uuidv7()`/`randomUUID()` đều hợp lệ; 4 chuỗi giả chỉ nằm trong spec).

**Đã kiểm, đều đạt:** `pnpm typecheck` 5 workspace sạch; test shared 127, core 815, web 739, setup 112, **API 2236** (sau sửa); dữ liệu thật CSDL dev đọc đúng dưới zod 4 (business_hours 3/3, print_template 14/14, các cờ tenant_setting là boolean/int); `perf:load:write` 28/28 lượt khám trọn vẹn, 0 lỗi, p95 96 ms; Chrome thật `lab-partner-statement-check` 28/28 và `lab-partner-price-import-check` 22/22; test dựng PDF qua puppeteer mới (22 file/226 test) qua; `pnpm audit --prod` = **không còn lỗ hổng**.

## 4. VIỆC KẾ TIẾP (theo thứ tự)
1. `pnpm install` (package.json + lockfile đã đổi), `pnpm --filter @nexamed/shared build`, `pnpm --filter @nexamed/core build`.
2. **Chủ dự án quyết:** dung lượng bundle web. Zod 4 chỉ dùng ở `apps/web/src/app/config.ts` (kiểm cấu hình lúc khởi động). Đo bằng build thật: chunk `vendor` 343,7 → 374,8 kB (gzip 105,3 → 117,4 kB, **+12 kB**), chunk `index` không đổi (616,25 kB). Hoặc chấp nhận, hoặc thay bằng kiểm tra viết tay (bỏ zod khỏi web).
3. `pnpm typecheck` + `pnpm lint` + full API 1 lượt (tắt dev server trước, ~11 phút) rồi commit + push + kiểm CI (`curl https://api.github.com/repos/phanuy261991-hash/NEXAMed/actions/runs?branch=master&per_page=1`). Gợi ý: `chore(deps): nâng zod 4, zod-to-openapi 9, puppeteer-core 25.16`.
4. Ghi tài liệu: `docs/DECISIONS.md` #291 bổ sung 10 còn câu "zod CHƯA nâng được…" nay LỖI THỜI (đã nâng); thêm quyết định mới (số kế tiếp sau #292) về zod 4: lý do, bẫy `z.partialRecord`, luật lint, UUID nghiêm, +12 kB bundle, `puppeteer-core` 25.16; cập nhật `docs/CURRENT.md` (dòng "Phụ thuộc") và `docs/CHANGELOG.md`; `.claude/docs/coding-standards.md` thêm quy ước `z.partialRecord`.
5. (Tuỳ chọn) 4 cảnh báo `pnpm audit` mức dev MỚI: `undici` 7.30.0 (cần ≥7.30.1), `glob`, `minimatch`, `deepmerge` — chỉ công cụ dev, chưa xử lý.
6. Việc còn của #291: quét quyền phần `params`/`custom` của `role-access-sweep.cjs` cần ngăn xếp có proxy `/api` (không chạy được trên Vite dev — phần `default` đã đạt).

## 5. Môi trường + bẫy
- **Dev server đang chạy** (API 3001, web 5173). Tắt trước khi chạy full API hoặc `prisma generate`/`pnpm install` (EPERM, "paging file too small"). `config.json` đang trỏ tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`.
- **Worktree tạm** ở `C:\Users\Administrator\AppData\Local\Temp\claude\f2e65e53277f4ada\075d7af4-9351-4c5f-8b57-04d3befdb332\scratchpad\wt` (HEAD, dùng đo bundle zod 3): `git worktree remove --force <đường dẫn>` rồi `git worktree prune`.
- Vá file dùng `node scripts/patch-file.mjs <edits.json>` (an toàn CRLF và dấu `\`); viết JSON bằng công cụ Write, KHÔNG dùng heredoc shell (nuốt `\\`).
- Dữ liệu thử `KIEM-GM …` ở công ty test cố định; script kiểm Chrome có đường khôi phục giá (giá dịch vụ thử gốc 150.000đ). Playwright cài ở scratchpad (`…/scratchpad/pw`), cần `PLAYWRIGHT_CORE`.
- Test chập chờn khi cả bộ chạy tải nặng (đã gặp 2 lần: `medical-record` hook timeout, `icd10` 500 thoáng qua), chạy riêng thì qua. Nếu tái diễn hãy dò cạn bể kết nối (#264).
- Quy tắc thường trực: 4 câu chi nhánh, LAN HTTP, màn lỗi + xử lý lỗi, quyền (nhãn nhóm + ma trận + `db:seed`), Excel + In cho báo cáo, chữ giao diện ngắn không viết HOA, commit/push thẳng master.
