# HANDOFF — Tab "Lịch sử khám chữa bệnh" (xong) + luồng "Xin nghỉ" & lưới Lịch hẹn theo ca (mockup đã duyệt, CHƯA làm) — 2026-10-09

> Nhánh `feat/patient-encounter-history` (commit `beb7d76`, đã push, **chưa mở PR**). Branch gốc là `master` sau PR #4/#5 (đã merge). Hội thoại luôn tiếng Việt. Đọc cùng `docs/DECISIONS.md` **#223**. Quy tắc chủ dự án: dựng mockup và chờ "duyệt" rõ ràng trước khi code; sau khi duyệt thì làm đúng mockup (~95%) và báo mọi chỗ lệch.

## 1. Đã làm xong (verify Chrome thật 3 vai trò)

- **Tab "Lịch sử khám chữa bệnh"** ở `/patients/:id` (mockup Artifact `FP31Qg44HibS78u9GYa5Ej`): `PatientEncounterHistoryTab.tsx`. Bảng cuộn ngang (Ngày khám dính trái, Thao tác dính phải, tiêu đề dính), lọc "Đã hoàn tất / Tất cả", "Cột hiển thị" 6 cột tuỳ chọn (nhớ theo tài khoản trong localStorage), tự tải thêm khi cuộn, "Xem" mở `EncounterHistoryDetailDialog` (thêm khối `EncounterParaclinicalSection`).
- **Quyền mới `encounter.read_clinical`** (mặc định bác sĩ/điều dưỡng/quản lý): `GET /encounters/:id/consultation` và route web `encounters/:id` giờ cần quyền này → **lễ tân không còn mở được hồ sơ khám** (lỗ hổng cũ). Vai trò tuỳ biến đang dùng màn khám phải được cấp thêm.
- **Backend**: `GET /encounters/by-patient/:patientId/history` (gate `patient.read`, cursor theo `id`, `@AuditView('patient', {paramName:'patientId'})`); máy chủ tự bỏ trường lâm sàng/chi phí nếu actor thiếu `encounter.read_clinical`/`invoice.read`; chỉ lấy bản ĐÃ KÝ. Port mới `EncounterBillingReaderPort` (adapter `infrastructure/billing`, module `@Global()` `EncounterBillingReaderModule`), hàm thuần `summarizeEncounterInvoices` (core). `ParaclinicalProgressReaderPort` thêm `getResultCountsByEncounter`.
- **Dùng chung mới**: `shared/ui/ColumnVisibilityMenu.tsx`, `shared/hooks/useColumnVisibility.ts`.
- **Lưới Lịch hẹn**: ô giờ trống rê chuột hiện nút tròn xanh "Đặt lịch HH:mm" (`AppointmentGridView.tsx`).
- Test: `patient-encounter-history-http.spec.ts` 8, core +6 (`encounter-billing-summary.spec.ts`); bộ API đầy đủ 1306 đạt (chỉ lỗi race `seedDefaultRolesForTenant` đã biết, chạy riêng đạt), core 366, shared 31, web 29; typecheck + eslint sạch.
- Docs đã cập nhật: DECISIONS #223, CHANGELOG, CURRENT ("Đang chờ"), TASK, `.claude/docs/security-audit.md` (hàng `encounter.read_clinical`).
- Lệch mockup đã báo: khối cận lâm sàng dùng khung thẻ chuẩn (mockup có viền hổ phách + nhãn "Mới" chỉ để đánh dấu), nút "Xem" là `Button` có icon + chữ.

## 2. Việc tiếp theo (theo thứ tự)

