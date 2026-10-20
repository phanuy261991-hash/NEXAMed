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

## 7b. ĐÃ CHỐT (16/10/2026, chủ dự án trả lời từng câu)

1. **Mã cơ sở KCB**: đúng 5 chữ số, MỖI CHI NHÁNH một mã riêng (chi nhánh chưa nhập thì lấy mã của công ty).
2. **7 ký tự giữa**: thập phân (`0000001`...), bộ đếm CHUNG cho cả 4 loại đơn theo cơ sở KCB, không đánh số lại.
3. **Tiền chất, thuốc độc**: có BẢNG ÁNH XẠ loại thuốc → loại đơn quản trị sửa được. Mặc định: gây nghiện → N; hướng thần và tiền chất dùng làm thuốc → H; thuốc độc và thuốc thường → C; thuốc có cờ "Đông y" → Y. **Tiền chất → H ĐÃ ĐƯỢC TÀI LIỆU 808 XÁC NHẬN** (trường `loai_don_thuoc`: "h: loại đơn thuốc hướng tâm thần và thuốc tiền chất", xem mục 9). Thuốc độc → C vẫn chưa có văn bản nêu rõ (tài liệu chỉ có 4 loại c/h/n/y), nên giữ qua bảng ánh xạ sửa được.
4. **Thuốc cổ truyền**: thêm cờ "Đông y" ở danh mục thuốc (và cột nhập Excel).
5. **Đơn nhiều loại**: tự tách khi ký, trước khi ký hiện "sẽ ký thành N đơn".
6. **Kê thuốc tự do**: CẤM N/H/Y, dòng tự do luôn là đơn C.
7. **Đơn đã ký trước ngày bật chế độ**: không cấp mã chuẩn hồi tố, giữ mã `DT…`.
8. **Phạm vi**: cả 3 giai đoạn, kể cả chuẩn bị liên thông (port + bảng gửi đơn, chưa gửi thật). **Rủi ro đã nêu**: chưa có tài liệu kỹ thuật kết nối thật nên phần GĐ3 có thể phải làm lại khi có tài liệu; giữ GĐ3 mỏng (port + outbox + kiểm dữ liệu) để giảm rủi ro.

**Việc kế tiếp**: mockup giao diện (cấu hình mã chế độ chuẩn + nhập mã cơ sở theo chi nhánh; xem trước "sẽ ký thành N đơn"; cờ "Đông y"; trang bảng ánh xạ loại thuốc → loại đơn; bản in nhiều tờ) → chủ dự án duyệt → code GĐ1 → GĐ2 → GĐ3.

## 7c. ĐÃ CHỐT về giao diện (16/10/2026, sau mockup https://claude.ai/artifact/6eERQ9k2qsneekMWW2ymjJ — mockup CHƯA được "chốt", chờ chủ dự án duyệt trước khi code)

