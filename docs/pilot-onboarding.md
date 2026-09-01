# Pilot Onboarding — Hướng dẫn sử dụng + Giáo án đào tạo 2 giờ

Tài liệu cho **nhân viên phòng khám pilot** (S4-06, `docs/product/plan.md` mục 7) — không phải tài liệu kỹ thuật. Dùng khi đào tạo lần đầu và làm tài liệu tra cứu nhanh sau này. Khác `docs/Deploy.md` (dành cho người cài đặt/kỹ thuật) và `docs/demo.md` (dành cho dev).

Cập nhật tài liệu này khi có màn hình/luồng nghiệp vụ mới đáng đào tạo, hoặc khi thứ tự thao tác thay đổi — không để lệch với giao diện thật.

---

## 1. Hệ thống dùng để làm gì

NEXAMed thay thế sổ giấy cho 4 việc: **Đặt lịch → Tiếp nhận → Khám bệnh → Kê đơn**, cộng **Thu ngân** (phiếu thu mỗi lượt khám). Mỗi người chỉ cần biết phần việc của mình — không ai cần hiểu toàn bộ hệ thống.

| Vai trò | Việc chính trên hệ thống |
|---|---|
| Lễ tân | Đặt lịch, tiếp nhận khách (có hẹn hoặc vãng lai), thu tiền |
| Bác sĩ | Xem hàng đợi, khám bệnh, ghi chẩn đoán, kê đơn, ký hồ sơ |
| Điều dưỡng | Đo sinh hiệu, hỗ trợ tiếp nhận |
| Quản trị phòng khám | Quản lý tài khoản, danh mục, cấu hình, xem nhật ký hoạt động |

---

## 2. Giáo án đào tạo 2 giờ

Đào tạo **theo vai trò**, không dạy chung một buổi cho tất cả — lễ tân không cần biết kê đơn, bác sĩ không cần biết tạo tài khoản. Mỗi buổi 2 giờ dùng dữ liệu **thật của phòng khám** (không dùng dữ liệu mẫu) để nhân viên làm quen ngay với ca thật đầu tiên.

### 2.1. Buổi cho Lễ tân/Điều dưỡng tiếp nhận (2 giờ)

| Thời lượng | Nội dung | Mục 3 tương ứng |
|---|---|---|
| 15 phút | Đăng nhập, đổi mật khẩu lần đầu, làm quen giao diện chung (sidebar, TopBar) | 3.1 |
| 25 phút | Đặt lịch hẹn mới, tìm/sửa/huỷ lịch, xử lý khách gọi lại xin đổi giờ | 3.2 |
| 30 phút | Tiếp nhận khách có hẹn (check-in) và khách vãng lai (tiếp nhận trực tiếp), đo sinh hiệu | 3.3 |
| 20 phút | Thu tiền, in phiếu thu, xử lý "chưa thu ngay" nếu phòng khám bật tính năng | 3.4 |
| 15 phút | Xử lý tình huống: khách bỏ về, huỷ lượt khám, tìm nhầm hồ sơ, gộp hồ sơ trùng | 3.5 |
| 15 phút | Thực hành với 3 ca thật liên tiếp dưới sự giám sát trực tiếp | — |

### 2.2. Buổi cho Bác sĩ (2 giờ)

| Thời lượng | Nội dung | Mục 3 tương ứng |
|---|---|---|
| 10 phút | Đăng nhập, đổi mật khẩu lần đầu, chọn phòng làm việc hôm nay | 3.1 |
| 20 phút | Hàng đợi khám: xem "Bệnh nhân của tôi"/"Hàng chờ chung", nhận ca | 3.6 |
| 40 phút | Màn hình khám: xem tiền sử, nhập chẩn đoán (tra ICD-10), ghi chú khám, đo lại sinh hiệu | 3.7 |
| 30 phút | Kê đơn thuốc, xử lý cảnh báo trùng thuốc/dị ứng, ký đơn, in đơn | 3.8 |
| 15 phút | Hoàn tất khám (tự động ký hồ sơ), đính chính sau khi đã ký, Tạm nghỉ/Đóng ca | 3.9 |
| 5 phút | Thực hành 1 ca thật | — |

### 2.3. Buổi cho Quản trị phòng khám (2 giờ, thường là chủ phòng khám hoặc người được uỷ quyền)

