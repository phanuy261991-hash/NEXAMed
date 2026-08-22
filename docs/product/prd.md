# PRD: NEXAMed — Phần mềm quản lý phòng khám

**Version**: v1.0 — 07/08/2026
**Trạng thái**: Draft, chờ xác nhận scope và timeline
**Tài liệu kỹ thuật đi kèm**: `CLAUDE.md`, `.claude/docs/`

---

## 1. Overview

NEXAMed là phần mềm quản lý phòng khám triển khai on-premise, phục vụ luồng vận hành hằng ngày từ đặt lịch, tiếp nhận, đến khám bệnh và kê đơn. Bản v1 nhắm tới phòng khám tư nhân đơn lẻ quy mô 1-3 bác sĩ.

Hệ thống thay thế sổ giấy và file Excel bằng bệnh án điện tử có lưu vết đầy đủ, đáp ứng yêu cầu về lưu trữ và truy vết sửa đổi hồ sơ bệnh án theo Thông tư 46/2018/TT-BYT.

| Hạng mục | Giá trị |
|---|---|
| Khách hàng mục tiêu v1 | Phòng khám tư nhân 1-3 bác sĩ |
| Mô hình triển khai | On-premise (máy chủ đặt tại phòng khám) |
| Kiến trúc | Multi-tenant sẵn từ đầu, dù v1 chạy một tenant mỗi cài đặt |
| Team | 3-5 developer |
| Timeline đề xuất | Pilot tuần 8, GA tuần 12 (xem mục 7 về rủi ro timeline) |

**Ngoài phạm vi v1**: dược/kho, viện phí và thanh toán, tích hợp BHYT và cổng giám định, báo cáo doanh thu, ứng dụng cho bệnh nhân, chữ ký số theo chuẩn CA.

---

## 2. Problem Statement

### Hiện trạng của phòng khám tư 1-3 bác sĩ

Phần lớn phòng khám quy mô này đang vận hành bằng sổ giấy kết hợp Excel, hoặc dùng phần mềm cũ cài sẵn theo máy. Các vấn đề quan sát được:

**Tra cứu tiền sử bệnh nhân chậm.** Khi bệnh nhân tái khám, lễ tân phải lục sổ hoặc hỏi lại bệnh nhân. Với phòng khám 40-60 lượt/ngày, việc này lặp lại hàng chục lần mỗi ngày.

**Hồ sơ khám không đầy đủ và không chuẩn hoá.** Chẩn đoán ghi bằng chữ viết tay, không theo mã ICD-10, nên không thống kê được, không đối chiếu được khi cần báo cáo hoặc quyết toán về sau.

**Không có vết sửa đổi.** Sổ giấy sửa bằng cách gạch xoá; file Excel bị ghi đè. Khi có khiếu nại hoặc thanh tra, phòng khám không chứng minh được ai sửa gì và sửa lúc nào — trong khi quy định về bệnh án điện tử yêu cầu lưu vết đầy đủ.

**Trùng lịch và bỏ sót lịch hẹn.** Lịch hẹn ghi sổ, hai người trực cùng nhận điện thoại dễ đặt trùng khung giờ của cùng một bác sĩ.

**Đơn thuốc viết tay** khó đọc, không lưu lại được để đối chiếu lần khám sau.

### Vì sao giải pháp hiện có chưa đủ

| Giải pháp hiện tại | Vì sao chưa đủ |
|---|---|
| Sổ giấy + Excel | Không tra cứu được theo lịch sử, không lưu vết, mất dữ liệu khi hỏng file |
| Phần mềm HIS cho bệnh viện | Nặng, đắt, cần nhân sự IT vận hành; phòng khám 1-3 bác sĩ không đủ nguồn lực |
| Phần mềm phòng khám phổ thông trên thị trường | Đa số tập trung vào thu ngân và bán thuốc; phần bệnh án điện tử và lưu vết thường sơ sài |

**Giả định cần kiểm chứng**: các nhận định về giải pháp hiện có ở trên dựa trên hiểu biết chung về thị trường, **chưa qua khảo sát cạnh tranh thực tế**. Cần khảo sát tối thiểu 3 sản phẩm đang bán tại Việt Nam trước khi chốt định vị (xem mục 10).