1. **Mở PR** từ `feat/patient-encounter-history` (không có `gh` — dùng GitHub REST với credential đã lưu, xem memory `reference_open_pr_via_git_credential`; script mẫu: lấy token qua `git credential fill`, `POST /repos/phanuy261991-hash/NEXAMed/pulls`). Merge khi chủ dự án duyệt.
2. **Luồng "Xin nghỉ có duyệt" + lưới Lịch hẹn lọc theo ca** — mockup Artifact `7Xa9ZS8sXXWBi1XZaZuLBx` (6 màn) **đã được chủ dự án duyệt ("làm đúng mockup vì quá đẹp rồi")**, chưa viết dòng code nào. Quyết định đã chốt qua `AskUserQuestion`:
   - Ghi nghỉ bằng **đơn xin nghỉ có duyệt**: nhân viên xin nghỉ trên ngày ĐÃ có ca (từng ca hoặc cả ngày, lý do bắt buộc, từ hôm nay trở đi), rút đơn được khi chưa duyệt; ca đã đăng ký giữ nguyên (nghỉ là bản ghi riêng, có lịch sử — nền cho chấm công). Quản lý "Ghi nghỉ hộ" thì duyệt luôn; quản lý huỷ được đơn đã duyệt. Từ chối bắt buộc lý do.
   - **Quyền mới nhóm "Đơn xin nghỉ"** (chủ dự án dặn thêm): Xem (của mình / toàn phòng khám), Xin nghỉ (cho chính mình — mọi vai trò), **Duyệt đơn nghỉ** (mặc định chỉ Quản lý phòng khám), Ghi nghỉ hộ (mặc định Quản lý). Không tự duyệt đơn của chính mình (trừ người ghi hộ).
   - Bác sĩ nghỉ mà **đã có lịch hẹn**: vẫn cho nghỉ; lịch hẹn trong khung nghỉ đã duyệt hiện "Cần xử lý" (viền đỏ trên lưới + nút đỏ "N lịch hẹn cần xử lý" mở danh sách bên phải); lễ tân gọi bệnh nhân rồi dùng chức năng sẵn có: Đổi bác sĩ (Sửa lịch) / Dời lịch / Huỷ lịch. **Hệ thống không tự huỷ/chuyển.**
   - **Lưới Lịch hẹn** hiện bác sĩ **có ca ngày đó + bác sĩ còn lịch hẹn** (kể cả đang nghỉ, để không mất lịch); công tắc "Hiện cả bác sĩ chưa đăng ký ca". **Nếu cả ngày không bác sĩ nào đăng ký ca (phòng khám không dùng tính năng ca) → hiện tất cả như hiện nay** — phải đảm bảo phòng khám 1 bác sĩ/không dùng đặt lịch/không đăng ký ca không đổi gì (đã hứa với chủ dự án; chỉ đếm BÁC SĨ, đăng ký ca của điều dưỡng/lễ tân không làm lưới bị lọc).
   - **Khung nghỉ đã duyệt chặn cứng** đặt/sửa/dời lịch vào bác sĩ đó (bất kể công tắc "Chặn đặt lịch ngoài ca"); đơn **chờ duyệt** chỉ hiện nhãn hổ phách, chưa chặn. Chọn bác sĩ khi Đặt lịch: bác sĩ nghỉ trong khung giờ đang chọn thì không chọn được; nghỉ ca khác trong ngày vẫn chọn được, có ghi chú.
   - **Tiếp nhận**: thẻ bác sĩ có nhãn đỏ "Nghỉ sáng nay/Nghỉ hôm nay"; chọn bác sĩ đang nghỉ phải xác nhận (không chặn cứng — tiếp nhận tại quầy có thể có lý do đặc biệt).
   - Số đơn chờ duyệt hiện chấm số ở menu "Lịch làm việc nhân viên"; trang quản lý đơn là tab "Đơn xin nghỉ" cạnh "Lịch theo tháng".
   - Việc cần khảo sát/chốt kỹ thuật trước khi code (dùng `EnterPlanMode`): bảng mới (vd `leave_request`, đủ 8 cột bắt buộc, RLS, bản ghi duyệt/từ chối có lý do), port đọc nghỉ cho `AppointmentService` (đúng khuôn `WorkShiftAssignmentReaderPort`, gọi NGOÀI transaction đang mở), lỗi mới kiểu `AppointmentDoctorOnLeaveError` (409), trạng thái "Cần xử lý" tính lúc đọc (không lưu cột), nhãn audit tiếng Việt cho action/entityType mới (test `audit-labels-coverage` chặn), permission mới + `db:seed`.
   - Kiến thức nền đã khảo sát: lưới hiện lấy `useDoctorsQuery()` KHÔNG truyền ngày (`AppointmentSchedulePage.tsx`), ca đăng ký lấy qua `GET /appointments/doctor-work-shifts?date=` (`useDoctorWorkShiftsQuery`); bảng `work_shift_assignment` (`userId`/`workShiftId`/`workDate`); quyết định #102 điểm 5 (bác sĩ chưa đăng ký ca KHÔNG bị giới hạn gì) và #103 (Tiếp nhận không lọc/không chặn theo ca) là nền — luồng nghỉ là lớp MỚI, không đảo ngược hai quyết định đó.
