# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

## 13/11/2026 (phần 2) — Thêm nhanh mặt hàng + làm bù mockup Đơn đặt hàng NCC (`docs/DECISIONS.md` #298 bổ sung 2)

- **Thêm nhanh mặt hàng**: ở ô tìm hàng của Đơn đặt hàng NCC và Phiếu nhập kho, gõ tên chưa có thì hiện dòng "Thêm mặt hàng mới" (bấm hoặc Enter) mở hộp điền các mục bắt buộc của Thuốc hoặc Vật tư y tế; lưu xong dòng mới tự vào đơn/phiếu. Mã mặt hàng tự sinh (`MH…`). Cần quyền thêm thuốc/vật tư sẵn có; người không có quyền thấy gợi ý nhờ quản lý. Phiếu nhận theo đơn không mở hộp.
- **Làm bù mockup Đơn đặt hàng**: tab "Hàng cần bổ sung", chip "Chờ chi nhánh chính duyệt", dải 5 ô + ô lọc Trạng thái, cột "Nhận đợt này", cột "Còn thiếu theo đơn" + "(đợt nhận N)", diễn giải đơn/đợt ở sổ công nợ NCC; dòng quy đổi "= N viên" dưới ô số lượng.
- **Sổ công nợ NCC**: thêm cột "Diễn giải" (đúng mockup màn 12) có chữ cho mọi dòng, thay dòng phụ "Nhập từ đơn…" dưới mã chứng từ (#298 bổ sung 3).
- **Sửa lỗi**: hộp báo lỗi hệ thống (lỗi máy chủ/mất mạng) bị hộp thêm nhanh đè nên không đóng được — nay luôn nằm trên cùng.
- **Kiểm**: Chrome thật qua IP LAN 25/25; typecheck + lint toàn workspace sạch. Không migration, không `db:seed`; khởi động lại API.

## 13/11/2026 — Đơn đặt hàng NCC, giai đoạn 2 (`docs/DECISIONS.md` #298 bổ sung 1, chủ dự án duyệt mockup)

- **Máy chủ**: bảng `purchase_order`/`purchase_order_line`; luồng Nháp → Chờ duyệt → Đã duyệt → Đã đặt NCC → Nhận một phần → Đã nhận đủ (và Từ chối/Đã đóng/Đã huỷ); duyệt theo chi nhánh (chi nhánh chính duyệt đơn chi nhánh phụ khi bật công tắc); nhận hàng nhiều đợt bằng Phiếu nhập kho liên kết (kiểm khớp NCC/kho/mặt hàng/đơn vị, chặn nhận vượt, trạng thái đơn tự tính lại khi phiếu nhập được Duyệt/Huỷ); chặn Phiếu nhập mua hàng ở chi nhánh phụ khi tắt "đặt hàng NCC riêng"; dòng yêu cầu cấp hàng chờ hàng gắn được với đơn; "Yêu cầu rút" cho dòng chờ đơn đã đặt; Excel danh sách.
- **Dùng chung**: hàm trạng thái thuần ở `packages/core` (`purchase-order-state`, 13 test), schema `packages/shared/src/purchase-order.ts`, mã DDH, mẫu in `PURCHASE_ORDER`, quyền `purchase_order.*`, 3 công tắc ở Cấu hình chung (chi nhánh đặt riêng bật, cần chi nhánh chính duyệt tắt, nhận vượt tắt).
- **Web**: danh sách (tab Đơn của chi nhánh / Cần tôi duyệt, dải đếm, lọc, Xuất Excel, In danh sách, Nhận hàng/Xem/In/Sửa/Huỷ), lập/sửa đơn, chi tiết (dải bước, bảng đã đặt/đã nhận/còn thiếu, phiếu nhập liên kết, Duyệt/Từ chối/Đã gửi NCC/Đóng/Huỷ), bản in, Phiếu nhập kho điền sẵn từ đơn (`?fromOrder=`) + cột/bộ lọc "Từ đơn", hộp "Chờ hàng về" chọn đơn, nút "Đặt NCC cho phần thiếu", khối "Yêu cầu rút" cho kho cấp, menu + chấm số.
- **Kiểm**: API `purchase-order-http.spec` 18 ca (cô lập tenant B + chi nhánh C, đột biến 2/2); typecheck + lint sạch. Cần `db:deploy` (migration `20261113090000_purchase_order`) + `db:seed` rồi khởi động lại API.

## 12/11/2026 (phần 3) — Yêu cầu cấp hàng theo cấp, GĐ1 (`docs/DECISIONS.md` #298, chủ dự án duyệt mockup)

- **Máy chủ**: module trong `inventory` — phiếu yêu cầu cấp hàng (Nháp → Đã gửi → Đã tiếp nhận → Đang xử lý → Hoàn thành; Từ chối/Huỷ/Đã rút), kho cấp suy ra theo cấp (kho phụ → kho chính chi nhánh → kho chính chi nhánh chính), "Chuyển thành phiếu điều chuyển" cấp từng phần (phần thiếu: Chờ hàng về hoặc Từ chối, lý do bắt buộc), "Cấp tiếp", "Xin phần thiếu" lên cấp trên, bên xin nhắn/đổi khẩn/thêm/rút dòng theo ma trận trạng thái, nhãn "Có cập nhật mới", gợi ý hàng dưới mức tồn tối thiểu, Excel danh sách. Phiếu điều chuyển liên kết báo ngược trạng thái trong cùng transaction (nhận thiếu giữ phiếu "Đang xử lý" tới khi kho cấp xử lý chênh lệch).
- **Dùng chung**: hàm trạng thái thuần ở `packages/core` (`stock-request-state`, 28 test), schema `packages/shared/src/stock-request.ts`, mã phiếu YCCH, mẫu in `STOCK_REQUEST`, quyền `stock_request.*` (bác sĩ/điều dưỡng: lập + xem; clinic_admin đủ), công tắc "Dùng yêu cầu cấp hàng" (mặc định bật).
- **Web**: danh sách (tab Của tôi/Cần duyệt, dải đếm, lọc, Xuất Excel, In danh sách, In từng phiếu), lập/sửa phiếu, chi tiết theo mockup (dải bước, bảng dòng, Diễn biến, Phiếu điều chuyển liên kết, thanh nút cố định ở đáy), menu + công tắc ở Cấu hình chung.
- **Kiểm**: API `stock-request-http.spec` 24 ca (kể cả cô lập công ty khác và chi nhánh khác, ca nhận thiếu, từ chối phiếu điều chuyển nháp); Chrome thật qua IP LAN `scripts/ui-audit/stock-request-check.cjs` 26/26 (kể cả lỗi mạng, lỗi 500, công tắc tắt). Cần chạy `pnpm db:seed` rồi khởi động lại API để quyền mới vào vai trò.
- **Chưa làm**: GĐ2 (Đơn đặt hàng NCC, Phiếu nhập liên kết, "Yêu cầu rút" khi đã đặt NCC, cột chi nhánh ở công nợ NCC).

## Các phần cũ (lưu trữ)

File này chỉ giữ thay đổi MỚI NHẤT (từ 28/10/2026). Phần cũ ở `docs/archive/` — **chỉ mở khi cần tra một mục cụ thể**:

- `docs/archive/CHANGELOG-2026-10-13-den-10-27.md` — 13/10 → 27/10/2026
- `docs/archive/CHANGELOG-2026-10-01-den-10-09.md` — 01/10 → 09/10/2026
- `docs/archive/CHANGELOG-2026-09.md` — tháng 09/2026
- `docs/archive/CHANGELOG-2026-08.md` — tháng 08/2026 (từ 07/08)

**Quy ước**: ghi thay đổi mới vào ĐẦU file này (mới nhất ở trên). Khi file này vượt ~120 KB thì chuyển các ngày cũ nhất sang `docs/archive/CHANGELOG-<kỳ>.md` mới và thêm liên kết ở đây (xem `CLAUDE.md`, mục "Quy ước tài liệu dài").

## 2026-11-12

### Nhập Excel vật tư: để trống "Tính chất sử dụng" giữ "chưa phân loại" + kiểm thử cuối vật tư (`docs/DECISIONS.md` #297 bổ sung 5)

Sửa lỗi lệch quyết định: file Excel nhập vật tư để trống cột "Tính chất sử dụng" trước đây bị tự điền "Dùng 1 lần"; nay giữ "chưa phân loại" như chủ dự án đã chốt (form Thêm vật tư vẫn mặc định "Dùng 1 lần"). Câu hướng dẫn trong file mẫu đổi theo. Kèm kiểm thử cuối toàn bộ #297: typecheck, lint và full test xanh. Không migration, không `db:seed`; khởi động lại API.

### Doanh thu và lãi gộp dịch vụ trong báo cáo Chi phí vật tư + "Lãi gộp tổng" ở So sánh chi nhánh (`docs/DECISIONS.md` #297 bổ sung 4)

Báo cáo Chi phí vật tư theo dịch vụ có thêm doanh thu ghi nhận, lãi gộp dịch vụ (doanh thu trừ chi phí tiêu hao) và biên lãi gộp ở dải số, bảng Theo dịch vụ và bảng Theo khách (lượt khách đã hoàn tiền hiện số âm màu đỏ kèm nhãn "Đã hoàn tiền"); thêm tab "Theo vật tư" (số lượng, giá vốn trung bình, tỷ trọng, dịch vụ dùng) và tab "Theo chi nhánh" (chỉ khi công ty từ 2 chi nhánh và có quyền xem báo cáo toàn công ty); mọi tab xuất Excel và in. Toàn hệ thống › So sánh chi nhánh và Tổng hợp tháng thêm cột (và ô tổng) "Lãi gộp dịch vụ", "Lãi gộp tổng" (thuốc cộng dịch vụ); Xếp hạng thêm danh sách "Lãi gộp dịch vụ". Chỉ tính trên các lượt đã ghi tiêu hao. Không migration, không `db:seed`; khởi động lại API.

### Tài liệu: hướng dẫn vật tư tiêu hao + dọn tài liệu vượt ngưỡng

Thêm mục 3.10 "Vật tư y tế và vật tư tiêu hao theo dịch vụ" vào `docs/pilot-onboarding.md` (thêm vật tư, Excel, Ngày SX, định mức, ghi tiêu hao, Kho trừ, đảo phiếu, Khách không làm dịch vụ, báo cáo chi phí). Cắt `docs/DECISIONS.md` #269–#290 nguyên văn sang `docs/archive/DECISIONS-269-290.md` (file gốc từ ~229 KB còn ~89 KB, nay bắt đầu từ #291); chuyển 18 dòng lịch sử phiên bản cũ của `docs/ERD.md` (v1.75–v1.92) sang `docs/archive/ERD-lich-su-phien-ban-v1.75-v1.92.md` (còn ~77 KB) và sửa dòng Version đầu file thành v1.96. Không đổi mã.

### Chi phí vật tư theo dịch vụ — giai đoạn 4 (`docs/DECISIONS.md` #297 bổ sung 2)

Khai **định mức** vật tư/thuốc tiêu hao ngay trong form Dịch vụ kỹ thuật và Dịch vụ khám; người thực hiện **ghi vật tư đã dùng** ở màn nhập kết quả cận lâm sàng và ở tab mới "Vật tư đã dùng" của màn khám (điền sẵn theo định mức, tự chọn lô theo hạn dùng, không thu thêm tiền khách); quản lý đảo phiếu có lý do để hoàn kho. Hộp "Khách không làm dịch vụ" hiện vật tư đã ghi và bắt chọn giữ nguyên hoặc đảo phiếu hoàn kho. Báo cáo mới "Chi phí vật tư theo dịch vụ" (Theo dịch vụ, Theo khách; có Excel và In; chỉ quản lý xem vì có giá vốn; phạm vi chi nhánh như các báo cáo khác). Chi phí này không trừ vào lãi gộp. Phiếu tiêu hao không huỷ được ở danh sách phiếu xuất (phải đảo ở dịch vụ, có quyền và lý do). Cần `db:deploy` (1 migration) + `db:seed` (5 quyền mới `service_consumption.*`) + khởi động lại API.

### "Kho trừ" khi ghi vật tư tiêu hao (`docs/DECISIONS.md` #297 bổ sung 3)

Người ghi chọn kho trừ: mặc định kho chính của chi nhánh, có thể chọn kho phụ của chi nhánh (trong phạm vi quyền Khoa/Phòng); chi nhánh một kho thì không hiện ô. Thiếu tồn ở kho đã chọn thì báo lỗi nêu tên kho, không lấy bù kho khác; đảo phiếu hoàn đúng kho cũ. Không migration, không `db:seed`; cần khởi động lại API.

Sửa kèm: bước tách quyền nhà cung cấp một lần (#291) chỉ áp cho vai trò tuỳ biến, để kỹ thuật viên có `drug.read` không bị cấp thêm quyền nhà cung cấp.

## 2026-11-11

### Ngày sản xuất của lô (`docs/DECISIONS.md` #297 bổ sung 1, giai đoạn 2) + chỉnh form Vật tư

Dòng phiếu nhập, lô tồn và dòng đếm lô mới có thêm Ngày sản xuất (tuỳ chọn, cả Thuốc lẫn Vật tư): hiện ngay trước Hạn dùng ở phiếu nhập, Tồn theo lô, Cảnh báo hạn dùng (kể cả bản in và Excel) và bản in phiếu. Không được sau hôm nay, phải trước hạn dùng; nhập lại cùng số lô mà khác Ngày SX thì chặn lúc Duyệt, lô chưa có ngày thì được điền. Điều chuyển kho, trả hàng từ phiếu xuất và kiểm kê kế thừa/nhận Ngày SX. Form Vật tư: "Tính chất sử dụng" mặc định "Dùng 1 lần", bỏ các dòng chú thích chép từ mockup (giữ một câu cho công tắc "Chỉ dùng nội bộ"). Cần `db:deploy` (1 migration mới).

### Hoàn thiện Vật tư y tế + cờ "Chỉ dùng nội bộ" — giai đoạn 1 (`docs/DECISIONS.md` #297)

Vật tư y tế có thêm Phân nhóm VTYT (danh mục mở, thêm nhanh), Tính chất sử dụng (Dùng 1 lần / Tái sử dụng), Số đăng ký / GPNK (bắt buộc khi thêm mới), Mã vạch, Nước sản xuất và bảo quản. Công tắc "Chỉ dùng nội bộ, không bán" dùng chung cho Thuốc và Vật tư: không cần giá bán, ẩn khỏi bán/phát/kê đơn, máy chủ từ chối kê (409). Nhập/Xuất Excel Thuốc & Vật tư thêm 3 cột mới — **file mẫu cũ phải tải lại**. Bảng giá nhóm vật tư theo Phân nhóm VTYT. Cần `db:deploy` (2 migration) + `db:seed`.

### Sửa 10 điểm giữ hai kết nối cơ sở dữ liệu cùng lúc + ba lớp chặn tái phạm (`docs/DECISIONS.md` #296)

Nạp ví tạm ứng, tất toán ví, trả bằng ví, tổng kết/chốt ca thu ngân, duyệt phiếu nhập có "Trả ngay", xoá ca và Nhập Excel lịch làm việc từng mở thêm một giao dịch trong lúc đang giữ giao dịch khác; khi nhiều người thao tác đồng thời trên máy chủ nhỏ có thể báo lỗi hệ thống. Đã sửa; thêm bộ phát hiện lúc chạy, phân tích tĩnh theo đồ thị lời gọi và job CI căng bể kết nối. Không migration, không cần `db:seed`.

## 2026-11-10

### Vá cảnh báo bảo mật công cụ dev; đồng bộ số phiên bản `apps/setup` (`docs/DECISIONS.md` #293)

Nâng `undici`, `glob`, `minimatch` (công cụ dev) bằng override; `pnpm audit` chỉ còn 1 cảnh báo mức thấp chưa có bản vá. Gói `apps/setup` đã vào danh sách mà script phát hành nâng số (trước đó kẹt ở `0.9.0`). Không đổi mã chạy thật.

### Sửa lỗi CI đỏ ở bước Test: Chromium khởi động và giao dịch chờ kết nối (`docs/DECISIONS.md` #294)

Xuất PDF: hạn khởi động trình duyệt nâng từ 30 lên 120 giây, và một lần khởi động lỗi không còn làm hỏng mọi lần xuất PDF sau đó cho tới khi khởi động lại. Giao dịch cơ sở dữ liệu chờ lấy kết nối tối đa 10 giây thay vì 2 giây, để lúc máy bận xếp hàng chứ không báo lỗi hệ thống. Không migration, không cần `db:seed`.

### Nâng zod 3 → 4, zod-to-openapi 9, puppeteer-core 25.16 (`docs/DECISIONS.md` #293)

Hết cảnh báo bảo mật `zod <4.6.6` (`pnpm audit --prod` không còn lỗ hổng). Cấu hình lưu thưa đọc bằng `z.partialRecord` (zod 4 bắt `z.record(enum)` đủ khoá), có luật ESLint chặn tái phạm; UUID kiểm nghiêm hơn; sinh lại OpenAPI và kiểu web. Bundle web tăng khoảng 12 kB gzip. Không migration, không cần `db:seed`; cần `pnpm install`.

### Bộ hồ sơ bệnh án một lượt khám ghép nguyên PDF kết quả của đối tác (`docs/DECISIONS.md` #291 bổ sung 10)

File PDF "In bộ hồ sơ" nay nối nguyên các trang PDF của đối tác (kết quả đã duyệt) vào cuối bộ hồ sơ; tệp hỏng được bỏ qua và bản in ghi "xem trong hệ thống". Số ảnh đính kèm không còn đếm lẫn PDF. Thêm thư viện `pdf-lib`. Không migration, không cần `db:seed`; cần `pnpm install`.

### Nhập/Xuất Excel giá trả đối tác (`docs/DECISIONS.md` #291 bổ sung 9)

Menu "Giá trả (Excel)" ở Danh mục Cận lâm sàng › Đối tác xét nghiệm: tải file mẫu, xuất giá hiện có, nhập từ Excel (xem trước, báo lỗi từng dòng, ghi trong một lần). Mỗi dòng một dịch vụ gửi đối tác, mỗi đối tác đang dùng một cột giá, có cột "Đối tác mặc định"; ô trống giữ nguyên giá. Cần quyền sửa dịch vụ kỹ thuật. Không migration, không cần `db:seed`.

### Bảng kê mẫu gửi đối tác + phụ lục đối chiếu (`docs/DECISIONS.md` #291 bổ sung 8)

Trang chi tiết đối tác xét nghiệm có tab **Mẫu đã gửi**: mỗi dòng một dịch vụ, kỳ theo ngày nhận kết quả hoặc ngày gửi, lọc trạng thái, Xuất Excel, In bảng kê (số dư đầu/cuối kỳ, hai ô ký). Dải số thêm "Tổng tiền dịch vụ đã ghi nợ" và "Đang chờ kết quả". Hộp "Lập biên bản đối chiếu" có phụ lục bảng kê. Thẻ số (`StatCardRow`) dùng chung đổi sang nhãn 15px đậm, chữ tối. Không migration, không cần `db:seed`.

### Kết quả PDF của đối tác hiện đúng ở màn kết quả và bản in (`docs/DECISIONS.md` #291 bổ sung 7)

Tệp PDF nhận từ đối tác không còn bị vẽ thành ảnh hỏng: màn kết quả có khối "Tệp PDF kết quả" với liên kết xem tệp, bản in ghi một dòng "Kèm tệp PDF kết quả của đối tác xét nghiệm". Phiếu kết quả của API trả thêm `contentType` cho tệp đính kèm. Không migration, không cần `db:seed`.

## 2026-11-09

### Kết quả đối tác chờ duyệt hiện trong màn khám và Tổng quan bác sĩ (`docs/DECISIONS.md` #291 bổ sung 6)

Màn khám có khối "Đã có kết quả đối tác, chờ duyệt" kèm nút **Xem và duyệt** (tab Chỉ định và tab Kết quả cận lâm sàng); Tổng quan bác sĩ có khối "Kết quả đối tác chờ duyệt" (chỉ lượt khám của chính bác sĩ). Duyệt tại chỗ, không phải mở "Gửi mẫu đối tác". Không migration, không cần `db:seed`.

## 2026-11-07

### Gửi mẫu đối tác — giai đoạn 3, giao diện "Gửi mẫu đi" (`docs/DECISIONS.md` #291 bổ sung 4)

Menu mới **Gửi mẫu đối tác** (Cận lâm sàng; chỉ hiện khi bật "Dùng đối tác xét nghiệm" và có quyền `lab_partner.read`): hàng đợi 3 tab Chờ gửi / Đã gửi chờ kết quả / Đã có kết quả. Tick các mẫu rồi "Gửi mẫu đi": chọn một đối tác, mỗi mẫu hiện đúng giá trả của đối tác đó (đổi đối tác thì giá đổi, mẫu chưa có giá bị khoá), ngày giờ gửi mặc định là bây giờ. Cột giá trả chỉ hiện cho người thấy giá vốn. Không migration, không cần `db:seed`.

### Gửi mẫu đối tác — nhận kết quả PDF, duyệt, trả lại, ghi nợ, phiếu giao mẫu (`docs/DECISIONS.md` #291 bổ sung 5)

Tab "Đã gửi chờ kết quả" có nút **Nhận kết quả**: một tệp PDF gắn cho nhiều dịch vụ của cùng đối tác, ghi nợ đối tác ngay lúc nhận (đúng giá đã chụp lúc gửi). **Đối tác không nhận mẫu** đưa mẫu về "Chờ gửi". Tab "Đã có kết quả" lọc mặc định "Chờ duyệt"; bác sĩ xem PDF (phóng to được), duyệt và sang ca kế tiếp, hoặc trả lại kỹ thuật viên (đảo nợ). Menu "Gửi mẫu đối tác" có chấm số kết quả chờ duyệt cho người có quyền duyệt. Hộp "Gửi mẫu đi" có ô Người gửi và nút In phiếu giao mẫu. Môi trường khác cần `db:deploy` (migration `20261107100000_lab_partner_result`).

## 2026-11-06

### Sổ công nợ nhà cung cấp: lọc khoảng ngày, tổng hợp kỳ, Xuất Excel, In (`docs/DECISIONS.md` #292)

Tab "Sổ công nợ" ở trang nhà cung cấp/đối tác có "Từ ngày/Đến ngày", dải tổng hợp (số dư đầu kỳ, tăng nợ, giảm nợ, số dư cuối kỳ), Xuất Excel và In theo kỳ đang xem. Không cần `db:seed`/`db:deploy`.

### Gửi mẫu đối tác — giai đoạn 2, máy chủ phần "Gửi mẫu đi" (`docs/DECISIONS.md` #291 bổ sung 3)

Máy chủ: hàng đợi "Chờ gửi"/"Đã gửi", gửi một đợt cho một đối tác với giá đúng của cặp dịch vụ × đối tác được chụp lại, hạn trả tính từ giờ gửi; quyền mới `lab_partner.read/send/receive`. Chưa có giao diện (giai đoạn kế tiếp). Môi trường khác cần `db:deploy` (migration `20261106150000_lab_partner_dispatch`) + `db:seed` (3 quyền mới).

### Quyền nhà cung cấp riêng, che giá trả đối tác, thời gian trả theo giờ, quyền đi kèm mới (`docs/DECISIONS.md` #291 bổ sung 2)

Xem nhà cung cấp không còn gắn với kho thuốc: quyền mới **Nhà cung cấp & Đối tác xét nghiệm** (xem/thêm/sửa), vai trò đang có quyền kho thuốc được cấp tương ứng một lần khi nâng cấp. Giá trả đối tác không hiện cho bác sĩ/lễ tân/khách, chỉ người cấu hình dịch vụ hoặc xem công nợ thấy; cột giá ở form dịch vụ đổi tên "Giá niêm yết". "Thời gian trả kết quả" nhập được theo **phút hoặc giờ** (ô chọn đơn vị cạnh ô nhập). Bảng gợi ý quyền đi kèm ở Vai trò & Phân quyền bổ sung cho báo cáo Bác sĩ, báo cáo Khám bệnh và vận hành, Tổng quan thu ngân, "Hẹn tái khám" ghi nhắc, "Khách không làm dịch vụ" và nhà cung cấp. Môi trường khác cần `db:seed`.

### Gửi mẫu xét nghiệm cho đối tác — giai đoạn 1 "nền" (`docs/DECISIONS.md` #291)

Công tắc **"Dùng đối tác xét nghiệm"** ở Cấu hình chung (mặc định tắt). Bật: Danh mục Cận lâm sàng có mục **"Đối tác xét nghiệm"** (đối tác là nhà cung cấp có chip "Đối tác XN", mã `DT…`, cột "Dịch vụ" và "Còn nợ"), form dịch vụ kỹ thuật có **"Nơi thực hiện"** (Tại phòng khám / Gửi đối tác) và bảng **giá trả bên thứ ba theo từng đối tác** (một giá hiện hành mỗi cặp, đối tác mặc định, hiện lãi gộp mỗi mẫu). Chỉ xét nghiệm tự làm mới gửi đối tác được. Chưa có hàng đợi gửi mẫu, công nợ đối tác và bảng kê (các giai đoạn sau). Môi trường khác cần `db:deploy` (migration `20261106130000_lab_partner_foundation`); không quyền mới.

### Báo cáo: trang "Chất lượng và tuân thủ" (3 tab) (`docs/DECISIONS.md` #290)

Menu mới **Chất lượng và tuân thủ** (nhóm Báo cáo, quyền mới `quality_report.read`, mặc định chỉ quản lý phòng khám): **Lượt khám chưa hoàn tất** (ảnh chụp đến hôm nay, không theo kỳ: lượt chờ khám/đang khám từ ngày trước, ca thu ngân chưa đóng, số phiếu chưa thu kèm liên kết sang Doanh thu → Phiếu chưa thu), **Liên thông đơn thuốc** (đơn đã ký trong kỳ: đã gửi / chờ gửi / cổng từ chối, theo bác sĩ, danh sách đơn tồn cũ nhất trước kèm lỗi của cổng) và **Nhật ký kiểm toán** (bấm tab mở trang nhật ký hoạt động đã có). Hai tab đầu có Xuất Excel và In, chọn Phạm vi nhiều chi nhánh như các báo cáo khác. Môi trường khác cần `db:seed` (quyền mới). Không migration.

### Trang "Cập nhật phần mềm" thiết kế lại (`docs/DECISIONS.md` #288, mockup chủ dự án chốt 06/11/2026)

Thẻ thương hiệu bên trái (logo NEXA Med canh giữa, dòng "Phần Mềm Quản Lý Phòng Khám Chuyên Nghiệp", phiên bản, ngày phát hành, chế độ triển khai, số bản dựng, khối "Bản quyền" và nút "Sao chép thông tin gửi hỗ trợ"); bên phải là khung kiểm tra cập nhật, "Có gì mới" với ba nhóm Tính năng mới / Cải tiến / Sửa lỗi **mặc định thu gọn** (bấm "Xem chi tiết" mới xổ ra) và lịch sử kiểm tra. Thông tin bản quyền/hỗ trợ khai báo ở một nơi (`shared/version/copyright-info.ts`), dòng chưa có thông tin tự ẩn. Khung có đầu khung dùng chung mới `shared/ui/SectionCard.tsx`. Không migration, không quyền mới.

### Báo cáo: trang "Bệnh nhân" (3 tab) và "Chuyên môn" (3 tab) (`docs/DECISIONS.md` #289)

**Bệnh nhân** (`/reports/patients`, quyền mới `patient_report.read`): Bệnh nhân mới và cũ (mới = lượt khám đầu tiên ở bất kỳ chi nhánh nào của công ty), Tuổi giới và địa bàn, Bệnh nhân không quay lại (hẹn tái khám đã ký, quá hạn, chưa có lượt khám sau). **Chuyên môn** (`/reports/clinical`, quyền mới `clinical_report.read`): Cơ cấu chẩn đoán ICD-10 (mã chính hiện hành + theo chương), Dịch vụ đã dùng (dẫn sang Doanh thu → Theo nhóm và dịch vụ), Cận lâm sàng (thời gian trả kết quả đến lần duyệt đầu tiên, quá hạn theo "Thời gian trả kết quả" của dịch vụ). Mỗi tab có Xuất Excel và In. Môi trường khác cần `db:seed`.

### Giao diện

Menu: chữ sáng hơn (`slate-100`), giữ cỡ 14px. Hộp xác nhận đổi chi nhánh và hộp "Ngừng bảng giá" chuyển sang `ConfirmDialog` chuẩn.

Sửa lỗi: trang "Trung tâm báo cáo" không cuộn được, dòng cuối bị cắt (khung bảng có `overflow-hidden` bị cột flex bóp lại; thêm `flex-shrink-0`). Quét toàn bộ 61 trang không tham số ở hai cỡ màn hình (`scripts/ui-audit/clipped-content-audit.cjs`) chỉ thấy thêm một chỗ cùng kiểu: trạng thái trống "Chưa có dòng hàng nào" ở phiếu Điều chuyển kho/Xuất kho bị cắt 16px ở màn 1280×720 (đã cho cuộn). Trang có tham số (chi tiết lượt khám, bảng giá...) chưa quét.

## 2026-11-05

### Trang báo cáo "Toàn hệ thống" — 4 tab (`docs/DECISIONS.md` #287)

Menu mới **Toàn hệ thống** (nhóm Báo cáo, dành cho người có quyền "Xem báo cáo toàn công ty") gồm 4 tab: **So sánh chi nhánh** (lượt khám, bệnh nhân mới, ghi nhận, thực thu, chờ thu, thời gian chờ, tái khám đã đến, lãi gộp thuốc của từng chi nhánh cạnh nhau, so với kỳ trước; biểu đồ đường thực thu theo ngày từng chi nhánh; cơ cấu thực thu theo nhóm; khối "Cần chú ý" gồm ca thu ngân chưa chốt, phiếu chưa thu quá 3 ngày, lô thuốc sắp hết hạn, chi nhánh chờ lâu nhất; bấm tên chi nhánh để xem riêng), **Xếp hạng** (dịch vụ, bác sĩ, thuốc và vật tư dẫn đầu kèm giá trị từng chi nhánh), **Tổng hợp tháng** (chọn tháng, so với tháng trước, theo chi nhánh, cơ cấu theo nhóm, xu hướng 6 tháng; bản in có ô ký "Chủ phòng khám" để gửi chủ đầu tư) và **Khám chéo chi nhánh** (bệnh nhân khám ở từ hai chi nhánh, theo cặp chi nhánh, không hiện tiền theo bệnh nhân). Phạm vi mặc định là tất cả chi nhánh. Mỗi tab có Xuất Excel và In. Không quyền mới (dùng "Xem báo cáo toàn công ty"), không migration.

### Trang báo cáo "Thuốc và vật tư" — 3 tab mới + 4 tab dẫn sang báo cáo kho (`docs/DECISIONS.md` #287)

Menu mới **Thuốc và vật tư** (nhóm Báo cáo) gồm 7 tab: **Đã phát** (số lượng và giá trị đã xuất theo phiếu xuất kho bán theo đơn, trừ phần khách trả lại), **Lãi gộp** (tiền bán sau chiết khấu trừ giá vốn thẻ kho theo mặt hàng, biên lãi gộp; chỉ tính thuốc và vật tư, chưa trừ nhân sự, mặt bằng, khấu hao), **Kiểm soát đặc biệt** (tồn đầu kỳ, nhập, phát, xuất khác, tồn cuối kỳ của thuốc gây nghiện, hướng thần, tiền chất, thuốc độc và từng lượt phát cho người bệnh — bảng theo dõi nội bộ, chưa phải mẫu báo cáo gửi cơ quan quản lý) và bốn báo cáo kho đã có (Nhập-Xuất-Tồn, Tồn kho và hạn dùng, Hao hụt điều chuyển, Công nợ nhà cung cấp) — bấm tab là mở đúng trang cũ. Có bộ lọc Loại (Tất cả / Thuốc / Vật tư y tế) và Phân loại; mỗi tab mới có Xuất Excel và In; chọn Phạm vi nhiều chi nhánh như các báo cáo khác. Quyền mới **`pharmacy_report.read`** ("Báo cáo Thuốc và vật tư"), mặc định chỉ quản lý phòng khám (có giá vốn). Môi trường khác cần `db:seed` (quyền mới). Không migration.

### Trang báo cáo "Bác sĩ" — 3 tab (`docs/DECISIONS.md` #287)

Menu mới **Bác sĩ** (nhóm Báo cáo) gồm 3 tab: **Hiệu suất theo bác sĩ** (lượt khám, phút khám mỗi lượt, doanh thu sinh ra, doanh thu một lượt, tỉ lệ có cận lâm sàng / thuốc / hẹn tái khám, xếp theo doanh thu, nút "Xem" mở Sổ khám bệnh của bác sĩ đó), **Cơ cấu kê đơn và chỉ định** (lượt có thuốc, dòng thuốc mỗi đơn, chỉ định cận lâm sàng tại phòng khám và ra ngoài, 10 thuốc và 10 chỉ định nhiều nhất), **Giờ làm việc và lượt khám** (ca đã xếp theo Lịch làm việc, nghỉ phép đã duyệt, giờ khám thực tế, tỉ lệ sử dụng giờ ca). Có bộ lọc Khoa; mỗi tab có Xuất Excel và In; chọn Phạm vi nhiều chi nhánh như các báo cáo khác. Quyền mới **`doctor_report.read`** ("Báo cáo Bác sĩ"), mặc định chỉ quản lý phòng khám (bác sĩ không xem trang này). Môi trường khác cần `db:seed` (quyền mới). Không migration.

### Trang báo cáo "Doanh thu" — 5 tab (`docs/DECISIONS.md` #287)

Menu mới **Doanh thu** (nhóm Báo cáo) gồm 5 tab: **Theo kỳ** (hai cột Ghi nhận theo ngày khám và Thực thu theo ngày thu, chia Khám bệnh / Cận lâm sàng / Thuốc và vật tư / Gói dịch vụ, gom theo ngày, tuần, tháng, quý, biểu đồ cột đôi, so với kỳ trước), **Theo nhóm và dịch vụ** (số lượng và doanh thu từng dịch vụ), **Theo phương thức** (thu, hoàn, thực thu theo hình thức thanh toán), **Phiếu chưa thu** (theo tuổi phiếu, cũ nhất trước), **Theo thu ngân và chốt ca** (thu/hoàn theo thu ngân, chênh lệch kiểm đếm các ca). Mỗi tab có Xuất Excel và In; chọn Phạm vi nhiều chi nhánh như các báo cáo khác. Quyền mới **`revenue_report.read`** ("Báo cáo Doanh thu"), mặc định chỉ quản lý phòng khám. Tiêu đề trên mọi trang báo cáo điều hành to và đậm hơn (nhãn số liệu, tiêu đề khung, đầu cột). Môi trường khác cần `db:seed` (quyền mới). Không migration.

### Nhóm báo cáo "Khám bệnh và vận hành" — 6 tab (`docs/DECISIONS.md` #287)

Menu mới **Khám bệnh và vận hành** (nhóm Báo cáo) gồm 6 tab: **Sổ khám bệnh** (lượt khám đã hoàn tất theo khoảng ngày, lọc bác sĩ / mã ICD-10 / tên-mã BN-SĐT, thay sổ giấy), **Giờ cao điểm** (bản đồ nhiệt thứ × giờ, chờ theo khung giờ, phân bố thời gian chờ), **Thời gian chờ**, **Huỷ và không đến**, **Tái khám**, **Nguồn đặt lịch**. Mỗi tab có Xuất Excel và In; chọn Phạm vi nhiều chi nhánh như các báo cáo khác. Quyền mới **`operations_report.read`** ("Báo cáo Khám bệnh và vận hành"), mặc định chỉ quản lý phòng khám. Môi trường khác cần `db:seed` (quyền mới). Không migration.

### Tổng quan bác sĩ: "N chỉ số ngoài khoảng" ở kết quả cận lâm sàng mới (`docs/DECISIONS.md` #286 bổ sung)

Dòng kết quả cận lâm sàng mới chưa xem ở Tổng quan bác sĩ nay ghi thêm chữ đỏ "N chỉ số ngoài khoảng" khi kết quả đã ký có chỉ số cao/thấp/bất thường so với khoảng tham chiếu; kết quả không có chỉ số ngoài khoảng thì không hiện thêm gì. Không migration, không quyền mới.

### Báo cáo ngày, Trung tâm báo cáo và nhóm menu "Báo cáo" (`docs/DECISIONS.md` #287)

Nhóm menu mới **"Báo cáo"** gồm **Trung tâm báo cáo** (liệt kê báo cáo đã có, có ô tìm, mỗi dòng ghi xem theo chi nhánh/toàn công ty, xuất Excel/In, nút "Mở"; chỉ hiện báo cáo người xem có quyền) và **Báo cáo ngày**: tờ chốt ngày một hoặc nhiều chi nhánh, chọn Hôm nay/Hôm qua, bộ chọn Phạm vi dùng chung (Chi nhánh đang làm / Tất cả / Chọn chi nhánh; gộp cần quyền "Xem báo cáo toàn công ty"). Có lượt khám (mới/tái khám/hoàn tất/huỷ/không đến), tiền thu theo phương thức và thực thu, ghi nhận theo nhóm, phiếu chưa thu, các ca thu ngân kèm chênh lệch kiểm đếm, thu chi tại quầy. **In trực tiếp** từ trình duyệt (từ hai chi nhánh: trang tổng rồi mỗi chi nhánh một trang) và **Xuất Excel** (sheet Tổng hợp + mỗi chi nhánh một sheet, ghi nhật ký kiểm toán). Quyền mới `daily_report.read` (mặc định quản trị phòng khám). Quản lý mẫu in có thêm chứng từ **"Báo cáo"** (A4, dùng chung cho mọi báo cáo in). Quy tắc mới: **mọi báo cáo phải có Excel và In** — đã bổ sung cho cả 8 báo cáo cũ: nút **In** (bản in A4 theo mẫu "Báo cáo", đầu bảng lặp lại mỗi trang) ở Báo cáo dòng tiền, Sổ quỹ, Nhập-Xuất-Tồn, Hao hụt điều chuyển, Tồn kho và hạn dùng, Công nợ nhà cung cấp, Ví tạm ứng, Nhật ký kiểm toán; nút **Xuất Excel** mới ở Ví tạm ứng, Công nợ nhà cung cấp, Tồn kho và hạn dùng (hai sheet) và Nhật ký kiểm toán (tối đa 5.000 dòng, đúng bộ lọc đang xem, ghi nhật ký xuất). Môi trường khác cần `db:deploy` (migration `20261105100000_print_report_document`) + `db:seed`.
### Trang Tổng quan của bác sĩ + công tắc "Hiện doanh thu sinh ra trên Tổng quan bác sĩ" (`docs/DECISIONS.md` #286)

Quyền mới **`dashboard.doctor`** (mặc định bác sĩ): trang chủ của bác sĩ hiện lượt khám CỦA CHÍNH MÌNH hôm nay — Tổng lượt (kèm trung bình lượt/ngày), Đang chờ tôi (người chờ lâu nhất), Đang khám, Đã xong (thời gian khám trung bình), danh sách bệnh nhân đang chờ với nút "Bắt đầu khám", hàng chờ chung của Khoa (+ "Nhận ca"), kết quả cận lâm sàng mới chưa xem, lượt khám theo giờ, hẹn tái khám của tôi, dải nhắc "ca chưa đóng" (có nút đóng ca) và khối "Báo cáo của tôi" mờ "Sắp có". Công tắc mới ở Cấu hình phòng khám → Cấu hình chung: **"Hiện doanh thu sinh ra trên Tổng quan bác sĩ"** (mặc định TẮT) — bật thì bác sĩ thấy thêm ô doanh thu của các lượt khám mình khám hôm nay (tiền sau chiết khấu, gồm phiếu chưa thu); tắt thì máy chủ không gửi số tiền. Các nút của Tổng quan mở Hàng đợi khám (bắt đầu khám/nhận ca vẫn làm ở đó). Môi trường khác cần `db:seed` (quyền mới). Không migration.

## 2026-11-04

### Trang "Hẹn tái khám" của lễ tân + công tắc "Dùng danh sách Hẹn tái khám" (`docs/DECISIONS.md` #285)

Menu con mới **"Hẹn tái khám"** (nhóm "Tiếp nhận và Đặt lịch"): danh sách hẹn tái khám đã ký của chi nhánh đang làm việc, 4 tab Hôm nay / Quá hạn / Sắp tới 7 ngày / Tất cả kèm số, tìm tên-mã BN-SĐT, lọc bác sĩ, xuất Excel; mỗi dòng có Xem hồ sơ, Sao chép SĐT, Đặt lịch hẹn (mở Lịch hẹn điền sẵn) và Ghi lần nhắc (kết quả liên lạc + ghi chú, xem các lần nhắc trước; "Bệnh nhân không tái khám" đưa hẹn khỏi danh sách). Quyền mới `follow_up.read` (lễ tân, quản trị; bác sĩ chỉ hẹn của mình) và `follow_up.remind` (lễ tân, quản trị). Tổng quan lễ tân có liên kết "Xem tất cả" và ô "Quá hạn chưa đến" mở thẳng trang này. Lễ tân không thấy chẩn đoán (chỉ số lượt khám). **Phòng khám không dùng** tắt công tắc "Dùng danh sách Hẹn tái khám" ở Cấu hình phòng khám → Cấu hình chung (mặc định BẬT): ẩn menu, trang và khối ở Tổng quan; bác sĩ vẫn chọn hướng "Hẹn tái khám" ở tab Điều trị. Migration `20261104120000_follow_up_reminder` (môi trường khác cần `db:deploy` + `db:seed`).

### Trang Tổng quan của lễ tân (`docs/DECISIONS.md` #284)

Quyền mới **`dashboard.reception`** (mặc định lễ tân): lịch hẹn hôm nay (đã đến / chưa đến), đang chờ khám, khám mới / tái khám, lịch hẹn sắp tới (nút "Tiếp nhận" và "Đổi bác sĩ" mở thẳng chi tiết lịch), hàng đợi theo bác sĩ, lịch hẹn theo giờ, hẹn tái khám (đến hạn, đã đến, quá hạn chưa đến) và cảnh báo bác sĩ nghỉ phép còn lịch cần đổi. Lễ tân có thanh chuyển giữa bản Lễ tân và Thu ngân. Trang Lịch hẹn nhận liên kết `?date=&appointmentId=&mode=`. Môi trường khác cần `db:seed`. Không migration.

### Trang Tổng quan của thu ngân (`docs/DECISIONS.md` #283)

Tài khoản có quyền mới **`dashboard.cashier`** (mặc định lễ tân) thấy trang chủ thu ngân: chờ thu / đã thu / đã hoàn / thực thu hôm nay, danh sách phiếu chờ thu (bấm để mở phiếu, "Thu tiền" ở phiếu đầu), ca đang mở với nút Chốt ca và tiền mặt dự kiến trong két, tiền thu theo giờ và theo phương thức. Tài khoản có nhiều quyền tổng quan có thanh chuyển giữa các bản. Môi trường khác cần `db:seed`. Không migration.

### Trang Tổng quan của chủ phòng khám (`docs/DECISIONS.md` #282)

Trang chủ của tài khoản có quyền mới **`dashboard.owner`** (mặc định clinic_admin) nay hiện số liệu thật thay cho khung trống: lượt khám, thực thu (thu trừ hoàn, theo ngày thu), chờ thu, bệnh nhân khám lần đầu — mỗi ô có so sánh với kỳ trước và đường 7 ngày; lượt khám theo giờ; thực thu theo nhóm (Khám bệnh / Cận lâm sàng / Thuốc và vật tư / Gói dịch vụ); thực thu 7 ngày; "Cần xử lý" (phiếu chưa thu, ca chưa chốt, lô sắp hết hạn, mặt hàng dưới ngưỡng); dịch vụ dùng nhiều; hàng đợi hiện tại theo bác sĩ. Chọn kỳ Hôm nay / 7 ngày / Tháng này; số chỉ tải khi vào trang, đổi kỳ hoặc bấm "Làm mới" (ghi "Số lúc HH:MM"). Chỉ chi nhánh đang làm việc. Vai trò khác vẫn thấy khung trống cho tới khi có bản riêng. Môi trường khác cần `db:seed` (quyền mới). Không migration.

### Hệ thống báo cáo — Đợt 0: hàm ngày giờ Việt Nam dùng chung + đầu báo cáo Excel (`docs/DECISIONS.md` #279, `docs/product/reporting-plan.md`)

Ghi phạm vi báo cáo vào `CLAUDE.md`, `docs/product/prd.md`, `docs/product/plan.md` (đảo ngược việc xếp "báo cáo doanh thu theo kỳ" vào v2). Thêm `packages/core/src/date/vietnam-period.ts`: mốc đầu/cuối ngày giờ VN, khoảng ngày, kỳ ngày/tuần/tháng/quý/năm, kỳ trước, cùng kỳ tháng trước, liệt kê ngày (dùng lại `addDaysToDateString`/`diffDateStrings` sẵn có, không nhân bản). Thay 7 chỗ viết cứng `+07:00` ở cash-book-report, stock-issue/receipt/transfer/ledger-report, supplier-debt, prescription-submission bằng hàm này (hành vi giữ nguyên, 354 test các module đó vẫn xanh). Thêm `addReportExcelHeader` (`apps/api/src/common/report-excel-header.ts`): đầu chuẩn cho mọi bản Excel báo cáo mới (phòng khám/chi nhánh, tên báo cáo, kỳ, phạm vi, người xuất, giờ xuất). Chưa có thay đổi nhìn thấy trên giao diện.

## 2026-11-03

### Logo và favicon thương hiệu mới; logo chính hiện ở đầu menu; logo trong PDF bệnh án (`docs/DECISIONS.md` #281)

Favicon NEXAMed mới (SVG + ICO + PNG + biểu tượng iOS). Đầu thanh menu hiện **logo chính** của phòng khám trên nền tối (chưa tải thì hiện logo NEXAMed bản nền tối; menu thu gọn hiện biểu tượng N+); màn đăng nhập dùng logo NEXAMed cố định (không đổi theo phòng khám). Logo mẫu in giờ có thể là logo ngang dài (trước bị ép khung vuông 64px). PDF bệnh án và "In bộ hồ sơ" nay in logo mẫu in ở đầu trang, bật/tắt bằng công tắc "Hiện logo" của mẫu in Bệnh án. Sửa lỗi: tải logo xong đầu menu không tự cập nhật; địa chỉ ảnh logo đổi mỗi lần đọc. Trang Thông tin phòng khám xếp lại cột cho màn hẹp (dưới 1280px xếp dọc). `GET /clinic-profile/print-header` có thêm `logoUrl` (mọi vai trò đọc được). Không migration.

### "Khách không làm dịch vụ" ở quầy thu ngân (`docs/DECISIONS.md` #280)

Trên phiếu thu có nút **Khách không làm dịch vụ** (lễ tân + quản trị, quyền hẹp `invoice.cancel_service`): chọn dịch vụ kỹ thuật bác sĩ đã chỉ định mà khách bỏ, chọn lý do (danh mục mới "Lý do không làm dịch vụ", có ô ghi thêm). **Phiếu chưa thu** → gỡ dòng và trừ tiền; **phiếu đã thu** → hoàn đúng phần tiền của dịch vụ đó theo phương thức đã thu (ví trước, phần dư tiền mặt/CK), phiếu vẫn "Đã thu". Dịch vụ đã lấy mẫu/thực hiện thì không bỏ được. Dòng chỉ định không bị xoá mà chuyển "Đã huỷ" kèm lý do + người xác nhận + thời điểm: bác sĩ thấy dòng nhắc ở tab Chỉ định cận lâm sàng và khối "Đã huỷ — khách không làm"; bệnh án in có khối "Đã chỉ định nhưng không thực hiện" (bật/tắt ở Quản lý mẫu in). Dịch vụ nằm trong gói: mặc định không cho bỏ lẻ, có công tắc 3 chế độ ở Cấu hình thanh toán (không cho bỏ lẻ / bỏ lẻ tính lại theo giá lẻ / bỏ lẻ giữ nguyên giá gói). Bác sĩ lưu lại chỉ định không làm dịch vụ đã bỏ sống lại. Có migration `20261103090000_service_decline` + `db:seed` (quyền và 5 lý do mặc định); áp migration bằng `pnpm run db:deploy`.

### Kế hoạch hệ thống báo cáo + mở rộng v1 gồm báo cáo doanh thu (`docs/DECISIONS.md` #279)

Chốt khung báo cáo theo quy mô phòng khám (`docs/product/reporting-plan.md`); mockup Tổng quan (4 vai trò) đã duyệt, chưa code. Chưa có thay đổi hành vi.

## 2026-10-31

### Liên thông đơn thuốc: gạt "Có liên thông" mà chưa Lưu nay hiện hướng dẫn "Bấm Lưu trước" thay vì để trống (`docs/DECISIONS.md` #278)

Ở **Cấu hình hệ thống → Liên thông đơn thuốc**, nếu mới gạt "Có liên thông" mà chưa bấm Lưu thì các khối "Cơ sở khám chữa bệnh" và "Bác sĩ" trước đây trống trơn nên người dùng không thấy chỗ nhập mã và mật khẩu. Nay hai khối ghi rõ "Bấm Lưu trước" và câu dưới công tắc nói chưa lưu; Lưu xong, bảng nhập mã liên thông hiện ngay. Khoá nhà cung cấp phần mềm (app-name, app-key) vẫn đặt ở máy chủ, không nhập trên giao diện. Không migration.

### Nhập/Xuất Excel cho Dịch vụ kỹ thuật; báo lỗi rõ khi tải file lên (`docs/DECISIONS.md` #276)

Trang **Danh mục Cận lâm sàng → Dịch vụ kỹ thuật** có thêm nút **Xuất Excel** và **Nhập Excel**. Nhập từ file mẫu (có hướng dẫn và danh mục sẵn có): mỗi dòng một dịch vụ kèm đơn giá gốc; dịch vụ cùng Loại + Tên đã có thì bỏ qua, không ghi đè; mã dịch vụ tự cấp; tên Nhóm dịch vụ/Loại mẫu/Đơn vị tính chưa có sẽ tự tạo. Khi tải file lên, hệ thống xem trước và **báo từng lỗi kèm số dòng, tên cột và cách sửa** (ví dụ `Cột "Giá bán": bắt buộc khi làm tại phòng khám…`), báo riêng các lỗi cả file (sai mẫu, không phải .xlsx, quá 5 MB, file không có dòng dữ liệu). Sửa file xong chọn lại đúng file cũ nay được đọc lại ngay (trước đây trình duyệt bỏ qua). Hộp thoại nhập Thuốc & Vật tư dùng chung thành phần mới nên cũng được các cải tiến này. Không migration.

### Kiểm quy đổi đơn vị kho: nhập Hộp/Vỉ → tồn Viên → kê → phát đúng; chặn 3 lỗ hổng dữ liệu (`docs/DECISIONS.md` #275)

Đã kiểm đường nhập đơn vị lớn → tồn theo đơn vị nhỏ nhất → kê đơn → phát thuốc (FEFO, nhiều lô, huỷ phiếu) bằng 14 ca tự động mới: số liệu đúng. Đã chặn thêm ba chỗ dễ sai dữ liệu: (1) dòng phiếu nhập dùng đơn vị không thuộc bảng quy đổi của mặt hàng nay bị từ chối (trước đây âm thầm cộng tồn sai hệ số, ví dụ nháp nhập "Hộp" rồi bỏ "Hộp" khỏi bảng quy đổi); (2) không đổi được "Đơn vị nhỏ nhất" của mặt hàng khi còn tồn kho; (3) bảng quy đổi không được trùng đơn vị, trùng thứ tự bậc, lặp lại đơn vị nhỏ nhất, hoặc tổng quy đổi vượt 1.000.000. Không migration. Form danh mục thuốc nay báo ngay lý do khi bảng quy đổi sai và khoá nút Lưu. Nhãn "Hướng thần", "Gây nghiện", "Đông y" ở danh sách thuốc không còn bị bẻ thành hai dòng.

### Cảnh báo khi rời trang biểu mẫu còn dữ liệu nhập dở; nhãn "N trang" ở xem trước Bệnh án (`docs/DECISIONS.md` #274)

Các trang biểu mẫu dài (thêm bệnh nhân, tiếp nhận, phiếu nhập/xuất/kiểm kê/điều chuyển kho) nay hỏi lại khi bạn đã nhập dở mà bấm sang trang khác, bấm "Quay lại", đóng tab hoặc tải lại trang: hộp "Rời khỏi trang này?" có "Ở lại" và "Rời trang". Lưu thành công thì không hỏi; chưa nhập gì thì không hỏi. Xem trước mẫu in "Bệnh án" có chip "Bộ hồ sơ N trang" và đánh số "Trang 2/3/4" theo các ô tích đang bật. Sửa: người không có quyền xem công nợ nhà cung cấp (lễ tân, bác sĩ, điều dưỡng) mở chi tiết phiếu nhập kho không còn bị gọi ngầm hai API công nợ rồi nhận 403. Sửa tài liệu bị chèn nhầm mã ở `e04b7d0`. Không migration.

### Mẫu in "Bệnh án": chọn bộ hồ sơ khi in một lượt khám; hộp báo mất kết nối kiểu mới (`docs/DECISIONS.md` #272, #273)

Ở **Quản trị → Mẫu in → Bệnh án** có khối mới **"Bộ hồ sơ khi in một lượt khám"**: tờ bệnh án và "Tổng kết bệnh án" luôn in; phòng khám tích hoặc bỏ tích **Phiếu kết quả cận lâm sàng** và **Đơn thuốc** (mặc định tích cả hai như trước). Xem trước đổi ngay theo ô tích; hộp "In bộ hồ sơ"/"Xuất PDF" ở tab Hồ sơ bệnh án ghi đúng bộ sẽ in ("Tờ khám theo mẫu + 1 đơn thuốc"). Ô gợi ý tiêu đề của Bệnh án nay ghi đúng tiêu đề thật "Bệnh án ngoại trú". Hộp báo lỗi hệ thống khi mất mạng/máy chủ chưa bật/lỗi 5xx được vẽ lại: biểu tượng nền nhạt (cam cho lỗi tạm thời, đỏ cho lỗi hệ thống), một câu dẫn và ba dòng ngắn thay cho đoạn chữ dài; tiêu đề "Không kết nối được máy chủ" đổi thành "Chưa kết nối được máy chủ". Không migration.

## 2026-10-30

### Gợi ý theo cơ quan ở màn khám; ghi chú "có gì mới" ở trang Cập nhật phần mềm và bộ cài (`docs/DECISIONS.md` #271)

Ô **"Kết quả khám bộ phận"** ở màn khám có nút icon (chú thích "Gợi ý theo cơ quan", cạnh nhãn ô): bấm để chọn các cơ quan cần khám (10 cơ quan theo mẫu Nội khoa, ẩn/hiện từng cơ quan, nhớ theo tài khoản trên máy đang dùng) rồi chèn sẵn dòng tiêu đề "Tuần hoàn: ", "Hô hấp: "… vào cuối ô để bác sĩ gõ tiếp; dòng tiêu đề chưa gõ gì tự bỏ khi lưu. Ô này cao hơn (5 dòng). **Cấu hình hệ thống → Cập nhật phần mềm** có khối "Có gì mới trong bản đang chạy" (đọc ghi chú đóng kèm phần mềm, hiện cả khi chưa có máy chủ phát hành). **Trình cài đặt** khi nâng cấp hiện "Có gì mới trong bản Y" (ghi chú của bản sắp cài); gói cài có thêm thư mục `release-notes/`. Không migration.

### Hồ sơ bệnh án đổi sang mẫu MS 15/BV-01 hiện hành; "Số bệnh án" thành "Số lưu trữ" (`docs/DECISIONS.md` #270)

Chủ dự án phát hiện mã "Số bệnh án" ở #269 không đúng quy định. Tra cứu cho thấy Quyết định 4069/2001 đã hết hiệu lực từ 01/01/2024 và mẫu bệnh án ngoại trú hiện hành (MS 15/BV-01, Thông tư 32/2023/TT-BYT) có ô "Số ngoại trú" và "Số lưu trữ" chứ không có "Số bệnh án". Đã sửa: **mã hồ sơ là mã bệnh nhân `BN…`**, mỗi lần khám một phiếu khám `LK…` (cũng là "Số ngoại trú") kèm nhãn **Khám mới / Tái khám** lấy từ Loại tiếp nhận, và chỉ phát sinh thêm **Số lưu trữ** `LT2026-000042` (cấp lúc hoàn tất khám, đếm theo năm, đặt lại mỗi đầu năm, đổi được khuôn ở "Cấu hình mẫu mã phát sinh"). Tab "Hồ sơ bệnh án", bản "In bộ hồ sơ" (nay có trang "Tổng kết bệnh án") và mẫu xem trước ở Quản lý mẫu in đều theo khung mới: I Hành chính (13 mục, "Sinh ngày" và "Tuổi" là hai ô riêng), II Lý do vào viện, III Hỏi bệnh, IV Khám bệnh, rồi Tổng kết. Ô "Tiên lượng" ở màn khám đổi tên "Tình trạng người bệnh khi kết thúc khám". Đơn thuốc trong bản in hiện tên đơn vị ("14 viên") thay vì mã ("14 VIEN"). Màn Tiếp nhận không đổi. **Môi trường khác cần `db:deploy`** (migration `20261030120000_encounter_archive_no`, đổi tên cột `record_no` thành `archive_no`).

### Tab "Hồ sơ bệnh án" thành bệnh án điện tử theo mẫu Bộ Y tế: Số bệnh án, Tóm tắt/Tiên lượng, In bộ hồ sơ một lượt khám (`docs/DECISIONS.md` #269)

Tab "Hồ sơ bệnh án" ở hồ sơ bệnh nhân (trước đây "Sắp có") nay hiện bệnh án ngoại trú của TỪNG lần khám đã hoàn tất: cột trái chọn lượt khám, phiếu bên phải 10 mục I–X theo mẫu (hành chính, lý do đến khám, hỏi bệnh, khám bệnh, cận lâm sàng, tóm tắt, chẩn đoán, điều trị, tiên lượng, lời dặn), chỉ đọc, không có tiền; hai cách xem "Theo mẫu Bộ Y tế" và "Theo trường dữ liệu"; màn hẹp thu cột lượt khám thành dải ngang. Mỗi lượt hoàn tất được cấp **Số bệnh án** riêng (`BA2026-000042`, theo năm, khuôn đổi được ở "Cấu hình mẫu mã phát sinh"). Màn khám có thêm hai ô tuỳ chọn **Tóm tắt bệnh án** và **Tiên lượng**. Nút **"In bộ hồ sơ"** và **"Xuất PDF"** tạo MỘT PDF cho một lượt khám gồm tờ khám, phiếu kết quả cận lâm sàng và đơn thuốc; nút ở đầu hồ sơ đổi tên "Xuất toàn bộ bệnh án". Sửa kèm theo: bản in bệnh án PDF cũ in giờ lệch 7 tiếng (UTC) nay đúng giờ Việt Nam; lý do xuất toàn dấu cách không còn được chấp nhận. **Môi trường khác cần `db:deploy`** (2 migration: `20261029160000_clinical_note_section_summary_prognosis`, `20261029160100_encounter_record_no`). Lượt khám hoàn tất trước bản này không có Số bệnh án (hiện "—").

## 2026-10-29

### Công cụ cho nhà phát triển: vá file an toàn, bộ ca kiểm chung web–máy chủ, `pnpm dev:lan`

Không đổi hành vi sản phẩm. `scripts/patch-file.mjs` (vá file theo danh sách JSON, giữ kiểu xuống dòng và dấu `\`, kiểm hết trước khi ghi); luật xếp Loại giá được tách thành hàm thuần ở máy chủ và kiểm bằng cùng bộ ca `packages/shared/test-vectors/price-type-ranking.json` với bản web; `pnpm dev:lan` chạy giao diện dev để mở bằng IP LAN qua HTTP thường và tự trả `config.json` về như cũ khi thoát. Chủ dự án chốt các điểm lệch mockup của #266–#268 và không duyệt lớp chặn máy chủ cho dòng "Giá mới" sai mức (`docs/DECISIONS.md` #268).

### Quản lý giá: chỉ Dịch vụ khám có Loại giá; Loại giá mặc định; dịch vụ kỹ thuật một giá gốc + "Hẹn đổi giá" (`docs/DECISIONS.md` #268)

Chỉ **Dịch vụ khám** còn nhiều mức giá theo Loại giá (phòng khám tự tạo mục tuỳ ý). **Dịch vụ kỹ thuật** thu gọn về MỘT giá gốc: form chỉ còn Đơn vị tính + Đơn giá, kèm ô tích **"Hẹn đổi giá từ ngày…"** (giá mới có hiệu lực từ ngày hẹn; dòng giá hiện hành tự đóng vào hôm trước; đến ngày hẹn không cần ai làm gì, hệ thống tự lấy giá đúng ngày). Dữ liệu giá cũ nhiều mức KHÔNG mất — vẫn nằm trong CSDL, form hiện dòng "còn N mức giá cũ đã ẩn" và khi lưu giữ nguyên các mức đó. Danh mục **Loại giá dịch vụ** có cột và ô tích **"Mặc định"** (tối đa một mục/công ty): màn **Tiếp nhận** tự chọn sẵn mức mặc định khi dịch vụ khám có giá cho mức đó (không có thì để trống cho lễ tân chọn), và máy chủ dùng mức mặc định để tính tiền chỉ định cận lâm sàng cho dịch vụ nhiều mức — không còn "mức đầu tiên theo thứ tự danh mục" (kéo đổi thứ tự không còn làm đổi giá thu). Trong **Bảng giá**, dòng "Giá mới" của dịch vụ kỹ thuật hiện "Giá gốc" thay cho ô chọn Loại giá (không còn chọn sai làm dòng khuyến mại im lặng không áp). Công ty đang có Loại giá KHÔNG bị tự đánh dấu mặc định (tự tích một lần); công ty chưa có Loại giá nào được nạp sẵn "Thường" làm mặc định. **Môi trường khác cần `db:deploy`** (migration `20261029140000_reference_catalog_default_price_type`) và `db:seed`. Không đổi số tiền nào của chứng từ đã lập.

### Kê đơn theo kiểu kê của thuốc: "Khi cần" và liều theo ml (`docs/DECISIONS.md` #267, phần 2)

Dòng kê đơn dùng cấu hình "Cách kê liều" của thuốc. **"Khi cần"** (thuốc hạ sốt, thuốc dùng khi có triệu chứng): bác sĩ nhập liều mỗi lần, số lượng kê và câu dặn; không có Sáng/Trưa/Chiều/Tối và không có số ngày; số xuất kho là số lượng bác sĩ nhập (không tính từ liều). Có ô **"Soạn nhanh câu dặn"** ghép sẵn "Uống 1,5 gói khi sốt cao…, tối đa 5 lần / 24 tiếng, cách nhau tối thiểu 4 tiếng". **Dung dịch tính theo ml**: bấm liều mẫu (Người lớn, Trẻ 2–6 tuổi…) thì 4 ô tự điền, tổng ml tự quy ra số Hộp làm tròn lên ("50 ml → 01 Hộp, dư 10 ml"). Thuốc viên/gói đổi được giữa "Theo buổi" và "Khi cần" trên từng dòng; thuốc hạ sốt đặt "Khi cần" làm mặc định ở form Thuốc. Đơn thuốc mẫu, sao chép đơn lần trước và đính chính mang theo kiểu kê. Cột "Liều dùng" ở bản in đơn, bệnh án PDF, phiếu xuất kho và gói liên thông hiện "Sáng 5 ml - Tối 5 ml" hoặc "Mỗi lần 1,5 gói, khi cần". **Môi trường khác cần `db:deploy`** (migration `20261029100000_prescription_item_dose_mode`); đơn cũ không đổi nội dung nào.

## 2026-10-28

### Nhãn dán bì thuốc in từ màn Phát thuốc, số lượng hai chữ số trên đơn, cấu hình "Cách kê liều" của thuốc (`docs/DECISIONS.md` #267, phần 1)

Sau khi phát thuốc, hộp thành công hiện khối **"In nhãn thuốc"**: tích chọn từng thuốc, đặt số bản, in tem dán bì (họ tên – năm sinh, tên thuốc + số lượng thực phát, câu dặn); in lại được từ chi tiết phiếu xuất kho. Quản lý mẫu in có mẫu mới **"Nhãn thuốc"** (khổ tem 70×40 / 60×40 / 50×30 mm; tuỳ chọn thêm tên phòng khám + SĐT, ngày phát, lô và hạn dùng). Mẫu **Đơn thuốc** có ô tích "In số lượng dưới 10 bằng hai chữ số" (05 Gói, 01 Hộp — mặc định bật). Form **Thuốc** có khối "Cách kê liều": kiểu kê mặc định (theo buổi / khi cần), đơn vị liều (vd ml) kèm dung tích mỗi Hộp, bảng liều mẫu (Người lớn, Trẻ nhỏ…). **Môi trường khác cần `db:deploy`** (hai migration mới). Phần dòng kê đơn dùng cấu hình này (liều ml, "Khi cần") làm ở đợt sau.

### Đóng ca bác sĩ gắn lịch làm việc; ngày trước chưa đóng ca thì chưa được khám; công tắc tắt yêu cầu (`docs/DECISIONS.md` #266)

Nhắc đóng ca nay theo **ca đã xếp** của bác sĩ (ca cuối trong ngày), phòng khám không phân ca thì theo giờ đóng cửa như cũ. Quá giờ chỉ hiện **chip đỏ trên thanh đỉnh**, không còn hộp thoại tự bật (kể cả đăng nhập hoặc tải lại sau giờ). Bác sĩ còn **ngày trước chưa đóng ca** (có nhận lượt khám hoặc có ca đã xếp) thì phải đóng mới được "Bắt đầu khám"/"Nhận ca": giao diện hiện dải cảnh báo ở Hàng đợi khám và hộp "Đóng ca ngày trước" (một ngày hoặc nhiều ngày, một lần xác nhận); máy chủ cũng từ chối. Lễ tân/quản trị có dải "Đóng ca hộ" ở "Bệnh nhân trong ngày". Lượt khám dở của ngày cũ trả về hàng chờ chung, lượt của hôm nay không bị đụng. **Cấu hình khám → Tạm nghỉ / Đóng ca** có công tắc mới "Nhắc và bắt buộc đóng ca" (mặc định bật); tắt thì không chip nhắc, không chặn khám, không dải nhắc — cho phòng khám không có thói quen đóng ca (ví dụ chỉ 1 bác sĩ). Chỉ tính từ ngày hệ thống lần đầu được hỏi sau khi nâng cấp, không dồn ngày cũ. Không migration; chưa ghi nhận thay đổi nào ở `db:seed`.

