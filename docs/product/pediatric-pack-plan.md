# Kế hoạch gói Nhi khoa (v1.5) — bản nháp, CHƯA làm

**Ngày lập**: 2026-10-21. **Trạng thái**: chỉ là kế hoạch; chủ dự án bảo tạm dừng, làm việc khác. Chưa có dòng code, bảng, migration hay mockup nào. Chưa có quyết định mới ở `docs/DECISIONS.md` (khi chốt các câu mục 4 thì ghi quyết định mới).

Nguồn gốc: `docs/product/multi-specialty-analysis.md` (hướng "Specialty Pack"), `docs/DECISIONS.md` #033/#058/#069/#070/#071/#072 (bản cũ ở `docs/archive/DECISIONS-001-099.md`), `docs/product/prd.md` phase v1.5. Thứ tự đã chốt từ trước: **Nhi trước, Sản sau**; viết cụ thể gói Nhi trên kernel hiện có, không dựng khung Specialty Pack tổng quát; gating tối thiểu làm cùng gói Nhi; template engine mẫu in chỉ trích xuất khi làm gói Sản; bác sĩ chuyên khoa đã thẩm định mẫu bệnh án + luồng dữ liệu (22/08/2026).

## 1. Phạm vi đã chốt trong phiên 20/10/2026
- **Nhi thuần**: mỗi tenant chỉ bật 1 chuyên khoa, máy chủ tự suy `encounter.specialty`, không hỏi lễ tân. Vẫn viết để sau này thêm được chế độ chọn khi đa khoa.
- Gói Nhi bản đầu gồm 3 phần: **tăng trưởng + vòng đầu**, **tiền sử sinh**, **liều thuốc theo cân nặng (PRE-06)**.
- **Chưa làm**: sổ tiêm chủng, mẫu bệnh án nhi (Tầng 3 — mẫu in), gói Sản. Sản làm sau Nhi, trích xuất phần dùng chung lúc đó.
- Bước kế tiếp đã chọn: khảo sát code + lập kế hoạch (tài liệu này), rồi mới làm mockup cho chủ dự án duyệt.

## 2. Hiện trạng code (đã kiểm 20/10/2026)
- `encounter.specialty` có (mặc định `general`) nhưng chỉ đọc, chưa ai ghi. Chưa có `tenant.enabled_specialties`. `packages/core/src/specialty/registry.ts` chỉ là khung tối thiểu.
- `vital_sign` có `weight_gram`, `height_mm`; **chưa có vòng đầu**.
- `calculateAgeMonths` đã có (`packages/shared/src/patient.ts`, do liên thông đơn thuốc làm); tuổi hiển thị vẫn theo năm.
- `vital-sign-thresholds.ts` ghi rõ KHÔNG làm percentile tăng trưởng WHO.
- Kê đơn có liều có cấu trúc theo buổi (`dose_morning/noon/afternoon/evening`, bước ¼, `Decimal(5,2)`); `drug.concentration` là chuỗi tự do (chưa có hàm lượng quy ra mg); chưa có quy tắc liều nhi.
- `TrendChart` (`apps/web/src/shared/ui/TrendChart.tsx`) chỉ có một dải thấp/cao và trục theo điểm — không đủ cho biểu đồ WHO nhiều đường percentile theo tuổi.
- Người giám hộ trẻ dưới 72 tháng đã có (liên thông đơn thuốc).

