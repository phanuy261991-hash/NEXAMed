# Câu hỏi gửi đơn vị vận hành hệ thống đơn thuốc quốc gia

Soạn 20/10/2026 để chủ dự án gửi đi. Người đọc là đơn vị vận hành `donthuocquocgia.vn` (không biết nội bộ NEXAMed). Mỗi câu nêu rõ lý do và điều phần mềm sẽ làm tuỳ theo câu trả lời, để trả lời ngắn cũng đủ.

---

**Kính gửi đơn vị vận hành hệ thống đơn thuốc quốc gia,**

Chúng tôi là đơn vị phát triển phần mềm quản lý phòng khám NEXAMed, đang chuẩn bị kết nối kê đơn điện tử theo Quyết định 808/QĐ-BYT (các API: đăng nhập cơ sở, thêm/xoá bác sĩ, đăng nhập bác sĩ, gửi đơn thuốc, lấy đơn và cập nhật số lượng bán của nhà thuốc). Tài liệu kỹ thuật chúng tôi có còn một số điểm chưa rõ hoặc không nhất quán. Mong quý đơn vị giải đáp để chúng tôi lập trình đúng ngay từ đầu.

## A. Môi trường và tài khoản

1. **Môi trường thử (sandbox):** có không? Nếu có, xin địa chỉ máy chủ thử và cách xin tài khoản thử (mã liên thông cơ sở, mã liên thông bác sĩ, mật khẩu). Nếu không có, chúng tôi chỉ thử được trên môi trường thật và cần biết cách xoá/vô hiệu đơn thử.
2. **Đăng ký mã liên thông:** cơ sở khám chữa bệnh và bác sĩ đăng ký mã liên thông ở đâu, cần giấy tờ gì? Một bác sĩ làm ở hai chi nhánh có hai mã cơ sở khác nhau thì dùng một mã liên thông bác sĩ hay phải đăng ký riêng cho từng cơ sở?
3. **Phần mềm của chúng tôi cần đăng ký với đơn vị vận hành không** (cấp `app-name`, `app-key` cho nhà cung cấp phần mềm)? Điều kiện và thời gian cấp? Khoá này chỉ dành cho API nhà thuốc (mục VIII, IX) hay cả phần gửi đơn?
4. **Địa chỉ API của nhà thuốc** (mục VIII, IX) ghi `www.donthuocquocgia.vn`, trong khi các API khác là `api.donthuocquocgia.vn`. Địa chỉ đúng là địa chỉ nào?

5. **Giao diện dùng chung:** ngoài API, cổng có cung cấp trang web hoặc ứng dụng dùng chung (kê đơn, tra cứu đơn đã gửi) cho cơ sở khám chữa bệnh chưa có phần mềm không? Cơ sở dùng phần mềm của chúng tôi có phải đăng ký riêng để kết nối API không, hay chỉ cần mã liên thông của cơ sở và bác sĩ?

## B. Token và đăng nhập

6. **Token** hiệu lực 7 ngày. Cổng có trả thời điểm hết hạn không (hiện tài liệu chỉ trả `token` và `token_type`)? Chúng tôi dự định tự tính hạn theo giờ đăng nhập cộng 7 ngày và đăng nhập lại khi còn dưới 1 ngày hoặc khi cổng trả lỗi chưa xác thực. Cách này có phù hợp không? Có giới hạn số lần đăng nhập trong một khoảng thời gian không?
7. Tài liệu API đăng nhập bác sĩ ghi trường trả về là `tocken_type` (sai chính tả) ở mục VI nhưng `token_type` ở mục III. Tên trường thực tế là gì?

## C. Mã đơn thuốc

8. **Chữ hoa hay chữ thường:** phần cấu trúc ghi hậu tố `-c`, `-n`, `-h`, `-y` (chữ thường), phần định dạng ghi `C, N, H, Y` (chữ hoa). Mã đơn gửi lên phải viết hoa hay thường (ví dụ `790010000043-C` hay `790010000043-c`)? Nếu nhà thuốc nhập mã bằng chữ khác thì cổng có tra cứu được không? Trường `loai_don_thuoc` có phải luôn viết thường (`c`, `n`, `h`, `y`)?
9. **7 ký tự giữa:** chúng tôi dùng dãy số thập phân `0000001`… Điều này có chấp nhận được không (tài liệu cho phép `0-9` hoặc `a-z`)? Mã có phân biệt giữa các cơ sở khác nhau không, hay mã phải duy nhất toàn quốc kể cả khi 5 ký tự đầu khác nhau?
10. **5 ký tự đầu** là "mã bảo hiểm của cơ sở khám chữa bệnh". Mỗi chi nhánh có mã riêng đúng 5 chữ số, và có chi nhánh dùng chung mã của công ty. Cổng có kiểm mã này khớp với mã liên thông của cơ sở đăng nhập không?

## D. Đơn đã gửi và đính chính

11. **Sửa hoặc huỷ đơn đã gửi:** tài liệu không có API sửa hay huỷ. Khi bác sĩ phải đính chính đơn đã gửi (sai thuốc, sai liều), chúng tôi nên làm thế nào: gửi lại `gui-don-thuoc` với cùng mã đơn để ghi đè, gửi đơn mới với mã mới, hay có cách khác? Nếu gửi lại trùng mã thì cổng trả lỗi gì?
12. Cổng có trả mã hoặc dấu hiệu "đã nhận" sau khi gửi thành công ngoài thông báo `Gửi đơn thuốc thành công` không? Nếu gửi trùng cùng một đơn hai lần (do mạng chập chờn, chúng tôi tự thử lại) thì xử lý thế nào, có nguy cơ tạo đơn trùng không?

