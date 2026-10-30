# HANDOFF — Hồ sơ bệnh án theo mẫu MS 15/BV-01, "Số lưu trữ" (#270) — 2026-10-30 phần 2

> Hội thoại luôn tiếng Việt. Commit/push thẳng `master` CHỈ khi chủ dự án yêu cầu. Trước khi push: `pnpm typecheck` + `pnpm lint` + test liên quan; full API ĐÚNG 1 lượt.

## Trạng thái một câu
Đã sửa lỗi "Số bệnh án" của #269: khung bệnh án + bản in + mã đã chuyển sang mẫu MS 15/BV-01 hiện hành (Thông tư 32/2023/TT-BYT). Code + test + Chrome xong; **CHƯA commit** (26 file), full API xem mục "Kiểm".

## Chuyện gì đã xảy ra
Chủ dự án nhắc "mã hồ sơ bệnh án có vẻ sai quy định". Tra cứu (đọc trực tiếp PDF Thông tư 32/2023 và Phụ lục XXVIII): **Quyết định 4069/2001 hết hiệu lực 01/01/2024**; mẫu ngoại trú hiện hành MS 15/BV-01 có ô "Số ngoại trú" + "Số lưu trữ", không có "Số bệnh án". Chi tiết + lý do ở `docs/DECISIONS.md` #270 (đọc trước).

## Đã làm
- **Mã (phương án B, chủ dự án chốt)**: mã hồ sơ = mã bệnh nhân `BN…`; mỗi lần khám = phiếu `LK…` (cũng là "Số ngoại trú"); thêm "Số lưu trữ" `LT2026-000042` (cấp lúc Hoàn tất khám, theo năm, đặt lại mỗi đầu năm). Nhãn Khám mới/Tái khám = tên Loại tiếp nhận (`RECEPTION_TYPE`). Tiếp nhận KHÔNG đổi.
- **Đổi tên**: loại mã `MEDICAL_RECORD`→`ARCHIVE_NO` (enum mẫu in `MEDICAL_RECORD` giữ nguyên, không liên quan); cột `encounter.record_no`→`archive_no` (migration `20261030120000_encounter_archive_no`, đã áp lên CSDL dev); `recordNo`→`archiveNo` toàn tuyến; OpenAPI + kiểu web đã sinh lại.
- **Bản in** `renderEncounterMedicalRecordHtml` (core): đầu "MS: 15/BV-01", hàng mã, mục I (13 mục, "Sinh ngày" và "Tuổi" tách ô), II, III, IV (7 mục), trang "Tổng kết bệnh án" (6 mục), chữ ký ở cuối tờ 1 và Tổng kết, rồi phiếu kết quả + đơn thuốc. Cỡ chữ 11,5px để tờ 1 + chữ ký vừa A4 (dữ liệu dài vẫn có thể tràn chữ ký sang trang sau — chấp nhận).
- **Web**: tab (`MedicalRecordSheet.tsx`, `medical-record-model.ts`, `PatientMedicalRecordTab.tsx`) đúng khung mới; mẫu xem trước ở Quản lý mẫu in; nhãn "Bệnh án (xuất PDF)"→"Bệnh án"; ô "Tiên lượng"→"Tình trạng người bệnh khi kết thúc khám" (giá trị `PROGNOSIS` giữ nguyên).
- **Sửa kèm**: cột SL đơn thuốc trong bản in hiện tên đơn vị ("14 viên") thay mã ("14 VIEN"); mã chưa có trong danh mục thì vẫn hiện mã.
- Tài liệu: DECISIONS #270, CHANGELOG, CURRENT, TASK, ERD v1.89.

## Kiểm
- shared 116, core 595, web 474 xanh; typecheck + lint toàn cục sạch; API nhóm `medical-record-http` + `business-code-http` 27 xanh (thêm ca: đơn thuốc đã ký in tên đơn vị, nhãn Khám mới).
- Chrome thật localhost + IP LAN HTTP 31/31 (tab, in bộ hồ sơ, xuất PDF, lỗi 403/409/mất mạng/503); tab + màn khám + mẫu in ở 10 cỡ (390 → 3840) 31/31 không cuộn ngang/tràn phải/lỗi JS. Ở 390px khung ứng dụng (menu trái 240px) chiếm gần hết màn hình — CÓ SẴN, không do tab này.
- Không quét 53 trang: chỉ các màn đã đổi (chủ dự án đồng ý).
- **Full API (1 lượt, 30/10/2026)**: 121 file đạt (1 bỏ qua), **1881 test đạt**, ~10,5 phút, gồm các test cô lập công ty/chi nhánh; chưa chạy CI GitHub (chưa push).

## Việc kế tiếp (theo thứ tự)
1. Chủ dự án duyệt/commit; chạy CI sau push.
2. **Căn cứ pháp lý — ĐÃ XÁC NHẬN VÀ SỬA**: nguyên văn Thông tư 13/2025/TT-BYT Điều 4 khoản 3 điểm a: Thông tư 46/2018 hết hiệu lực từ ngày ban hành 06/06/2025. Đã sửa trích dẫn ở `CLAUDE.md`, PRD, `.claude/docs/clinical-workflow.md` + 3 chú thích mã (chi tiết ở `docs/DECISIONS.md` #270). Việc mới cho chủ dự án cân nhắc: đối chiếu "chữ ký logic" với Điều 3 và mốc **31/12/2026** (phòng khám ngoại trú phải có bệnh án điện tử). Cách đặt số "Số ngoại trú"/"Số lưu trữ": chỉ có tài liệu cộng đồng, nên hỏi Sở Y tế nếu muốn chắc.
3. Phòng khám cần có mục "Khám mới"/"Tái khám" trong danh mục Loại tiếp nhận (máy dev đã có `RT_NEW`, `RT_RETURN`).
4. Chưa duyệt, để dành: nút "Gợi ý theo cơ quan" ở ô "Các bộ phận"; liên kết lượt tái khám với lượt gốc / "đợt theo dõi" cho gói Sản-Nhi (số lưu trữ khi đó có thể chuyển cấp sang đợt — tên `archive_no`/`ARCHIVE_NO` đã đặt trung tính cho việc này).
5. Việc cũ chưa làm: danh sách thay đổi khi cập nhật phần mềm ở cả máy chủ phát hành lẫn bộ cài on-prem (cần mockup, xem bàn giao `HANDOFF-HoSoBenhAn-SoBenhAn-InBoHoSo-2026-10-30.md` mục 5).

## Bẫy đã gặp
- Máy dev chỉ ~600 MB RAM trống: Chrome tự động chết giữa chừng khi quét liền nhiều trang; chạy từng nhóm nhỏ, tắt dev server khi chạy full test. `spawnSync` với pipe làm treo khi con của Chrome giữ pipe — ghi stdio ra file.
- KHÔNG bật hai API cùng cổng 3001 (`pnpm dev` đã có sẵn watcher; bật thêm bản riêng chết vì trùng cổng).
- Sau khi đổi core phải `pnpm --filter @nexamed/core build` VÀ khởi động lại API (API nạp bản dựng một lần).
- Shell ăn dấu `\` khi vá bằng `node -e`: dùng Write + `node file.cjs` hoặc `scripts/patch-file.mjs`; kiểm lại regex.
- `dev:lan` đổi `apps/web/public/config.json` — khi nó chạy, cổng 5173 mất địa chỉ API; kiểm qua cổng 5174. Tự khôi phục khi thoát.
- Chú thích ở mockup (khối "Điểm cần bạn quyết", ô vàng) chỉ để duyệt — không chép vào sản phẩm.
