# Multi-tenancy — NEXAMed

Mô hình: **shared database, shared schema**, cách ly bằng cột `tenant_id` + Row Level Security của PostgreSQL. Một tenant = một phòng khám (bảng `clinic`).

> **"Một phòng khám" ở đây nghĩa là một CƠ SỞ/CHI NHÁNH, không phải một công ty/pháp nhân** (làm rõ 2026-08-25, `docs/DECISIONS.md` #074). **Không tồn tại tầng "công ty" nào nằm trên `tenant`**: công ty có 3 chi nhánh = 3 tenant tách biệt hoàn toàn, không có gì nối lại (xem hệ quả đầy đủ + lộ trình mở rộng ở `docs/Deploy.md` Phần 0.1). Đừng viết code giả định có thể gom nhiều tenant về một chủ sở hữu — khái niệm đó chưa tồn tại.
>
> **Hướng mở rộng ĐÃ CHỐT (2026-08-25, `docs/DECISIONS.md` #075)**: khi có khách chuỗi, `tenant` sẽ trở thành **CÔNG TY** và chi nhánh là bảng `branch` **bên trong** tenant (không phải mỗi chi nhánh một tenant). Hệ quả bắt buộc cho code viết từ nay: **cấm giả định "1 tenant = 1 địa điểm vật lý"**; `code_sequence` **giữ nguyên** theo `(tenant_id, prefix)` (đã đúng hướng — mã bệnh nhân duy nhất toàn công ty); `patient` **không** cần `branch_id`, còn `encounter`/`appointment` thì có. Chi tiết: `docs/Deploy.md` Phần 0.1.

## Vì sao chọn mô hình này

| Mô hình | Ưu | Nhược |
|---|---|---|
| Shared schema + `tenant_id` (đang dùng) | Migration một lần, chi phí hạ tầng thấp, dễ báo cáo toàn hệ thống | Rò rỉ dữ liệu nếu quên điều kiện lọc — phải bù bằng RLS |
| Schema riêng mỗi tenant | Cách ly tốt hơn | Migration nhân theo số tenant, chậm khi vượt vài trăm phòng khám |
| Database riêng | Cách ly tuyệt đối, dễ backup/restore theo khách | Chi phí và vận hành cao nhất |

Nếu sau này có khách yêu cầu database riêng, tách bằng cách route connection theo tenant — **không** đổi mô hình cột `tenant_id` vì toàn bộ code đang dựa vào nó.

## Ràng buộc bắt buộc

1. Mọi bảng nghiệp vụ có `tenant_id UUID NOT NULL` (trừ bảng danh mục toàn hệ thống chỉ đọc lúc chạy: `icd10_catalog`, `permission`, `province`, `ward`, và chính bảng `tenant`; `reference_catalog`/`allergen`/`allergen_group` đã RIÊNG THEO TENANT từ `docs/DECISIONS.md` #230).
2. Bật RLS cho tất cả bảng có `tenant_id`:
   ```sql
   ALTER TABLE encounter ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON encounter
     USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
   ```
   App user không có `BYPASSRLS`. Bật thêm `FORCE ROW LEVEL SECURITY` (migration `20261013110000`) để policy áp dụng cả với chủ sở hữu bảng. Đây là lớp phòng thủ cuối — không thay thế việc lọc trong code. Test `rls-coverage.spec.ts` canh toàn lược đồ.
3. Mỗi request, middleware set `app.current_tenant_id` từ JWT vào session/transaction của Prisma trước khi chạy query. Không lấy `tenant_id` từ body, query param hay header do client gửi.
4. Khoá ngoại phải cùng tenant. Composite FK `(tenant_id, id)` cho các quan hệ liên bảng nghiệp vụ, tránh trường hợp `encounter` của phòng khám A trỏ tới `patient` của phòng khám B.
5. Unique constraint luôn kèm `tenant_id`: `UNIQUE (tenant_id, patient_code)`, không phải `UNIQUE (patient_code)`.
6. Bệnh nhân **không** dùng chung giữa các tenant ở v1: cùng một người khám ở hai phòng khám là hai bản ghi `patient` độc lập. Nhưng code viết sẵn cho việc dùng chung sau này — mọi tra cứu bệnh nhân đi qua `PatientIdentityPort` (adapter v1 trả chính `patient.id` trong tenant), cột `global_patient_ref` đã có sẵn và luôn null ở v1. Không viết query đọc dữ liệu bệnh nhân xuyên tenant, kể cả cho mục đích chống trùng.
7. Sequence sinh mã hiển thị tính theo tenant: bảng `code_sequence (tenant_id, prefix, current_value)`, cấp số trong transaction bằng `SELECT ... FOR UPDATE`.
8. **Chi nhánh là lớp lọc RIÊNG, không phải ranh giới tenant** (`docs/DECISIONS.md` #231): `tenant` = công ty, `branch` nằm bên trong. Dữ liệu theo địa điểm (phòng, lịch hẹn, lượt khám, ca đã xếp...) lọc `branch_id` = chi nhánh hiện hành của phiên ở tầng repository (`requireBranchId(req.user!)`, thiếu → 409 `BRANCH_NOT_SELECTED`; tra id chi nhánh khác → 404 như cô lập tenant). RLS vẫn chỉ theo `tenant_id`. Ngoại lệ có chủ đích: lịch sử khám theo bệnh nhân xem được mọi chi nhánh (lâm sàng đầy đủ, tiền của chi nhánh không được gán bị che, ghi audit). **Ngoại lệ thứ hai (#234)**: kết quả cận lâm sàng ĐÃ DUYỆT theo bệnh nhân (tab "Kết quả cận lâm sàng") cũng đọc mọi chi nhánh — chỉ qua đường dẫn theo bệnh nhân (`/paraclinical/{lab,imaging}/patients/:patientId/...`) với `ResultAccessScope.crossBranchPatientId` (bỏ lọc chi nhánh nhưng dòng chỉ định phải đúng bệnh nhân + đã duyệt, ngoài ra 404); mọi đường cận lâm sàng khác vẫn lọc chi nhánh hiện hành. **Đợt 2 (#233)**: kho/quỹ/ca thu ngân gắn `branch_id`, chứng từ kế thừa qua kho/quỹ/lượt khám (repository lọc `warehouse: { branchId }`, `cashAccount: { branchId }`...; `findByIdAnyBranch`-kiểu hàm không lọc chi nhánh chỉ dành cho điều chuyển và tra tên). Công nợ NCC và ví là dữ liệu chung: dòng trỏ chứng từ chi nhánh khác chỉ hiện số phiếu + số tiền + tên chi nhánh, KHÔNG mở được phiếu. Điều chuyển liên chi nhánh: phiếu thuộc chi nhánh GỬI, chi nhánh NHẬN thấy từ lúc Duyệt xuất (không thấy giá vốn). Giao diện quyết định hiện nhãn/tab chi nhánh bằng `multiBranchCompany` của phiên (công ty ≥ 2 chi nhánh), KHÔNG bằng số chi nhánh tài khoản được gán.

## Cấu hình theo tenant

Bảng `tenant_setting (tenant_id, key, value_json)` cho: giờ làm việc, thời gian slot khám, ngưỡng đánh `NO_SHOW`, danh sách phòng, mẫu in đơn thuốc. Không hard-code các giá trị này trong service.

## Test bắt buộc

Mỗi endpoint chạm dữ liệu bệnh nhân phải có ít nhất một integration test: đăng nhập bằng tenant A, gọi tới ID thuộc tenant B, kỳ vọng `404` (không phải `403` — tránh lộ sự tồn tại của bản ghi).