3. Dựng lại gói on-prem sau khi merge (`deploy/on-prem/build-and-export.ps1`, KHÔNG chuyển hướng log; xoá bản cũ trong `package/images/` trước khi gửi máy khách; gói hiện có `2026.10.08.3` là bản cũ, chưa gồm #220–#223).
4. Thử máy in tem và súng quét USB thật (#220, còn treo).
5. Treo dài hạn (không đổi): S6-02/S6-04, PRE-02, trường VTYT riêng, máy in nhiệt K80, hiển thị SID trên phiếu kết quả, LIS/PACS (v3+).

## 3. Môi trường & tài khoản dev

- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`; `dev.admin` / `Dev@12345`. API dev chạy từ `apps/api/dist` (cổng 3001), web `vite` cổng 5173 — **không tự chạy lại sau khi đóng phiên**, khởi động tay (`node --enable-source-maps dist/main` trong `apps/api`; sửa API thì `pnpm --filter @nexamed/api build` rồi khởi động lại). Dev DB đã `db:seed` (có `encounter.read_clinical`).
- Dữ liệu thử: bệnh nhân BN2610000030 (lượt khám đã hoàn tất có đơn thuốc DT2610000007, kết luận, lời dặn, hẹn tái khám 22/10/2026) và BN2610000040 (lời dặn đã đính chính). Tài khoản `vf.lichsu.letan`/`vf.lichsu.bs` đã vô hiệu hoá. Dữ liệu thử không xoá được qua API.
- Playwright: dùng `playwright-core@1.63.0` trong `node_modules/.pnpm`, Chrome cài sẵn `C:/Program Files/Google/Chrome/Application/chrome.exe` (script ở scratchpad phiên, không commit). Render PDF thành ảnh: nạp pdf.js từ cdnjs trong một trang Playwright (máy không có `pdftoppm`; có `pdftotext`).

## 4. Bẫy kỹ thuật phiên này

- **Heredoc bash chứa tiếng Việt/dấu nháy lẫn quote hỏng im lặng hoặc báo `unexpected EOF`** — viết script bằng công cụ Write rồi chạy; script Python dùng `io.open(..., encoding='utf-8', newline='')` để không đổi kiểu xuống dòng.
- `GET /users` bỏ qua `q` (và có phân trang cursor): script dọn tài khoản phải lọc client-side theo ĐÚNG tiền tố, in danh sách khớp TRƯỚC khi sửa (memory `feedback_cleanup_filter_by_prefix`).
- Sửa nhãn/schema ở `packages/shared` hoặc `packages/core` phải `pnpm --filter @nexamed/shared build` / `@nexamed/core build` trước khi chạy test API; API dev nạp core từ `dist` lúc khởi động nên cũng phải khởi động lại.
- Thêm permission mới: `db:seed` + khởi động lại API (đồng bộ `role_permission` lúc khởi động) — quên là trang "Vai trò & Phân quyền" không thấy quyền mới.
- `apps/web` KHÔNG import GIÁ TRỊ từ `@nexamed/shared`/`@nexamed/core` (#073): hằng/hàm dùng ở web phải phản chiếu cục bộ (có `satisfies` hoặc test bắt lệch).
- `POST /patients` trả **200** (không phải 201); `encounter.performance` ngoại tuyến là `'EXTERNAL'` (không phải `'OUTSIDE'`).
- Lỗi flaky đã biết khi chạy CHUNG toàn bộ test API: `floor-exam-station-http.spec.ts`/`clinic-profile-http.spec.ts`/`sync-role-permissions` (race `seedDefaultRolesForTenant`) — chạy riêng đạt.
