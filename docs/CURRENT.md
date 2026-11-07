# Current — NEXAMed

Trạng thái HIỆN TẠI của dự án (cập nhật 06/11/2026). File này chỉ giữ bức tranh hiện tại + việc đang làm/đang chờ; **không phải nhật ký** (nhật ký ở `docs/CHANGELOG.md`, quyết định ở `docs/DECISIONS.md`, việc theo phase ở `docs/TASK.md`).

Nhật ký trạng thái đầy đủ cũ (từng đợt) ở `docs/archive/CURRENT-den-2026-10-16.md` và `docs/archive/CURRENT-den-2026-11-04.md` (bản dài đến 04/11/2026, gồm chi tiết kiểm thử từng chức năng) — **chỉ mở khi cần tra một mục cụ thể**. Khi file này vượt ~40 KB thì chuyển phần cũ sang `docs/archive/CURRENT-*.md` mới và viết lại bản ngắn (xem `CLAUDE.md`, mục "Quy ước tài liệu dài").

## Bức tranh hiện tại

- Phiên bản phần mềm `0.9.0` (chốt `1.0.0` SAU pilot). Đang pilot tại phòng khám thật; môi trường dev dùng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, đăng nhập `dev.admin` / `Dev@12345` (tài khoản quét quyền `rl.<vai trò>`, mật khẩu `12345678`).
- `master` = commit "trang Toàn hệ thống" (05/11/2026, trên `a08cbde` trang Thuốc và vật tư; chưa kiểm CI GitHub). Full API 2134+, core 773, shared 127, web 680, setup 112 đều xanh khi push.
- Phạm vi v1 đã mở rộng nhiều so với PRD gốc (danh sách chốt đầy đủ ở `CLAUDE.md`, mục Phạm vi v1): Đặt lịch, Tiếp nhận, Khám bệnh, Kê đơn, Thu ngân cơ bản, Sổ quỹ & Thu chi, Ví tạm ứng, Kho Thuốc & Vật tư GĐ1–5, Công nợ nhà cung cấp A–E, Cận lâm sàng, Điều trị & Hẹn tái khám, Lịch làm việc/đơn nghỉ/đổi ca, Bảng giá có thời hạn, Thẻ BHYT (chỉ lưu/hiển thị), Hồ sơ bệnh án MS 15/BV-01, Khách không làm dịch vụ, hệ thống báo cáo + Tổng quan theo vai trò.
- **Tầng chi nhánh** (#231/#233/#235): Đợt 1–3 xong; chưa bật chi nhánh thứ 2 ở khách thật. Mọi chức năng mới trả lời 4 câu hỏi chi nhánh (`CLAUDE.md`). **SaaS** (#237): nền tên miền phụ + Khu quản trị nền tảng xong; còn hạ tầng thật (chờ báo giá). **Trình cài đặt `nexamed-setup`** (#238) xong; chưa kiểm Let's Encrypt/NAS/Windows sạch.
- **Runtime Node 26** (#253), NestJS 11, Vite 6/Vitest 4 (#249, #252). Mọi mã mới chạy được ở LAN HTTP on-prem (#257); lỗi hiện qua màn thông báo cụ thể (#255); POST có `Idempotency-Key` (#257); một request = MỘT transaction (#264).

## Hệ thống báo cáo + Tổng quan theo vai trò (#279, kế hoạch `docs/product/reporting-plan.md`)

Đã xong và đã push: Đợt 0 (hàm ngày giờ VN dùng chung `packages/core/src/date/`, đầu báo cáo Excel); Tổng quan **chủ phòng khám** (#282, `dashboard.owner`), **thu ngân** (#283, `dashboard.cashier`), **lễ tân** (#284, `dashboard.reception`), cùng phong cách "hướng B" (`.claude/docs/ui-guidelines.md` mục 18, CHỈ áp cho các trang Tổng quan).

Tổng quan **bác sĩ** (#286, 05/11/2026, `dashboard.doctor`, công tắc "hiện doanh thu sinh ra" mặc định tắt) đã code + test + kiểm Chrome IP LAN, full API 2021 xanh, đã push `73cb453` (CI GitHub XANH) — mockup đã chốt (https://claude.ai/artifact/D3dfooh1FoDkXv513RQJ5p, tệp BacSi); 6 điểm khác mockup chờ chủ dự án xem (DECISIONS #286); môi trường khác cần `db:seed`.

**Báo cáo ngày + nhóm menu "Báo cáo" + Trung tâm báo cáo (#287, 05/11/2026) — XONG, đã push `5f5c82c`, CI xanh**: mockup 8 màn đã duyệt (https://claude.ai/artifact/9XELE6UCXLKwdUN4KcVymV), Báo cáo ngày có Phạm vi nhiều chi nhánh (tờ in trang tổng + mỗi chi nhánh một trang) + Excel, Trung tâm báo cáo gọn (chỉ báo cáo đã làm), quyền `daily_report.read`, loại chứng từ in `REPORT`. Quy tắc mới: **mọi báo cáo phải có Excel và In** — ĐÃ bổ sung cho cả 8 báo cáo cũ (05/11/2026), báo cáo mới nào cũng phải đủ cả hai. Môi trường khác cần `db:deploy` (migration `20261105100000_print_report_document`) + `db:seed`.

"N chỉ số ngoài khoảng" của Tổng quan bác sĩ (#286 bổ sung) đã làm xong 05/11/2026 (Chrome IP LAN 5/5).

**Trang "Khám bệnh và vận hành" (#287, 05/11/2026) — XONG, 6/6 tab** (Sổ khám bệnh, Giờ cao điểm, Thời gian chờ, Huỷ và không đến, Tái khám, Nguồn đặt lịch; quyền `operations_report.read` chỉ quản lý phòng khám; Excel + In; Chrome IP LAN 58/58; môi trường khác cần `db:seed`). Khung dùng chung cho các trang sau: `PeriodReportTab`, `ReportKpiStrip`, `ReportCard`, `ReportGridTable`, `useReportPeriod`.

**Trang "Doanh thu" (#287, 05/11/2026) — XONG, 5/5 tab** (Theo kỳ, Theo nhóm và dịch vụ, Theo phương thức, Phiếu chưa thu, Theo thu ngân và chốt ca; quyền `revenue_report.read` chỉ quản lý phòng khám; Excel + In; Chrome IP LAN 64/64; môi trường khác cần `db:seed`; CHƯA commit). Tiêu đề các trang báo cáo điều hành đã được làm to/đậm hơn theo yêu cầu chủ dự án (KPI 15px, tiêu đề khung 16px, đầu cột 13px).

**Trang "Bác sĩ" (#287, 05/11/2026) — XONG, 3/3 tab** (Hiệu suất theo bác sĩ, Cơ cấu kê đơn và chỉ định, Giờ làm việc và lượt khám; quyền `doctor_report.read` chỉ quản lý phòng khám, bác sĩ không xem; lọc Khoa; Excel + In; Chrome IP LAN 51/51; môi trường khác cần `db:seed`; CHƯA commit). Đã trích `report-export-support.ts` dùng chung cho ba service báo cáo.

**Trang "Thuốc và vật tư" (#287, 05/11/2026) — XONG 7/7 tab** (Đã phát, Lãi gộp, Kiểm soát đặc biệt là 3 tab mới; 4 tab kho Nhập-Xuất-Tồn, Tồn kho và hạn dùng, Hao hụt điều chuyển, Công nợ NCC bấm là chuyển sang trang cũ — chủ dự án chọn; quyền riêng `pharmacy_report.read` chỉ quản lý phòng khám; Excel + In; Chrome IP LAN 54/54; môi trường khác cần `db:seed`; đã push `a08cbde`). **Tab Kiểm soát đặc biệt là bảng theo dõi nội bộ, CHƯA phải mẫu báo cáo gửi cơ quan quản lý**: tra văn bản cho thấy Thông tư 20/2017/TT-BYT đã được thay bằng Thông tư 18/2026/TT-BYT (hiệu lực 16/07/2026) và Nghị định 163/2025/NĐ-CP (mẫu ở Phụ lục II) nhưng không đọc được nguyên văn mẫu dành cho phòng khám — chờ chủ dự án cung cấp/đối chiếu bản gốc (DECISIONS #287).

**Trang "Toàn hệ thống" (#287, 05/11/2026) — XONG 4/4 tab** (So sánh chi nhánh có mockup đúng số liệu; Xếp hạng, Tổng hợp tháng, Khám chéo chi nhánh chưa có hình vẽ nên dựng theo khuôn và liệt kê cột ở DECISIONS #287; dùng quyền `company_report.read`, không quyền mới, không cần `db:seed`; phạm vi mặc định "Tất cả chi nhánh"; Excel + In; Chrome IP LAN 68/68). Khám chéo chi nhánh KHÔNG hiện tiền theo bệnh nhân (#231).

**Trang "Bệnh nhân" (3 tab) và "Chuyên môn" (3 tab) (#289, 06/11/2026) — XONG** (quyền `patient_report.read`/`clinical_report.read`, cần `db:seed`; Excel + In; Chrome IP LAN 58/58 và 42/42; đã commit `701a507`). **Gửi mẫu đối tác (#291, 06/11/2026) — mockup ĐÃ DUYỆT, GĐ1 "nền" XONG và đã push (`9177cde`); GĐ2 lát cắt "Gửi mẫu đi" phía MÁY CHỦ xong + test và đã push (`306d5a0`, `43e3799`, OpenAPI đã đăng ký; CHƯA có giao diện); còn GĐ3 web "Gửi mẫu đi", GĐ2 phần nhận PDF/duyệt/ghi nợ, GĐ4, GĐ5 — đọc `docs/handoffs/HANDOFF-GuiMauDoiTac-GD3-Web-2026-11-07-p5.md`**: công tắc "Dùng đối tác xét nghiệm", đối tác = nhà cung cấp có cờ (mã `DT…`), giá trả theo cặp dịch vụ × đối tác, "Gửi đối tác" ở dịch vụ xét nghiệm; còn gửi/nhận/duyệt PDF + ghi nợ, hàng đợi, công nợ đối tác + bảng kê + Excel/In (mockup https://claude.ai/artifact/Fp4qMQ4YzYbXjfQRtProFe). Môi trường khác cần `db:deploy` và `db:seed` (quyền nhà cung cấp riêng `supplier.*`, #291 bổ sung 2).

**Trang "Chất lượng và tuân thủ" (#290, 06/11/2026) — XONG, 3/3 tab** (Lượt khám chưa hoàn tất là ảnh chụp đến hôm nay không theo kỳ, Liên thông đơn thuốc theo ngày ký đơn, Nhật ký kiểm toán dẫn sang trang cũ; quyền `quality_report.read` chỉ quản lý phòng khám, cần `db:seed`; Excel + In; API 14 ca + đột biến 4/4, Chrome IP LAN 49/49; đã commit `84fcbef`). Với trang này danh mục 39 báo cáo đã duyệt không còn nhóm nào chưa làm.

**Trang "Cập nhật phần mềm" làm lại (#288, 06/11/2026) — XONG** theo mockup chủ dự án chốt; chờ thông tin bản quyền thật (`shared/version/copyright-info.ts`). **Luồng gửi mẫu xét nghiệm cho đối tác**: chủ dự án đã chốt nghiệp vụ, mockup viết dở, CHƯA code (xem handoff).

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

**`docs/handoffs/HANDOFF-GuiMauDoiTac-GD3-Web-2026-11-07-p5.md`** (MỚI NHẤT — ĐỌC TRƯỚC, 07/11/2026 phần 9: GĐ1 + GĐ2 máy chủ + OpenAPI đã push `43e3799`, kế tiếp dựng giao diện "Gửi mẫu đi"). Bản trước (06/11 phần 8): `docs/handoffs/HANDOFF-GuiMauDoiTac-GD2-SoCongNo-2026-11-06-p4.md` ( gửi mẫu đối tác GĐ1 đã push, GĐ2 máy chủ "Gửi mẫu đi" xong nhưng chưa commit/chưa có giao diện, Sổ công nợ có lọc ngày/Excel/In; kế tiếp: commit + full API + push, đăng ký OpenAPI, giao diện hàng đợi gửi mẫu). Bản trước: `docs/handoffs/HANDOFF-BaoCaoChatLuongTuanThu-GuiMauDoiTac-2026-11-06-p3.md`.

## Cách đọc các tài liệu dài (chốt 20/10/2026)

`docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/CURRENT.md`, `docs/ERD.md` luôn là PHIÊN BẢN MỚI NHẤT; phần cũ ở `docs/archive/` (và nhóm bảng ERD mở rộng ở `docs/ERD-2.md`). Chỉ đọc file gốc; chỉ mở archive khi cần tra mục cụ thể. Chi tiết quy ước ở `CLAUDE.md`.

## Lưu ý môi trường

- Máy dev: Node v26, Docker Desktop. **Postgres container map ra cổng 5433** (máy dev có Postgres native chiếm 5432); `DATABASE_URL` trong `.env` đã trỏ 5433. Mật khẩu role `nexamed_app` hard-code trong migration chỉ dùng cho local/CI — **bắt buộc đổi** khi triển khai on-prem thật (`docs/DECISIONS.md` #010).
- Môi trường khác sau khi lấy mã mới cần: `pnpm install`, `db:deploy`, `db:seed`, khởi động lại API (migration mới nhất `20261105100000_print_report_document`).
- Windows: Git Bash đổi giá trị biến môi trường bắt đầu bằng `/` thành đường dẫn Windows (đặt `MSYS_NO_PATHCONV=1`); `prisma generate` lỗi EPERM khi dev server đang chạy (tắt `pnpm dev` trước); full test API cùng lúc dev server + Chrome có thể báo "paging file is too small"/"Memory allocation error" — tắt dev server rồi chạy nền một mình (~7 phút). Tài liệu `docs/*.md` nhiều file CRLF/LF lẫn lộn — script vá phải nhận biết kiểu xuống dòng từng đoạn (không dùng `node -e` nhiều dòng có dấu backtick trong Bash).
- Kiểm giao diện bằng Chrome thật qua IP LAN: `pnpm dev:lan` (tự khôi phục `config.json`), `scripts/ui-audit/` (README). `playwright-core` cài ở thư mục tạm, không đưa vào repo.
