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
- **Brand (Thương hiệu):** `bg-blue-600` (Hover: `bg-blue-700`, Active: `bg-blue-800`) — dùng cho điều hướng/hành động chính (nút Lưu, sidebar active, link).
- **Brand phụ — Lựa chọn (Selection accent, chốt 2026-08-14):** `bg-brand-teal` (`#099078`, Active/pressed: `bg-brand-teal-active`) — token định nghĩa ở `apps/web/src/app/index.css` (`@theme`), KHÔNG viết hex trực tiếp trong component. Dùng cho trạng thái ĐÃ CHỌN của thành phần lựa chọn 1-trong-nhiều dạng thẻ/chip (ví dụ "Nguồn đặt lịch", chọn Bác sĩ ở `AppointmentQuickCreatePanel.tsx`) — tách khỏi `blue-600` để tránh lạm dụng một màu xanh cho mọi trạng thái "đang chọn" trên cùng một form. **Không dùng cho điều hướng/nút hành động chính** — phạm vi đó vẫn là `blue-600`.
  - **Hover (chưa chọn) kết hợp cả 2 màu thương hiệu**: viền `hover:border-blue-400` (màu chủ đạo, báo hiệu "bấm được") + nền `hover:bg-brand-teal-tint` (báo trước sắc thái sẽ có khi chọn) — không dùng thuần viền/nền teal cho hover (dễ lẫn với trạng thái đã chọn). Mẫu chuẩn cho thẻ/chip lựa chọn: unselected mặc định `border-slate-300`, hover `border-blue-400 bg-brand-teal-tint`, selected `border-brand-teal bg-brand-teal text-white`.
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
- **KHÔNG thêm `shadow-*` cho thành phần đã phân biệt rõ bằng màu nền đặc** (chốt 2026-08-14) — chủ dự án phản hồi thẻ/chip đã tô nền đặc (ví dụ trạng thái "đã chọn" ở mục 4.1c) mà còn thêm bóng đổ nhìn "rất AI tạo", không nét/không ổn. Quy tắc: đổ bóng chỉ dùng để phân TẦNG không gian (panel nổi trên nền, dropdown nổi trên trang, modal nổi trên overlay) — không dùng như hiệu ứng trang trí thêm cho chi tiết đã tự nổi bật bằng màu sắc/viền. Trước khi thêm `shadow-*` vào một trạng thái mới (hover/active/selected), tự hỏi: phần tử này có thực sự "nổi lên" khỏi một lớp khác không, hay chỉ đang đổi màu tại chỗ — nếu là vế sau thì không thêm bóng.

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

### 4.1c. Giá trị đã nhập BẮT BUỘC nổi bật (chốt 2026-08-14)

Chủ dự án phản hồi giá trị trong ô nhập quá mảnh/nhạt, khó chú ý — đối chiếu ảnh tham khảo đã gửi (nhãn nhỏ nhạt phía trên, giá trị đậm rõ phía dưới, khung viền rõ ràng).

- Mọi ô nhập giá trị dữ liệu (input/textarea/Combobox) trong form nghiệp vụ: `text-[15px] font-semibold text-slate-900` — không còn `text-sm` thường (không đậm) như trước.
- Ô readonly/disabled (mã tự sinh, năm sinh tính sẵn...): vẫn giữ nền `bg-slate-50` để phân biệt không sửa được, nhưng chữ đổi từ `text-slate-500` (nhạt) sang `text-slate-800` (đậm, vẫn đọc rõ) — **không dùng `text-slate-500` cho giá trị nữa**, chỉ dùng màu nhạt cho nhãn.
- Nhãn (`label`) đổi nhỏ/nhạt hơn để tương phản với giá trị: `text-xs font-medium text-slate-500` (trước là `text-sm text-slate-700`).
- Áp dụng đồng nhất cho MỌI nơi hiển thị dữ liệu dạng ô nhập — cả form Thêm mới lẫn form Chi tiết/Sửa (cùng component `disabled` prop), không phân biệt.
- **Ngoại lệ có chủ đích — KHÔNG áp dụng** cho ô tìm kiếm (search box, ví dụ `PatientPicker`/danh sách bệnh nhân/`GeoPane`) — giữ nguyên `text-sm text-slate-900` thường, vì đây là ô gõ-để-lọc chứ không phải giá trị dữ liệu đã lưu.
- `shared/ui/Combobox.tsx` áp dụng cùng token vì đây là component dùng chung cho MỌI dropdown (mục 4.1b) — sửa 1 chỗ, tự động đồng bộ toàn app.
- **Chip/thẻ chọn 1-trong-nhiều KHÔNG được có giá trị mặc định tô sẵn màu "đã chọn"** khi người dùng chưa bấm gì (bug thật gặp ở "Nguồn đặt lịch" — state mặc định `'phone'` khiến ô đầu tiên tô màu ngay lúc mở form, chủ dự án phản hồi tưởng lỗi). State ban đầu phải là `null`/rỗng, chỉ tô màu sau khi người dùng bấm chọn thật; nếu trường bắt buộc thì chặn submit + dấu `*` đỏ, không tự gán giá trị mặc định.

