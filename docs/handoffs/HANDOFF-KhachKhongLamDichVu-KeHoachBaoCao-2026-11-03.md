# HANDOFF — "Khách không làm dịch vụ" (#280) + kế hoạch hệ thống báo cáo (#279) — 2026-11-03

> Hội thoại luôn tiếng Việt. Commit/push thẳng `master` (không PR). Trước khi push: `pnpm typecheck` + `pnpm lint` + test liên quan; full API ĐÚNG 1 lượt (tắt dev server trước). Chữ trên giao diện: ngắn, 1 câu, không viết HOA nhấn mạnh (chủ dự án chê 03/11).

## Trạng thái một câu
**#280 đã code xong, test xanh, kiểm Chrome thật qua HTTP LAN, ĐÃ COMMIT `a972613` trên `master` nhưng CHƯA PUSH** (chưa ai yêu cầu push, chưa kiểm CI). **Hệ thống báo cáo (#279) mới ở mức kế hoạch + mockup Tổng quan đã duyệt, CHƯA có dòng code nào.** Máy chủ thử (cổng 3001/5174) đã tắt. Không có việc dở giữa chừng.

## 1. Đã làm trong phiên (chi tiết `docs/DECISIONS.md` #279–#280, `docs/CHANGELOG.md` 2026-11-03)