## 3. Kế hoạch 4 giai đoạn (mỗi giai đoạn: mockup → chủ dự án duyệt rõ ràng → code → chạy lại toàn bộ test, báo cô lập tenant/chi nhánh ở đầu)
| GĐ | Nội dung | Ước lượng thô |
|---|---|---|
| N0 | **Gating**: `tenant.enabled_specialties`, guard tầng API (khuôn `PermissionGuard`), script `apps/api/scripts/enable-specialty.ts` (không làm màn hình quản trị, #070), đưa danh sách chuyên khoa vào phiên đăng nhập, máy chủ tự suy `encounter.specialty`; không có `if (specialty)` trong kernel | 2–3 ngày |
| N1 | **Nhập liệu nhi**: `vital_sign.head_circumference_mm`; bảng 1–1 `patient_birth_history` (cân nặng/chiều dài lúc sinh, tuổi thai, cách sinh, Apgar); hiển thị tuổi theo tháng/ngày cho trẻ nhỏ | 4–5 ngày |
| N2 | **Tăng trưởng WHO**: dữ liệu LMS (cân nặng, chiều dài/cao, BMI, vòng đầu theo tuổi), hàm tính z-score/percentile ở `packages/core`, `GrowthChart` dùng chung ở `shared/ui`, tab "Tăng trưởng" ở hồ sơ bệnh nhân, dải tóm tắt ở màn khám | 7–9 ngày |
| N3 | **Liều theo cân nặng (PRE-06)**: hàm lượng có cấu trúc cho thuốc, quy tắc liều nhi theo từng thuốc, cảnh báo ở màn kê đơn (tái dùng khuôn công tắc "cảnh báo/chặn" của Kho Thuốc GĐ5) | 7–9 ngày |

Tổng khoảng 22–28 ngày công (thô; chưa tính chờ duyệt mockup/dữ liệu; số cũ 15–20 ngày ở #070 không dùng lại — #071 mục 3.2).

## 4. Câu cần chủ dự án quyết trước khi làm mockup (CHƯA chốt)
1. **Dữ liệu WHO**: tôi tải bảng LMS công bố của WHO rồi sinh file dữ liệu bằng script (bác sĩ nhi đối chiếu mẫu vài mốc), hay chủ dự án cung cấp file (như ICD-10)? Không tự gõ số.
2. **Vòng đầu**: thêm cột vào `vital_sign` (đề xuất) hay bảng riêng?
3. **Tiền sử sinh**: bảng 1–1 riêng `patient_birth_history` (đề xuất) hay thêm cột vào `patient`?
4. **Quy tắc liều nhi**: ai nhập? Phòng khám tự nhập theo từng thuốc (liều tối thiểu/tối đa mg/kg/ngày, số lần/ngày, trần tuyệt đối), hệ thống chỉ cảnh báo (đề xuất); hay nạp sẵn bộ dữ liệu liều (kéo theo trách nhiệm chuyên môn)? Thuốc nước tính mL có nới bước liều ¼ không (4,3 mL hiện không biểu diễn được)?
5. **Tuổi theo tháng**: áp dụng cho mọi tenant khi bệnh nhân dưới 36 tháng (đề xuất, chỉ là định dạng hiển thị) hay chỉ khi bật gói nhi?
6. **Hoãn**: mẫu bệnh án nhi (Tầng 3) và sổ tiêm chủng để ngoài đợt này — xác nhận.

## 5. Checklist bắt buộc khi làm (đã có quy tắc sẵn)
- 4 câu hỏi hướng chi nhánh (`CLAUDE.md`): sinh hiệu kế thừa chi nhánh qua lượt khám; tiền sử sinh + tăng trưởng theo bệnh nhân, dùng chung cả công ty (ngoại lệ xem liên chi nhánh khi mở đúng hồ sơ bệnh nhân); công ty 1 chi nhánh giao diện không đổi; test cô lập 2 chi nhánh cùng tenant.
- Mỗi bảng mới: đủ 8 cột bắt buộc, RLS + FORCE, dọn trong `tenant-fixture.ts`, nhãn audit tiếng Việt cho mọi action/entityType (#213, `audit-labels-coverage.spec.ts`), `@AuditView` cho GET chi tiết lâm sàng; sửa nhãn ở `packages/shared` phải build shared trước khi chạy test API.
- Không rò cache xuyên tenant (cache dữ liệu LMS là hằng số tĩnh, không phụ thuộc tenant — chấp nhận được; cache cấu hình chuyên khoa thì phải khoá theo `tenantId`).
- Trang mới: lazy load (chunk khởi động ≤ 500 kB), kiểm Chrome thật (web chỉ `import type` từ `@nexamed/shared`), kiểm nhiều cỡ màn hình, độ đậm chữ tối đa semibold, form có `<form>` + Enter-to-submit.
- Parameterize hoá theo props, không hard-code nhi vào component dùng chung (`ReceptionIntakeForm`, `PatientFormFields`, `VitalSignsDialog`, `EncounterConsultationPage`) — phạm vi retrofit thực tế sẽ đo ở bước khảo sát màn hình.
- Mockup phải ghi rõ câu trả lời "theo chi nhánh hay chung công ty"; sau khi mockup chốt thì bám ~95%.