---

## 3. Solution Overview

### Cách tiếp cận

Làm đúng ba khâu cốt lõi của một ca khám và làm chắc, thay vì làm rộng và mỏng. Ba khâu đó là: **đặt lịch → tiếp nhận → khám bệnh và kê đơn**. Phần thu tiền, kho thuốc, BHYT để lại các phase sau.

Lý do chọn hướng này:

1. Ba khâu này là thứ diễn ra mỗi ngày, mỗi bệnh nhân. Làm tốt là thấy giá trị ngay từ tuần đầu dùng thử.
2. Bệnh án điện tử có lưu vết là điểm khác biệt và cũng là yêu cầu pháp lý — đây là phần khó bỏ qua nhất, cần làm đúng từ đầu vì gắn với thiết kế dữ liệu.
3. Thu tiền và kho thuốc là bài toán đã có nhiều lời giải, có thể bổ sung sau mà không phải làm lại nền tảng.

### Người dùng

| Vai trò | Số lượng điển hình | Nhu cầu chính |
|---|---|---|
| Lễ tân (`receptionist`) | 1-2 | Đặt lịch nhanh, tra cứu bệnh nhân cũ, tiếp nhận không phải hỏi lại thông tin |
| Điều dưỡng (`nurse`) | 1-2 | Nhập sinh hiệu nhanh, gọn trên tablet hoặc máy tính |
| Bác sĩ (`doctor`) | 1-3 | Xem tiền sử ngay, chọn mã ICD-10 nhanh, kê đơn và in trong dưới 1 phút |
| Quản lý phòng khám (`clinic_admin`) | 1 | Cấu hình giờ làm việc, tài khoản, xem nhật ký truy cập |

### Luồng chính

```
Đặt lịch (lễ tân/điện thoại/walk-in)
   → Check-in, tạo lượt khám, xác nhận thông tin hành chính
   → Điều dưỡng ghi sinh hiệu
   → Bác sĩ khám: xem tiền sử, ghi SOAP, chọn chẩn đoán ICD-10
   → Kê đơn, ký, in đơn
   → Hoàn tất lượt khám
```

Mọi thao tác tạo/sửa/xoá dữ liệu lâm sàng và mọi lần xem hồ sơ bệnh nhân đều ghi nhật ký.

---

## 4. Detailed Requirements

Ký hiệu: **P0** bắt buộc cho v1, **P1** làm nếu còn thời gian, **P2** để phase sau.

### 4.1 Quản lý bệnh nhân

> *Là lễ tân, tôi muốn tìm ra hồ sơ bệnh nhân cũ trong vài giây, để không phải hỏi lại thông tin và không tạo hồ sơ trùng.*

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| PAT-01 | Tạo hồ sơ bệnh nhân: họ tên, ngày sinh, giới tính, điện thoại, địa chỉ, CCCD (tuỳ chọn), ghi chú dị ứng | P0 |
| PAT-02 | Tìm kiếm theo tên, số điện thoại, mã bệnh nhân; kết quả trả về dưới 1 giây với 50.000 hồ sơ | P0 |
| PAT-03 | Cảnh báo nghi trùng khi tạo mới (trùng CCCD chặn, trùng tên + ngày sinh chỉ cảnh báo) | P0 |
| PAT-04 | Gộp hai hồ sơ trùng, giữ toàn bộ lịch sử khám, không xoá bản ghi nguồn | P1 |
| PAT-05 | Lưu thông tin thẻ BHYT để hiển thị và in; không tính chi trả ở v1 | P0 |

**Edge case**: bệnh nhân không có CCCD (trẻ em, người không giấy tờ) — cho phép để trống, chống trùng chuyển sang tổ hợp tên + ngày sinh + số điện thoại người giám hộ.

### 4.2 Đặt lịch

