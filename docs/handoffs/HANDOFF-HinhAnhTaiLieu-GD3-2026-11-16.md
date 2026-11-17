# HANDOFF — Tab "Hình ảnh & Tài liệu" + Đính ảnh ở màn khám + Chế độ DICOM + Thanh tab — cập nhật 2026-11-17 (tối)

## 1. Trạng thái một câu
**Mọi việc của #299 và các việc chủ dự án giao trong phiên 17/11 đều ĐÃ LÀM về code**: tab Hình ảnh & Tài liệu (GĐ1–GĐ3 + hoàn thiện), thanh tab màn khám không cuộn (#300, Cách 2), tab "Hình ảnh" + hộp "Đính ảnh" ở màn khám, chế độ DICOM tuỳ chọn (công tắc mặc định TẮT; #299 bổ sung 6). Mockup đã được chủ dự án CHỐT ("chốt tất cả mockup trước và mockup cách 2"): Đính ảnh/DICOM https://claude.ai/artifact/Vq4jrvzMeMSDjsNmKSwYRz, thanh tab https://claude.ai/artifact/XikNudn9xiA9Ce2UpeoNt6. Còn: **dựng gói cài on-prem** để giao khách (chưa làm, chờ chủ dự án chốt số phiên bản).

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #299), `docs/DECISIONS.md` cuối file (#300, #299 bổ sung 5–6 kể cả "Đợt 2" và "Đợt 3"), file này.
2. Xem `git log`: nếu đợt 3 chưa được đẩy thì chạy lại bộ test đầy đủ rồi đẩy (xem CURRENT.md ghi kết quả lần chạy cuối).
3. Hỏi chủ dự án muốn dựng gói on-prem số phiên bản nào. Cách dựng: `deploy/on-prem/build-and-export.ps1` bằng `powershell -File`, cần `release-notes/<số>.json`, mỗi lần dựng đổi số; nâng cấp = chép chồng vào `C:\NEXAMed-onprem-test` rồi chạy setup ở đó. Máy khác cần `pnpm install`, `pnpm db:deploy` (migration mới nhất vẫn `20261114150000_patient_document_thumbnail`; đợt 2 và 3 KHÔNG thêm migration), khởi động lại API, không cần `db:seed`. **Ảnh web phải dựng lại** vì `nginx.conf` có thêm khối cho đường dẫn đính DICOM (52m).

## 3. Đã làm
**GĐ3**
- **Công tắc** `patient_documents_enabled` (`tenant_setting`, mặc định bật): `GET /clinic-settings/patient-documents-enabled` tự-phục vụ; tắt thì mọi API của tab trả 409 `PATIENT_DOCUMENTS_DISABLED` và web ẩn tab. Đọc công tắc qua `ClinicConfigReaderPort` trước khi mở transaction.
- **Dung lượng** `GET /patient-documents/usage` (`clinic_config.read`): `StoragePort` có thêm `sizeOf` và `volumeUsage`; web `PatientDocumentUsageRow` trong `GeneralConfigPane`.
- **Ảnh thu nhỏ khi tải lên**: cột `thumbnail_key` (Prisma `thumbKey`); `make-thumbnail.ts` (canvas ≤ 320 px, JPEG ≤ 200 KB) gửi ở trường `thumbnail`.
- **Lỗi nginx**: khối `location ~ ^/api/v1/patients/[^/]+/documents$` với `client_max_body_size 17m` trong `deploy/on-prem/nginx.conf`; test chặn tái phạm ở `patient-document-constants-drift.spec.ts`.

