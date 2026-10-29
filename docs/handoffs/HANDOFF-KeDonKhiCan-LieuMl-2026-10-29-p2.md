# HANDOFF — Kê đơn theo kiểu kê của thuốc ("Khi cần" + liều ml), #267 phần 2 — 2026-10-29 (phần 2)

> Hội thoại luôn tiếng Việt. Commit/push thẳng `master` CHỈ khi chủ dự án yêu cầu. Trước push: `pnpm typecheck` + `pnpm lint` + đúng 1 lượt full API.

## Trạng thái một câu (cập nhật cuối phiên)
Phần 2 của #267 **ĐÃ COMMIT + PUSH** (`ac055a1`), chủ dự án đã xem demo Chrome thật và CHỐT cách hiển thị liều ("Mỗi lần 1,5 gói, khi cần" dễ hiểu). Commit **`399b6f2`** (xoá tệp mockup `docs/design/dose-modes-dispense-label-mockup.html` theo yêu cầu chủ dự án, tài liệu tham chiếu đã ghi chú "tệp đã xoá") **CHƯA PUSH** — `master` đang đi trước `origin/master` 1 commit; chờ chủ dự án nói "push". Phần 1 đã push từ trước (`4a5c7e4`). Quyết định ở `docs/DECISIONS.md` #267 (đoạn "Phần 2"), schema ở `docs/ERD-2.md` mục 3.17.

## Đã làm
- DB: migration `20261029100000_prescription_item_dose_mode` (`prescription_item` thêm `dose_mode`/`single_dose`/`dose_unit_name`/`dose_per_base_unit`, `duration_days` NULL; `prescription_template_item` thêm `dose_mode`/`single_dose`). CHECK theo kiểu kê. Môi trường khác cần `db:deploy` (dev tenant đã áp).
- `packages/shared/src/prescription.ts`: `resolvePrescriptionItemDose` (một nguồn quyết định kiểu kê + số lượng + chụp đơn vị liều), `isPrescriptionDoseComplete`, `hasFractionalPrescriptionDose`, `formatPrescriptionDose` ("Sáng 5 ml - Tối 5 ml" / "Mỗi lần 1,5 gói, khi cần"), `quartersPerBaseUnit`. Bản sao client ở `apps/web/src/features/encounter/prescription-dose-preview.ts` (sửa y hệt cả hai).
- API: `EncounterService.toCreateItemData` + `PrescriptionRepository.findDrugDoseConfigs` (đọc cấu hình thuốc + tên đơn vị trong cùng transaction, KHÔNG gọi port), đơn mẫu, phiếu xuất/nhãn/PDF/liên thông.
- Web: `DoseLineEditor.tsx` (3 dạng: theo buổi, ml, Khi cần) dùng ở `PrescriptionPanel` (đơn đang kê + hộp Sửa đơn) và `PrescriptionTemplatePane`; `as-needed-instruction.ts` (soạn nhanh câu dặn); `useDrugQuery`.
- Test: `prescription-dose-mode-http.spec.ts` (16 ca, kiểm đột biến), `prescription-dose-mode.spec.ts` (shared), core +2, web +13. Full API: 1839 xanh + 1 ca `drug-import-http` chập chờn do TEST không lọc công ty (đã sửa test, không liên quan #267).

## Việc còn lại
1. Chủ dự án xem lại điểm lệch mockup: phần 1 (5 điểm ở bàn giao 29/10 mục 4) + phần 2 (ô "Khi" dùng gợi ý trình duyệt; hộp Sửa đơn có ô Hướng dẫn dùng; ô liều dòng "Khi cần" khung viền).
2. Gửi câu hỏi **22a** (thuốc "khi cần" không có số ngày) cho đơn vị vận hành cổng đơn thuốc: `docs/product/prescription-interop-questions.md`.
3. Push commit xoá mockup (`399b6f2`) khi chủ dự án yêu cầu. (Phần 2 đã push.)
4. Chưa làm (ngoài phạm vi phần 2): nhãn dán in đơn vị ml ở câu dặn "Theo buổi" đã có; "Sao chép đơn lần trước" mang kiểu kê (đã làm qua `itemToDraft`) nhưng chưa có test giao diện riêng.

## Bẫy
- **Đừng tắt mọi `chrome.exe`** để đóng cửa sổ demo (cuối phiên làm vậy và có thể đã đóng Chrome của chủ dự án): chỉ đóng bằng `browser.close()` của Playwright hoặc kill đúng PID của tiến trình do kịch bản mở.
- Dữ liệu thử `NHAN29*` (thuốc/bệnh nhân/đơn mẫu) ở tenant dev; dọn bằng API, lọc ĐÚNG tiền tố.
- Dev tenant: đã chạy `close-pending` đóng ca 28/10 của dev.admin để khám được (#266).
- Server thử dùng build ra `apps/api/dist-uitest` (đã xoá) + Vite cổng 5180 (đã tắt).