> *Là lễ tân, tôi muốn hệ thống chặn đặt trùng khung giờ của cùng một bác sĩ, để không xảy ra cảnh hai bệnh nhân cùng đến một giờ.*

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| APP-01 | Xem lịch theo ngày và theo bác sĩ, dạng lưới khung giờ | P0 |
| APP-02 | Đặt lịch với slot cấu hình được (mặc định 15 phút) | P0 |
| APP-03 | Chặn trùng khung giờ cùng bác sĩ, kể cả khi hai người đặt đồng thời | P0 |
| APP-04 | Huỷ lịch bắt buộc nhập lý do; ghi nhật ký | P0 |
| APP-05 | Tự đánh dấu không đến sau ngưỡng cấu hình (mặc định 60 phút) | P1 |
| APP-06 | Tiếp nhận walk-in: tạo lịch và check-in trong một thao tác | P0 |
| APP-07 | Nhắc lịch qua SMS/Zalo | P2 |

### 4.3 Tiếp nhận

> *Là điều dưỡng, tôi muốn nhập sinh hiệu trong dưới 30 giây, để không làm chậm hàng đợi.*

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| REC-01 | Check-in tạo lượt khám, hiển thị hàng đợi theo thời gian đến | P0 |
| REC-02 | Nhập sinh hiệu: mạch, nhiệt độ, huyết áp, nhịp thở, SpO2, cân nặng, chiều cao | P0 |
| REC-03 | Cảnh báo giá trị ngoài ngưỡng sinh lý nhưng vẫn cho lưu | P0 |
| REC-04 | Màn hình hàng đợi hiển thị trạng thái từng bệnh nhân cho cả phòng khám | P1 |

### 4.4 Khám bệnh

