# HANDOFF — Hình ảnh & Tài liệu / Đính ảnh ở màn khám / Chế độ DICOM / Thanh tab màn khám — chốt phiên 2026-11-17

(Tên file giữ nguyên vì CURRENT.md và memory đang trỏ tới; nội dung đã bao trùm GĐ1–GĐ3 và mọi việc của phiên 17/11/2026.)

## 1. Trạng thái một câu
**Mọi việc đã giao đều LÀM XONG, ĐÃ ĐẨY lên `master` (HEAD `152f65ca`), cây làm việc sạch.** Còn đúng một việc: **dựng gói cài on-prem** để giao khách — chưa làm vì cần chủ dự án chốt số phiên bản (mỗi lần dựng sinh số phiên bản + release notes).

Các commit của phiên: `16cea33c` (hoàn thiện tab, #299 bổ sung 5) → `1bf46b46` (thanh tab không cuộn, #300) → `28dea084` (tab Hình ảnh + hộp Đính ảnh ở màn khám) → `978e3f07` (chế độ DICOM) → `152f65ca` (dải "Tệp DICOM gốc" ở hộp xem kết quả).

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #299), `docs/DECISIONS.md` cuối file (#300 và #299 bổ sung 5–6, gồm "Đợt 2", "Đợt 3" và bổ sung đợt 3), file này.
2. Hỏi chủ dự án số phiên bản cho gói on-prem rồi dựng: `deploy/on-prem/build-and-export.ps1` chạy bằng `powershell -File`, cần `release-notes/<số>.json`, mỗi lần dựng phải đổi số (setup từ chối cùng số); diễn tập nâng cấp = chép chồng vào `C:\NEXAMed-onprem-test` rồi chạy setup ở đó. **Ảnh web phải dựng lại** vì `deploy/on-prem/nginx.conf` có thêm khối cho đường dẫn đính DICOM (`client_max_body_size 52m`) bên cạnh khối tab tài liệu (17m).
3. Máy khác (không phải máy dev) cần: `pnpm install` (có thêm thư viện `dicom-parser`), `pnpm db:deploy` (migration mới nhất vẫn là `20261114150000_patient_document_thumbnail`; **đợt 2, đợt 3 và thanh tab KHÔNG thêm migration**), khởi động lại API. Không cần `db:seed` (không thêm quyền mới).

## 3. Đã làm (tóm tắt, chi tiết ở DECISIONS/CHANGELOG)
**Tab Hình ảnh & Tài liệu của hồ sơ bệnh nhân (#299)**: GĐ1–GĐ3 như các bản bàn giao cũ (đã gỡ). Hoàn thiện ngày 17/11 (bổ sung 5): ảnh thu nhỏ BÙ do trình duyệt tạo cho tệp cũ và dòng tự gộp (không thêm `sharp` vào máy chủ), thanh dung lượng = % ổ chứa kho đã đầy (phương án B), khung PDF xem lớn sửa, quét quyền vai trò đạt, `CLAUDE.md` cập nhật.

**Thanh tab màn khám (#300, Cách 2)**: `shared/ui/OverflowTabs.tsx` + `overflow-tabs-layout.ts` — nhãn rút ngắn ("Điều trị & Tái khám", "Chỉ định CLS", "Kết quả CLS", "Vật tư"), hết chỗ thì tab ưu tiên thấp vào nút "Thêm ▾", tab đang chọn luôn hiện, không còn cuộn ngang. Thêm tab mới chỉ cần khai báo `priority`. `ui-guidelines.md` mục 15a.

**Đính ảnh ở màn khám (#299 bổ sung 6, Đợt 2)**: tab "Hình ảnh" (`EncounterImagesTab`, lọc theo loại, số trên tab, xem lớn) + hộp "Đính ảnh" (`DocumentUploadDialog` chế độ `encounter`: gắn sẵn lượt khám, ô Loại chung Ảnh lâm sàng/Khác, dán Ctrl+V). `GET /patients/:id/documents` nhận `encounterId`. Lượt khám đã hoàn thành vẫn đính thêm được (thẻ "Bổ sung"). Nút "Chụp ảnh" (camera điện thoại) chỉ hiện trên máy cảm ứng.

**Chế độ DICOM tuỳ chọn (#299 bổ sung 6, Đợt 3)**: công tắc `dicomEnabled` (mặc định TẮT = như cũ; dòng dưới "Dùng Hình ảnh & Tài liệu" ở Cấu hình chung). Bật: (1) khối "Tệp DICOM gốc" ở màn nhập kết quả chẩn đoán hình ảnh (≤ 4 tệp, 50 MB, `POST /paraclinical/imaging/items/:itemId/dicom`, tệp nằm chung bảng `paraclinical_result_image` phân biệt `content_type='application/dicom'`, không lẫn vào `images`/phiếu in); (2) trình xem DICOM trong trình duyệt `features/dicom/` (`dicom-parser` + `dicom-decode.ts`: không nén Little Endian, đơn sắc 8/16 bit, RGB, nhiều khung, JPEG baseline do trình duyệt giải mã; nén khác → "Tải về"); (3) dải "Tệp DICOM gốc" ở hộp Xem kết quả (ngoài tờ phiếu); (4) tab hồ sơ/tab Hình ảnh của màn khám bấm tệp DICOM mở trình xem. Tên khác hồ sơ → cảnh báo vàng "Vẫn xem". Esc trong trình xem chỉ đóng lớp trên cùng.

**Kiểm lần cuối**: Chrome qua IP LAN — `consultation-tabs-check.cjs` 23/23, `encounter-images-check.cjs` 25/25, `dicom-check.cjs` 41/41. API đầy đủ 2427 đạt (2 tệp lỗi do tải máy khi chạy song song với lint/web, chạy riêng đạt 36/36), core 900, shared 136, web 844, setup 112, typecheck + lint toàn cục sạch. Lần chạy API đầy đủ gần nhất KHÔNG gồm dải ở hộp xem kết quả (chỉ web) — nên chạy lại một lượt đầy đủ trước khi đóng gói.

## 4. Việc còn / cần chủ dự án
- **Dựng gói cài on-prem** (mục 2).
- **Chủ dự án xem các chỗ khác mockup** (ghi ở DECISIONS #299 bổ sung 6): nút Chụp ảnh nay chỉ hiện trên máy cảm ứng ở CẢ hộp "Tải lên" của tab hồ sơ; thẻ "Bổ sung" ở góc ảnh; hàng DICOM không ghi số khung; cột chi tiết trình xem chỉ một chuỗi ảnh; bỏ các câu gợi ý của mockup (quy tắc không chép ghi chú duyệt); thanh tab giữ icon từ 1440px (mockup không vẽ).
- **Khi làm SaaS**: chốt cùng lúc adapter kho đối tượng cho `StoragePort` (cần `sizeOf`/`volumeUsage`), hạn mức dung lượng theo công ty (thay thanh "% ổ đĩa"), giới hạn tải lên riêng cho DICOM ở bộ chia tải, camera chỉ khi có HTTPS. Trình xem chạy ở trình duyệt nên không đổi.
- Chưa làm (ngoài phạm vi): gói Nha khoa, PACS, kết nối máy chụp, đọc DICOM nén JPEG 2000/JPEG-LS/RLE, công cụ đo/vẽ trên ảnh. Quy tắc thường trực: mọi file gắn bệnh nhân làm sau phải gộp về tab Hình ảnh & Tài liệu.

## 5. Bẫy đã gặp (đọc trước khi làm)
- **Tải tệp lớn phải kiểm qua nginx thật**, không chỉ Vite dev proxy (nginx từng chặn 413 tệp 9–15 MB mà dev không thấy). Cách kiểm nhanh: container `nginx:alpine` với `--add-host api:host-gateway` + máy chủ Node giả ở cổng 3000, `curl --data-binary @tệp`. Đường dẫn tải tệp mới nào > 8 MB đều cần khối `location` riêng + test chống lệch ở `patient-document-constants-drift.spec.ts`.
- **`apps/web` chỉ import KIỂU từ `@nexamed/shared`**: hằng số dùng ở web phải khai lại và có test chống lệch ở API (ví dụ hạn mức DICOM ở `ResultDicomPanel.tsx`).
- **`prisma format` căn lại cả model khác** khi tên trường mới dài hơn → đặt tên trường ngắn. **`prisma migrate deploy` bằng role ứng dụng để lại bản ghi "failed"**: luôn `pnpm db:deploy`; lỡ thì `pnpm exec node scripts/with-migrate-url.mjs migrate resolve --rolled-back <tên>`. **`prisma generate` EPERM** khi còn tiến trình Node giữ engine.
- **dev-lan**: cần API chạy riêng (`pnpm --filter @nexamed/api dev`, cổng 3001); IP LAN đổi theo mạng (đọc dòng "Network"); tắt bằng `taskkill` thì `config.json` KHÔNG tự trả về — khôi phục từ `config.json.lan-backup`, xoá bản sao lưu, `git status apps/web/public` phải sạch.
- **Script kiểm không được tin "đã dọn xong"**: khoá tài khoản thử bằng `PATCH /users/:id {isActive:false, version}`, liệt kê lại theo ĐÚNG tiền tố; phiên bị ngắt có thể để công tắc ở trạng thái sai (kiểm `GET /clinic-settings/...-enabled`).
- **Công cụ Edit/Write giải mã `\uXXXX`** trong tham số: dùng `\p{M}` (cờ `u`) hoặc `String.fromCharCode`. **Shell ăn dấu `\` và backtick** (đã làm hỏng regex nhiều lần): vá bằng Write một tệp `.cjs` rồi `node`, luôn `node --check`.
- **Playwright**: `setInputFiles({buffer})` tối đa 50 MB (tệp lớn hơn ghi ra đĩa rồi truyền đường dẫn); Chrome ngầm không vẽ trình xem PDF (cần `headless:false`); cache react-query che trạng thái lỗi (tải lại trang trước khi chặn mạng); `ToggleSwitch` là `<input type="checkbox" class="sr-only">` (dùng `getByRole('checkbox')` rồi bấm nhãn `xpath=ancestor::label`).
- **Máy chủ coi hai tệp giống hệt nhau (cùng loại/ghi chú) đính liền nhau là một lần gửi lại** (`Idempotency-Key`) nên chỉ lưu một; tên tệp có dấu bị multer đọc sai nên test dùng tên ASCII.
- **Thanh tab**: bản sao ẩn để đo phải bọc trong khung 0×0 `overflow-hidden` (nếu không kéo giãn `scrollWidth` của trang); hàm chia tab coi bề rộng 0 (chưa đo/jsdom) là "hiện hết".
- **Hộp chồng nhau cùng nghe Esc**: lớp trên phải bắt ở capture + `stopImmediatePropagation` (như `DicomViewerDialog`) kẻo đóng cả lớp dưới.
- **Chạy test song song làm lệch thời gian**: hai tệp API (`technical-service-import-http`, `medical-record-http`) từng lỗi khi chạy cùng lint + web; chạy riêng thì đạt. Chạy bộ đầy đủ một mình.

## 6. Quy tắc chủ dự án nhắc (đã ghi memory)
- Tuân thủ mockup tuyệt đối, đối chiếu từng phần tử; **"tiếp tục"/"làm luôn" KHÔNG phải duyệt mockup** (khi chủ dự án nói "chốt" mockup thì được code); **chú thích trong mockup KHÔNG chép vào sản phẩm** (chỉ giữ mô tả của công tắc); commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất còn trong repo).