1. Bảng ánh xạ loại thuốc → loại đơn: pill mới "Loại đơn thuốc" trong Cấu hình hệ thống. Thứ tự ưu tiên khi một thuốc khớp nhiều dòng: N → H → Y → C (đề xuất trong mockup, chưa có câu hỏi riêng).
2. Xem trước "sẽ ký thành N đơn": dải ngay trên nút Ký, chỉ hiện khi đơn có từ 2 loại; nút đổi nhãn "Ký N đơn"; toàn thuốc thường thì giao diện không đổi.
3. Bản in: mỗi đơn pháp lý một tờ, có mã vạch của mã đơn. Tiêu đề "ĐƠN THUỐC N/H" chưa khẳng định đúng mẫu quy định — dược sĩ đối chiếu trước khi dùng thật.
4. Chế độ "Chuẩn Bộ Y tế" tắt lại được, có xác nhận: đơn đã cấp giữ mã chuẩn, đơn mới quay về mã DT…. Không bật được khi còn chi nhánh thiếu mã KCB (5 chữ số).
5. Mã và mật khẩu liên thông của bác sĩ: quản trị nhập hộ trong "Sửa tài khoản" (mã hoá, không hiện lại, chỉ ghi đè).
6. Trang "Đơn thuốc liên thông" (hàng chờ gửi) làm CÙNG đợt này, kèm ô nhập mã/mật khẩu liên thông của cơ sở (hộp "Sửa chi nhánh") và của bác sĩ. Vẫn chưa gửi thật.
6b. Cấu hình kết nối cổng (mockup mục 8d, chốt cùng ngày): pill mới "Liên thông đơn thuốc" trong Cấu hình hệ thống. Chung cả công ty: địa chỉ máy chủ (mặc định `https://api.donthuocquocgia.vn`), môi trường Chính thức/Thử nghiệm (địa chỉ thử để trống tới khi đơn vị vận hành cấp), thời gian chờ, số lần thử lại, công tắc "Gửi đơn lên cổng" (mặc định TẮT: chỉ xếp hàng chờ). Theo chi nhánh/bác sĩ: mã liên thông + token cơ sở, mã liên thông + token bác sĩ, trạng thái "đã thêm bác sĩ vào cơ sở trên cổng" (nút gọi API thêm bác sĩ). **Token KHÔNG nhập tay**, hệ thống tự đăng nhập lại khi còn dưới 1 ngày hoặc khi cổng trả 401, lưu mã hoá, chỉ hiện 4 ký tự cuối; có nút "Kiểm tra kết nối" (chỉ đăng nhập thử). `app-name`/`app-key` chưa cần (chỉ dành API nhà thuốc).
6c. **Đối chiếu lại tài liệu QĐ 808 (mockup bản 6, mục 8f)** — thay đổi so với 6/6b: (a) mã và mật khẩu liên thông của CƠ SỞ và BÁC SĨ nhập ở MỘT nơi là trang "Liên thông đơn thuốc" (8d), bỏ khỏi "Sửa chi nhánh"/"Sửa tài khoản"; (b) thêm "Thêm/Xoá bác sĩ khỏi cơ sở" (API IV, V) và token bác sĩ theo cặp bác sĩ–cơ sở; (c) ô nhập mới ở màn kê đơn (8b): hình thức điều trị (đơn C), đợt dùng thuốc (N/H/Y), số thang thuốc và cách sắc/uống (Y), người giám hộ (trẻ dưới 72 tháng); các ô này lưu RIÊNG, bổ sung được tới lúc đơn được gửi, có nhật ký (chốt); (d) hàng chờ có xem lỗi nguyên văn `danh_sach_cac_loi` và "Gửi lại"; (e) phần tôi tự thêm, KHÔNG thuộc tài liệu: công tắc "Gửi đơn lên cổng" (mặc định tắt), "Kiểm tra kết nối", thông số nâng cao (thời gian chờ, số lần thử), hạn token tự tính (cổng không trả hạn); (f) API nhà thuốc VIII/IX (lấy đơn theo mã, báo số lượng bán, cần app-name/app-key của nhà cung cấp phần mềm) là mở rộng ngoài v1 — **làm SAU giai đoạn 1–3, duyệt riêng (chốt)**. Điểm phải hỏi đơn vị vận hành: sandbox, chữ ký số bắt buộc?, chữ hoa/thường mã đơn, cách cập nhật đơn đã gửi khi đính chính, "72 tháng", danh mục hình thức điều trị, tên trường chẩn đoán, app-key, địa chỉ API nhà thuốc.
7. Chi nhánh: mã KCB, bộ đếm (theo mã KCB; chi nhánh dùng chung mã công ty thì dùng chung bộ đếm), mã/mật khẩu liên thông cơ sở, hàng chờ gửi = THEO CHI NHÁNH; bảng ánh xạ, cờ Đông y, mã/mật khẩu liên thông bác sĩ, chế độ chuẩn = CHUNG cả công ty.

