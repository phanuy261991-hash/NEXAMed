# Kế hoạch hệ thống báo cáo — NEXAMed

> Lập 02/11/2026 theo yêu cầu chủ dự án ("bắt đầu xây dựng hệ thống báo cáo"). Quyết định lưu vết ở `docs/DECISIONS.md` #279. Tài liệu này là KẾ HOẠCH — chưa code gì, chưa có mockup được duyệt.

## 1. Phạm vi — đã mở rộng v1 (chủ dự án chốt 02/11/2026)

`CLAUDE.md` và `docs/product/prd.md` (dòng 23, 176, 223, 368) trước đây xếp **"báo cáo doanh thu theo kỳ (doanh thu/công nợ/lãi lỗ)" ngoài v1**, hẹn v2. Chủ dự án **chốt mở rộng v1** để làm hệ thống báo cáo, theo đúng tiền lệ 5 lần mở rộng trước (#072 Thu ngân, #146 Kho, #180 Công nợ NCC, #212 Cận lâm sàng, #231 Chi nhánh).

**Vẫn ngoài v1** (không đổi): bảng giá đa đối tượng, BHYT tính chi trả, công nợ/trả góp BỆNH NHÂN.

Khi bắt đầu code phải sửa cho khớp: `CLAUDE.md` (mục Phạm vi v1 + dòng "Vẫn KHÔNG thuộc v1"), `docs/product/prd.md` 4 dòng trên, `docs/product/plan.md`.

## 2. Bảy điểm đã chốt (02/11/2026)

| # | Điểm | Chốt |
|---|---|---|
| 1 | Phạm vi | Mở rộng v1, **gồm** báo cáo doanh thu theo kỳ |
| 2 | Định nghĩa doanh thu | **Hiện song song** 2 cột "Ghi nhận" (theo ngày khám) + "Thực thu" (theo ngày thu tiền) + cột chênh lệch = chưa thu |
| 3 | Việc đầu tiên | **Trang Tổng quan (A1) + Báo cáo ngày (A2)** |
| 4 | Báo cáo theo bác sĩ (B2) | Làm; mỗi bác sĩ xem được số **của chính mình** (phạm vi `personal`), không thấy của người khác |
| 5 | Menu | Tạo **nhóm "Báo cáo" mới** cho báo cáo MỚI; 2 báo cáo cũ (Báo cáo dòng tiền, Nhập-Xuất-Tồn) **để nguyên tại chỗ** |
| 6 | Trang Tổng quan | **Khác theo vai trò** (bác sĩ / thu ngân / lễ tân / chủ phòng khám) |
| 7 | Làm mới số | **Chỉ khi bấm** — tải một lần khi vào trang, có nút "Làm mới" + ghi rõ "Số lúc HH:MM". Không tự động làm mới |

## 3. Đã có sẵn gì (KHÔNG làm lại)

| Đã có | Nguồn dữ liệu | Nơi |
|---|---|---|
| Báo cáo dòng tiền (theo Loại thu chi / quỹ / chi nhánh, Excel) | `payment` + `cash_voucher` | `/cash-book/report` |
| Sổ quỹ (số dư luỹ kế) | `cash_voucher` | `/cash-book/ledger` |
| Báo cáo Nhập-Xuất-Tồn + tab Hao hụt điều chuyển (Excel) | `stock_ledger` | `/inventory/reports/stock-ledger` |
| Tồn kho + Cảnh báo hạn dùng | `stock_balance`, `inventory_batch` | `/inventory/balances` |
| Tổng kết thu cuối ngày + Phiếu chốt ca | `invoice`, `cashier_shift` | Thu ngân |
| Công nợ NCC + đối chiếu chốt kỳ | `supplier_debt_*` | `/suppliers/debts` |
| Ví tạm ứng tổng hợp | `patient_wallet` | `/cash-book/wallets` |

**Kết luận khảo sát**: mảng tiền mặt và mảng kho đã khá đầy. Chỗ trống lớn là **mảng lâm sàng/vận hành** (lượt khám, bác sĩ, bệnh nhân, chẩn đoán, thời gian chờ) — gần như chưa có báo cáo nào.

**Chỗ trống rõ nhất**: `apps/web/src/features/dashboard/DashboardPage.tsx` — trang "Tổng quan" sau đăng nhập vẫn là khung rỗng đặt chỗ từ Sprint 1, ghi "sẽ hiện ở đây khi các module tương ứng ra đời". Các module đó đã ra đời từ lâu. Đây là thứ khách nhìn thấy đầu tiên mỗi ngày.

## 4. Danh mục báo cáo theo cấp độ quy mô

Ba cấp **cộng dồn**: cấp 2 gồm cả cấp 1, cấp 3 gồm cả hai.

### Cấp 1 — Phòng khám nhỏ (1–3 bác sĩ, 1 chi nhánh, ~20–60 lượt/ngày)

Chủ phòng khám thường chính là bác sĩ. Nhu cầu thật: **chốt ngày cho đúng tiền, và có sổ sách thay sổ giấy**. Chu kỳ chủ yếu là NGÀY, phải in được.

| # | Báo cáo | Ghi chú |
|---|---|---|
| A1 | **Trang Tổng quan hôm nay** — lượt khám theo trạng thái, đã thu/chưa thu, hàng đợi, thuốc sắp hết/sắp hết hạn | Lấp khung rỗng hiện tại. Khác theo vai trò (điểm chốt 6) |
| A2 | **Báo cáo ngày** một trang in được — số lượt (khám mới/tái khám), tiền thu theo phương thức, số phiếu chưa thu | Gộp số lâm sàng vào tổng kết thu đã có |
| A3 | **Sổ khám bệnh theo kỳ** — mã BN, tên, tuổi, giới, chẩn đoán ICD-10, bác sĩ, dịch vụ, tiền | Báo cáo **thay sổ giấy** — gắn trực tiếp điều kiện GA "pilot ngừng dùng sổ giấy hoàn toàn" |
| A4 | **Thống kê dịch vụ đã dùng** — số lượt + tiền theo từng dịch vụ khám/kỹ thuật/gói | |
| A5 | **Thống kê thuốc & VTYT đã phát** — theo mặt hàng | Góc "bán cho bệnh nhân", khác góc "biến động kho" của N-X-T |
| A6 | **Thuốc kiểm soát đặc biệt** (hướng thần/gây nghiện) | Cờ `is_psychotropic`/`is_narcotic` đã có trong `drug`. **Mẫu biểu + kỳ báo cáo PHẢI tra văn bản hiện hành trước** — chưa tra, không khẳng định |

### Cấp 2 — Phòng khám vừa (nhiều bác sĩ/phòng, có thu ngân riêng, ~100–300 lượt/ngày)

Đã có tầng quản lý: chủ không còn thấy hết mọi việc, cần **so sánh, xu hướng, số theo từng người**.

| # | Báo cáo | Ghi chú |
|---|---|---|
| B1 | **Doanh thu theo kỳ** — theo ngày/tháng, chia nhóm Khám / Cận lâm sàng / Thuốc / Gói, so kỳ trước | Phần vượt phạm vi v1 cũ. 2 cột Ghi nhận + Thực thu (điểm chốt 2) |
| B2 | **Theo bác sĩ** — số lượt, doanh thu sinh ra, tỉ lệ kê CLS/thuốc | Bác sĩ xem số của chính mình (điểm chốt 4) |
| B3 | **Theo thu ngân** — tổng hợp nhiều ca theo kỳ, lệch két lặp lại | Mở rộng Chốt ca đã có |
| B4 | **Bệnh nhân** — mới/cũ, tần suất quay lại, theo địa bàn | Module `geo` đã có |
| B5 | **Cơ cấu chẩn đoán ICD-10** (top bệnh) | Dùng để đặt thuốc và mở dịch vụ |
| B6 | **Tái khám** — đã hẹn / đã đến / không đến | Dựa #222 Điều trị & Hẹn tái khám |
| B7 | **Huỷ & không đến** theo kỳ + lý do | `CANCELLED` / `NO_SHOW` |
| B8 | **Lượt khám theo giờ / theo thứ** | Để xếp ca — nối Lịch làm việc |
| B9 | **Thời gian chờ** `CHECKED_IN → IN_CONSULTATION` | Chỉ số vận hành thật; state machine đã có đủ mốc giờ |
| B10 | **Cận lâm sàng** — số chỉ định, thời gian trả kết quả, số quá hạn | |
| B11 | **Lãi gộp thuốc** (tiền bán − giá vốn) | Giá vốn có trong `stock_ledger`. Chạm "lãi lỗ" — cần chốt riêng trước khi làm |

### Cấp 3 — Nhiều chi nhánh

| # | Báo cáo | Ghi chú |
|---|---|---|
| C1 | **Bảng so sánh chi nhánh** — một dòng mỗi chi nhánh, mọi KPI chính | Thứ chủ đầu tư xem đầu tiên |
| C2 | **Mọi báo cáo cấp 1–2 + bộ chọn Phạm vi** | #235 **bắt buộc** dùng lại `ReportBranchScopeService` + `useReportScope` / `ReportScopeControl` |
| C3 | **Tổng hợp toàn công ty theo tháng** (bản gửi chủ đầu tư) | |
| C4 | **Khám chéo chi nhánh** — bệnh nhân dùng chung cả công ty | Ngoại lệ #231: tiền của chi nhánh không được gán phải che |
| C5 | **Xếp hạng** dịch vụ / bác sĩ / thuốc theo chi nhánh | |

### Báo cáo gửi cơ quan quản lý (trục riêng, áp mọi cấp)

Chưa tra cứu. Phải xác nhận **nguyên văn văn bản hiện hành** trước khi làm, đúng cách đã làm ở #270 (Thông tư 13/2025). Nhóm ứng viên: báo cáo hoạt động khám chữa bệnh định kỳ gửi Sở Y tế; thuốc kiểm soát đặc biệt (A6); bệnh truyền nhiễm. **Không tự suy diễn mẫu biểu.**

## 5. Chuẩn định dạng báo cáo (áp cho MỌI báo cáo, không mỗi trang một kiểu)

**Bốn lớp xuất** (từ 05/11/2026 MỌI báo cáo bắt buộc có cả Excel lẫn In trực tiếp, chủ dự án chốt, #287):
1. **Màn hình** — xem và đào sâu (bấm số tổng → ra danh sách chi tiết)
2. **Excel** — qua `exceljs` ở máy chủ (nguyên tắc hiệu năng #073, đã có tiền lệ ở 2 báo cáo cũ)
3. **PDF / In** — cho báo cáo phải ký, lưu, hoặc gửi cơ quan; dùng `shared/print/PrintDocument` + `PrintButton` (ui-guidelines mục 13)
4. *(để sau)* Gửi định kỳ tự động — chưa làm, chỉ để đường mở

**Khung chuẩn mỗi trang báo cáo:**
```
Thanh lọc:     [Kỳ: hôm nay|tuần|tháng|quý|năm|tuỳ chọn]  [Phạm vi chi nhánh]  [lọc riêng]
Dải KPI:       StatCardRow (một dải liền, màu ở chữ số) — KHÔNG thẻ viền + thanh màu bên
Biểu đồ:       TrendChart dùng chung — CHỈ khi xu hướng có nghĩa, không vẽ cho đẹp
Bảng chi tiết: div role="table" + gridTemplateColumns; header và row CÙNG cột VÀ CÙNG gap-x
Nút:           Xuất Excel | In | Làm mới ("Số lúc HH:MM")
```
Theo ui-guidelines mục 14: **báo cáo cùng nhóm gộp thành tab của một trang** (`TabBar variant="underline"`, tab nhớ trong `?tab=`) thay vì thêm menu riêng. Đủ 4 trạng thái giao diện (mục 3): Skeleton / Empty / Error inline có "Thử lại" / Ideal.

**Đầu mỗi bản Excel và PDF** (hiện chưa chuẩn hoá, cần làm thành phần dùng chung): tên phòng khám + chi nhánh, tên báo cáo, kỳ, phạm vi, người xuất, thời điểm xuất.

**Quyền**: theo quy ước đang dùng `<module>.report` (như `cash_voucher.report`, `stock_receipt.report`), cộng `company_report.read` cho bản gộp nhiều chi nhánh (#235).

## 6. Vấn đề kỹ thuật phải xử lý (phát hiện khi khảo sát)

1. **Nguồn sự thật của tiền** — phải dùng `dueAmount` (tính qua `computeInvoiceDiscount()` ở `@nexamed/core`, đã trừ chiết khấu) **trừ** các dòng `payment` có `type='REFUND'`. **KHÔNG** dùng `invoice.total_amount` — đó là số GROSS trước chiết khấu. Bẫy này chắc chắn sai nếu không ghi rõ từ đầu.

2. **Mốc ngày theo giờ Việt Nam** — chuỗi `+07:00` đang viết cứng rải rác **7 chỗ** (`cash-book-report`, `stock-ledger-report`, `stock-issue`, `stock-receipt`, `stock-transfer`, `supplier-debt`, `prescription-submission`), và `startOfDayVn` đã bị nhân bản. Báo cáo nhóm theo ngày/tuần/tháng/quý sẽ nhân số chỗ này lên nhiều lần. **Trích một helper dùng chung ở `packages/shared` TRƯỚC** (đúng quy tắc "trùng lặp lần hai phải trích xuất"). Không làm thì một lần thu lúc 23:30 rơi sai ngày.

3. **Tính trực tiếp hay bảng tổng hợp đêm** — khuyến nghị: **tính trực tiếp + thêm index**, đo thật với dữ liệu một năm, chỉ làm bảng rollup khi đo thấy chậm. Lý do: máy on-prem của phòng khám tắt buổi tối (đã gặp ở #244 — job 2 giờ sáng chưa từng chạy), nên rollup đêm là thứ dễ hỏng âm thầm.

4. **Ràng buộc bắt buộc của module mới**: 4 câu hỏi chi nhánh (#231) — báo cáo là dữ liệu THEO CHI NHÁNH, lọc qua `requireBranchId()`; một request MỘT transaction (#264) — không gọi port từ trong `runInTenantScope()`; nhãn audit tiếng Việt cho mọi action/entityType (#213, test `audit-labels-coverage.spec.ts` chặn); tự xử lý đủ trạng thái lỗi (#255 + ui-guidelines 17b); kiểm Chrome qua **IP LAN HTTP** không chỉ localhost (#257).

## 7. Lộ trình đề xuất

| Đợt | Nội dung | Phụ thuộc |
|---|---|---|
| 0 | Helper mốc ngày giờ VN dùng chung + đầu báo cáo Excel/PDF dùng chung + nhóm menu "Báo cáo" | Không |
| 1 | **A1 Trang Tổng quan theo vai trò + A2 Báo cáo ngày** ← chủ dự án chọn làm trước | Đợt 0 |
| 2 | A3 Sổ khám bệnh + A4 dịch vụ + A5 thuốc đã phát | Đợt 1 |
| 3 | B1 Doanh thu theo kỳ (2 cột Ghi nhận/Thực thu) + B2 theo bác sĩ | Đợt 2 |
| 4 | B4–B10 vận hành & bệnh nhân | Đợt 3 |
| 5 | C1–C5 nhiều chi nhánh (dùng lại `ReportScopeControl`) | Đợt 3 |
| sau | A6 + báo cáo gửi cơ quan (cần tra văn bản), B11 lãi gộp (cần chốt riêng) | Chủ dự án |

## 8. Chưa chốt / cần chủ dự án

- **Mockup Trang Tổng quan 4 vai trò** — ĐÃ DỰNG 02/11/2026: https://claude.ai/artifact/TmC456MFRXBGAWYPkWFPs1 (4 artboard: Chủ phòng khám / Bác sĩ / Thu ngân / Lễ tân; ghi chú duyệt nằm ở sticky trên canvas, KHÔNG nằm trong giao diện). **Chờ chủ dự án duyệt tường minh trước khi code** (quy tắc dự án: "tiếp tục công việc" không phải duyệt mockup). 4 câu cần chốt ghi ở sticky xanh của canvas.
- B11 lãi gộp thuốc: có làm hay không (chạm lãi lỗ).
- A6 + báo cáo gửi cơ quan: cần tra văn bản hiện hành trước.
- Trang Tổng quan cho vai trò nào trước nếu muốn chia nhỏ (bác sĩ / thu ngân / lễ tân / chủ phòng khám).

## 9. Dữ liệu khả dụng cho Trang Tổng quan (kiểm 02/11/2026)

**Có sẵn, tái dùng được — không cần backend mới:**

| Số liệu | Nguồn |
|---|---|
| Lượt khám hôm nay theo trạng thái (tổng / chờ / đang khám / xong / huỷ+không đến / chưa thu) | `GET /reception/list` → `counts` (`computeReceptionDayCounts`, `packages/core/src/list-paging/day-list-filters.ts`) |
| Tiền hôm nay: đã thu / chờ thu / đã hoàn / **thực thu** + số phiếu từng nhóm | `GET /invoices` → `totals` (`computeDailyBillingTotals`, `packages/core/src/billing/invoice-lifecycle.ts`) |
| Ca thu ngân đang mở + tổng kết ca | `GET /cashier-shift/current`, `GET /cashier-shift/:id/summary` |
| Hàng đợi bác sĩ | `GET /reception/list` |
| Kết quả cận lâm sàng mới chưa xem của bác sĩ | `GET /reception/doctor-queue/unseen-results` |
| Ca làm việc hôm nay + nhắc đóng ca (#266) | `GET /doctor-availability/today`, `me/closing-state`, `pending-closures` |
| Hàng đợi xét nghiệm / CĐHA | `GET /lab-results/queue`, `GET /imaging-results/queue` |
| Thuốc sắp hết **hạn** | `GET /stock-balances/expiry-warnings` |
| Lịch hẹn | `GET /appointments` |

**Tin tốt**: `computeDailyBillingTotals` ĐÃ dùng `dueAmount` (sau chiết khấu) và đã tách sẵn "đã thu / đã hoàn / thực thu" — cái bẫy tiền ở mục 6.1 đã được xử lý từ trước ở tầng lõi, chỉ cần tái dùng đúng, không tự tính lại.

**Chưa có — phải làm mới (đều nhỏ, nằm trong đợt 1 nếu mockup được duyệt):**

| Số liệu | Vì sao chưa có |
|---|---|
| Thuốc sắp **HẾT** (tồn dưới ngưỡng) | `drug.minStockAlert` CÓ cột và có cả trong nhập Excel, nhưng **chưa nơi nào so với `stock_balance`** — không endpoint nào dùng nó. Cần endpoint mới |
| Hẹn tái khám đến hạn / quá hạn | `encounter_treatment_plan.followUpDate` có lưu (#222) nhưng chưa có endpoint truy vấn theo ngày |
| Phân loại Khám mới / Tái khám | Có Loại tiếp nhận (#270) nhưng chưa có số đếm |
| So sánh hôm qua / kỳ trước | Chưa có |

## 10. Màn hình "Tổng quan toàn hệ thống" — chủ dự án yêu cầu trực tiếp 02/11/2026

Nâng C1 + C3 (mục 4, cấp 3) lên thành một màn hình riêng, chủ dự án yêu cầu: xem doanh thu và số lượt khám của **tất cả chi nhánh trên cùng một trang**, so sánh theo **ngày và tháng**, biết ngày đó toàn hệ thống thu bao nhiêu / bao nhiêu bệnh nhân / bao nhiêu dịch vụ, và có **biểu đồ so cùng kỳ tháng trước**.

**Mockup** (artboard "Toàn hệ thống" ở https://claude.ai/artifact/TmC456MFRXBGAWYPkWFPs1): dải KPI toàn công ty (Thực thu / Lượt khám / Bệnh nhân / Dịch vụ đã dùng, mỗi số kèm giá trị cùng kỳ tháng trước) → biểu đồ đường "tháng này vs tháng trước" (nét liền / nét đứt + chú giải, đúng luật "phân biệt chuỗi bằng kiểu nét không chỉ bằng màu") → khối "Hôm nay toàn hệ thống" → bảng so sánh chi nhánh (Lượt khám / Bệnh nhân / Dịch vụ / Thực thu / So cùng kỳ + vạch cùng kỳ trên thanh) → Thực thu theo nhóm → Lượt khám 6 tháng.

**Ràng buộc**: quyền `company_report.read` (#235) + dùng lại `ReportBranchScopeService` (máy chủ) và `useReportScope`/`ReportScopeControl` (web) — KHÔNG dựng bộ chọn phạm vi riêng. Nằm trong nhóm menu "Báo cáo" (điểm chốt 5 ở mục 2). Dữ liệu theo CHI NHÁNH, gộp lại khi có quyền; công ty 1 chi nhánh thì ẩn cột/bộ chọn chi nhánh (#231 câu 4).

**Chưa có ở máy chủ, phải làm mới cho màn này**:

| Số liệu | Ghi chú |
|---|---|
| Số **bệnh nhân duy nhất** trong kỳ | Khác số lượt khám; cần `COUNT(DISTINCT patient_id)` theo kỳ + chi nhánh |
| Số **dịch vụ đã dùng** | Đếm từ `encounter_service_item`; cần chốt đếm theo DÒNG chỉ định hay theo lượt dùng |
| Mọi phép **so cùng kỳ** (tháng trước, hôm qua) | Chưa có endpoint nào trả hai kỳ cùng lúc |
| Chuỗi theo ngày / theo tháng cho biểu đồ | Cần nhóm theo ngày giờ VN — xem bẫy ở mục 6.2 |
| Số "khám lần đầu" | Dựa vào lượt khám đầu tiên của bệnh nhân, chưa có |

**Câu chưa chốt**: "dịch vụ" đếm theo dòng hay theo lượt dùng; có thêm lãi gộp thuốc và xếp hạng bác sĩ toàn công ty vào màn này không; chỉ tiêu tháng cần bảng nhập mục tiêu (chưa có trong hệ thống) — làm hay bỏ.

## 11. Bài học về kiểu giao diện (02/11/2026)

Ba lần chủ dự án bác mockup vì **kiểu**, không vì bố cục. Nguyên nhân gốc: tôi thiết kế từ bảng token trong `.claude/docs/ui-guidelines.md` mà **không đọc component thật**. Bảng token nói đúng MÀU nhưng không nói độ mềm.

**Phải đọc code thật trước khi thiết kế** (`StatCard.tsx`, `BoxedSection.tsx`, `NoticeRow.tsx`, `Button.tsx`, `SegmentedToggle.tsx`, và một trang cùng loại — ví dụ `CashFlowReportPage.tsx` cho báo cáo). Kiểu thật của app:

- Thẻ: `rounded-lg border border-slate-200 bg-white shadow-sm` — viền MỀM + bóng nhẹ, KHÔNG viền xám đậm
- Dải KPI: `rounded-xl border-slate-200`, đường chia `h-10 w-px self-center` (NỬA chiều cao — full-height bị chê "cứng"), nội dung canh giữa, icon Phosphor phẳng tô màu cạnh nhãn, số `text-2xl font-semibold tabular-nums` TÔ MÀU theo tone
- Đầu khối: `bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-800`
- Đầu bảng: `text-xs font-semibold uppercase tracking-wide text-slate-600` + `border-b border-slate-100` — KHÔNG tô nền, KHÔNG gạch 2px màu
- Kẻ dòng: `border-slate-50`; dòng tổng `bg-slate-50 font-semibold`
- **Sức sống nằm ở MÀU TRÊN CON SỐ**: `text-emerald-700` tiền thu, `text-rose-700` tiền chi, `text-blue-600` số chốt, `text-slate-900` trung tính
- Nút: `rounded-md px-4 py-2 text-sm font-medium`; nút phụ dùng `ring-1 ring-inset ring-slate-300` chứ không phải `border`
