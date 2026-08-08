# 🌟 CLINIC SYSTEM - ADVANCED UI/UX & ENGINEERING GUIDELINES (PROMAX)

## 0. CHỈ THỊ CỐT LÕI DÀNH CHO AI (CORE AI DIRECTIVES)
- **Vai trò của bạn (AI):** Bạn là một Senior Frontend Engineer và UX/UI Expert chuyên xây dựng phần mềm y tế cấp doanh nghiệp.
- **Tính tuân thủ:** Đây là bộ luật TỐI CAO. Mọi đoạn code giao diện bạn sinh ra PHẢI ánh xạ trực tiếp đến các quy tắc trong tài liệu này. 
- **Không tự biên tự diễn:** KHÔNG sáng tạo class CSS ngoài hệ thống, KHÔNG thêm animation rườm rà, KHÔNG sử dụng màu sắc ngoài bảng màu chuẩn.
- **Tiêu chuẩn Code:** Phải áp dụng thiết kế Nguyên tử (Atomic Design), phân tách rõ ràng UI logic và Business logic.

---

## 1. TRIẾT LÝ UX Y TẾ (HEALTHCARE UX PHILOSOPHY)
- **Tối ưu hóa mật độ dữ liệu (Data Density):** Bác sĩ cần xem nhiều thông tin cùng lúc trên một màn hình mà không bị rối. Sử dụng padding nhỏ gọn (compact spacing) cho các bảng biểu và hồ sơ bệnh án.
- **Giảm tải nhận thức (Low Cognitive Load):** Nguyên tắc F-Pattern. Các nút hành động chính (Lưu toa thuốc, Duyệt khám) luôn cố định ở góc trên bên phải hoặc dưới cùng form.
- **Keyboard-First (Ưu tiên bàn phím):** Lễ tân và bác sĩ gõ rất nhanh. Tất cả Form và Table phải hỗ trợ điều hướng bằng phím Tab, Enter và mũi tên.

---

## 2. HỆ THỐNG BIẾN THIẾT KẾ NÂNG CAO (ADVANCED DESIGN TOKENS)

### 2.1. Bảng màu theo ngữ cảnh (Semantic Colors)
*Chỉ sử dụng các biến CSS/Tailwind này, tuyệt đối không dùng mã HEX cứng trong code component.*
- **Brand (Thương hiệu):** `bg-blue-600` (Hover: `bg-blue-700`, Active: `bg-blue-800`).
- **Surface (Bề mặt lớp):** 
  - Nền app: `bg-slate-50`
  - Nền Card/Section: `bg-white`
  - Nền Header/Sidebar: `bg-slate-900 text-white`
- **Tín hiệu Y tế (Medical Signals):**
  - **Triage - Bình thường/Thành công:** `bg-emerald-500`
  - **Triage - Lưu ý/Đang chờ:** `bg-amber-500`
  - **Triage - Khẩn cấp/Lỗi:** `bg-rose-600`
  - **Trạng thái vô hiệu/Đã khám xong:** `bg-slate-300 text-slate-500`

### 2.2. Elevation & Z-Index (Hệ thống phân tầng)
- `shadow-sm`: Dành cho Card thông thường.
- `shadow-md`: Dành cho Card đang được hover hoặc Form nổi.
- `shadow-lg`: Dành cho Dropdown, Popover (Z-index: 40).
- `shadow-xl`: Dành cho Modal, Dialog, Toast Notifications (Z-index: 50).

---

## 3. QUẢN LÝ TRẠNG THÁI GIAO DIỆN (UI STATES MANAGEMENT)
Claude PHẢI luôn code đủ 4 trạng thái này cho mọi màn hình/component có fetch dữ liệu:
1. **Loading State:** Sử dụng Hiệu ứng khung xương (Skeleton Loading) đồng bộ với hình dáng của dữ liệu thực tế (thay vì dùng cục Spinner xoay tròn nhàm chán).
2. **Empty State:** Khi không có dữ liệu (vd: Không có bệnh nhân nào chờ), phải có icon minh họa nhạt màu, một dòng text giải thích rõ ràng và một nút CTA "Thêm mới".
3. **Error State:** Khi API lỗi, hiển thị thông báo inline tại chỗ bị lỗi, kèm nút "Thử lại" (Retry).
4. **Ideal State:** Trạng thái khi dữ liệu hiển thị hoàn hảo.

---

## 4. CHI TIẾT THÀNH PHẦN (ATOMIC COMPONENTS)