### 4.1b. Combobox — chuẩn bắt buộc cho MỌI dropdown chọn 1 giá trị (chốt 2026-08-12, `docs/DECISIONS.md`)

**BẮT BUỘC dùng `Combobox`** (`apps/web/src/shared/ui/Combobox.tsx`) cho mọi trường chọn 1 giá trị từ danh sách — **cấm dùng thẻ `<select>` HTML thuần** trong code mới, kể cả danh sách ngắn 3-4 mục (đồng nhất thị giác toàn app quan trọng hơn việc "danh sách ngắn không cần tìm kiếm"). Lý do chốt thành chuẩn: mũi tên mặc định của trình duyệt xấu, không đồng nhất giữa các trình duyệt/hệ điều hành, và `<select>` tự chọn hướng xổ lên/xuống theo khoảng trống còn lại trên màn hình — không kiểm soát được.

Đặc tả `Combobox`:
- Mũi tên riêng (`CaretDown` Phosphor, không phải mũi tên mặc định trình duyệt) — đổi màu xanh (`text-blue-600`) và xoay 180° khi đang mở.
- Panel danh sách LUÔN mở CỐ ĐỊNH bên dưới ô nhập (`top-full`), không bao giờ xổ lên trên.
- Cao tối đa đúng **5 dòng** (~188px) rồi cuộn (`overflow-y-auto`) — không giới hạn số lượng option trong DOM, chỉ giới hạn phần hiển thị.
- Gõ trực tiếp vào ô để lọc danh sách (không phân biệt hoa/thường, khớp theo tên hiển thị hoặc mã).
- Điều hướng bàn phím đầy đủ: `↓`/`↑` di chuyển, `Enter` chọn, `Escape`/`Tab` đóng; click ra ngoài tự đóng.
- Props: `id`, `value` (string), `options: {value, label}[]`, `onChange(value)`, `disabled?`, `required?`, `placeholder?`. Giá trị không phải string (ví dụ số) tự chuyển đổi ở nơi gọi (`String(n)` lúc hiển thị, `Number(v)` lúc `onChange`).

Ví dụ đã áp dụng: Dân tộc/Quốc tịch/Giới tính (`PatientFormFields.tsx`), chọn bác sĩ + thời lượng khi đặt/sửa lịch hẹn (`AppointmentQuickCreatePanel.tsx`, `AppointmentDetailPanel.tsx`). Component mới phát sinh nhu cầu chọn 1 giá trị từ danh sách thì dùng lại `Combobox`, không viết `<select>` mới hay dựng component chọn khác.

### 4.1d. TimeInput — chuẩn bắt buộc cho MỌI ô nhập giờ (chốt 2026-08-14)

**BẮT BUỘC dùng `TimeInput`** (`apps/web/src/shared/ui/TimeInput.tsx`) cho mọi ô nhập giờ dạng `HH:mm` — **cấm dùng `<input type="time">`** trong code mới. Lý do chốt thành chuẩn: `<input type="time">` hiển thị theo locale hệ điều hành của từng máy trạm, có thể ra định dạng 12h kèm AM/PM ngoài ý muốn — không có cách ép 24h bằng CSS/JS thuần, trong khi PRD yêu cầu giờ hẹn/giờ làm việc luôn hiển thị 24h.

Đặc tả `TimeInput`: ô nhập text có mặt nạ, gõ tuần tự 4 chữ số tự chèn dấu `:` sau 2 số đầu (ví dụ `0930` → `09:30`); rời khỏi ô (blur) mới chuẩn hoá/giới hạn giờ 0-23, phút 0-59, gõ dở hoặc sai định dạng thì quay về giá trị hợp lệ gần nhất đã có. Props: `id`, `value`/`onChange` (chuỗi `"HH:mm"`, giữ nguyên định dạng cũ của `<input type="time">` nên thay tại chỗ không cần đổi state/logic nơi gọi), `required?`, `disabled?`, `className?`.

