# HANDOFF — Đơn xin nghỉ (xong) + Duyệt đăng ký ca theo tháng + Đổi ca (code xong, verify Chrome xong, CHƯA commit) — 2026-10-09

> Nhánh **`feat/leave-request`** (tách từ `feat/patient-encounter-history`, PR #6 đã mở: https://github.com/phanuy261991-hash/NEXAMed/pull/6, chưa merge). **Toàn bộ thay đổi phiên này CHƯA commit** (git status bẩn: ~60 file). Hội thoại luôn tiếng Việt. Đọc cùng `docs/DECISIONS.md` **#224** và **#225**. Quy tắc chủ dự án: dựng mockup, chờ "duyệt/chốt" rõ ràng rồi mới code; sau đó làm đúng mockup (~95%) và báo mọi chỗ lệch.

## 1. Đã làm xong
- **PR #6 mở** (tab "Lịch sử khám" + quyền `encounter.read_clinical`); tab đã đổi tên "Lịch sử khám" (sửa trong nhánh này, thuộc PR #6 → cherry-pick nếu muốn gom).
- **Chip "Lịch hẹn trong ngày"** (Lịch hẹn): ô viền xanh, số nền xanh đặc, chữ "L" hoa.
- **#224 Đơn xin nghỉ có duyệt + lưới Lịch hẹn theo ca**: bảng `leave_request`, quyền `leave_request.*`, chặn đặt/sửa/dời lịch vào khung nghỉ đã duyệt (`AppointmentDoctorOnLeaveError`), "Cần xử lý" tính lúc đọc, tab "Đơn xin nghỉ" + chấm số, nút "Ghi nghỉ hộ", lưới lọc bác sĩ theo ca, picker bác sĩ, Tiếp nhận nhãn "Nghỉ sáng/chiều/hôm nay" + xác nhận. `TabBar` thêm `badge` + `variant="underline"`; `ReasonConfirmDialog` dời sang `shared/ui`.
- **Ngày đã qua không đăng ký/sửa/xoá ca** (#224): trừ người có quyền "Sửa lịch đã khoá".
- **#225 Duyệt đăng ký ca theo THÁNG + Đổi ca** (mockup chốt, Artifact `YTLLxr7bD9juCmMn4d6JC7`): xem `docs/DECISIONS.md` #225. Tóm tắt: công tắc "tự đăng ký ca" BẬT → nhân viên đăng ký **tháng sau** ở **Nháp** → **Gửi duyệt cả tháng** → quản lý **Duyệt/Trả lại** (tab "Đăng ký ca"); sau khi gửi/duyệt không tự sửa; **Đổi ca** 2 ca cho nhau (người nhận xác nhận là đổi ngay, chặn nếu có lịch hẹn/đơn nghỉ/đã qua/chưa duyệt); tab "Đổi ca" của quản lý chỉ đọc, nhãn "Mới", chấm số = yêu cầu mới chưa xem. Công tắc TẮT → tab "Đăng ký ca" + chấm số ẩn.
- **Test**: `leave-request-http.spec.ts` 18, `work-schedule-submission-http.spec.ts` 7, `shift-swap-http.spec.ts` 8, `work-shift-assignment-http.spec.ts` 21 (sửa đồng hồ giả về 15/8, ca test ở tháng 9); core +9 (`leave-window`, `self-registration`); web +13. Đột biến đã kiểm (tắt chặn nghỉ/lịch hẹn/ngày đã qua thì test fail). `pnpm -w typecheck` sạch. **Bộ API đầy đủ chạy nền cuối phiên** (log `scratchpad/api-full-test2.log`) — chưa đọc kết quả; lần chạy trước (trước #225) 1324 đạt, chỉ lỗi lẻ race `seedDefaultRolesForTenant` (chạy riêng đạt).
- **Chrome thật** (tenant test `01a0cc3c-…`, dữ liệu qua HTTP API, tài khoản `vf.*` đã vô hiệu hoá): đủ luồng Nháp → Gửi duyệt → Trả lại (thấy lý do) → Gửi lại → Duyệt → Đổi ca (menu ô ca → chọn đồng nghiệp/ca → Chờ xác nhận) → người nhận xác nhận → lịch đổi → tab "Đổi ca" có chấm số + nhãn "Mới" → mở tab chấm số về 0; 0 lỗi console.

## 2. Việc tiếp theo (theo thứ tự)
1. **Đọc kết quả bộ API đầy đủ** (`scratchpad/api-full-test2.log` hoặc chạy lại `cd apps/api && pnpm exec vitest run`); lỗi lạ nào ngoài race đã biết thì sửa. Chạy `pnpm -w lint`.
2. **Commit + PR** (chủ dự án chưa yêu cầu commit; không có `gh` → dùng REST API với credential Git, memory `reference_open_pr_via_git_credential`). Gợi ý tách 2 commit: #224 và #225. PR #6 nên merge trước hoặc gộp.
3. **Verify Chrome còn nợ**: công tắc "tự đăng ký" TẮT (My page không banner/nút; tab "Đăng ký ca" ẩn; xin nghỉ/đổi ca vẫn chạy); cell menu "Xoá ca (đã khoá)" ở tháng đã duyệt; màn tuần/ tháng của quản lý (global) không đổi.
4. Việc nhỏ chưa làm: test web cho banner trạng thái tháng; lọc nhân viên đã nghỉ việc khỏi danh sách đồng nghiệp đổi ca; thông báo toast cho người nhận khi có yêu cầu mới (hiện chỉ banner + chấm số).
5. **Câu hỏi chủ dự án nêu cuối phiên, CHƯA trả lời đủ**: nếu phòng khám mở cả tuần nhưng nhân viên nghỉ luân phiên 1 ngày/tuần (4 ngày/tháng) thì hệ thống hiểu ngày không có ca là ngày off? → Hiểu cho **xin nghỉ** (cần có ca mới xin nghỉ được) và **lưới Lịch hẹn** (ẩn bác sĩ không có ca), nhưng **KHÔNG ép/chặn**: vẫn đặt lịch/tiếp nhận được cho bác sĩ không có ca (quyết định #102 điểm 5 + #103, để không khoá phòng khám không dùng ca) và **không kiểm quota nghỉ tối thiểu**. Cần hỏi chủ dự án có muốn thêm công tắc "chặn đặt lịch/tiếp nhận ngày bác sĩ không có ca" và/hoặc quy tắc "mỗi tuần nghỉ tối thiểu N ngày" khi duyệt đăng ký tháng không.
6. Dựng lại gói on-prem sau khi merge (`deploy/on-prem/build-and-export.ps1`, KHÔNG chuyển hướng log; xoá bản cũ trong `package/images/`); gói hiện có `2026.10.08.3` chưa gồm #220–#225.
7. Treo dài hạn (không đổi): thử máy in tem/súng quét USB (#220), S6-02/S6-04, PRE-02, trường VTYT riêng, máy in nhiệt K80, LIS/PACS (v3+).

## 3. Môi trường & tài khoản dev
- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`; `dev.admin` / `Dev@12345`. Dev DB đã `db:deploy` (2 migration mới: `20261009100000_leave_request`, `20261010090000_schedule_submission_shift_swap`) + `db:seed`.
- **API dev (cổng 3001) đã được tôi dừng/khởi động lại nhiều lần** (cần để `prisma generate` — engine DLL bị khoá khi API chạy). Lần cuối khởi động từ `apps/api/dist` (sau `pnpm --filter @nexamed/api build`) bằng `node --enable-source-maps dist/main` chạy nền ẩn. Phiên mới: kiểm `Get-NetTCPConnection -LocalPort 3001`; web `vite` cổng 5173 không tự chạy lại.
- Sửa API → `pnpm --filter @nexamed/core build` / `@nexamed/shared build` trước, rồi `pnpm --filter @nexamed/api build` và khởi động lại; đổi schema Prisma → dừng API trước khi `prisma generate`.
- Dữ liệu thử còn lại trên tenant test: ca "VF Ca Sáng"/"VF Ca Chiều", các tài khoản `vf.nghi.*`/`vf.ca.*` (đã vô hiệu hoá, không xoá được qua API), ca/đơn nghỉ/đổi ca thử (đã dọn phần xoá được). Dọn script phải lọc ĐÚNG tiền tố (memory `feedback_cleanup_filter_by_prefix`).
- Playwright: `playwright-core@1.63.0` trong `node_modules/.pnpm`, Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`; script verify ở scratchpad phiên (`verify-leave.mjs`, `verify-225.mjs`) — không commit. **Đăng nhập có rate-limit (429)**: chạy lặp nhiều lần phải chờ ~1 phút.

## 4. Bẫy kỹ thuật phiên này
- **Heredoc bash chứa tiếng Việt + dấu nháy hỏng im lặng/`unexpected EOF`** — ghi script bằng công cụ Write rồi chạy (python `io.open(..., encoding='utf-8', newline='')` giữ kiểu xuống dòng; file repo lẫn CRLF/LF nên dò `nl` từng file).
- Nhiều spec dùng đồng hồ giả (`vi.useFakeTimers({toFake:['Date']})`): đẩy đồng hồ xa >15 phút làm access token hết hạn → tạo người dùng/đăng nhập SAU khi đặt giờ.
- Fixture test `apps/api/src/testing/tenant-fixture.ts` phải dọn bảng mới theo thứ tự FK (đã thêm `leave_request`, `shift_swap_request`, `work_schedule_submission`).
- Thêm permission mới: `db:seed` + khởi động lại API (đồng bộ `role_permission` lúc boot).
- `apps/web` KHÔNG import GIÁ TRỊ từ shared/core (#073): hằng/hàm phản chiếu cục bộ có spec (`leave-window.ts`, `schedule-month.ts`).
- Nhãn audit mới BẮT BUỘC (test `audit-labels-coverage`); sửa `packages/shared` → build trước khi chạy test API.
- Mutation test đã dùng cách sửa file → chạy → khôi phục bằng bản sao ở scratchpad; kiểm `grep -c "&& false"` = 0 sau khi khôi phục.
