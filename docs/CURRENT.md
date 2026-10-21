# Current — NEXAMed

Trạng thái HIỆN TẠI của dự án (cập nhật 21/10/2026, cuối ngày). File này chỉ giữ bức tranh hiện tại + việc đang làm/đang chờ; **không phải nhật ký** (nhật ký ở `docs/CHANGELOG.md`, quyết định ở `docs/DECISIONS.md`, việc theo phase ở `docs/TASK.md`).

Nhật ký trạng thái đầy đủ cũ (từng đợt, đến 16/10/2026) ở `docs/archive/CURRENT-den-2026-10-16.md` — **chỉ mở khi cần tra một mục cụ thể**. Khi file này vượt ~40 KB thì chuyển phần cũ sang `docs/archive/CURRENT-*.md` mới và viết lại bản ngắn (xem `CLAUDE.md`, mục "Quy ước tài liệu dài").

## Bức tranh hiện tại

- Phiên bản phần mềm `0.9.0` (chốt `1.0.0` SAU pilot). Đang pilot tại phòng khám thật; môi trường dev dùng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, đăng nhập `dev.admin` / `Dev@12345`.
- Phạm vi v1 đã mở rộng nhiều so với PRD gốc (danh sách chốt đầy đủ ở `CLAUDE.md`, mục Phạm vi v1): Đặt lịch, Tiếp nhận, Khám bệnh, Kê đơn, Thu ngân cơ bản, Sổ quỹ & Thu chi, Ví tạm ứng, Kho Thuốc & Vật tư GĐ1–5, Công nợ nhà cung cấp A–E, Cận lâm sàng (danh mục, chỉ định, hàng đợi, kết quả), Điều trị & Hẹn tái khám, Lịch làm việc/đơn nghỉ/đổi ca, Bảng giá có thời hạn.
- **Tầng chi nhánh** (`docs/DECISIONS.md` #231/#233/#235): Đợt 1–3 xong (nền, tiền + kho, báo cáo gộp). Chưa bật chi nhánh thứ 2 ở khách thật (chủ dự án bảo bỏ qua). Mọi chức năng mới phải trả lời 4 câu hỏi chi nhánh (`CLAUDE.md`).
- **SaaS** (#237): nền tên miền phụ + Khu quản trị nền tảng xong; còn hạ tầng thật (chờ báo giá nhà cung cấp trong nước). **Trình cài đặt `nexamed-setup`** (#238) xong, kiểm Docker thật; chưa kiểm Let's Encrypt/NAS/máy Windows sạch.
- **Giao diện** (#240): chuẩn độ đậm chữ tối đa semibold, `ConfirmDialog` dùng chung, màn đăng nhập mới, kiểm đa kích thước (`.claude/docs/ui-guidelines.md` mục 15–16). **Kê đơn** (#241): liều chia lẻ ¼ viên, thuốc không chia được, lời dặn riêng của đơn. Khoá đăng nhập luỹ tiến (#239).

## Đang làm: Mã đơn thuốc theo Bộ Y tế + liên thông (#242)

Mockup đã chốt (https://claude.ai/artifact/6eERQ9k2qsneekMWW2ymjJ, bản 7) và các quyết định ở `docs/product/prescription-code-moh.md` mục 7b/7c, `docs/DECISIONS.md` #242. Toàn bộ mockup bản 7 (kể cả 8b–8f: ô nhập trường bắt buộc khi gửi đơn, hàng chờ gửi/xem lỗi, cấu hình kết nối cổng + công tắc tổng "Có liên thông/Không liên thông", bảng đối chiếu QĐ 808) **đã được chủ dự án chốt 20/10/2026**; riêng API nhà thuốc (8e) làm SAU giai đoạn 1–3, duyệt phạm vi riêng.

**Giai đoạn 1 (mã, cấu hình, mã cơ sở theo chi nhánh) — XONG và đã kiểm** (test HTTP 12/12 + kiểm đột biến, shared/core/web xanh, full API chỉ có chập chờn đã biết ở `inventory-http.spec.ts`). Chưa kiểm Chrome thật cho phần web của GĐ1. Bài học: KHÔNG gọi port chi nhánh (mở transaction riêng) từ BÊN TRONG transaction khác — cạn bể kết nối khi nhiều người ký đồng thời; tra mã cơ sở TRƯỚC (`resolveFacilityCodeForBranch`).

**Giai đoạn 2 (phân loại thuốc, tách đơn khi ký, in nhiều tờ, phát thuốc nhóm theo đơn) — ĐÃ CODE ĐỦ, ĐÃ KIỂM TEST và ĐÃ KIỂM CHROME THẬT (20/10/2026).** Spec `prescription-document-http.spec.ts` 12/12 + kiểm đột biến; shared 46, core 455, web 156, full API 1529/1529 (mọi test cô lập tenant/chi nhánh xanh). Kiểm đã bắt được lỗi thật: bật chế độ chuẩn làm bộ đếm mã DT đếm lại từ 1 và trùng mã cũ — đã sửa bằng cờ `implicitPeriod` (`docs/DECISIONS.md` #242 bổ sung 8). Thiết kế: mã chuẩn ở bảng `prescription_document` (không thêm cột vào `prescription`), tách đơn CHỈ khi chế độ chuẩn bật, đơn ký trước ngày bật không cấp mã chuẩn hồi tố. **4 sai khác nhỏ so với mockup đã được chủ dự án duyệt (20/10; "Mã cơ sở KCB" đã chuyển lên đầu phiếu in, #242 bổ sung 10); luồng "Sửa đơn" đã kiểm giao diện; hàng tab 1280px đã sửa. Mã chuẩn đã hiện ở lịch sử khám/PDF bệnh án/phiếu xuất kho, tiêu đề đơn N/H đã khoá theo mẫu Thông tư 52/2017 (#242 bổ sung 11). **Cấu hình "thông tin bệnh nhân & mục đơn N/H" trên mẫu in ĐÃ XONG 20/10 (#242 bổ sung 12, bám mockup đã duyệt, kiểm Chrome thật: lưu cấu hình → in thật áp đúng; đã sửa lỗi kế thừa khổ giấy). Việc kế tiếp: giai đoạn 3 liên thông. Còn mở: số thẻ BHYT trên đơn (làm cùng S2-04); hộp in thật của trình duyệt.**

**Giai đoạn 3 (liên thông) — ĐÃ CODE ĐỦ, ĐÃ KIỂM TEST + CHROME THẬT bằng cổng giả (20/10/2026, `docs/DECISIONS.md` #242 bổ sung 16–17; CHƯA kiểm cổng thật)**: trang cấu hình + khung kết nối (8d); ô bổ sung 8b (hình thức điều trị, đợt dùng thuốc, số thang, người giám hộ) + dải kiểm 8a; hàng chờ `prescription_submission` xếp lúc ký/đính chính; bộ gửi nền mỗi phút + "Gửi ngay"/"Gửi lại"; trang "Đơn thuốc liên thông" (8c) **nằm trong menu Quản trị, dưới "Mẫu in"** (chủ dự án chốt); danh mục "Hình thức điều trị" (mã số BYT nhập tay, chưa seed). Công tắc "Có liên thông" tắt thì ẩn hết. Còn lại: kiểm với cổng thật khi có môi trường thử, câu hỏi gửi đơn vị vận hành (`docs/product/prescription-interop-questions.md`, câu 16 hỏi giá trị "hình thức điều trị"), API nhà thuốc (8e, duyệt riêng).

## Đang làm: Thẻ bảo hiểm y tế — S2-04 (#243)

Mockup (https://claude.ai/artifact/FAi8GCjycj94s6EwTT9t6b, bản 3) **đã chốt 21/10/2026**. Công tắc tổng "Áp dụng BHYT" (chung cả công ty, mặc định TẮT); thẻ mới 12 chữ số / cũ 15 ký tự chữ+số; nhiều thẻ/bệnh nhân; chụp thẻ vào lượt khám lúc Tiếp nhận; ba ô tích in. **Backend xong và đã test** (API 24 ca riêng, core 509, shared 96, web 237). **Web XONG và đã kiểm Chrome thật (21/10/2026, #243 bổ sung 2)**: ô tích ở Quản lý mẫu in, khối chọn thẻ ở Tiếp nhận (4 trạng thái), nhãn BHYT ở hàng đợi/danh sách/màn khám, khung thẻ ở lịch sử khám; công tắc tắt thì ẩn hết (đã kiểm 6 nơi). **Kiểm đột biến backend + lõi XONG** (xem #243 bổ sung 3): FULL test xanh (API 1655, core 509, web 237, shared 96). **Chủ dự án chốt thêm 21/10/2026 (#243 bổ sung 4)**: số thẻ mới = 12 chữ số theo quy định mới nhất (trùng số CCCD), không cần hỏi đơn vị vận hành; và Tiếp nhận cho THÊM THẺ NGAY kể cả hồ sơ bệnh nhân MỚI (thẻ nháp, tạo sau khi tạo hồ sơ) — đã làm + kiểm Chrome thật. Không còn việc treo của S2-04. Bàn giao `docs/handoffs/HANDOFF-TheBHYT-S204-2026-10-21.md` (đọc trước khi tiếp tục). Cùng ngày: sửa lỗi cả trang cuộn dọc ở tab Kê đơn (#240 bổ sung 4); ghi kế hoạch gói Nhi khoa (`docs/product/pediatric-pack-plan.md`, tạm dừng, còn 6 câu chưa chốt).

## Hiệu năng & bảo mật (21/10/2026, #244)

Đo tải toàn ứng dụng **ĐẠT** (p95 58 ms/500 ms, 0 lỗi). Đã sửa 2 lỗi nghiêm trọng: đăng nhập đồng thời làm cạn bể kết nối (100 người → 64 lỗi, nay 0 lỗi; SaaS 320 lượt → 0 lỗi) và một công ty chặn được đăng nhập của mọi công ty khác. Đã thêm: giới hạn 5 phiên/tài khoản, hạn phiên 7 ngày (từ 30), job dọn phiên hết hạn, biến `TRUST_PROXY_HOPS`. Sửa thêm: hai job dọn dẹp từng hẹn 2 giờ sáng (máy phòng khám tắt buổi tối nên chưa từng chạy) nay chạy sau khi bật máy + lặp trong ngày. Kiểm thử tấn công chủ động trên bản SaaS chạy thật: **23/24 mục ĐẠT, 0 rò rỉ dữ liệu** (cách ly công ty, giả mạo tên miền, giả mạo token, phân quyền, rò rỉ thông tin) — đã trình diễn trên Chrome. **Còn mở**: `GET /encounters/by-patient/:id/history` trả 200 rỗng thay vì 404 cho bệnh nhân công ty khác (không rò rỉ, chỉ thiếu nhất quán; sửa cần port dùng chung); OTP khu quản trị dùng lại được trong ±90 giây (cần thêm cột `last_otp_step`, chờ chủ dự án quyết); tham số argon2 mặc định; CSP Report-Only.

## Đang chờ / việc treo

- Hỏi đơn vị vận hành cổng đơn thuốc: sandbox, chữ ký số bắt buộc?, chữ hoa/thường mã đơn, cách cập nhật đơn đã gửi khi đính chính, "72 tháng", danh mục hình thức điều trị, tên trường chẩn đoán, app-name/app-key, địa chỉ API nhà thuốc. API nhà thuốc (lấy đơn, báo số lượng bán) làm SAU giai đoạn 1–3, duyệt riêng.
- Bố cục: bộ kiểm toàn app (53 trang × 10 cỡ) đã **0 vấn đề** (20/10/2026); độ đậm chữ đo tối đa 600. Còn lại ưu tiên thấp: ghi chú 2 dòng của hộp "Bác sĩ đang nghỉ"/"Không có ca làm việc hôm nay" ở Tiếp nhận vượt gợi ý ≤ ~40 ký tự (ui-guidelines 15b), chưa kiểm hộp in thật của trình duyệt.
- Gói thuê bao + giấy phép ký số (làm SAU; mockup trang Giấy phép chờ duyệt; đảo ngược #070/#072 khi bắt đầu).
- Việc cần pilot thật: S6-02 diễn tập phục hồi, S6-04 đo tải trên máy chủ pilot (công cụ `perf:load` đã có), phát hành `1.0.0`, CSP đang Report-Only. Gói on-prem chưa dựng lại cho các thay đổi từ 16/10 (dựng khi sắp giao khách). Chọn nhà cung cấp hạ tầng SaaS (chờ báo giá, `docs/product/saas-hosting-comparison.md`).
- Môi trường khác cần `db:deploy` (các migration `20261016110000_…`, `20261020090000_…`, `20261020110000_…`, `20261020120000_…`, `20261021090000_…`, `20261021100000_…`, `20261021120000_…`) + `db:seed` + khởi động lại API.

## Bàn giao mới nhất

**`docs/handoffs/HANDOFF-TheBHYT-S204-2026-10-21.md`** (mới nhất, 21/10/2026: thẻ BHYT backend xong + web làm dở, việc còn lại theo thứ tự, bẫy). Bản trước: `HANDOFF-LienThong-GD3-HangCho-OBoSung-2026-10-20-p4.md` (20/10/2026 phần 4: GĐ3 liên thông xong ô 8b/dải 8a/hàng chờ/bộ gửi nền/trang 8c).

## Cách đọc các tài liệu dài (chốt 20/10/2026)

`docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/CURRENT.md`, `docs/ERD.md` luôn là PHIÊN BẢN MỚI NHẤT; phần cũ ở `docs/archive/` (và nhóm bảng ERD mở rộng ở `docs/ERD-2.md`). Chỉ đọc file gốc; chỉ mở archive khi cần tra mục cụ thể. Chi tiết quy ước ở `CLAUDE.md`.

## Lưu ý môi trường

- Máy dev hiện chạy Node v26.5.0, khác Node 20 LTS ghi trong `CLAUDE.md`/`package.json.engines`. Chưa gây lỗi (chỉ warning), nhưng cần dùng đúng Node 20 khi triển khai thật.
- Docker đã cài trên máy dev. Migration `20260807090207_init` **đã được áp thật lên Postgres 18.4** qua `prisma migrate deploy` và xác minh bằng insert thử — `id` sinh ra đúng UUID v7 (time-ordered, ví dụ `019fdc38-6d2f-7ff2-...`). Không còn là "chưa test".
- **Postgres container map ra cổng 5433, không phải 5432 mặc định** — máy dev này có sẵn một Postgres native (Windows service `postgres.exe`, không liên quan tới dự án) đang chiếm 5432. `DATABASE_URL` trong `.env.example`/`.env` đã trỏ sang `5433`. Nếu đổi máy dev khác không có xung đột này, có thể đổi lại 5432 trong `docker-compose.yml`.
- UUID v7 (`DECISIONS.md` #009) và cột `audit_log` (`DECISIONS.md` #007) đã chốt xong, không còn treo.
- Mật khẩu role `nexamed_app` đang hard-code trong migration (`'nexamed_app'`) — chỉ dùng được cho local dev/CI, **bắt buộc đổi** khi triển khai on-prem thật (S4-05), xem `docs/DECISIONS.md` #010.
- Windows: Git Bash đổi giá trị biến môi trường bắt đầu bằng `/` thành đường dẫn Windows (đặt `MSYS_NO_PATHCONV=1`); `prisma generate` lỗi EPERM khi dev server đang chạy (tắt `pnpm dev` trước); chạy full test API cùng lúc dev server + Chrome có thể báo "paging file is too small". Tài liệu `docs/*.md` dùng CRLF — script vá phải giữ CRLF.
