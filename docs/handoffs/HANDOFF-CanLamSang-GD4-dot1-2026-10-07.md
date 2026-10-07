# HANDOFF — Cận lâm sàng GĐ4 đợt 1 + Bảng giá thêm hàng loạt + verify GĐ3 — 2026-10-07

> Nhánh: `feat/paraclinical-gd2` (đã push). **GĐ3 đã verify Chrome; GĐ4 đợt 1 XONG + verify Chrome; GĐ4 đợt 2 và 3 chưa bắt đầu.**
> Hội thoại luôn tiếng Việt. Chủ dự án dặn: **"tuyệt đối tuân thủ các giao diện đã chốt, làm giống 95%"** — mockup Artifact `https://claude.ai/artifact/BPXwUuXzxPYEgnebhQDuN7` (14 artboard; GĐ4: `HangDoi`, `NhapKetQuaXN`, `NhapKetQuaCDHA`, `PhieuKetQua`, `PhieuKetQuaCuoi`). Đọc cùng `docs/DECISIONS.md` #212 + #214.

## 1. Đã làm trong phiên

**Verify + sửa GĐ3** (Chrome thật): tab "Chỉ định cận lâm sàng" chạy đúng (thêm tại phòng khám/ra ngoài/tên tự do/gói, lưu, hoá đơn Cận lâm sàng, in, thu tiền rồi gỡ → 409, thêm dòng mới → hoá đơn riêng thứ hai). Sửa: số thứ tự phiếu in nhảy (render không thuần), cột "Mã" phiếu in hẹp, phím ↑↓ ở ô tìm dịch vụ, tài liệu ghi nhầm mã `CD` (đúng `CLS`). Thêm 2 test HTTP (huỷ lượt khám + audit "xem") — `clinical-order-http.spec.ts` 14/14.

