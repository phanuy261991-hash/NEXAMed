# Xử lý sự cố thường gặp — dành cho người không rành IT

Tài liệu này viết cho **nhân viên phòng khám** (lễ tân/bác sĩ/điều dưỡng/quản trị phòng khám) khi hệ thống có vấn đề trong lúc dùng hằng ngày — **không dùng lệnh Docker/PowerShell nào**. Nếu bạn là người cài đặt/kỹ thuật, xem `docs/Deploy.md` Phần 2 (đầy đủ lệnh kỹ thuật) thay vì tài liệu này.

Mỗi mục dưới đây theo đúng 1 khuôn: **Triệu chứng** → **Việc bạn tự làm được** → **Khi nào phải gọi kỹ thuật**.

---

## 1. Không đăng nhập được / hệ thống báo lỗi chung chung

**Triệu chứng**: màn hình đăng nhập báo "Sai tên đăng nhập hoặc mật khẩu", hoặc báo lỗi không rõ ràng, hoặc trang trắng không tải được gì.

**Việc bạn tự làm được**:
- Kiểm tra lại đúng tên đăng nhập/mật khẩu (chú ý hoa/thường, phím Caps Lock).
- Thử tải lại trang (F5) một lần.
- Kiểm tra máy tính/màn hình có đang kết nối mạng LAN của phòng khám không (biểu tượng mạng ở góc màn hình Windows).
- Nếu máy chủ (PC/NAS chạy hệ thống) mới khởi động lại (mất điện, restart Windows...): đợi khoảng 2-3 phút cho hệ thống khởi động xong rồi thử lại.

**Không tự làm**: bấm đăng nhập liên tục nhiều lần — hệ thống tự khoá tài khoản tạm thời sau 5 lần sai liên tiếp (15 phút mới mở lại được). Nếu sai mật khẩu, dừng lại và nhờ Quản trị phòng khám đặt lại mật khẩu ("Danh mục quản lý tài khoản").

**Khi nào gọi kỹ thuật**: đã thử các bước trên vẫn không vào được, hoặc trang báo lỗi có chữ tiếng Anh lạ (ví dụ nhắc tới "500", "502", "ERR_CONNECTION..."). Khi gọi, **ghi lại trước**: đang làm gì thì gặp lỗi, lỗi hiện đúng chữ gì (chụp ảnh màn hình nếu được), mấy giờ xảy ra.

---

## 2. "Sao lưu dữ liệu có đang chạy đúng không?"

Hệ thống tự sao lưu dữ liệu mỗi đêm. Nếu 3 lần sao lưu liên tiếp thất bại (hoặc quá 30 giờ chưa có lần nào thành công), một **banner màu đỏ** sẽ tự hiện ở đầu trang cho tài khoản **Quản trị phòng khám** (chỉ vai trò này thấy được).

**Triệu chứng**: thấy banner đỏ cảnh báo "sao lưu thất bại"/"chưa có lần sao lưu thành công gần đây".

**Việc bạn tự làm được**: không có thao tác tự sửa nào ở đây — đây là vấn đề hạ tầng (ổ đĩa, máy chủ), không phải lỗi thao tác của nhân viên.

**Khi nào gọi kỹ thuật**: ngay khi thấy banner đỏ. Đừng đợi — sao lưu hỏng nhiều ngày liên tiếp có nghĩa là nếu máy hỏng đột ngột, dữ liệu gần đây có thể mất. Không thấy banner đỏ = sao lưu vẫn đang chạy bình thường, không cần làm gì.

---

## 3. Sau khi hệ thống được cập nhật lên bản mới, đăng nhập báo lỗi lạ

**Triệu chứng**: hôm trước vẫn dùng bình thường, sau khi kỹ thuật cập nhật phần mềm thì đăng nhập báo lỗi chung chung (không phải "sai mật khẩu"), dù gõ đúng thông tin.

**Việc bạn tự làm được**: thử trên một máy tính khác trong phòng khám (nếu có) để xác định lỗi ở TOÀN BỘ phòng khám hay chỉ một máy.

**Khi nào gọi kỹ thuật**: luôn luôn — đây là lỗi cấu hình xảy ra ngay sau khi cập nhật, cần kỹ thuật kiểm tra file cấu hình trên máy chủ. Khi báo, nói rõ: "vừa cập nhật xong thì bị lỗi đăng nhập ở TOÀN BỘ máy trong phòng khám" (khác với lỗi chỉ 1 người/1 máy).

---

## 4. Máy tính/trình duyệt bị treo hoặc mất mạng giữa lúc đang nhập hồ sơ khám