### 1a. #279 — Mở rộng phạm vi v1: báo cáo doanh thu (chỉ kế hoạch)
- Nghiên cứu báo cáo theo quy mô phòng khám (nhỏ / vừa / nhiều chi nhánh); chủ dự án duyệt mở rộng v1 gồm báo cáo doanh thu. File `docs/product/reporting-plan.md` (mục 1–11: dữ liệu sẵn có, màn "Toàn hệ thống", bài học về kiểu giao diện).
- Đã chốt: cột "Ghi nhận" + "Thực thu" cạnh nhau; sản phẩm đầu tiên = **Dashboard (Trang Tổng quan, 4 vai trò) + báo cáo ngày**; bác sĩ chỉ thấy số của mình, tiền hiện theo công tắc cấu hình; nhóm menu mới "Báo cáo" (báo cáo cũ giữ nguyên); dashboard khác nhau theo vai trò; chỉ làm mới thủ công; dịch vụ đếm theo DÒNG chỉ định; "Chỉ tiêu tháng" để đợt sau; thêm màn **"Toàn hệ thống"** (nhiều chi nhánh, xếp hạng bác sĩ, lãi gộp thuốc, so cùng kỳ).
- Mockup Tổng quan: chủ dự án đã nói "đã xem và duyệt" (xem artifact/canvas ghi ở `docs/DECISIONS.md` #279 và `docs/product/reporting-plan.md`). Bị chê 3 lần về kiểu giao diện trước khi duyệt — bài học: đọc component thật trước khi thiết kế (memory `feedback_read_real_components_before_design`).

### 1b. #280 — "Khách không làm dịch vụ" (đã code + commit)
Mockup: https://claude.ai/artifact/UXDmPzKQoaAzFsqAzguaEf. Chủ dự án chốt: "tôi tuyên bố chốt tất cả mockup, hãy làm đi" (sau lần tôi code sớm khi mới "đồng ý hướng" và bị nhắc — memory `feedback_explicit_mockup_approval`).

| Phần | Nội dung |
|---|---|
| Quyền | `invoice.cancel_service` (hẹp) cấp cho lễ tân + `clinic_admin`; KHÔNG cấp `clinical_order.create` cho lễ tân. |
| Luồng | `GET/POST /billing/invoices/:encounterId/service-decline` (+`/quote`). Phiếu `UNPAID` → gỡ dòng hoá đơn + trừ tiền; phiếu `PAID` → hoàn đúng phần tiền theo phương thức đã thu (ví trước, dư tiền mặt/CK), phiếu vẫn PAID, KHÔNG nhập lại kho. Dòng đã lấy mẫu/thực hiện thì chặn. |
| Dữ liệu | Dòng chỉ định `status='CANCELLED'` + `decline_reason_code/decline_note/declined_at/declined_by` (không xoá, không soft-delete). Migration `20261103090000_service_decline` (enum `SERVICE_DECLINE_REASON` + 4 cột). 5 lý do mặc định nạp qua `db:seed`. |
| Gói dịch vụ | Công tắc `package_decline_mode` (`tenant_setting`, không migration): `BLOCK` (mặc định) / `REPRICE_SINGLE` / `KEEP_PACKAGE_PRICE`. Phiếu ĐÃ THU + `REPRICE_SINGLE` chưa hỗ trợ (dùng "Hoàn tiền"). |
| Bác sĩ | `ClinicalOrderPanel`: dòng nhắc `NoticeRow`, khối "Đã huỷ — khách không làm" (có liên kết "Xem phiếu thu" nếu có quyền `invoice.read`); dòng đã bỏ ra khỏi danh sách soạn và KHÔNG gửi lại khi Lưu (máy chủ cũng bỏ qua lặng lẽ id dòng `CANCELLED` — `frozenIds`). |
| Bệnh án | Khối KHÔNG đánh số "Đã chỉ định nhưng không thực hiện" ở IV.3 và Tổng kết mục 2, cả bản in/PDF lẫn tab trên màn hình (`GET /encounters/:id/medical-record/paraclinical` trả thêm `declined`). Bật/tắt bằng ô tích ở Quản lý mẫu in (`recordBundle.includeDeclined`, thiếu = bật). |
| Cấu hình/Danh mục | Cấu hình thanh toán → khối "Khách không làm dịch vụ" (3 thẻ chọn); Danh mục dùng chung → pill "Lý do không làm dịch vụ". |
| Docs | DECISIONS #279/#280 (có danh sách điểm lệch mockup), CHANGELOG, CURRENT, TASK, ERD v1.90. `DECISIONS.md` được cắt: #253–#268 → `docs/archive/DECISIONS-253-268.md` (gốc còn ~70 KB, nay từ #269; CLAUDE.md đã đổi mốc). |

**Điểm lệch so với mockup (đã báo chủ dự án, ghi ở #280)**: mục bệnh án là khối không đánh số (mẫu MS 15/BV-01 đánh số theo quy định — #270), nút đặt cạnh "Hủy lượt khám" ở dải tiêu đề phiếu thu, lý do để trống mặc định, phiếu đã thu + tính lại giá lẻ chưa hỗ trợ, giá tính lại theo bảng giá HIỆN TẠI.

**Số liệu kiểm (trước commit)**: typecheck + lint sạch; core 637, shared 126, web 529, API 1946 (+1 bỏ qua); đột biến 6/6 bị bắt. Chrome thật qua `http://192.168.3.14:5174` (HTTP, không localhost): nhánh chưa thu (gỡ dòng, tổng giảm đúng, lỗi 503 giữ nguyên hộp thoại + ghi chú), nhánh đã thu (hoàn 100.000 đ tiền mặt, phiếu vẫn PAID), màn khám bác sĩ, cấu hình, danh mục, tab bệnh án + liên kết (7/7), lỗi tải kết quả báo tiếng Việt.

## 2. Việc kế tiếp (theo thứ tự đề nghị)
1. **Push `master` + kiểm CI** — chỉ khi chủ dự án bảo. Kiểm CI: REST `GET /repos/phanuy261991-hash/NEXAMed/actions/runs?head_sha=<SHA 40 ký tự>` (token lấy từ `git credential fill`, không in token).
2. **Hệ thống báo cáo (#279)** — làm theo `docs/product/reporting-plan.md`:
   - **Đợt 0**: hàm "ngày Việt Nam" dùng chung thay 7 chỗ cứng `+07:00`; đầu báo cáo cho Excel/PDF; nhóm menu "Báo cáo".
   - Dashboard 4 vai trò (mockup đã duyệt) → màn "Toàn hệ thống" (xếp hạng bác sĩ, lãi gộp thuốc, so cùng kỳ) → 10 chỉ số còn thiếu ở máy chủ → công tắc cho bác sĩ xem tiền.
   - Trước khi code: ghi phạm vi báo cáo vào `CLAUDE.md`, `docs/product/prd.md`, `docs/product/plan.md` (chưa làm). Trả lời 4 câu hỏi chi nhánh (#231) cho từng báo cáo; dùng lại `ReportBranchScopeService`/`useReportScope`.
   - Quy tắc chủ dự án: mỗi tính năng mới phải xác nhận mockup bằng chữ "duyệt/chốt" rõ ràng mới code; kiểu giao diện lấy từ component thật (`StatCardRow`, `NoticeRow`...), màu nằm trên con số, không "AI look".
3. Tuỳ chọn #280 (chưa ai yêu cầu): cho phép "tính lại theo giá lẻ" ở phiếu ĐÃ THU; tính lại theo giá lúc chỉ định thay vì giá hiện tại; xuất báo cáo "dịch vụ khách không làm" (thống kê lý do) — sẽ khớp với phần báo cáo.
4. **Việc treo cũ** (đầy đủ ở `docs/CURRENT.md`/`docs/TASK.md`): dựng bản demo `0.9.4` (chỉ khi chủ dự án bảo; ghi chú phát hành `release-notes/<số>.json` TRƯỚC khi dựng — memory `feedback_build_delivery_vs_demo`; bản demo hiện hành 0.9.3 chưa có #280); chữ ký điện tử theo Thông tư 13/2025 (làm sau, mốc 31/12/2026); kiểm bộ cài trên Docker/Windows sạch/Linux-NAS thật.

## 3. Bẫy và bài học (đọc trước khi làm)
1. **Áp migration có `ALTER TYPE`**: dùng `pnpm run db:deploy` (role chủ sở hữu, qua `with-migrate-url.mjs`), KHÔNG `prisma migrate deploy` trần. Chạy nhầm sẽ báo "must be owner of type…" và để lại bản ghi migration `failed` (P3009); gỡ bằng `pnpm exec node scripts/with-migrate-url.mjs migrate resolve --rolled-back <tên>` (cần `pnpm exec` để có `prisma` trong PATH) rồi `db:deploy` lại. Xong chạy `pnpm run db:seed` (quyền + danh mục).
2. **KHÔNG chạy `prettier --write` lên file `apps/web` có sẵn** — repo không format theo prettier, diff phình hàng trăm dòng (đã gặp lần này, phải `git checkout` rồi vá lại). Memory `feedback_no_prettier_write_on_existing`. Vá bằng script `.cjs` thay chuỗi thuần (kiểm khớp DUY NHẤT, giữ CRLF) rồi `tsc --noEmit` + `eslint`; xem `git diff --stat` để chắc diff nhỏ.
3. **Chữ giao diện** (chủ dự án chê 03/11): ngắn, không viết HOA nhấn mạnh ("MỘT"), mô tả ≤ 1 câu. Memory `feedback_ui_copy_short_no_caps`. Tự đọc lại mọi chuỗi hiển thị trước khi báo xong.
4. **Đổi mặc định ở `packages/shared` làm vỡ test cũ ở nhiều nơi** (thêm `includeDeclined` vào `DEFAULT_RECORD_BUNDLE_CONFIG`; thêm 5 lý do vào danh mục hệ thống nhẹ): sau khi đổi mặc định/danh mục nạp sẵn, chạy full API + shared để bắt kỳ vọng cũ (print-template-http, seed-tenant-catalogs, shared print-template).
5. **Port đọc tự mở transaction**: `getMedicalRecordParaclinical` gọi `listSignedForEncounters` và `listDeclinedForEncounters` NGOÀI transaction kiểm quyền (#264) — giữ nguyên khi sửa tiếp.
6. **Dữ liệu thử có ngoại lệ ở tenant dev**: để chạy kịch bản tôi (a) đóng ca ngày trước còn treo của `dev.admin` (`POST /doctor-availability/:id/close-pending`), (b) bật tạm rồi tắt lại `deferredPaymentEnabled` (kịch bản tự khôi phục; nên kiểm lại giá trị ở Cấu hình thanh toán nếu thấy lạ). Không dùng role `nexamed` để ghi dữ liệu nghiệp vụ.
7. Shell: heredoc dài/dấu ngoặc dễ vỡ; `sed -i 'a\'` làm gộp dòng và hỏng định dạng — ghi script bằng công cụ **Write** rồi `node file.cjs`. Lệnh chạy lâu chuyển nền (`run_in_background`), không `sleep` chờ.
8. Chrome kiểm bằng `playwright-core@1.49.1`: bản cài sẵn ở thư mục tạm của phiên cũ `C:\Users\Administrator\AppData\Local\Temp\claude\c--Projects-NEXAMed\11ac2ade-23c5-43f6-8aaf-345845f63ea2\scratchpad\pw\node_modules\playwright-core` (có thể bị dọn — cài lại theo `scripts/ui-audit/README.md`). Dựng LAN: API `pnpm run dev` (cổng 3001) + `VITE_DEV_API_PROXY=http://localhost:3001 pnpm exec vite --host 0.0.0.0 --port 5174`; ghi đè `config.json` bằng `page.route` với `apiBaseUrl: ''`. IP LAN máy dev lúc kiểm: `192.168.3.14`.
9. Kịch bản kiểm #280 (dựng bệnh nhân → tiếp nhận → bắt đầu khám → chỉ định → bỏ → hoàn tất lượt khám) nằm ở thư mục scratchpad của phiên (`e2e-decline.cjs`, `e2e-decline-paid.cjs`, `e2e-record-screen.cjs`, tạm thời, KHÔNG trong repo). Muốn dùng lại lâu dài thì đề xuất đưa vào `scripts/ui-audit/` với chủ dự án.

## 4. Môi trường lúc kết thúc phiên
- `master` = `a972613` (chưa push). Working tree sạch sau commit tài liệu bàn giao (`docs(handoff)`).
- Dev server API/Vite ĐÃ TẮT. Docker `nexamed-postgres-1` (cổng 5433) chạy; DB dev đã áp migration `20261103090000_service_decline` + `db:seed`.
- Tenant dev `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin`/`Dev@12345` (vai trò `clinic_admin` + `doctor`). Dữ liệu thử còn lại: nhiều bệnh nhân tên bắt đầu "Kiểm bỏ dịch vụ…", "Kiểm bỏ DV đã thu…", "Kiểm bệnh án bỏ DV…" cùng lượt khám/phiếu của chúng (dễ nhận bằng tiền tố; dọn qua HTTP API/giao diện, KHÔNG SQL role đặc quyền).

## 5. Tệp quan trọng mới/đổi
`packages/shared/src/service-decline.ts`, `packages/core/src/billing/service-decline.ts` (+spec), `apps/api/src/modules/clinical-order/service-decline.{service,controller}.ts` + `service-decline-http.spec.ts` (20 ca), `apps/api/src/modules/billing/invoice-refund.service.ts` (tách `refundServiceLinesInTx`), `apps/api/src/modules/clinical-order/clinical-order.service.ts` (`frozenIds`, gói "chết"), `apps/api/prisma/migrations/20261103090000_service_decline/`, `apps/web/src/features/billing/ServiceDeclineDialog.tsx` + `InvoiceDetailPage.tsx`, `apps/web/src/features/clinical-order/ClinicalOrderPanel.tsx`, `apps/web/src/features/clinic/PaymentConfigPane.tsx`, `apps/web/src/features/medical-record/{MedicalRecordSheet,PatientMedicalRecordTab,medical-record-model}.ts(x)`, `packages/core/src/medical-record/render-patient-medical-record-html.ts`, `docs/product/reporting-plan.md`, `docs/archive/DECISIONS-253-268.md`.