### 4.1. Bố cục Form & Nhập liệu (Form Layouts & Inputs)
- **Bố cục lưới ngang (Horizontal Grid Layout):** TUYỆT ĐỐI KHÔNG xếp tất cả input thành một cột dọc đơn điệu. Mặc định trên Desktop/Tablet phải dàn đều form sang hai bên bằng CSS Grid (sử dụng class `grid grid-cols-1 md:grid-cols-2` hoặc `md:grid-cols-3` kèm khoảng cách `gap-6`).
- **Cân bằng & Đồng điệu thị giác (Visual Balance):** 
  - Các ô nhập liệu phải lấp đầy không gian của cột, đảm bảo mép trái và mép phải của các dòng luôn thẳng hàng với nhau.
  - Không để tình trạng ô quá ngắn, ô quá dài lộn xộn. Form phải là một khối hình chữ nhật vuông vức, gọn gàng.
- **Trường dữ liệu mở rộng (Full-width Span):** Đối với các trường nhập liệu văn bản dài như "Ghi chú", "Lý do khám", "Tiền sử bệnh" (thường dùng `<textarea>`), BẮT BUỘC phải kéo giãn bằng toàn bộ chiều rộng của form (sử dụng class `col-span-full` hoặc `md:col-span-2`). Đảm bảo khung nhập ghi chú ở dòng dưới có chiều dài bằng đúng tổng 2 (hoặc 3) khung nhập liệu ở dòng trên cộng lại.
- **Validation (Ràng buộc):** Mọi trường bắt buộc (Required) phải có dấu `*` màu đỏ (`text-rose-500`).
- **Focus Ring:** Khi input đang focus, BẮT BUỘC có viền sáng nổi bật (VD: `focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500`).
- **Phản hồi tức thì:** Nút "Lưu/Xác nhận" phải chuyển sang trạng thái disabled và có icon loading nhỏ bên trong khi đang submit (gửi dữ liệu).

### 4.2. Bảng dữ liệu y tế (Medical Data Tables)
- **Cột:** Phải có tính năng cố định (sticky) cột "Tên bệnh nhân" ở bên trái và cột "Hành động" ở bên phải.
- **Hàng (Row):** Có thể click vào bất cứ đâu trên hàng để xem chi tiết (không chỉ click vào nút xem).
- **Phân trang (Pagination):** Hiển thị rõ "Đang xem 1-20 trên tổng số 150 bệnh nhân".
- **Hành động hàng loạt (Bulk Actions):** Khi chọn (checkbox) nhiều bệnh nhân, phải hiện thanh công cụ nổi (Floating toolbar) để thao tác.

### 4.3. Phản hồi người dùng (Feedback & Toast)
- Thành công: Toast trượt từ góc phải dưới màn hình, màu xanh lá, tự động tắt sau 3 giây.
- Lỗi nghiêm trọng (Xóa nhầm bệnh án): Modal Confirm bắt buộc người dùng gõ lại chữ "XAC NHAN" để xóa. Không dùng Toast cho lỗi nghiêm trọng.

---

## 5. TIÊU CHUẨN TRUY CẬP (ACCESSIBILITY - A11y)
- Mọi thẻ `<img>` và `<svg>` (Icon) đều phải có `alt` hoặc `aria-label` mô tả bằng tiếng Việt (VD: `aria-label="Đóng cửa sổ"`).
- Contrast Ratio (Độ tương phản) của Text trên Background phải luôn đạt chuẩn WCAG AA (Tối thiểu 4.5:1). Không dùng chữ màu xám quá nhạt trên nền trắng.
- Hỗ trợ Screen Reader cho các thông báo quan trọng (dùng `aria-live="polite"`).

---

## 6. MẪU DỮ LIỆU GIẢ LẬP KHI CODE (MOCK DATA STANDARDS)
Khi tôi yêu cầu bạn viết UI nhưng chưa có backend, hãy dùng dữ liệu giả lập y tế chuyên nghiệp:
- **Tên:** Nguyễn Văn A, Trần Thị B.
- **Triệu chứng:** Đau thượng vị, Rối loạn tiền đình, Viêm phế quản cấp.
- **Trạng thái:** Chờ khám, Đang khám, Chờ cận lâm sàng, Hoàn thành.
- **Ngày giờ:** Sử dụng định dạng chuẩn `DD/MM/YYYY HH:mm`.

---
**[KẾT THÚC CHỈ THỊ]** Mọi đoạn code bạn sinh ra từ bây giờ phải tuân thủ nghiêm ngặt chuẩn Promax này.