**GĐ4 đợt 1** (`docs/DECISIONS.md` #214):
- Schema: migration `20261008090000_paraclinical_result_status_enum` (+`IN_PROGRESS/RESULTED/COMPLETED`), `20261008090100_paraclinical_result` (bảng dùng chung `paraclinical_result` + `paraclinical_result_value`, `clinical_order_item.collected_at/by`, trigger bất biến cho bản ký, RLS). Đã áp lên DB dev.
- Core: `packages/core/src/paraclinical/paraclinical-result.ts` (`deriveQueueBucket`, `groupQueueItems`, `checkParaclinicalSectionComplete`) + 3 lỗi `PARACLINICAL_*`. Shared: `packages/shared/src/paraclinical-result.ts`.
- API: `apps/api/src/modules/paraclinical-result/` (`GET /paraclinical/queue`, `POST /paraclinical/start`, `GET|PUT /paraclinical/items/:itemId/result`, `POST .../result/approve`). Quyền `paraclinical_result.read/enter/approve` (nurse: read+enter; doctor/clinic_admin: cả ba; lễ tân: read). Công tắc `paraclinical_before_payment_enabled` (port `ClinicConfigReaderPort.getParaclinicalBeforePaymentEnabled`). Xét nghiệm cùng phiếu + cùng trạng thái + cùng tình trạng thu gộp 1 nhóm (`resolveGroup`).
- Web: `apps/web/src/features/paraclinical-result/` (`ParaclinicalQueuePage`, `ParaclinicalResultPage`, labels có bản phản chiếu `previewFlag`), route `/paraclinical/queue`, `/paraclinical/items/:itemId`, mục sidebar "Cận lâm sàng".
- Test: `paraclinical-result-http.spec.ts` 9 test + `paraclinical-result.spec.ts` (core) 9 test. Kiểm đột biến chưa làm.

**Bảng giá** (yêu cầu chủ dự án giữa phiên): trang chi tiết dựng **2 cột** (trái: ô thêm + danh sách; phải: thông tin), "Thêm theo nhóm" (hộp thoại), "Nhập từ Excel" (file mẫu; `price-list-import.service.ts`), menu Bảng giá ra cấp 1 ngang "Lịch làm việc", bỏ giá khỏi nhãn ô Đơn vị, `Combobox` thêm `dense` + `floating`, chip lọc bớt đậm, dòng chú thích lên đầu danh sách. `pricing-http.spec.ts` 29/29.

## 2. Kiểm thử
- `pnpm -r typecheck` sạch; `pnpm lint` 0 lỗi (8 cảnh báo `exhaustive-deps` cũ); `pnpm --filter @nexamed/web build` ổn.
- Test: core 336, shared 31, web 8 pass; `apps/api` chạy cả bộ **1242 pass / 3 file lỗi do race đã biết khi chạy song song** (`geo-http`, `user-account-me-http`, `sync-role-permissions`) — chạy riêng 16/16 xanh. Sau khi sửa spec bảng giá, chưa chạy lại cả bộ API lần nữa.
- Chrome (Playwright, tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin`/`Dev@12345`): kịch bản `verify-clinical-order.mjs`, `verify-pricelist.mjs`, `verify-gd4.mjs` (đều ở scratchpad phiên, không commit) đã chạy xanh, 0 lỗi console.

## 3. Việc kế tiếp (thứ tự)
1. **GĐ4 đợt 2 — In phiếu kết quả** (mockup `PhieuKetQua`/`PhieuKetQuaCuoi`): khung `PrintDocument` + mẫu in mới `PARACLINICAL_RESULT` (thêm `PrintDocumentType` bằng migration riêng, cập nhật test đếm mẫu in 12→13 như lần `CLINICAL_ORDER`). **BẮT BUỘC (chủ dự án nhắc 2 lần)**: giá trị vượt khoảng tham chiếu **in ĐẬM + gạch chân** (dùng cờ API trả sẵn `flag` + `referenceText`; bản đã duyệt dùng snapshot); 4 mốc thời gian (Đăng ký / Lấy mẫu / Nhận mẫu / Có kết quả — hiện có `order.createdAt`, `collected_at`, `resulted_at`); nhóm lĩnh vực + dòng "Diễn giải" (`interpretation_text` đã lưu); header + thông tin bệnh nhân lặp mọi trang, `x/y`, trang cuối "KẾT THÚC" + chữ ký bác sĩ duyệt. Nút "In phiếu kết quả" ở màn nhập (đang chưa dựng — ẩn, không giả). Ghi audit in (`paraclinical_result.printed` + nhãn).
2. **GĐ4 đợt 3**: bác sĩ xem kết quả ở màn khám (khối "Kết quả đã có của lượt khám này" trong mockup `ChiDinh`) + bệnh án PDF; **đính chính** (`supersedes_id` + `amendment_reason`, bản cũ soft-delete — khuôn `prescription`/`clinical_note` amend; DB đã sẵn cột + trigger); vai trò mặc định "Kỹ thuật viên" (`UserRole` enum + `seed-tenant-roles` + `role-labels` + test ma trận — ripple lớn, hiện clinic_admin tự tạo vai trò tuỳ biến với `paraclinical_result.enter`); ảnh đính kèm CĐHA (StoragePort); mục menu "Phiếu chỉ định"/"Tra cứu kết quả" (khi đủ mục thì đổi mục "Cận lâm sàng" thành nhóm xổ xuống như mockup); nút "👁 Xem chi tiết phiếu" ở dòng hàng đợi; chặn lệch: huỷ lượt khám nên đổi trạng thái dòng chỉ định sang `CANCELLED`.
3. Hỏi chủ dự án trạng thái merge PR #1/#2 (xem `HANDOFF-CanLamSang-2026-10-06.md` mục link PR/cách mở PR khi không có `gh`) và có mở PR cho nhánh `feat/paraclinical-gd2` không.
4. Các điểm mockup còn lệch: phiếu in chỉ định chưa có "Bằng chữ"/"Địa chỉ" bệnh nhân (chưa có tiện ích đọc số thành chữ); ô nhập kết quả dùng Enter nhảy sang ô kế (ô cuối thì submit) — khác chuẩn "Enter = submit" một chút, chủ ý để nhập nhanh, nên hỏi lại.

## 4. Bài học / bẫy kỹ thuật
- Bash heredoc/`node -e` chứa tiếng Việt + dấu nháy hỏng IM LẶNG — tạo file bằng công cụ Write rồi chạy script `.cjs`; xử lý CRLF (đọc → đổi `\r\n`→`\n` → sửa → ghi lại đúng kiểu).
- **Hộp thoại có `<form>` riêng KHÔNG được render bên trong `<form>` của trang** (form lồng nhau → nút submit kích hoạt form ngoài, dòng không được thêm). Đặt hộp thoại ngoài form (fragment).
- `Combobox` trong vùng `overflow` (hàng bảng) bị cắt panel → dùng `floating` (portal).
- Dev API chạy `nest start --watch`: thêm permission mới cần `pnpm db:seed` **rồi một lần build lại làm API khởi động lại** (đồng bộ `role_permission` chạy lúc startup) — `touch` file không đủ nếu JS đầu ra không đổi.
- `apps/web` không import GIÁ TRỊ từ `@nexamed/shared`/`@nexamed/core` (#073): logic hiển thị (`previewFlag`) phải có bản phản chiếu trong web; nguồn sự thật ở core/API.
- `prisma generate` lỗi EPERM khi dev API đang chạy (khoá file engine) — types vẫn được ghi, chỉ engine không đổi; build lại `@nexamed/shared`/`core` trước khi chạy test API (API dùng qua `dist`).
- Test fixture `tenant-fixture.ts` đã thêm dọn `paraclinicalResultValue`/`paraclinicalResult` trước `clinicalOrderItem` — bảng mới tham chiếu FK RESTRICT nào cũng phải thêm vào đây.
- Nhập Excel bảng giá khớp Đơn vị/Loại giá theo danh mục (tên hoặc mã), rồi theo mã mặt hàng đang dùng — dữ liệu test có mã đơn vị không nằm trong danh mục UNIT.