**Triệu chứng**: đang gõ ghi chú khám/chọn chẩn đoán thì mất mạng hoặc trình duyệt bị treo.

**Đây là trường hợp hệ thống đã có sẵn lưới an toàn**: nếu **mất mạng** (Wi-Fi/dây mạng rớt) trong lúc đang gõ, hệ thống tự lưu tạm nội dung ngay trên máy đang dùng (banner màu vàng "Mất mạng — đã lưu tạm..." sẽ hiện ra) và **tự động đồng bộ lại lên hệ thống chính** khi có mạng trở lại — kể cả nếu bạn đóng luôn trình duyệt lúc đó, mở lại đúng ca khám đó sau sẽ thấy nội dung được khôi phục.

**Lưu ý quan trọng — ranh giới của lưới an toàn này**:
- Chỉ bảo vệ khi **mất mạng** (rớt Wi-Fi/LAN). **Không** bảo vệ khi **mất điện đột ngột** hoặc **tắt máy tính hẳn** trước khi nội dung kịp lưu tạm — trường hợp này có thể mất phần đang gõ dở (thường chỉ vài giây-vài phút gần nhất, vì hệ thống tự lưu định kỳ).
- Chỉ áp dụng cho màn hình khám (Ghi chú khám + Chẩn đoán). Các màn hình khác (Tiếp nhận, Thu ngân...) chưa có cơ chế này — mất mạng giữa chừng ở các màn hình đó có thể cần nhập lại.

**Việc bạn tự làm được**: nếu thấy banner vàng "Mất mạng — đã lưu tạm", cứ tiếp tục làm việc bình thường hoặc chờ mạng có lại — không cần thao tác gì thêm, hệ thống tự đồng bộ.

**Khi nào gọi kỹ thuật**: nếu mở lại ca khám mà nội dung bị mất hẳn (không phải chỉ vài giây cuối) — đây có thể là dấu hiệu bất thường cần kiểm tra.

---

## 5. Không chắc bản sao lưu có phục hồi được không / nghi ngờ mất dữ liệu

**Triệu chứng**: nghi ngờ dữ liệu bị sai/thiếu (ví dụ sau sự cố máy chủ), muốn biết có khôi phục lại được từ bản sao lưu không.

**Việc bạn tự làm được**: **không tự ý thử phục hồi** trên máy đang chạy thật — thao tác phục hồi sai cách có thể ghi đè mất dữ liệu hiện tại. Đây hoàn toàn là việc của kỹ thuật (xem `docs/Deploy.md` mục 2.3c, chỉ dành cho người cài đặt).

**Khi nào gọi kỹ thuật**: ngay khi nghi ngờ. Mô tả rõ: dữ liệu nào bị sai/thiếu, phát hiện lúc nào, có ai vừa thao tác gì bất thường trước đó không.

---

## Bảng tổng hợp: tự làm được vs. phải gọi kỹ thuật

| Tình huống | Tự làm được | Phải gọi kỹ thuật |
|---|---|---|
| Quên mật khẩu | Nhờ Quản trị phòng khám đặt lại (không cần kỹ thuật ngoài) | |
| Sai mật khẩu vài lần, bị khoá tạm | Đợi 15 phút hoặc nhờ Quản trị đặt lại | |
| Không thấy menu mình cần | Nhờ Quản trị phòng khám cấp thêm quyền | |
| Cần xem gấp hồ sơ ngoài quyền (cấp cứu) | Dùng "Phá kính" (break-glass) ngay trên màn hình, có ghi vết | |
| Trang trắng/không tải được sau khi thử F5 + đợi vài phút | | ✓ |
| Banner đỏ cảnh báo sao lưu thất bại | | ✓ (ngay lập tức) |
| Lỗi đăng nhập lạ xảy ra ngay sau khi cập nhật phần mềm | | ✓ |
| Mất mạng giữa lúc khám (có banner vàng) | Không cần làm gì, hệ thống tự lưu/đồng bộ | |
| Mất điện/tắt máy đột ngột giữa lúc đang nhập | Kiểm tra lại nội dung khi mở lại | ✓ nếu mất nhiều hơn vài phút gõ gần nhất |
| Nghi ngờ mất/sai dữ liệu | Không tự thử phục hồi | ✓ (ngay lập tức, không trì hoãn) |
| Cài đặt/cập nhật/phục hồi từ bản sao lưu | Không tự làm | ✓ (luôn là việc của kỹ thuật) |

Xem thêm: `docs/pilot-onboarding.md` mục 4 (câu hỏi thường gặp về cách dùng hệ thống, không phải sự cố kỹ thuật).
