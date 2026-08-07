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

## Tiếp nhận (check-in)

- Tạo `encounter` từ `appointment`, snapshot thông tin thẻ BHYT vào `insurance_snapshot_json` (số thẻ, tỷ lệ hưởng, nơi đăng ký, hạn thẻ). v1 chỉ lưu để hiển thị và in, **không tính chi trả**.
- Không thẻ hoặc thẻ hết hạn: snapshot `benefit_rate = 0`, `self_pay = true`.
- Điều dưỡng ghi `vital_sign` sau check-in. Sinh hiệu ngoài ngưỡng sinh lý cảnh báo trên UI nhưng vẫn cho lưu — không chặn nhập.

## Khám bệnh

- Chuyển `IN_CONSULTATION` khi bác sĩ nhận lượt khám; ghi `started_at`.
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
