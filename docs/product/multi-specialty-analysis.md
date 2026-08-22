# Phân tích khả thi — Đa chuyên khoa trên cùng một source (nhi/sản/nha)

**Trạng thái**: Định hướng kiến trúc **"Specialty Pack" đã chốt** (`docs/DECISIONS.md` #033, #058) — đọc 2 mục đó trước nếu chỉ cần kết luận nhanh. **Chưa triển khai** — chờ khách hàng thật trả tiền cho một chuyên khoa cụ thể (xem mục 6, 9). File này là phần lập luận đầy đủ, dùng để tham khảo khi thật sự bắt đầu làm gói chuyên khoa đầu tiên.

**Không áp dụng ngay ở v1.** Không thêm bảng/cột/migration nào theo tài liệu này cho tới khi có quyết định bắt đầu (xem mục 6 điều kiện tiên quyết).

---

## 0. Câu hỏi gốc

Chủ dự án đặt hai câu hỏi:

1. Có thể tích hợp nhiều loại phòng khám (nhi khoa, sản phụ khoa, nha khoa) trên cùng một source, chọn "gói sử dụng" thì hệ thống tự đổi form tiếp nhận/khám/biểu mẫu bệnh án tương ứng — để thương mại hoá mà không phải build riêng lẻ từng bản?
2. Source có bị quá nặng không?
3. (Hỏi thêm) Nếu sau này chuyển sang cloud thì các gói này có phải thay đổi nhiều về cấu trúc không?

## 1. Ba tầng biến thiên — chi phí chênh nhau rất xa

Yêu cầu ban đầu gộp chung nhiều loại biến thiên khác bản chất:

| Tầng | Ví dụ | Giải bằng | Chi phí |
|---|---|---|---|
| 1. Biến thiên dữ liệu nhập | Nhi thêm cân nặng/chiều cao/tiền sử sinh; Sản thêm PARA, ngày kinh cuối | Dynamic form / JSON schema | Rẻ |
| 2. Biến thiên quy trình nghiệp vụ | Sản theo dõi suốt thai kỳ; Nha theo lộ trình niềng răng/implant nhiều tháng | Mô hình dữ liệu mới (aggregate root mới) | **Đắt** |
| 3. Biến thiên biểu mẫu in | Bệnh án sản khoa ≠ bệnh án nhi khoa | Template engine | Rẻ |

**Tầng 1 trải dài qua cả Tiếp nhận lẫn Khám bệnh, không riêng màn hình khám.** Phần lớn ví dụ ở tầng 1 (cân nặng/chiều cao trẻ, tiền sử sinh, PARA, ngày kinh cuối) là dữ liệu thường thu thập ngay lúc tiếp nhận/đầu buổi khám, không chỉ lúc bác sĩ khám. Xem lại ghi chú ở mục 8 điểm 1.

Tầng 2 không giải được bằng "dynamic form" — nó chiếm phần lớn chi phí thật của bài toán này. Cụ thể:

- **Thai kỳ**: không phải một form khác, mà là một thực thể sống 40 tuần, chứa nhiều lượt khám, có tuổi thai tính động theo ngày, có lịch khám chuẩn theo tuần thai, có phân tầng nguy cơ.
- **Lộ trình niềng răng/implant**: là kế hoạch điều trị nhiều giai đoạn, cộng với sơ đồ răng (nhiều răng × nhiều mặt, mỗi phần tử có trạng thái riêng) — tuyệt đối không phải form động.

## 2. `encounter` hiện tại không cần đổi

State machine `encounter` đã chốt (`SCHEDULED → CHECKED_IN → IN_CONSULTATION → COMPLETED`, xem `.claude/docs/clinical-workflow.md`) vẫn đúng cho mọi chuyên khoa. Cái thiếu là một tầng cha dài hạn nằm TRÊN encounter, không phải sửa encounter:

```
Nhi khoa:  encounter (độc lập)                    ← đúng nguyên trạng
Sản khoa:  pregnancy ─┬─ encounter (khám thai T1)  ← thêm 1 tầng cha
                      ├─ encounter (khám thai T2)
                      └─ encounter (khám thai T3)
Nha khoa:  treatment_plan ─┬─ encounter (buổi 1)   ← thêm 1 tầng cha
                           └─ encounter (buổi 2)
```

Một buổi khám vẫn là một `encounter` đúng vòng đời hiện tại. Sau này chỉ cần thêm cột nullable `episode_id` trên `encounter` — migration nhỏ, không phá dữ liệu cũ, không vi phạm forward-only.

## 3. Kiến trúc đề xuất: "Specialty Pack"

### Không xây form builder cho người dùng tự kéo thả

Đây là cảnh báo quan trọng nhất. Lý do kép:

- **Chi phí kỹ thuật**: form builder linh hoạt vô hạn là hố chi phí kinh điển, thường đội 5-10 lần so với ước lượng ban đầu.
- **Rủi ro pháp lý**: mẫu hồ sơ bệnh án ở Việt Nam do Bộ Y tế quy định, không phải do phòng khám tự thiết kế. Bệnh án sản khoa, nhi khoa, răng hàm mặt đều có mẫu ban hành riêng. Để khách tự sửa form bệnh án → sai mẫu quy định → nhà cung cấp phần mềm chịu trách nhiệm liên đới.

Điều này thực ra có lợi: không cần form builder tổng quát, chỉ cần N gói chuyên khoa làm sẵn và kiểm chứng đúng mẫu.

> ⚠️ Cần xác minh với chuyên môn/pháp lý trước khi cam kết bán — cùng nhóm với câu hỏi Q1/Q2 đang treo ở `docs/product/plan.md` mục 3. Chưa có xác nhận cụ thể mẫu nào áp dụng cho phòng khám tư nhân quy mô nhỏ.

### Hình dạng thư mục

```
packages/core/
├── clinical/              # KERNEL — không bao giờ biết chuyên khoa nào tồn tại
│   └── encounter state machine, quy tắc amendment, ICD-10
└── specialty/
    ├── registry.ts        # interface SpecialtyPack
    ├── pediatric/         # hàm thuần: percentile tăng trưởng, liều theo cân nặng
    ├── obstetric/         # hàm thuần: tuổi thai, ngày dự sinh, lịch khám chuẩn
    └── dental/            # hàm thuần: đánh số răng, trạng thái mặt răng
```

Mỗi `SpecialtyPack` khai báo: schema form tiếp nhận/khám, mô hình episode (nếu có), template biểu mẫu, quy tắc validate lâm sàng.

**Nguyên tắc sống còn**: kernel không được có một dòng `if (specialty === 'obstetric')` nào trong service/repository dùng chung. Đúng ranh giới module đã chốt ở `.claude/docs/coding-standards.md` (module không import chéo, giao tiếp qua port/registry/domain event).

### Lưu trữ dữ liệu form: lai, không thuần JSONB

| Loại dữ liệu | Lưu ở đâu | Vì sao |
|---|---|---|
| Có ý nghĩa lâm sàng, cần truy vấn/cảnh báo/báo cáo (tuổi thai, ngày dự sinh, cân nặng, trạng thái răng) | Cột thật, bảng riêng | Cần index, ràng buộc, thống kê được |
| Phần đuôi dài của form (ghi chú, checkbox phụ) | `jsonb` | Không đáng làm migration cho mọi trường nhỏ |

Nhét tất cả vào JSONB sẽ mất khả năng trả lời các câu hỏi thống kê kiểu "tháng này bao nhiêu ca thai nguy cơ cao?" mà không quét toàn bảng — chi phí trả sau, và đắt.

### Chuyên khoa là thuộc tính của lượt khám, không phải của phòng khám

Phòng khám đa khoa có thể có cả nhi lẫn sản trong cùng một tenant. Vì vậy:

- `tenant.enabled_specialties` = **tập hợp** (gói đã mua — cái gì được phép dùng).
- `encounter.specialty` = **một giá trị** (lượt khám này thực tế thuộc chuyên khoa nào).

Thiết kế nhầm thành "1 tenant = 1 chuyên khoa" sẽ rất đau khi gỡ sau này.

### "Gói sử dụng" ở on-premise

Vì `CLAUDE.md` chốt triển khai on-premise, khách kiểm soát máy chủ nên không thể cưỡng chế license bằng kỹ thuật một cách thật sự. "Gói" ở giai đoạn on-prem chỉ là cấu hình lúc triển khai + ràng buộc hợp đồng — không cần đầu tư cơ chế chống crack. (Điều này đổi khi lên cloud — xem mục 5.)

**Cơ chế cụ thể (chốt 2026-08-22, `docs/DECISIONS.md` #069)**: `tenant.enabled_specialties` (tập hợp gói đã mua) set **một lần** qua script/migration lúc đội kỹ thuật cài đặt cho khách — cùng tinh thần `tenantId` hiện nạp qua `apps/web/public/config.json` (sửa lúc deploy, không qua UI, không rebuild). **Không** để `clinic_admin` của khách tự bật/tắt gói qua bất kỳ màn hình "Cấu hình hệ thống" nào — không phải vì sợ họ dùng "lậu" (không cưỡng chế được thật sự ở on-prem, xem trên) mà vì bật một chuyên khoa kéo theo dữ liệu/mẫu bệnh án cần đã được thẩm định chuyên môn đúng cho gói đó (xem "Bẫy cần tránh" #4 ở mục 7), không phải một công tắc cấu hình đơn thuần. Guard kiểm gói đặt ở **tầng API** (không chỉ ẩn menu sidebar, tránh gọi thẳng endpoint bỏ qua UI) — tái dùng khuôn `PermissionGuard` đã có từ S2-01, kiểm `tenant.enabled_specialties` thay vì quyền theo user.

**Mẫu bệnh án in ấn (Tầng 3) — chọn theo `encounter.specialty`, không theo `EXAM_TYPE`**: `EXAM_TYPE` (`reference_catalog`) là danh mục tự do do `clinic_admin` tự thêm/sửa/đổi tên — gắn mẫu pháp lý cố định (Bộ Y tế ban hành) vào đó là rủi ro vận hành (dịch vụ mới không có mẫu, đổi tên làm sai mapping). `encounter.specialty` là giá trị do nhà cung cấp kiểm soát (mỗi giá trị mới gắn 1 gói đã build + thẩm định chuyên môn) — an toàn hơn để gắn văn bản pháp lý. Cho phép override theo dịch vụ cụ thể CHỈ khi pháp lý thật sự yêu cầu mẫu riêng khác mẫu mặc định chuyên khoa — danh sách override khai báo cứng lúc build gói, không phải cấu hình tự do qua UI.

## 4. Trả lời: "Source có bị quá nặng không?"

| Loại "nặng" | Đánh giá | Ghi chú |
|---|---|---|
| Bundle web | Không vấn đề — **nhưng có ĐIỀU KIỆN, xem ghi chú dưới bảng** | Lazy load theo route/chuyên khoa — phòng khám nhi chỉ tải gói nhi |
| Database | Không vấn đề | ~10-20 bảng thêm, rỗng với ai không dùng |
| RAM/API | Không vấn đề | Vài MB, không đáng kể với máy chủ on-prem |
| Thời gian build | Tăng, chấp nhận được | — |
| Bộ test | Tăng mạnh | Hiện ~160 test/~16s → có thể lên 500+ khi đủ 3 gói. Vẫn ổn nếu giữ kỷ luật tách theo module |
| Chi phí hiểu code | **Vấn đề thật** | Chỉ giữ được nếu ranh giới module nghiêm ngặt (mục 3) |

> ⚠️ **Cập nhật 2026-08-22 (`docs/DECISIONS.md` #073)** — dòng "Bundle web: không vấn đề" ở trên giả định sẵn có lazy load theo route. Đo lại thực tế thì **giả định đó chưa từng được hiện thực**: `apps/web` có 0 lazy load, build ra 802 kB trong MỘT chunk duy nhất. Đã sửa xong trong cùng ngày (code-splitting 11 trang → chunk khởi động còn 440 kB, mỗi trang một chunk riêng), và ghi thành **quy tắc bắt buộc** ở `.claude/docs/coding-standards.md` mục Hiệu suất: mọi trang nghiệp vụ mới BẮT BUỘC lazy, chunk khởi động ≤ 500 kB. Bài học chung: kết luận "không nặng" trong tài liệu này là **có điều kiện** — phải kiểm điều kiện có đạt không trước khi dựa vào nó, không đọc mỗi phần kết luận.

**Kết luận**: nhẹ về kỹ thuật, nặng về tổ chức. Rủi ro thật không phải "source phình to" mà là: mỗi lần sửa kernel phải hồi quy cả 3 chuyên khoa; mỗi ca hỗ trợ cần người hiểu đúng chuyên khoa đó.

## 5. Ảnh hưởng khi chuyển sang cloud

### Kết luận ngắn

Gói chuyên khoa gần như không đổi cấu trúc khi lên cloud, **với điều kiện** viết đúng theo mục 3 (logic thuần ở `packages/core`, hạ tầng qua port, không giữ state trong RAM tiến trình). Chi phí chuyển cloud là gần như hằng số — không nhân lên theo số chuyên khoa, vì việc đó nằm hết ở tầng hạ tầng đã tách sẵn từ đầu (`packages/core/ports`, xem `.claude/docs/project-structure.md`).

### Bảng chi tiết cái gì đổi

| Thành phần | Chuyển cloud có phải sửa? |
|---|---|
| Hàm thuần chuyên khoa (tuổi thai, percentile, đánh số răng) | Không |
| Bảng dữ liệu chuyên khoa (`pregnancy`, `treatment_plan`, sơ đồ răng) | Không — đã có `tenant_id` + RLS từ S1-03 |
| Schema form, template biểu mẫu | Không |
| Vòng đời `encounter`, RBAC, audit | Không |
| Lưu ảnh X-quang/siêu âm | Đổi adapter — `StoragePort` → S3/MinIO, đã dự trù sẵn |
| Nhắc lịch khám thai qua SMS/Zalo | Đổi adapter — `NotificationPort` từ no-op → thật |
| Xác định tenant | Đổi thật — từ `config.json` sang subdomain/slug (đã ghi trước ở `docs/DECISIONS.md` #020) |
| Cưỡng chế "gói sử dụng" | Đổi bản chất — xem dưới |

### Thứ đổi bản chất: cơ chế "gói"

- **On-prem**: mỗi phòng khám một máy chủ riêng → "gói" chỉ là cấu hình lúc cài đặt, không cần cưỡng chế kỹ thuật.
- **Cloud**: nhiều tenant dùng chung một tiến trình API → "gói" bắt buộc phải kiểm tra ở tầng server mỗi request (không thể chỉ ẩn menu, đúng nguyên tắc đã có ở `.claude/docs/security-audit.md`), có trạng thái thuê bao thật (hạn dùng, gia hạn, nâng/hạ gói), có thể cần nối thanh toán định kỳ.

Đây là một module `subscription`/`entitlement` mới — không phải sửa gói chuyên khoa. Guard kiểm gói nên tái dùng đúng khuôn `PermissionGuard` đã có từ S2-01, không phát minh cơ chế mới.

### Rủi ro cụ thể cần canh: cache không khoá theo tenant

Khi xây form renderer/template engine, phản xạ tự nhiên là cache schema/template đã biên dịch. Nếu cache đó là biến module-level không có khoá theo `tenantId`:

- **On-prem**: không bao giờ lộ (mỗi máy chủ một phòng khám).
- **Cloud**: rò dữ liệu xuyên tenant ngay lập tức — phòng khám A thấy cấu hình/biểu mẫu của phòng khám B.

Đây là loại bug tệ nhất: không phát hiện được bằng bộ test hiện tại, không lộ suốt nhiều năm on-prem, rồi bùng ngay ngày đầu lên cloud, trên dữ liệu y tế. `.claude/docs/project-structure.md` đã có quy tắc chống việc này ("không lưu state trong RAM tiến trình... cần state chia sẻ thì đi qua DB hoặc port riêng") nhưng rất dễ vô tình vi phạm khi viết form/template engine — cần đưa vào checklist review riêng khi làm gói chuyên khoa.

### Tác động mô hình kinh doanh (không phải cấu trúc code)

| Chuyên khoa | Dữ liệu nặng | On-prem | Cloud |
|---|---|---|---|
| Nhi | Chủ yếu dữ liệu có cấu trúc, nhẹ | Rẻ | Rẻ |
| Sản | Ảnh/video siêu âm | Đĩa cứng tại chỗ, chi phí ≈ 0 | Lưu trữ + băng thông tính tiền thật |
| Nha | Phim X-quang | Đĩa cứng tại chỗ, chi phí ≈ 0 | Lưu trữ + băng thông tính tiền thật |

Code không đổi (`StoragePort` lo việc này), nhưng giá bán nên khác nhau theo chuyên khoa khi lên cloud — nha khoa và sản khoa tốn chi phí hạ tầng cao hơn nhi khoa đáng kể, cần tính vào giá gói từ sớm.

Ngược lại, cloud làm sản khoa và nha khoa tốt lên rõ rệt: nhắc lịch khám thai theo tuần, nhắc buổi hẹn niềng răng — các tính năng này chỉ hoạt động khi có kết nối liên tục, và là điểm bán hàng mạnh của hai chuyên khoa đó.

### Vận hành: nâng cấp đồng loạt

| | On-prem | Cloud |
|---|---|---|
| Nâng cấp | Từng phòng khám một, có thể ở lại bản cũ | Tất cả cùng lúc |
| Hệ quả | Sửa gói Sản chỉ ảnh hưởng khách vừa nâng cấp | Sửa gói Sản ảnh hưởng mọi phòng khám sản ngay lập tức |

Lên cloud thì kỷ luật migration forward-only và versioning của gói chuyên khoa quan trọng hơn nhiều. Quy tắc "migration đã merge là bất biến" ở `.claude/docs/data-model.md` đang bảo vệ đúng chỗ này.

## 6. Chi phí và thứ tự triển khai (nếu quyết định làm)

Ước lượng thô, cùng đơn vị dev-day với `docs/product/plan.md` — **cần thẩm định lại trước khi cam kết**, không phải con số chốt:

| Hạng mục | Ước lượng | Ghi chú |
|---|---|---|
| Khung specialty (registry + dynamic form renderer + gating gói) | 15-25 | Chỉ nên làm khi đã có ≥1 gói thật, không làm trước |
| Gói Nhi khoa | 15-20 | Dễ nhất — tái dùng phần lớn luồng hiện có |
| Gói Sản phụ khoa | 30-40 | Đắt vì mô hình thai kỳ dài hạn + tuổi thai là mối lo xuyên suốt mọi màn hình |
| Gói Nha khoa | 40-50 | Sơ đồ răng + kế hoạch điều trị nhiều giai đoạn |
| Điều kiện tiên quyết cho Nha khoa: module Viện phí | 30+ | Xem dưới |

### Nha khoa bị chặn bởi module Viện phí

Niềng răng/implant gắn chặt với tiền: báo giá, trả góp nhiều đợt, công nợ theo lộ trình. Nhưng thanh toán/viện phí nằm ngoài v1 theo `CLAUDE.md`. Bán phần mềm nha khoa mà không có quản lý thanh toán theo lộ trình gần như không bán được — nghĩa là lộ trình nha khoa bị chặn bởi module viện phí (v2), không phải bởi khung specialty. Cần biết ràng buộc thương mại này trước khi hứa với khách.

### Thứ tự đề xuất

```
v1 (hiện tại)  → Khám tổng quát. Ship. Kiểm chứng ở pilot tuần 8.
v1.1/v2        → Gói ĐẦU TIÊN, chọn theo khách hàng THẬT đã trả tiền.
                 Viết cụ thể, KHÔNG dựng khung trừu tượng trước.
v2.x           → Gói THỨ HAI → lúc này mới trích xuất khung specialty.
v3+            → Gói thứ ba (Nha, sau khi có viện phí).
```

Lý do làm cụ thể trước, trừu tượng sau: `CLAUDE.md` đã ghi "trùng lặp lần thứ hai là dấu hiệu phải trích xuất" và "không dựng abstraction cho tình huống chưa xảy ra". Khung specialty thiết kế từ tưởng tượng gần như chắc chắn sai chỗ; khung rút ra từ 2 gói thật thì đúng.

## 7. Bẫy cần tránh (theo thứ tự nguy hiểm)

1. Form builder cho người dùng tự thiết kế — hố chi phí nhiều năm, rủi ro pháp lý.
2. `if (specialty === ...)` lọt vào service/repository dùng chung — kiến trúc mục từ đây, và mục rất nhanh.
3. Nhét hết dữ liệu form vào JSONB — mất khả năng báo cáo vĩnh viễn.
4. Ship chuyên khoa không có bác sĩ chuyên khoa đó thẩm định — dev không tự chứng nhận quy trình sản khoa/nha khoa được. Đây là chi phí nhân sự, không phải chi phí code.
5. Gói chuyên khoa import lẫn nhau — phá vỡ khả năng bán riêng từng gói.
6. Làm lõi "đủ tổng quát cho mọi thứ có thể xảy ra" — kết quả thường là một meta-system không ai dùng được, xem mục 6 (thứ tự cụ thể trước, trừu tượng sau).
7. Cache schema/template không khoá theo `tenantId` — vô hại on-prem, rò dữ liệu xuyên tenant khi lên cloud (xem mục 5).

## 8. Việc nên làm ngay (chi phí gần bằng 0, không phải code specialty)

1. Giữ đúng kỷ luật viết component đã có trong `CLAUDE.md` khi làm màn hình khám ở Sprint 3 (S3-06): nhận danh sách trường/cấu hình qua props, không hard-code riêng cho một chuyên khoa. Đây là điểm retrofit đắt nhất nếu bỏ lỡ.
   **Áp dụng cho cả Tiếp nhận, không chỉ Khám bệnh** — tầng 1 (biến thiên dữ liệu nhập) trải dài qua cả hai màn hình, xem mục 1. Ghi chú lại vì thực tế: `ReceptionIntakeForm.tsx` (S3-03/04, hoàn thiện qua `docs/DECISIONS.md` #042→#053) đã được xây xong **trước khi** có nhu cầu thật về chuyên khoa cụ thể, dưới dạng một form chung duy nhất, KHÔNG nhận cấu hình trường qua props theo chuyên khoa — đúng như nguyên tắc "làm cụ thể trước, trừu tượng sau" ở mục 6/9 (không dựng khung specialty khi chưa có khách hàng thật). Khi bắt đầu gói chuyên khoa đầu tiên (mục 6, 9), việc parameterize hoá theo chuyên khoa phải làm ĐỒNG THỜI cho cả `ReceptionIntakeForm.tsx` lẫn màn hình khám — không chỉ retrofit riêng màn hình khám.
2. Khi thiết kế `encounter` ở Sprint 3, không giả định encounter luôn đứng một mình (không cần thêm bảng/cột gì, chỉ là một giả định cần tránh trong lúc thiết kế).
3. Xác minh sớm câu hỏi pháp lý về mẫu bệnh án theo chuyên khoa — xếp cùng nhóm T1/Q1/Q2 đang treo ở `docs/product/plan.md`.
4. Không thêm cột `specialty`/`form_data` vào schema hiện tại trước khi có gói thật cần dùng — vi phạm nguyên tắc "không để sẵn chỗ cho module ngoài v1" nếu làm sớm.

## 9. Khi nào quay lại đọc file này

- Khi có khách hàng thật (nhi, sản, hoặc nha) sẵn sàng trả tiền cho một gói chuyên khoa cụ thể — bắt đầu từ gói đó, cụ thể, không dựng khung trước.
- Trước khi bắt đầu module Viện phí (v2) — vì nó là điều kiện tiên quyết của gói Nha khoa.
- Khi bàn kế hoạch chuyển sang triển khai cloud — đối chiếu lại mục 5 trước khi thiết kế module `subscription`/`entitlement`.
- Trước khi viết màn hình khám ở Sprint 3 (S3-06) — đối chiếu mục 8 điểm 1.
