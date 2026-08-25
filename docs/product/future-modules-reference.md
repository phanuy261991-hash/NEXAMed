# Future Modules Reference — Dược/Kho, Viện phí, Danh mục dùng chung, Luồng khám mở rộng

**Trạng thái**: Tài liệu **tham khảo**, chưa chốt. Nguồn: 3 bản đặc tả do chủ dự án cung cấp (`DanhMụDungChung.md`, `Thietke_databse.md`, `luong_congviec.md`) — viết cho một hệ thống HIS/EMR tổng quát, **không phải viết riêng cho kiến trúc NEXAMed đã chốt**.

**Không áp dụng trực tiếp.** Không copy schema/tên bảng/state machine trong tài liệu này vào code. Trước khi hiện thực hoá bất kỳ phần nào, đối chiếu lại với `.claude/docs/data-model.md`, `.claude/docs/clinical-workflow.md`, `.claude/docs/multi-tenancy.md`, `.claude/docs/coding-standards.md` và hỏi chủ dự án nếu có mâu thuẫn — theo đúng nguyên tắc "không tự ý thay đổi cấu trúc đã chốt" trong `CLAUDE.md`.

**Phạm vi**: Phần lớn nội dung thuộc Dược/kho, Viện phí/thanh toán, BHYT — đều **ngoài phạm vi v1** (`CLAUDE.md`). Xem `docs/product/prd.md` Appendix A để biết module nào rơi vào phase nào (v2 = viện phí/thanh toán, v2.1 = dược/kho, v3 = BHYT + chữ ký số).

---

## 1. Mâu thuẫn đã biết với những gì đã chốt ở v1 (phải hoà giải trước khi dùng)

| # | Nguồn (3 file) | Đã chốt ở NEXAMed | Ghi chú |
|---|---|---|---|
| 1 | `encounter.status`: `CHO_KHAM`/`DANG_KHAM`/`HOAN_THANH`/`HUY` | `SCHEDULED`/`CHECKED_IN`/`IN_CONSULTATION`/`COMPLETED`/`CANCELLED`/`NO_SHOW` (đã code, đã áp migration thật) | Không đổi lại theo nguồn mới |
| 2 | Tên bảng/cột PascalCase, tiếng Việt không dấu (`Patients`, `HoTen`, `NgaySinh`, `Encounter_ID`...) | snake_case, tiếng Anh (`patient`, `full_name`, `dob`, `encounter_no`...) — `.claude/docs/coding-standards.md` | Không copy nguyên tên |
| 3 | Không nhắc `tenant_id`/RLS ở bất kỳ bảng nào | Mọi bảng nghiệp vụ bắt buộc `tenant_id` + RLS (`.claude/docs/multi-tenancy.md`) | Phải tự bổ sung khi hiện thực hoá |
| 4 | Không nhắc bộ 8 cột bắt buộc (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `version`, `created_by`, `updated_by`) | Bắt buộc trên mọi bảng nghiệp vụ (`.claude/docs/data-model.md`) | Phải tự bổ sung |
| 5 | Đề xuất module Dược/kho, Viện phí, BHYT XML | Ngoài phạm vi v1 — không viết code (`CLAUDE.md`) | Chỉ tham khảo cho v2/v2.1/v3 |
| 6 | Tiền dùng `Decimal` | Bắt buộc `bigint` đơn vị đồng, cấm `numeric`/`decimal` (`CLAUDE.md`, `.claude/docs/data-model.md`) | Phải đổi kiểu khi hiện thực hoá |

---

## 2. Ý tưởng kiến trúc đáng giữ lại (đối chiếu lại khi tới phase tương ứng)

### 2.1. Danh mục dùng chung (v1.1+/v2, đối chiếu `PatientIdentityPort` và các danh mục hiện có)

