# NEXA UI Design Guideline

Version: 1.0
## 1. Visual Theme & Atmosphere

NEXA Med là phần mềm quản lý phòng khám — công cụ vận hành hàng ngày cho lễ tân, y tá, bác sĩ, không phải trang marketing. Người dùng thao tác giữa các ca khám, cần quét thông tin nhanh (lịch hẹn, hồ sơ bệnh nhân, đơn thuốc) và không được phép mắc lỗi thao tác. Thẩm mỹ phải toát ra sự chính xác lâm sàng (clinical precision) và điềm tĩnh, không phải sự phô diễn sáng tạo.

- **Density:** 7/10 — "Cockpit Dense" ở các màn hình dữ liệu (danh sách bệnh nhân, lịch khám, bảng thanh toán), hạ xuống "Daily App Balanced" ở các form nhập liệu và hồ sơ chi tiết để tránh quá tải khi bác sĩ cần đọc kỹ.
- **Variance:** 4/10 — "Offset Asymmetric" nhẹ. Bố cục có trật tự rõ ràng vì đây là công cụ an toàn người bệnh, nhưng tránh đối xứng máy móc kiểu template admin generic.
- **Motion:** 3/10 — "Static Restrained" thiên về tinh tế. Nhân viên y tế cần tốc độ, không cần trình diễn; mọi chuyển động phải có lý do chức năng (xác nhận trạng thái, chuyển màn hình), không trang trí.

## 2. Color Palette & Roles

Tránh mô-típ "y tế = xanh dương nhạt nhẽo". Dùng teal đậm làm accent — liên tưởng đến màu áo phẫu thuật (scrubs) mà không sáo rỗng như blue-cross icon.