Ví dụ đã áp dụng: Giờ hẹn (`AppointmentQuickCreatePanel.tsx`), giờ dời lịch (`AppointmentDetailPanel.tsx`), giờ tiếp nhận (`ReceptionIntakeForm.tsx`), giờ mở/đóng cửa theo ngày (`ClinicHoursPane.tsx`).

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

## 7.Yêu cầu quan trọng về Icon:

BẮT BUỘC sử dụng thư viện Phosphor Icons.

- Cú pháp import chuẩn: import { [Tên_Icon] } from '@phosphor-icons/react';

- Cú pháp sử dụng: Các icon phải luôn có thuộc tính size (ví dụ: size={24} hoặc size={20}) và thuộc tính weight.

- Tôi muốn dùng giao diện gọn gàng, hãy đặt weight="regular" cho các icon menu bình thường, và weight="fill" cho các icon ở trạng thái active (đang được chọn).

- Sử dụng class của Tailwind để tô màu cho icon. Ví dụ: <Stethoscope className="text-gray-500" size="{24}" weight="regular"/>.

- Hãy chọn các icon y tế và quản lý phù hợp từ thư viện Phosphor (như Stethoscope, Pill, Users, CurrencyCircle, ChartBar...) để ráp vào giao diện."

---

## 8. App Shell v2 — Sidebar, Header, Breadcrumb (chốt 2026-08-11, triển khai xong cùng ngày)

