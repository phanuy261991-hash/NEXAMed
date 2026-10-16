<!-- Bản tham chiếu tài liệu kỹ thuật liên thông đơn thuốc quốc gia (Quyết định 808/QĐ-BYT ngày 01/4/2022), do chủ dự án gửi 16/10/2026; trích từ https://donthuocquocgia.vn/quyet-dinh-808.pdf. Bản chữ này chuyển từ PDF nên một số bảng bị vỡ định dạng — đối chiếu PDF gốc khi cần. Phân tích đối chiếu với NEXAMed: docs/product/prescription-code-moh.md mục 9. -->

# III. API CƠ SỞ KHÁM CHỮA BỆNH DÙNG ĐỂ ĐĂNG NHẬP

## 1. Điều kiện và mục đích sử dụng

- Điều kiện: Cơ sở khám chữa bệnh phải được cấp mã liên thông và mật
khẩu trên hệ thống đơn thuốc quốc gia.

- API sử dụng cho phần mềm kê đơn đăng nhập ấy token cho phiên làm
việc. Token này được sử dụng trong API thêm bác sĩ vào cơ sở khám chữa bệnh và API xóa bác sĩ khỏi cơ sở khám chữa bệnh.

- Token đăng nhập có hiệu lực 7 ngày.
## 2. Mô tả