- **Địa giới hành chính** (`Ref_Administrative_Boundaries`): mã Tỉnh/Huyện/Xã chuẩn Tổng cục Thống kê, phục vụ trích xuất XML BHYT (Quyết định 130) — cần cho v3 (tích hợp BHYT).
- **Dân tộc, Nghề nghiệp** (`Ref_Ethnicity`, `Ref_Occupation`): danh mục chuẩn BYT phục vụ báo cáo thống kê.
- **Đối tượng bệnh nhân** (`Ref_Patient_Types`): `VIEN_PHI`/`BHYT`/`BH_TU_NHAN` — liên quan trực tiếp tới v2 (viện phí) và v3 (BHYT).
- **Mã cơ sở KCB ban đầu** (`Ref_BHYT_KCB_Facility`): phục vụ check thẻ BHYT, xác định đúng/trái tuyến — v3.
- **Khoa/phòng** (`Departments`) đã có sẵn ở v1 (`department` — phục vụ Data Scope), nhưng nguồn này gợi ý phân loại `LoaiKhoaPhong` (`CLINICAL`/`LAB`/`PHARMACY`/`CASHIER`) — cân nhắc khi có nhiều loại phòng hơn ở v2+.
- **Chức danh y tế** (`Staff_Titles`): tách biệt khỏi RBAC role — NEXAMed hiện dùng `role` (RBAC) làm cả hai vai trò (quyền + chức danh hiển thị). Cân nhắc tách nếu sau này cần hiển thị chức danh không gắn với quyền hệ thống.
- **Đường dùng thuốc, đơn vị tính, mẫu ghi chú soạn sẵn** (`Ref_Administration_Routes`, `Ref_Units`, `Clinical_Templates`): liên quan `PRE-01` (kê đơn) và `ENC-07` (mẫu ghi chú, hiện là P2). Danh mục chuẩn hoá tốt hơn nhập tự do — cân nhắc khi làm module `drug`/`prescription` (S4) và khi làm `ENC-07`.
- **Dịch vụ kỹ thuật, chỉ số xét nghiệm** (`Services`, `Lab_Test_Indices`): thuộc v3+ (cận lâm sàng LIS, đã liệt kê ngoài phạm vi trong `docs/ERD.md` mục 7).
- **Bảng giá đa đối tượng** (`Price_Books`, `Price_Book_Details`, `getPrice()` service): thuộc v2 (viện phí). Ý tưởng tách bảng giá khỏi danh mục gốc, quản lý theo đối tượng bệnh nhân (viện phí/BHYT/BH tư nhân) là hướng hợp lý cho `invoice`/`invoice_line` ở v2.
- **Hình thức thanh toán** (`Ref_Payment_Methods`): v2.

### 2.2. Dược/kho (v2.1 — ngoài phạm vi v1 hoàn toàn)

- **Mô hình `Items` hợp nhất**: gộp Thuốc/VTYT/VTTH vào một bảng master, tách thuộc tính chuyên biệt qua bảng 1-1 (`Medication_Attributes`, `Supply_Attributes`) thay vì nhiều cột NULL. Ý tưởng hợp lý — đối chiếu với `drug` hiện tại (v1, theo tenant, không có phân loại VTYT/VTTH vì v1 không quản lý kho).
- **Kho theo lô + hạn dùng + FEFO**: `Warehouses`, `Item_Stocks` (kho/lô/hạn), `Stock_Ledger` (thẻ kho append-only) — thuật toán FEFO (First Expire, First Out) khi xuất/cấp phát.
- **Luồng dược 2 pha**: bác sĩ kê đơn (`Prescription` trạng thái `PENDING`, chưa trừ kho) → dược sĩ xác nhận phát (`DISPENSED`, trừ kho thật trong transaction, ghi thẻ kho). Đáng chú ý: NEXAMed v1 `prescription` **chỉ ghi nhận và in**, không có khái niệm "phát thuốc"/pha 2 — nếu v2.1 thêm dược/kho thật, cần bàn lại có tách `Prescription` (ý định bác sĩ) khỏi một bảng `Dispense` (thực thi) hay không.
- **Định mức tiêu hao tự động (Medical BOM)**: `Service_BOM` gắn vào `Services`, tự động trừ kho VTTH khi dịch vụ hoàn tất qua event (`ServiceCompletedEvent`) — khớp nguyên tắc "domain event, không import chéo module" đã có trong `.claude/docs/architecture.md`/`coding-standards.md`. Có thể tái dùng cơ chế event bus hiện tại (`EventBusPort`) khi tới lượt.
- **Hoạt chất chuẩn + cảnh báo tương tác**: `Master_Active_Ingredients`, `Drug_Ingredients` — mở rộng của `PRE-02` (cảnh báo trùng hoạt chất, hiện P0 ở v1 nhưng v1 không có bảng hoạt chất chuẩn, chỉ so trực tiếp `active_ingredient` text trên `drug`). Cân nhắc tách bảng hoạt chất chuẩn nếu cần cảnh báo tương tác thuốc (không chỉ trùng hoạt chất) ở phase sau.