| Thời lượng | Nội dung |
|---|---|
| 20 phút | Tạo/sửa/vô hiệu hoá tài khoản nhân viên, gán vai trò |
| 25 phút | Quản lý danh mục dùng chung (dịch vụ khám, đơn giá, danh mục thuốc, Khoa/Phòng) |
| 20 phút | Cấu hình hệ thống: giờ làm việc, thanh toán sau, ngưỡng cảnh báo chờ lâu |
| 25 phút | Xem nhật ký hoạt động (ai xem/sửa hồ sơ nào, lúc nào) — phục vụ giải trình khi cần |
| 20 phút | Tổng kết thu cuối ngày, đối chiếu phiếu thu |
| 10 phút | Break-glass là gì và khi nào dùng (mở khoá khẩn cấp có ghi vết, không phải cách "lách" quy trình) |

**Sau đào tạo**: để lại tài liệu này (bản in hoặc PDF) tại quầy lễ tân và phòng khám để tra cứu — không yêu cầu nhớ hết ngay buổi đầu.

---

## 3. Hướng dẫn nhanh theo thao tác

### 3.1. Đăng nhập lần đầu

1. Mở trình duyệt, vào địa chỉ được cấp (ví dụ `http://192.168.1.50` — dán vào Bookmark/màn hình chính để lần sau không phải gõ lại).
2. Đăng nhập bằng tên đăng nhập + mật khẩu tạm được cấp.
3. Hệ thống **bắt buộc đổi mật khẩu ngay** — không bỏ qua được. Chọn mật khẩu dễ nhớ với người dùng nhưng khó đoán với người khác (không dùng số điện thoại/ngày sinh).
4. Mục "Thông tin tài khoản" (bấm vào ảnh đại diện góc trên phải) để tự sửa số điện thoại/email cá nhân sau này — không cần nhờ quản trị.

### 3.2. Đặt lịch hẹn

- Vào "Lịch hẹn" — xem theo **Lưới** (cột = bác sĩ, hàng = khung giờ) hoặc **Danh sách**.
- Kéo-chọn ô trống trên lưới (hoặc bấm "Đặt lịch mới") → nhập SĐT khách → hệ thống tự điền tên nếu đã đặt trước đó → chọn lý do khám → Lưu. Hệ thống báo mã đặt lịch, đọc cho khách nếu họ cần.
- Đổi giờ/huỷ lịch: bấm vào ô lịch hẹn trên lưới → "Sửa"/"Huỷ" (huỷ phải ghi lý do).
- Khách gọi lại xin đổi ngày nhiều lần (≥5 lần huỷ) — hệ thống tự cảnh báo, cân nhắc trao đổi trực tiếp với khách trước khi đặt tiếp.

### 3.3. Tiếp nhận

**Khách đã có hẹn**: mở lịch hẹn hôm nay → bấm "Check-in" → xác nhận thông tin bệnh nhân, dịch vụ khám → xong.

**Khách vãng lai (không hẹn trước)**: vào "Tiếp nhận bệnh nhân" → gõ SĐT/CCCD (hệ thống tự báo nếu đã có hồ sơ cũ) → điền/xác nhận thông tin → chọn Khoa/bác sĩ hoặc để hệ thống điều phối theo Khoa → chỉ định dịch vụ khám → đo sinh hiệu ngay nếu có → Lưu.

Tìm nhầm khách? Dùng icon **kính lúp tìm kiếm** cạnh ô SĐT — mở popup tìm theo tên/SĐT, chọn đúng người, form tự điền lại.

### 3.4. Thu tiền

- Sau tiếp nhận, hệ thống tự tạo phiếu thu theo dịch vụ đã chỉ định.
- Vào "Thu ngân" → "Danh sách cần thu" → chọn phiếu → xác nhận đã thu + chọn hình thức thanh toán → in phiếu nếu khách cần.
- Nếu phòng khám **bật "Thanh toán sau"**: có thể cho khách vào khám trước, thu tiền sau — chỉ dùng khi quản trị đã bật tính năng này.
- Cuối ngày: "Thu ngân" → xem tổng kết thu trong ngày, đối chiếu tiền mặt/chuyển khoản thực tế.

### 3.5. Tình huống phát sinh

| Tình huống | Cách xử lý |
|---|---|
| Khách bỏ về, chưa khám | Nút "Hủy" ở Danh sách tiếp nhận/Hàng đợi khám — chọn lý do |
| Khách đang khám dở, bác sĩ bận việc khác | "Trả về hàng chờ" — khách quay lại hàng chờ chung, không mất dữ liệu đã nhập |
| Đã thu tiền nhưng phải huỷ ca | "Hủy khám" → hệ thống tự đánh dấu "Cần hoàn tiền" — chỉ Quản trị mới xác nhận hoàn tiền được |
| Tạo trùng 2 hồ sơ cho cùng một khách | Vào "Danh sách bệnh nhân", chọn 2 dòng trùng → "Gộp hồ sơ" (chỉ Quản trị làm được) |

