# HANDOFF — Cận lâm sàng GĐ4 đợt 1 + đợt 2 + Bảng giá thêm hàng loạt — 2026-10-07

> Nhánh: `feat/paraclinical-gd2` (đã push). **GĐ3 + GĐ4 đợt 1 + đợt 2 XONG + verify Chrome; GĐ4 đợt 3 chưa bắt đầu.**
> Hội thoại luôn tiếng Việt. Chủ dự án dặn: **"tuyệt đối tuân thủ các giao diện đã chốt, làm giống 95%"** — mockup Artifact `https://claude.ai/artifact/BPXwUuXzxPYEgnebhQDuN7` (14 artboard). Chủ dự án thường chỉnh giao diện trực tiếp giữa phiên — nghe từng câu, sửa ngay, báo lệch. Đọc cùng `docs/DECISIONS.md` #212 + #214.

## 1. Đã làm (tất cả đã commit)

- **GĐ3**: verify Chrome thật; sửa phiếu in chỉ định (số thứ tự, cột Mã, phím ↑↓), mã phiếu là `CLS` (không phải `CD`).
- **GĐ4 đợt 1** (#214): `paraclinical_result`/`_value` (bản ký, trigger bất biến), hàng đợi 5 tab (xét nghiệm cùng phiếu gộp 1 dòng/1 màn), lấy mẫu/gọi vào phòng, nhập + gửi duyệt + duyệt, quyền `paraclinical_result.read/enter/approve`, công tắc "thực hiện trước khi thu tiền".
- **GĐ4 đợt 2** (#214): in phiếu kết quả (mẫu in `PARACLINICAL_RESULT`, `ParaclinicalResultPrintView`; in đậm + gạch chân chỉ số vượt mức; phiếu CĐHA dạng khối kèm ảnh); **ảnh đính kèm CĐHA** (`paraclinical_result_image`, StoragePort + signed URL, web phải `resolveApiUrl`); **hàng đợi tách theo phòng** (scope `department`, 404 với việc phòng khác; mặc định 5 vai trò vẫn `global`); thanh trên màn nhập có "Thời gian nhận mẫu"; ô "Chèn mẫu" cùng dòng nhãn.
- **Bảng giá**: 2 cột (trái: ô thêm + danh sách; phải: thông tin), "Thêm theo nhóm", "Nhập từ Excel" (file mẫu), menu Bảng giá cấp 1, chú thích lên đầu danh sách, cỡ ô gọn.
- **Shared UI**: `Combobox` thêm `dense` + `floating` (portal, tự lật lên trên khi thiếu chỗ), `Textarea` thêm `hideLabel`.
- Migration mới: `20261008090000`, `090100`, `100000`, `110000` (áp lên DB dev rồi; môi trường khác `db:deploy` + `db:seed` + **khởi động lại API**).

## 2. Kiểm thử
- `pnpm -r typecheck` sạch; `pnpm lint` 0 lỗi (8 cảnh báo cũ); web build ổn.
- Test: core 336, shared 31, web 8; `paraclinical-result-http.spec.ts` 11, `pricing-http.spec.ts` 29, `clinical-order-http.spec.ts` 14, print-template 20 — đều pass. Chạy CẢ BỘ `apps/api` có race đã biết ở vài file (`geo-http`, `user-account-me-http`, `sync-role-permissions`, `icd10-http`) — chạy riêng xanh; thỉnh thoảng lỗi libuv khi tắt tiến trình trên Windows (chạy lại là hết). Chưa chạy lại cả bộ API sau commit cuối.
- Chrome (Playwright, tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin`/`Dev@12345`): kịch bản ở scratchpad phiên (không commit) đã chạy xanh: hàng đợi → lấy mẫu → nhập (badge Cao/Thấp) → duyệt, chèn mẫu, tải ảnh, in phiếu XN + siêu âm, bảng giá 2 cột + nhóm + Excel.

## 3. Việc kế tiếp
1. **GĐ4 đợt 3**: bác sĩ xem kết quả ở màn khám (khối "Kết quả đã có của lượt khám này" trong mockup `ChiDinh`) + bệnh án PDF; **đính chính** (`supersedes_id` + `amendment_reason`, bản cũ soft-delete — khuôn `prescription`/`clinical_note`; DB đã sẵn cột + trigger; bảng ảnh cần chuyển/nhân bản theo bản mới); vai trò mặc định "Kỹ thuật viên" (`UserRole` enum + `seed-tenant-roles` + `role-labels` + test ma trận — ripple lớn; hiện clinic_admin tự tạo vai trò tuỳ biến); mục menu "Phiếu chỉ định"/"Tra cứu kết quả" (đủ mục thì đổi "Cận lâm sàng" thành nhóm xổ xuống); nút "👁 Xem chi tiết phiếu" ở dòng hàng đợi; huỷ lượt khám nên đổi trạng thái dòng chỉ định sang `CANCELLED`.
2. Hỏi chủ dự án: trạng thái merge PR #1/#2 và có mở PR cho nhánh `feat/paraclinical-gd2` không (xem `HANDOFF-CanLamSang-2026-10-06.md` mục cách mở PR khi không có `gh`).
3. Cân nhắc: đặt mặc định scope `department` cho vai trò kỹ thuật viên khi có vai trò đó; ô "Khoa/Phòng thực hiện" của dịch vụ kỹ thuật phải được khai thì tách phòng mới có tác dụng (dịch vụ chưa khai chỉ scope global thấy).
4. Lệch mockup còn lại: phiếu in chưa có "Bằng chữ"/địa chỉ/chẩn đoán/mốc "Nhận mẫu" riêng/số trang `x/y`/mã QR tra cứu; phiếu in chỉ định chưa có ô "Dặn dò" (chủ dự án chọn giữ nguyên); Enter trong bảng chỉ số nhảy sang ô kế (ô cuối thì submit).

## 4. Bài học / bẫy kỹ thuật
- Bash heredoc/`node -e` chứa tiếng Việt + dấu nháy/regex hỏng IM LẶNG — tạo file bằng công cụ Write rồi chạy script `.cjs` (xử lý CRLF: đọc → đổi `\r\n`→`\n` → sửa → ghi lại đúng kiểu). Regex có `\d` truyền qua shell mất dấu `\`.
- **Hộp thoại có `<form>` riêng KHÔNG đặt trong `<form>` của trang** (form lồng nhau → nút submit kích hoạt form ngoài).
- **Thẻ `overflow-hidden` là con flex của khung cuộn sẽ BỊ CO lại** (cắt nội dung ở màn thấp) — thêm `[&>*]:flex-shrink-0` vào khung cuộn.
- `Combobox` trong vùng `overflow`/gần mép dưới → dùng `floating` (portal + tự lật). Ảnh/URL tương đối từ API → `resolveApiUrl`.
- `apps/web` không import GIÁ TRỊ từ `@nexamed/shared`/`@nexamed/core` (#073): logic hiển thị phải có bản phản chiếu; hằng số dùng chung (vd `PARACLINICAL_IMAGE_MAX_BYTES`) chỉ dùng được phía API.
- Dev API `nest start --watch`: quyền mới cần `pnpm db:seed` **rồi một lần build lại làm API khởi động lại** (đồng bộ `role_permission` lúc startup). `prisma generate` lỗi EPERM khi API đang chạy — types vẫn ghi. Build lại `@nexamed/shared`/`core` trước khi chạy test API.
- `tenant-fixture.ts` đã dọn `paraclinicalResultImage` → `Value` → `Result` trước `clinicalOrderItem`; bảng mới tham chiếu FK RESTRICT nào cũng phải thêm vào đây.
- Zod: schema con phải khai báo TRƯỚC schema cha dùng nó (lỗi "used before its declaration" khi build shared).
