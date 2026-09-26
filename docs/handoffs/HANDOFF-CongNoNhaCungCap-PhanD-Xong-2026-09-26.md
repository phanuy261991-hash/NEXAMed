# Handoff — Công nợ nhà cung cấp, Phần D "Luồng xử lý sai sót" ĐÃ HOÀN TẤT 100%

**Ngày ghi**: 26/09/2026. **Trạng thái**: Phần D xong hoàn toàn — backend (phiên trước) + frontend + verify Playwright (phiên này). Xem `docs/DECISIONS.md` #187 (backend) và #188 (frontend + verify) để biết chi tiết đầy đủ quyết định + việc đã làm.

## Đã xong trong phiên này (frontend + verify Playwright)

- `apps/web/src/features/supplier-debt/`: `SupplierDebtAdjustmentDialog.tsx` (Lập phiếu điều chỉnh Tăng/Giảm), `SupplierDebtAdjustmentDetailDialog.tsx` (xem + Duyệt/Từ chối, dùng chung cho tab lẫn badge), `SupplierDebtAdjustmentBadge.tsx` ("Có điều chỉnh (N)").
- `SupplierDetailPage.tsx`: thêm tab thứ 5 "Nhật ký điều chỉnh" + nút "Lập phiếu điều chỉnh công nợ" (gate `supplier_debt.adjust`) + banner đỏ khi `balanceIntegrityOk===false` (disable nút Thanh toán/Thu tiền hoàn lại) + banner amber `pendingAdjustmentCount>0`.
- **"Đề nghị huỷ" (VOID_REQUEST) tái dùng thẳng `ReasonConfirmDialog` có sẵn** (không dựng dialog mới — schema chỉ cần `reason`), thêm vào `StockReceiptListPage.tsx`/`StockIssueListPage.tsx` — **lưu ý quan trọng**: nút "Huỷ phiếu" thật nằm ở đây (List Page), KHÔNG nằm ở Form Page như handoff phiên trước ghi nhầm — đã đối chiếu code thật trước khi đặt "Đề nghị huỷ" đúng vị trí song song.
- "Sao chép thành phiếu mới" ở `StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx` khi phiếu đã huỷ — `navigate(..., {state:{copyFromReceipt/copyFromIssue}})`, trang "Tạo phiếu" đọc `location.state` lúc mount, để trống Lô/Hạn dùng bắt chọn lại.
- `Sidebar.tsx`: badge "Công nợ nhà cung cấp" gộp thêm `pendingAdjustmentCount>0`.

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, `apps/web` 5/5 test, không cảnh báo chunk size. Verify Playwright qua Chrome thật (headless, `executablePath` hệ thống) trên tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` — dựng 1 vai trò tuỳ biến hạn chế (`supplier_debt.adjust`+`stock_receipt.read`+`stock_issue.read`, KHÔNG `stock_receipt.approve`/`stock_issue.create`) + 1 tài khoản test để đúng kịch bản "Đề nghị huỷ" — **đã dọn sạch sau khi xong** (tài khoản `test.adjustonly` chuyển vai trò `receptionist` + vô hiệu hoá, vai trò tuỳ biến đã ẩn). Đủ 6 bước từ lập/Duyệt điều chỉnh Tăng nợ (badge "Tự duyệt" đúng) → badge "Có điều chỉnh" → Đề nghị huỷ (tài khoản hạn chế) → Duyệt (đúng KHÔNG hiện "Tự duyệt" vì người duyệt ≠ người đề nghị) → phiếu tự huỷ → "Sao chép thành phiếu mới" mồi đúng dữ liệu → đối chiếu API `GET /supplier-debt/summaries` xác nhận `totalPurchase`/`pendingAdjustmentCount`/`balanceIntegrityOk` đúng. 0 lỗi console liên quan tới code mới.

## Tài liệu đã cập nhật

`docs/DECISIONS.md` (#188), `docs/CHANGELOG.md` (2026-09-26), `docs/TASK.md`, `docs/CURRENT.md` — đều đã phản ánh Phần D hoàn tất 100%.

## Việc kế tiếp — Phần E "Đối chiếu & chốt công nợ theo kỳ"

**Chưa có mockup, chưa bắt đầu.** Đúng khuôn "Khoá bảng ca" (`docs/DECISIONS.md` #110) theo mô tả gốc ở `CLAUDE.md`. Việc đầu tiên khi vào phiên mới: dùng `EnterPlanMode` + khảo sát (Explore agent) module `supplier-debt` hiện có + tham khảo cơ chế khoá tháng của `work_shift_assignment` (#110) để đề xuất thiết kế, rồi dựng mockup Artifact trước khi hỏi `AskUserQuestion` chốt phạm vi — chưa có đặc tả sẵn nào để code thẳng, khác Phần A-D đã có kế hoạch kỹ thuật viết sẵn từ trước.

## Môi trường lúc kết thúc phiên

- API dev (`localhost:3001`) + Web dev (`localhost:5173`) đang chạy nền (khởi động lại trong phiên này sau khi máy có vẻ đã restart — container Postgres `nexamed-postgres-1` vẫn còn dữ liệu, không mất gì).
- `apps/web/public/config.json` vẫn trỏ đúng tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (theo quy ước `feedback_fixed_test_tenant`, không đụng tenant chủ dự án).
- Không còn tài khoản/vai trò test tạm nào sót lại chưa dọn.
