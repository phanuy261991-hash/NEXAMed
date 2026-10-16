# Phương án: mã đơn thuốc theo quy định Bộ Y tế và liên thông đơn thuốc

Soạn 16/10/2026 theo yêu cầu chủ dự án ("so sánh với hiện tại, đưa phương án cấu hình mẫu mã phát sinh cho đơn thuốc đúng quy định Bộ Y tế và phục vụ liên thông đơn thuốc sau này"). **CHƯA code gì** — cần chủ dự án chốt các câu ở mục 7.

## 1. Quy định (nguyên văn đoạn chủ dự án gửi)

"Mã đơn thuốc, hệ thống thông tin tự sinh mã theo quy định (định dạng: `xxxxxyyyyyyy-z`; 05 ký tự x đầu tiên là mã cơ sở KCB; 07 ký tự y tiếp theo bao gồm ký tự 0-9 hoặc a-z; ký tự cuối cùng z có 01 trong 04 giá trị ký tự C, N, H, Y thể hiện loại đơn thuốc, C: đơn thuốc thông thường, N: đơn thuốc nghiện, H: đơn thuốc hướng thần, Y: đơn thuốc y học cổ truyền)."

Tổng 14 ký tự gồm dấu gạch. **Lưu ý**: chưa có số hiệu văn bản gốc trong tay — đối chiếu văn bản (và các quy định kê đơn N/H/Y riêng) trước khi code.

## 2. Hiện trạng (đã đọc mã nguồn 16/10/2026)

