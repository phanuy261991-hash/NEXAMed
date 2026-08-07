# Multi-tenancy — NEXAMed

Mô hình: **shared database, shared schema**, cách ly bằng cột `tenant_id` + Row Level Security của PostgreSQL. Một tenant = một phòng khám (bảng `clinic`).

## Vì sao chọn mô hình này

| Mô hình | Ưu | Nhược |
|---|---|---|
| Shared schema + `tenant_id` (đang dùng) | Migration một lần, chi phí hạ tầng thấp, dễ báo cáo toàn hệ thống | Rò rỉ dữ liệu nếu quên điều kiện lọc — phải bù bằng RLS |
| Schema riêng mỗi tenant | Cách ly tốt hơn | Migration nhân theo số tenant, chậm khi vượt vài trăm phòng khám |
| Database riêng | Cách ly tuyệt đối, dễ backup/restore theo khách | Chi phí và vận hành cao nhất |

Nếu sau này có khách yêu cầu database riêng, tách bằng cách route connection theo tenant — **không** đổi mô hình cột `tenant_id` vì toàn bộ code đang dựa vào nó.

## Ràng buộc bắt buộc

1. Mọi bảng nghiệp vụ có `tenant_id UUID NOT NULL` (trừ bảng danh mục toàn hệ thống: `icd10_catalog`, `province`, `drug_catalog`).
2. Bật RLS cho tất cả bảng có `tenant_id`:
   ```sql
   ALTER TABLE encounter ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON encounter
     USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
   ```
   App user không có `BYPASSRLS`. Đây là lớp phòng thủ cuối — không thay thế việc lọc trong code.
3. Mỗi request, middleware set `app.current_tenant_id` từ JWT vào session/transaction của Prisma trước khi chạy query. Không lấy `tenant_id` từ body, query param hay header do client gửi.
4. Khoá ngoại phải cùng tenant. Composite FK `(tenant_id, id)` cho các quan hệ liên bảng nghiệp vụ, tránh trường hợp `encounter` của phòng khám A trỏ tới `patient` của phòng khám B.
5. Unique constraint luôn kèm `tenant_id`: `UNIQUE (tenant_id, patient_code)`, không phải `UNIQUE (patient_code)`.
6. Bệnh nhân **không** dùng chung giữa các tenant ở v1: cùng một người khám ở hai phòng khám là hai bản ghi `patient` độc lập. Nhưng code viết sẵn cho việc dùng chung sau này — mọi tra cứu bệnh nhân đi qua `PatientIdentityPort` (adapter v1 trả chính `patient.id` trong tenant), cột `global_patient_ref` đã có sẵn và luôn null ở v1. Không viết query đọc dữ liệu bệnh nhân xuyên tenant, kể cả cho mục đích chống trùng.
7. Sequence sinh mã hiển thị tính theo tenant: bảng `code_sequence (tenant_id, prefix, current_value)`, cấp số trong transaction bằng `SELECT ... FOR UPDATE`.

## Cấu hình theo tenant

Bảng `tenant_setting (tenant_id, key, value_json)` cho: giờ làm việc, thời gian slot khám, ngưỡng đánh `NO_SHOW`, danh sách phòng, mẫu in đơn thuốc. Không hard-code các giá trị này trong service.

## Test bắt buộc

Mỗi endpoint chạm dữ liệu bệnh nhân phải có ít nhất một integration test: đăng nhập bằng tenant A, gọi tới ID thuộc tenant B, kỳ vọng `404` (không phải `403` — tránh lộ sự tồn tại của bản ghi).