## E. Nội dung gói gửi đơn

13. **Chữ ký số:** tài liệu có trường `signature` (chữ ký số) nhưng không đánh dấu bắt buộc. Phần mềm của chúng tôi hiện dùng chữ ký điện tử trong hệ thống (chưa ký số bằng chứng thư số). Cổng có **chấp nhận đơn không có `signature`** không? Nếu bắt buộc, định dạng chữ ký là gì (chuẩn nào, ký trên dữ liệu nào) và có cần chứng thư số của từng bác sĩ không?
14. **Người giám hộ:** tài liệu ghi bắt buộc với "trẻ em hơn 72 tháng tuổi". Chúng tôi hiểu đây là "**dưới** 72 tháng tuổi" (trẻ dưới 6 tuổi). Xin xác nhận. Trường `thong_tin_nguoi_giam_ho` có định dạng cụ thể không (một chuỗi gộp "Họ tên, Số điện thoại, Địa chỉ" hay đối tượng gồm ba trường)?
15. **Tên trường chẩn đoán:** ví dụ mẫu dùng `ma_chan_doan`, `ten_chan_doan`, `ket_luan`, nhưng bảng mô tả ghi `ma_benh`, `ten_benh`, `ket_luan`. Tên nào đúng? Có bắt buộc kèm mã ICD-10 không, và chấp nhận mã có dấu chấm (ví dụ `J20.9`) không?
16. **Hình thức điều trị** (`hinh_thuc_dieu_tri`, bắt buộc với đơn loại `c`): xin file **danh mục giá trị** do Bộ Y tế ban hành (mã số và tên). Nếu bác sĩ không chọn được (ví dụ khám ngoại trú thông thường) thì dùng giá trị nào?
17. **Đợt dùng thuốc** (`dot_dung_thuoc`): định dạng chính xác của danh sách (tên các trường, ví dụ `dot`, `tu_ngay`, `den_ngay`, `so_thang_thuoc`). Với đơn loại `y`, "số thang thuốc" nằm trong từng đợt hay ở mức đơn?
18. **Mã thuốc quốc gia** (`ma_thuoc`, 20 ký tự, bắt buộc): danh mục lấy ở đâu (file tải về hay API tra cứu)? Thuốc không có trong danh mục, vị thuốc cổ truyền và thuốc kê ngoài danh mục thì gửi `ma_thuoc` thế nào? Cổng có nhận mã để trống hoặc mã tự đặt không?
19. **Trường không bắt buộc:** `ma_dinh_danh_y_te` (10 ký tự) và `ma_so_the_bao_hiem_y_te` (10 ký tự). Nếu để trống thì cổng chấp nhận không? **ĐÃ CHỐT 21/10/2026 (chủ dự án): số thẻ BHYT mới theo quy định mới nhất là 12 chữ số, trùng số CCCD — phần mềm gửi 12 số, KHÔNG cần hỏi; chỉ xác nhận lại khi kiểm với cổng thật.** Bối cảnh: hiện có hai loại số thẻ BHYT cùng tồn tại: thẻ mới 12 chữ số và thẻ cũ 15 ký tự gồm chữ và số; tài liệu cổng ghi 10 ký tự. Cổng chấp nhận độ dài nào cho `ma_so_the_bao_hiem_y_te`? Phần mềm hiện CHỈ gửi thẻ mới 12 chữ số và bỏ trường này với thẻ cũ 15 ký tự (không tự cắt/đoán) — cách làm đó có được không, hay cổng yêu cầu định dạng khác (S2-04, `docs/DECISIONS.md` #243 mục 8)?
20. **Ngày tái khám** (`ngay_tai_kham`, kiểu "số ngày kể từ ngày kê đơn"): nếu bác sĩ không hẹn tái khám thì để `0`, để trống hay không gửi trường này?
21. **Giới hạn độ dài** ghi 500 ký tự cho `cach_dung`, `ho_ten_benh_nhan`, `dia_chi` ở mục VII nhưng 200 ký tự ở mục IX. Phần mềm sẽ cắt chuỗi quá dài khi gửi; cần biết giới hạn đúng để cắt đúng.
22. **Lời dặn của đơn loại y:** tài liệu yêu cầu mô tả cách sắc thuốc, cách uống trong `loi_dan`. Có định dạng riêng hay chỉ là văn bản tự do?

## F. Vận hành

23. **Thời gian chờ và giới hạn tần suất:** cổng có giới hạn số yêu cầu mỗi phút cho một cơ sở/bác sĩ không? Thời gian chờ phản hồi bình thường là bao lâu để chúng tôi đặt ngưỡng báo lỗi mạng?
24. **Lỗi trả về:** `danh_sach_cac_loi` là mảng chuỗi hay mảng đối tượng (có mã lỗi, tên trường)? Xin vài ví dụ thực tế để chúng tôi hiển thị đúng cho bác sĩ.
25. **Gửi đơn muộn:** nếu không có mạng, đơn được xếp hàng và gửi sau vài giờ hoặc vài ngày. Cổng có giới hạn gửi muộn (ví dụ đơn quá 24 giờ bị từ chối) không? `ngay_gio_ke_don` có được là thời điểm trong quá khứ?
26. **Bác sĩ nghỉ việc hoặc chuyển cơ sở:** nên gọi "xoá bác sĩ khỏi cơ sở" ngay, và đơn đã gửi trước đó có bị ảnh hưởng không?

---

Rất mong sớm nhận được phản hồi. Nếu có tài liệu cập nhật hoặc ví dụ gói dữ liệu thật, xin gửi kèm.

Trân trọng.