## 8. Lộ trình sơ bộ và kiểm thử

GĐ1 (mã + cấu hình) → GĐ2 (phân loại + tách đơn, phần lớn công việc) → GĐ3 (port + outbox). Cần mockup được duyệt cho phần giao diện (cấu hình mã chế độ chuẩn, màn xem trước "sẽ ký thành N đơn", cờ cổ truyền) theo quy tắc làm việc. Test bắt buộc: duy nhất mã dưới tải đồng thời, không đánh số lại, đúng ký tự loại cho từng tổ hợp thuốc, tách đơn, đính chính giữ mã, cô lập hai chi nhánh cùng công ty, không bật được khi thiếu mã KCB.

## 9. Tài liệu liên thông THẬT (Quyết định 808/QĐ-BYT) — đã nhận 16/10/2026

Bản tham chiếu: `docs/product/references/qd-808-donthuocquocgia-api.md` (PDF gốc: https://donthuocquocgia.vn/quyet-dinh-808.pdf). Máy chủ `https://api.donthuocquocgia.vn`, JSON, token kiểu bearer hiệu lực **7 ngày**.

**Các API cơ sở khám chữa bệnh dùng:**
1. `POST /api/auth/dang-nhap-co-so-kham-chua-benh` — `ma_lien_thong_co_so_kham_chua_benh` + `password` (cấp trên donthuocquocgia.vn) → token cơ sở (dùng để thêm/xoá bác sĩ).
2. `POST /api/v1/them-bac-si` / `/api/v1/xoa-bac-si` — `ma_lien_thong_bac_si`, header `Authorization: bearer`.
3. `POST /api/auth/dang-nhap-bac-si` — `ma_lien_thong_bac_si` + `ma_lien_thong_co_so_kham_chua_benh` + `password` của BÁC SĨ → token bác sĩ (lỗi 422 nếu bác sĩ chưa được thêm vào cơ sở).
4. `POST /api/v1/gui-don-thuoc` (header bearer = token bác sĩ) — gửi đơn; 200 thành công, 422 kèm `danh_sach_cac_loi`.
5. Hai API cho NHÀ THUỐC (không phải phòng khám, cần `app-name`/`app-key` do đơn vị vận hành cấp cho nhà cung cấp phần mềm): `GET /api/v1/thong-tin-don-thuoc/{ma_don_thuoc}` và `POST /api/v1/cap-nhat-don-thuoc` (báo số lượng đã bán). Chỉ liên quan nếu sau này "Phát thuốc" muốn báo số lượng bán lên cổng.

**Điều tài liệu xác nhận / làm rõ cho các quyết định đã chốt:**
- **Tiền chất → H**: `loai_don_thuoc` = `h` là "hướng tâm thần VÀ thuốc tiền chất"; `n` gây nghiện; `y` cổ truyền; `c` cơ bản. Khớp mặc định ở câu 3; thuốc độc không được nêu (giữ C qua bảng ánh xạ).
- **Mã đơn 14 ký tự** (`xxxxxyyyyyyy-z`): 5 ký tự đầu là "mã bảo hiểm của cơ sở khám chữa bệnh" (chưa có thì đăng ký ở donthuocquocgia.vn); 7 ký tự giữa chữ/số bất kỳ, **mã phải duy nhất** (là khoá tra cứu trên hệ thống); ký tự cuối c/n/h/y. **Lưu ý tài liệu không nhất quán về chữ hoa/thường** ("-c" ở phần cấu trúc, "C, N, H, Y" ở phần định dạng; trường `loai_don_thuoc` dùng chữ thường) — cần chốt với đơn vị vận hành, đề xuất lưu mã chuẩn chữ HOA và chuyển chữ thường khi gửi `loai_don_thuoc`.
- **"Mã cơ sở KCB" ≠ "mã liên thông"**: 5 ký tự đầu mã đơn là mã cơ sở KCB; `ma_lien_thong_co_so_kham_chua_benh` là mã khác (đăng nhập API). Cả hai cần lưu theo chi nhánh.

**Khoảng cách mới cho GĐ3 (chưa có trong thiết kế ở mục 5):**
| Cần có | Hiện trạng |
|---|---|
| Mã liên thông + mật khẩu của CƠ SỞ (theo chi nhánh, mật khẩu mã hoá) | Chưa có |
| Mã liên thông + mật khẩu của TỪNG BÁC SĨ (đăng nhập bác sĩ để gửi đơn; mật khẩu mã hoá, token 7 ngày phải làm mới) | Chưa có — `user_account` chỉ có CCHN; đây là điểm thiết kế quan trọng: gửi đơn chạy với danh tính bác sĩ ký |
| `ma_thuoc` 20 ký tự (danh mục thuốc quốc gia), BẮT BUỘC mỗi dòng thuốc | `drug.national_code` có nhưng không bắt buộc; dòng kê tự do không có mã → không gửi được, cần xử lý (cảnh báo/bỏ qua) |
| `biet_duoc` = hoạt chất chính (hoặc tên dược liệu với đơn Y) | Có `drug.active_ingredient`/`drug_ingredient`, chưa ánh xạ |
| `hinh_thuc_dieu_tri` (danh mục BYT) — bắt buộc với đơn loại C | Chưa có danh mục/trường |
| `dot_dung_thuoc` (đợt, từ ngày, đến ngày; thêm số thang thuốc với đơn Y) — bắt buộc với đơn H/N/Y | Chưa có |
| `thong_tin_nguoi_giam_ho` (họ tên, SĐT, địa chỉ) — bắt buộc khi người khám là trẻ dưới ngưỡng tháng tuổi (tài liệu ghi "hơn 72 tháng", chữ có vẻ lỗi — đối chiếu PDF/đơn vị vận hành; nhiều khả năng là DƯỚI 72 tháng) | Có `relative_*` của bệnh nhân |
| `gioi_tinh` số 1/2/3 (chưa rõ/nam/nữ); `ngay_sinh_benh_nhan` d/m/Y; `ngay_gio_ke_don` Y-m-d H:i:s; `ngay_tai_kham` là SỐ NGÀY kể từ ngày kê | Cần hàm ánh xạ; `follow_up` hiện lưu ngày hẹn |
| `chan_doan` danh sách (mã ICD-10, tên, kết luận) | Có; tài liệu ghi tên trường không nhất quán (`ma_chan_doan` ở mẫu, `ma_benh` ở bảng) — cần thử với môi trường thật |
| `signature` chữ ký số của người kê đơn | v1 chỉ chữ ký logic; tài liệu không đánh dấu bắt buộc nhưng có trường — hỏi đơn vị vận hành cổng có chấp nhận thiếu không |
| Giới hạn độ dài: `cach_dung` 500, `luu_y`/`loi_dan` 2000, `ho_ten`/`dia_chi` 500, `ma_thuoc` 20 | Cắt/kiểm khi dựng gói gửi |

**Điều chỉnh thiết kế GĐ3**: ngoài port + outbox + kiểm dữ liệu đã chốt, thêm (a) lưu mã liên thông + mật khẩu mã hoá theo chi nhánh và theo bác sĩ, (b) bộ giữ token có hạn 7 ngày (đăng nhập lại khi hết hạn/401), (c) hàm dựng gói `gui-don-thuoc` thuần ở `packages/core` có test từng trường bắt buộc theo loại đơn, (d) bảng `prescription_submission` ghi cả `danh_sach_cac_loi` trả về. **Còn cần hỏi đơn vị vận hành cổng**: môi trường thử (sandbox), yêu cầu chữ ký số, chuẩn chữ hoa/thường mã đơn, cách đăng ký mã liên thông bác sĩ/cơ sở.
