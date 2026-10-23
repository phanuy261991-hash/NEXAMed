# Changelog — NEXAMed

Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/). Ghi theo ngày, mới nhất ở trên.

## Các phần cũ (lưu trữ)

File này chỉ giữ thay đổi MỚI NHẤT (từ 13/10/2026). Phần cũ ở `docs/archive/` — **chỉ mở khi cần tra một mục cụ thể**:

- `docs/archive/CHANGELOG-2026-10-01-den-10-09.md` — 01/10 → 09/10/2026
- `docs/archive/CHANGELOG-2026-09.md` — tháng 09/2026
- `docs/archive/CHANGELOG-2026-08.md` — tháng 08/2026 (từ 07/08)

**Quy ước**: ghi thay đổi mới vào ĐẦU file này (mới nhất ở trên). Khi file này vượt ~120 KB thì chuyển các ngày cũ nhất sang `docs/archive/CHANGELOG-<kỳ>.md` mới và thêm liên kết ở đây (xem `CLAUDE.md`, mục "Quy ước tài liệu dài").

## 2026-10-23

### Giới hạn đăng nhập không còn chỉ theo IP + khoá tài khoản thông minh theo "máy quen" (`docs/DECISIONS.md` #258, #259)

Đo thật bằng một máy khác trong LAN: trên PC Windows chạy Docker Desktop, API thấy MỌI máy trạm là cùng một IP (cổng mạng Docker), nên giới hạn theo IP bị cả phòng khám dùng chung. Nay: đăng nhập giới hạn theo TÀI KHOẢN (10 lần/phút) cộng trần IP rộng hơn (SaaS 30, một công ty 60, chỉnh bằng `LOGIN_IP_LIMIT_PER_MINUTE`); tra cứu bệnh nhân và xin quyền khẩn cấp theo NGƯỜI DÙNG. Kèm theo, xử lý lỗ hổng "người khác gõ sai mật khẩu nhiều lần để khoá vĩnh viễn tài khoản của bạn": trình duyệt đã đăng nhập đúng được nhận là **máy quen** (cookie ký, gắn với mật khẩu hiện tại) — khoá do máy lạ gây ra chỉ chặn máy lạ, máy quen vẫn vào được và đăng nhập đúng thì gỡ khoá; máy quen gõ sai 10 lần chỉ bị khoá tạm 15 phút, không bao giờ vĩnh viễn. Migration `20261023110000_user_account_familiar_lockout` (**môi trường khác cần `db:deploy`**). Chưa ai có cookie nên hành vi giống cũ cho tới khi mỗi người đăng nhập đúng một lần. Test: core +14, API +33, đột biến đều bị bắt.

### Khoá chống ghi trùng + kiểm toàn bộ app cho mô hình on-prem LAN HTTP; sửa lỗi Kê đơn/Phát thuốc ở HTTP LAN (`docs/DECISIONS.md` #257)

Chủ dự án chọn phương án A của #256: mọi thao tác ghi dạng POST từ giao diện tự mang `Idempotency-Key`; mạng đứt đúng lúc máy chủ vừa ghi xong rồi bấm lại không còn ghi trùng (Tiếp nhận, phiếu thu/chi, nạp ví, thanh toán NCC một phần, phát thuốc một phần, đính chính chẩn đoán...) — máy chủ trả lại đúng kết quả lần đầu. Chi phí khoảng +10 ms mỗi lần ghi (đo p95 cả luồng khám 50 → 60 ms, 0 lỗi). Bảng mới `idempotency_key` (migration `20261023100000`, **môi trường khác cần `db:deploy`**; phản hồi lưu mã hoá, tự dọn sau 24 giờ). Hộp thông báo mất mạng nay cho phép "bấm thử lại". **Kiểm toàn bộ app cho on-prem LAN (HTTP thường, truy cập qua IP)** theo yêu cầu của chủ dự án, trên stack Docker thật: **tìm ra và sửa một lỗi thật** — `crypto.randomUUID` không tồn tại ở HTTP LAN làm hỏng chọn thuốc ở Đơn thuốc mẫu, Kê đơn và Phát thuốc theo lô (dev chạy `localhost` nên không thấy); nay dùng hàm chung `generateUuid()` và ESLint chặn tái phạm; kịch bản mới `scripts/ui-audit/lan-http-check.cjs`. Phần còn lại ĐẠT (không tài nguyên ngoài, cookie/apiBaseUrl/proxy đúng, tải ảnh, PDF, Excel, tắt/bật API, 47 route). **Còn mở, chờ quyết**: trên Docker Desktop (PC Windows) mọi máy trạm cùng một IP nguồn nên giới hạn tần suất theo IP bị cả phòng khám dùng chung. Quy tắc thường trực mới ở CLAUDE.md: mã mới phải chạy được ở LAN HTTP.

### Quét chống ghi trùng khi mạng đứt giữa chừng + sửa CI đỏ test PDF (`docs/DECISIONS.md` #256)

CI GitHub đỏ ở hai commit làm #255 (`8e96b85`, `c352294`) chỉ vì MỘT test xuất bệnh án PDF quá 30 giây: không có thay đổi API nào giữa lần xanh và lần đỏ, commit chỉ sửa tài liệu cùng mã nguồn lại xanh — lỗi chập chờn do Chromium khởi động nguội trên runner đang tải nặng (đo 9,8 / 22,6 / 30+ giây); đã làm nóng trình duyệt trước nhóm test đó, CI xanh trở lại (`1025481`). Quét chống ghi trùng: thêm 21 ca test HTTP (7 ca khâu cận lâm sàng + 14 ca có "GỬI TRÙNG (#256)" trong tên) đo bấm lại và bấm đồng thời ở khâu nhập kết quả cận lâm sàng, nạp ví, phiếu thu/chi, thanh toán NCC, phát thuốc, Tiếp nhận, đính chính chẩn đoán, chỉ định CLS, bệnh nhân, sinh hiệu, phiếu nhập nháp. Kết luận: thao tác có `version`/`PUT`/ràng buộc duy nhất thì an toàn (kể cả đồng thời); thao tác tạo mới không có khoá tự nhiên (Tiếp nhận, phiếu thu/chi, nạp ví, thanh toán NCC một phần, phát thuốc một phần…) ghi trùng. Không đổi hành vi hệ thống. Đề xuất `Idempotency-Key` chung đang chờ chủ dự án chọn.

### Mọi lỗi trên ứng dụng đều hiện thông báo tiếng Việt cụ thể, không lộ mã/lỗi thô; khảo sát mất kết nối (`docs/DECISIONS.md` #255, #256)

Làm hết #255: lỗi điều hướng → màn toàn trang (trang "không mở được" thay trang kiểu 404, màn lỗi toàn cục, khung báo tĩnh khi mã khởi động hỏng thay màn hình trắng); lỗi hệ thống khi đang thao tác (mất mạng, máy chủ chưa bật, 5xx) → hộp thông báo, dữ liệu đang nhập còn nguyên; thông điệp lỗi từ máy chủ luôn được kiểm tra theo mã HTTP, câu tiếng Anh/kỹ thuật bị thay bằng câu tiếng Việt; hết phiên đăng nhập có lời giải thích. Máy chủ web (nginx) và Caddy trả thông báo tiếng Việt khi máy chủ ứng dụng chưa lên. **Sửa một lỗi có sẵn**: nginx chặn tải lên tệp > 1 MB bằng trang HTML thô dù API cho phép tới 5 MB — nay 8 MB (máy khách cần cập nhật ảnh web mới). Khảo sát mất kết nối (#256): CSDL không mất giao dịch đã báo xong khi sập đột ngột (đo 53/53); thu tiền và tạo bệnh nhân có CCCD an toàn khi bấm lại, **Tiếp nhận bấm hai lần ra hai lượt khám** — đề xuất chống ghi trùng đang chờ duyệt. Web 301 test, Chrome thật 15/15 và quét 47/47 route.

### CI GitHub đỏ từ #245 đã được sửa; quy tắc mới về lỗi giao diện (`docs/DECISIONS.md` #254, #255)

