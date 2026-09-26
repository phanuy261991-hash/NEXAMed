# Handoff — Công nợ nhà cung cấp, Phần E "Đối chiếu & chốt công nợ theo kỳ" ĐÃ HOÀN TẤT 100%

**Ngày ghi**: 26/09/2026. **Trạng thái**: Phần E xong hoàn toàn — thiết kế (EnterPlanMode + Explore + AskUserQuestion) + backend + frontend + test + verify Playwright, tất cả trong cùng phiên này. Xem `docs/DECISIONS.md` #189 để biết chi tiết đầy đủ quyết định + việc đã làm. **Toàn bộ lộ trình "Công nợ nhà cung cấp" (Phần A→E) coi như hoàn tất 100%** — không còn phần nào treo.

## Đã xong trong phiên này

- **Schema**: bảng mới `supplier_debt_reconciliation` ("Biên bản đối chiếu") + cột `supplier_debt_account.locked_as_of_date` — migration `20260926090000_supplier_debt_phase_e` đã áp thật lên Postgres dev.
- **Backend** (`apps/api/src/modules/supplier-debt/`): `supplier-debt-reconciliation.repository.ts` mới, `supplier-debt-lock.guard.ts` mới (`assertSupplierDebtWritable`, mirror `month-lock.guard.ts` #110), mở rộng `supplier-debt.service.ts` (`previewReconciliation`/`createReconciliation`/`finalizeReconciliation`/`finalizeReconciliationCore` private + hook vào `reverseStockEntry()`/`approveAdjustment()`/`rejectAdjustment()`), 4 endpoint mới trên `supplier-debt.controller.ts`. 3 lỗi mới trong `packages/core/src/errors/supplier-debt-errors.ts`. Hàm thuần `packages/core/src/supplier-debt/compute-reconciliation.ts`.
- **Frontend**: tab thứ 6 "Đối chiếu & Chốt kỳ" + banner khoá kỳ trên `SupplierDetailPage.tsx`, `SupplierDebtReconciliationDialog.tsx` mới (xem trước chênh lệch qua API trước khi submit).
- **Bug thật phát hiện lúc verify Playwright**: `useApproveSupplierDebtAdjustmentMutation()` thiếu invalidate cache `supplier-debt-reconciliations` — nút "Chốt" không tự bật lại sau khi Duyệt phiếu điều chỉnh liên kết. Đã sửa.

**Đã xác minh thật**: `packages/core` +5 test (`compute-reconciliation.spec.ts`), `apps/api` `supplier-debt-reconciliation-http.spec.ts` mới 10/10 + sửa 2 assertion hồi quy đúng dự kiến ở `business-code-http.spec.ts` (thêm codeType `SUPPLIER_DEBT_RECONCILIATION`, prefix `BBD`). Toàn bộ suite `apps/api` (60 file, 1006/1017 pass + 11 skip, 1 flake tiền-nhiệm không liên quan ở `icd10-http.spec.ts` — race `role_permission` khi chạy song song nhiều spec, xác nhận pass 11/11 khi chạy riêng), `packages/core` 40 file/237 test pass. `pnpm -w typecheck/lint/build` sạch toàn workspace, build web không cảnh báo chunk size.

**Verify Playwright qua Chrome thật** (headless, executablePath hệ thống) trên tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` — dựng 1 vai trò tuỳ biến sao chép ma trận `clinic_admin` CHỈ bỏ `supplier_debt.unlock` + 1 tài khoản test, **đã dọn sạch sau khi xong** (kể cả 1 vai trò rác phát sinh từ lần thử script đầu bị lỗi request — rà soát phát hiện và ẩn luôn). Đủ 8 bước: lập biên bản khớp → tự Chốt, banner đúng ngày → lập biên bản lệch → sinh đúng Phiếu điều chỉnh Chờ duyệt, màn hướng dẫn đúng → Duyệt phiếu điều chỉnh ở tab "Nhật ký điều chỉnh" → quay lại Chốt được, "Còn nợ" cộng đúng phần điều chỉnh → tài khoản KHÔNG `unlock` bị chặn Huỷ phiếu nhập đã khoá kỳ (thông báo lỗi rõ ràng) → `dev.admin` (CÓ `unlock`) Huỷ phiếu THÀNH CÔNG dù đã khoá kỳ. 0 lỗi console thật liên quan.

## Tài liệu đã cập nhật

`docs/DECISIONS.md` (#189), `docs/CHANGELOG.md` (2026-09-26), `docs/TASK.md`, `docs/CURRENT.md`, tiêu đề `C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md` (đánh dấu Phần A→E đều xong, mục 8 cập nhật Phần E).

## Việc kế tiếp

**Không có việc nào đang treo của "Công nợ nhà cung cấp"** — toàn bộ lộ trình Phần A→E đã xong. Theo `docs/CURRENT.md`, các mảng lớn khác còn chưa bắt đầu/chưa xong trong dự án:

- **Kho Thuốc GĐ5 — "Trải nghiệm kê đơn cho bác sĩ"** — chưa bắt đầu (GĐ1-4 đã xong 100% từ trước).
- **S2-04 (thẻ BHYT)** — vẫn lùi lại theo quyết định cũ, không chặn gì.
- Việc nhỏ chưa sửa (cần hỏi trước theo CLAUDE.md): `barcode` hiện chỉ nhập được cho Thuốc lúc tạo mới, Vật tư y tế chưa nhập được qua form.

Chưa có việc cụ thể nào được chủ dự án giao tiếp theo — phiên sau nên hỏi chủ dự án muốn làm gì kế tiếp (Kho Thuốc GĐ5, hay việc khác) trước khi tự chọn hướng.

## Môi trường lúc kết thúc phiên

- API dev (`localhost:3001`) + Web dev (`localhost:5173`) đang chạy nền.
- `apps/web/public/config.json` vẫn trỏ đúng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (theo quy ước `feedback_fixed_test_tenant`, không đụng tenant chủ dự án).
- Không còn tài khoản/vai trò test tạm nào sót lại chưa dọn. Dữ liệu nghiệp vụ test (NCC/phiếu nhập/biên bản đối chiếu tạo trong lúc verify) giữ nguyên trong DB tenant test, không đụng tồn kho/dữ liệu thật.