| Hạng mục | Hiện trạng |
|---|---|
| Mã đơn | `prescription.prescription_no`, sinh lúc KÝ qua `BusinessCodeService` loại `PRESCRIPTION` (`docs/DECISIONS.md` #169). Mặc định `DT<yy><mm><số 6 chữ số>` (vd `DT2610000001`). Cấu hình được ở "Cấu hình mẫu mã phát sinh" bằng 5 token (`[Năm 2 số]`, `[Năm 4 số]`, `[Tháng]`, `[Ngày]`, `[Số đếm]`) + chữ cố định, có thể đánh số lại theo kỳ. Đính chính GIỮ NGUYÊN mã gốc. |
| Mã cơ sở KCB | `clinic_profile.facility_code` — text tự do, MỘT mã cho cả công ty, không kiểm định dạng. Chi nhánh (#231) CHƯA có mã KCB riêng. |
| Loại thuốc | `drug.control_type` = `NORMAL`/`TOXIC`/`NARCOTIC`/`PSYCHOTROPIC`/`PRECURSOR` (Thông tư 20/2017). **Không có** phân loại thuốc y học cổ truyền. Dòng kê tự do (không chọn từ danh mục) không có `drug` nên không phân loại được. |
| Cấu trúc đơn | Một lượt khám = một chuỗi đơn (`prescription` + các bản đính chính). **Không tách đơn theo loại**, không chặn trộn thuốc nghiện/hướng thần với thuốc thường. Một đơn ↔ nhiều phiếu xuất kho. |
| Dữ liệu cho liên thông | Có: CCCD bệnh nhân (mã hoá), người thân (`relative_*`), `user_account.license_no` (CCHN), `drug.national_code`, chẩn đoán ICD-10, liều theo buổi/số ngày. Chữ ký là **chữ ký logic** (`signed_at`/`signed_by`), chưa ký số. |

## 3. Khoảng cách so với quy định

| Yêu cầu | Thiếu |
|---|---|
| 5 ký tự đầu = mã cơ sở KCB | Chưa có token; mã KCB chưa kiểm định dạng, chưa theo chi nhánh |
| 7 ký tự `0-9`/`a-z`, duy nhất | Số đếm hiện 6 chữ số, có thể đánh số lại theo kỳ → sẽ TRÙNG mã sau khi reset; cần 7 ký tự, KHÔNG đánh số lại |
| `-` + 1 ký tự loại C/N/H/Y | Chưa có token loại đơn, chưa có khái niệm loại đơn |
| N/H/Y là đơn riêng | Chưa tách đơn theo loại khi ký |
| Y = y học cổ truyền | Chưa có cờ phân loại thuốc cổ truyền |

## 4. Ba phương án

1. **Chỉ cấu hình mã** (thêm token mã KCB + ký tự loại gõ tay): KHÔNG đủ — ký tự cuối phụ thuộc nội dung đơn, 7 ký tự phải duy nhất và không đánh số lại, cần tách đơn.
2. **Chuẩn Bộ Y tế theo 3 giai đoạn (ĐỀ XUẤT)**: nền dữ liệu + cấu hình mã → phân loại + tách đơn → chuẩn bị liên thông. Làm đủ GĐ1–2 là đạt quy định về mã; GĐ3 chuẩn bị dữ liệu, chưa gửi thật.
3. **Làm đủ ngay, kể cả gửi liên thông thật + chữ ký số**: cần tài liệu kỹ thuật kết nối, tài khoản/chứng thư của cơ sở và CA — chưa có, ngoài v1 hiện tại.

## 5. Thiết kế đề xuất (phương án 2)

**GĐ1 — Nền dữ liệu và cấu hình mã**
- `branch.facility_code` (mã cơ sở KCB theo chi nhánh; chi nhánh chưa nhập thì lấy `clinic_profile.facility_code` của công ty). Kiểm định dạng 5 ký tự (xem câu 1).
- Hai token mới trong "Cấu hình mẫu mã phát sinh": `[Mã cơ sở KCB]` và `[Loại đơn]` (C/N/H/Y).
- Chế độ **"Chuẩn Bộ Y tế"** cho loại mã `PRESCRIPTION`: khuôn KHOÁ `[Mã cơ sở KCB][Số đếm]-[Loại đơn]`, số đếm 7 chữ số, **không đánh số lại**, bộ đếm **riêng theo cơ sở KCB và dùng chung cho cả 4 loại đơn** (để 7 ký tự giữa luôn duy nhất trong một cơ sở). Quản trị không sửa được khuôn khi bật chế độ; không bật được nếu cơ sở chưa có mã KCB hợp lệ (báo rõ cách sửa).
- Cột mới `prescription.national_code` (mã chuẩn) + `prescription_kind` (C/N/H/Y); GIỮ `prescription_no` nội bộ (`DT…`) để không phá dữ liệu và bản in cũ. Bản in: mã chuẩn là mã chính.
- Số đếm 7 ký tự: đề xuất **thập phân** `0000001` (đọc và nhập tay được; 10 triệu đơn mỗi cơ sở là đủ). Chỉ dùng base-36 nếu cần ngắn hơn.

**GĐ2 — Phân loại và tách đơn**
- `drug.is_traditional` (thuốc y học cổ truyền) + cột nhập Excel + ô ở danh mục thuốc.
- Ánh xạ loại đơn: `NARCOTIC`→N; `PSYCHOTROPIC`→H; `is_traditional`→Y; còn lại (`NORMAL`, `TOXIC`; `PRECURSOR` cần xác nhận) → C.
- **Tách đơn khi ký**: bác sĩ vẫn kê trên MỘT màn; trước khi ký hiện "sẽ ký thành 2 đơn: C (3 thuốc) + N (1 thuốc)"; ký xong sinh nhiều đơn pháp lý, mỗi đơn một mã chuẩn. Dữ liệu: bảng `prescription_document` (một bản đơn pháp lý thuộc một `prescription`: loại, mã chuẩn, các dòng thuốc) để GIỮ nguyên logic kho/phát thuốc/đính chính hiện tại; in và liên thông theo `prescription_document`.
- Đính chính giữ mã chuẩn của đơn gốc (đúng tinh thần #169). Phiếu xuất kho gắn đơn pháp lý, hiện mã chuẩn.
- Dòng kê tự do: mặc định loại C; bác sĩ chọn loại tay hoặc cấm kê N/H/Y tự do (câu 6).

**GĐ3 — Chuẩn bị liên thông (chưa gửi thật)**
- Port `PrescriptionInteropPort` ở `packages/core/ports` + adapter no-op/giả lập; bảng outbox `prescription_submission` (đơn pháp lý, trạng thái PENDING/SENT/FAILED/ACKED, số lần thử, mã phản hồi, lỗi, thời điểm). Gửi nền khi có mạng, KHÔNG chặn việc ký và in.
- Kiểm dữ liệu bắt buộc trước khi ký (cảnh báo thiếu CCHN bác sĩ, thiếu mã thuốc quốc gia, trẻ nhỏ thiếu cân nặng/tháng tuổi/người đại diện…) — danh sách chính xác theo tài liệu kết nối thật.
- Chữ ký số: v1 giữ chữ ký logic; port `SignaturePort` đã có, adapter CA làm sau (CLAUDE.md: không cài CA ở v1).

## 6. Hướng chi nhánh và tác động

(1) Mã đơn theo **cơ sở KCB**: `facility_code` đặt ở chi nhánh, bộ đếm theo cơ sở. (2) `prescription_document`/bộ đếm khai `branch_id` kế thừa qua lượt khám như các chứng từ khác. (4) Công ty một chi nhánh: giao diện không đổi (chỉ ô mã KCB ở "Thông tin phòng khám"). Tác động: ký đơn, in đơn (đơn nhiều loại in nhiều tờ), Phát thuốc, đính chính, lịch sử khám, bệnh án PDF, "Cấu hình mẫu mã phát sinh", danh mục thuốc (cờ cổ truyền), nhập Excel thuốc. **Đơn đã ký trước ngày bật chế độ**: không cấp mã chuẩn hồi tố (giữ `DT…`), trừ khi chủ dự án muốn khác (câu 7).

## 7. Câu cần chủ dự án chốt

1. Mã cơ sở KCB: đúng 5 chữ số? Mỗi chi nhánh có mã riêng hay dùng chung mã công ty?
2. 7 ký tự giữa: thập phân (đề xuất) hay base-36? Dùng chung bộ đếm cho 4 loại đơn (đề xuất)?
3. `PRECURSOR` (tiền chất) ánh xạ vào H hay C? `TOXIC` (thuốc độc) vào C? (cần dược sĩ/văn bản xác nhận)
4. Thuốc y học cổ truyền: thêm cờ ở danh mục thuốc (đề xuất) hay dùng nhóm thuốc?
5. Đơn nhiều loại: tự tách khi ký (đề xuất) hay chặn trộn, bắt bác sĩ kê đơn riêng?
6. Dòng kê tự do: mặc định C + cho chọn loại tay, hay cấm N/H/Y tự do?
7. Đơn đã ký trước đây: không cấp mã chuẩn (đề xuất) hay cấp hồi tố?
8. Phạm vi lần đầu: GĐ1 + GĐ2 (đề xuất); GĐ3 sau khi có tài liệu kỹ thuật kết nối thật.

## 8. Lộ trình sơ bộ và kiểm thử

GĐ1 (mã + cấu hình) → GĐ2 (phân loại + tách đơn, phần lớn công việc) → GĐ3 (port + outbox). Cần mockup được duyệt cho phần giao diện (cấu hình mã chế độ chuẩn, màn xem trước "sẽ ký thành N đơn", cờ cổ truyền) theo quy tắc làm việc. Test bắt buộc: duy nhất mã dưới tải đồng thời, không đánh số lại, đúng ký tự loại cho từng tổ hợp thuốc, tách đơn, đính chính giữ mã, cô lập hai chi nhánh cùng công ty, không bật được khi thiếu mã KCB.