- **Canvas Mist** (#F6F7F6) — nền chính, ngả xám-lục rất nhẹ, gợi cảm giác vô trùng nhưng không lạnh
- **Pure Surface** (#FFFFFF) — nền card, bảng, modal
- **Charcoal Ink** (#1C1F1E) — văn bản chính (không dùng #000000 thuần)
- **Muted Slate** (#6B7270) — văn bản phụ, label, metadata
- **Whisper Border** (rgba(28,31,30,0.08)) — đường viền, chia bảng
- **Clinical Teal** (#0E7C66) — accent duy nhất: nút chính, trạng thái active, liên kết, focus ring

**Semantic status tokens** (không tính là accent thứ hai — đây là tín hiệu an toàn bắt buộc, không phải trang trí):
- **Amber Caution** (#B45309) — lịch chờ xác nhận, sắp hết hạn đơn thuốc
- **Rose Alert** (#B91C1C) — dị ứng, hủy khám gấp, quá hạn thanh toán
- **Sage Confirmed** (#15803D) — đã xác nhận, đã hoàn tất, đã thanh toán

Giữ nguyên một bảng màu xuyên suốt toàn app — không đổi sắc xám ấm/lạnh giữa các màn hình.

## 3. Typography Rules

- **Display:** Geist — track-tight, phân cấp bằng độ đậm và màu, không dùng cỡ chữ quá lớn ở dashboard nội bộ
- **Body:** Geist — leading thoải mái, tối đa 65 ký tự/dòng ở phần ghi chú lâm sàng, mô tả bệnh án
- **Mono:** Geist Mono — bắt buộc cho mọi con số: mã bệnh nhân, giờ hẹn, liều lượng thuốc, số tiền, ngày sinh. Ở các bảng mật độ cao (danh sách bệnh nhân, lịch khám) toàn bộ số liệu dùng mono để dễ đối chiếu theo cột
- **Cấm:** Inter, serif thông thường (Times New Roman, Georgia, Garamond) — đây là phần mềm vận hành, serif không có chỗ đứng

## 4. Component Stylings

- **Buttons:** phẳng, bo góc nhẹ (6–8px), phản hồi active rõ (scale 0.98 khi nhấn), không glow/neon. Nút chính dùng Clinical Teal, nút nguy hiểm (hủy lịch, xóa hồ sơ) dùng Rose Alert với xác nhận phụ (confirm dialog), không tự thực thi ngay
- **Cards:** chỉ dùng khi cần phân tách khối chức năng (hồ sơ bệnh nhân, thẻ tóm tắt ca khám); shadow rất nhẹ (0 1px 2px rgba(28,31,30,0.06)), không đổ bóng màu
- **Bảng dữ liệu (ưu tiên hơn card ở màn hình mật độ cao):** dùng border-top divider giữa các hàng thay vì card riêng lẻ cho từng bệnh nhân/lịch hẹn; hàng có thể expand để xem chi tiết thay vì chuyển trang
- **Badge trạng thái:** pill nhỏ, nền nhạt 10% của màu semantic + chữ đậm màu semantic (ví dụ: nền Amber 10%, chữ Amber 700) — không dùng nền đặc màu chói
- **Inputs/form:** label phía trên input, helper text tùy chọn, lỗi hiển thị dưới input bằng Rose Alert kèm icon nhỏ. Trường bắt buộc trong hồ sơ y tế (dị ứng, nhóm máu) có viền nhấn nhẹ để không bị bỏ sót
- **Lịch khám (calendar/schedule view):** dạng timeline theo giờ, mỗi khung giờ có border-top mảnh; slot trống hiển thị dashed border mời tạo lịch mới
- **Loading:** skeleton loader đúng kích thước layout thật (hàng bảng, khung card) — không dùng spinner chung chung
- **Empty state:** hướng dẫn cụ thể bước tiếp theo (ví dụ: "Chưa có lịch hẹn hôm nay — tạo lịch mới" kèm nút hành động), không chỉ là hình minh họa trống
- **Error state:** báo lỗi inline ngay tại vị trí phát sinh, không dùng toast chung chung cho lỗi liên quan dữ liệu bệnh nhân

## 5. Layout Principles

- Sidebar điều hướng cố định bên trái (không collapse ẩn hoàn toàn — nhân viên cần truy cập nhanh giữa các module: Lịch khám, Bệnh nhân, Đơn thuốc, Thanh toán)
- Vùng nội dung chính dùng CSS Grid, max-width container 1400px cho màn hình dashboard, không kéo giãn hết màn hình rộng
- Không xếp "3 card ngang bằng nhau" theo kiểu template — dùng bố cục lệch: khối chính (lịch hôm nay) chiếm 2/3, khối phụ (thông báo, việc cần làm) chiếm 1/3
- Không phần tử chồng lấn tuyệt đối; mọi modal/dialog phải có overlay rõ ràng
- Dùng `min-h-[100dvh]` cho layout toàn màn hình, tránh `h-screen` gây lỗi trên mobile browser

## 6. Motion & Interaction

- Spring nhẹ: `stiffness: 120, damping: 22` cho chuyển tab, mở panel chi tiết — không easing tuyến tính cứng
- Chuyển trạng thái badge (ví dụ: từ "Chờ xác nhận" sang "Đã xác nhận") có transition màu 150ms, không hiệu ứng phô trương
- Danh sách bệnh nhân/lịch hẹn khi tải: stagger nhẹ 20–30ms mỗi hàng, không mount tức thì gây giật
- Chỉ animate `transform` và `opacity`; không animate width/height gây reflow
- Tuyệt đối không dùng animation ăn mừng (confetti, bounce) — đây là ngữ cảnh y tế, không phải sản phẩm tiêu dùng

## 7. Anti-Patterns (Banned)

- Không emoji trong giao diện chức năng
- Không Inter, không serif thông thường
- Không #000000 thuần
- Không neon glow, không gradient chói trên tiêu đề lớn
- Không custom cursor
- Không phần tử chồng lấn
- Không bố cục 3 card ngang bằng nhau
- Không tên giả sáo rỗng ("John Doe", "Nguyễn Văn A" lặp lại toàn app) — dùng tên đa dạng, thực tế
- Không số liệu/thống kê bịa đặt ("98% hài lòng", "10,000+ bệnh nhân") nếu không có dữ liệu thật
- Không lạm dụng màu đỏ cho mục đích trang trí — đỏ chỉ dành cho cảnh báo an toàn thật sự (dị ứng, khẩn cấp)
- Không copywriting sáo rỗng ("Nâng tầm", "Đột phá", "Chuyển đổi số toàn diện")
- Không dùng ảnh Unsplash link chết; dùng picsum.photos hoặc avatar SVG có initials