#### 2.2.1. Đặc tả UI/luồng "tách Đơn thuốc y khoa khỏi Hoá đơn bán hàng" (chủ dự án cung cấp 2026-08-25, trước khi bắt đầu Sprint 4)

**Nguyên tắc cốt lõi**: Đơn thuốc y khoa (của bác sĩ) là hồ sơ bệnh án mang tính pháp lý — sau khi bác sĩ ký/lưu, bộ phận khác không được xoá/sửa số lượng trên chính đơn đó (khớp `SignableEntity`/`isSigned()` đã có ở `packages/core`, cùng nguyên tắc `clinical_note`). Hoá đơn thu tiền & phiếu xuất kho (của quầy thuốc/thu ngân) là chứng từ thương mại riêng — dược sĩ/thu ngân được sửa (bớt thuốc, giảm số lượng) theo thực tế khách mua, **không sửa lên bản ghi đơn thuốc gốc**.

**Xác nhận qua `AskUserQuestion` (2026-08-25)**: đã đối chiếu với `CLAUDE.md` — mô tả dưới đây vượt phạm vi v1 (đòi hỏi kho tồn kho thật + danh mục thuốc quốc gia + hoá đơn tiền thuốc, cả ba đều ngoài v1). Chủ dự án chọn **giữ Sprint 4 đúng phạm vi v1 đã chốt** (kê đơn chỉ ghi nhận + in, không kho — đúng "Trường hợp A" bên dưới đã khớp sẵn với thiết kế hiện tại). Toàn bộ mô tả này ghi lại làm đặc tả CHI TIẾT cho v2.1, dùng khi thật sự bắt đầu module dược/kho — không tự suy diễn/rút gọn khi tới lượt, đọc lại nguyên văn.

**Giao diện màn hình kê đơn (bác sĩ)** — ô tìm thuốc gắn 2 Tab/Radio ngay trên ô tìm kiếm:
- **Tab "Thuốc phòng khám" (kho nội bộ)**: dữ liệu từ danh mục kho của chính phòng khám. Gõ "Augmentin" → dropdown: `Augmentin 1g | Tồn kho: 50 viên | Giá: 18.000đ`. Bác sĩ không kê vượt tồn kho hiển thị.
- **Tab "Thuốc ngoài" (từ điển thuốc)**: dữ liệu từ danh mục thuốc quốc gia (MIMS/Dược thư) do phần mềm cung cấp sẵn (khớp `drug_catalog` toàn hệ thống đã dự trù ở mục 2.2, E3 `docs/ERD.md`). Gõ "Augmentin" → dropdown: `Augmentin 1g | Kháng sinh | (Mua ngoài)` — không tồn kho/giá.

**Trường hợp A — phòng khám KHÔNG có kho thuốc** (chỉ khám và kê đơn — **đây là toàn bộ phạm vi v1 hiện tại**, không cần thay đổi gì để đạt được): admin tắt module "Quản lý kho" → Tab "Thuốc phòng khám" tự ẩn, bác sĩ mặc định chỉ dùng "Từ điển thuốc ngoài". Kê đơn → in đơn thuốc tiêu chuẩn tại phòng khám. Hệ thống chỉ ghi nhận tiền công khám vào doanh thu, **không** sinh phiếu xuất kho/hoá đơn tiền thuốc — bệnh nhân cầm đơn ra ngoài mua.

**Trường hợp B — phòng khám CÓ kho thuốc và thu tiền**: admin bật "Kho dược" + "Thu ngân", bác sĩ mặc định dùng Tab "Thuốc phòng khám" (thấy tồn kho để cân nhắc). Bấm **"Hoàn thành & Chuyển thu ngân"** thay vì in ngay — máy in tại phòng khám **KHÔNG** in đơn lúc này (tránh bệnh nhân cầm đơn bỏ đi không thanh toán). Hệ thống đẩy trạng thái bệnh nhân sang màn hình Thu ngân/Dược sĩ (tab "Chờ thanh toán"), bill tự tổng hợp **Tiền khám + Tiền thuốc**. Thu ngân bấm **"Xác nhận thu & Xuất kho"** → in 2 bản: hoá đơn thu tiền (cho bệnh nhân) và đơn thuốc kèm liều dùng (để dược sĩ nhặt thuốc) → hệ thống tự trừ tồn kho.