> *Là bác sĩ, tôi muốn thấy toàn bộ tiền sử của bệnh nhân trên một màn hình, để không phải hỏi lại những gì đã ghi lần trước.*

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ENC-01 | Màn hình khám: tiền sử các lần khám trước, dị ứng, sinh hiệu lần này | P0 |
| ENC-02 | Ghi chú lâm sàng gồm nhóm "Tiền sử" (bản thân, gia đình, dị ứng — thuộc hồ sơ bệnh nhân, dùng chung mọi lượt khám, không nhập lại mỗi lần khám, chốt 2026-08-21 xem `docs/DECISIONS.md` #068) và nhóm "Thăm khám" (lý do khám*, quá trình bệnh lý, chẩn đoán sơ bộ*, khám toàn thân, khám bộ phận — thuộc từng lượt khám) — *bắt buộc. Thay mô tả "4 mục SOAP" ban đầu, chốt 2026-08-20 theo yêu cầu chủ dự án, xem `docs/DECISIONS.md` | P0 |
| ENC-03 | Chọn chẩn đoán từ danh mục ICD-10, tìm theo mã hoặc theo tên tiếng Việt; bắt buộc có ít nhất một chẩn đoán chính | P0 |
| ENC-04 | Ký hồ sơ khám: sau khi ký không sửa được, chỉ tạo bản đính chính có lý do | P0 |
| ENC-05 | Xem lịch sử đính chính: ai sửa, sửa gì, lúc nào, lý do | P0 |
| ENC-06 | Lưu nháp phía client khi mất kết nối, gửi lại khi có mạng | P1 |
| ENC-07 | Mẫu ghi chú soạn sẵn theo bệnh thường gặp | P2 |

### 4.5 Kê đơn

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| PRE-01 | Kê đơn: thuốc, liều, số lần/ngày, số ngày, số lượng, hướng dẫn dùng | P0 |
| PRE-02 | Cảnh báo trùng hoạt chất giữa các dòng trong đơn | P0 |
| PRE-03 | Đối chiếu với ghi chú dị ứng của bệnh nhân, cảnh báo trước khi ký | P0 |
| PRE-04 | In đơn theo mẫu, có thông tin phòng khám và bác sĩ | P0 |
| PRE-05 | Sao chép đơn từ lần khám trước | P1 |
| PRE-06 | Kiểm tra liều theo cân nặng và tuổi | P2 |
| PRE-07 | Chữ ký số theo chuẩn CA | P2 |

### 4.6 Quản trị và nhật ký

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-01 | Quản lý tài khoản và 5 vai trò mặc định (seed sẵn theo tenant, `clinic_admin` gán được nhiều vai trò/user) | P0 |
| ADM-02 | Cấu hình phòng khám: giờ làm việc, độ dài slot, phòng, mẫu in | P0 |
| ADM-03 | Nhật ký hoạt động: ai xem, ai sửa hồ sơ nào, lúc nào; tra cứu theo bệnh nhân và theo người dùng | P0 |
| ADM-04 | Sao lưu dữ liệu tự động theo lịch, có hướng dẫn phục hồi | P0 |
| ADM-05 | Xuất bệnh án của một bệnh nhân ra PDF | P1 |
| ADM-06 | **Break-glass**: khi bị chặn truy cập ngoài phạm vi dữ liệu (data scope), cho phép nhập lại mật khẩu + lý do để vượt quyền tạm thời (mặc định 2 giờ); ghi nhật ký vĩnh viễn, báo `clinic_admin` (v1: qua log, chưa gửi SMS/Zalo thật — xem mục 6) | P0 |
| ADM-07 | Màn hình cấu hình ma trận phân quyền: chọn vai trò × tính năng → chọn phạm vi dữ liệu (`none`/`personal`/`department`/`global`) qua dropdown; `clinic_admin` tạo được vai trò tuỳ biến ngoài 5 vai trò mặc định | P1 |

### 4.7 Thu ngân cơ bản (mở rộng phạm vi v1, chốt 2026-08-22 — `docs/DECISIONS.md` #072)

> *Là lễ tân, tôi muốn thu tiền và in phiếu thu ngay trên phần mềm, để không phải ghi sổ tiền song song.*

Phạm vi giới hạn ở **thu ngân mức 1** (một phiếu thu cho một lượt khám). Viện phí đầy đủ (bảng giá đa đối tượng, công nợ/trả góp theo lộ trình điều trị), BHYT và báo cáo doanh thu theo kỳ **vẫn ngoài v1**.

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| BIL-01 | Tạo phiếu thu cho một lượt khám, tính tổng từ dịch vụ đã chỉ định sẵn trên lượt khám (không nhập lại giá) | P0 |
| BIL-02 | In phiếu thu theo mẫu, có thông tin phòng khám (dùng chung hạ tầng in với PRE-04) | P0 |
| BIL-03 | Đánh dấu trạng thái đã thu/chưa thu và phương thức thanh toán (tiền mặt/chuyển khoản); ghi nhật ký | P0 |
| BIL-04 | Tổng kết thu cuối ngày: danh sách phiếu thu trong ngày và tổng tiền | P0 |

**Lý do đưa vào v1** (trước đây xếp v2): điều kiện GA ở mục 7 yêu cầu "pilot ngừng dùng sổ giấy, chạy hoàn toàn trên hệ thống" — không có thu ngân thì phòng khám buộc phải giữ sổ tiền, không đạt được điều kiện này. Làm ở Sprint 5/6 (sau pilot, trước GA) để không làm phình Sprint 4.

**Ghi chú kiến trúc phân quyền (chốt 2026-08-08, thay thế mô tả "5 vai trò cố định" ở bản v1.0)**: hệ thống dùng RBAC kết hợp Data Scope (4 mức: `none`/`personal`/`department`/`global`) thay vì quyền on/off đơn thuần. Chi tiết đầy đủ xem `.claude/docs/security-audit.md`. Mức `branch` (đa chi nhánh) **chưa triển khai** — khớp với quyết định hoãn ở câu hỏi Q6 mục 10 bên dưới; ADM-07 (UI cấu hình) là P1, có thể lùi nếu timeline căng (xem mục 7).

---

## 5. Success Metrics

Đo trong 4 tuần đầu tại phòng khám pilot, so với hiện trạng ghi nhận trước khi triển khai.

### Hiệu quả vận hành

| Chỉ số | Hiện trạng (cần đo trước) | Mục tiêu sau 4 tuần |
|---|---|---|
| Thời gian tiếp nhận một bệnh nhân cũ | Ước tính 3-5 phút | Dưới 90 giây |
| Thời gian bác sĩ hoàn tất hồ sơ một ca khám thường | Không đo được (giấy) | Dưới 3 phút |
| Tỷ lệ lượt khám có mã ICD-10 hợp lệ | 0% | Trên 95% |
| Tỷ lệ đơn thuốc in từ hệ thống thay vì viết tay | 0% | Trên 90% |
| Số lần đặt trùng lịch bác sĩ | Cần đo | 0 |

### Chấp nhận của người dùng

| Chỉ số | Mục tiêu |
|---|---|
| Tỷ lệ lượt khám được nhập vào hệ thống trong ngày | Trên 95% từ tuần thứ 3 |
| Số ca phải quay lại dùng giấy vì hệ thống chậm hoặc lỗi | Dưới 2 ca/tuần từ tuần thứ 3 |
| Bác sĩ tự thao tác được không cần hỗ trợ sau buổi đào tạo 2 giờ | 100% |

### Kỹ thuật

| Chỉ số | Mục tiêu |
|---|---|
| p95 thời gian phản hồi API trên máy chủ tại chỗ | Dưới 500 ms |
| Thời gian tải màn hình khám có đủ tiền sử | Dưới 2 giây |
| Uptime trong giờ làm việc | Trên 99% |
| Sao lưu chạy đúng lịch và phục hồi thử thành công | 100%, kiểm thử hàng tháng |
| Rò rỉ dữ liệu giữa các tenant phát hiện qua test tự động | 0 |

**Lưu ý**: các con số hiện trạng phải đo tại phòng khám pilot **trước** khi triển khai. Không có số gốc thì không chứng minh được cải thiện.

---

## 6. Technical Constraints

Chi tiết kỹ thuật đầy đủ nằm ở `CLAUDE.md` và `.claude/docs/`. Phần này chỉ nêu ràng buộc ảnh hưởng tới phạm vi sản phẩm.

| Ràng buộc | Ảnh hưởng tới sản phẩm |
|---|---|
| Triển khai on-premise, không giả định có internet ổn định | Không dùng dịch vụ cloud bắt buộc; nhắc lịch qua SMS/Zalo phải chấp nhận thất bại khi mất mạng |
| Kiến trúc multi-tenant từ đầu | Chi phí phát triển v1 cao hơn, đổi lại chuyển sang mô hình tập trung sau này không phải làm lại |
| Bệnh án không xoá cứng, sửa phải tạo bản đính chính | UI phải có luồng đính chính rõ ràng, người dùng cần được đào tạo về việc "không sửa đè được" |
| Danh mục ICD-10 bắt buộc, không nhập mã tự do | Bác sĩ quen ghi tự do sẽ thấy vướng ban đầu; cần tìm kiếm tiếng Việt đủ tốt để bù |
| Chữ ký số chưa triển khai | v1 chỉ có chữ ký logic; cần xác nhận với khách hàng rằng bản in vẫn phải ký tay |
| Chưa tích hợp BHYT | Phòng khám có khám BHYT vẫn phải làm thủ tục quyết toán ngoài hệ thống |
| Máy trạm là máy tính văn phòng phổ thông, trình duyệt Chrome/Edge bản mới | Không hỗ trợ IE; giao diện tối ưu cho màn hình từ 1366×768 |

---

## 7. Timeline & Milestones

### Đánh giá timeline mong muốn

Yêu cầu ban đầu là **2 tháng (8 tuần)** với 3-5 dev. Ước lượng của tôi cho toàn bộ P0 ở trên là **10-14 tuần** với 4 dev, do các hạng mục sau tốn nhiều hơn vẻ ngoài:

- Cách ly multi-tenant có RLS và bộ test cách ly cho từng endpoint.
- Cơ chế đính chính bệnh án và nhật ký ghi trong cùng transaction — chạm vào mọi thao tác ghi.
- Nhập và chuẩn hoá danh mục ICD-10 kèm tìm kiếm tiếng Việt không dấu.
- Đóng gói triển khai on-premise: cài đặt, sao lưu, phục hồi, hướng dẫn cho người không rành IT.

Hai phương án:

**Phương án A — giữ mốc 8 tuần, cắt scope.** Bỏ khỏi v1: gộp hồ sơ trùng (PAT-04), tự đánh dấu không đến (APP-05), màn hình hàng đợi chung (REC-04), lưu nháp offline (ENC-06), xuất PDF bệnh án (ADM-05). Chấp nhận pilot với một phòng khám duy nhất, chưa bán rộng.

**Phương án B — pilot tuần 8, GA tuần 12.** Tuần 8 giao bản chạy được cho một phòng khám thân thiết dùng song song với sổ giấy; 4 tuần sau vá lỗi thực tế và hoàn thiện phần triển khai, rồi mới nhận khách hàng trả tiền.

**Khuyến nghị: phương án B.** Phần mềm y tế mà lỗi dữ liệu thì không rollback bằng lời xin lỗi được; 4 tuần chạy song song với sổ giấy là chi phí rẻ so với rủi ro.

### Mốc theo phương án B

| Tuần | Mốc | Tiêu chí hoàn thành |
|---|---|---|
| 1-2 | Nền tảng | Monorepo, xác thực, tenant + RLS, khung audit, CI chạy được test cách ly tenant |
| 3-4 | Bệnh nhân + Đặt lịch | PAT-01→03, APP-01→04, APP-06 chạy được đầu-cuối |
| 5-6 | Tiếp nhận + Khám | REC-01→03, ENC-01→03, danh mục ICD-10 nhập xong và tìm kiếm được |
| 7 | Kê đơn + In | PRE-01→04, mẫu in đơn được phòng khám pilot duyệt |
| 8 | **Pilot** | Cài tại phòng khám pilot, đào tạo, chạy song song sổ giấy |
| 9-10 | Vá lỗi thực tế | Xử lý lỗi từ pilot, hoàn thiện ENC-04, ENC-05, ADM-03, **BIL-01→04 (thu ngân cơ bản)** |
| 11 | Triển khai + Sao lưu | ADM-04, script cài đặt, tài liệu vận hành, diễn tập phục hồi dữ liệu |
| 12 | **GA v1** | Pilot ngừng dùng sổ giấy; đạt các chỉ số ở mục 5 |

---

## 8. Dependencies

| Phụ thuộc | Loại | Rủi ro nếu chậm |
|---|---|---|
| Danh mục ICD-10 do Bộ Y tế ban hành, kèm tên tiếng Việt | Dữ liệu | Chặn ENC-03, là P0. Cần lấy và chuẩn hoá xong trước tuần 5 |
| Phòng khám pilot đồng ý tham gia và cho đo hiện trạng | Đối tác | Không có pilot thì không có số liệu chứng minh, GA lùi vô thời hạn |
| Mẫu in đơn thuốc theo quy định | Pháp lý | Chặn PRE-04. Cần xác nhận mẫu trước tuần 6 |
| Xác nhận yêu cầu pháp lý: thời hạn lưu trữ bệnh án, yêu cầu chữ ký số | Pháp lý | Ảnh hưởng thiết kế bảng; cần chốt **trước tuần 2** |
| Máy chủ tại phòng khám pilot (cấu hình, UPS, mạng nội bộ) | Hạ tầng | Chặn mốc tuần 8 |
| Danh mục thuốc để kê đơn | Dữ liệu | Chặn PRE-01. v1 có thể dùng danh mục do phòng khám tự nhập |

---

## 9. Risks & Mitigation

| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| R1 | Timeline 8 tuần không đủ cho toàn bộ P0 | Cao | Chọn phương án B, hoặc cắt scope theo phương án A. Rà lại mốc vào cuối tuần 4 |
| R2 | Mất dữ liệu tại phòng khám do hỏng ổ cứng, mất điện | Cao | Sao lưu tự động hằng ngày ra ổ ngoài, diễn tập phục hồi trước GA, khuyến nghị UPS |
| R3 | Bác sĩ không chịu dùng, quay về ghi giấy | Cao | Đo thời gian thao tác từ tuần pilot; nếu ca khám thường vượt 3 phút thì dừng thêm tính năng, tối ưu luồng nhập |
| R4 | Yêu cầu pháp lý (chữ ký số, thời hạn lưu trữ) khác với giả định | Trung bình | Chốt với tư vấn pháp lý y tế trước tuần 2; cột và port đã để sẵn nên thay đổi không phá schema |
| R5 | Rò rỉ dữ liệu giữa các tenant | Trung bình, hậu quả nặng | RLS ở tầng DB + test cách ly bắt buộc cho mọi endpoint; không cấp `BYPASSRLS` cho app user |
| R6 | Danh mục ICD-10 tiếng Việt tìm kiếm không đủ tốt, bác sĩ chọn sai mã | Trung bình | Tìm kiếm không dấu, theo từ khoá và mã; thống kê mã hay dùng của từng bác sĩ để gợi ý |
| R7 | Chi phí kiến trúc multi-tenant + `packages/core` làm chậm v1 | Trung bình | Chấp nhận có ý thức; nếu tuần 4 trễ tiến độ, gộp `packages/core` vào api trước, tách sau |
| R8 | Không đo được hiện trạng nên không chứng minh được giá trị | Trung bình | Đo thủ công tại pilot trong 3 ngày trước khi cài đặt |
| R9 | Cạnh tranh: sản phẩm hiện có trên thị trường đã đủ tốt cho phân khúc này | Cần kiểm chứng | Khảo sát 3 sản phẩm đối thủ trong tuần 1-2, điều chỉnh định vị nếu cần |
| R10 | RBAC + Data Scope + break-glass (quyết định 2026-08-08) nặng hơn "5 vai trò cố định" ban đầu, có thể trễ S1-04 | Trung bình | ADM-07 (UI cấu hình ma trận) là P1 — cắt trước nếu trễ tiến độ; guard đọc `role_permission` vẫn bắt buộc (P0) vì đây là toàn bộ nền tảng an toàn dữ liệu lâm sàng |

---

## 10. Open Questions

Các câu hỏi cần trả lời, kèm hạn chót vì chúng ảnh hưởng tới thiết kế.

| # | Câu hỏi | Cần trả lời trước | Ảnh hưởng nếu chậm |
|---|---|---|---|
| Q1 | Thời hạn lưu trữ bệnh án điện tử và nhật ký theo quy định hiện hành là bao lâu? | Tuần 2 | Ảnh hưởng chính sách lưu trữ và dung lượng; hiện đang cấm mọi job xoá dữ liệu |
| Q2 | Bản in đơn thuốc và bệnh án có bắt buộc chữ ký số không, hay chữ ký tay trên bản in là đủ? | Tuần 2 | Nếu bắt buộc, PRE-07 chuyển thành P0 và timeline phải điều chỉnh |
| Q3 | Mô hình kinh doanh: bán đứt theo cài đặt hay thuê bao theo tháng? | Tuần 4 | Ảnh hưởng cơ chế cấp phép, cập nhật phiên bản, và có cần kết nối internet định kỳ hay không |
| Q4 | Ai chịu trách nhiệm vận hành máy chủ tại phòng khám? | Tuần 6 | Nếu không ai, phải làm bộ cài tự động và cơ chế hỗ trợ từ xa |
| Q5 | Phòng khám pilot cụ thể là đơn vị nào? | Tuần 3 | Chặn mốc tuần 8 |
| Q6 | Có cần hỗ trợ nhiều chi nhánh của cùng một chủ ngay ở v1 không? | Tuần 4 | Kiến trúc đã sẵn sàng, nhưng UI chuyển đổi chi nhánh là công việc bổ sung |
| Q7 | Danh mục thuốc lấy từ đâu, hay để phòng khám tự nhập? | Tuần 5 | Ảnh hưởng khối lượng nhập liệu ban đầu khi triển khai |

---

## 11. Appendix

### A. Phân chia phase

| Phase | Nội dung | Điều kiện bắt đầu |
|---|---|---|
| v1 | Đặt lịch, tiếp nhận, khám bệnh, kê đơn in, **thu ngân cơ bản** (BIL-01→04, Sprint 5/6 — `docs/DECISIONS.md` #072) | Đang thực hiện |
| v1.1 | Gộp hồ sơ, xuất PDF bệnh án, nhắc lịch SMS/Zalo | Sau GA v1, pilot ổn định 4 tuần |
| **v1.5** | **Gói chuyên khoa: Nhi khoa (trước) → Sản phụ khoa (sau)** — cam kết với 2 khách hàng thật đã có (`docs/DECISIONS.md` #070/#071). Viết cụ thể từng gói trên kernel hiện có, không dựng khung "Specialty Pack" trước; gating gói (`tenant.enabled_specialties`) làm cùng gói đầu tiên | Sau GA v1. Mỗi gói cần bác sĩ chuyên khoa tương ứng thẩm định mẫu bệnh án + luồng dữ liệu (đã xong cho cả 2) |
| v2 | Viện phí đầy đủ (bảng giá đa đối tượng, công nợ/trả góp theo lộ trình), báo cáo doanh thu | Sau v1.1, có ít nhất 3 khách hàng đang dùng |
| v2.1 | Dược và kho thuốc | Sau v2 |
| v3 | Tích hợp BHYT và cổng giám định, chữ ký số | Sau khi làm rõ yêu cầu pháp lý và có nhu cầu thực từ khách hàng |
| v3+ | Hồ sơ bệnh nhân dùng chung liên chi nhánh, cận lâm sàng (LIS/PACS) | Khi có khách hàng chuỗi |

### B. Thuật ngữ

| Thuật ngữ | Nghĩa trong hệ thống |
|---|---|
| Tenant | Một phòng khám, đơn vị cách ly dữ liệu |
| Encounter (lượt khám) | Một lần bệnh nhân đến khám, từ check-in tới hoàn tất |
| Amendment (đính chính) | Bản ghi mới thay thế bản đã ký, giữ nguyên bản cũ để truy vết |
| Chữ ký logic | Ghi nhận ai ký và ký lúc nào, chưa dùng chứng thư số |
| SOAP | Bốn mục ghi chép lâm sàng: chủ quan, khách quan, đánh giá, kế hoạch |

### C. Tài liệu liên quan

| Tài liệu | Nội dung |
|---|---|
| `CLAUDE.md` | Chỉ mục kỹ thuật, ràng buộc bắt buộc khi viết code |
| `.claude/docs/project-structure.md` | Cấu trúc thư mục, port và adapter |
| `.claude/docs/architecture.md` | Ranh giới module, luồng gọi giữa các tầng |
| `.claude/docs/data-model.md` | Schema, cột bắt buộc, quy ước migration |
| `.claude/docs/clinical-workflow.md` | State machine lượt khám, edge case lâm sàng |
| `.claude/docs/multi-tenancy.md` | Cách ly dữ liệu giữa các phòng khám |
| `.claude/docs/security-audit.md` | Phân quyền, nhật ký, mã hoá |
| `.claude/docs/coding-standards.md` | Quy ước viết code |

### D. Lịch sử phiên bản

| Version | Ngày | Thay đổi |
|---|---|---|
| v1.0 | 07/08/2026 | Bản đầu tiên, dựa trên phạm vi kỹ thuật đã chốt |
| v1.1 | 08/08/2026 | Thay mô tả "5 vai trò cố định" bằng RBAC + Data Scope (ADM-01 cập nhật, thêm ADM-06 break-glass, ADM-07 UI cấu hình ma trận), thêm rủi ro R10 |
| v1.2 | 22/08/2026 | **Mở rộng phạm vi v1**: thêm mục 4.7 "Thu ngân cơ bản" (BIL-01→04, P0, làm ở Sprint 5/6) — trước đây xếp v2, chuyển vào v1 vì là điều kiện bắt buộc để đạt mốc GA "pilot ngừng dùng sổ giấy hoàn toàn". Thêm phase **v1.5 — Gói chuyên khoa** (Nhi khoa → Sản phụ khoa) vào Appendix A cho 2 khách hàng thật đã có. Xem `docs/DECISIONS.md` #069→#072 |