Thay thế mô tả app shell đơn giản ở S1-08 (sidebar cố định + user card ở chân sidebar, không có thanh trên cùng). Đã triển khai đủ ở `apps/web/src/shared/layout/` (`AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `breadcrumb.context.tsx`) — mọi màn hình mới dùng nguyên các component này, không viết lại.

### 8.1 Sidebar

- Ba vùng theo chiều dọc: **vùng logo** (đỉnh, tách biệt bằng đường viền dưới) → **menu điều hướng** (cuộn riêng nếu dài) → **nút thu gọn** (chân sidebar).
- Menu hỗ trợ **nhóm cha/con** (accordion): mục cha có mũi tên, bấm mở/đóng danh sách con thụt lề. Nhóm chứa route đang active tự mở sẵn. Chỉ tạo nhóm cha khi đã có ít nhất một mục con thật (không dựng nhóm rỗng chờ tương lai).
- Nút **"Thu gọn"** chuyển sidebar từ `w-60` (đầy đủ nhãn) sang dạng chỉ-icon (`w-16`, không hiện chữ, nhóm cha/con ẩn hẳn phần lồng). Trạng thái này không cần lưu lại giữa các phiên ở v1 (không có yêu cầu cụ thể).
- **Khi sidebar đang thu gọn, bấm vào icon của một mục nhóm cha PHẢI mở lại sidebar (về `w-60`) và mở luôn nhóm đó** — không được để `onClick` im lặng không làm gì khi collapsed (lỗi thật đã xảy ra: `onClick={() => !collapsed && setOpen(...)}` khiến bấm icon lúc thu gọn không phản hồi gì, người dùng tưởng nút hỏng). Quy tắc chung: **mọi phần tử có thể bấm trong sidebar phải luôn có phản hồi ở MỌI trạng thái** (thu gọn hay không), không được có nhánh no-op.
- **Không còn user card (tên/đăng xuất) ở chân sidebar** — chuyển lên thanh trên cùng (mục 8.2) để không vướng khi sidebar thu gọn.

### 8.2 Thanh trên cùng (Topbar)

Dải ngang cố định (`h-14`, `border-b border-slate-200 bg-white`) phía trên vùng nội dung chính (không phủ lên sidebar), hai vùng:

- **Trái — breadcrumb phân cấp**, thay thế hoàn toàn các link "← Quay lại danh sách" trên trang con. Đặc tả thị giác đã chốt (xem `TopBar.tsx`):
  - Icon `House` (Phosphor, 15px, `text-slate-400`) mở đầu, link về `/`, khối vuông bo góc `hover:bg-slate-100`.
  - Phân cách giữa các đoạn: `CaretRight` 11px `text-slate-300` (không dùng dấu `/` hay `>` ký tự thô).
  - Đoạn **không phải cuối cùng** (có thể click): `rounded-md px-2 py-1 font-medium text-slate-500`, hover `bg-slate-100 text-slate-800`.
  - Đoạn **cuối cùng** (trang hiện tại, không click): nổi bật bằng nền — `rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-700` (không chỉ đổi đậm nhạt chữ như bản nháp đầu).
  - Dùng dạng phẳng (`Nhóm cha › Trang hiện tại`), **không dùng vòng số bước (①②...)** kiểu wizard — chỉ dùng số bước cho luồng thật sự tuần tự nhiều bước (ví dụ sau này có luồng khám bệnh nhiều bước), không dùng cho màn hình danh sách/chi tiết thông thường.
  - **Nguồn dữ liệu breadcrumb**: `BreadcrumbProvider` (bọc toàn bộ `AppShell`) + hook `useBreadcrumb(items)` gọi trong chính component trang (không phải khai báo tĩnh theo route, vì có đoạn động cần dữ liệu đã tải — ví dụ tên bệnh nhân ở trang chi tiết). **BẮT BUỘC mọi component trang (mọi phần tử trong `router.tsx`) phải gọi `useBreadcrumb([...])` ngay khi mount** — xem lỗi đã xảy ra ở mục 8.3.
  - **Breadcrumb là định danh trang DUY NHẤT (chốt 2026-08-12)** — trang KHÔNG hiển thị tiêu đề `<h1>` lặp lại tên đã có ở đoạn cuối breadcrumb (ví dụ trang Lịch hẹn không còn chữ "Lịch hẹn" to phía dưới topbar) và KHÔNG có dòng mô tả/chú thích phụ đi kèm tiêu đề đó — tránh trùng lặp thông tin và tiết kiệm không gian dọc. Vẫn giữ `<h1 className="sr-only">{tên trang}</h1>` (visually hidden, không hiện thị) ngay đầu component trang để giữ đúng cấu trúc heading cho screen reader/document outline — không được bỏ hẳn thẻ `h1`. Nội dung trang bắt đầu ngay bằng toolbar/hành động chính (nút "+"/tìm kiếm/tab...), căn theo mục 4.1/9 — nút hành động chính đặt góc phải, dùng `justify-end` nếu không còn tiêu đề để `justify-between` cùng. **Ngoại lệ**: trang chi tiết một bản ghi cụ thể (ví dụ tên bệnh nhân ở `PatientDetailPage`) vẫn hiển thị tiêu đề — đó là dữ liệu định danh bản ghi (an toàn người bệnh: xác nhận đúng bệnh nhân đang xem), không phải tên trang điều hướng, không thuộc diện bỏ.
- **Phải**: lời chào `Xin chào, {họ tên}` + avatar tròn (`bg-blue-50 text-blue-600`, chữ viết tắt tối đa 2 ký tự — lọc bỏ từ không bắt đầu bằng chữ cái trước khi lấy viết tắt, ví dụ hậu tố `(dev)` của tài khoản seed không được tính) mở dropdown nhỏ chứa "Đăng xuất". **Không có icon chuông thông báo** — v1 chưa có hệ thống thông báo trong ứng dụng (ngoài phạm vi PRD, xem `docs/product/prd.md`). **Không hiện tên khoa (`KHOA: ...`)** cạnh lời chào ở v1 — API `/auth/me` hiện chưa trả trường này và phần lớn phòng khám 1-3 bác sĩ không dùng `department`; chỉ thêm nếu có yêu cầu cụ thể sau này (cần mở rộng contract `/auth/me`).

### 8.3 Lỗi đã xảy ra thật lúc triển khai — tránh lặp lại

Hai lỗi dưới đây đã xảy ra thật khi làm màn hình bệnh nhân đầu tiên theo App Shell v2, phát hiện qua chủ dự án dùng thử (không phải review code phát hiện trước) — ghi lại làm quy tắc bắt buộc cho mọi màn hình sau:

1. **Breadcrumb tồn đọng (stale) khi trang mới không tự khai báo.** `useBreadcrumb` KHÔNG dọn về rỗng lúc unmount (cố ý — tránh nháy trắng giữa hai trang, xem comment trong `breadcrumb.context.tsx`). Hệ quả: nếu một trang được thêm vào router mà **quên** gọi `useBreadcrumb(...)`, breadcrumb của trang TRƯỚC đó (bất kỳ trang nào user vừa ở) vẫn hiển thị nguyên, sai hoàn toàn với trang đang đứng — đã xảy ra thật với `DashboardPage`/`AdminPage` lúc mới viết `TopBar`/`Sidebar` (chỉ thêm breadcrumb cho 3 trang bệnh nhân, quên 2 trang còn lại). **Quy tắc**: thêm route mới vào `router.tsx` thì bắt buộc thêm `useBreadcrumb([...])` ngay dòng đầu component đó trong cùng lúc — không tách làm hai bước.
2. **Icon trong sidebar thu gọn không phản hồi khi bấm** — xem mục 8.1. Gốc rễ: logic chặn hành động dựa trên điều kiện `collapsed` mà quên tính trường hợp bấm CHÍNH icon đó để mở lại. Quy tắc: viết `onClick` cho mọi phần tử điều hướng trong sidebar, luôn tự hỏi "bấm cái này lúc đang thu gọn thì xảy ra chuyện gì" trước khi thêm điều kiện chặn.

## 9. Mẫu màn hình danh sách dữ liệu lớn (List Screen Pattern)

Áp dụng cho mọi màn hình danh sách chính (bệnh nhân, và sau này lịch hẹn/hàng đợi tiếp nhận...), thay cho cách làm trung tâm + `max-w-[1400px]` đã dùng ở S2-08.

- **Khung rộng gần hết chiều ngang** (chỉ chừa khoảng đệm nhỏ hai bên, không căn giữa `max-w`) — áp dụng riêng cho màn hình *danh sách*. Màn hình *form* (tạo mới/chi tiết-sửa) vẫn giữ `max-w` hợp lý để dòng nhập liệu không kéo dài hết màn hình rộng, khó đọc.
  **Ngoại lệ (docs/DECISIONS.md #034)**: form nhiều trường bố cục theo lưới dày (≥4 cột, ví dụ form bệnh nhân — xem mục 9b) thì bỏ `max-w`, kéo full-width như màn hình danh sách — lý do "dòng nhập liệu quá dài khó đọc" không áp dụng cho input ngắn xếp lưới nhiều cột. Form đơn giản/ít cột vẫn giữ `max-w` theo quy tắc gốc.
- **Khung bảng cố định chiều cao**: chiếm hết phần còn lại của viewport bên dưới tiêu đề + ô tìm kiếm (hai phần này đứng yên, không cuộn theo). Bảng cuộn **bên trong** khung đó (`overflow-y-auto` trên chính bảng, không phải cuộn cả trang).
- **Phân trang cursor giữ nguyên** (đã chốt ở `.claude/docs/architecture.md`, không đổi sang offset dù một số tham khảo thiết kế bên ngoài dùng kiểu "1-N trên tổng M"). Trải nghiệm là **cuộn tới đâu tự tải thêm tới đó** (infinite scroll, sentinel ở cuối danh sách) thay cho nút "Tải thêm" thủ công — tối thiểu 50 bản ghi mỗi lần tải (không phải 20 như bản đầu S2-08). Không hiển thị tổng số bản ghi (cursor không có khái niệm này).
- **Virtualization bắt buộc** cho các danh sách có thể phình tới quy mô PRD đã nêu (ví dụ bệnh nhân, mục tiêu 50.000 hồ sơ/tenant ở `docs/product/prd.md` mục 5) — dùng `@tanstack/react-virtual` (cùng họ với `@tanstack/react-query` đã có sẵn), chỉ render các dòng nằm trong khung nhìn bất kể đã tải bao nhiêu trang. Lý do: cuộn vô hạn không giới hạn làm DOM phình to dần, ảnh hưởng hiệu năng trình duyệt (không phải hiệu năng API) khi người dùng cuộn sâu thay vì tìm kiếm.
- **Không có nút "Thêm mới"** trên các màn hình danh sách thuần xem/tra cứu — việc tạo mới chuyển sang màn hình nghiệp vụ gốc (ví dụ bệnh nhân mới tạo tại luồng Đặt lịch hoặc Tiếp nhận, không tạo trực tiếp từ Danh sách bệnh nhân) rồi liên kết ngược lại danh sách khi cần.
- **Mở chi tiết/sửa bằng double-click vào cột định danh** (ví dụ mã bệnh nhân), không phải click cả hàng — tránh mở nhầm khi người dùng chỉ muốn chọn/copy text trong hàng. Tương đương bàn phím (giữ đúng triết lý Keyboard-First mục 1): `Tab` focus vào hàng, `Enter` mở — vì double-click không có phím tương đương trực tiếp.
- **Thao tác sửa chỉ hiện với vai trò có quyền cập nhật tương ứng** (tra theo ma trận mặc định ở `.claude/docs/security-audit.md`, ví dụ `patient.update`) — ẩn hẳn nút/khả năng sửa với vai trò không có quyền (không chỉ vô hiệu hoá `disabled`), theo cùng kiểu mảng vai trò tĩnh phía client đã dùng ở `Sidebar.tsx` (`ADMIN_ROLES`/`PATIENT_ROLES`) — không phát minh cơ chế phân quyền phía client mới.
- **Tiêu đề cột (header) BẮT BUỘC nổi bật** (chốt 2026-08-14, phản hồi trực tiếp "quá mờ nhạt"): `border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800` — áp dụng đồng nhất cho MỌI bảng danh sách (kể cả bảng `<table>` gốc như `GeoPane`/`ReferenceCatalogPane` lẫn bảng dựng bằng CSS Grid). Không dùng biến thể nhạt hơn (`font-medium`/`text-slate-500`/viền `border-slate-200`) — đã xoá các bản dùng biến thể này (`ReceptionListPage`, `AppointmentListView`) để đồng nhất toàn app.
- **Cột mã định danh BẮT BUỘC nổi bật, không chìm** (chốt 2026-08-14) — **cấm** `text-xs text-slate-500` (quá nhỏ/nhạt, nhìn như đã vô hiệu hoá). Ba nhóm, đúng kiểu chữ theo đúng nhóm — **không trộn lẫn**:
  1. **Mã có thể bấm mở chi tiết** (ví dụ `patientCode`/`bookingCode` ở `PatientListPage`/`AppointmentListView`, double-click mở hồ sơ): `font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700`, có `cursor-pointer`.
  2. **Mã KHÔNG có thao tác nào trên hàng đó** (ví dụ `encounterNo` ở `ReceptionListPage` — trang thuần theo dõi trạng thái, #044): `font-semibold text-blue-700` — **cùng họ font chữ thường của app** (không `font-mono`), cùng tông xanh để vẫn nhận diện được là "mã", nhưng **không** thêm `underline`/`cursor-pointer` (tránh ngầm hiểu nhầm là bấm được — bug thật đã xảy ra: dùng `font-mono` cho `encounterNo` khiến kiểu chữ lệch hẳn khỏi `patientCode`/`bookingCode` cùng xuất hiện trong các danh sách khác, chủ dự án phản hồi "không đúng với các mã khác").
  3. **Mã danh mục ngắn, không phải mã nghiệp vụ tuần tự** (ví dụ cột "Mã" ở `GeoPane`/`ReferenceCatalogPane` — `"1"`, `"29"`, `"VNM"`): giữ `font-mono font-bold text-slate-800` — khác bản chất `encounterNo`/`patientCode`/`bookingCode` (không theo khuôn `<prefix><yyMM><seq6>`), monospace hợp lý cho mã ngắn độ rộng cố định.

### 9c. Bảng nhiều cột cần cuộn ngang (chốt 2026-08-14)

Áp dụng khi số cột đủ nhiều mà mỗi cột cần độ rộng tối thiểu để đọc được (không nên bóp hẹp bằng `fr`) — ví dụ "Danh sách tiếp nhận" (8 cột). Kỹ thuật:

- Đổi `GRID_COLUMNS` từ tỷ lệ `fr` sang **px cố định từng cột** (vd `'140px 200px 100px 140px 240px 170px 130px 170px'`), cộng tổng lại đặt vào một hằng số `TABLE_MIN_WIDTH_PX` — đây là điều kiện bắt buộc để `overflow-x-auto` phát huy tác dụng (nội dung phải có chiều rộng thật lớn hơn khung nhìn, `fr` sẽ tự co lại vừa khung nên không bao giờ cuộn).
- Cấu trúc 3 lớp: khung ngoài `overflow-x-auto` (cuộn ngang) → khung giữa `style={{ minWidth: TABLE_MIN_WIDTH_PX }}` chứa CẢ header lẫn thân bảng (để header luôn cuộn khớp cột theo thân bảng) → thân bảng `overflow-y-auto` (cuộn dọc, tách biệt).
- **Lỗi thật đã xảy ra — 2 thanh cuộn ngang chồng nhau**: khung thân bảng đặt `overflow-y-auto` mà KHÔNG khai `overflow-x` — theo đặc tả CSS, trình duyệt tự suy ra `overflow-x: auto` cho trục còn lại, sinh thêm một thanh cuộn ngang RIÊNG của chính khung thân bảng, tách khỏi thanh cuộn của khung ngoài. **Bắt buộc thêm `overflow-x-hidden` vào khung có `overflow-y-auto`** mỗi khi nó nằm trong một khung cha đã tự lo `overflow-x-auto` — quy tắc chung: một trục cuộn chỉ nên có đúng MỘT khung chịu trách nhiệm, khung con không tự ý sinh thêm trục còn lại.
- **Thanh cuộn ẨN mặc định, chỉ hiện khi rê chuột** (chốt 2026-08-14, phản hồi "thanh cuộn xám dày luôn hiện làm giao diện rối") — thêm class `scroll-hover` (định nghĩa ở `apps/web/src/app/index.css`) vào MỌI khung có `overflow-y-auto`/`overflow-x-auto`/`overflow-auto` trong danh sách, cả khung ngoài lẫn khung trong ở kỹ thuật cuộn ngang trên. Không viết CSS scrollbar tay ở từng nơi — luôn dùng lại class này.

Ví dụ đã áp dụng: `ReceptionListPage.tsx` (cuộn ngang 8 cột), `PatientListPage.tsx`/`AppointmentListView.tsx`/`GeoPane.tsx` (chỉ cuộn dọc hoặc cả hai trục, vẫn dùng `scroll-hover`). Màn hình danh sách mới phát sinh sau này BẮT BUỘC thêm class `scroll-hover` vào khung cuộn ngay từ đầu, không đợi phản hồi mới sửa.

## 9b. Mẫu form nhiều trường theo khối (Boxed Section Form Pattern)

Áp dụng cho form có nhiều nhóm trường trở lên và số trường lớn (ví dụ form hồ sơ bệnh nhân, `PatientFormFields.tsx`, docs/DECISIONS.md #034) — thay cho cách chia khối bằng `<h2>` + `border-t` đơn giản đã dùng ở bản đầu.

- **Mỗi nhóm trường một khối viền riêng**: `rounded-lg border border-slate-200 p-6 pt-8` (khối `relative` để badge định vị tuyệt đối lên trên). Không lồng khối trong khối — các khối xếp dọc (`space-y-8`), ngang hàng nhau về cấp độ.
- **Badge tiêu đề nổi trên viền**, không dùng heading thường: `absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white`. Áp dụng đồng nhất cho MỌI khối trong cùng form — không trộn một khối có badge với khối kia chỉ có chữ thường/divider (đã thử ở bản đầu, chủ dự án phản hồi phần không có khối viền/badge trông "nhạt" hơn hẳn phần có).
- **Lưới trường dày**: `grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-4` — gap hẹp hơn hẳn `gap-6` mặc định của mục 4.1, vì đây là nhiều input ngắn (không phải vài input dài). Textarea/trường dài vẫn kéo full-width bằng `col-span-*` như mục 4.1.
- **Khung trang bỏ `max-w`, dùng `p-6` full-width** (xem ngoại lệ ở mục 9) — khớp cảm giác rộng rãi của khối viền, không bị bó hẹp giữa trang.
- **Ảnh/file đính kèm đặt ở khối đầu tiên**, cạnh các trường định danh cơ bản (không tách khối riêng) — dùng flex `flex-col gap-4 sm:flex-row` với khung ảnh cố định kích thước (`h-28 w-28`, hoặc tỷ lệ khác nếu ảnh không vuông — ví dụ logo phòng khám 220×110/110×110) đứng cạnh lưới trường.
- **Upload ảnh CHỈ bấm được khi đang ở chế độ Sửa** (chốt 2026-08-13, `docs/DECISIONS.md` #041) — ẩn hẳn nút "Chọn ảnh" (không chỉ `disabled`) lúc form ở chế độ xem, hiện lại khi bấm "Sửa". Nhất quán với mọi trường văn bản khác trong form — đổi lại từ `PatientAvatarUpload.tsx` bản đầu (cho phép upload độc lập với chế độ Sửa, chủ dự án phản hồi gây nhầm lẫn khi làm logo phòng khám theo đúng khuôn đó) — áp dụng cho mọi nơi upload ảnh từ nay, kể cả khi upload là request API riêng không đi qua nút "Lưu" của form.

## 10. Mẫu màn hình Cấu hình 2 cột (Two-panel Config Screen Pattern — chốt 2026-08-13)

Dựng mockup Artifact trước, chọn qua hỏi-đáp giữa 2 kiểu (đã chốt **Kiểu 2 — thanh nhóm + thẻ**), áp dụng lần đầu ở trang "Danh mục" (`/admin/catalog`, gộp `reference_catalog` + `geo` + cấu hình giờ phòng khám).

**Không phải mặc định/bắt buộc cho mọi trang Quản trị.** Đây là một mẫu bố cục có sẵn để dùng KHI PHÙ HỢP (nhiều màn hình con nhỏ, cùng bản chất "xem/quản lý danh mục hay cấu hình"). Việc một tính năng mới có mục sidebar riêng hay gộp vào một trang dạng này **do chủ dự án quyết định lúc tạo menu** — không tự ý gộp mọi trang Quản trị tương lai vào chung một hub "Cấu hình". Đã hỏi và chốt rõ điểm này (xem `docs/DECISIONS.md` #039) sau khi chủ dự án phản hồi "phân bố menu thế nào sẽ do tôi quyết định".

Cấu trúc (dưới `TopBar`, trong `content`):
1. **Thanh nhóm (pill bar)**: dải ngang `bg-slate-50 border-b border-slate-200`, mỗi pill là một nhóm màn hình con **thật đã có backend** — không dựng pill "Sắp có" cho tính năng chưa xây (khác cách làm ở sidebar chính, nơi mục chưa có backend đơn giản là không hiện — ở đây cũng vậy). Pill đang chọn: nền `bg-blue-600` chữ trắng bo tròn `rounded-full`; pill khác: nền trắng viền `border-slate-200` chữ `text-slate-500`.
2. **Cột trái — danh sách màn hình con** (`w-56`–`w-60`, `border-r border-slate-200`): ô tìm kiếm nhỏ trên cùng (tuỳ chọn, chỉ cần khi danh sách dài); mỗi mục là icon Phosphor 15px + label, viền trái `border-l-2` trong suốt, khi active đổi `border-l-blue-600 bg-blue-50 text-blue-700 font-semibold`. Không dùng nền đặc kín hàng như menu sidebar chính (khác `Sidebar.tsx` — đây là điều hướng cấp 2, cần nhẹ hơn).
3. **Cột phải — nội dung màn hình đã chọn**: toolbar (tìm kiếm/toggle/nút hành động chính góc phải) + bảng dữ liệu, theo đúng style bảng đã chốt (`thead` `bg-slate-100 border-b-2 border-blue-600`) hoặc form theo mục 4.1 nếu màn hình đó là cấu hình dạng form (không phải danh sách).
4. **Khung phụ "Nhóm" (group sub-panel)** — CHỈ dựng thêm khi một màn hình con thật sự cần quản lý nhiều nhóm dữ liệu con **động** (số nhóm không cố định, có thể thêm mới qua UI). Khung này là cột hẹp (`w-52`, `border rounded-lg p-2 bg-slate-50` — kiểu Kiểu 2 đã chọn) nằm bên trái bảng dữ liệu, mỗi dòng nhóm hiện kèm số lượng mục (`count`), có "+ Thêm nhóm mới" dạng viền đứt nếu nhóm quản lý được qua UI. **Không dùng khung này khi màn hình con đã là danh mục cố định** (ví dụ Dân tộc và Quốc tịch mỗi cái đã là 1 mục riêng trong danh sách cấp 2 — không cần lồng thêm khung Nhóm bên trong nữa, tránh phân cấp thừa).
5. **Cột trái LUÔN hiện, kể cả pill chỉ có 1 màn hình con** — đã thử ẩn cột này khi chỉ có 1 mục (đỡ trống) nhưng chủ dự án phản hồi giữ nguyên cột trái, chỉ cần nội dung cột phải lấp đúng phần rộng còn lại (không chừa khoảng trống bên phải) — xem điểm 6.
6. **Nội dung cột phải không giới hạn `max-w` cứng** (ví dụ từng thử `max-w-2xl`/`max-w-3xl` cho form "Giờ làm việc" — để lại khoảng trống lớn bên phải, chủ dự án phản hồi "dãn ra hết bên phải và gần sát bên trái"/"còn trống quá nhiều") — form/bảng chiếm trọn `flex-1` của cột phải, dùng lưới 2 cột (mục 4.1) để lấp không gian thay vì ép hẹp lại bằng `max-w`.
7. **Mỗi nhóm trường trong 1 màn hình con bọc khung viền + badge riêng** — áp dụng Boxed Section Form Pattern (mục 9b) cho MỌI form ở cột phải có từ 2 nhóm cấu hình trở lên (ví dụ "Giờ làm việc theo tuần" và "Độ dài Slot" là 2 khung riêng, không gộp chung 1 khối), không chỉ dùng cho form hồ sơ bệnh nhân — khoanh vùng rõ ràng giúp phân biệt các phần cấu hình khác nhau trong cùng 1 màn hình.