**Bổ sung 5 (17/11/2026)**
- **Ảnh thu nhỏ BÙ** cho tệp tải trước GĐ3 và dòng tự gộp: trình duyệt tạo từ ảnh đã tải rồi gửi `POST /patients/:patientId/documents/:documentId/thumbnail` (quyền tải lên đúng loại tệp, người gửi trước thắng, không đổi version). Web: `thumbnail-backfill.ts` (hàng đợi lần lượt, mỗi tệp thử một lần mỗi phiên). Không thêm thư viện ảnh vào máy chủ (chủ dự án nói "thêm thư viện xử lý ảnh", tôi chọn cách ở trình duyệt, đã ghi lý do ở #299 bổ sung 5; đổi sang `sharp` được nếu họ muốn).
- **Thanh dung lượng = phương án B**: phần trăm ổ chứa kho đã đầy (`diskUsedPercent`), dòng chữ là dung lượng tệp. Chưa đổi màu khi gần đầy.
- **Khung PDF** ở hộp xem lớn: tên tệp nằm trên vùng xem, khung rộng hết chiều ngang, `#navpanes=0&view=FitH`, đường dẫn ký nhận thêm đoạn tên tệp (chỉ hiển thị, `Content-Disposition` lọc ký tự). Kiểm bằng Chrome CÓ giao diện 1440/768/390 px (Chrome ngầm không vẽ được trình xem PDF).
- **Quét quyền theo vai trò** (`role-access-sweep.cjs`): 7 vai trò mặc định + 4 vai trò tuỳ biến, không trang nào vừa cho vào vừa lỗi quyền.
- `CLAUDE.md`: phạm vi tab, quy tắc "mọi file gắn bệnh nhân về tab", quy tắc kiểm tệp lớn qua nginx thật, `docs/ERD-3.md` vào danh sách tài liệu.
- **Kiểm**: API `patient-document-settings-http.spec` +6 ca, đột biến 10/10 bị bắt; web +7; Chrome IP LAN `patient-document-settings-check.cjs` 25/25 và `patient-document-reference-check.cjs` 31/31; typecheck + lint sạch. Bộ test đầy đủ chạy lại trước push (xem CURRENT.md nếu đã ghi kết quả).

**Mockup (17/11/2026, ĐÃ CHỐT)** — Artifact https://claude.ai/artifact/Vq4jrvzMeMSDjsNmKSwYRz (file gốc ở scratchpad phiên, không nằm trong repo):
- A1 tab "Hình ảnh" ở màn khám (cuối thanh tab, số ảnh, lọc theo loại, ảnh tự gộp từ cận lâm sàng chỉ đọc); A2 hộp "Đính ảnh" (kéo thả, dán Ctrl+V, tải từng tệp, tệp lỗi nằm lại); A3 các trạng thái (trống, đã hoàn thành, không quyền, lỗi tải, sai định dạng, hết phiên).
- B1 trình xem DICOM (kéo, phóng, sáng/tương phản, đảo màu, xoay, lật, nhiều khung, lớp chữ bốn góc, cột chi tiết + series); B2 các trạng thái (đang đọc, kiểu nén chưa đọc được, tên không khớp hồ sơ, tệp hỏng, ảnh quá lớn, mất mạng).

## 4. Việc còn / cần chủ dự án
- **Dựng gói cài on-prem** (mục 2 điểm 3) — chờ chủ dự án chốt số phiên bản.
- **Chủ dự án xem các chỗ khác mockup**: #299 bổ sung 1, 3, 4, 5 và "Đợt 2"/"Đợt 3" của bổ sung 6 (nút Chụp ảnh nay chỉ hiện trên máy cảm ứng ở CẢ hộp Tải lên của tab hồ sơ; thẻ "Bổ sung" ở góc ảnh; hàng DICOM không ghi số khung; hộp xem kết quả kiểu phiếu in không có khối DICOM); #300 giữ icon từ 1440px.
- **Khi làm SaaS**: chốt cùng lúc adapter kho đối tượng cho `StoragePort`, hạn mức dung lượng theo công ty (thay thanh "% ổ đĩa"), giới hạn tải lên riêng cho DICOM ở bộ chia tải, camera chỉ khi có HTTPS.
- Chưa làm (ngoài #299): gói Nha khoa. Quy tắc thường trực: mọi file gắn bệnh nhân làm sau phải gộp về tab này; chú thích trong mockup không chép vào sản phẩm (chỉ giữ mô tả của công tắc).

## 5. Bẫy đã gặp (đọc trước khi làm)
- **Tải tệp lớn phải kiểm qua nginx thật**, không chỉ Vite dev proxy. Cách kiểm nhanh: container `nginx:alpine` với `--add-host api:host-gateway` + máy chủ Node giả ở cổng 3000, `curl --data-binary @tệp` các cỡ 3/9/16/18 MB.
- **`prisma format` căn lại cả các model khác** khi tên trường mới dài hơn tên dài nhất của model → nhiễu diff. Đặt tên trường ngắn hoặc hoàn tác phần format.
- **`prisma migrate deploy` bằng role ứng dụng thất bại và để lại bản ghi "failed"**. Luôn dùng `pnpm db:deploy`; nếu lỡ: `pnpm exec node scripts/with-migrate-url.mjs migrate resolve --rolled-back <tên>` rồi `pnpm db:deploy`.
- **`prisma generate` báo EPERM** khi còn tiến trình Node giữ file engine — tắt tiến trình rồi sinh lại.
- **Script kiểm không được tin "đã dọn xong"**: dùng `PATCH /users/:id {isActive:false, version}` và liệt kê lại theo ĐÚNG tiền tố. Phiên bị ngắt giữa lúc kiểm có thể để công tắc tắt và `config.json` ở chế độ LAN: kiểm `GET /clinic-settings/patient-documents-enabled` và `apps/web/public/config.json.lan-backup`.
- **Tắt `dev-lan` bằng `taskkill /T` thì `config.json` không được trả về** — khôi phục tay từ `config.json.lan-backup`, xoá file sao lưu, `git status apps/web/public` phải sạch.
- **Shell ăn dấu `\`** (regex `\d`, `\/`): vá bằng công cụ Edit hoặc Write + `node --check`.
- **Chrome ngầm không vẽ được trình xem PDF**: muốn kiểm khung PDF phải chạy Chrome có giao diện (`pdf-headed.cjs` kiểu script, `headless: false`).
- **Cache react-query che trạng thái lỗi**: muốn thấy lỗi tải phải tải lại trang trước khi chặn mạng.
- Địa chỉ IP LAN máy dev đổi theo mạng: đọc từ dòng "Network" của `dev-lan`, đừng nhớ cứng.
- Ô tích của `ToggleSwitch` là `<input type="checkbox" class="sr-only">`: trong Playwright dùng `getByRole('checkbox', …)` rồi bấm vào nhãn bao ngoài (`xpath=ancestor::label`).

- **Công cụ Edit/Write giải mã `\uXXXX`** trong tham số: không gõ `\u0300` vào mã được; dùng `\p{M}` (cờ `u`) hoặc tạo bằng `String.fromCharCode`. Shell cũng ăn dấu `\` và backtick: vá bằng Write một tệp `.cjs` rồi chạy `node`.
- **Playwright `setInputFiles({buffer})` giới hạn 50 MB**: tệp lớn hơn phải ghi ra đĩa rồi truyền đường dẫn.
- **Hai tệp giống hệt nhau (cùng loại/ghi chú) đính liền nhau bị máy chủ coi là một lần gửi lại** (`Idempotency-Key`) nên chỉ lưu một: ở script kiểm, mỗi ảnh phải khác nội dung. Tên tệp có dấu bị multer đọc sai: dùng tên ASCII trong test.
- **Thanh tab**: bản sao ẩn dùng để đo phải bọc trong khung 0×0 `overflow-hidden`, nếu không nó kéo giãn `scrollWidth` của trang. Hàm chia tab coi bề rộng 0 (chưa đo/jsdom) là "hiện hết".
- **dev-lan cần API chạy riêng** (`pnpm --filter @nexamed/api dev`, cổng 3001) và nhớ trả `config.json` (xem mục trên).

## 6. Quy tắc chủ dự án nhắc (đã ghi memory)
- Tuân thủ mockup tuyệt đối, đối chiếu từng phần tử; **"tiếp tục"/"làm luôn" KHÔNG phải duyệt mockup**; commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất còn trong repo).
