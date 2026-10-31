# HANDOFF — Gợi ý theo cơ quan + Ghi chú phát hành (trang Cập nhật, bộ cài) — 2026-10-30 phần 3

> Hội thoại luôn tiếng Việt. Commit/push thẳng `master` CHỈ khi chủ dự án yêu cầu. Trước khi push: `pnpm typecheck` + `pnpm lint` + test liên quan; full API ĐÚNG 1 lượt (tắt dev server trước).

## Trạng thái một câu
**CẬP NHẬT CUỐI PHIÊN (30/10/2026): mục 1–4 bên dưới ĐÃ LÀM** (kiểm Chrome thật qua IP LAN HTTP, kiểm bộ cài với thư mục giả, test `detect()`, full API, ghi DECISIONS #271 + CHANGELOG/CURRENT/TASK/Deploy.md). Chỉnh theo chủ dự án khi xem: nút chuyển thành **icon có chú thích**, ô "Kết quả khám bộ phận" **5 dòng**, nét chữ danh sách ghi chú **400**, và **BỎ "Các bản trước"** khỏi trang Cập nhật (chủ dự án chốt chỉ hiện bản đang chạy); bộ cài cũng chỉ hiện ghi chú của **bản sắp cài** (chủ dự án chốt lại, không gộp các bản ở giữa). Đã **dọn** endpoint `release-notes`, trường `previous`, `selectReleaseNotesHistory` (trang đọc `notes` của `GET /system/version`). Dữ liệu thử `[TEST]` đã đổi sang "Khám thử". Chi tiết ở `docs/DECISIONS.md` #271.
**Còn lại**: (a) CI GitHub sau khi push (máy không có `gh`; dùng REST + credential Git, SHA ĐẦY ĐỦ 40 ký tự); (b) kiểm bộ cài trên Docker/Windows sạch thật; (c) **chữ ký điện tử vs Thông tư 13/2025: chủ dự án chốt LÀM SAU** (đã ghi vào TASK, chưa code). Test cuối: full API 121 file / 1881 test đạt; shared 116, core 595, web 489, setup 112.

Trạng thái trước đó của phiên: code đã viết xong, test xanh, **ĐÃ commit + push (`877f8d4`)**.

Mockup đã chốt (chủ dự án "chốt mockup làm sát"): https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT. Câu trả lời đã chốt: (1) 10 cơ quan cố định nhưng bác sĩ ẩn/hiện được; (2) chèn vào CUỐI ô, dòng tiêu đề trống tự bỏ khi lưu; (3) trang Cập nhật hiện bản đang chạy + các bản trước (tối đa 10) — SAU ĐÓ chốt lại: chỉ bản đang chạy; (4) bộ cài hiện ghi chú MỌI bản từ bản đang chạy đến bản sắp cài — SAU ĐÓ chốt lại: chỉ bản sắp cài.

Việc thứ ba ("đợt theo dõi"/liên kết tái khám): chủ dự án chốt **ĐỂ DÀNH cho gói Sản/Nhi** (khi làm thì lễ tân chọn lượt gốc lúc Tiếp nhận) — KHÔNG làm đợt này.

## Đã làm
**A. Gợi ý theo cơ quan (chỉ web)**
- `apps/web/src/features/encounter/organ-suggestions.ts` (logic thuần: `ORGAN_SYSTEMS` 10 mục theo mẫu Nội khoa 01/BV-01, `organsPresent`, `insertOrganHeadings`, `stripEmptyOrganHeadings`) + `organ-suggestions.spec.ts` (15 test).
- `OrganSuggestionMenu.tsx`: nút "Gợi ý theo cơ quan" + hộp chọn; "Ẩn/hiện cơ quan" dùng `useColumnVisibility` (localStorage, khoá `nexamed:organ-suggestions:v1:<tenant>:<user>`) — nhớ theo tài khoản TRÊN MÁY ĐANG DÙNG, không đồng bộ giữa các máy.
- `EncounterConsultationPage.tsx`: nhãn + nút ở ô "Kết quả khám bộ phận", `handleInsertOrgans` (đặt con trỏ sau dấu hai chấm dòng đầu), `stripEmptyOrganHeadings` chỉ áp ở payload gửi đi (`buildClinicalNotePayload`), ô trên màn hình giữ nguyên để bác sĩ gõ tiếp.

**B. Ghi chú phát hành**
- core: `selectReleaseNotesHistory` (`packages/core/src/version/release-notes-history.ts`, 6 test) — lấy bản THẤP HƠN bản đang chạy, mới nhất trước, tối đa N.
- shared: `releaseNotesHistorySchema`, `RELEASE_NOTES_HISTORY_LIMIT = 10` (`software-update.ts`).
- API: `GET /system/update/release-notes` (quyền `software_update.read`, SaaS trả 404) → `{ current, previous[] }`; `SystemVersionService.getReleaseNotesHistory()` đọc mọi `apps/api/release-notes/*.json` (bỏ file sai định dạng, tên file phải khớp phiên bản); đăng ký OpenAPI; test trong `software-update-http.spec.ts`.
- Web: `ReleaseNoteGroups.tsx` (dùng chung), `BundledReleaseNotes` trong `SoftwareUpdatePane.tsx` ("Có gì mới trong bản X" + `<details>` "Các bản trước (N)"), `getReleaseNotesHistory` + `useReleaseNotesHistoryQuery`.
- Bộ cài `apps/setup`: `src/lib/release-notes.ts` (`loadBundledReleaseNotes`, `notesForUpgrade`, 7 test), `DetectView.releaseNotes`, khối "Có gì mới từ X lên Y" ở `public/app.js` (+ `styles.css`) trong bước "Bản đang chạy và bản mới" (CHỈ khi nâng cấp, không hiện khi cài mới / đã là bản mới nhất / gói không có ghi chú). `deploy/on-prem/build-and-export.ps1` chép `apps/api/release-notes/*.json` vào `<gói>/release-notes/`.

## Kiểm (đã làm)
core 601, shared 116, web 489, setup 107, API nhóm liên quan 35 (`software-update`, `system`, `medical-record-http`); `pnpm typecheck` + `pnpm lint` toàn cục sạch.

## Việc kế tiếp (theo thứ tự) — mục 1–4 ĐÃ LÀM cuối phiên, chỉ còn mục 5 + các việc ở đầu file
1. **Kiểm Chrome thật** (localhost VÀ IP LAN HTTP `pnpm dev:lan`, 10 cỡ màn hình 390→3840; script mẫu ở scratchpad phiên trước — viết lại nếu mất, dùng `playwright-core` ở thư mục tạm):
   - Màn khám: mở lượt đang khám → "Gợi ý theo cơ quan" → chọn 2 cơ quan → "Chèn vào ô (2)" → con trỏ đúng chỗ; cơ quan đã có thì mờ "(đã có trong ô)"; "Ẩn/hiện cơ quan" rồi tải lại trang vẫn nhớ; để trống một dòng rồi Lưu nháp + tải lại → dòng trống mất, dòng có chữ còn; hoàn tất khám; lượt đã hoàn tất (chỉ đọc) KHÔNG hiện nút.
   - Trang `/admin/system-config` → pill "Cập nhật phần mềm": khối "Có gì mới trong bản 0.9.0" hiện đúng; "Các bản trước" KHÔNG hiện (dev chỉ có `0.9.0.json`); chặn/giả lập lỗi `GET /system/update/release-notes` (503, mất mạng) → khối báo lỗi tiếng Việt + nút thử lại, phần còn lại của trang vẫn dùng được (checklist `ui-guidelines.md` mục 17b).
   - Bộ cài: dựng thử gói/Docker hoặc chạy `apps/setup` với thư mục giả có `.env` (VERSION cũ) + `images/` + `release-notes/` → bước "Bản đang chạy và bản mới" hiện khối "Có gì mới".
2. **Thêm test** `service.detect()` trả `releaseNotes` (mẫu `apps/setup/src/service-install-retry.spec.ts` dòng ~122–150) — chưa có, không chặn.
3. **Full API 1 lượt** (tắt dev server trước), rồi **CI GitHub** sau push (máy không có `gh`; xem trang Actions).
4. **Ghi tài liệu**: DECISIONS #271, CHANGELOG, CURRENT, TASK (xoá/cập nhật mục "Danh sách thay đổi khi cập nhật phần mềm…" `[ ]` ở TASK), `docs/Deploy.md` (gói cài giờ có thư mục `release-notes/`; mọi bản phát hành phải có file ghi chú, `release.mjs` đã bắt buộc).
5. **Chủ dự án cần quyết, CHƯA làm**: đối chiếu "chữ ký logic" với Điều 3 Thông tư 13/2025 và mốc 31/12/2026 — chữ ký logic (`signed_at`/`signed_by`, `signaturePayload: null` ở `noop.adapter.ts`) chỉ có thể xếp vào "hình thức xác nhận điện tử khác" (khoản 4 Điều 22 Luật Giao dịch điện tử 2023 → "thực hiện theo quy định khác của pháp luật có liên quan", chưa xác định văn bản nào); KHÔNG đạt chuẩn "chữ ký điện tử chuyên dùng" (khoản 2) hay "chữ ký số" (khoản 3). Phương án rẻ: lưu mã băm SHA-256 nội dung lúc ký; mức cao: ký số qua CA vào `SignaturePort`. Nên hỏi Sở Y tế/luật sư.

## Lệch/điểm cần biết so với mockup (báo chủ dự án khi kiểm xong)
- "Ẩn/hiện cơ quan" là phần mockup chưa vẽ (chủ dự án yêu cầu thêm lúc trả lời câu hỏi): thiết kế là link nhỏ ở đầu hộp chuyển sang chế độ tích chọn hiển thị từng cơ quan + "Hiện tất cả"; lựa chọn lưu ở trình duyệt, không đồng bộ giữa máy.
- Trang Cập nhật: khối ghi chú đặt sau "Phiên bản hiện tại", trước "Kết quả kiểm tra", đúng mockup; dùng `BoxedSection` sẵn có (không phải thẻ tự vẽ).
- Dev chỉ có `0.9.0.json` nên "Các bản trước" chưa thấy được bằng mắt; logic đã test bằng unit test.

## Bẫy
- Shell ăn dấu `\` khi vá bằng `node -e`/here-doc: dùng công cụ Write + `node scripts/patch-file.mjs <edits.json>` (đã dính lại lúc sửa `build-and-export.ps1`).
- Sau khi đổi `packages/core`/`packages/shared` phải `pnpm --filter @nexamed/core build` / `@nexamed/shared build` VÀ khởi động lại API (nạp bản dựng một lần).
- KHÔNG bật hai API cùng cổng 3001 (`pnpm dev` đã có watcher). Máy dev ít RAM (~600 MB trống): Chrome tự động chết khi quét nhiều trang; `spawnSync` với pipe làm treo — ghi stdio ra file; tắt dev server trước khi chạy full API.
- `dev:lan` đổi `apps/web/public/config.json` (cổng 5173 mất địa chỉ API khi nó chạy) — kiểm qua cổng 5174; tự khôi phục khi thoát.
- Chú thích ở mockup chỉ để duyệt, không chép vào sản phẩm.