CI GitHub đỏ ở mọi commit trên `master` từ 22/10/2026 (không liên quan Node 26): (1) bảng `tenant_code_alias` thiếu miễn trừ `tenant_id` trong bước kiểm schema; (2) trình cài đặt trả 413 sai cách (đóng kết nối trước khi gửi phản hồi) làm một test chập chờn trên máy chậm — đã tái hiện được ở cả Node 20 lẫn Node 26 và đã sửa (15/15 lần dưới 0,5 CPU). Quy tắc mới (chủ dự án chốt, #255): MỌI lỗi trên ứng dụng (không chỉ 404) phải dẫn về một màn thông báo cụ thể, không lộ mã hay lỗi thô. **Đã làm màn lỗi toàn cục**: ngoại lệ không lường trước khi hiển thị giao diện, phần mềm vừa cập nhật làm hỏng việc tải mã, và lỗi lúc khởi động nay đều hiện một màn tiếng Việt có nút "Tải lại trang" / "Về trang chủ" thay cho màn lỗi mặc định của thư viện hoặc trang trắng; lỗi ở một trang chỉ thay vùng nội dung, thanh bên còn nguyên; không còn hiện thông điệp lỗi thô lúc khởi động. Đã kiểm Chrome thật 19/19. Còn lại: thay trang "Không tìm thấy trang", hộp thông báo giữ dữ liệu cho lỗi thao tác, hết phiên, trang lỗi nginx.

### Nâng runtime Node 20 → Node 26 (`docs/DECISIONS.md` #253)

Node 20 đã hết hỗ trợ bảo mật (30/04/2026); dự án chuyển sang **Node 26** (LTS từ 28/10/2026, hỗ trợ đến 30/04/2029). Chỉ đổi cấu hình/công cụ/tài liệu (Dockerfile, `engines`, CI, `@types/node`, CLAUDE.md, hướng dẫn triển khai); không sửa mã nghiệp vụ. Ảnh Node 26 không còn `corepack` nên Dockerfile cài pnpm bằng `npm install -g pnpm@9.15.9`. Máy khách vẫn chỉ cần Docker (Node nằm trong ảnh). Đã kiểm: typecheck/lint/build, `pnpm audit` 0 cảnh báo, test API 1687/1687 ba lượt liên tiếp trên máy dev và một lượt trên Linux sạch, và **diễn tập nâng cấp bằng Docker thật 23/23 đạt** (dữ liệu, mật khẩu băm, CCCD mã hoá, xuất PDF, trình cài đặt đều giữ nguyên/hoạt động). Quy ước mới: không dùng Temporal/API V8 mới (không cần nâng TypeScript). **Môi trường khác**: `pnpm install`, dùng Node 26.

## 2026-10-22

### Nâng vitest 2 → 4 (hết 28 cảnh báo thư viện dev), HSTS cho bản HTTPS, sửa test chập chờn (`docs/DECISIONS.md` #252)

`pnpm audit` đầy đủ nay **0 cảnh báo** (trước 28, chỉ ở công cụ phát triển): nâng vitest 2 → 4.1.12 (web lên Vite 6.4.5 theo) và vá thư viện con bằng `pnpm.overrides`. Đã kiểm kỹ tác động: thêm `@types/node` cho core/web, loại `dist` khỏi vitest, và **tắt job nền khi test API** (nguyên nhân test liên thông đơn thuốc chập chờn — job quét mọi công ty tranh dòng với test song song). Xanh: typecheck, build, lint sạch hoàn toàn, test shared 96 / core 528 / web 248 / setup 77, API 1687 chạy **3 lượt liên tiếp đều xanh**; Chrome thật 53 trang × 10 cỡ = 0 vấn đề, độ đậm chữ tối đa 600. Bản HTTPS (VPS/SaaS) nay gửi `Strict-Transport-Security` 180 ngày (chưa `includeSubDomains`/preload) — chỉ có hiệu lực khi cài/nâng cấp bằng `nexamed-setup` mới. Công cụ: lệnh `script:run` chạy script cần DI của Nest, luật ESLint chặn import giá trị từ shared ở web, hướng dẫn đo tải ghi trên công ty thử dùng một lần. Không đổi chức năng, không migration. **Môi trường khác**: `pnpm install`. Đã dựng thử ảnh Docker web/API và mô phỏng CI trên Node 20 sạch: đều đạt (API 1687/1687). `docs/DECISIONS.md` vượt ngưỡng nên #230–#241 đã chuyển sang `docs/archive/DECISIONS-230-241.md`. Đang cân nhắc nâng Node 20 (đã hết hỗ trợ bảo mật) lên 24 hoặc 26 — xem phân tích cuối #252, chưa quyết.

### Kiểm lại thư viện và thử qua proxy HTTPS (`docs/DECISIONS.md` #252)

`pnpm audit --prod` vẫn **0 cảnh báo** (phần chạy thật). Dựng thử chuỗi giống bản SaaS thật (Caddy HTTPS wildcard → nginx của gói cài → API chạy `DEPLOYMENT_MODE=saas`, `TRUST_PROXY_HOPS=2`) trên máy dev: nhận đúng công ty theo tên miền phụ, cookie làm mới `HttpOnly; Secure; SameSite=Lax`, token/cookie của công ty này bị từ chối ở tên miền công ty khác, giả mạo `X-Forwarded-For` không né được giới hạn đăng nhập và không đổi được IP ghi vào phiên: 14/14 đạt. Phát hiện: thiếu tiêu đề `Strict-Transport-Security` ở bản HTTPS (đã xử lý, xem mục trên).

### "Bệnh nhân trong ngày" và "Thu ngân" cuộn tới đâu tải tới đó (`docs/DECISIONS.md` #251)

Hai danh sách trong ngày nay tải 50 dòng một lần và tự tải tiếp khi cuộn gần cuối, thay vì tải cả ngày: ngày đông bệnh nhân (hơn 1.000 lượt) vẫn mở nhanh. Thẻ KPI, số trên các tab và dải tổng kết cuối trang Thu ngân luôn là số của CẢ NGÀY; tìm kiếm chạy trên cả ngày (không chỉ phần đã tải). Chân bảng ghi "Đang hiển thị 50 / 1.203 dòng", báo đang tải, tải lỗi (có nút "Thử lại", dòng đã có vẫn giữ nguyên) và "Đã hiển thị hết". Ô chọn đầu cột chỉ chọn các dòng đã tải. Hàng đợi khám của bác sĩ, form Tiếp nhận và xuất Excel không đổi. Không migration.

### Tăng tốc Danh sách tiếp nhận và Thu ngân khi một ngày có hơn 1.000 lượt khám (`docs/DECISIONS.md` #250)

Hai màn danh sách trong ngày chậm lên 300–560 ms khi có ~1.200 lượt khám/ngày. Nguyên nhân là cách truy vấn (nạp quan hệ lồng và gửi danh sách ~1.200 mã), không phải dữ liệu: nay mỗi màn dùng vài câu SQL gọn theo khoảng ngày. Đo lại cùng dữ liệu: Danh sách tiếp nhận p95 313 → 80 ms, Thu ngân 560 → 75 ms. Giao diện và dữ liệu trả về không đổi (đã so 135 phản hồi 45 ngày trên dữ liệu thật: giống hệt, trừ thứ tự các phiếu của cùng một lượt khám nay cố định: phiếu dịch vụ trước). Không migration.

### Nâng NestJS 10 → 11 (`docs/DECISIONS.md` #249)

Lên NestJS 11 / Express 5 để hết nốt các cảnh báo thư viện của phần chạy thật: `pnpm audit --prod` nay **0 cảnh báo** (trước đợt vá hôm nay: 1 nghiêm trọng, 11 cao, 13 trung bình). Phải sửa cú pháp đường dẫn của middleware tenant và bộ lọc lỗi (thân yêu cầu quá lớn từng trả 500 thay vì 413 — tìm ra khi kiểm thực tế 39 mục trên API chạy thật, đã có test hồi quy). Toàn bộ test xanh, đo tải đọc/ghi sau nâng không chậm hơn (ghi p95 65 ms, 0 lỗi). Đo argon2: chủ dự án đã chốt GIỮ NGUYÊN tham số hiện tại. **Môi trường khác**: `pnpm install` rồi dựng lại API.

### Hộp thoại "Đổi mã tên miền" làm lại theo mockup đã duyệt (`docs/DECISIONS.md` #245)

Khu quản trị SaaS: hộp thoại dùng khuôn chung (biểu tượng + tên hành động + tên công ty + nút đóng), các dòng mã hiện tại / địa chỉ hiện tại có đường kẻ, ba gạch đầu dòng hậu quả thành bảng "Sau khi đổi", màn kết quả có biểu tượng xanh lá (`ModalHeader` thêm `tone="success"`). Hành vi không đổi. Mockup: https://claude.ai/artifact/KAAFi6LDmcdHgjCQSLDCtC.

### Đo lại tải sau vá thư viện + đo tải luồng ghi (`docs/DECISIONS.md` #248)

Đo lại tải đọc sau bản vá thư viện: p95 59 ms (trước 58 ms), 0 lỗi. Công cụ mới `perf:load:write` đo cả LUỒNG GHI (10 bác sĩ ảo, mỗi lượt tạo bệnh nhân → tiếp nhận → thu tiền → khám → kê đơn → ký → hoàn tất): 223/223 lượt thành công, p95 65 ms, 0 lỗi. Đo trộn đọc + ghi cùng lúc: ghi vẫn p95 66 ms, 0 lỗi; hai danh sách trong ngày chậm lên (p95 300–400 ms) vì tenant thử đã có hơn 1.000 lượt khám hôm nay. Khi đo tìm ra và ĐÃ SỬA 2 lỗi thật làm hỏng ký đơn: (1) khuôn mã đơn thuốc tuỳ chỉnh có `[Mã cơ sở KCB]` — mọi lần ký lỗi 400, nay ký được (hoặc báo rõ thiếu mã cơ sở KCB); (2) lưu khuôn mã giữa tháng làm bộ đếm trùng mã đã cấp → lỗi 500 kẹt mãi, nay bộ đếm kỳ mới nối tiếp số đã cấp. Có test hồi quy. Xem `docs/DECISIONS.md` #248.

### Vá thư viện phụ thuộc có lỗ hổng (`docs/DECISIONS.md` #247)

Quét `pnpm audit`: phần chạy thật có 12 cảnh báo cao/nghiêm trọng (chủ yếu `multer` — tấn công làm treo khi tải tệp, `proxy-addr`, `lodash`, `brace-expansion`). Đã nâng các thư viện này lên bản đã vá bằng `pnpm.overrides`; toàn bộ test xanh. Còn 4 cảnh báo mức trung bình chỉ hết khi nâng NestJS 10 → 11 (đang làm). Không đổi chức năng, không migration. Môi trường khác: `pnpm install` rồi dựng lại.

### Nét chữ giá trị trong MỌI ô nhập: 600 → 400 (`docs/DECISIONS.md` #246)

Chủ dự án thấy chữ gõ vào ô nhập "đậm, vỡ nét" (Windows không có bậc 500 nên 600 làm dấu tiếng Việt dính). Nay giá trị trong mọi ô nhập (ô văn bản, ô chọn, ô ngày/giờ/tiền, mật khẩu, ô nhiều dòng, ô chỉ-đọc) dùng nét thường 400, mảnh và sắc hơn; nhãn trường vẫn đậm để phân cấp. Làm bằng một luật chung ở `index.css` (ô viết sau này tự đúng) và dọn ~140 chỗ ở 86 file cho mã khớp thực tế. Sửa `ui-guidelines.md` mục 4.1c/16; bộ kiểm `weight-audit` thêm vai trò ô nhập (đo thật: 270 ô đều 400). Chỉ đổi giao diện web; không migration, không đổi API. Cùng ngày: sửa tài liệu `CURRENT.md` (ngày cập nhật, mục bàn giao trùng, câu lặp ở phần bảo mật).

### Khu quản trị SaaS: mã OTP chỉ dùng một lần + đổi mã tên miền công ty (`docs/DECISIONS.md` #245)

**Mã OTP** của người vận hành nền tảng nay chỉ dùng được đúng một lần: mã bị lộ (lừa đảo, nhìn trộm) không còn dùng lại được trong ~90 giây như trước; mã dùng lại bị từ chối như mã sai và ghi nhật ký. **Đổi mã tên miền công ty** (trước đây khoá cứng): người vận hành vào chi tiết công ty → "Đổi mã tên miền" → nhập mã mới + lý do. Hệ thống giữ địa chỉ cũ tự chuyển sang địa chỉ mới trong 90 ngày, không cấp lại mã cũ cho công ty khác, đăng xuất mọi nhân viên của công ty đó (đăng nhập lại ở địa chỉ mới, mật khẩu không đổi), ghi nhật ký. Cơ sở dữ liệu vẫn chặn mọi cách đổi mã khác. Tên phòng khám thì khách tự đổi như cũ. Cũng sửa: lịch sử khám của mã bệnh nhân công ty khác nay báo 404 thay vì danh sách rỗng (đồng bộ với các màn khác). **Môi trường khác**: `db:deploy` (2 migration `20261021150000_platform_operator_totp_step`, `20261021160000_tenant_code_change`) + khởi động lại API.

## 2026-10-21

### Sửa 2 lỗi nghiêm trọng về đăng nhập đồng thời và chặn chéo công ty, dọn phiên cũ (`docs/DECISIONS.md` #244)

**Đăng nhập khi đông người**: trước đây 100 người đăng nhập cùng lúc làm hỏng 64-81 lượt (lỗi máy chủ), vì mỗi lượt giữ một kết nối cơ sở dữ liệu suốt lúc kiểm mật khẩu. Nay kiểm mật khẩu tách khỏi phần ghi dữ liệu: 100 người cùng lúc không lỗi; 8 công ty × 40 tài khoản (320 lượt) cũng không lỗi. **Chặn chéo công ty (SaaS)**: trước đây một công ty gõ sai mật khẩu 10 lần là mọi công ty khác không đăng nhập được; nay hạn mức tính riêng theo từng công ty, và có cấu hình `TRUST_PROXY_HOPS` để máy chủ đọc đúng địa chỉ máy trạm qua proxy (trình cài đặt tự điền; nhật ký cũng ghi đúng địa chỉ). **Phiên đăng nhập**: giữ tối đa 5 phiên mỗi tài khoản (quá thì phiên cũ nhất tự đăng xuất), hạn phiên giảm từ 30 ngày xuống 7 ngày, và job nền 2h15 sáng dọn phiên đã hết hạn quá 7 ngày (trên máy dev: 53% số dòng là phiên hết hạn chưa dọn). **Đo hiệu năng toàn ứng dụng**: đạt — p95 58 ms so với ngưỡng 500 ms, không lỗi. **Job dọn dẹp không còn hẹn giờ ban đêm** (chủ dự án chỉ ra): máy tính phòng khám tắt buổi tối nên lịch 2 giờ sáng chưa từng chạy — kể cả job dọn nhật ký hệ thống có từ trước. Nay cả hai chạy ít phút sau khi bật máy rồi lặp lại trong ngày. **Môi trường khác**: `db:deploy` (migration `20261021140000_user_session_purge_grant`) + khởi động lại API; bản on-prem/VPS/SaaS nên đặt `TRUST_PROXY_HOPS` (1 nếu chỉ có nginx, 2 nếu có thêm Caddy).

### Tiếp nhận: thêm thẻ BHYT ngay cho hồ sơ bệnh nhân MỚI (`docs/DECISIONS.md` #243 bổ sung 4)

Tiếp nhận bệnh nhân chưa có hồ sơ: khối "Thẻ bảo hiểm y tế" có nút "Thêm thẻ" (gợi ý điền số CCCD). Thẻ được giữ trong form dưới dạng thẻ nháp; bấm "Lưu tiếp nhận" thì hệ thống tạo hồ sơ → tạo thẻ (kèm ảnh nếu có) → tiếp nhận với đúng thẻ đó. Không thêm thẻ thì lượt khám ghi tự chi trả như cũ. Chủ dự án xác nhận số thẻ mới là 12 chữ số theo quy định mới nhất (trùng số CCCD) nên không cần hỏi đơn vị vận hành về độ dài. Chỉ đổi web; không migration, không đổi API.

### Thẻ BHYT (S2-04): hoàn tất phần web (`docs/DECISIONS.md` #243 bổ sung 2)

Quản lý mẫu in có ô tích "Số thẻ BHYT" (đơn thuốc cạnh CCCD, phiếu thu và bệnh án PDF có khối riêng; chọn "Ẩn cả dòng"/"In Tự chi trả" khi tự chi trả; khoá mờ khi công tắc tổng tắt). Tiếp nhận có khối "Thẻ bảo hiểm y tế" (thẻ gợi ý chọn sẵn, đổi thẻ, "Không dùng thẻ", "Thêm thẻ mới", dải hổ phách khi thẻ hết hạn/chưa hiệu lực). Nhãn "BHYT 80%"/"Tự chi trả" ở danh sách tiếp nhận, hàng đợi khám, đầu màn khám (kèm số thẻ); chi tiết lượt khám cũ có khung "Thẻ BHYT lúc khám — Đã chụp, không đổi". Công tắc tắt thì tất cả ẩn. Sửa luôn: nút "Xem" ở bảng Lịch sử khám sát mép (cột Thao tác 90→112px, "Tổng chi phí" 130→150px). Không migration, không đổi API. Kiểm đột biến backend: bổ sung 3 test (thẻ chưa hiệu lực, mã băm số thẻ khác mã băm CCCD, nhật ký không ghi số thẻ) — spec thẻ BHYT nay 27 ca. Câu hỏi 19 gửi đơn vị vận hành cổng đã cập nhật (thẻ mới 12 số/thẻ cũ 15 ký tự).

### Thẻ bảo hiểm y tế (S2-04): backend xong, web làm dở (`docs/DECISIONS.md` #243)

Mockup đã chốt (https://claude.ai/artifact/FAi8GCjycj94s6EwTT9t6b). **Công tắc "Áp dụng BHYT"** (Cấu hình phòng khám → "Thẻ BHYT", chung cả công ty, mặc định TẮT vì nhiều phòng khám không dùng BHYT): tắt thì ẩn hết, máy chủ chặn thêm/sửa thẻ (409), lượt khám mới ghi tự chi trả như cũ. Bật thì hồ sơ bệnh nhân có khung "Thẻ bảo hiểm y tế" (nhiều thẻ, số thẻ **12 chữ số = thẻ mới / 15 ký tự chữ+số = thẻ cũ**, tự nhận diện, sai định dạng chỉ cảnh báo mềm; hiệu lực để trống = "chưa rõ hạn"; nơi đăng ký KCB; mức hưởng; ảnh thẻ 2 mặt; gợi ý điền số CCCD), Tiếp nhận chụp thẻ vào lượt khám (số thẻ mã hoá), tìm bệnh nhân theo số thẻ, gộp hồ sơ chuyển thẻ, và ba ô tích in "Số thẻ BHYT" (đơn thuốc, phiếu thu, bệnh án PDF, mặc định tắt). Liên thông đơn thuốc chỉ gửi thẻ mới 12 số (code đổi từ 10 sang 12; tài liệu cổng ghi 10 → hỏi đơn vị vận hành). Bỏ ô "Số bảo hiểm" cũ khỏi form bệnh nhân. **Còn làm dở ở web**: khối chọn thẻ ở Tiếp nhận, nhãn BHYT ở hàng đợi/màn khám/lịch sử khám, ô tích ở Quản lý mẫu in, kiểm Chrome thật — xem `docs/handoffs/HANDOFF-TheBHYT-S204-2026-10-21.md`. **Môi trường khác**: `db:deploy` (migration `20261021120000_insurance_card`) + khởi động lại API; không có quyền mới nên không cần `db:seed`.
### Sửa lỗi cả trang cuộn dọc ở tab Kê đơn thuốc (`docs/DECISIONS.md` #240 bổ sung 4)

Ở màn khám, tab **Kê đơn thuốc** của lượt khám đã có đơn làm CẢ TRANG cuộn dọc dài hơn cửa sổ (đo 1051–1229 px so với 1000 px): trang có thêm một lớp cuộn ngoài thừa. Nguyên nhân: nhãn ẩn (`sr-only`, `position: absolute`) của ô nhập "Lời dặn của bác sĩ" nằm trong vùng cuộn nội bộ nhưng không có tổ tiên `relative`, nên neo vào khung gốc của trang và không bị vùng cuộn cắt. Đã sửa ở gốc trong hai thành phần dùng chung (`Textarea` có `hideLabel`, `CheckTile`: thêm `relative`) và thêm kiểm tra "cuộn dọc cả trang" vào `scripts/ui-audit/layout-audit.cjs`. Đã đo lại bằng Chrome thật: 34 lượt khám × 5 tab đều vừa khít cửa sổ; bộ kiểm toàn app (53 trang × 10 cỡ) 0 vấn đề, kể cả kiểm tra mới. Không migration, không đổi API.

## 2026-10-20

### Liên thông đơn thuốc: ô bổ sung, dải kiểm, hàng chờ gửi và bộ gửi nền (`docs/DECISIONS.md` #242 bổ sung 17)

Khi bật "Có liên thông", tab **Kê đơn** có khối **"Thông tin liên thông đơn thuốc quốc gia"**: hình thức điều trị (đơn C), đợt dùng thuốc tự điền (đơn N/H/Y), số thang + cách sắc/uống (đơn Y), người giám hộ của trẻ dưới 72 tháng (lưu ngược vào hồ sơ bệnh nhân) và dải "Còn thiếu: …" (cảnh báo mềm, vẫn ký/in được). Các ô lưu riêng, sửa được tới khi đơn được gửi, có nhật ký (chỉ ghi tên ô). Ký đơn xếp mỗi đơn pháp lý vào **hàng chờ gửi**; trang **"Đơn thuốc liên thông"** (menu **Quản trị**, dưới "Mẫu in") hiện mã đơn, bác sĩ ký, dữ liệu đủ/thiếu, trạng thái Chờ gửi/Đã gửi/Lỗi/Đính chính chưa gửi, "Gửi ngay", "Gửi lại" và lỗi cổng nguyên văn. Bộ gửi nền mỗi phút (chỉ khi bật "Gửi đơn lên cổng"): lỗi dữ liệu dừng chờ sửa, lỗi mạng thử lại giãn dần 1/5/15/60 phút. Danh mục mới **"Hình thức điều trị"** ở Danh mục dùng chung (mã số do Bộ Y tế ban hành, nhập tay, chưa có dữ liệu sẵn). Tắt "Có liên thông" thì ẩn hết các phần trên. **Chưa kiểm với cổng thật.** **Môi trường khác**: `db:deploy` (2 migration `20261021090000_…`, `20261021100000_…`) + khởi động lại API; không có quyền mới nên không cần `db:seed`.

### Liên thông đơn thuốc quốc gia: trang cấu hình + khung kết nối (`docs/DECISIONS.md` #242 bổ sung 16)

Cấu hình hệ thống có pill mới **"Liên thông đơn thuốc"**: công tắc "Có liên thông" (mặc định tắt), địa chỉ cổng, "Gửi đơn lên cổng", thông số nâng cao, **"Kiểm tra kết nối"**, bảng cơ sở theo chi nhánh (mã + mật khẩu liên thông, token, trạng thái, "Đăng nhập lại"), bảng bác sĩ ("Trên cổng", token, "Thêm vào cơ sở"/"Xoá khỏi cơ sở") và trạng thái khoá nhà cung cấp phần mềm. Mật khẩu và token lưu mã hoá, không hiện lại, không vào nhật ký. Đã dựng đủ khung gọi cổng theo tài liệu QĐ 808 nhưng **chưa kiểm với cổng thật** (chưa có môi trường thử); việc gửi đơn lên cổng chưa có. **Môi trường khác**: `db:deploy` (2 migration `20261020110000_…`, `20261020120000_…`) + khởi động lại API; biến môi trường mới tuỳ chọn `INTEROP_APP_NAME`/`INTEROP_APP_KEY`. Đã soạn danh sách 26 câu hỏi gửi đơn vị vận hành cổng (`docs/product/prescription-interop-questions.md`).

### Đơn thuốc cổ truyền (loại Y) in tiêu đề "Đơn thuốc" (`docs/DECISIONS.md` #242 bổ sung 15)

Tờ in đơn loại Y nay có tiêu đề "Đơn thuốc" (như đơn thường) thay vì "Đơn thuốc y học cổ truyền". Không migration.

### Nhật ký riêng khi in đơn thuốc kèm số CCCD (`docs/DECISIONS.md` #242 bổ sung 14)

Mỗi lần in đơn thuốc mà số CCCD bệnh nhân thật sự được giải mã để in, nhật ký hoạt động có thêm dòng "In đơn thuốc có số CCCD bệnh nhân" (không chứa số CCCD). Lần in không có CCCD (không có quyền xem hồ sơ bệnh nhân hoặc bệnh nhân chưa có CCCD) chỉ có dòng xem chung như cũ. Không migration.

### Rà soát giao diện: sửa 5 trang tablet, kiểm bằng mắt các hộp xác nhận và màn kê đơn (`docs/DECISIONS.md` #240 bổ sung 3)

Bộ kiểm toàn app (53 trang × 10 cỡ) lúc đầu còn 5 chỗ chữ bị cắt ở máy tính bảng, nay **0 vấn đề**. Danh sách bệnh nhân và các bảng ở chi tiết nhà cung cấp cuộn ngang thay vì ép cột; Báo cáo dòng tiền xếp hai bảng dọc dưới 1280px; Mẫu in cuộn ngang thay vì ép khung xem trước; Hàng đợi khám cuộn ngang 3 cột; thanh trên cùng cắt bớt câu chào (không còn che avatar). Độ đậm chữ đo lại: tối đa 600, không chỗ nào ≥700. Đã nhìn bằng Chrome thật: hộp Hoàn tiền, Nạp & thu ngay, Tất toán ví, Huỷ đính chính cận lâm sàng, 3 hộp ở Tiếp nhận, "Sửa đơn" với liều lẻ (½ → "4,5 làm tròn lên"), chế độ Chặn kê liều lẻ (khung đỏ, nút Ký đơn bị khoá) và "Mẫu lời dặn". Không migration, không đổi API.

### Mã đơn thuốc theo Bộ Y tế — giai đoạn 1 và 2 (`docs/DECISIONS.md` #242)

**Giai đoạn 1 (đã kiểm)**: mỗi chi nhánh có **mã cơ sở khám chữa bệnh 5 chữ số** (ô mới ở "Sửa chi nhánh", cột "Mã KCB" ở danh sách; "Thông tin phòng khám" nhắc nhập đúng 5 chữ số). "Cấu hình mẫu mã phát sinh" của Đơn thuốc có chế độ **"Chuẩn Bộ Y tế"** (mã 14 ký tự `xxxxxyyyyyyy-z`, khuôn khoá, bộ đếm 7 chữ số chung bốn loại đơn theo cơ sở, không đánh số lại); không bật được khi còn chi nhánh chưa có mã; tắt lại được (có xác nhận), đơn đã cấp giữ mã chuẩn. **Giai đoạn 2 (đã kiểm test + Chrome thật 20/10)**: cờ **"Đông y"** ở danh mục thuốc (cả nhập/xuất Excel), trang **"Loại đơn thuốc"** (bảng ánh xạ loại thuốc → loại đơn C/N/H/Y), kê đơn hiện chữ cái loại đơn từng dòng và dải "Khi ký, đơn này tách thành N đơn", ký tách thành các **đơn pháp lý** mỗi đơn một mã chuẩn, đính chính giữ mã, in mỗi đơn một tờ kèm mã vạch (in từng tờ hoặc tất cả), "Phát thuốc" nhóm dòng theo đơn. Đơn ký trước ngày bật chế độ chuẩn giữ mã cũ, không cấp hồi tố. Mặc định chế độ chuẩn TẮT nên phòng khám hiện có không đổi gì. **Sửa lỗi phát hiện khi kiểm**: bật chế độ chuẩn ở phòng khám đã có đơn ký làm bộ đếm mã nội bộ DT đếm lại từ 1 và trùng mã cũ (ký đơn lỗi 500) — nay bộ đếm giữ liên tục (`docs/DECISIONS.md` #242 bổ sung 8). **Môi trường khác**: `db:deploy` (2 migration `20261020090000_branch_facility_code`, `20261020100000_prescription_document`) + khởi động lại API; chưa có `db:seed` mới.

### Mẫu in đơn thuốc: thông tin bệnh nhân + mục đơn N/H bật/tắt được; sửa lỗi kế thừa khổ giấy (`docs/DECISIONS.md` #242 bổ sung 12)

"Quản lý mẫu in" → Đơn thuốc có thêm hai khối công tắc: "Thông tin bệnh nhân — mọi loại đơn" (mã BN, số CCCD, địa chỉ, SĐT, cân nặng, người giám hộ trẻ dưới 72 tháng) và "Mục riêng của đơn “N” và “H”" (đợt, số lượng viết bằng chữ, ô người nhận thuốc), xem trước có 4 tab (đơn thường, N, H, trẻ nhỏ). Bản in lấy CCCD giải mã chỉ khi người in có quyền xem hồ sơ bệnh nhân. **Sửa lỗi**: ô chữ ký của chứng từ nhiều khổ giấy không áp khi in ra khổ khác khổ mặc định; "Thiết lập nhanh" mất các chỉnh sửa khi đổi khổ. Không migration.

### Mã đơn chuẩn ở lịch sử khám, PDF bệnh án, phiếu xuất kho; tiêu đề đơn N/H (`docs/DECISIONS.md` #242 bổ sung 11)

Mã đơn thuốc chuẩn Bộ Y tế nay hiện ở tab "Lịch sử khám" và hộp chi tiết lượt khám cũ, PDF bệnh án (dòng "Mã đơn") và phiếu xuất kho (chi tiết, danh sách, bản in "Theo đơn …"); đơn cũ vẫn hiện mã DT. Đơn thuốc "N" và "H" in đúng tên mẫu "ĐƠN THUỐC “N”/“H”" và bản mẫu in không đổi được tiêu đề này (trước đây bị bản mẫu "TOA THUỐC" ghi đè). Không migration.

### Đơn thuốc chuẩn: mã cơ sở KCB lên đầu phiếu, sửa hàng tab màn khám (`docs/DECISIONS.md` #242 bổ sung 10)

Bản in đơn thuốc chuẩn Bộ Y tế nay in "Mã cơ sở KCB" ngay dưới tên/địa chỉ phòng khám (đầu phiếu) thay vì đầu thân. Hàng tab của màn khám không còn xuống hai dòng ở màn 1280px (ẩn biểu tượng dưới 1440px). Hộp "Sửa đơn" có nhãn cho nút bỏ dòng. Không migration.

### Tách các tài liệu dài, quy ước đọc phiên bản mới nhất

`DECISIONS`, `CHANGELOG`, `CURRENT`, `TASK`, `ERD` nay luôn là phiên bản MỚI NHẤT; phần cũ chuyển nguyên văn sang `docs/archive/` (ERD tách thêm `docs/ERD-2.md`). Quy ước và ngưỡng ghi ở `CLAUDE.md` (mục "Quy ước tài liệu dài"). Không ảnh hưởng người dùng.

## 2026-10-16

### Chữ trong bảng nhẹ hơn, thẻ thống kê phẳng (`docs/DECISIONS.md` #240 bổ sung 2)

Chữ trong các bảng danh sách (tên, mã, SĐT, ngày...) nay hiển thị nét thường thay vì nét đậm, phân cấp bằng màu chữ; số tiền và badge giữ nguyên. Dải thẻ số liệu ở "Bệnh nhân trong ngày" bỏ bóng đổ và nền màu mờ: nền trắng, viền mảnh, biểu tượng nền màu đặc. Không migration.

### Sửa lỗi bố cục màn hình nhỏ và màn rất rộng (`docs/DECISIONS.md` #240 bổ sung)

Khung xem trước Mẫu in tự thu phóng vừa tờ giấy (không còn cắt mép phải ở màn 1280px); bảng dòng hàng ở Phiếu nhập kho cuộn ngang thay vì cắt cột "Thành tiền" ở màn ≤1024px; đường dẫn đầu trang hiện dấu … khi quá dài; màn rất rộng (3440px) nội dung có trần 2200px căn giữa nên bảng không giãn hết ngang. Không migration.

### Kê đơn: liều chia lẻ, thuốc không chia được, số ngày chung, lời dặn riêng + câu chào đăng nhập (`docs/DECISIONS.md` #241)

Bác sĩ kê được **¼, ½, 1½ viên** (gõ `1/2`, `0,5` hoặc bấm nút nhanh ¼ · ½ · 1 · 2); tổng số lẻ làm tròn lên khi phát thuốc và trừ kho, dòng đơn ghi rõ số lẻ gốc. Thuốc đánh dấu **không chia được** (viên nang, bao tan trong ruột, giải phóng kéo dài) mà kê liều lẻ thì hiện cảnh báo, có thể "Bỏ qua"; quản trị bật công tắc "Chặn kê liều lẻ" thì không ký được. Thêm thuốc là **lưu nháp ngay** nên cảnh báo trùng hoạt chất hiện liền (trước đây phải bấm Lưu mới thấy). Hàng pill liều (`1·0·0·1`...), số ngày thuốc đầu tự áp cho các thuốc sau (sửa tay từng thuốc được), ô **Lời dặn của bác sĩ** riêng cho đơn kèm "Mẫu lời dặn" dùng chung, in cuối đơn. Thanh chẩn đoán dính chỉ hiện khi cuộn khuất khối chẩn đoán (sửa lỗi lộ nội dung phía trên), ô "Thêm thuốc vào đơn" dính khi đơn dài. Màn đăng nhập thêm câu chào "Xin chào, Buổi trưa !!!" theo giờ. **Môi trường khác**: `db:deploy` (1 migration: liều NUMERIC(5,2), `drug.is_splittable`, `prescription.doctor_advice`) rồi khởi động lại API; thuốc cũ mặc định chia được nên không đổi hành vi.

### Chuẩn độ đậm chữ, hộp xác nhận gọn và sửa lỗi hiển thị (`docs/DECISIONS.md` #240)

Toàn bộ giao diện màn hình dùng chữ đậm tối đa semibold (600) thay cho bold/extra-bold, nét chữ sắc hơn, tiếng Việt có dấu không còn "vỡ nét"; chứng từ in giữ nguyên chữ đậm. Các hộp xác nhận (ngưng/ẩn/xoá, từ chối/huỷ có lý do, mở khoá, vô hiệu hoá tài khoản, huỷ lượt khám, trả về hàng chờ) có kiểu mới gọn hơn, ít chữ hơn: tên hành động, thông tin đối tượng có đường kẻ, một câu ghi chú, Esc để đóng. Sửa nhãn khối bị cắt nửa ở hộp thoại Sửa hồ sơ bệnh nhân và 6 hộp thoại khác. Đổi tên menu "Danh mục Cận lâm sàng". Cuối ngày đã chuyển nốt 9 hộp xác nhận cũ (Hoàn tiền, Nạp tiền & thu ngay, Huỷ đính chính cận lâm sàng, Xuất bệnh án, Tất toán ví, 3 hộp chọn bác sĩ ở Tiếp nhận, Tên vai trò, Đặt lại mật khẩu) sang kiểu mới. Không migration, không ảnh hưởng dữ liệu.

### Màn hình đăng nhập mới (`docs/DECISIONS.md` #240)

Đăng nhập là một cửa sổ chia đôi nổi giữa màn hình, nền là các biểu tượng y khoa lơ lửng chuyển động nhẹ (tự dừng khi máy bật "giảm chuyển động"); bên trái giới thiệu hành trình khám 5 bước, bên phải là form với ô nhập nền xám nhạt, nút hiện/ẩn mật khẩu và nhắc Caps Lock. Khi bị khoá tạm, màn hình đếm lùi "Thử lại sau mm:ss" và khoá nút tới khi hết giờ; khoá vĩnh viễn, quá nhiều lần thử và mất kết nối đều có thông báo tiếng Việt riêng. Điện thoại là màn đầy đủ gọn, máy tính bảng dọc dùng cột một cột; cửa sổ và biểu tượng nền lớn hơn trên màn 24 inch và 27 inch. Kiểm toàn app trên 10 cỡ màn hình: không trang nào cuộn ngang hay vỡ ở 1366px trở lên; sửa danh sách "Điều chuyển kho" và "Hao hụt điều chuyển" bị cắt cột ở màn 1280–1536px. Còn lại (Mẫu in, Phiếu nhập chi tiết ở 1280px, máy tính bảng dọc, màn rất rộng) ghi ở #240. Không migration; API thêm `retryAfterSeconds` vào lỗi khoá tạm.

### Khoá đăng nhập luỹ tiến và "Mở khoá" (`docs/DECISIONS.md` #239)

Nhân viên phòng khám nhập sai mật khẩu 5 lần bị khoá **5 phút**, rồi **15 phút**, rồi **30 phút**; sau lần khoá 30 phút chỉ cần sai thêm một lần là **khoá vĩnh viễn** — chỉ người được phân quyền "Mở khoá tài khoản" (mặc định Quản trị phòng khám, chỉ mở được tài khoản cùng chi nhánh) hoặc đặt lại mật khẩu mới gỡ được. Khi bị khoá, màn đăng nhập báo rõ số phút (kể cả ngay ở lần sai thứ 5). Người vận hành SaaS khoá cố định 60 phút (đã có OTP). Giới hạn tần suất theo IP giữ nguyên. Trang Quản lý tài khoản hiện nhãn "Khoá N phút"/"Khoá vĩnh viễn" và nút "Mở khoá" (chỉ người có quyền thấy). Môi trường khác: `db:deploy` (1 migration cộng thêm) + `db:seed` (quyền mới `user_account.unlock`) rồi khởi động lại API. Bậc khoá không tự hạ theo thời gian — chỉ về 0 khi đăng nhập đúng hoặc được mở khoá.

### Công cụ đo tải API (S6-04, `docs/Deploy.md` mục 2.5a)

`pnpm --filter @nexamed/api run perf:load`: 10 người dùng đồng thời, các kịch bản chỉ đọc, báo p50/p95/p99 từng kịch bản và tổng hợp. Đo nền trên máy dev: p95 66 ms, 0 lỗi. Chưa đo trên máy chủ pilot thật nên S6-04 chưa đóng. Không migration, không ảnh hưởng người dùng.

## 2026-10-15

### Đặt lại mật khẩu quản trị bằng dòng lệnh (`docs/Deploy.md` mục 2.3)

Khi quản trị viên duy nhất của phòng khám quên mật khẩu (không ai còn đăng nhập để bấm "Đặt lại mật khẩu"), chạy trên máy chủ: `docker compose run --rm -e ADMIN_USERNAME=<tên> migrate pnpm run db:reset-admin-password`. Lệnh sinh mật khẩu tạm (hiện một lần, bắt đổi ở lần đăng nhập đầu), xoá khoá tạm, đăng xuất mọi phiên của tài khoản đó và ghi nhật ký; chạy bằng quyền ứng dụng trong phạm vi một công ty nên không chạm công ty khác. Môi trường khác: không migration; cần dựng lại gói để có lệnh.

### Trình cài đặt/nâng cấp NEXAMed dùng chung (`docs/DECISIONS.md` #238)

Một trình cài đặt dạng trang web thay hai script cũ: chạy `nexamed-setup` (Windows: `nexamed-setup.cmd`, Linux/NAS: `./nexamed-setup.sh`), mở trình duyệt, chọn một trong ba kiểu (tại phòng khám / VPS có HTTPS tự động / hệ thống SaaS), điền thông tin, hệ thống tự cài, kiểm tra và đưa ra thông tin bàn giao (mật khẩu tạm, file .txt). Kiểu SaaS có bước kích hoạt OTP cho người vận hành. Chạy lại lệnh trên gói mới để nâng cấp: tự sao lưu trước, kiểm tra sức khoẻ, tự quay về bản cũ nếu lỗi, và có nút quay lui sau khi nâng cấp. IP máy đổi (router không giữ IP cố định) ứng dụng vẫn chạy. Gói cài đặt thêm ảnh trình cài đặt, PostgreSQL và Caddy để cài không cần Internet. Hai script cũ `install.ps1/.cmd/.sh` đã BỎ: đây là cách cài và nâng cấp duy nhất (hướng dẫn dựng gói và cài ở `docs/Deploy.md` mục 2.3 và 2.3b). Môi trường khác: không migration; cần dựng lại gói để có trình cài đặt.

### Đợt 4 SaaS: tên miền phụ theo công ty + Khu quản trị nền tảng (`docs/DECISIONS.md` #237)

Hệ thống SaaS tập trung: mỗi công ty có một tên miền phụ (`<mã>.tenmien.vn`), màn đăng nhập hiện tên công ty và báo khi công ty tạm ngưng; công ty chỉ vào được bằng đúng tên miền của mình. **Khu quản trị nền tảng** ở `admin.tenmien.vn` cho người vận hành (đăng nhập mật khẩu + mã OTP): danh sách công ty (tìm, lọc, số đếm), thêm công ty (kèm tài khoản quản trị đầu tiên, mật khẩu tạm hiện một lần), sửa liên hệ/ghi chú, khoá/mở khoá công ty (bắt buộc lý do, đăng xuất ngay mọi phiên đang mở), đặt lại mật khẩu quản trị, nhật ký vận hành. Không xem được dữ liệu bệnh nhân và không đăng nhập thay vào công ty. **Bản on-prem/VPS/NAS không đổi** (mặc định một công ty; các đường dẫn mới trả 404). Môi trường khác: `db:deploy` (1 migration cộng thêm); SaaS cần `DEPLOYMENT_MODE=saas` + `PLATFORM_BASE_DOMAIN` và `db:seed:platform-operator` để tạo người vận hành.

### Trang "Cập nhật phần mềm" (bước 2 quản lý phiên bản, `docs/DECISIONS.md` #236)

Ở Cấu hình hệ thống có thêm mục **"Cập nhật phần mềm"** (chỉ hệ thống một công ty, người có quyền mới của Quản trị phòng khám): xem phiên bản đang chạy, kênh, ngày phát hành, bấm **"Kiểm tra cập nhật"** để hỏi máy chủ phát hành xem có bản mới không (ghi chú phát hành, cảnh báo có thay đổi cơ sở dữ liệu, bản trung gian nếu quá cũ) và bảng 5 lần kiểm tra gần đây. Máy chủ tự kiểm ~30 giây sau khi khởi động và mỗi 6 giờ; có bản mới thì avatar hiện chấm xanh và menu có nhãn "Mới". Nút "Cập nhật ngay" đang tắt — cập nhật tự động chưa hỗ trợ. Địa chỉ máy chủ phát hành do nhà cung cấp đặt (`RELEASE_SERVER_URL`), chưa đặt thì trang báo chưa cấu hình. Bản SaaS không có mục này. Môi trường khác: `db:seed` (quyền mới `software_update.read`) rồi khởi động lại API; không migration.

### Quản lý phiên bản phần mềm (`docs/DECISIONS.md` #236)

Phần mềm có số phiên bản chuyên nghiệp theo SemVer (xuất phát `0.9.0`, lên `1.0.0` sau pilot) và số bản dựng (`0.9.0 · bản dựng 127`). Có hộp **"Giới thiệu"** trong menu người dùng (phiên bản, kênh Ổn định/Thử nghiệm, ngày phát hành, chế độ triển khai, ghi chú phát hành, thông tin kỹ thuật, nút sao chép thông tin gửi hỗ trợ), số phiên bản ở chân trang đăng nhập, và thông báo "hệ thống vừa được cập nhật, hãy tải lại trang" khi máy chủ đổi phiên bản. Số phiên bản chỉ đổi khi chủ động phát hành bằng `node scripts/release.mjs` (tăng số, kiểm ghi chú phát hành, tạo commit và tag); script dựng gói kiểm khớp số và tag. Trang "Cập nhật phần mềm" và bộ cập nhật tự động là các bước sau. Môi trường khác: không migration, không `db:seed`; khởi động lại API.

### Đợt 3 chi nhánh: báo cáo gộp nhiều chi nhánh (`docs/DECISIONS.md` #235)

Người có quyền mới **"Xem báo cáo toàn công ty"** (mặc định Quản trị phòng khám) có thêm bộ chọn **Phạm vi** (Chi nhánh đang làm / Tất cả chi nhánh / Chọn chi nhánh) ở ba báo cáo: **Báo cáo dòng tiền** (thêm bảng "Theo chi nhánh" và cột Chi nhánh ở "Theo Quỹ"), **Sổ quỹ** (chọn được quỹ của chi nhánh khác, chỉ xem) và **Nhập-Xuất-Tồn** (cột Chi nhánh, công tắc "Gộp theo mặt hàng"). Xuất Excel đúng phạm vi đang xem, nhật ký ghi danh sách chi nhánh đã xuất. Người không có quyền không thấy bộ chọn và máy chủ chặn (403) nếu tự gửi tham số; công ty 1 chi nhánh giao diện không đổi. Không phải báo cáo doanh số mới. Môi trường khác: `db:seed` (quyền mới) rồi khởi động lại API; không migration.

### Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân + diễn biến chỉ số (`docs/DECISIONS.md` #234)

Tab thứ 5 ở hồ sơ bệnh nhân: mọi kết quả cận lâm sàng ĐÃ DUYỆT của bệnh nhân ở mọi chi nhánh (dòng chi nhánh khác nền xanh nhạt), hai tab con Xét nghiệm / CĐHA & Thăm dò chức năng, lọc khoảng thời gian + tìm + chỉ kết quả bất thường, xem và in lại. Xét nghiệm có thêm "Diễn biến chỉ số": chọn một chỉ số, biểu đồ đường qua các lần đo kèm dải khoảng tham chiếu, bấm điểm mở kết quả lần đó; chỉ số đổi đơn vị giữa các lần đo tách thành hai đường riêng. Chỉ tài khoản làm chuyên môn (có quyền Nhập hoặc Duyệt của nhóm) thấy tab — lễ tân không thấy và bị chặn cả ở máy chủ. Không migration; môi trường khác: khởi động lại API.

### Diễn tập nâng cấp + gói on-prem `2026.10.15`

Diễn tập nâng cấp trên bản sao cô lập (`2026.10.14` → `2026.10.14.2` → `2026.10.15`): migration Đợt 2 áp sạch, dữ liệu cũ còn, chi nhánh thứ 2 tự có kho + quỹ tiền mặt, tab Kết quả cận lâm sàng 200 (quản trị) / 403 (lễ tân). Gói `2026.10.14.2` dựng trước #234 nên thiếu tab Kết quả CLS và việc bù kho/quỹ; đã dựng lại thành `2026.10.15` (không migration). Chưa cài thử trên máy Windows sạch.

### Việc treo của Đợt 2 chi nhánh

Chi nhánh tạo từ Đợt 1 nay tự được bù 1 kho + 1 quỹ tiền mặt mặc định khi API khởi động (chỉ khi chi nhánh chưa có kho/quỹ nào). Hoàn tiền đồng thời: các lần hoàn cùng một hoá đơn xếp hàng nhau, request đến sau luôn nhận 409 (trước đây đôi khi 422); tiền không bao giờ bị hoàn đôi. Màn Kiểm nhận điều chuyển kho có huy hiệu "Cận hạn · còn N ngày" / "Hết hạn" theo ngưỡng cảnh báo hạn dùng của phòng khám; danh sách và trang phiếu có nhãn "Quá hạn xử lý · N ngày" cho phiếu chờ bên gửi xử lý chênh lệch quá 7 ngày. Tab Kết quả cận lâm sàng: dải số có chú thích phụ, thanh lọc xếp hàng riêng. Log sửa danh mục giữ vĩnh viễn (chốt). Gói on-prem `2026.10.14.2` đã dựng lại (gồm Đợt 2 và #220–#232). Chốt Đợt 3: xem tổng cả công ty qua quyền mới "Xem báo cáo toàn công ty" (chưa làm).

## 2026-10-14

### Hai menu mới: "Phiếu chỉ định" và "Tra cứu kết quả" (Cận lâm sàng) + trang "Không có quyền xem nội dung này" (`docs/DECISIONS.md` #232)

**Phiếu chỉ định**: sổ mọi phiếu bác sĩ đã chỉ định theo ngày (mặc định hôm nay), chia 3 tab — Xét nghiệm / CĐHA & Thăm dò chức năng / Chỉ định ra ngoài; lọc theo khoảng ngày, bác sĩ, tiến độ (Chờ / Đang thực hiện / Đã có kết quả / Đã huỷ), tìm theo tên, mã bệnh nhân, mã phiếu; mở chi tiết phiếu (dịch vụ, nơi thực hiện, đơn giá, hoá đơn, tổng tiền) và in lại. **Tra cứu kết quả**: kết quả đã duyệt theo khoảng ngày (mặc định 7 ngày), tab theo quyền, lọc trạng thái (Đã duyệt / Đã đính chính), "chỉ kết quả có chỉ số bất thường", xem và in lại. Lễ tân chỉ xem danh sách và in (không mở nội dung kết quả); chẩn đoán trên phiếu chỉ định ẩn với tài khoản không có quyền xem lâm sàng. Cả hai theo chi nhánh đang làm việc. **Sửa lỗi lộ dữ liệu giữa chi nhánh**: hàng đợi, lấy mẫu, nhập/duyệt/in kết quả cận lâm sàng và chấm số "kết quả mới" của bác sĩ nay chỉ thấy lượt khám của chi nhánh đang làm việc (trước đây lẫn giữa các chi nhánh). Mở nội dung của chi nhánh khác hoặc không đủ quyền hiện trang "Không có quyền xem nội dung này" có nút "Quay lại trang trước" thay trang trống/404. Bảng Lịch sử khám ở hồ sơ bệnh nhân: mặc định đúng 8 cột như mockup, thêm "Cột hiển thị" cho mọi cột, và dòng lượt khám ở chi nhánh khác đồng màu. Không migration; môi trường khác: khởi động lại API.

### Tầng chi nhánh — Đợt 2 (tiền, kho, kiểm nhận điều chuyển, đầu phiếu in) (`docs/DECISIONS.md` #233)

Kho, quỹ (tiền mặt và ngân hàng) và ca thu ngân nay thuộc từng chi nhánh; hoá đơn, phiếu thu/chi, ví, công nợ NCC, sổ quỹ, tồn kho, N-X-T lọc theo chi nhánh đang làm việc. Điều chuyển kho giữa hai chi nhánh được phép, với luồng mới: **Kiểm nhận** (nhập thực nhận từng dòng, lý do lệch bắt buộc) → thiếu thì chờ chi nhánh gửi xử lý chênh lệch (hàng về kho gửi hoặc ghi hao hụt); **Từ chối nhận cả phiếu** → chi nhánh gửi xác nhận nhận lại; thêm báo cáo hao hụt điều chuyển. Chi nhánh mới tự có 1 kho + 1 quỹ tiền mặt. Đầu phiếu in thêm dòng tên chi nhánh (chỉ khi công ty có ≥ 2 chi nhánh; mẫu in có công tắc "Tên chi nhánh"). Web bỏ ảnh đại diện bệnh nhân ở hồ sơ + Tiếp nhận. Giao diện: Danh mục Kho và Quỹ có cột/bộ lọc/ô chọn chi nhánh; tab "Phiếu đi/Phiếu đến" + chấm số ở menu; màn Kiểm nhận hàng, Từ chối nhận cả phiếu, Xử lý chênh lệch, Xác nhận đã nhận lại hàng; tab "Hao hụt điều chuyển" trong trang Báo cáo Nhập-Xuất-Tồn (phần hàng mất hẳn khi chuyển kho, chi nhánh gửi xem; lọc theo kho gửi và nguyên nhân, dải 4 số, Xuất Excel); hộp thoại Mở ca ghi chi nhánh, đổi chi nhánh khi đang có ca mở thì chỉ nhắc; công nợ NCC và ví tạm ứng hiện đủ dòng + tiền, kèm tên chi nhánh, phiếu chi nhánh khác không mở được; mở phiếu thu của chi nhánh khác hiện "Không có quyền xem nội dung này". Tên chi nhánh tối đa 100 ký tự (chống vỡ giao diện), tên dài được cắt chữ/xuống dòng có tooltip. Phiên đăng nhập thêm cờ `multiBranchCompany`. Môi trường khác: `db:deploy` (1 migration) rồi khởi động lại API. **Chưa bật chi nhánh thứ 2 ở khách thật** cho tới khi dựng lại gói cài đặt và chủ dự án duyệt. Lưu ý: chi nhánh tạo từ Đợt 1 chưa có kho/quỹ — thêm tay ở Danh mục Kho/Quỹ (chi nhánh mới từ giờ tự có).

## 2026-10-13

### Tầng chi nhánh — Đợt 1 "Nền" (`docs/DECISIONS.md` #231)

Nền để một công ty có nhiều chi nhánh trên cùng hệ thống (và để chạy được cả SaaS lẫn máy chủ riêng). Mỗi công ty luôn có ít nhất một chi nhánh mặc định; công ty chỉ có một chi nhánh thì không thấy gì khác trên giao diện. Phòng, Tầng, Bàn khám, Lịch hẹn, Lượt khám, ca làm việc đã xếp, đăng ký ca tháng, đơn xin nghỉ và đổi ca nay thuộc từng chi nhánh; một tài khoản có thể được gán nhiều chi nhánh và chọn chi nhánh đang làm khi đăng nhập (đổi được bất cứ lúc nào, hệ thống nhớ lựa chọn). Lịch sử khám của bệnh nhân vẫn xem được ở mọi chi nhánh (kèm tên nơi khám); số tiền của chi nhánh mà tài khoản không thuộc thì bị che. Quyền mới "Chi nhánh" (xem/quản lý, mặc định Quản trị phòng khám). Môi trường khác: `db:deploy` (1 migration) rồi khởi động lại API. **Chưa bật nhiều chi nhánh ở khách thật** cho tới khi xong phần tiền/kho (Đợt 2). Giao diện: mục "Chi nhánh" trong Cấu hình hệ thống, màn "Chọn chi nhánh làm việc" sau đăng nhập, bộ chuyển chi nhánh ở thanh đỉnh, ô "Chi nhánh làm việc" ở form tài khoản, tab Lịch sử khám có cột Chi nhánh + "Cột hiển thị" mở rộng (mặc định đúng mockup). Môi trường khác: `db:deploy` + **`db:seed`** (quyền `branch.*`) rồi khởi động lại API.

### Bảng "Vai trò & Phân quyền" hiện đủ nhãn tiếng Việt

6 module cận lâm sàng/bảng giá (`price_list`, `result_template`, `service_package`, `technical_service`, `clinical_order`, `paraclinical_result`) từng hiện tên thô; đã thêm nhãn + test chặn module mới thiếu nhãn (`permission-grouping.spec.ts`).

### Danh mục riêng theo từng phòng khám/công ty + bảo mật cô lập tenant mạnh hơn (`docs/DECISIONS.md` #230)

Trước đây các danh mục dùng chung (Dân tộc, Quốc tịch, Đơn vị tính, Hãng sản xuất, Hoạt chất, Hình thức thanh toán, Loại thu chi, Dị nguyên...) dùng chung cho mọi phòng khám trên cùng một máy chủ, nhưng quản trị từng phòng khám lại sửa được — nên phòng khám này có thể thấy và sửa danh mục của phòng khám khác. Nay **mỗi phòng khám/công ty có bản danh mục riêng**; dữ liệu hiện có được sao chép nguyên cho từng phòng khám (giữ nguyên mã nên mọi tham chiếu ở bệnh nhân/thuốc/hoá đơn không đổi). Tạo phòng khám mới được nạp sẵn bản danh mục mặc định. Kèm bật `FORCE ROW LEVEL SECURITY` cho mọi bảng có `tenant_id`. Môi trường khác: `db:deploy` (2 migration) rồi khởi động lại API.

### Rà soát toàn bộ mã nguồn + kiểm tra cô lập tenant toàn lược đồ (`docs/DECISIONS.md` #229)

Không đổi chức năng người dùng. Thêm test kiểm RLS cho mọi bảng; sửa lỗi test lặp lại ở 3 spec (tranh chấp seed quyền); dev seed từ chối chạy trên máy chủ thật; nginx thêm header bảo mật; tính tuổi ở xuất Excel tiếp nhận không còn phụ thuộc múi giờ máy chủ; dọn cảnh báo lint. Các cảnh báo cần quyết định (danh mục dùng chung giữa tenant, CSP...) ghi ở #229.

### Nút "Bỏ qua cảnh báo này" cho cảnh báo trùng hoạt chất (`docs/DECISIONS.md` #228)

Khung đỏ "Trùng hoạt chất" ở tab Kê đơn thuốc có nút **Bỏ qua cảnh báo này** (ô lý do không bắt buộc, Enter để xác nhận). Chỉ áp dụng cho đơn hiện tại: cảnh báo chuyển thành dòng mờ "Đã bỏ qua" kèm người bỏ qua, thời điểm, lý do và nút **Bật lại** (khi đơn còn nháp); lưu lại đơn hay tải lại trang vẫn nhớ; ký đơn rồi thì khoá và giữ nguyên dấu vết. Cảnh báo dị ứng và kê vượt tồn kho không có nút này. Ghi vào nhật ký hoạt động. Môi trường khác: `db:deploy` (1 migration) rồi khởi động lại API.

### Cảnh báo trùng hoạt chất khi kê đơn so theo hoạt chất có cấu trúc (`docs/DECISIONS.md` #227)

Thuốc đã khai hoạt chất ở Danh mục Thuốc & Vật tư (nhiều hoạt chất/thuốc) được so theo từng hoạt chất: thuốc phối hợp có chung một hoạt chất với thuốc khác trong đơn thì báo trùng đúng hoạt chất đó, kể cả khi ô "Hoạt chất" dạng chữ của hai thuốc ghi khác nhau. Thuốc cũ chưa khai cấu trúc vẫn so như trước. Không migration.

### CI GitHub chạy được

Workflow `.github/workflows/ci.yml` đã sửa (pnpm khai hai nơi, trigger nhánh `master`, build `shared`/`core` trước seed, Node 22, biến môi trường giả cho test). Mọi nhánh `feat/*` đã merge được xoá; từ nay commit thẳng `master`.
