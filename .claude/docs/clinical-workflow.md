# Clinical Workflow — NEXAMed (v1)

## State machine của encounter

```
SCHEDULED ──check-in──> CHECKED_IN ──bác sĩ nhận──> IN_CONSULTATION ──hoàn tất──> COMPLETED

SCHEDULED  ──huỷ──> CANCELLED
SCHEDULED  ──quá giờ, không đến──> NO_SHOW
CHECKED_IN ──bỏ về──> CANCELLED (bắt buộc có lý do)
```

Quy tắc:
- Chỉ chuyển theo cạnh đã định nghĩa. Không nhảy cóc, không có đường lùi từ `COMPLETED`.
- v1 dừng ở `COMPLETED`. Trạng thái `CLOSED` gắn với thanh toán, thuộc v2 — không thêm vào enum bây giờ.
- `NO_SHOW` do job nền đánh dấu sau `scheduled_at + ngưỡng`, ngưỡng lấy từ `tenant_setting`, mặc định 60 phút. Không hard-code trong service.
- Mỗi lần chuyển trạng thái ghi một dòng `audit_log` kèm actor, trạng thái trước/sau, thời điểm.

## Đặt lịch

- Slot theo `tenant_setting.slot_duration_minutes`, mặc định 15 phút.
- Chống trùng lịch bác sĩ kiểm ở DB bằng exclusion constraint (xem `data-model.md`), service bắt lỗi constraint và trả `APPOINTMENT_SLOT_CONFLICT`. Không dựa vào kiểm tra read-then-write ở tầng service — có race condition.
- Walk-in tạo `appointment` với `source = walk-in` và check-in ngay trong cùng transaction.
- Huỷ lịch bắt buộc có `cancel_reason`. Lịch đã `CHECKED_IN` không huỷ được, chỉ chuyển `CANCELLED` qua luồng bỏ về.
- **Sửa lịch** (`PATCH /appointments/:id`, trong ngày, tại chỗ) và **Dời lịch** (`POST /appointments/:id/reschedule`, sang ngày khác — lịch cũ chuyển `RESCHEDULED`, tạo lịch mới) là 2 thao tác tách biệt, tồn tại song song (`docs/DECISIONS.md` #053). Xem chi tiết ở `data-model.md` mục `appointment`.

**Đặt lịch "lead capture" (`docs/DECISIONS.md` #032, thay thế mô tả cũ "đặt lịch cho một `patient` đã có")**:
- Đặt lịch **không** tạo hoặc gắn hồ sơ `patient` — chỉ ghi nhận trực tiếp Họ tên/SĐT/lý do khám lên chính `appointment` (`full_name`/`phone`/`reason`). Việc tạo/khớp hồ sơ `patient` chuyển hẳn sang lúc Tiếp nhận (check-in tại quầy, module `encounter` — Sprint 3, chưa xây).
- Mỗi lịch hẹn có `booking_code` (mã đặt lịch, sinh atomic qua `code_sequence` giống `patient_code`) — khách trình mã này lúc đến, lễ tân tra theo mã hoặc theo lưới/danh sách.
- Nhập SĐT lúc đặt: tra `appointment (tenant_id, phone)` lấy Họ tên của lần đặt gần nhất để tự điền (không bắt gõ lại), và đếm số lần `status=CANCELLED` cùng SĐT — đạt ngưỡng (mặc định 5) thì cảnh báo khả năng spam trên UI, **không chặn** đặt lịch (ngưỡng này chỉ so sánh ở web, API chỉ trả số đếm thô).
- **Check-in** (nút trên web, chưa có màn hình Tiếp nhận thật): chuyển thẳng `SCHEDULED → CONVERTED`, không sinh trạng thái mới trong enum, không tạo `encounter`, không gắn `patient_id`. Khi Sprint 3 xây Tiếp nhận thật, bước tạo `encounter` + gắn/tạo `patient` sẽ nối vào đúng thao tác check-in này (giản lược tạm thời hiện tại chỉ đổi trạng thái).

## Tiếp nhận (check-in)

- Tạo `encounter` từ `appointment`, snapshot thông tin thẻ BHYT vào `insurance_snapshot_json` (số thẻ, tỷ lệ hưởng, nơi đăng ký, hạn thẻ). v1 chỉ lưu để hiển thị và in, **không tính chi trả**.
- Không thẻ hoặc thẻ hết hạn: snapshot `benefit_rate = 0`, `self_pay = true`.
- Điều dưỡng ghi `vital_sign` sau check-in. Sinh hiệu ngoài ngưỡng sinh lý cảnh báo trên UI nhưng vẫn cho lưu — không chặn nhập.
- **Điều phối Bác sĩ/Khoa — "Hàng đợi ảo" (`docs/DECISIONS.md` #064)**: lúc check-in, lễ tân chọn "đích danh bác sĩ" (`encounter.doctor_id` gán ngay, `department_id` server tự suy từ hồ sơ bác sĩ) hoặc "theo Khoa, chưa rõ bác sĩ" (`doctor_id=NULL`, `department_id` client chọn thẳng — lượt khám rơi vào hàng chờ CHUNG của Khoa đó). Không có nhánh thứ ba; mọi `encounter` luôn có `department_id` hợp lệ (Khoa mặc định "Khoa chung" tự seed mỗi tenant nếu chưa gán Khoa cụ thể).

## Khám bệnh

- Chuyển `IN_CONSULTATION` khi bác sĩ nhận lượt khám; ghi `started_at`. Với `encounter.doctor_id` đã có sẵn (ca "của mình") đây là "Bắt đầu khám" bình thường. Với `doctor_id=NULL` (ticket trong hàng chờ chung Khoa) đây là **"Nhận ca"** — CHỈ bác sĩ CÙNG Khoa với ticket claim được, `doctor_id` được gán = bác sĩ đó ngay lúc chuyển trạng thái (ghi có điều kiện `WHERE doctor_id IS NULL`, chống 2 bác sĩ nhận trùng cùng lúc — người thua nhận lỗi `ENCOUNTER_ALREADY_CLAIMED`, không phải lỗi hệ thống).
- Bắt buộc có ít nhất một `diagnosis` với `type = primary` trước khi chuyển `COMPLETED`.
- Mã chẩn đoán chọn từ `icd10_catalog`. Không cho nhập mã tự do, không tự suy mã từ mô tả bệnh.
- `clinical_note` theo 4 mục SOAP. Ký ghi chú (`signed_at`) đóng băng nội dung.

## Kê đơn (v1: chỉ in đơn)

- Tạo được khi encounter ở `IN_CONSULTATION` và đã có chẩn đoán chính.
- Kiểm tra trước khi ký: trùng hoạt chất giữa các dòng, liều vượt ngưỡng theo ngày, chống chỉ định theo tuổi, đối chiếu `patient.allergy_note`. Chặn ký (hard stop) chỉ với chống chỉ định tuyệt đối; còn lại là cảnh báo mềm, bác sĩ xác nhận vượt qua và hệ thống ghi lý do vào audit.
- Ký ở v1 là chữ ký logic: ghi `signed_at`, `signed_by`, gọi `SignaturePort` (adapter no-op). Không tích hợp CA, không sinh chữ ký số. Sau khi ký, đơn bất biến. Sửa = tạo đơn mới `supersedes_id` trỏ về đơn cũ, đơn cũ đặt `deleted_at` + `deleted_reason`.
- v1 không trừ tồn kho, không kiểm tra thuốc còn hàng.

## Amendment hồ sơ (Thông tư 46/2018/TT-BYT)

Sửa dữ liệu lâm sàng đã ký luôn theo mô hình: bản ghi mới (`supersedes_id` = bản cũ, `amendment_reason` bắt buộc, `created_by` = người sửa) + bản cũ đặt `deleted_at` + `deleted_reason`. Truy vấn hiển thị mặc định lọc `deleted_at IS NULL`; màn hình lịch sử hiển thị đủ chuỗi kèm người sửa và thời điểm.

## Edge case cần xử lý đúng

- Khám nhiều lượt trong cùng ngày: mỗi lượt một `encounter` riêng, không gộp.
- Đổi bác sĩ giữa chừng: cập nhật `doctor_id`, ghi audit, không tạo encounter mới.
- Trùng hồ sơ bệnh nhân: dùng luồng merge — giữ record đích, chuyển toàn bộ encounter sang, record nguồn đặt `merged_into_id` và ngừng cho tạo mới. Không xoá record nguồn.
- Bệnh nhân không có CCCD (trẻ em, người không giấy tờ): `national_id` cho phép null, chống trùng chuyển sang tổ hợp họ tên + ngày sinh + số điện thoại người giám hộ, chỉ cảnh báo.
- Mất kết nối khi bác sĩ đang khám: form khám lưu nháp phía client, gửi lại khi có mạng; nháp không tạo bản ghi lâm sàng nào cho tới khi submit thành công.
