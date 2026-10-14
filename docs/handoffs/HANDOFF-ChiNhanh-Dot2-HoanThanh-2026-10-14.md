# HANDOFF — Tầng chi nhánh ĐỢT 2 đã HOÀN THÀNH, chờ commit + dựng gói on-prem — 2026-10-14 (phiên sau)

> Hội thoại luôn tiếng Việt. Commit + push **thẳng `master`**, không tạo nhánh/PR. Ảnh chụp kiểm tra để ở thư mục tạm, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test và báo kết quả (kèm bước cô lập tenant/chi nhánh). Phiên này tiếp nối `HANDOFF-ChiNhanh-Dot2-2026-10-14.md` (file đó giờ chỉ là lịch sử).

## 0. Trạng thái một câu

Đợt 2 xong code + test + verify Chrome thật. **84 file đang thay đổi, CHƯA COMMIT** (commit `2fc9c00` cũ là bản wip). Việc còn lại duy nhất của Đợt 2: **commit + push, rồi dựng lại gói on-prem**. KHÔNG bật chi nhánh thứ 2 ở khách thật trước khi xong hai việc đó và chủ dự án duyệt.

## 1. Đã làm xong (tóm tắt, chi tiết ở `docs/DECISIONS.md` #233 mục "Cập nhật 14/10/2026 cuối phiên")

- Migration `20261015090000_branch_dot2` đã áp DB dev; `db:seed` đã chạy; OpenAPI + `openapi-schema.d.ts` đã sinh lại.
- Backend: kho/quỹ/ca thu ngân/hoá đơn/ví/công nợ NCC theo chi nhánh; điều chuyển kho liên chi nhánh (Kiểm nhận, Từ chối nhận cả phiếu, Xử lý chênh lệch, Nhận lại hàng); `GET /warehouses/transfer-destinations`; Q4 công nợ NCC trả `sourceBranchId/Name` + số chứng từ, danh sách thanh toán thấy mọi chi nhánh kèm `branchId/Name`; Q5 giao dịch ví trả `branchId/Name`; `GET /billing/invoices/:encounterId` trả 404 khi lượt khám khác chi nhánh; phiên thêm cờ **`multiBranchCompany`** (login + `/auth/me`); tên chi nhánh tối đa 100 ký tự.
- Báo cáo hao hụt điều chuyển: lọc `fromWarehouseId`/`cause`, trả thêm `transferCount`/`countByCause`, `GET /inventory/transfers/shrinkage-report/export` (Excel, ghi nhật ký bằng nhãn `stock_ledger_report.exported`).
- Web: Danh mục Kho + Quỹ (cột/bộ lọc/ô chi nhánh), Điều chuyển kho (2 tab + chấm số menu + 4 chế độ), hộp thoại Mở ca, nhắc ca khi đổi chi nhánh (`BranchSwitcher`), đầu phiếu in theo chi nhánh (`PrintDocument branchId`, công tắc "Tên chi nhánh"), `BranchChip` + `useIsOtherBranch` (khoá nút mở phiếu chi nhánh khác), tab "Hao hụt điều chuyển" trong trang Báo cáo Nhập-Xuất-Tồn (menu riêng đã bỏ, đường dẫn cũ chuyển hướng `?tab=shrinkage`).
- Tài liệu đã cập nhật: ERD v1.74, `data-model.md`, `multi-tenancy.md`, CHANGELOG, CURRENT, TASK, CLAUDE.md, DECISIONS #233.
- Mockup báo cáo hao hụt (bản 3, đã chốt Q1–Q5): https://claude.ai/artifact/7K3pm5AXitdMRXpF4DUg4p. Mockup Đợt 2 gốc: https://claude.ai/artifact/EPa25ibLtA7jy8t2YG8soU.

## 2. Kết quả test lần cuối (14/10/2026)