**Kịch bản "lai"** (bác sĩ kê 3 loại, kho chỉ có 2 loại): bác sĩ kê 2 loại đầu ở Tab "Thuốc phòng khám", loại thứ 3 chuyển sang Tab "Thuốc ngoài" + tick **"Bệnh nhân tự mua"**. Hệ thống tách luồng: (1) dữ liệu xuống Thu ngân chỉ tính tiền + xuất kho cho 2 loại của phòng khám; (2) đơn thuốc in cho bệnh nhân vẫn hiển thị đủ cả 3 loại, dòng thứ 3 có ghi chú "Thuốc mua ngoài / Bệnh nhân tự túc".

**Ý nghĩa kiến trúc khi hiện thực v2.1**: tách "Từ điển thuốc" (kê đơn y khoa thuần) khỏi "Danh mục hàng hoá" (quản lý kho/tiền) — đúng tinh thần mục 2.2 ở trên (không gộp `Prescription`/ý định bác sĩ với `Dispense`/thực thi bán hàng vào một bảng). Cấu hình bật/tắt "module Kho dược" theo tenant là khái niệm MỚI, chưa có ở v1 (không có bảng/cột nào tương đương `tenant.enabled_specialties` #069 cho việc này — cần thiết kế khi tới lượt, có thể tái dùng đúng khuôn cấu hình-lúc-triển-khai đã chốt cho gói chuyên khoa).

### 2.3. Luồng khám & vòng đời encounter (tham khảo, không đổi state machine đã chốt)

- **Nguyên tắc "mỗi lần đến khám = 1 encounter mới, không tái dùng encounter đã đóng"** — đã khớp với `.claude/docs/clinical-workflow.md` hiện tại (encounter một chiều, không có đường lùi).
- **Đóng băng dữ liệu khi hoàn tất** (`finalize` → chặn mọi `PUT/POST/DELETE`) — đã khớp nguyên tắc "bản ghi đã ký bất biến" của NEXAMed, dù NEXAMed khoá theo `signed_at` ở từng bản ghi lâm sàng (`clinical_note`, `prescription`), không khoá nguyên `encounter`. Cân nhắc: NEXAMed hiện **không** tự động khoá toàn bộ encounter khi `COMPLETED` — chỉ khoá các bản ghi đã `signed_at`. Đây là khác biệt thiết kế cố ý (cho phép amendment sau khi hoàn tất, theo Thông tư 46) — **không** đổi theo hướng "freeze cứng toàn bộ" của nguồn tham khảo.
- **API composite tạo Patient + Encounter cùng lúc** (`register-encounter`, walk-in): khớp `APP-06` (walk-in tạo lịch + check-in trong một thao tác) đã có trong PRD/plan v1.
- **Clone dữ liệu lâm sàng từ lần khám trước** (`clonePreviousRecord`): khớp `PRE-05` (sao chép đơn từ lần khám trước, P1) — có thể mở rộng ý tưởng này sang cả chẩn đoán/ghi chú SOAP khi làm `PRE-05`.
- **Luồng chỉ định cận lâm sàng** (Lab/Imaging Order): thuộc v3+ (`lab_order`/`lab_result`, đã liệt kê ngoài phạm vi v1 trong `docs/ERD.md` mục 7).
- **Convert lịch hẹn → encounter khi check-in**: đã khớp thiết kế v1 (`appointment` → `encounter`, quan hệ một-một, `APP-06`).

---

## 3. Khi nào quay lại đọc file này

- Bắt đầu v2 (viện phí/thanh toán) hoặc v2.1 (dược/kho) hoặc v3 (BHYT) theo `docs/product/prd.md` Appendix A.
- Làm `PRE-05` (sao chép đơn từ lần khám trước) hoặc `ENC-07` (mẫu ghi chú soạn sẵn) ở các sprint sau.
- Trước khi dùng bất kỳ ý tưởng nào ở đây, đối chiếu lại mục 1 (mâu thuẫn đã biết) và xác nhận với chủ dự án nếu cần đổi cấu trúc đã chốt.
