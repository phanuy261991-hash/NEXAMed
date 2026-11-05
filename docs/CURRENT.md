# Current — NEXAMed

Trạng thái HIỆN TẠI của dự án (cập nhật 05/11/2026). File này chỉ giữ bức tranh hiện tại + việc đang làm/đang chờ; **không phải nhật ký** (nhật ký ở `docs/CHANGELOG.md`, quyết định ở `docs/DECISIONS.md`, việc theo phase ở `docs/TASK.md`).

Nhật ký trạng thái đầy đủ cũ (từng đợt) ở `docs/archive/CURRENT-den-2026-10-16.md` và `docs/archive/CURRENT-den-2026-11-04.md` (bản dài đến 04/11/2026, gồm chi tiết kiểm thử từng chức năng) — **chỉ mở khi cần tra một mục cụ thể**. Khi file này vượt ~40 KB thì chuyển phần cũ sang `docs/archive/CURRENT-*.md` mới và viết lại bản ngắn (xem `CLAUDE.md`, mục "Quy ước tài liệu dài").

## Bức tranh hiện tại

- Phiên bản phần mềm `0.9.0` (chốt `1.0.0` SAU pilot). Đang pilot tại phòng khám thật; môi trường dev dùng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, đăng nhập `dev.admin` / `Dev@12345` (tài khoản quét quyền `rl.<vai trò>`, mật khẩu `12345678`).
- `master` = `73cb453` (05/11/2026; CI GitHub XANH). Full API 2021, core 696, shared 126, web 575 đều xanh khi push.
- Phạm vi v1 đã mở rộng nhiều so với PRD gốc (danh sách chốt đầy đủ ở `CLAUDE.md`, mục Phạm vi v1): Đặt lịch, Tiếp nhận, Khám bệnh, Kê đơn, Thu ngân cơ bản, Sổ quỹ & Thu chi, Ví tạm ứng, Kho Thuốc & Vật tư GĐ1–5, Công nợ nhà cung cấp A–E, Cận lâm sàng, Điều trị & Hẹn tái khám, Lịch làm việc/đơn nghỉ/đổi ca, Bảng giá có thời hạn, Thẻ BHYT (chỉ lưu/hiển thị), Hồ sơ bệnh án MS 15/BV-01, Khách không làm dịch vụ, hệ thống báo cáo + Tổng quan theo vai trò.
- **Tầng chi nhánh** (#231/#233/#235): Đợt 1–3 xong; chưa bật chi nhánh thứ 2 ở khách thật. Mọi chức năng mới trả lời 4 câu hỏi chi nhánh (`CLAUDE.md`). **SaaS** (#237): nền tên miền phụ + Khu quản trị nền tảng xong; còn hạ tầng thật (chờ báo giá). **Trình cài đặt `nexamed-setup`** (#238) xong; chưa kiểm Let's Encrypt/NAS/Windows sạch.
- **Runtime Node 26** (#253), NestJS 11, Vite 6/Vitest 4 (#249, #252). Mọi mã mới chạy được ở LAN HTTP on-prem (#257); lỗi hiện qua màn thông báo cụ thể (#255); POST có `Idempotency-Key` (#257); một request = MỘT transaction (#264).

## Hệ thống báo cáo + Tổng quan theo vai trò (#279, kế hoạch `docs/product/reporting-plan.md`)

Đã xong và đã push: Đợt 0 (hàm ngày giờ VN dùng chung `packages/core/src/date/`, đầu báo cáo Excel); Tổng quan **chủ phòng khám** (#282, `dashboard.owner`), **thu ngân** (#283, `dashboard.cashier`), **lễ tân** (#284, `dashboard.reception`), cùng phong cách "hướng B" (`.claude/docs/ui-guidelines.md` mục 18, CHỈ áp cho các trang Tổng quan).

Tổng quan **bác sĩ** (#286, 05/11/2026, `dashboard.doctor`, công tắc "hiện doanh thu sinh ra" mặc định tắt) đã code + test + kiểm Chrome IP LAN, full API 2021 xanh, đã push `73cb453` (CI GitHub XANH) — mockup đã chốt (https://claude.ai/artifact/D3dfooh1FoDkXv513RQJ5p, tệp BacSi); 6 điểm khác mockup chờ chủ dự án xem (DECISIONS #286); môi trường khác cần `db:seed`.

**Còn lại**: Báo cáo ngày (A2, một trang in được) + nhóm menu "Báo cáo" (chưa có mockup), Đợt 2–5 (Sổ khám bệnh, dịch vụ, thuốc đã phát, doanh thu theo kỳ, theo bác sĩ, vận hành, màn "Toàn hệ thống" nhiều chi nhánh + lãi gộp thuốc) — xem `reporting-plan.md` mục 7.

## Trang "Hẹn tái khám" + công tắc (#285, 04/11/2026) — XONG, đã push, CI xanh

Menu con "Hẹn tái khám" ở "Tiếp nhận và Đặt lịch": 4 tab, tìm kiếm, lọc bác sĩ, Excel, nhật ký nhắc (bảng `follow_up_reminder`), quyền `follow_up.read`/`follow_up.remind` (bác sĩ chỉ hẹn của mình), nối từ Tổng quan lễ tân. Lễ tân không thấy chẩn đoán (chỉ số lượt khám). Công tắc **"Dùng danh sách Hẹn tái khám"** (Cấu hình chung, mặc định BẬT) cho phòng khám không dùng: ẩn menu/trang/khối Tổng quan, máy chủ 409 `FOLLOW_UP_DISABLED`; bác sĩ vẫn chọn hướng "Hẹn tái khám" ở tab Điều trị. Môi trường khác cần `db:deploy` (migration `20261104120000_follow_up_reminder`) + `db:seed`. ERD v1.91.

## Đang chờ / việc treo

- **Cần chủ dự án**: xem 6 điểm khác mockup của Tổng quan bác sĩ (#286); duyệt mockup Báo cáo ngày khi có; chốt gói thuê bao + giấy phép ký số (làm SAU, đảo ngược #070/#072 khi bắt đầu); chữ ký điện tử bệnh án theo Thông tư 13/2025 (mốc 31/12/2026, chủ dự án chốt LÀM SAU, #270/#271 — phương án rẻ: lưu mã băm SHA-256 lúc ký; mức cao: ký số CA qua `SignaturePort`; nên hỏi Sở Y tế/luật sư); gói Nhi khoa (kế hoạch `docs/product/pediatric-pack-plan.md`, tạm dừng, còn 6 câu chưa chốt).
- **Cần máy/đơn vị bên ngoài**: pilot thật — S6-02 diễn tập phục hồi, S6-04 đo tải trên máy chủ pilot (`perf:load` đã có), phát hành `1.0.0`; hạ tầng SaaS (báo giá, `docs/product/saas-hosting-comparison.md`); kiểm bộ cài trên Windows sạch/Linux/NAS và Let's Encrypt thật; cài MỚI bản có khoá mã hoá (#262); gỡ luật tường lửa "NEXAMed LAN test 8181" (cần Administrator: `Remove-NetFirewallRule -DisplayName "NEXAMed LAN test 8181"`).
- **Liên thông đơn thuốc quốc gia** (#242): đã code đủ, kiểm bằng cổng giả; chưa kiểm cổng thật, chờ câu trả lời đơn vị vận hành (`docs/product/prescription-interop-questions.md`: sandbox, chữ ký số, danh mục "hình thức điều trị", app-name/app-key — khoá đặt ở `.env` `INTEROP_APP_NAME`/`INTEROP_APP_KEY`, câu 22a "khi cần" không số ngày); API nhà thuốc (8e) làm SAU, duyệt riêng.
- Gói on-prem chưa dựng lại cho các thay đổi từ 16/10 (dựng khi sắp giao khách: `build-and-export.ps1`, bản giao khách = số phát hành chính thức + ghi chú; bản demo máy dev `0.9.2`/`0.9.3` ở `C:\Projects\NEXAMed-demo-package\`, chưa có sửa #278). CSP vẫn Report-Only tới sau pilot.
- Ưu tiên thấp: ô 13px `dense` đậm màu hơn nếu khó đọc; ghi chú 2 dòng của hộp "Bác sĩ đang nghỉ"/"Không có ca làm việc hôm nay" ở Tiếp nhận vượt gợi ý ≤ ~40 ký tự (ui-guidelines 15b); nút "Nhập lại" của form tiếp nhận chưa xoá cờ "nhập dở" (#274); nhập chỉ số xét nghiệm bằng Excel (#276); `UnitOfWorkService` tái dùng transaction qua `AsyncLocalStorage` nếu lỗi lồng transaction tái diễn (#264, cần duyệt).

## Tóm tắt các đợt gần đây (chi tiết ở CHANGELOG/DECISIONS)

- **Giao diện/an toàn**: chuẩn độ đậm chữ tối đa semibold, ô nhập nét 400 (#240, #246); `ConfirmDialog`, `SystemFailureDialog` kiểu mới (#273); cảnh báo dữ liệu nhập dở (#274); quét quyền theo phạm vi/vai trò (#260, #263); khoá đăng nhập luỹ tiến + "máy quen" (#239, #259); giới hạn tần suất không chỉ theo IP (#258); hiệu năng/bảo mật SaaS (#244, #245); khoá mã hoá hệ thống A→B→C (#262).
- **Nghiệp vụ**: kê đơn liều lẻ + "Khi cần"/ml (#241, #267), nhãn dán bì thuốc (#267), mã đơn thuốc BYT + liên thông (#242), thẻ BHYT (#243), đóng ca bác sĩ gắn lịch làm việc (#266), quản lý giá: Loại giá mặc định + Hẹn đổi giá (#268), hồ sơ bệnh án MS 15/BV-01 + Số lưu trữ (#269, #270, #272), gợi ý theo cơ quan + ghi chú phát hành (#271), quy đổi đơn vị kho (#275), Nhập/Xuất Excel Dịch vụ kỹ thuật (#276), "Khách không làm dịch vụ" (#280), logo/favicon (#281).
- Hai danh sách trong ngày (tiếp nhận, thu ngân) tải theo lô 50 dòng (#250, #251).

## Bàn giao mới nhất

**`docs/handoffs/HANDOFF-HenTaiKham-TongQuanBacSi-2026-11-05.md`** (MỚI NHẤT — ĐỌC TRƯỚC, 05/11/2026: #285 Hẹn tái khám + #286 Tổng quan bác sĩ đã push `73cb453`; CI xanh; việc kế tiếp: hỏi 6 điểm khác mockup, dựng mockup Báo cáo ngày). Bản trước: `docs/handoffs/HANDOFF-TongQuanThuNgan-LeTan-HenTaiKham-2026-11-04-p2.md`. Các bản bàn giao cũ hơn nằm cùng thư mục `docs/handoffs/` (đặt tên theo ngày) — chỉ mở khi cần tra.

## Cách đọc các tài liệu dài (chốt 20/10/2026)

`docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/CURRENT.md`, `docs/ERD.md` luôn là PHIÊN BẢN MỚI NHẤT; phần cũ ở `docs/archive/` (và nhóm bảng ERD mở rộng ở `docs/ERD-2.md`). Chỉ đọc file gốc; chỉ mở archive khi cần tra mục cụ thể. Chi tiết quy ước ở `CLAUDE.md`.

## Lưu ý môi trường

- Máy dev: Node v26, Docker Desktop. **Postgres container map ra cổng 5433** (máy dev có Postgres native chiếm 5432); `DATABASE_URL` trong `.env` đã trỏ 5433. Mật khẩu role `nexamed_app` hard-code trong migration chỉ dùng cho local/CI — **bắt buộc đổi** khi triển khai on-prem thật (`docs/DECISIONS.md` #010).
- Môi trường khác sau khi lấy mã mới cần: `pnpm install`, `db:deploy`, `db:seed`, khởi động lại API (migration mới nhất `20261104120000_follow_up_reminder`).
- Windows: Git Bash đổi giá trị biến môi trường bắt đầu bằng `/` thành đường dẫn Windows (đặt `MSYS_NO_PATHCONV=1`); `prisma generate` lỗi EPERM khi dev server đang chạy (tắt `pnpm dev` trước); full test API cùng lúc dev server + Chrome có thể báo "paging file is too small"/"Memory allocation error" — tắt dev server rồi chạy nền một mình (~7 phút). Tài liệu `docs/*.md` nhiều file CRLF/LF lẫn lộn — script vá phải nhận biết kiểu xuống dòng từng đoạn (không dùng `node -e` nhiều dòng có dấu backtick trong Bash).
- Kiểm giao diện bằng Chrome thật qua IP LAN: `pnpm dev:lan` (tự khôi phục `config.json`), `scripts/ui-audit/` (README). `playwright-core` cài ở thư mục tạm, không đưa vào repo.
