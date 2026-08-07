# Security & Audit — NEXAMed

## Vai trò trong v1

| Vai trò | Được xem | Được ghi |
|---|---|---|
| `receptionist` | Hồ sơ hành chính, lịch hẹn, hàng đợi | Tạo/sửa hồ sơ hành chính, đặt lịch, check-in |
| `nurse` | Dữ liệu lâm sàng của lượt khám đang phụ trách | Sinh hiệu, ghi chú điều dưỡng |
| `doctor` | Toàn bộ dữ liệu lâm sàng của bệnh nhân trong phòng khám | Chẩn đoán, ghi chú SOAP, kê đơn, ký |
| `clinic_admin` | Cấu hình, người dùng, danh mục của tenant mình | Cấu hình phòng khám; **không** ghi dữ liệu lâm sàng |
| `system_admin` | Danh mục toàn hệ thống, tenant | Không truy cập dữ liệu bệnh nhân của tenant |

Nguyên tắc: quyền kiểm ở tầng service/repository, không chỉ ẩn nút trên UI. `system_admin` không có đường tắt xem dữ liệu lâm sàng — cần thao tác hỗ trợ thì dùng quy trình cấp quyền tạm có audit và thời hạn.

## Xác thực

- JWT access token 15 phút + refresh token httpOnly cookie, xoay vòng mỗi lần refresh.
- Mật khẩu hash Argon2id. Không dùng bcrypt/MD5/SHA cho mật khẩu.
- Khoá tài khoản tạm sau 5 lần đăng nhập sai trong 15 phút.
- Đổi vai trò hoặc chuyển tenant thu hồi toàn bộ phiên đang mở.
- JWT chứa `tenantId`; middleware set `app.current_tenant_id` cho phiên DB từ giá trị này (xem `multi-tenancy.md`).

## Dữ liệu định danh

- Mã hoá at-rest AES-256-GCM (khoá từ `ENCRYPTION_KEY`): `patient.national_id`, `insurance_card.card_no`, file đính kèm.
- Tra cứu theo giá trị mã hoá dùng cột hash riêng; không giải mã hàng loạt để so sánh.
- Không đưa PII/PHI vào: log ứng dụng, message lỗi trả client, URL/query string, tên file export, hệ thống giám sát bên thứ ba.
- Export dữ liệu ghi audit kèm phạm vi bản ghi và lý do export.

## Audit log

Ghi bắt buộc cho: đăng nhập/đăng xuất, **xem hồ sơ bệnh nhân**, tạo/sửa/soft-delete dữ liệu lâm sàng, ký ghi chú và đơn thuốc, chuyển trạng thái encounter, in đơn, gộp hồ sơ, đổi vai trò người dùng, export.

Bảng `audit_log` append-only: không endpoint sửa/xoá; quyền DB của app user chỉ `INSERT` và `SELECT`. Ghi audit nằm cùng transaction với thao tác nghiệp vụ — ghi audit lỗi thì rollback thao tác.

Lưu trữ tối thiểu theo thời hạn quy định với bệnh án; thời hạn cụ thể chưa chốt với nghiệp vụ, không tự đặt job xoá audit.

## Chữ ký số (chưa triển khai ở v1)

v1 dùng chữ ký logic: `signed_at` + `signed_by` + ghi audit. Cột `signature_payload` và `SignaturePort` đã để sẵn, adapter hiện tại là no-op. Không tự ý tích hợp CA, không tự chọn chuẩn ký (PKCS#7, XAdES) — chờ chốt với nghiệp vụ, vì lựa chọn này ảnh hưởng tới định dạng lưu và quy trình xuất bệnh án.

## Ràng buộc khi viết code

- Không thêm endpoint trả danh sách bệnh nhân không phân trang hoặc không lọc `tenant_id`.
- Không `console.log` đối tượng `patient`, `encounter`, `prescription`.
- Không tắt guard ở môi trường dev bằng biến môi trường; dùng tài khoản seed đúng vai trò.
- File upload: chỉ nhận `pdf, jpg, png, dcm`; kiểm magic byte thay vì tin `Content-Type`; lưu ngoài web root; phục vụ qua signed URL có hạn.
- Rate limit riêng cho endpoint tra cứu bệnh nhân — chống dò dữ liệu bằng cách quét mã.