API 1409/1409 đạt (chạy cả bộ lần cuối có 1 file `encounter-http.spec.ts` báo "Hook timed out 60s" vì máy đang chạy lint/Chrome song song; chạy riêng 78/78), web 67, core 399, shared 31; lint, typecheck, build sạch (chunk `index` 267 kB, `vendor` 339 kB, dưới trần 500 kB). Verify Chrome thật (Playwright-core, Chrome cài sẵn): vòng đời điều chuyển liên chi nhánh đủ (gửi → nhận thiếu → xử lý → báo cáo), Kho, Quỹ, tab hao hụt + lọc + tải Excel, đầu phiếu theo chi nhánh, công tắc mẫu in.

**Test chập chờn đã biết (không do Đợt 2)**: `invoice-refund-http.spec.ts` "2 request hoàn ĐỒNG THỜI → [200,409]" đôi khi ra `[200,422]` khi chạy cả bộ (409 chỉ khi hai request chồng nhau lúc đọc hoá đơn; đến sau thì 422 "vượt số lượng"); đạt khi chạy riêng. Có thể làm test chấp nhận cả hai mã nếu chủ dự án muốn — chưa sửa.

## 3. VIỆC CÒN LẠI (theo thứ tự)

1. **Commit + push thẳng `master`** (84 file; message tiếng Việt không dấu như các commit cũ, kết bằng dòng Co-Authored-By theo hướng dẫn của phiên). Chạy `git status` trước; file `docs/handoffs/HANDOFF-ChiNhanh-Dot2-2026-10-14.md` đã được sửa đầu file (đánh dấu hoàn thành). Đảm bảo `pnpm -w lint`, `typecheck`, build còn sạch trước khi commit.
2. **Dựng lại gói on-prem** `deploy/on-prem/build-and-export.ps1 -Version <ngày>` — CHẠY QUA BASH: `powershell -NoProfile -ExecutionPolicy Bypass -File ./build-and-export.ps1 -Version X > log 2>&1`, KHÔNG chạy trực tiếp trong PowerShell tool (stderr của Docker bị coi là lỗi, `$PSScriptRoot` rỗng làm ghi nhầm `C:\package`). Gói `2026.10.14` hiện có trong `deploy/on-prem/package/images` là TRƯỚC Đợt 2 (cũng thiếu #220–#232). Cần 1 migration `db:deploy` + `db:seed` khi nâng cấp.
3. Chờ chủ dự án duyệt trước khi bật chi nhánh thứ 2 ở khách thật.

## 4. Việc đã chốt nhưng làm SAU

- **Tab "Kết quả cận lâm sàng" + biểu đồ diễn biến chỉ số ở hồ sơ bệnh nhân** (chốt 14/10/2026) — cần mockup duyệt trước khi code (memory `project_cls_results_tab_queued`).
- **Đợt 3 báo cáo nhiều chi nhánh**: truy vấn sổ quỹ/dòng tiền/N-X-T đã nhận DANH SÁCH chi nhánh sẵn, chỉ thêm bộ chọn "Tất cả chi nhánh của tôi". Câu hỏi chưa chốt: xem tổng sổ quỹ/dòng tiền cả công ty.
- Đợt 4 SaaS; CSP chuyển từ Report-Only sang chặn khi pilot sạch cảnh báo Console.
- Có thể hỏi chủ dự án: (a) migration bù kho/quỹ cho chi nhánh tạo từ Đợt 1 (hiện phải thêm tay — xem mục 5); (b) làm test hoàn tiền đồng thời chấp nhận cả 409/422; (c) 3 điểm lệch nhỏ so với mockup Đợt 2 (ô "Số kiện" ở Từ chối nhận, nhắc quá hạn xử lý 7 ngày, huy hiệu "Cận hạn" ở Kiểm nhận) — ghi ở DECISIONS #233 mục (6).

## 5. Điều cần biết / bẫy

- **Chi nhánh tạo từ Đợt 1 chưa có kho/quỹ** ("Chi nhánh 2", "ZZTEST Chi nhánh 3" trên tenant test `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` — "Chi nhánh 2" là dữ liệu của chủ dự án, ĐỪNG sửa). Chỉ chi nhánh tạo MỚI từ Đợt 2 tự có 1 kho + 1 quỹ tiền mặt (`provisionBranchDefaults`). Thêm tay ở Danh mục Kho/Quỹ nếu cần.
- **`multiBranchCompany` vs `branches.length`**: `hasMultipleBranches(user)` (số chi nhánh tài khoản được gán) chỉ dành cho bộ chuyển/chọn chi nhánh; mọi nhãn/cột/tab chi nhánh trên chứng từ dùng `showBranchInfo(user)`. Nhân viên gán 1 chi nhánh trong công ty nhiều chi nhánh vẫn phải thấy phiếu đến. `useIsOtherBranch` KHÔNG phụ thuộc "nhiều chi nhánh" (chỉ so id).
- **Chứng từ kế thừa chi nhánh qua kho/quỹ/lượt khám** nên đầu phiếu in mặc định (không truyền `branchId`) đã đúng chi nhánh đang làm; chỉ phiếu điều chuyển truyền chi nhánh GỬI. Đừng thêm `branchId` vào DTO phiếu nhập/xuất/kiểm kê/hoá đơn.
- Quyền mới? Không có — mọi bước điều chuyển dùng `stock_transfer.approve`, báo cáo hao hụt dùng `stock_receipt.report`. Nhật ký xuất Excel hao hụt dùng lại nhãn `stock_ledger_report.exported` (không thêm nhãn mới, test `audit-labels-coverage` vẫn đạt).
- Công cụ: file nguồn lẫn **CRLF/LF** (Edit tool giữ nguyên EOL từng file; script patch của tôi chuẩn hoá rồi ghi lại đúng EOL gốc). `node -e` và heredoc bash có backtick/`\n` dễ hỏng im lặng → viết script bằng công cụ Write rồi chạy file `.cjs`. `prisma generate` lỗi EPERM khi API dev đang chạy. Chạy test API ~6 phút (`cd apps/api && pnpm exec vitest run`); đừng chạy lint/Chrome song song (gây "Hook timed out").
- Khởi động API dev: `pnpm --filter @nexamed/api build` rồi `cd apps/api && node dist/main.js` (cổng 3001; web dev 5173 đang chạy sẵn). API dev hiện ĐÃ DỪNG (phiên này khởi động rồi tắt).
- Verify Chrome: `playwright-core` cài ở thư mục tạm, dùng `C:/Program Files/Google/Chrome/Application/chrome.exe`; đăng nhập `dev.admin` / `Dev@12345`, tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f` (config.json giữ nguyên). Kịch bản đã dùng nằm ở scratchpad của phiên trước (có thể đã mất; viết lại nếu cần). Chữ trong ô `Combobox` và nhãn `StatCard` (chữ hoa bằng CSS) không nằm trong `innerText` như mong đợi — kiểm bằng ảnh chụp.
- **Dữ liệu thử đã tạo trên tenant test** (tiền tố `ZZE2E`): chi nhánh `CN00004`, tài khoản `zze2e.recv`, thuốc `ZZE2E-…` — cả ba ĐÃ NGƯNG. Còn lại (sổ kho append-only, không xoá được): phiếu nhập mở đầu + 1 phiếu điều chuyển `PDC2610000001` (30 xuất, nhận 25, ghi hao hụt 5) ở kho chính chi nhánh mặc định, hiện trong tab Hao hụt điều chuyển. Dọn bằng cách lọc đúng tiền tố, in danh sách khớp TRƯỚC khi sửa (`GET /users` có phân trang, bỏ qua `q`).
- Quy tắc giao diện nhắc lại: bảng có dòng tiêu đề + dòng dữ liệu dùng chung `gridTemplateColumns` thì **cả hai phải cùng `gap-x-*`** (lỗi lệch cột phát hiện ở báo cáo hao hụt); ô tổng hợp dùng `StatCardRow` (dải phẳng chia vạch), KHÔNG dùng thẻ viền bo + thanh màu bên trái; chữ semibold không bold; nút dùng `Button`/`RowActionButton`.
