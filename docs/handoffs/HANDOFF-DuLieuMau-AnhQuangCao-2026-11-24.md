# HANDOFF — Dữ liệu mẫu chụp ảnh quảng cáo, danh sách tính năng (sau phát hành 0.9.7) — chốt phiên 2026-11-24

(Bản bàn giao DUY NHẤT còn trong repo; thay `HANDOFF-Phat-hanh-0.9.7-2026-11-18.md`. Chi tiết kỹ thuật phát hành 0.9.7 ở `docs/DECISIONS.md` #301–#304 và `docs/CHANGELOG.md`.)

## 1. Trạng thái một câu
**`0.9.7` đã phát hành và giao được (tag `v0.9.7` → `f2d42cf8`); không còn việc code dở trong phần mềm.** Phiên 23–24/11 chỉ làm dữ liệu mẫu + ảnh chụp + tài liệu, nằm ở `scripts/demo-data/` và thư mục ngoài repo.

## 2. Việc đầu tiên của phiên sau
1. Đọc `docs/CURRENT.md`, `docs/TASK.md` (mục F/D ở cuối), file này.
2. `git status` phải sạch. Kiểm CI GitHub cho commit mới nhất (máy KHÔNG có `gh`: script GitHub REST qua Git Credential Manager, xem memory `reference_open_pr_via_git_credential`; CI đã xanh đến `928d35eb`, `7ff19a53` và commit bàn giao này chưa kiểm).
3. Hỏi chủ dự án việc kế tiếp (mục 5). Nếu cần xem/chụp dữ liệu mẫu: mục 4.

## 3. Đã làm (18–24/11/2026)
- **Phát hành `0.9.7`** (đã ghi ở bàn giao trước): gói giao khách `C:\Projects\NEXAMed-demo-package\giao-khach-0.9.7` (ZIP 1.072 MB, SHA-256 `252eb973…99d457`), nguồn `NEXAMed-0.9.7`. Hiệu năng D (tải trước chunk JS) đã kiểm Chrome thật: lượt vào trang đầu 167 tệp JS → 0, lợi ích thời gian nhỏ (#304). Logo dự phòng đầu menu `h-6` → `h-8` (`1ab5a87d`).
- **5 ảnh quảng cáo** (Facebook, DSF 2, PNG): `C:\Projects\NEXAMed-demo-package\anh-quang-cao\` — lịch hẹn tổng quan, đặt lịch nhanh, bệnh nhân trong ngày, tiếp nhận (form điền đủ), đầu bệnh án MS 15/BV-01 (bản in thật từ PDF, cắt phần đầu). Ảnh 04 có CCCD/SĐT tự soạn → che trước khi đăng. Chụp bằng công ty Hòa Hưng, `apps/web/public/config.json` KHÔNG bị đổi (vẫn tenant test cố định).
- **Danh sách tính năng** (231 mục, 3 mức Đã có/Đang làm/Chưa có, định dạng Markdown theo yêu cầu): `C:\Projects\NEXAMed-demo-package\danh-sach-tinh-nang-NEXA-Med.md`. Soạn từ tài liệu dự án, không đối chiếu từng mục với mã.
- **Đoạn "Project instructions" cho claude.ai**: đã soạn và gửi trong chat (không lưu tệp).
- **Dữ liệu mẫu công ty "Phòng khám Đa khoa Hòa Hưng"** (commit `7ff19a53` + commit bàn giao này), xem mục 4.

## 4. Dữ liệu mẫu (`scripts/demo-data/`, đọc README ở đó)
- `seed-demo-clinic.mjs` (170 bệnh nhân, 5 bác sĩ, ca làm việc, hơn 100 lịch hẹn/ngày với đủ trạng thái, tiếp nhận + hàng chờ hôm nay theo giờ chạy, mỗi bác sĩ ≥ 8 người chờ và 1 người đang khám) và `seed-demo-pharmacy.mjs` (62 thuốc, 12 vật tư, 4 nhà cung cấp, 5 phiếu nhập + lô sắp hết hạn + tồn thấp). Chỉ gọi API, chạy lại được. Tham số: `--days=5 --patients=170 --waiting=8 --no-reception`.
- **Tài khoản** (mật khẩu chung `HoaHung@2026`, tenant `01a1c100-5884-7bdb-8558-0981f8cbf306`): `giamdoc` = TOÀN QUYỀN (155/155; vai trò "Quản trị toàn quyền" + `clinic_admin`), `hoangnam` = quản lý, bác sĩ `bs.thanhphong` (Nội), `bs.quocviet` (TMH), `bs.maianh` (Nhi), `bs.giabao` (Tim mạch), `bs.minhchau` (Da liễu), lễ tân `letan.thuha`/`letan.ngoctram`, `dd.kimngan`, `xn.minhkhang`.
- **Đang chạy ở máy dev (sẽ TẮT khi máy khởi động lại / hết phiên)**: API production cổng 3001 + `vite preview` cổng 4173 (`--host 0.0.0.0`, LAN `192.168.1.114:4173`, chưa thử từ máy khác). Cách bật lại: `docker compose up -d`; `cd apps/api && NODE_ENV=production PORT=3001 node dist/main.js`; `cd apps/web && VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite preview --host 0.0.0.0 --port 4173`; `apps/web/dist/config.json` phải là `{ "apiBaseUrl": "", "tenantId": "01a1c100-5884-7bdb-8558-0981f8cbf306" }` (dist nằm ngoài git, build lại sẽ mất → đặt lại). Dữ liệu "hôm nay" phụ thuộc giờ chạy script; chụp ban ngày 08:30–17:00 thì đẹp nhất.
- Thay đổi dữ liệu riêng của công ty Hòa Hưng (không phải mã): "Ca tối" 17:30–22:00, `overdueWaitWarningMinutes=120`, thêm khoa Tim mạch/Da liễu + phòng, dịch vụ khám Tim mạch/Da liễu, 62 hoạt chất.

## 5. Việc còn
- **Chờ chủ dự án**: thêm số liên hệ hỗ trợ vào `HUONG-DAN-CAI-DAT.txt` rồi chia sẻ `giao-khach-0.9.7`; thử **cài MỚI từ ZIP** trên thư mục trống (mới thử nâng cấp); gỡ luật tường lửa "NEXAMed LAN test 8181" (cần Administrator); thông tin liên hệ/bản quyền thật cho trang Cập nhật phần mềm.
- **Lỗi giao diện nhỏ phát hiện khi chụp ảnh, CHƯA sửa**: ô "Ngày tiếp nhận" ở form Tiếp nhận bị cắt chữ ("18/11/202…") ở cả 1440 và 1600px.
- **Dữ liệu mẫu**: lượt tiếp nhận chuyển từ lịch hẹn mang giờ lúc chạy script (check-in từ lịch không lùi giờ được), nên chạy vào buổi tối thì nhiều dòng cùng giờ; lượt khám 18/11 của bệnh nhân BN2611000025 (Võ Quốc Tuấn) có lời khai tăng huyết áp + đái tháo đường không khớp tiền sử hồ sơ.
- **Đề xuất hiệu năng chưa làm**: logo in chỉ tải khi in; phân trang máy chủ `dispense-queue`; lưới Lịch làm việc và `/admin/catalog-pharmacy` còn nặng.
- **Việc cũ còn mở (không đổi)**: S6-02 diễn tập phục hồi + S6-04 đo tải trên máy chủ pilot thật rồi `1.0.0`; hạ tầng SaaS (chờ báo giá; adapter S3 cho `StoragePort` cùng MỘT ảnh Docker); kiểm bộ cài trên Windows sạch/Linux/NAS/Let's Encrypt; liên thông đơn thuốc cổng thật; gói Nhi khoa (tạm dừng); chữ ký điện tử bệnh án (làm sau).

## 6. Bẫy đã gặp (đọc trước khi làm)
- **API danh sách trả 20 dòng/trang mặc định** (lịch hẹn, tiếp nhận, bệnh nhân...). Dùng `limit=100` + `cursor` (con trỏ = id dòng cuối); script đọc thiếu trang → xử lý/đếm sai chỉ một phần dữ liệu.
- **"Hàng đợi khám" khoá theo TÊN vai trò** (`DOCTOR_QUEUE_ROLES = doctor, clinic_admin`, `features/auth/workflow-roles.ts`), KHÔNG theo quyền; vai trò tuỳ biến dù đủ 155 quyền vẫn bị chặn. Vai trò `doctor` kéo theo hộp "Chọn phòng làm việc" mỗi lần đăng nhập. Hàng đợi chỉ hiện của CHÍNH người đăng nhập.
- **Tiếp nhận từ lịch hẹn (`/reception/check-in`) KHÔNG có `checkedInAt`**; chỉ `/reception/direct` lùi giờ được. Bác sĩ chưa đóng ca các ngày trước (ca xếp vào quá khứ) bị chặn bắt đầu khám → gọi `POST /doctor-availability/:id/close-pending`. Thu tiền cần ca thu ngân mở (đang dùng ca của `letan.thuha`).
- API cho phép "Không đến" cả với lịch ở tương lai (dùng để có màu trên lịch demo); `reschedule` cần ô giờ trống, dời sang ngày chưa có lịch.
- Đăng nhập giới hạn 10 lần/phút/tài khoản (script nên giữ token); khoá chống ghi trùng `Idempotency-Key` bắt buộc cho POST từ script.
- Chuyển PDF bệnh án thành ảnh: `pymupdf` (đã cài), KHÔNG dùng `python -I` (mất gói người dùng), đặt `PYTHONIOENCODING=utf-8`. Lượt khám đã ký sửa bằng `clinical-note/amend` (mục `SUMMARY`...) không hiện nhãn đính chính trên bản in.
- Từ bàn giao cũ, vẫn đúng: heredoc bash + tiếng Việt cắt cụt tệp (viết bằng công cụ Write rồi `node tệp.cjs`; vá tài liệu bằng `scripts/patch-file.mjs`); KHÔNG chạy full test API cùng typecheck/build; `ALTER ROLE` cần khởi động lại API; tải tệp lớn phải kiểm qua nginx thật; `apps/web` chỉ import KIỂU từ `@nexamed/shared`; bản dev `-beta.N` cần ghi chú riêng không commit + đổi số mỗi lần dựng, bản giao khách dựng từ `git worktree` đúng tag.

## 7. Quy tắc chủ dự án nhắc (đã ghi memory)
Tuân thủ mockup tuyệt đối; **"tiếp tục"/"làm luôn" KHÔNG phải duyệt mockup**; ảnh chụp kiểm tra KHÔNG lưu vào repo (để scratchpad hoặc thư mục ngoài repo); dữ liệu chụp ảnh phải sạch (không chữ test/demo, không mã ngẫu nhiên); commit/push thẳng `master` khi được yêu cầu, không PR; trả lời bằng tiếng Việt; trước mỗi push chạy `pnpm typecheck` + `pnpm lint` toàn kho; chỉ đọc file bàn giao mới nhất (đây là bản duy nhất); giữ nguyên màu chữ xám hiện trạng; giao khách bằng ZIP + SHA-256 + hướng dẫn.