### 3.6. Hàng đợi khám (dành cho bác sĩ)

- Đăng nhập lần đầu trong ngày → chọn "Phòng làm việc hôm nay" (bắt buộc chọn lại mỗi ngày).
- "Hàng đợi khám" có 3 cột: **Đang chờ** (của tôi + hàng chờ chung Khoa), **Đang khám**, **Đã khám hôm nay**.
- Bấm "Nhận ca" trên một khách ở cột "Đang chờ" → chuyển sang màn hình khám.
- Đang khám dở mà cần xem/chuyển ca khác: dùng nút "Hàng chờ" ở thanh trên cùng màn khám, không cần quay ra trang Hàng đợi khám.

### 3.7. Màn hình khám

- Panel trái: 2 tab **Tiền sử bệnh** (dị ứng/bệnh nền/tiền sử gia đình) và **Lịch sử khám** (các lần khám trước, bấm vào để xem chi tiết).
- Khung giữa: nhập **Chẩn đoán** (gõ tên bệnh hoặc mã ICD-10, hệ thống gợi ý) và các mục khám (lý do khám, quá trình bệnh lý, khám toàn thân/bộ phận).
- Dải sinh hiệu trên cùng — bấm để đo lại/bổ sung nếu cần trong lúc khám.
- Ghi chú **tự động lưu** sau vài giây — không lo mất dữ liệu nếu chuyển sang ca khác giữa chừng.

### 3.8. Kê đơn

- Tab "Kê đơn thuốc" trong màn khám → tìm thuốc trong danh mục → nhập liều/số lần/số ngày/hướng dẫn dùng.
- Hệ thống tự cảnh báo (không chặn) nếu: 2 thuốc trùng hoạt chất, hoặc thuốc trùng với dị ứng đã ghi nhận của bệnh nhân — đọc kỹ cảnh báo trước khi quyết định giữ nguyên đơn.
- Bấm "Ký đơn" khi chắc chắn — sau khi ký, đơn khoá lại, sửa phải qua "Sửa đơn" (tạo bản đính chính, giữ lại bản gốc để đối chiếu).
- "In đơn" để đưa cho khách.

### 3.9. Hoàn tất khám

- Bấm "Hoàn tất khám" khi đã nhập đủ chẩn đoán chính → hồ sơ **tự động ký**, khoá nội dung lại (đúng quy định lưu trữ hồ sơ bệnh án).
- Sau khi hoàn tất, muốn sửa phải dùng "Đính chính" (ghi rõ lý do sửa) — không sửa tự do được nữa, đây là quy định bắt buộc, không phải lỗi hệ thống.
- Cuối ca làm việc: bấm bánh răng cạnh ảnh đại diện → "Đóng ca hôm nay" — các khách chưa khám xong (nếu có) tự động chuyển về hàng chờ chung cho bác sĩ khác.

---

## 4. Câu hỏi thường gặp

**Quên mật khẩu?** Nhờ Quản trị phòng khám vào "Danh mục quản lý tài khoản" đặt lại mật khẩu tạm, đăng nhập xong hệ thống bắt đổi lại ngay.

**Máy tính bị tắt đột ngột giữa lúc đang khám thì sao?** Ghi chú khám tự lưu mỗi vài giây — mở lại ca khám đó, dữ liệu vẫn còn gần như đầy đủ, chỉ có thể mất vài giây gõ cuối cùng.

**Không thấy mục "Quản trị"/"Kê đơn"/... trên menu?** Bình thường — mỗi tài khoản chỉ thấy mục đúng với vai trò được cấp. Cần quyền thêm thì báo Quản trị phòng khám.

**Cần xem/sửa gấp một hồ sơ ngoài quyền của mình (bác sĩ trực khác đã ký, cấp cứu...)?** Dùng "Phá kính" (break-glass) — hệ thống yêu cầu nhập lại mật khẩu + lý do, **có ghi vết đầy đủ** (ai, lúc nào, vì sao) trong Nhật ký hoạt động. Không phải cách né tránh quy trình — chỉ dùng khi thật sự cần thiết, chủ phòng khám sẽ soát lại định kỳ.

**Hệ thống báo lỗi/không vào được?** Ghi lại: đang làm gì, thông báo lỗi hiện chữ gì, giờ xảy ra — báo ngay cho người phụ trách kỹ thuật, không tự ý thử lại nhiều lần liên tục (có thể tạo dữ liệu trùng).