**URL:** <u>[https://api.donthuocquocgia.vn](https://api.donthuocquocgia.vn)</u>

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Link API|/ api/auth/dang-nhap-co-so-kham-chua-benh||
|Method|POST||
|Request Header|Content-Type: application/json||
|FormData|{"ma_lien_thong_co_so_kham_chua_benh" : {ma_lien_thong_co_so_kham_chua_benh}, "password" : {password}}||

## 3. Dữ liệu đầu vào

## Dữ liệu Tên trường dữ liệu Kiểu dữ liệu Bắt Ghi chú đầu vào buộc

Mã liên ma_lien_thong_co_so_ Chuỗi ký tự x Mã liên thông cơ thông kham_chua_benh sở khám chữa cơ sở bệnh mà bác sĩ khám <u>đã được thêm</u>

chữa vào. bệnh Mật password Chuỗi ký tự x Mật khẩu tài khẩu khoản cơ sở khám chữa bệnh

## 4. Dữ liệu trả về khi lỗi Trường thông Giá trị Ghi chú tin

Header Status 422 Mã liên thông cơ sở khám chữa bệnh hoặc mật khẩu không đúng

## 5. Dữ liệu trả về trường hợp thành công

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200||
|Header Type|Content- application/json;charset=UTF-8||
|JsonData|{token: {token} token_type: “bearer”}|- token được sử dụng cho phiên làm việc-token type: loại token là bearer để truyền lên kèm theo token.|

# IV. API THÊM BÁC SĨ VÀO CƠ SỞ KHÁM CHỮA BỆNH

## 1. Điều kiện và mục đích sử dụng

- Điều kiện: bác sĩ đã được cấp mã liên thông trên hệ thống đơn thuốc
quốc gia

- Cơ sở dùng API đăng nhập cơ sở khám chữa bệnh để lấy token cho
phiên làm việc.

**2. Mô tả** URL: <u>[https://api.donthuocquocgia.vn](https://api.donthuocquocgia.vn)</u>

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Link API|/api/v1/them-bac-si||
|Method|POST||
|Request Header FormData|Content Type: application/json Authorization: bearer { token } { “ma_lien_thong_bac_si”: { ma_lien_thong_bac_si } }|token lấy được trên API đăng nhập cơ sở khám chữa bệnh.|

**3. Dữ liệu đầu vào** **Dữ Tên trường dữ liệu Kiểu dữ liệu Kích Bắt Ghi chú liệu thước buộc** **đầu vào**
## ma_lien_thong_bac_si Chuỗi ký tự

|Mã|x Mã liên thông||
|---|---|---|
|liên|bác sĩ kê đơn -||
|thông|được cung cấp||
|bác sĩ|bởi|hệ thống|

đơn thuốc điện tử

## 4. Dữ liệu trả về khi lỗi

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|422||
|JsonData|{danh_sach_cac_loi}|Danh sách các lỗi|

## 5. Dữ liệu trả về trường hợp thành công

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200||
|Header Content-Type|application/json;charset=UTF-8||
|JsonData|{'success' => 'Bạn đã thêm bác sĩ thành công'}||

# V. API XÓA BÁC SĨ KHỎI CƠ SỞ KHÁM CHỮA BỆNH

**1. Mục tiêu**
- Điều kiện: bác sĩ đã được cấp mã liên thông trên hệ thống đơn thuốc
quốc gia và được thêm vào cơ sở khám chữa bệnh dựa trên API ở mục I.

- Cơ sở dùng API đăng nhập cơ sở khám chữa bệnh để lấy token cho
phiên làm việc.

**2. Mô tả** URL: <u>[https://api.donthuocquocgia.vn](https://api.donthuocquocgia.vn)</u>
## Giá trị Mô tả

|Request|Content Type: application/json|token lấy được trên|
|---|---|---|
|Header|Authorization: bearer {token}|API đăng nhập cơ sở khám chữa bệnh.|

|Trường thông||
|---|---|
|tin||
|Link API|/api/v1/ xoa-bac-si|
|Method|POST|
|FormData|{|

“ma_lien_thong_bac_si” : { ma_lien_thong_bac_si } }

**3. Dữ liệu đầu vào**

|Dữ liệu|Tên trường dữ liệu|Kiểu dữ|Kích|Bắt|Ghi chú|
|---|---|---|---|---|---|
|đầu vào||liệu|thước|buộc||
|Mã liên thông bác sĩ|ma_lien_thong_bac_si|Chuỗi ký tự||x|Mã liên thông bác sĩ kê đơn - được cung cấp bởi hệ thống đơn thuốc quốc|
||||||gia|

**4. Dữ liệu trả về khi lỗi**

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|422||
|JsonData|{danh_sach_cac_loi}|Danh sách các lỗi|

**5. Dữ liệu trả về trường hợp thành công**

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200||
|Header Content-Type|application/json;charset=UTF-8||
|JsonData|{'success' => 'Bạn đã xóa bác sĩ khỏi cơ sở khám chữa bệnh thành công'}||

# VI. API ĐĂNG NHẬP BÁC SĨ

## 1. Điều kiện và mục đích sử dụng

- Điều kiện: bác sĩ đã được cấp mã liên thông và mật khẩu trên hệ thống
đơn thuốc quốc gia.

- Mục đích API sử dụng đăng nhập bác sĩ lấy token cho phiên làm việc
gửi đơn thuốc lên hệ thống đơn thuốc quốc gia. Khi đăng nhập cần tài khoản liên thông bác sĩ và mã liên thông của cơ sở khám chữa bệnh mà bác sĩ đã được thêm vào ở phần IV.

- Token đăng nhập có hiệu lực 7 ngày.
## 2. Mô tả

URL: <u>[https://api.donthuocquocgia.vn](https://api.donthuocquocgia.vn)</u>

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Link API|/api/auth/dang-nhap-bac-si||
|Method|POST||
|Request Header|Content-Type: application/json||
|FormData|{"ma_lien_thong_bac_si": {ma_lien_thong_bac_si}, "ma_lien_thong_co_so_kham_chua_benh": {ma_lien_thong_co_so_kham_chua_benh}, "password" : {password}}||

## 3. Dữ liệu đầu vào liệu đầu Tên trường dữ liệu

|Dữ|Kiểu dữ Bắt||Ghi chú|
|---|---|---|---|
|vào|liệu|buộc||
|Mã liên thông ma_lien_thong_bac_si|Chuỗi|x|Mã|
|bác sĩ|ký tự||bác sĩ|

liên thông

|Mã liên thông ma_lien_thong_co_so_kham_ Chuỗi|x Mã|liên|thông|
|---|---|---|---|
|cơ sở|cơ|sở|khám|
|chữa bệnh|chữa|bệnh|mà|

khám chua_benh ký tự bác sĩ đã được thêm vào. Mật khẩu password Chuỗi x Mật khẩu tài ký tự khoản bác sĩ

## 4. Dữ liệu trả về khi lỗi

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|422||
|JsonData|{danh_sach_cac_loi}|Danh sách các lỗi: - Bác sĩ chưa được thêm vào cơ sở khám chữa bệnh. - Mã liên thông hoặc mật khẩu không đúng|

## 5. Dữ liệu trả về trường hợp thành công

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200||
|Header Content-Type|application/json;charset=UTF-8||
|JsonData|{token: {token}, tocken_type: “bearer”}|token được sử dụng cho phiên làm việc của bác sĩ|

# VII. API GỬI ĐƠN THUỐC

## 1. Chuẩn mã đơn thuốc

Mã đơn thuốc cần được tạo ra tự động theo cấu trúc như sau Mã đơn thuốc, hệ thống thông tin tự sinh mã theo quy định (định dạng: xxxxxyyyyyyy-z; 05 ký tự x đầu tiên là mã cơ cở KBCB; 07 ký tự y tiếp theo bao gồm ký tự 0-9 hoặc a-z; ký tự cuối cùng z có 01 trong 04 giá trị ký tự C, N, H, Y thể hiện loại đơn thuốc, C: đơn thuốc thông thường, N: đơn thuốc nghiện, H: đơn thuốc hướng hướng thần, Y: đơn thuốc y học cổ truyền) Số lương ký tự: 14 ký tự Cấu trúc:

- 5 ký tự đầu là mã bảo hiểm của cơ sở khám chữa bệnh (nếu chưa có thì
đăng ký ở trang donthuocquocgia.vn)

- 7 ký tự tiếp theo là mã đơn thuốc sinh ra tự động, các ký tự có thể là số
từ 0-9 hoặc chữ a-z.

- 2 ký tự cuối là ‘-c’ – đơn thuốc chuẩn, ‘-n’ – đơn thuốc gây nghiện, ‘-h’
– đơn thuốc hướng thần, ‘-y’ – đơn thuốc y học cổ truyền

**2. Mô tả** URL: <u>[https://api.donthuocquocgia.vn](https://api.donthuocquocgia.vn)</u>
## Giá trị Ghi chú

|Request|Content Type: application/json|token lấy được|
|---|---|---|
|Header|Authorization: bearer {token}|trên API đăng nhập bác sĩ|

|FormData|{||
|---|---|---|
||“loai_don_thuoc”: {loai_don_thuoc}, “ma_don_thuoc”: {ma_don_thuoc},||

|Trường||
|---|---|
|thông tin||
|Link API|/api/v1/gui-don-thuoc|
|Method|POST|

“ho_ten_benh_nhan”:{ho_ten_benh_nhan}, “ma_dinh_danh_y_te”: {ma_dinh_danh_y_te}, “ma_dinh_danh_cong_dan”: {ma_dinh_danh_cong_dan}, “ngay_sinh_benh_nhan”: { ngay_sinh_benh_nhan }, “can_nang” : { can_nang }, “gioi_tinh” : { gioi_tinh }, “ma_so_the_bao_hiem_y_te”: {ma_so_the_bao_hiem_y_te}, “thong_tin_nguoi_giam_ho”: { thong_tin_nguoi_giam_ho }, “dia_chi” : { dia_chi }, “chan_doan” : [{ “ma_chan_doan” : { ma_chan_doan }, “ten_chan_doan” : { ten_chan_doan }, “ket_luan” : { ket_luan }, }], “luu_y” : { luu_y }, “hinh_thuc_dieu_tri” : { hinh_thuc_dieu_tri }, “dot_dung_thuoc” : { dot_dung_thuoc }, “thong_tin_don_thuoc” : [{ “ma_thuoc” : { ma_thuoc }, “biet_duoc” : { biet_duoc }, “ten_thuoc” : { ten_thuoc },

“don_vi_tinh” : { don_vi_tinh }, “so_luong” : { so_luong }, “cach_dung” : { cach_dung }, }], “loi_dan” : { loi_dan }, “so_dien_thoai_nguoi_kham_benh”: {so_dien_thoai_nguoi_kham_benh}, “ngay_tai_kham” : {ngay_tai_kham}, “ngay_gio_ke_don” : { ngay_gio_ke_don}, “signature”: { chu_ky_so} }

## 3. Dữ liệu đầu vào

|TT|DTữ liệu đầu vào|Tên trường dữ liệu|Kiểu dữ liệu|Kích thước|Bắt buộc|Ghi chú|
|---|---|---|---|---|---|---|
|1|Loại đơn thuốc|loai_don_thuoc|[ c, h, n, y]|1 ký tự|x|Loại đơn thuốc sẽ ứng với 1 trong 4 ký tự: - c: loại đơn thuốc cơ bản-h: loại đơn thuốc hướng tâm thần và thuốc tiền chất-n: loại đơn thuốc gây nghiện -y: loại đơn|

|thuốc cổ truyền|||||||
|---|---|---|---|---|---|---|
|2|Mã đơn ma_don_thuoc thuốc||Chuỗi kỹ tự|14 ký tự|x|Mã đơn thuốc là từ khóa để tìm kiếm đơn thuốc trên hệ thống đơn thuốc điện tử. Mã đơn thuốc phải là duy nhất Mã đơn thuốc cấu trúc gồm mã bảo hiểm cơ sở khám chữa bệnh(5 ký tự) + 7 ký tự bất kỳ bao gồm chữ và số + 2 ký tự cuối là ‘- c’ – đơn thuốc chuẩn, ‘-n’ – đơn thuốc gây nghiện, ‘-h’ – đơn thuốc hướng thần, ‘-y’ – đơn thuốc y học cổ truyền|
|3|Họ tên ho_ten_benh_ bệnh nhân|nhan|Chuỗi kỹ tự|500 ký tự|x|Họ tên của bệnh nhân đến khám chữa bệnh|
|4|Ngày sinh bệnh nhân|ngay_sinh_benh _nhan|Date: d/m/Y||x|Ngày sinh của bệnh nhân Date format: Ngày/Tháng/Nă m|

|5|Mã định danh y tế|ma_dinh_danh_y _te|Chuỗi ký 10 tự|ký tự||Mã định danh y tế của bệnh nhân|
|---|---|---|---|---|---|---|
|6|Mã định danh công dân|ma_dinh_danh _cong_dan|Chuỗi số|12 số||Mã định danh công dân được cấp bới bộ công an|
|7|Cân nặng|can_nang|Số|||Cân nặng của bệnh nhân.|
|8|Giới tính|gioi_tinh|Số||x|Giới tính của bệnh nhân 1: Chưa có thông tin 2: Giới tính Nam 3: Giới tính nữ|
|9|Mã số bảo hiểm y tế|ma_so_bao_ hiem_y_te|Chuỗi ký 10 tự|ký tự||Mã số bảo hiểm y tế của bệnh nhân nếu có.|
|10|Thông tin người giám hộ|thong_tin_nguoi _giam_ho|Chuỗi ký 500 ký Bắt tự|tự|buộc trong trườn g hợp hộ. người khám bệnh là trẻ em hơn 72|Thông tin người giám hộ: Họ tên, Số điện thoại, địa chỉ người giám|

|tháng tuổi|||||||
|---|---|---|---|---|---|---|
|11|Địa chỉ bệnh nhân|dia_chi|Chuỗi ký 500 ký tự|tự|x|Địa chỉ thường trú, tạm trú của bệnh nhân|
|12|Chẩn đoán|chan_doan|Danh sách chẩn đoán bệnh.||x|Thông tin phần tử chẩn đoán: ma_benh: Mã bệnh theo ICD10 ten_benh: Tên bệnh theo ICD10 ket_luan: Kết luận của bác sĩ.|
|13|Lưu ý|luu_y|Chuỗi ký 2000 tự|ký tự||Lưu ý của bác sĩ|
|14|Hình thức điều trị|hinh_thuc_dieu _tri|Số||Bắt buộc nếu loại đơn thuốc là đơn thuốc cơ bản|Danh mục hình thức điều trị ban hành bởi Bộ Y tế|
|15|Đợt dùng thuốc|dot_dung_thuoc|Danh sách||Bắt buộc nếu loại đơn thuốc là h,|Danh sách đợt dùng thuốc gồm: - Đợt: số - từ ngày: Date format d/m/Y|

|n hoặc y|- đến ngày: Date format d/m/Y-Số thang thuốc: yêu cầu đối với thuốc y học cổ truyền||||||
|---|---|---|---|---|---|---|
|16|Thông tin đơn _thuoc thuốc|thong_tin_don|Thông tin đơn thuốc bao gồm danh sách các thuốc được kê đơn||x|Các phần tử của một thông tin thuốc gồm mã thuốc, biệt dược, tên thuốc, đơn vị tính, số lượng và cách dùng được mô tả ở các hàng bên dưới.|
|17|Mã thuốc|ma_thuoc|Chuỗi ký 20 tự|ký tự|x|Danh mục mã thuốc được cấp bởi cục quản lý dược Bộ Y tế|
|18|Biệt dược|biet_duoc|Chuỗi ký 500 ký tự|tự|x|Biệt dược ( hoạt chất ) chính của thuốc Đối với đơn thuốc y học cổ truyền: Tên dược liệu, vị thuốc cổ truyền|
|19|Tên thuốc|ten_thuoc|Chuỗi ký 500 ký tự|tự|x|Tên thương mại của thuốc|
|20|Đơn vị tính|don_vi_tinh|Chuỗi ký 500 ký tự|tự|x|Đơn vị tính của thuốc|

|21|Số lượng|so_luong|Số||x|Số lượng thuốc được kê theo đơn vị tính|
|---|---|---|---|---|---|---|
|22|Cách dùng|cach_dung|Chuỗi ký 500 ký tự|tự|x|Cách dùng thuốc bao gồm: đường dùng, liều dùng, thời gian dùng,…|
|23|Lời dặn|loi_dan|Chuỗi ký 2000 tự|ký tự||Lời dặn của bác sĩ Đối với đơn thuốc y học cổ truyền cần mô tả thêm: Cách sắc thuốc, cách uống thuốc.|
|24|Số điện so_dien_thoai thoại người khám bệnh|_nguoi_kham _benh|Chuỗi số.|12 số||Số điện thoại liên lạc của người đến khám bệnh|
|25|Ngày tái khám|ngay_tai_kham|Số ngày|||Số ngày bệnh nhân đến khám lại kể từ ngày kê đơn.|
|26|Ngày giờ kê don đơn|ngay_gio_ke_|Datetime: Y-m-d H:m:s|||Ngày giờ bác sĩ kê đơn trên phần mềm gửi lên. Ngày giờ kê đơn bao gồm cả ngày và giờ có cấu trúc:Y-m-d|

H:m:s

27 Chữ ký signature signature Chữ ký số của số người kê đơn

## 4. Dữ liệu trả về khi lỗi

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|422||
|JsonData|{danh_sach_cac_loi}|Danh sách các lỗi|

## 5. Dữ liệu trả về trường hợp thành công

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200 Header Content-Type application/json;charset=UTF-8||
|JsonData|{'success' => 'Gửi đơn thuốc thành công'}||

# VIII. API LẤY ĐƠN THUỐC

## 1. Điều kiện và mục đích sử dụng

**-**Api sử dụng cho nhà thuốc lấy thông tin đơn thuốc trên đơn thuốc quốc gia về phần mềm bán thuốc để bán.

- Yêu cầu: các đơn vị cung cấp phần mềm liên hệ với đơn vị hỗ trợ vận
hành để lấy app-name và app-key sử dụng cho API. App-name và app-key là những thông tin bảo mật tương ứng với từng đơn vị phần mềm. Khi lấy thông tin đơn thuốc phải gửi kèm app-name và app-key.

## 2. Mô tả

URL: <u>www.donthuocquocgia.vn</u> **Trường thông tin Giá trị Ghi chú**

Link API /api/v1/thong-tin-don- thuoc/{ma_don_thuoc}

Request Header Content Type: application/json app-name: {app-name} app-key: {app-key}

## Method GET

## Tham số ma_don_thuoc

## 3. Dữ liệu trả về khi lỗi

|Trường thông tin|Kết quả|Ghi chú|
|---|---|---|
|Header Status|404||
|JsonData|{“danh_sach_cac_loi}|Danh sách các lỗi: Không tìm thấy đơn thuốc|

## 4. Dữ liệu trả về trường hợp thành công

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200||
|Header Content-|application/json;charset=UTF-8||

|Type|||
|---|---|---|
|JsonData|{ ma_don_thuoc: { ma_don_thuoc}, ho_ten_benh_nhan: {ho_ten_benh_nhan}, ngay_sinh_benh_nhan:{ ngay_sinh_benh_nhan }, ma_dinh_danh_y_te: { ma_dinh_danh_y_te }, loai_don_thuoc: { loai_don_thuoc }, hinh_thuc_dieu_tri: { hinh_thuc_dieu_tri }, dia_chi: { dia_chi }, gioi_tinh: { gioi_tinh }, can_nang: { can_nang }, ma_so_the_bao_hiem_y_te: { ma_so_the_bao_hiem_y_te }, thong_tin_don_thuoc: { thong_tin_don_thuoc }, dot_dung_thuoc : { dot_dung_thuoc }, chan_doan: { chan_doan }, luu_y: { luu_y}, loi_dan:{ loi_dan }, ten_bac_si:{ ten_bac_si }, ten_co_so_kham_chua_benh: { ten_co_so_kham_chua_benh } so_dien_thoai_co_so_kham_chua_benh: { so_dien_thoai_co_so_kham_chua_benh } ngay_gio_ke_don: { ngay_gio_ke_don } }||

# IX. API CẬP NHẬT SỐ LƯỢNG BÁN

## 1. Điều kiện và mục đích sử dụng

- Api sử dụng cho nhà thuốc cập nhật số lượng bán đã bán một đơn thuốc
lên hệ thông đơn thuốc trên đơn thuốc quốc gia.

- Yêu cầu: các đơn vị cung cấp phần mềm liên hệ với đơn vị hỗ trợ vận
hành để lấy app-name và app-key sử dụng cho API. App-name và app-key là những thông tin bảo mật tương ứng với từng đơn vị phần mềm. Khi cập nhật số lượng bán thuốc phải gửi kèm app-name và app-key.

**2. Mô tả** URL: <u>www.donthuocquocgia.vn</u>

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Link API|/api/v1/cap-nhat-don-thuoc||
|Request Header|Content Type: application/json app-name: {app-name} app-key: {app-key}||
|Method|POST||
|Tham số|{ “ma_don_thuoc” : “ma_don_thuoc”, “thong_tin_thuoc” : [{ “ma_thuoc_da_ke_don”: { ma_thuoc_da_ke_don }, “ma_thuoc” : { ma_thuoc }, “biet_duoc” : { biet_duoc }, “ten_thuoc” : { ten_thuoc }, “don_vi_tinh” : { don_vi_tinh },||

“so_luong” : { so_luong }, “cach_dung” : { cach_dung } }], "ma_dinh_danh_co_so_cung_ung_thuoc": { ma_dinh_danh_co_so_cung_ung_thuoc}, "ten_co_so_cung_ung_thuoc": { ten_co_so_cung_ung_thuoc}, "so_dien_thoai_co_so_cung_ung_thuoc": { so_dien_thoai_co_so_cung_ung_thuoc}, "dia_chi_co_so_cung_ung_thuoc": { dia_chi _co_so_cung_ung_thuoc }, “ma_hoa_don”: “ma_hoa_don” }

## 3. Mô tả dữ liệu đầu vào

|TT|Dữ liệu đầu vào|Tên trường dữ liệu|Kiểu dữ liệu|Kích thước|Bắt buộc|Ghi chú|
|---|---|---|---|---|---|---|
|1|Mã đơn ma_don_thuoc thuốc||Chuỗi kỹ tự|14 ký tự|x|Mã đơn thuốc|
|2|Thông tin thuốc|thong_tin_thuoc|Thôn g tin thuốc là một danh sách gồm một hoặc nhiều||x|Mỗi thuốc gồm có các thông tin: Mã thuốc được kê, Mã thuốc, Biệt dược Tên thuốc, Đơn vị tính, Số lượng, Số lượng bán),|

|thuốc.|Cách dùng được mô tả ở các hàng bến dưới tại bảng này.||||||
|---|---|---|---|---|---|---|
|3|Mã thuốc đã kê đơn|ma_thuoc_da_ke_ don|Chuỗi kỹ tự|20 ký tự|x|Mã thuốc đã kê theo đơn thuốc kéo về|
|4|Mã thuốc|ma_thuoc|Chuỗi kỹ tự|20 ký tự|x|Mã của thuốc được bán. Trường hợp bán thuốc thay thế có công dụng tương tự thì gửi lên mã thuốc thay thế.|
|5|Biệt dược|biet_duoc|Chuỗi ký tự|200 ký tự|x|Biệt dược( hoạt chất) chính của thuốc được bán. Đối với đơn thuốc y học cổ truyền là tên dược liệu, vị thuốc cổ truyền|
|6|Tên thuốc|ten_thuoc|Chuỗi kỹ tự|200 ký tự|x|Tên của thuốc được bán. Trường hợp bán thuốc thay thế có công dụng tương tự thì gửi lên tên thuốc thay thế.|

|7|Đơn vị tính|don_vi_tinh|Chuỗi ký tự|200 ký tự|x|Đơn vị tính của thuốc|
|---|---|---|---|---|---|---|
|8|Số lượng|so_luong|Số||x|Số lượng thuốc được kê|
|9|Số lượng bán|so_luong_ban|Số||x|Số lượng bán của thuốc.|
|10|Cách dùng|cach_dung|Chuỗi ký tự|200 ký tự|x|Cách dùng thuốc. Trường hợp bán thuốc thay thế có công dụng tượng tự thì gửi lên cách dùng thuốc thay thế.|
|11|Mã định danh cơ sở cung ứng thuốc|ma_dinh_danh_co_ so_cung_ung_thuoc|Chuỗi ký tự|200 ký tự|x|Mã định danh cơ sở cung ứng thuốc.|
|12|Tên cơ ten_co_so_cung_ung sở cung _thuoc ứng thuốc||Chuỗi ký tự|2000 ký tự|x|Tên cơ sở cung ứng thuốc|
|13|Số điện so_dien_thoai_co_so thoại cơ _cung_ung_thuoc sở cung ứng thuốc||Chuỗi số|12 số|x|Số điện thoại cơ sở cung ứng thuốc|
|14|Địa chỉ cơ sở cung|dia_chi_co_so_cung_ Chuỗi ung_thuoc|ký tự|2000 ký tự|x|Địa chỉ cơ sở cung ứng|

ứng thuốc thuốc 15 Mã hóa ma_hoa_don Chuỗi 20 ký x Mã hóa đơn đơn ký tự tự bán lẻ thuốc

## 4. Dữ liệu trả về khi lỗi

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status:|404||
|Header Status:|422||
|JsonData|{danh_sach_cac_loi}|Danh sách các lỗi|

## 5. Dữ liệu trả về trường hợp thành công

|Trường thông tin|Giá trị|Ghi chú|
|---|---|---|
|Header Status|200||
|Header Content-Type|application/json;charset=UTF-8||
|JsonData|{“Cập nhật đơn thuốc đã bán thành công”}||
