# HANDOFF — Tab "Hình ảnh & Tài liệu", GĐ3 + hoàn thiện (bổ sung 5) — cập nhật 2026-11-17

## 1. Trạng thái một câu
**GĐ1, GĐ2, GĐ3 và đợt hoàn thiện (DECISIONS #299 bổ sung 5) của tab "Hình ảnh & Tài liệu" đều XONG về code.** Còn hai việc chờ chủ dự án: **duyệt mockup** "Đính ảnh ở màn khám" và "Trình xem DICOM" (đã dựng 17/11, chưa code), và **dựng gói cài on-prem** để giao khách.

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #299), `docs/DECISIONS.md` cuối file (#299 bổ sung 1–5), file này.
2. Hỏi chủ dự án đã trả lời 9 câu của mockup chưa (mục 4). **Chưa có "duyệt" thì KHÔNG code** hai việc đó.
3. Môi trường khác (không phải máy dev) cần: `pnpm install`, `pnpm db:deploy` (migration mới nhất `20261114150000_patient_document_thumbnail`; bổ sung 5 không thêm migration), khởi động lại API. Không cần `db:seed`. **Bản cài on-prem phải dựng lại ảnh web** (`deploy/on-prem/build-and-export.ps1`, chạy bằng `powershell -File`, cần `release-notes/<số>.json`, mỗi lần dựng đổi số phiên bản) để nhận `nginx.conf` mới.

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

**Mockup mới (17/11/2026, CHƯA DUYỆT)** — Artifact https://claude.ai/artifact/Vq4jrvzMeMSDjsNmKSwYRz (file gốc ở scratchpad phiên, không nằm trong repo):
- A1 tab "Hình ảnh" ở màn khám (cuối thanh tab, số ảnh, lọc theo loại, ảnh tự gộp từ cận lâm sàng chỉ đọc); A2 hộp "Đính ảnh" (kéo thả, dán Ctrl+V, tải từng tệp, tệp lỗi nằm lại); A3 các trạng thái (trống, đã hoàn thành, không quyền, lỗi tải, sai định dạng, hết phiên).
- B1 trình xem DICOM (kéo, phóng, sáng/tương phản, đảo màu, xoay, lật, nhiều khung, lớp chữ bốn góc, cột chi tiết + series); B2 các trạng thái (đang đọc, kiểu nén chưa đọc được, tên không khớp hồ sơ, tệp hỏng, ảnh quá lớn, mất mạng).

## 4. Việc còn / cần chủ dự án
- **Trả lời 9 câu cuối mockup** (đã có gợi ý): 1 chỗ đặt nút (tab riêng/nút trong tab Khám/thanh đầu); 2 lượt khám đã hoàn thành có đính thêm không; 3 loại tệp cho phép; 4 camera (đề xuất không làm vì LAN HTTP); 5 ảnh có vào bệnh án in không; 6 có làm trình xem DICOM không (thư viện đóng gói sẵn, chạy offline, ~1–2 MB) hay chỉ tải về; 7 phạm vi công cụ; 8 tên trong tệp khác hồ sơ thì cảnh báo/chặn/bỏ qua; 9 giới hạn 15 MB cho DICOM (nâng thì phải sửa nginx và kiểm bằng nginx thật). Sau khi duyệt mới code, và code xong phải kiểm Chrome qua IP LAN + ma trận quyền (nhãn permission-grouping, role-access-sweep) vì là tính năng mới.
- **Nếu làm DICOM và triển khai SaaS (hỏi 17/11)**: trình xem chạy trong trình duyệt nên không phải sửa; nhưng phải chốt cùng lúc (1) adapter `StoragePort` kho đối tượng cho SaaS (cần `sizeOf`/`volumeUsage`), (2) thanh dung lượng đổi từ "% ổ đĩa" sang hạn mức theo công ty (gắn với tính cước, #237 chưa làm), (3) giới hạn tải lên riêng cho DICOM ở cả nginx on-prem lẫn bộ chia tải SaaS, (4) camera chỉ dùng được khi có HTTPS.
- **Dựng gói cài on-prem** và đưa cho khách (chưa làm; xem mục 2 điểm 3). Nên diễn tập nâng cấp bằng cách chép chồng vào `C:\NEXAMed-onprem-test` rồi chạy setup ở đó.
- **Chủ dự án xem**: các chỗ khác mockup/kế hoạch ở #299 bổ sung 1, 3, 4, 5; giới hạn phân quyền theo Khoa/Phòng không áp lên danh sách tài liệu; thanh dung lượng chưa đổi màu khi gần đầy.
- Chưa làm (ngoài #299): gói Nha khoa. Quy tắc thường trực: mọi file gắn bệnh nhân làm sau phải gộp về tab này.

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

## 6. Quy tắc chủ dự án nhắc (đã ghi memory)
- Tuân thủ mockup tuyệt đối, đối chiếu từng phần tử; **"tiếp tục"/"làm luôn" KHÔNG phải duyệt mockup**; commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất còn trong repo).
