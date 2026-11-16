# HANDOFF — Tab "Hình ảnh & Tài liệu", giai đoạn 3 XONG — 2026-11-16

## 1. Trạng thái một câu
**GĐ1, GĐ2, GĐ3 của tab "Hình ảnh & Tài liệu" (DECISIONS #299) đều XONG.** GĐ3 gồm công tắc "Dùng Hình ảnh & Tài liệu", dung lượng đã dùng ở Cấu hình chung và ảnh thu nhỏ do trình duyệt tạo; kèm sửa lỗi nginx on-prem chặn tệp > 8 MB. Không còn việc dở trong code của #299.

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục #299), `docs/DECISIONS.md` cuối file (#299 bổ sung 1–4), file này.
2. Hỏi chủ dự án làm việc gì tiếp (mục 4 liệt kê việc chờ họ quyết).
3. Môi trường khác (không phải máy dev) cần: `pnpm install`, `pnpm db:deploy` (migration mới nhất `20261114150000_patient_document_thumbnail`), khởi động lại API. Không cần `db:seed`. **Bản cài on-prem phải dựng lại ảnh web** (`deploy/on-prem/build-and-export.ps1`) để nhận `nginx.conf` mới.

## 3. Đã làm (GĐ3)
- **Công tắc** `patient_documents_enabled` (`tenant_setting`, mặc định bật): `GET /clinic-settings/patient-documents-enabled` tự-phục vụ; tắt thì mọi API của tab trả 409 `PATIENT_DOCUMENTS_DISABLED` và web ẩn tab (`usePatientDocumentsEnabledQuery`, `PatientDetailPage`). Khuôn #285/#298; đọc công tắc qua `ClinicConfigReaderPort` trước khi mở transaction.
- **Dung lượng** `GET /patient-documents/usage` (`clinic_config.read`): `PatientDocumentUsageRepository` (SQL) + `PatientDocumentUsageService` (đo tệp bằng `StoragePort.sizeOf` sau transaction, nhớ kết quả theo khoá lưu) + `PatientDocumentUsageController`; web `PatientDocumentUsageRow` trong `GeneralConfigPane`. `StoragePort` có thêm `sizeOf` và `volumeUsage` (`LocalDiskStorageAdapter`).
- **Ảnh thu nhỏ**: cột `patient_document.thumbnail_key` (trường Prisma `thumbKey`); web `make-thumbnail.ts` (canvas, ≤ 320 px, JPEG ≤ 200 KB) gửi ở trường `thumbnail`; máy chủ chỉ nhận JPEG ≤ 200 KB cho tệp ảnh, không đạt thì bỏ qua; lưới/bảng dùng `thumbnailUrl ?? url`.
- **Lỗi nginx**: `deploy/on-prem/nginx.conf` thêm khối `location ~ ^/api/v1/patients/[^/]+/documents$` với `client_max_body_size 17m`; kiểm bằng nginx thật (16 MB: 413 → 200); test chặn tái phạm ở `patient-document-constants-drift.spec.ts`.
- **Kiểm**: API `patient-document-settings-http.spec.ts` 9 ca + đột biến 11/12 (1 vô hại vì RLS); `local-disk.adapter.spec` +2; web +9; Chrome IP LAN `scripts/ui-audit/patient-document-settings-check.cjs` 22/22; `pnpm typecheck` + `pnpm lint` sạch; OpenAPI + kiểu web đã sinh lại. Chạy đầy đủ trước khi push: API 2417 đạt (1 bỏ qua có sẵn; một ca ma trận quyền đỏ vì route công tắc mới chưa có trong danh sách cho phép — đã thêm), core 900, shared 136, web 819, setup 112.

## 4. Việc còn / cần chủ dự án
- **Chủ dự án xem**: các chỗ khác mockup/kế hoạch ở DECISIONS #299 bổ sung 1 (GĐ1), 3 (GĐ2, kể cả cách đồng bộ thay migration nạp bù) và 4 (GĐ3: thanh % so với ổ chứa kho, chữ "&" thay "và", khối đặt cuối trang Cấu hình chung); giới hạn phân quyền theo Khoa/Phòng không áp lên danh sách tài liệu; PDF trong khung cần xem bằng Chrome có giao diện.
- **Ảnh cận lâm sàng/thẻ BHYT/ảnh đại diện (dòng tham chiếu) và tệp tải trước GĐ3 chưa có ảnh thu nhỏ**, vẫn tải ảnh gốc (ảnh CĐHA tới 5 MB). Muốn có thì phải thêm thư viện ảnh ở máy chủ (`sharp`) — chủ dự án quyết.
- Chưa làm (ngoài #299): nút "Đính ảnh" trong màn khám, trình xem DICOM, gói Nha khoa. Quy tắc thường trực: mọi file gắn bệnh nhân làm sau phải gộp về tab này.
- Chưa chạy lại quét quyền theo vai trò (`role-access-sweep.cjs`) với 2 nhóm quyền `patient_document.*`/`patient_contract.*`; nên chạy trước khi giao khách.
- Chưa thêm `docs/ERD-3.md` vào danh sách tài liệu của `CLAUDE.md` (hỏi chủ dự án).

## 5. Bẫy đã gặp (đọc trước khi làm)
- **Tải tệp lớn phải kiểm qua nginx thật**, không chỉ Vite dev proxy (Vite không giới hạn thân yêu cầu). Cách kiểm nhanh: container `nginx:alpine` với `--add-host api:host-gateway` + máy chủ Node giả ở cổng 3000, `curl --data-binary @tệp` các cỡ 3/9/16/18 MB.
- **`prisma format` căn lại cả các model khác** khi tên trường mới dài hơn tên dài nhất của model → nhiễu diff. Đặt tên trường ngắn (`thumbKey` + `@map("thumbnail_key")`) hoặc hoàn tác phần format.
- **`prisma migrate deploy` bằng role ứng dụng thất bại và để lại bản ghi migration "failed"** (chặn các lần sau). Luôn dùng `pnpm db:deploy`; nếu lỡ: `pnpm exec node scripts/with-migrate-url.mjs migrate resolve --rolled-back <tên>` rồi `pnpm db:deploy`.
- **`prisma generate` báo EPERM** khi còn tiến trình Node giữ file engine (API `dist/main` chạy từ phiên trước) — tắt tiến trình rồi sinh lại.
- **Script kiểm không được tin "đã dọn xong"**: `/users/:id/deactivate` không tồn tại, script nuốt lỗi nên tài khoản thử còn hoạt động; dùng `PATCH /users/:id {isActive:false, version}` và kiểm lại bằng cách liệt kê theo ĐÚNG tiền tố. Phiên bị ngắt giữa lúc kiểm còn để công tắc ở trạng thái tắt và `config.json` ở chế độ LAN — sau khi bị ngắt phải kiểm `GET /clinic-settings/patient-documents-enabled` và `apps/web/public/config.json.lan-backup`.
- **Tắt `dev-lan` bằng `taskkill /T` thì `config.json` không được trả về** — khôi phục tay từ `config.json.lan-backup`, xoá file sao lưu, `git status apps/web/public` phải sạch.
- **Shell ăn dấu `\`** (regex `\d`, `\/` trong script vá): vá bằng công cụ Edit rồi `node --check`.
- Địa chỉ IP LAN của máy dev đổi theo mạng (192.168.3.19 → 192.168.1.114): đọc từ dòng "Network" của `dev-lan`, đừng nhớ cứng.
- Ô tích của `ToggleSwitch` (Cấu hình chung) là `<input type="checkbox" class="sr-only">`: trong Playwright dùng `getByRole('checkbox', …)` rồi bấm vào nhãn bao ngoài (`xpath=ancestor::label`).

## 6. Quy tắc chủ dự án nhắc (đã ghi memory)
- Tuân thủ mockup tuyệt đối, đối chiếu từng phần tử; commit/push thẳng `master`, không PR; trả lời bằng tiếng Việt; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất còn trong repo).
