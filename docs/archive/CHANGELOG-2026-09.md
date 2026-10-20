# Changelog — NEXAMed — lưu trữ tháng 09/2026

> Phần cũ, đã chuyển nguyên văn từ `docs/CHANGELOG.md` ngày 20/10/2026 để file gốc không phình quá lớn. **Không đọc file này trừ khi cần tra một mục cụ thể** (dùng grep theo số/ngày). Phiên bản mới nhất: `docs/CHANGELOG.md`.

---

## 2026-09-30

### Tinh chỉnh giao diện: dialog hoàn tiền thuốc dạng bảng, "Đổi bác sĩ" rộng + chọn Khoa bằng thẻ, ô Chẩn đoán ICD-10 nổi bật

Dialog "Hoàn tiền thuốc" thiết kế lại dạng bảng, "Nhập lại kho" mặc định bật. Dialog "Đổi bác sĩ phụ trách" nới rộng, chọn Khoa bằng thẻ hiện sẵn thay dropdown bị khung cuộn cắt mất. Ô "Chẩn đoán bệnh (ICD-10)" ở màn khám nổi bật bằng màu (khung xanh nhạt + vạch trái, ô tìm cỡ thường, dải hổ phách khi chưa chọn). Thuần web, không đổi API. Quy tắc chung ở `.claude/docs/ui-guidelines.md` mục 12. Chi tiết `docs/DECISIONS.md` #205.


### Xử lý các điểm hở còn lại của Hoàn tiền một phần

"Phiếu trong ca của tôi" nay dựng từ chính dòng thu/hoàn tiền của ca (endpoint mới `GET /cashier-shifts/:id/invoice-payments`) nên hiện đủ hoàn tiền một phần, hoàn khác ngày, đúng giờ hoàn. Phiếu nhập hoàn trả lập tay có chọn phiếu xuất gốc không còn nhập vượt số đã xuất (422, thông báo nêu số còn nhập lại được). Popup "Mở ca" khi hoàn tiền mặt lúc chưa có ca đã verify UI. Tổng kết ngày ở Thu ngân giữ nguyên cách tính theo ngày tiếp nhận (chủ dự án chọn). **Đã xác minh thật**: cashier-shift 47/47, thêm test cận trên nhập hoàn trả, Chrome thật. Chi tiết `docs/DECISIONS.md` #204.

### "Hoàn tiền thuốc" — hoàn MỘT PHẦN theo từng dòng thuốc (khách trả thuốc, lượt khám vẫn bình thường)

Trước đây hoàn tiền chỉ TOÀN PHẦN và chỉ khi lượt khám đã huỷ. Nay lễ tân/quản trị (quyền riêng `invoice.refund_drug`) bấm "Hoàn tiền thuốc" ở Chi tiết thanh toán, chọn dòng thuốc + số lượng; số tiền hoàn server tự tính (đúng phần tiền thật sau chiết khấu, hoàn hết đúng từng đồng), hoàn về ví tạm ứng trước rồi mới tiền mặt/CK. Mỗi dòng tuỳ chọn "Nhập lại kho" → tự sinh phiếu nhập `RETURN_FROM_USE`. Hoá đơn vẫn "Đã thu" sau mỗi lần hoàn, đủ toàn bộ thì "Đã hoàn tiền"; đã hoàn thì không "Đánh dấu chưa thu" được. Danh sách Thu ngân, bản in lẻ và in gộp đều hiện phần đã hoàn. Migration `20260930100000_invoice_partial_refund` (2 bảng `invoice_refund`/`invoice_refund_line` + `payment.refund_id`). **Đã xác minh thật**: 16 test HTTP mới (đã kiểm đột biến), suite billing cũ không hồi quy, Chrome thật. Chi tiết `docs/DECISIONS.md` #203.

### Sửa lỗi: hoá đơn thuốc riêng không thu được tiền — mọi thao tác ghi hoá đơn nhận `invoiceId`

Hoá đơn tiền thuốc tách riêng (Kho Thuốc GĐ3) xem được nhưng nút "Thu tiền & In phiếu" ở trang của nó lại thao tác trên hoá đơn KHÁM: báo "đã thu" khi hoá đơn khám đã thu, và tệ hơn là đánh dấu nhầm hoá đơn khám khi hai hoá đơn trùng `version`. Thu tiền, trừ ví, nạp-và-trừ ví, lưu tạm, đánh dấu chưa thu, hoàn tiền, chiết khấu, in nay đều nhận `invoiceId` tuỳ chọn (bỏ trống = hoá đơn khám như cũ, không đổi luồng đang chạy); sai/khác lượt khám/khác tenant → 404. Nút "In gộp N phiếu" đổi sang nền xanh đặc. Không migration/permission mới. **Đã xác minh thật**: `billing-http.spec.ts` 68/68 (+11, đã kiểm đột biến), 293/293 trên 6 suite liên quan, typecheck/lint/build sạch, Chrome thật. Chi tiết `docs/DECISIONS.md` #202.

### "Phiếu thu tổng hợp" — in gộp mọi phiếu thu của cùng lượt khám thành 1 tờ

Khách vừa trả tiền khám vừa mua thuốc trước đây nhận 2 (hoặc N) tờ "Phiếu thu" tách rời (mỗi Phiếu xuất kho sinh 1 hoá đơn DRUG riêng, #163/#165). Thêm nút "In gộp N phiếu" trên trang Chi tiết thanh toán (chỉ hiện khi lượt khám có ≥2 phiếu chưa huỷ) — bản in gộp 1 tờ, mỗi hoá đơn là 1 nhóm dòng giữ nguyên số phiếu + trạng thái (ĐÃ THU/CHƯA THU/ĐÃ HOÀN TIỀN, phân biệt được cả khi in đen trắng), cuối tờ có Tổng cộng/Chiết khấu/Tổng đã thu/Còn phải thu. Không sinh bản ghi hoá đơn mới, tiêu đề vẫn là "PHIẾU THU" (không phải hoá đơn GTGT). Phiếu huỷ bị loại; phiếu hoàn tiền vẫn in kèm dòng trừ; bấm in đánh dấu `printedAt` + audit `invoice.printed` (`combined:true`) cho MỌI phiếu trong bản in. Không migration/permission mới (dùng `invoice.print`).

**Đã xác minh thật**: `packages/core` `combined-invoice-totals.spec.ts` 5/5, `apps/api` `billing-http.spec.ts` 57/57 (+7 test HTTP: gộp/thứ tự/loại huỷ/tổng/chiết khấu/hoàn tiền/idempotent/401/404/cách ly tenant), `pnpm -w typecheck/lint/build` sạch. **Đã verify Chrome thật** (tenant test cố định, dữ liệu dựng qua HTTP API): nút hiện đúng ở cả trang phiếu khám lẫn phiếu thuốc, ẩn khi lượt khám chỉ có 1 phiếu; bản in gộp đúng số liệu (phiếu khám đã thu có chiết khấu 10% + phiếu thuốc chưa thu gồm 2 Phiếu xuất → Tổng cộng 458.900, Chiết khấu -35.000, Tổng đã thu 315.000, Còn phải thu 108.900); sau `afterprint` tự về bản in lẻ; nhãn "CHƯA THU" có `print-color-adjust: exact`; 0 lỗi console. Chưa xem được file PDF thật (thiếu poppler). Chi tiết `docs/DECISIONS.md` #201.

## 2026-09-29 (4)

### Gợi ý mã ICD-10 từ ô "Chẩn đoán" (bật/tắt được) + "Học từ lịch sử chọn mã"

Bác sĩ gõ chẩn đoán tự do → hệ thống tách từng cụm bệnh, mở rộng viết tắt (THA, ĐTĐ, SXH...), gợi ý tối đa 3 mã ICD-10/cụm ngay trong khối "Chẩn đoán bệnh (ICD-10)" (từ danh mục BYT, ưu tiên mã bác sĩ hay dùng, ẩn mã sai giới tính); bác sĩ bấm từng mã mới thêm, hệ thống không tự gán. 2 công tắc cấp phòng khám ở "Cấu hình khám", **mặc định TẮT** (pilot không đổi). Công tắc "Học từ lịch sử chọn mã" ghi cặp cụm từ↔mã lúc "Hoàn tất khám" để lần sau xếp mã đó lên đầu. Migration `20260929130000_icd10_suggestion` (bảng `icd10_phrase_usage` + partial index `diagnosis`). Khảo sát trước: ô tìm cũ trả kết quả sai với "ĐTĐ type 2"/"viêm dạ dày"/"đau bụng"/"THA".

**Đã xác minh thật**: `packages/core` 249/249, `apps/api` 1065/1065 (+20 HTTP mới trên danh mục ICD thật), typecheck/lint sạch, Playwright qua Chrome thật (gợi ý, bàn phím, giới tính, học, 2 công tắc). Chi tiết `docs/DECISIONS.md` #200.

## 2026-09-29 (3)

### Verify Playwright #195/#196 hoàn tất + giảm độ đậm tên thuốc toàn app + thêm ô "Mã gõ tắt" vào form Thuốc & Vật tư

Verify Playwright cho "Phiếu xuất gốc" (#195) và Redesign Kê đơn/"Đơn thuốc mẫu"/"Sao chép đơn lần trước" (#196) — cả 5 mục checklist PASS đúng thiết kế. Chuỗi phản hồi trực tiếp phát sinh thêm: ô tìm thuốc ở Kê đơn dời lên đầu trang + style nổi bật (bỏ sót từ #194); popup "Đơn mẫu" redesign 2 vòng (lưới 2 cột, `ModalHeader` dùng chung, card bấm được); giảm `font-bold`→`font-medium` cho tên thuốc/vật tư ở TOÀN BỘ danh sách dòng hàng (4 trang Kho Thuốc, Kê đơn, Đơn thuốc mẫu, Phát thuốc — cả dropdown tìm kiếm lẫn dòng đã thêm vào phiếu). Phát hiện + vá lỗ hổng thật: form "Thêm/Sửa" ở "Thuốc & Vật tư" chưa từng có ô nhập "Mã gõ tắt" dù backend đã hỗ trợ đầy đủ từ Kho Thuốc GĐ5 — thêm ô nhập tự do, áp dụng cho cả Thuốc lẫn Vật tư y tế.

**Đã xác minh thật**: `pnpm --filter @nexamed/web run typecheck` sạch qua mọi lần sửa (thuần `apps/web`, không đổi schema/API). Playwright qua Chrome thật xác nhận toàn bộ, gồm luồng đặt gõ tắt "ptm" cho 1 Vật tư y tế → tìm đúng ở Kê đơn. Chi tiết đầy đủ `docs/DECISIONS.md` #197/#198.

### "Xem tất cả" cho Thẻ kho/Lịch sử giao dịch khi vượt 10 dòng

Panel chi tiết thuốc (520px) chỉ hiện 10 dòng gần nhất, thêm nút "Xem tất cả N giao dịch" mở dialog riêng hiển thị đầy đủ khi dữ liệu nhiều hơn — đúng #159 nay đã lỗi thời khi dữ liệu tăng. Không đổi backend (param `limit` đã có sẵn). Đã xác minh qua Chrome thật trên mặt hàng có 11 giao dịch, cả tab "Thẻ kho" lẫn "Lịch sử giao dịch". Chi tiết `docs/DECISIONS.md` #199.

## 2026-09-29 (2)

### Redesign Kê đơn (liều theo buổi Sáng/Trưa/Chiều/Tối) + "Đơn thuốc mẫu" (trang riêng Quản trị) + "Sao chép đơn thuốc lần khám trước"

3 việc chủ dự án yêu cầu, chốt qua `AskUserQuestion` + mockup Artifact đã duyệt trước khi code (`https://claude.ai/artifact/EnT8CJiQiyeJbzN35p4KZs`). Migration `20260929110000_prescription_dose_periods` thay hẳn 2 cột tự do `dose`/`frequency` bằng 4 cột `dose_morning`/`dose_noon`/`dose_afternoon`/`dose_evening` cho cả `prescription_item` lẫn `prescription_template_item` — dữ liệu cũ của đơn đã ký được gộp vào `instruction` trước khi xoá cột, không mất nội dung. `quantity` từ nay luôn do backend tính (tổng 4 buổi × số ngày), đơn vị luôn là đơn vị nhỏ nhất của thuốc (resolve qua JOIN, không snapshot cột riêng). Thêm endpoint `GET /encounters/:id/prescription/previous` ("Sao chép đơn lần trước") và trang mới "Đơn thuốc mẫu" (`/admin/prescription-templates`) quản lý đầy đủ (xem/sửa/ẩn/kích hoạt lại) ngoài lúc kê đơn.

**Đã xác minh thật**: `packages/shared`/`packages/core` pass đủ, `apps/api` toàn bộ suite 1029/1029 pass (2 flake đã biết, không liên quan), `pnpm -w typecheck/lint/build` sạch. **Chưa verify Playwright**. Chi tiết đầy đủ `docs/DECISIONS.md` #196, việc kế tiếp xem `docs/handoffs/HANDOFF-KeDonRedesign-DonThuocMau-2026-09-29.md`.

## 2026-09-29

### "Phiếu xuất gốc" TUỲ CHỌN cho "Nhập hoàn trả từ bệnh nhân/khoa phòng"

Chủ dự án hỏi kiểm tra: phiếu `RETURN_FROM_USE` không bắt chọn phiếu xuất/đơn thuốc gốc — xác nhận đúng, chốt giữ KHÔNG BẮT BUỘC (sợ không tìm ra phiếu gốc thì không trả được hàng). Thêm liên kết TUỲ CHỌN tới `stock_issue` (bao gồm cả `RETAIL_SALE` gắn đơn thuốc lẫn `INTERNAL_ALLOCATION` gắn Khoa/Phòng) để có dấu vết truy nguyên khi người dùng tìm thấy, không chặn lập phiếu khi không chọn. Migration `20260929100000_stock_receipt_return_from_use_source_issue` (`stock_receipt.source_issue_id`, FK composite → `stock_issue`). Web: Combobox "Phiếu xuất gốc (tuỳ chọn)" trong `StockReceiptHeaderDialog.tsx`.

**Đã xác minh thật**: `inventory-http.spec.ts` +5 test (33/33 pass), `pnpm -w typecheck/lint/build` sạch. Chi tiết đầy đủ `docs/DECISIONS.md` #195.

## 2026-09-28 (4)

### Redesign "Tạo/Sửa phiếu nhập kho" + "Phiếu xuất kho" — popup nhập header + bố cục 2 cột, đồng bộ ô tìm thuốc 4 màn hình Kho Thuốc

Chuỗi phản hồi trực tiếp trên bản chạy thật: header (Loại phiếu/Kho/NCC/Ngày.../Lý do) chuyển từ khối ô nhập cố định sang **popup** (`StockReceiptHeaderDialog.tsx`/`StockIssueHeaderDialog.tsx`, mới) — mở tự động lúc tạo phiếu, trang chính chỉ còn dải tóm tắt (`SummaryField`, trích xuất dùng chung) + nút "Sửa". `StockReceiptFormPage.tsx` đổi sang bố cục 2 cột cố định khi `receiptType='PURCHASE'`: trái là ô tìm (style nổi bật, viền xanh) + bảng sản phẩm, phải (380px) là Chiết khấu + Thanh toán luôn hiện.

**3 bug thật phát hiện + sửa trong lúc dựng bố cục mới** (đều chỉ lộ khi kiểm qua trình duyệt thật): tên sản phẩm bị cắt do cột co giãn thiếu sàn tối thiểu (sửa `minmax(180px, 1.8fr)`); cả trang bị lệch/cuộn sai cấp do CSS Grid `1fr` mặc định không co dưới nội dung tối thiểu (sửa `minmax(0,1fr)` — kinh điển "min-width:auto gotcha"); ô "Giá trị" chiết khấu (Số tiền) thiếu style do `MoneyInput` thiếu `className` (bug cũ có sẵn, không phải do redesign).

Đồng bộ ô tìm thuốc "nổi bật" (nhãn đậm + viền xanh) cho cả 4 trang Kho Thuốc (Nhập/Xuất/Kiểm kê/Điều chuyển). Sửa thêm 1 bug ở component dùng chung `Combobox.tsx`: option nhãn dài tràn đè dòng kế bên do chiều cao cố định `h-9` → đổi `min-h-9`, tự áp dụng toàn app. Nhân tiện đầu phiên: pill "Loại thu chi" ở `CatalogAdminPage.tsx` thiếu nhánh render (bấm không hiện gì) — thêm đúng 1 dòng thiếu.

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, không có test tự động mới (thuần frontend, không đụng API/DB) — xác minh qua Playwright/Chrome thật nhiều vòng ở 1600px/1920px, 0 lỗi console. Chi tiết đầy đủ `docs/DECISIONS.md` #194.

## 2026-09-28 (3)

### "Kê thuốc tự do, không qua danh mục" — mở rộng Kho Thuốc GĐ5 + 3 lỗi giao diện "dính chữ" phát hiện qua phản hồi trực tiếp

Bác sĩ giờ kê được thuốc **hoàn toàn không có trong danh mục** (đảo ngược 1 điểm của #190) khi phòng khám bật công tắc "Cho phép kê thuốc ngoài danh mục" (Cấu hình chung, mặc định TẮT) — dòng tự do không tính tiền/tồn kho, không phát được qua "Phát thuốc" (hiện đọc-only kèm ghi chú), in đơn y hệt dòng khác. Migration `prescription_item.drug_id` nullable + `free_text_drug_name`. Chi tiết đầy đủ `docs/DECISIONS.md` #192.

Nhân tiện sửa 3 lỗi giao diện "dính chữ" (cột cố định thiếu `truncate`/`min-w-0`) ở "Phiếu thu/chi", "Tồn kho", "Báo cáo Nhập-Xuất-Tồn" — và đồng bộ lại nhãn "Vật tư y tế" (trước lệch nhau giữa 2 màn hình) qua component `DrugItemTypeBadge` dùng chung mới. Chi tiết `docs/DECISIONS.md` #193.

**Đã xác minh thật**: `apps/api` 1021/1022 (1 flake đã biết), `packages/core` 232/232, `packages/shared` 25/25, `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch toàn workspace. Playwright qua Chrome thật cho cả tính năng mới lẫn 2 màn hình đã sửa giao diện.

## 2026-09-28 (2)

### Kho Thuốc GĐ5 — Verify Playwright hoàn tất, 3 bug thật phát hiện + sửa

Tiếp nối việc treo duy nhất từ phiên trước — cảnh báo/badge tồn kho + trải nghiệm kê đơn giờ đã xác nhận đúng qua trình duyệt thật, không chỉ test HTTP.

**3 bug thật** (đều chỉ lộ ra khi thao tác qua UI, không lộ ở test HTTP của phiên trước): (1) cảnh báo "Kê vượt tồn kho" biến mất ngay sau khi trang tự refetch lại `GET .../consultation` — route này chưa từng tính lại cảnh báo tồn kho (luôn truyền `onHandByDrugId=null`), khiến bác sĩ không bao giờ thấy được cảnh báo trong thực tế dù dữ liệu đúng ở response lưu; (2) badge tồn kho ẩn hẳn cho thuốc chưa từng nhập kho (khác thuốc đã bán hết) — `sumOnHandByDrugIds()` không điền `0` cho thuốc chưa có dòng `stock_balance`; (3) bấm "Ký đơn" khi bị chặn (422, "Chặn kê vượt tồn" đang bật) không hiện thông báo gì — `signMutation` chưa từng có `onError`.

**Đã xác minh thật**: `apps/api` 1017/1018 (+2 test hồi quy mới, 1 flake đã biết pass riêng), `packages/core` 232/232, `packages/shared` 25/25, `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch toàn workspace. Playwright qua Chrome thật xác nhận đủ 9 mục checklist. Chi tiết đầy đủ `docs/DECISIONS.md` #191. **Kho Thuốc GĐ5 + redesign màn khám coi như hoàn tất 100%.**

## 2026-09-28

### Kho Thuốc GĐ5 "Trải nghiệm kê đơn" + redesign màn khám sang Tab thật — backend+frontend xong, CHƯA verify Playwright

Gộp 3 việc: Kho Thuốc GĐ5 (PRD INV-05 — tìm không dấu, gõ tắt, đơn mẫu, điều hướng bàn phím, cảnh báo/chặn kê vượt tồn), redesign UX màn khám (tab-cuộn cũ → Phương án 1 "Tab thật", chốt qua mockup Artifact so sánh 2 phương án), và phát hiện "Mã đơn thuốc thật" hoá ra đã xong từ #169 (chỉ cần hiện thêm ở tab Kê đơn).

Backend: migration `20260926100000_prescription_ge5` (`drug.shortcut_code`/`drug.search_key` + 2 bảng `prescription_template`/`prescription_template_item`), port mới `StockAvailabilityPort` (giải quyết xung đột `EncounterModule` không được import `InventoryModule`, chốt từ #165), 2 công tắc clinic-settings mới (`pharmacyStockTrackingEnabled` mặc định BẬT, `prescriptionStockBlockEnabled` mặc định TẮT), endpoint `GET /inventory/balances/on-hand-summary`, module `prescription-template` CRUD.

Frontend: `EncounterConsultationPage.tsx` bỏ hẳn scroll-spy sang tab thật (chỉ còn 2 tab, ẩn 2 tab "Sắp ra mắt"), `DrugPicker.tsx` thêm điều hướng bàn phím + badge gõ tắt/tồn kho, `PrescriptionPanel.tsx` thêm khối thông tin đơn thuốc + "Đơn mẫu" + cột tồn kho, `PaymentConfigPane.tsx` thêm 2 công tắc mới.

**Đã xác minh thật**: `apps/api` 1016/1017 (1 flake tiền-nhiệm đã biết), `pnpm -w typecheck/lint/build` sạch toàn workspace. Test HTTP mới: `drug-http.spec.ts`, `prescription-http.spec.ts`, `prescription-template-http.spec.ts` (6/6). Chi tiết đầy đủ `docs/DECISIONS.md` #190. **Còn treo: CHƯA verify Playwright** (phiên bị ngắt giữa chừng lúc cài lại trình duyệt) — xem `docs/handoffs/HANDOFF-KhoThuoc-GD5-RedesignManKham-2026-09-28.md`.

## 2026-09-26

### Công nợ nhà cung cấp, Phần E "Đối chiếu & chốt công nợ theo kỳ" — HOÀN TẤT 100%, toàn bộ lộ trình Công nợ NCC (Phần A→E) xong

Phần cuối cùng của "Công nợ nhà cung cấp" — chưa có kế hoạch kỹ thuật sẵn (khác Phần A-D), dùng `EnterPlanMode` + 2 agent Explore + `AskUserQuestion` (2 câu: gộp 1 bước lập biên bản; biên bản có phiếu điều chỉnh bị Từ chối tự "Đã huỷ") chốt thiết kế trước khi code. Bảng mới `supplier_debt_reconciliation` ("Biên bản đối chiếu" 1 NCC tại 1 ngày, migration `20260926090000_supplier_debt_phase_e`) + `supplier_debt_account.locked_as_of_date`. Lập biên bản khớp → tự Chốt ngay; lệch → tự sinh Phiếu điều chỉnh Chờ duyệt, Chốt riêng sau khi Duyệt xong (Từ chối → biên bản tự "Đã huỷ"). Sau khi Chốt, chứng từ NCC đó có ngày ≤ ngày chốt chỉ Huỷ/Điều chỉnh được bởi actor có `supplier_debt.unlock` (permission đã seed sẵn từ Phần A, nay mới dùng tới — không cần quyền mới). Web: tab thứ 6 "Đối chiếu & Chốt kỳ" trên `SupplierDetailPage.tsx` + banner khoá kỳ + `SupplierDebtReconciliationDialog.tsx` mới (xem trước chênh lệch trước khi submit).

**Bug thật phát hiện lúc verify Playwright**: Duyệt phiếu điều chỉnh tự sinh từ biên bản xong, nút "Chốt" vẫn bị khoá do thiếu invalidate cache `supplier-debt-reconciliations` ở `useApproveSupplierDebtAdjustmentMutation()` — đã sửa.

**Đã xác minh thật**: `packages/core` +5 test, `apps/api` `supplier-debt-reconciliation-http.spec.ts` mới 10/10 (khoá/mở khoá kỳ, ngày đối chiếu lùi, Từ chối/Duyệt phiếu điều chỉnh liên kết, cách ly tenant, phân quyền), sửa 2 assertion hồi quy đúng dự kiến ở `business-code-http.spec.ts` (thêm codeType `SUPPLIER_DEBT_RECONCILIATION`, prefix `BBD`). `pnpm -w typecheck/lint/build` sạch toàn workspace. Verify Playwright qua Chrome thật trên tenant test cố định, đủ 8 bước (lập/Chốt khớp, lập lệch, Duyệt điều chỉnh, Chốt lại, chặn Huỷ chứng từ khoá kỳ khi thiếu quyền mở khoá, cho Huỷ khi có quyền) — dọn sạch vai trò/tài khoản test sau khi xong. Chi tiết đầy đủ `docs/DECISIONS.md` #189. **Công nợ nhà cung cấp hoàn tất 100% (Phần A→E).**

### Công nợ nhà cung cấp, Phần D "Luồng xử lý sai sót" — frontend + verify Playwright xong, Phần D hoàn tất 100%

Tiếp ngay theo handoff của phiên trước (backend đã xong). Web mới: `SupplierDebtAdjustmentDialog.tsx` (Lập phiếu điều chỉnh Tăng/Giảm), `SupplierDebtAdjustmentDetailDialog.tsx` (xem + Duyệt/Từ chối, dùng chung tab lẫn badge), `SupplierDebtAdjustmentBadge.tsx` ("Có điều chỉnh (N)"). Tab thứ 5 "Nhật ký điều chỉnh" + nút "Lập phiếu điều chỉnh công nợ" + banner đỏ lệch số dư trên `SupplierDetailPage.tsx`. "Đề nghị huỷ" tái dùng thẳng `ReasonConfirmDialog` có sẵn, thêm vào `StockReceiptListPage.tsx`/`StockIssueListPage.tsx` (không phải Form Page như handoff ghi nhầm — đã đối chiếu code thật). "Sao chép thành phiếu mới" ở Form Page khi phiếu đã huỷ, để trống Lô/Hạn dùng bắt chọn lại. Sidebar badge gộp thêm `pendingAdjustmentCount`.

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch, `apps/web` 5/5 test, không cảnh báo chunk size. Verify Playwright qua Chrome thật trên tenant test cố định — dựng vai trò hạn chế tạm thời (đã dọn sạch sau khi xong) để kiểm đúng kịch bản "Đề nghị huỷ", đủ 6 bước từ lập/duyệt điều chỉnh tới huỷ phiếu tự động + "Sao chép thành phiếu mới" + đối chiếu API. Chi tiết đầy đủ `docs/DECISIONS.md` #188. **Còn lại theo lộ trình gốc: Phần E — Đối chiếu & chốt công nợ theo kỳ (chưa có mockup, chưa bắt đầu).**

## 2026-09-25

### Công nợ nhà cung cấp, Phần D "Luồng xử lý sai sót" — backend code + test xong, chưa làm frontend/Playwright

Lấp lỗ hổng đã biết từ Phần A/C: Huỷ phiếu nhập/phiếu xuất trả NCC đã Duyệt giờ TỰ ĐỘNG đảo công nợ (trước đây cố ý không đụng, có characterization test khoá lại — nay đã xoá/thay). Thêm "Phiếu điều chỉnh công nợ" (Tăng/Giảm, không đụng tồn kho) và "Đề nghị huỷ" (người không có quyền duyệt phiếu gốc chỉ đề nghị, người có `supplier_debt.approve` duyệt — KHÔNG cần thêm quyền duyệt phiếu gốc). Bảng mới `supplier_debt_adjustment`, refactor `voidReceipt()`/`voidIssue()` tách lõi dùng chung (`voidPostedCore`) để cả huỷ trực tiếp lẫn huỷ hộ (duyệt đề nghị) đều tự đảo công nợ trong CÙNG 1 transaction. Kiểm tra toàn vẹn số dư mới (chặn Thanh toán nếu sổ lệch).

**Đã xác minh thật**: `apps/api` 1007/1007 test (+15 mới), `packages/core` 227/227, `pnpm -w typecheck/lint/build` sạch. Migration đã áp thật lên Postgres dev. Chi tiết đầy đủ `docs/DECISIONS.md` #187. **Còn treo**: toàn bộ frontend + verify Playwright (xem `docs/handoffs/HANDOFF-CongNoNhaCungCap-PhanD-2026-09-25.md`).

### Công nợ nhà cung cấp, Phần C — verify Playwright xong, Phần C hoàn tất 100%

Setup dữ liệu test qua HTTP API (tenant test cố định), verify qua Chrome thật cả 4 kịch bản: trả hàng không/có chọn "Phiếu nhập gốc" (giá tự tính đúng cả 2 trường hợp, kể cả sau chiết khấu), huỷ phiếu trả đã Duyệt (tồn kho đảo đúng, công nợ giữ nguyên — đúng thiết kế), "Thu tiền NCC hoàn lại". 13/13 assertion pass, 0 lỗi console. Chi tiết `docs/DECISIONS.md` #186.

### Polish UI (Sổ quỹ/NCC/Kho) — phản hồi trực tiếp lúc dùng thử

Sửa dải KPI bị kéo giãn ở trang chi tiết NCC, đổi dialog Thanh toán/Thu tiền hoàn lại sang bố cục ngang, thêm padding trang còn thiếu, sửa breadcrumb bị treo tên trang cũ, trích xuất `shared/ui/TabBar.tsx` dùng chung (đồng bộ 4 trang), thêm dialog xem nhanh cho tab Phiếu trả hàng/Thanh toán, nới rộng `CashVoucherDetailDialog`. Đổi quy trình tenant test: `config.json` từ nay luôn giữ tenant test cố định, không trả về tenant thật cuối phiên nữa. Chi tiết `docs/DECISIONS.md` #186.

## 2026-09-25

### Công nợ nhà cung cấp, Phần C "Trả hàng NCC" — code + test HTTP xong, CHƯA verify Playwright

Tiếp nối Phần A/B (`docs/DECISIONS.md` #185). Gắn NCC + tiền vào "Phiếu xuất kho mở rộng" loại `RETURN_TO_SUPPLIER` (GĐ4 #170 chỉ khai enum, chưa gắn gì): `stock_issue` thêm `supplierId`/`sourceReceiptId` (tuỳ chọn), `stock_issue_line` thêm `returnUnitPrice` (cột riêng, không tái dùng `sellPrice`). Duyệt phiếu ghi bút toán `RETURN` vào sổ công nợ (trừ đúng "Phiếu nhập gốc" trước nếu có chọn, không thì FIFO). Giá trả mặc định khi để trống: theo phiếu nhập gốc (sau chiết khấu dòng, quy đổi đơn vị) nếu có chọn, không thì theo giá vốn lô/bình quân gia quyền — luôn sửa tay được.

"Thu tiền NCC hoàn lại" (`POST /supplier-debt/:supplierId/refund`, Q8) — chỉ hợp lệ khi NCC đang nợ lại phòng khám (`balance<0`), sinh `cash_voucher` INCOME → `REFUND_RECEIVED`, tái dùng nguyên `applyVoucherEntry()` đã tổng quát hoá sẵn từ Phần A (không sửa gì thêm). Không migration/permission mới ngoài 3 cột trên.

Web: `StockIssueFormPage.tsx` thêm field Nhà cung cấp/Phiếu nhập gốc + cột Đơn giá trả/Thành tiền + tổng "Giá trị trừ công nợ" khi loại phiếu là RETURN_TO_SUPPLIER. Trang chi tiết NCC thêm tab "Phiếu trả hàng" + nút/dialog "Thu tiền NCC hoàn lại" (chỉ hiện khi `balance<0`).

**Đã biết, để dành Phần D**: Huỷ phiếu xuất trả ĐÃ DUYỆT không tự đảo bút toán công nợ — cùng lỗ hổng có chủ đích với "Huỷ phiếu nhập" từ Phần A (`StockReceiptService.voidReceipt()`), cả hai để Phần D ("Huỷ chứng từ") xử lý đồng bộ. Đã khoá hành vi này bằng characterization test ở cả 2 module.

**Đã xác minh thật**: `apps/api` +15 test HTTP mới (`supplier-debt-http.spec.ts` 8, `stock-issue-http.spec.ts` 7), toàn bộ suite `apps/api` 991/991 pass (991 = 976 trước + 15, 1 flake `appointment-work-shift-http.spec.ts` không liên quan, xác nhận qua chạy riêng), `pnpm -w typecheck/lint/build` sạch toàn workspace (build web không cảnh báo chunk size). **Chưa verify Playwright** — playwright-core chưa cài lại trong phiên này, chủ dự án chọn dừng ở bước code+test, để dành phiên sau. Chi tiết đầy đủ `docs/DECISIONS.md` #185.

## 2026-09-24

### Công nợ nhà cung cấp, Phần B "Thanh toán" — hoàn tất (code + test + verify Playwright)

Tiếp ngay sau Phần A cùng ngày (`docs/DECISIONS.md` #184). "Thanh toán công nợ" trên TỔNG nợ (không chọn từng phiếu, chặn trả vượt — cộng dồn cả phiếu đang chờ duyệt khác), trang mới "Công nợ nhà cung cấp" (`/suppliers/debts`) + "Phiếu thanh toán NCC" (`/suppliers/payments`), tab "Thanh toán" + nút thanh toán trên trang chi tiết NCC. **Không migration mới** — tái dùng nguyên schema Phần A; hook duyệt/từ chối/huỷ phiếu chi vào `CashVoucherService` hoá ra đã có sẵn từ Phần A, chỉ thiếu đúng 1 chỗ (`create()` khi voucher `POSTED` ngay không cần duyệt) — đã vá.

Trích xuất `resolveRecentDateRange()` (`packages/core/src/date/vietnam-day-range.ts`) dùng chung với `CashVoucherService.resolveDateRange()` — xoá trùng lặp lần 2 theo CLAUDE.md. Sidebar `NavItem` thêm prop `badge?: number` dùng chung (pill hổ phách) cho "Công nợ nhà cung cấp" — đếm số NCC có phiếu chờ duyệt.

**Đã xác minh thật**: `supplier-debt-http.spec.ts` +9 test (29/29), `apps/api` 976/976 toàn suite, `packages/core` +8 test, `pnpm -w typecheck/lint/build` sạch (2 trang mới lazy chunk ~5kB). Playwright qua Chrome thật trên tenant test riêng (không đụng tenant chủ dự án) xác nhận cả 2 luồng: không cần duyệt (voucher POSTED ngay, balance giảm đúng, hiện ở tab "Thanh toán"/trang "Phiếu thanh toán NCC") và cần duyệt (`cashVoucherApprovalEnabled` bật — voucher PENDING_APPROVAL, banner chờ duyệt + sidebar badge "1" hiện đúng, balance giữ nguyên tới khi Duyệt). 0 lỗi console. Chi tiết đầy đủ `docs/DECISIONS.md` #184.

### Công nợ nhà cung cấp, Phần A "Nền sổ công nợ" — hoàn tất (code + test + verify Playwright)

Mở rộng tiếp của Kho Thuốc GĐ2/GĐ3 (mở rộng phạm vi v1, `docs/DECISIONS.md` #180/#182/#183). Module mới `supplier-debt`: 2 bảng `supplier_debt_account`/`supplier_debt_entry` (sổ append-only, phân bổ FIFO tính lúc đọc), `stock_receipt` thêm 4 cột "Trả ngay" cho NCC, `cash_voucher` thêm `supplier_id`. Ghi công nợ tự động trong CÙNG transaction lúc Duyệt phiếu nhập/Duyệt-Huỷ phiếu chi. Trang `/suppliers/:id` (chi tiết NCC) + khối "Thanh toán" mới trên `StockReceiptFormPage.tsx` (đúng mockup đã duyệt). 5 permission mới, chỉ `clinic_admin` có.

Tiếp nối phiên trước (đã code+test HTTP xong nhưng form web còn thiếu UI cho "Trả ngay", chưa verify Playwright) — phiên này bổ sung khối "Thanh toán" còn thiếu, verify Playwright qua Chrome thật trên tenant test riêng (không đụng tenant chủ dự án), phát hiện + xử lý đúng bug vận hành quen thuộc (permission mới chưa `db:seed`).

**Đã xác minh thật**: build web sạch (không cảnh báo chunk size), typecheck/lint sạch, test web 5/5, Playwright xác nhận toàn bộ luồng (ẩn/hiện khối theo NCC, nút "Trả hết"/"Không trả", cảnh báo + chặn khi vượt tiền phải trả, lưu/mở lại phiếu đúng dữ liệu round-trip), 0 lỗi console. Chi tiết đầy đủ `docs/DECISIONS.md` #183.

### "Lịch làm việc của tôi" — redesign lưới theo tuần (Ca × Ngày) + widget "Đã đăng ký N/M ca"

Chủ dự án gửi ảnh tham khảo, yêu cầu đổi cách hiển thị chế độ Tuần từ "cột ngày, mỗi ngày xếp dọc các chip ca" sang **lưới Ca × Ngày** (hàng = mẫu ca, cột = 7 ngày) + thêm widget tổng kết "Đã đăng ký N/M ca (X giờ)" kèm vòng tròn %. Đã hỏi chốt 2 điểm trước khi code (đúng `feedback_confirm_before_feature`, xem `docs/DECISIONS.md` #181): KHÔNG thêm quy trình duyệt ca (ảnh mẫu có "Đã duyệt"/"Chờ duyệt" nhưng hệ thống hiện tại tự đăng ký là có ngay, không qua duyệt) — chỉ đổi nhãn thành "Đã đăng ký"; mẫu số "M" = tổng số ô ca khả dụng trong tuần (số mẫu ca × số ngày phòng khám mở cửa), không phải chỉ tiêu cấu hình riêng.

Bổ sung `GET /work-shift-assignments/business-hours` (tự-phục vụ, không `@RequirePermission`, đúng khuôn `month-lock-status`) để lấy Giờ làm việc hiện "Nghỉ" đúng ngày đóng cửa — KHÔNG tái dùng `GET /appointments/schedule-config` vì gắn `appointment.read` mà điều dưỡng (cũng tự đăng ký ca) không có quyền này. Component mới `shared/ui/ProgressRing.tsx` (vòng tròn % dùng chung). Ô "+ Đăng ký" trong lưới mới gọi thẳng API tạo 1 ca (biết trước ca của hàng đang bấm), không mở `WorkShiftPickerModal` nữa — modal đó chỉ còn dùng cho luồng "Chọn nhiều ngày" (bulk, giữ nguyên logic cũ).

**Bug thật phát hiện lúc verify Playwright, đã sửa**: thanh checkbox "Chọn ngày để áp dụng ca" đặt ở cuối khung lưới bị `SelectionToolbar` nổi cố định đáy màn hình đè lên (che mất quá nửa checkbox) — chuyển thanh này lên ngay dưới toolbar Tuần/Tháng, tránh xung đột với mọi overlay cố định đáy trang.

**Đã xác minh thật**: `work-shift-assignment-http.spec.ts` +4 test (bác sĩ đọc được `business-hours` dù không có `appointment.read`/`clinic_config.read`, phản ánh đúng cấu hình, 401, cách ly tenant) — 18/18 test file, toàn bộ suite `apps/api` không regress (1 flake `icd10-http.spec.ts` đã biết, xác nhận lại bằng chạy riêng). `pnpm -w typecheck/lint` sạch. Playwright qua Chrome thật (tenant dev `01a070f4-...`, tài khoản `dev.admin`, seed 3 mẫu ca) xác nhận: lưới hiện đúng "Nghỉ" cuối tuần, đăng ký nhanh 1 ô → "Đã đăng ký" xanh + đúng số giờ, widget tính đúng (vd 1/15 ca sau 1 lần đăng ký với 3 ca × 5 ngày mở cửa), luồng "Chọn nhiều ngày" + modal chọn ca vẫn hoạt động đúng sau khi sửa vị trí, không lỗi console.

## 2026-09-23

### Kho Thuốc GĐ4, phần 3/4/5 — hoàn tất 5/5 GĐ4 (Xuất kho mở rộng/Nhập kho mở rộng-Chiết khấu/Báo cáo Nhập-Xuất-Tồn)

Tiếp tục từ handoff giữa phiên trước (`docs/handoffs/HANDOFF-KhoThuoc-GD4-Phan3-4-5-2026-09-23.md`, commit `1bcbaff` đã có backend/frontend nhưng test dở dang, chưa verify Playwright). Viết nốt test HTTP còn thiếu: `inventory-http.spec.ts` +6 test (RETURN_FROM_USE, chiết khấu TOTAL/PER_LINE, validate 2 mode loại trừ nhau), file mới `stock-ledger-report-http.spec.ts` 7 test (báo cáo Nhập-Xuất-Tồn, quyền riêng `stock_receipt.report`, xuất Excel). Toàn bộ suite `apps/api` 943/943 pass, `packages/core` 212/212.

Phát hiện + sửa 2 vấn đề vận hành: (1) migration `stock_issue_receipt_gd4_extend` chưa thật sự áp lên Postgres dev (chỉ mới `prisma generate`, không phải `migrate deploy`) — đã `db:deploy`; (2) 2 permission mới (`stock_receipt.report`/`stock_issue.approve`) chưa seed — đã `db:seed` + khởi động lại API để tự đồng bộ `role_permission` cho 16 tenant hiện có.

**Verify Playwright phát hiện + sửa 1 bug thật**: `useInvalidateInventory()` (`inventory.queries.ts`) thiếu invalidate `'stock-issue'` — 4 mutation của "Phiếu xuất kho mở rộng" (tạo/sửa/Duyệt/Từ chối) cập nhật đúng ở server nhưng danh sách không tự làm mới khi thao tác ngay trên trang đang mở, hiện "Nháp" mãi tới khi F5 tay. Đã sửa, xác nhận lại qua Playwright (badge đổi ngay không cần F5).

Chi tiết đầy đủ `docs/DECISIONS.md` #179. **GĐ4 Kho Thuốc hoàn tất 100% (5/5 phần)**: Kiểm kê, Điều chuyển kho, Retrofit phân quyền Khoa/Phòng, Xuất kho mở rộng, Nhập kho mở rộng + Báo cáo Nhập-Xuất-Tồn. Còn GĐ5 (Trải nghiệm kê đơn) chưa bắt đầu.

### "Bệnh nhân trong ngày" — thêm "Xuất Excel", chốt phạm vi qua AskUserQuestion

Chủ dự án yêu cầu thêm chức năng xuất dữ liệu ra Excel cho trang "Bệnh nhân trong ngày" (`ReceptionListPage.tsx`). Chốt 2 điểm trước khi code: (1) phạm vi — LUÔN xuất TOÀN BỘ trong ngày, bỏ qua tab/tìm kiếm đang chọn trên màn hình; (2) cột — khớp đúng bảng đang hiển thị (Mã LK, Họ tên, Năm sinh/Tuổi, SĐT, Bác sĩ/Khoa phụ trách, Giờ tiếp nhận, Trạng thái).

Backend: `GET /api/v1/reception/list/export` (`ReceptionController`, cùng quyền `encounter.read` với `list()`), `ReceptionExportService` mới (`exceljs`, backend-only, đúng khuôn `CashBookExportService`) — nhãn trạng thái/tuổi khai RIÊNG (không import từ frontend, cùng lý do #032/#091/#114). `ReceptionService` thêm `getReceptionListForExport()` (gọi lại `listReceptions()` không truyền `doctorId`/`queueView` — đảm bảo LUÔN toàn bộ) + `recordReceptionListExportAudit()`. Bổ sung `DoctorDirectoryPort.getDepartmentNames()` (mới — trả toàn bộ Khoa/Phòng active theo id) để resolve đúng cột "Bác sĩ/Khoa phụ trách" khi chưa gán bác sĩ, adapter đọc qua `DepartmentRepository.listActiveOptions()` có sẵn. Không đăng ký OpenAPI (binary qua `@Res()`, web tải bằng `downloadFile()` — cùng lý do `/cash-flow-report/export` không có trong `generate-openapi.ts`).

Web: `reception.api.ts`/`reception.queries.ts` thêm `exportReceptionList()`/`useExportReceptionListMutation()` (đúng khuôn `cash-flow-report.api.ts`), nút "Xuất Excel" (`Button variant="secondary"`, icon `DownloadSimple`) ở khu vực điều hướng ngày.

**Đã xác minh thật**: `reception-http.spec.ts` +3 test (401, 200+audit log đúng ngày, LUÔN xuất toàn bộ dù truyền kèm `doctorId`/`queueView` — parse thật buffer `.xlsx` trả về bằng `exceljs` để xác nhận đúng dòng dữ liệu, không chỉ kiểm header). 920/920 test `apps/api` pass (57 file, không regress), 212/212 test `packages/core`. `pnpm -w typecheck/lint/build` sạch toàn workspace.

### Retrofit phân quyền theo Khoa/Phòng cho `stock_receipt`/`stock_issue` (GĐ2/GĐ3) — trả lời câu hỏi treo từ #173

Chủ dự án yêu cầu làm ngay câu hỏi treo ghi ở #173 ("có retrofit phân quyền Khoa/Phòng cho `stock_receipt`/`stock_issue` ngay bây giờ hay để dành"). Áp đúng cơ chế đã có ở `stock_count`/`stock_transfer` (kiến trúc mục 0, #170): `req.dataScope` truyền Controller→Service, 404 (không phải 403) nếu kho ngoài Khoa quản lý, `list()` lọc theo `warehouse.departmentId`, actor scope `department` chưa gán Khoa → danh sách rỗng không lỗi. `stock_receipt`: áp cho `create/update/getById/list/approve/reject/voidReceipt` — 2 hàm nội bộ tự sinh chứng từ (`createCountSurplusReceipt`/`createTransferInReceipt`, gọi từ `StockCountService`/`StockTransferService`) giữ nguyên KHÔNG nhận `dataScope` vì caller đã tự kiểm trước. `stock_issue`: áp cho `create/voidIssue/getById/list` — CHỦ ĐỘNG không áp cho `getDispenseStatus()`/`listDispenseQueue()` (đọc xem trước lúc phát thuốc, không đụng tồn kho thật; áp thêm cần tính "kho mặc định theo Khoa" phức tạp hơn phạm vi retrofit, để dành nếu cần sau).

Trích xuất `apps/api/src/common/warehouse-scope.helper.ts` dùng chung (`resolveActorDepartmentId`/`assertWarehouseInScope`/`assertEitherWarehouseInScope`) — trước đó `StockCountService`/`StockTransferService` mỗi nơi tự khai 1 bản giống hệt nhau, retrofit thêm 2 nơi nữa là lặp lần thứ 3/4, đúng ngưỡng phải trích xuất (`CLAUDE.md`). Refactor lại cả 2 service cũ dùng chung helper, không đổi hành vi.

**Đã xác minh thật**: thêm 11 test HTTP mới (`inventory-http.spec.ts` +6, `stock-issue-http.spec.ts` +5 — tạo/xem/huỷ đúng-sai Khoa, danh sách lọc đúng, actor chưa gán Khoa → rỗng), toàn bộ 917/917 test `apps/api` pass (không regress). `pnpm -w typecheck/lint/build` sạch toàn workspace. Không đổi API contract (không cần regen OpenAPI). ~~Chưa verify Playwright~~ **ĐÃ VERIFY XONG cùng ngày, xem mục ngay dưới đây.**

### Verify Playwright retrofit Khoa/Phòng — phát hiện + sửa lỗ hổng thật: frontend chưa lọc dropdown Kho theo Khoa

Verify qua Chrome thật (tenant dev riêng, `dev.admin` tạo Khoa/Kho/vai trò tuỳ biến scope `department` cho `stock_receipt.*` qua HTTP API đúng bài học #166 — không đụng tenant chủ dự án dùng thật): dropdown "Kho" ở "Tạo phiếu nhập kho" chỉ hiện đúng kho của Khoa mình; mở trực tiếp URL phiếu thuộc kho NGOÀI Khoa → "Not Found" đúng thiết kế (backend chặn 404); danh sách tự lọc đúng, không lẫn phiếu ngoài Khoa.

**Phát hiện lúc verify**: backend đã chặn đúng (404) nhưng **frontend chưa từng lọc dropdown "Kho" theo Khoa** ở 2 màn hình `StockReceiptFormPage.tsx` (Phiếu nhập kho) và `DispensePrescriptionDialog.tsx` (Phát thuốc) — khác `StockCountFormPage.tsx`/`StockTransferFormPage.tsx` đã có sẵn từ #170/#173. Người dùng scope `department` vẫn thấy MỌI kho trong dropdown, chỉ báo lỗi sau khi chọn sai kho và bấm Lưu — trải nghiệm tệ dù không rò dữ liệu. Đã sửa cả 2 file, đúng khuôn `useDataScope`/`useActorDepartmentId` (`features/auth/usePermission.ts`) đã có sẵn.

**Đã xác minh thật**: `pnpm -w typecheck/lint` sạch toàn workspace. Playwright qua Chrome thật xác nhận dropdown Kho ở "Tạo phiếu nhập kho" chỉ còn đúng 1 lựa chọn (kho của Khoa mình) sau khi sửa.

### Sửa màu nền tab/nút lọc đang chọn sai quy định — "Bệnh nhân trong ngày" + "Ví tạm ứng"

Chủ dự án phản hồi trực tiếp: tab lọc trạng thái ở "Bệnh nhân trong ngày" (`ReceptionListPage.tsx`) không nổi bật (`bg-white` chìm trong nền `bg-slate-100` bao quanh). Rà soát phát hiện thêm 1 lỗi khác chủ dự án hỏi tới: nút lọc "Đang hoạt động/Đã khoá/Tất cả" ở "Ví tạm ứng" (`WalletListPage.tsx`) dùng `bg-slate-900` — sai quy định (`.claude/docs/ui-guidelines.md` mục 2.1 định nghĩa `bg-slate-900` RIÊNG cho nền Header/Sidebar, không phải trạng thái đang chọn) và là **trường hợp duy nhất** trong toàn app dùng màu này cho việc này (rà soát `grep` xác nhận). Cả 2 đổi sang `bg-blue-600 text-white`, đúng token "Brand" và đúng màu đã dùng ở tab pill của `PatientDetailPage.tsx`.

**Đã xác minh thật**: `pnpm -w typecheck/lint` sạch toàn workspace.

### Verify Playwright "Điều chuyển kho" (GĐ4) hoàn tất — đúng thiết kế, không phát hiện bug

Xác nhận trực quan qua Chrome thật cả 3 màn hình (danh sách 4 trạng thái, tạo phiếu search-and-pick kể cả tự tách theo lô, Xác nhận nhận hàng tô màu/bắt buộc ghi chú khi thiếu/chặn nhận vượt) + phân quyền theo Khoa/Phòng qua UI thật (không chỉ HTTP test có sẵn). Vá kèm bug vận hành quen thuộc: `stock_transfer.*` chưa có trong `role_permission` dev tenant do thiếu `db:seed`. Chi tiết đầy đủ `docs/DECISIONS.md` #173 (đoạn "Còn treo, việc kế tiếp"). "Điều chuyển kho" (2/5 GĐ4) coi như xong 100%.

### Thêm "In phiếu" cho Điều chuyển kho — dùng chung 1 mẫu cho cả kho nguồn lẫn kho đích

`StockTransferPrintView.tsx` mới, đúng khuôn `.print-area` chung với Nhập/Xuất kho. Nút "In phiếu" hiện khi phiếu `IN_TRANSIT` (kho nguồn in ngay sau Duyệt xuất) và `COMPLETED` (kho đích in sau khi Xác nhận nhận hàng) — không hiện với `DRAFT`/`REJECTED`. Không đổi backend/schema. Đã xác minh Playwright qua Chrome thật cả 2 trạng thái. Chi tiết `docs/DECISIONS.md` #174.

### Thu gọn/xổ ra nhóm "1 tiêu đề sản phẩm + N dòng lô" (Kiểm kê, Phiếu nhập kho)

`shared/hooks/useCollapsedGroups.ts` mới — nút thu gọn/xổ ra trên dòng tiêu đề sản phẩm khi có >1 lô, mặc định xổ ra. Áp dụng đúng 2 nơi có kiểu hiển thị này: `StockCountFormPage.tsx`, `StockReceiptFormPage.tsx` (2 nơi khác — Điều chuyển kho, Chi tiết thanh toán — dùng bố cục khác, không thuộc phạm vi). Đã xác minh Playwright qua Chrome thật. Chi tiết `docs/DECISIONS.md` #175.

### Đổi cơ chế "Xem chi tiết" toàn app: gom về 1 nút icon trong cột Thao tác

Thống nhất 12 bảng danh sách (trước đây mỗi nơi tự chọn 1 kiểu: bấm mã, double-click hàng, click cả hàng) về đúng 1 kiểu — nút `Eye`/"Xem" luôn đứng đầu cột Thao tác, cột mã/tên hết bấm được. Ngoại lệ giữ nguyên (theo yêu cầu ban đầu): `PatientListPage.tsx`, `DrugCatalogPane.tsx`, và mọi bảng "master-detail" chọn dòng để lọc panel cùng trang (`RoomPane`/`DepartmentPane`/`AllergenPane`/`Icd10Pane`/`RolePermissionPane`). Cập nhật `.claude/docs/ui-guidelines.md` mục 9 làm quy tắc chốt. Đã xác minh Playwright qua Chrome thật trên hầu hết trang đã sửa, không phát hiện bug. Chi tiết `docs/DECISIONS.md` #176.

## 2026-09-22

### Kho Thuốc GĐ4, phần "Điều chuyển kho" — code + test xong + tìm mã vạch cho thuốc/vật tư

Mockup Artifact (3 tab: Danh sách/Tạo phiếu/Xác nhận nhận hàng) duyệt trong phiên trước khi code. Bảng mới `stock_transfer`/`stock_transfer_line` — 1 luồng duy nhất tự sinh cặp chứng từ liên kết, tách 2 bước Duyệt xuất (trừ kho nguồn ngay, sinh Phiếu xuất TRANSFER_OUT) → Xác nhận nhận hàng (cộng kho đích đúng số lượng thực nhận, sinh Phiếu nhập TRANSFER_IN). Nhận ít hơn được (bắt buộc ghi lý do), nhận nhiều hơn bị chặn cứng cả tầng Service lẫn CHECK DB. Không hỗ trợ Huỷ sau khi đã Đang vận chuyển.

Phân quyền theo Khoa/Phòng kiểm đúng kho của từng bước (kho nguồn cho Duyệt xuất, kho đích cho Xác nhận nhận hàng; xem thì nới hơn — thuộc Khoa 1 trong 2 kho đều xem được), dùng chung 1 quyền `stock_transfer.approve`.

Web: trang "Điều chuyển kho" mới trong "Quản lý kho" — danh sách + trang tạo/sửa/xác nhận nhận hàng/xem dùng chung 1 component theo trạng thái phiếu.

Ngoài kế hoạch, theo yêu cầu trực tiếp: thêm tìm kiếm theo **mã vạch** vào ô tìm thuốc/vật tư dùng chung — áp dụng ngay cho mọi nơi gọi (Danh mục Thuốc & Vật tư, Kê đơn, Nhập kho/Kiểm kê/Điều chuyển kho).

**Đã xác minh thật**: `apps/api` `stock-transfer-http.spec.ts` 23/23 (mới, gồm phân quyền Khoa/Phòng, race Duyệt trùng, chặn nhận vượt/thiếu ghi chú), toàn bộ suite `apps/api` pass (sửa 1 test đếm loại mã nghiệp vụ 16→17 do thêm `STOCK_TRANSFER`, 1 flake race `icd10-http.spec.ts` đã biết không liên quan). `packages/core`/`packages/shared`/`apps/web` pass đủ. `pnpm -w typecheck/lint/build` sạch toàn workspace. Migration đã áp thật lên Postgres dev. **Chưa verify Playwright/trình duyệt thật.** Chi tiết đầy đủ `docs/DECISIONS.md` #173.

### Đồng bộ nút thao tác toàn app (icon nền màu) + sửa đơn vị tính sai ở phiếu in + 2 bug thật ở "Phát thuốc" (đổi kho không cập nhật tồn, thiếu tên bệnh nhân) + redesign khối thông tin dialog

Phát hiện liên tiếp trong lúc verify Playwright cho #171 — chủ dự án dùng thử trực tiếp qua `pnpm dev` song song.

**Đồng bộ nút thao tác** — 14 bảng danh sách (3 trang Kho mới + 11 trang cũ như Danh mục dùng chung/Tài khoản/Thuốc & Vật tư/Nhà cung cấp...) đổi từ chữ mờ/icon chỉ hiện màu lúc hover sang icon tròn nền màu LUÔN hiện (`shared/ui/RowActionButton.tsx` mới).

**2 bug thật ở "Phát thuốc"**: (1) đổi kho ở dropdown không cập nhật lại tồn kho/ô nhập số lượng — do `lines` chỉ nạp từ API đúng 1 lần lúc mở dialog, đổi kho query refetch đúng nhưng state hiển thị không đổi theo (sửa bằng theo dõi `loadedForWarehouseId`); (2) dialog không hiện đang phát cho bệnh nhân nào — mở rộng API `dispense-status` trả thêm `patientFullName`/`patientCode`.

**Redesign khối thông tin dialog** (tra cứu `/ui-ux-pro-max`) — tách badge "Đã ký" khỏi tiêu đề bằng `StatusBadge` xanh lá, nhãn đậm dễ đọc hơn, chẩn đoán tương phản tốt hơn trên nền vàng, thêm dòng "Bệnh nhân" nổi bật đầu tiên.

**Đã xác minh thật**: `apps/api` 871/882 pass (1 flake đã biết), `pnpm -w typecheck/lint/build` sạch, OpenAPI + web codegen đã sinh lại. Playwright qua Chrome thật xác nhận toàn bộ, không lỗi console. Chi tiết đầy đủ `docs/DECISIONS.md` #172.

### Rà soát lỗ hổng quy trình "Kiểm kê" (lý do bắt buộc khi Duyệt lệch, trang "Phiếu xuất kho") + nhãn nút chờ duyệt + in phiếu Kiểm kê/Nhập kho/Xuất kho

Chủ dự án tự kiểm tra phần "Kiểm kê" vừa code xong, phát hiện đúng 2 lỗ hổng: Duyệt phiếu có chênh lệch tự động sửa tồn kho mà không cần lý do gì, và phiếu xuất tự sinh từ kiểm kê (thiếu hàng) không có nơi nào tra cứu quá 1 ngày. Đã sửa cả hai + thêm nhãn nút rõ ràng hơn cho nhân viên không có quyền duyệt + bổ sung in phiếu cho cả 3 loại chứng từ kho.

**Lý do bắt buộc khi Duyệt có chênh lệch**: `approveStockCountRequestSchema` thêm `reason` — Service bắt buộc THẬT khi có dòng dư/thiếu (tính từ tồn kho SỐNG lúc Duyệt), không bắt buộc nếu khớp hoàn toàn. Cột mới `stock_count.approval_reason`. UI mở popup hỏi lý do khi Duyệt "trơn" bị từ chối (`StockCountApproveReasonDialog.tsx`), cả ở danh sách lẫn trang chi tiết.

**Trang mới "Phiếu xuất kho"** (`/inventory/issues`) — liệt kê MỌI phiếu xuất (thủ công lẫn tự sinh từ Kiểm kê), mọi thời điểm, filter Loại/Kho/Trạng thái, có "Huỷ phiếu" ngay trong hàng (backend có sẵn từ GĐ3 nhưng chưa web nào gọi tới). Vá kèm 1 bug thật: tab "Đã phát hôm nay" quên truyền `issueType='RETAIL_SALE'` dù ý định đã ghi rõ ở lần trước.

**Nhãn nút cho nhân viên không có quyền duyệt**: "Lưu nháp" → "Lưu & chuyển duyệt" khi actor không có quyền `*.approve` (hành vi không đổi, chỉ đổi tên cho rõ nghĩa) — áp dụng cả "Kiểm kê" lẫn "Phiếu nhập kho".

**In phiếu Kiểm kê/Nhập kho/Xuất kho** (chủ dự án yêu cầu bổ sung giữa phiên) — 3 component in mới, dùng hạ tầng in chung có sẵn (`.print-area`), chỉ hiện nút khi phiếu đã hoàn tất (`POSTED`, chưa huỷ).

**Đã xác minh thật**: `apps/api` `stock-count-http.spec.ts` 20/20 (thêm test lý do bắt buộc + sửa 7 test cũ), `packages/core` 212/212, `packages/shared` 25/25, `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch toàn workspace. Migration `20260922120000_stock_count_approval_reason` đã áp thật lên Postgres dev. OpenAPI + web codegen đã sinh lại. **Chưa verify Playwright** (gộp chung việc còn treo với phần "Kiểm kê" gốc). Chi tiết đầy đủ `docs/DECISIONS.md` #171.

### Kho Thuốc GĐ4, phần "Kiểm kê" — code + test xong, kèm phân quyền theo Khoa/Phòng làm THẬT lần đầu

Theo đúng `docs/handoffs/HANDOFF-KhoThuoc-GD4-KiemKe-2026-09-22.md`, mockup `KiemKeList.dc.html`/`KiemKeForm.dc.html` đã duyệt từ phiên trước. Bảng mới `stock_count`/`stock_count_line` (migration `20260922100000_stock_count_ge4`), luồng Nháp→Duyệt/Từ chối đúng khuôn `stock_receipt`. Duyệt đọc LẠI tồn kho SỐNG (không dùng snapshot cũ) để tính dư/thiếu, tự sinh 1 `StockReceipt`(`COUNT_SURPLUS`)/`StockIssue`(`COUNT_SHORTAGE`) gộp mọi dòng — dùng lại logic cộng/trừ tồn có sẵn qua 2 method mới `createCountSurplusReceipt()`/`createCountShortageIssue()`, không lặp code.

Ripple bắt buộc: `stock_receipt`/`stock_issue` thêm `count_id`; `stock_issue.prescription_id` nới NULLABLE + CHECK theo `issue_type` (COUNT_SHORTAGE không gắn đơn thuốc); `stock_issue` list thêm filter `issueType` (để "Đã phát hôm nay" không lẫn phiếu tự sinh từ kiểm kê).

**Phân quyền theo Khoa/Phòng — hiện thực THẬT lần đầu tiên** (trước đây `department` chỉ là lựa chọn UI chưa ai enforce): `req.dataScope` truyền Controller→Service đúng khuôn `encounter.service.ts` "Nhận ca", 404 (không phải 403) nếu kho ngoài Khoa quản lý. `currentUserSchema` thêm `departmentId` để web tự lọc dropdown kho. Mặc định 5 vai trò hệ thống không đổi (vẫn global) — chỉ có tác dụng khi `clinic_admin` chọn scope `department` cho vai trò tuỳ biến.

Ngoài kế hoạch, cùng phiên theo phản hồi trực tiếp trên `pnpm dev`: sửa icon tìm kiếm lệch khỏi khung (đổi `type="search"`→`type="text"`, tránh xung đột với UA decoration của Chrome), bỏ 3 dòng ghi chú hướng dẫn màu xám (bàn phím/nhóm lô/lưu ý Duyệt) theo yêu cầu — chỉ giữ thông báo trạng thái chức năng thật.

**Đã xác minh thật**: `packages/core` +5 test (212/212), `apps/api` `stock-count-http.spec.ts` 20/20 (đủ kịch bản phân quyền Khoa/Phòng), toàn bộ suite `apps/api` 878-881/881 ổn định qua nhiều lần chạy (3 lỗi còn lại là flake race `seedDefaultRolesForTenant` đã biết, xác nhận qua cô lập). `pnpm -w typecheck/lint/build` sạch toàn workspace, OpenAPI + web codegen đã sinh lại. API dev thật khởi động sạch, `GET /health` OK. **Chưa verify Playwright/trình duyệt thật** (không có công cụ browser automation trong phiên này) — xem `docs/DECISIONS.md` #170.

### "Mã đơn thuốc thật" + tab "Đã phát hôm nay" + 2 lỗi giao diện "Đã phát thuốc thành công"

Hoàn tất việc treo từ phiên trước (`docs/handoffs/HANDOFF-PhatThuoc-MaDonThuoc-2026-09-21.md`): `prescription.prescription_no` sinh thật lúc ký đơn (khuôn `DT[yy][mm][6 số]`, qua `BusinessCodeService` — tự hiện trong "Cấu hình mẫu mã phát sinh"), đính chính giữ nguyên mã gốc, backfill đủ đơn cũ đã ký trên dev DB thật. Khối thông tin mới ở đầu dialog "Phát thuốc" (mã đơn/BS kê đơn/ngày kê + TẤT CẢ chẩn đoán, không chỉ chẩn đoán chính — theo ảnh tham khảo chủ dự án gửi giữa chừng, khác gợi ý ban đầu của handoff).

Ngoài kế hoạch, chủ dự án yêu cầu trực tiếp trong phiên: sửa 2 lỗi giao diện "Đã phát thuốc thành công" (khung quá to so với nội dung, 2 nút bị vỡ chữ khi xếp ngang trong khung hẹp) và thêm tab "Đã phát hôm nay" vào trang "Phát thuốc" (tận dụng API liệt kê phiếu xuất kho có sẵn từ GĐ3 nhưng chưa web nào dùng tới) — dùng `TwoOptionToggle` có sẵn cho nền trượt đặc.

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, `apps/api` 845/847 pass (2 flake `role_permission` đã biết). Playwright qua Chrome thật trên tenant test riêng (đúng bài học #166) xác nhận đúng toàn bộ. Xem chi tiết đầy đủ `docs/DECISIONS.md` #169.

## 2026-09-21

### Sửa "Đổi mật khẩu" không mở khoá tài khoản + Redesign giao diện "Phát thuốc" + hiển thị Tồn kho thật + sửa luồng mua thêm OTC + guard chặn đổi "Quản lý theo lô" khi còn tồn

Chuỗi phát hiện liên tiếp qua chủ dự án dùng thử trực tiếp trên trình duyệt trong 1 phiên. Sửa bug đặt lại mật khẩu không xoá khoá tạm (`resetLoginAttempts()`); redesign toàn bộ giao diện "Phát thuốc" sang danh sách 1 cột theo đúng phong cách hiện đại hơn (bỏ card 2 cột, dùng `ModalHeader`/`SelectionCheckbox` dùng chung, sửa canh lề checkbox, đồng bộ cỡ chữ, rút gọn chú thích dài); thêm hiển thị "Tồn kho thật" tách biệt với "Còn lại theo đơn" sau khi điều tra ra nguyên nhân báo "không đủ tồn" sai (dữ liệu `stock_balance` cũ bị kẹt dưới lô do đổi cờ `isBatchManaged` sau khi đã nhập kho) — dọn dữ liệu rác + thêm guard `DrugBatchManagementChangeBlockedError` chặn tái diễn; sửa luồng thêm "mua thêm ngoài đơn" cho đúng CHÍNH thuốc đã kê (trước đây bị chặn cả 2 hướng).

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, OpenAPI + web codegen đã sinh lại (`warehouseStockOnHand` mới). `apps/api` 845/847 pass trực tiếp (2 flake `role_permission` đã biết, pass 100% khi chạy riêng). Test mới: đặt lại mật khẩu mở khoá ngay, guard đổi `isBatchManaged`, `warehouseStockOnHand` cả 2 trường hợp theo lô/phi-lô. **Chưa verify Playwright chính thức** cho phần redesign/tồn kho/OTC — xem chi tiết đầy đủ `docs/DECISIONS.md` #168. Việc kế tiếp ("Mã đơn thuốc thật") đã ghi handoff riêng `docs/handoffs/HANDOFF-PhatThuoc-MaDonThuoc-2026-09-21.md`.

### Sửa `config.json` trỏ nhầm tenant dev (không phải lỗi RLS) + Hoạt chất: đủ trường Mã BYT/Tên đầy đủ chuẩn/Mô tả (sửa tự do) + mã tự sinh ngắn cho 9 category Kho Thuốc

Chủ dự án báo nghi rò rỉ dữ liệu xuyên tenant — điều tra ở tầng DB xác nhận RLS cách ly đúng, nguyên nhân thật là `apps/web/public/config.json` đang trỏ sang một tenant dev rác (tạo lúc verify Kho Thuốc GĐ3, quên trả lại) thay vì tenant chủ dự án dùng thật hằng ngày. Đã khôi phục đúng tenant, để nguyên tenant rác (chủ dự án xác nhận không cần dọn — xoá đúng cách sẽ phải cascade qua ~15 bảng, rủi ro cao trong khi lợi ích gần bằng 0). Xem chi tiết + bài học cho phiên sau `docs/DECISIONS.md` #166.

Riêng, chủ dự án phát hiện form "Thêm mới Hoạt chất" thiếu Mã BYT/Tên đầy đủ chuẩn/Mô tả so với "Đường dùng" — đúng, và phát hiện thêm mã tự sinh của cả 9 category Kho Thuốc GĐ1 (không riêng Hoạt chất) vẫn dùng định dạng cũ dài có gạch nối (bỏ sót vì GĐ1 ra đời sau cơ chế mã ngắn #113 12 ngày). Đã sửa đồng bộ cả 9 category (chỉ mục tạo MỚI, không đánh số lại mã cũ), và cho Hoạt chất sửa (Edit) tự do 3 trường trên (khác 5 category "chuẩn BYT" khác chỉ cho nhập lúc Tạo mới vì có nguồn seed cần bảo vệ). Xem chi tiết `docs/DECISIONS.md` #167.

**Đã xác minh thật**: `packages/core` 207/207, `packages/shared` 25/25, `apps/api` 858/859 (1 flake timing đã biết ở `clinic-profile-http.spec.ts`, không liên quan), `reference-catalog-http.spec.ts` riêng 17/17 (+1 test mới). `pnpm -w typecheck/lint/build` sạch toàn workspace. Playwright qua Chrome thật trên tenant test riêng (không đụng tenant chủ dự án) xác nhận đúng cả 2 việc.

## 2026-09-17 (6)

### Thêm nút Ẩn/Kích hoạt lại (isActive) cho danh sách Thuốc & Vật tư, Nhà cung cấp, Kho

Chủ dự án phát hiện danh sách "Thuốc & Vật tư" không có chức năng vô hiệu hoá mặt hàng. Rà soát cho thấy backend đã hỗ trợ đầy đủ `isActive` qua `PATCH` từ Giai đoạn 1 (#148, có test xác nhận) nhưng `DrugCatalogPane.tsx` chưa từng nối UI để dùng — nút "Sửa" chỉ mở modal, không có cách nào đổi Trạng thái. Rà soát rộng hơn phát hiện lỗ hổng y hệt ở `SupplierPane.tsx`/`WarehousePane.tsx` (cùng khuôn code).

Thêm nút "Ẩn"/"Ngưng sử dụng" (icon `Prohibit`, có popup xác nhận nêu rõ hậu quả — đúng khuôn `UserAccountPane.tsx`/`ReferenceCatalogPane.tsx`) và "Kích hoạt lại" (icon `ArrowCounterClockwise`, trực tiếp không cần xác nhận) vào cột "Thao tác" ở cả 3 danh sách. Không đổi backend/schema — dùng thẳng `useUpdateDrugMutation`/`useUpdateSupplierMutation`/`useUpdateWarehouseMutation` sẵn có.

**Đã xác minh thật**: `pnpm --filter @nexamed/web run typecheck/build` sạch, `apps/api` 858/858 test không regress (thuần đổi frontend). Playwright qua Chrome thật (dữ liệu test tạo/dọn qua HTTP API bằng `dev.admin`, dùng lại dev server đang chạy sẵn) xác nhận cả 3 nơi: Ẩn → mặt hàng/NCC biến mất khỏi danh sách mặc định (bật "Hiện cả..." thấy lại), Kho hiện badge "Ngưng" ngay (không có filter ẩn/hiện) — Kích hoạt lại → về đúng "Đang dùng" cả 3 nơi, không lỗi console.

## 2026-09-17 (5) — HOÀN TẤT, đã verify Playwright đủ

### Gỡ auto-dispense mù, sửa 3 lỗ hổng mockup GĐ3, nhóm hiển thị hoá đơn, tách nhiều lô

Gỡ hẳn `autoDispenseOnSignEnabled` (tự động xuất kho mù lúc ký đơn — sai thiết kế khi khách chỉ lấy một phần đơn kê), thay bằng gate nút "Phát thuốc" ở màn khám theo `soloClinicWorkflowEnabled` có sẵn. Sửa 3 lỗ hổng so với mockup GĐ3 đã duyệt: checkbox bỏ chọn từng dòng thuốc kê (thiếu hoàn toàn), dòng "Đã phát đủ" bị ẩn thay vì hiện read-only, thiếu nút "Xem hoá đơn" ở màn thành công. Thêm nhóm hiển thị hoá đơn "Dịch vụ khám"/"Tiền thuốc — Phiếu xuất ..." + xem đúng hoá đơn DRUG riêng qua `?invoiceId=` (điểm 5/10 #163, trước đó chưa làm). Thêm "1 loại thuốc phát từ nhiều lô cùng lúc" (đúng mockup) — phát hiện và sửa 1 lỗ hổng backend thật (kiểm tồn/số lượng đã kê độc lập từng dòng, không cộng dồn trong cùng request), thêm 3 test hồi quy xác nhận đúng.

Phiên trước dừng giữa chừng do lỗi biên dịch TS ở phần tách nhiều lô (`docs/handoffs/HANDOFF-KhoThuoc-GD3-SuaLoi-2026-09-17.md`) — phiên này sửa xong 2 lỗi, viết 2 test hồi quy backend, verify Playwright đầy đủ cho toàn bộ 5 việc (kể cả nhánh chưa từng test trước: hoá đơn khám đã thu tiền → tự tách đúng hoá đơn thuốc riêng, khối tham chiếu chéo hiện đúng).

**Đã xác minh**: `pnpm -w typecheck/lint/build` sạch toàn workspace; `apps/api` 842 pass + 16 skip (2 flake `role_permission` đã biết, pass 100% khi chạy riêng), `stock-issue-http.spec.ts` riêng 17/17. Playwright qua Chrome thật xác nhận đúng toàn bộ. Xem chi tiết `docs/DECISIONS.md` #165.

## 2026-09-17 (4)

### Kho Thuốc & Vật tư y tế Giai đoạn 3 — Xuất kho theo đơn + FEFO + tiền thuốc (code + test xong)

Module `StockIssueController/Service/Repository` mới trong `apps/api/src/modules/inventory/` — "Phiếu xuất kho" (luồng 1 bước, khác Nháp→Duyệt của GĐ2), gợi ý lô theo FEFO (`packages/core/src/inventory/select-fefo-batches.ts`), gắn tiền vào hoá đơn dịch vụ khám đang mở hoặc tự tách hoá đơn tiền thuốc riêng, "Tự động phát thuốc lúc ký đơn" (`autoDispenseOnSignEnabled`, không rollback chữ ký khi thiếu tồn). 2 migration mới (`20260917110000_pharmacy_dispense_gd3`, `20260917120000_stock_ledger_issue_void_reason`) — bảng `stock_issue`/`stock_issue_line`, `invoice.invoice_type` (SERVICE/DRUG), cho phép N hoá đơn DRUG/lượt khám. Web: trang "Phát thuốc" (`/inventory/dispense`) + dialog dùng chung mở từ cả trang riêng lẫn màn khám, 2 công tắc mới ở "Cấu hình thanh toán".

**Đã xác minh thật**: `packages/core` +7 test FEFO, `apps/api` `stock-issue-http.spec.ts` mới 14/14 + `prescription-http.spec.ts` +2 test auto-dispense, tổng 846/847 test `apps/api` (1 flake `icd10-http.spec.ts` đã biết, pass riêng), `pnpm -w typecheck/lint/build` sạch toàn workspace. **Chưa verify Playwright.** Xem chi tiết `docs/DECISIONS.md` #164.

## 2026-09-17 (3)

### Nối "Ngưỡng cảnh báo hạn dùng" vào `tenant_setting` thật + fix bố cục bảng Thuốc & Vật tư

Chủ dự án phát hiện lúc test tab "Tồn kho theo lô" (GĐ2): ngưỡng cảnh báo hết hạn chỉ hardcode 30 ngày dù comment code nói đã cấu hình được theo tenant. Thêm `expiryWarningDays` vào `ClinicSettings`/`ClinicConfigReaderPort`/`ClinicSettingsRepository` (không migration mới, `tenant_setting` là bảng key-value có sẵn) + Boxed Section "Kho" mới ở pill "Cấu hình chung" (`/admin/system-config`). `StockBalanceService` đọc ngưỡng qua port thay hằng số cứng. Tiện sửa 1 bug bố cục thật ở `DrugCatalogPane.tsx` (cột "Mã hàng" xuống dòng, "Tên hàng" quá rộng).

**Đã xác minh thật**: `apps/api` +5 test (830/831 pass, 1 flake `icd10-http.spec.ts` đã biết), `pnpm -w typecheck/lint/build` sạch, Playwright qua Chrome thật. Xem chi tiết `docs/DECISIONS.md` #162.

## 2026-09-17 (2)

### Kho Thuốc GĐ2 verify Playwright — loạt bug thật + Combobox/DateInput cho toàn app + Quy cách đóng gói

Verify Playwright cho GĐ2 lộ ra nhiều bug thật: thiếu quyền `stock_receipt.*` (quên `db:seed`, nay có cảnh báo tự động lúc khởi động), đơn vị hiện mã thô, bấm thêm 1 lần ra 2 dòng trùng (kèm redesign bảng dòng hàng theo nhóm sản phẩm + lô), `belowMinOnly=false` bị hiểu nhầm thành `true` khiến "Tồn kho" trống trơn, "Tồn kho theo lô" chưa có cảnh báo hạn dùng, và `calculateAgeYears` sai múi giờ (chỉ đúng tình cờ trên máy Asia/Saigon). Tất cả đã sửa + có test hồi quy.

Theo yêu cầu trực tiếp: đổi TOÀN APP từ `<select>`/`<input type="date">` gốc sang `Combobox`/`DateInput` (mới, mặt nạ dd/mm/yyyy) cho đồng bộ giao diện. Thêm "Quy cách đóng gói" cho `drug` (tự gợi ý từ Bảng quy đổi, sửa tay được, đảo ngược hoãn #151) và mở "Mã BYT"/"Tên đầy đủ chuẩn" ở form TẠO MỚI cho 5 danh mục chuẩn BYT (đảo ngược một phần #152/#153, sửa vẫn giữ nguyên chỉ 2 trường).

**Đã xác minh thật**: 835/835 test `apps/api`, `pnpm -w typecheck/lint/build` sạch toàn workspace, Playwright qua Chrome thật cho từng điểm. Xem chi tiết `docs/DECISIONS.md` #160/#161.

## 2026-09-17

### Kho Thuốc & Vật tư y tế Giai đoạn 2 — Nhập kho & tồn theo lô (mockup đã duyệt, code + test xong)

Module mới `apps/api/src/modules/inventory/` + `apps/web/src/features/inventory/` — "Phiếu nhập kho" (luồng Nháp → Duyệt/Từ chối/Huỷ), "Tồn kho" (Theo mặt hàng/Cảnh báo hạn dùng), "Thẻ kho"/"Lịch sử giao dịch" trong panel chi tiết thuốc. 5 bảng mới (`stock_receipt`/`stock_receipt_line`/`inventory_batch`/`stock_ledger`/`stock_balance`, migration `20260917090000_pharmacy_inventory_gd2`) + `drug.lastPurchaseUnitCost`/`lastPurchaseAt`. Giá vốn đích danh theo lô / bình quân gia quyền liên hoàn tuỳ `drug.isBatchManaged`, quy đổi đơn vị lúc Duyệt bằng `computeUnitConversion()` có sẵn từ GĐ1. Huỷ phiếu đã Duyệt đảo ngược đúng các dòng thẻ kho phiếu đó sinh ra (không tính lại từ dòng hàng). Permission mới `stock_receipt.create/read/approve`.

**Đã xác minh thật**: `packages/core` +5 test, `apps/api` `inventory-http.spec.ts` 15/15, toàn bộ suite không hồi quy, `pnpm -w typecheck/lint/build` sạch. Chưa verify Playwright. Xem chi tiết `docs/DECISIONS.md` #159.

## 2026-09-16 (9)

### Sửa 3 lỗi giao diện nhỏ: nhãn/khung "Chi tiết phiếu thu/chi", nhãn "Ví tạm ứng" thiếu

`CashVoucherDetailDialog.tsx` — nhãn quá mờ so với dữ liệu (3 vòng chỉnh trực tiếp: `text-slate-400`→`text-slate-500`→`text-slate-700`, dữ liệu `font-semibold`→`font-medium`), khung chật (`max-w-lg`→`max-w-2xl`, giãn khoảng cách trường). Cùng lỗi nhãn mờ ở 3 phiếu in khác (`CashVoucherPrintView`/`CashierShiftReceiptView`/`WalletReceiptPrintView`) — sửa màu nhãn cho nhất quán.

`permission-grouping.ts` thêm nhãn tiếng Việt còn thiếu cho module `patient_wallet` ("Ví tạm ứng") ở trang "Vai trò & Phân quyền".

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace. Xem chi tiết `docs/DECISIONS.md` #158.

## 2026-09-16 (8)

### Tách "Thuốc & Vật tư" thành trang đơn, "Danh mục kho" chuyển vào "Quản trị"

Trang "Danh mục Thuốc và Vật Tư" (11 pill lẫn CRUD thuốc thật với danh mục phân loại) tách làm 2 theo yêu cầu chủ dự án: "Thuốc & Vật tư" (route giữ nguyên, bỏ pill, chỉ còn CRUD thuốc) và "Danh mục kho" (route mới `/admin/catalog-warehouse`, 10 pill danh mục/phân loại) — "Danh mục kho" chuyển hẳn vào nhóm "Quản trị", đặt dưới "Danh mục cận lâm sàng".

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web không đổi bất thường. Xem chi tiết `docs/DECISIONS.md` #157.

## 2026-09-16 (7)

### Seed "Thời điểm dùng thuốc" + tách quyền `drug.manage` thành `drug.create`/`drug.update`

Seed danh mục mới `DRUG_USAGE_TIMING` (9 dòng, T01-T08+T99) từ file chủ dự án gửi — sau khi phân tích, chốt CHỈ thêm "Thời điểm dùng" (không trùng lặp), bỏ hẳn "Cách dùng" (trùng ~80% với Đường dùng/Dạng bào chế đã seed #152). Thêm combobox "Gợi ý thời điểm dùng" (ghép câu vào ô text tự do, có "thêm nhanh") ở Danh mục Thuốc và dòng kê đơn. Bug thật phát hiện lúc chủ dự án kiểm tra: quên nối vòng lặp seed thật vào script, đã vá.

Tách quyền `drug.manage` (gộp thêm+sửa+ẩn) thành `drug.create`/`drug.update` riêng — chủ dự án hỏi trực tiếp vì sao trang "Vai trò & Phân quyền" hiện cột Thêm/Sửa trống cho module Thuốc. Migration xoá sạch permission+role_permission cũ, seed lại permission mới, `syncRolePermissionsForAllTenants()` tự cấp lại cho `clinic_admin`.

**Đã xác minh thật**: `packages/core` 192/192, `apps/api` 819/820 (1 flake đã biết, pass riêng), `pnpm -w typecheck/lint/build` sạch toàn workspace. Migration đã áp thật lên Postgres dev, xác nhận qua query Prisma trực tiếp. Xem chi tiết `docs/DECISIONS.md` #155/#156.

## 2026-09-16 (6)

### Tách chunk `vendor` khỏi chunk khởi động web — hết vượt trần 500 kB

Xử lý mục treo từ #148/#151 (chunk khởi động 507.90 kB, vượt trần `.claude/docs/coding-standards.md`). `apps/web/vite.config.mts` thêm `build.rollupOptions.output.manualChunks` tách 8 thư viện dùng chung toàn app (react/react-dom/react-router/@tanstack/react-query/zod/zustand/openapi-fetch) thành chunk `vendor` riêng, không đụng cơ chế lazy theo route đã có.

2 lần thử sai trước khi ra bản đúng (gộp mọi `node_modules` hoặc thêm cả `@phosphor-icons/react` vào regex đều làm `vendor` phình to hơn vì kéo cả lib chỉ dùng ở 1-2 trang lazy vào chung chunk eager) — regex cuối cùng chỉ khớp đúng 8 package trên. Kết quả: `vendor` 338.51 kB + `index` 169.26 kB, tổng không đổi so với trước (507.77 kB ≈ 507.90 kB), hết cảnh báo build.

**Đã xác minh thật**: build web hết cảnh báo "Some chunks are larger than 500 kB", `pnpm -w typecheck/lint/build` sạch toàn workspace, `apps/api` 820/820 (1 flake `icd10-http.spec.ts` đã biết, pass riêng), `apps/web`/`packages/shared`/`packages/core` test pass — thuần cấu hình build, không đổi runtime. Xem chi tiết `docs/DECISIONS.md` #154.

## 2026-09-16 (5)

### Seed master data cho Điều kiện bảo quản (STORAGE_CONDITION)

Chủ dự án gửi `Dieukienbaoquan.md` (8 dòng, cùng khuôn cột như 3 file đã seed ở #152), yêu cầu nạp đầy đủ mọi cột vào category `STORAGE_CONDITION` (đã tạo từ #151, chưa seed cứng). Giữ nguyên mapping đã chốt ở #152 dù file nguồn tự gắn nhãn cột khác (`name`=Tên ngắn UI, `fullName`=Tên đầy đủ chuẩn).

Copy byte-for-byte vào `docs/data/dieu-kien-bao-quan.md`. `packages/core/src/reference-catalog/data.ts` thêm `STORAGE_CONDITION_ITEMS` (8 dòng, S01-S07 + S99). `seed-reference-catalog.ts` thêm 1 vòng lặp upsert theo `(category, code)`. `ReferenceCatalogPane.tsx` thêm `STORAGE_CONDITION` vào `BYT_TAXONOMY_CATEGORIES`/`BYT_TAXONOMY_DESCRIPTION_CATEGORIES` — hiện cột "Mã BYT"/"Tên đầy đủ chuẩn"/"Mô tả" CHỈ ĐỌC, đúng khuôn 3 category #152. Không migration mới.

**Đã xác minh thật**: `packages/core` `data.spec.ts` +1 test (191/191), `apps/api` 820/820 pass (1 flake `icd10-http.spec.ts` đã biết, pass riêng), `pnpm -w typecheck/lint/build` sạch toàn workspace. `db:seed` chạy thật trên Postgres dev, query trực tiếp qua Prisma xác nhận đúng 8 dòng active đủ 5 cột khớp file gốc. Xem chi tiết `docs/DECISIONS.md` #153.

## 2026-09-16 (4)

### Seed master data cho Nhóm tác dụng dược lý / Đường dùng thuốc / Dạng bào chế

Chủ dự án gửi 3 file chuẩn hoá theo Bộ Y tế/BHYT (`NhomTacDungDuocLy.md`/`DuongDungThuoc.md`/`DangBaoChe.md`), yêu cầu nạp vào 3 category `reference_catalog` đã tạo trước đó nhưng chưa seed cứng (`DRUG_GROUP`/`DRUG_ROUTE`/`DOSAGE_FORM`).

Mỗi file có 4-5 cột (Mã UI/Mã BYT/Tên ngắn UI/Tên đầy đủ chuẩn/Mô tả) nhưng bảng chỉ có `code`/`name` — chốt qua 2 vòng `AskUserQuestion` (vòng 2 sau phản hồi trực tiếp của chủ dự án khi thấy thiếu cột): nạp ĐẦY ĐỦ, không bỏ cột nào. Thêm 2 cột mới `byt_code` (mã liên thông BHYT, Quyết định 130/QĐ-BYT — chuẩn bị tích hợp sau này) và `full_name` (tên đầy đủ chuẩn ngành) — CHỈ có ý nghĩa với 3 category này. Cột `description` có sẵn mở rộng sang lưu "Mô tả/Ví dụ" cho DRUG_ROUTE/DOSAGE_FORM (DRUG_GROUP không có cột này ở nguồn).

2 migration `20260916150000_reference_catalog_byt_code` → `20260916160000_reference_catalog_full_name`. Seed 28 Nhóm tác dụng dược lý + 18 Đường dùng + 16 Dạng bào chế (`docs/data/nhom-tac-dung-duoc-ly.md`/`duong-dung-thuoc.md`/`dang-bao-che.md`, copy byte-for-byte) — upsert idempotent theo `(category, code)`, đúng khuôn `OCCUPATION_ITEMS`.

Sau phản hồi trực tiếp của chủ dự án (ảnh chụp bảng "Nhóm thuốc" chưa thấy 2 cột mới), đã bổ sung hiển thị ở `ReferenceCatalogPane.tsx`: cột "Mã BYT" + "Tên đầy đủ chuẩn" cho cả 3 category, cột "Mô tả" mở rộng thêm cho DRUG_ROUTE/DOSAGE_FORM — tất cả CHỈ ĐỌC (seed luôn đồng bộ lại theo nguồn, không có ô nhập ở form). `openapi:generate`/`api:codegen` chạy lại.

**Đã xác minh thật**: `packages/core` `data.spec.ts` +3 test (193/193), seed chạy 2 lần xác nhận idempotent qua query DB trực tiếp (28/18/16 dòng active, đủ 5 cột khớp file gốc), `apps/api` 809/820 pass (1 flake `icd10-http.spec.ts` đã biết, không liên quan), `pnpm -w typecheck` sạch toàn workspace, `apps/web` typecheck/build sạch. Playwright qua Chrome thật xác nhận cả 3 bảng hiện đúng cột mới (ảnh chụp "Dạng bào chế" đủ 16 dòng F01-F99). Xem chi tiết `docs/DECISIONS.md` #152.

## 2026-09-16 (3)

### Rà soát Kho Thuốc theo tài liệu quy chuẩn quản lý VTYT — Rx/OTC, phân loại kiểm soát, 8 trường Thuốc, danh mục hoá + "thêm nhanh"

Chủ dự án gửi tài liệu tham khảo quy chuẩn quản lý kho thuốc/VTYT, yêu cầu đối chiếu với schema GĐ1 trước khi làm GĐ2. Đối chiếu field-by-field, báo cáo, rồi chốt qua nhiều vòng hỏi đáp + phản hồi trực tiếp qua chat: **VTYT giữ nguyên hoãn**; **Thuốc** bổ sung đầy đủ.

**Phân loại kiểm soát đặc biệt + Rx/OTC**: enum mới `drug_control_type` (Thông tư 20/2017/TT-BYT) — CỐ ĐỊNH, không dùng `reference_catalog`. `drug.control_type`/`drug.is_prescription_only` (default an toàn, CHỈ có ý nghĩa với Thuốc). Badge màu theo mức nghiêm trọng trong danh sách/chi tiết.

**Rà soát "bắt buộc"**: `defaultSellPrice`/`manufacturerCode` bắt buộc cả 2 loại; `drugGroupCode`/`routeCode`/`ingredients[]`/`registrationNumber`/`dosageForm`/`countryOfOrigin` bắt buộc CHỈ Thuốc. Thêm 8 trường Thuốc mới: SĐK lưu hành/Dạng bào chế/Nước sản xuất (bắt buộc), Liều dùng mặc định/Cách dùng/Chống chỉ định/Điều kiện bảo quản/Vị trí lưu kho/Mã vạch (tùy chọn).

**Danh mục hoá + "thêm nhanh"**: 5 category `reference_catalog` mới (Dạng bào chế/Điều kiện bảo quản/Hãng sản xuất/Nước sản xuất/Vị trí lưu kho) — Hãng sản xuất kế thừa `drug.manufacturer` (text, S4-03), dữ liệu cũ backfill thành danh mục qua migration. `Combobox` dùng chung mở rộng `allowCreate`/`onCreateOption` — gõ không khớp hiện "+ Thêm mới", tạo ngay tại ô chọn không cần rời form.

4 migration mới, `DrugCatalogPane.tsx` thêm KHỐI 4 "Hướng dẫn sử dụng & Bảo quản", `PharmacyCatalogPage.tsx` thêm 5 pill quản lý.

**Đã xác minh thật**: `drug-http.spec.ts` 30/30, `apps/api` 820/820 (53 file), `pnpm -w typecheck/lint/build` sạch, chunk khởi động web không đổi (507.90 kB — đo lại bằng git worktree baseline, phát hiện số liệu cũ trong docs đã lệch thực tế). Playwright qua Chrome thật xác nhận toàn bộ luồng "thêm nhanh" + hiển thị đúng tên (không phải mã) + ẩn/hiện đúng theo loại mặt hàng. Xem chi tiết `docs/DECISIONS.md` #151.

## 2026-09-16 (2)

### "Giá bán theo từng đơn vị cụ thể" — mở rộng tiếp GĐ1 Kho Thuốc & Vật tư y tế

Chủ dự án yêu cầu xem lại phần "Giá bán" trước khi làm tiếp GĐ2. Thêm công tắc THEO TỪNG MẶT HÀNG (`drug.unit_pricing_enabled`, mặc định tắt): tắt thì giá mỗi bậc quy đổi suy ra theo tỷ lệ từ `default_sell_price` (hành vi cũ); bật thì mỗi bậc — kể cả đơn vị nhỏ nhất — có giá riêng lưu ở `drug_unit.sell_price`, bắt buộc nhập đủ mọi bậc.

Migration `20260916090000_drug_unit_pricing`. `packages/shared/src/drug.ts` thêm validate `checkUnitPricingRequired` (superRefine). Backend `apps/api/src/modules/drug/` wiring đầy đủ, không permission mới. Frontend `DrugCatalogPane.tsx`: công tắc + ô giá riêng từng dòng quy đổi + panel chi tiết hiện breakdown giá theo đơn vị. Sửa 1 lần theo phản hồi trực tiếp: nhãn "Giá bán mặc định" đổi động thành "Giá bán (tên đơn vị nhỏ nhất)" khi bật công tắc, tránh hiểu lầm chữ "mặc định".

**Đã xác minh thật**: `drug-http.spec.ts` +4 test (16/16), `pnpm -w typecheck/lint` sạch toàn workspace, Playwright qua Chrome thật (bật/tắt công tắc, validate chặn thiếu giá, panel chi tiết hiện đúng giá riêng không suy ra theo tỷ lệ). Xem chi tiết `docs/DECISIONS.md` #150.

## 2026-09-16 (1)

### GĐ1 Kho Thuốc: đồng bộ tài liệu cấu trúc + redesign sidebar + 3 bug thật

Làm nốt việc treo từ #148 (đồng bộ tài liệu), sau đó chủ dự án phản hồi trực tiếp trên bản chạy thật qua nhiều lượt liên tiếp.

**Đồng bộ tài liệu**: cập nhật `CLAUDE.md`, `.claude/docs/architecture.md`, `.claude/docs/data-model.md`, `docs/ERD.md` (v1.48), `docs/product/prd.md` (v1.4, mục 4.8 mới INV-01→05), `docs/product/plan.md` (v1.1) cho Giai đoạn 1 Kho Thuốc & Vật tư y tế.

**Redesign sidebar**: chuyển 3 pill (Hoạt chất/Nhóm thuốc/Đường dùng) sang trang "Danh mục Thuốc và Vật Tư"; tạo 2 nhóm sidebar mới "Quản lý kho" (chứa "Danh mục Thuốc và Vật Tư", route giữ nguyên) và "Quản lý nhà cung cấp" (tách "Nhà cung cấp" thành trang riêng mới `/suppliers`) — cả hai đặt dưới "Sổ quỹ & Thu chi", tách khỏi nhóm "Quản trị" cũ. Sửa kèm 1 lỗi tiềm ẩn: nhóm "Quản trị" tự mở nhầm do so khớp tiền tố `/admin` quá rộng.

**3 bug thật phát hiện lúc chủ dự án dùng thử `DrugCatalogPane.tsx`** (đã xác nhận sửa đúng qua Playwright + Chrome thật):
1. Chuỗi quy đổi đơn vị hiện MÃ (`DV00015`) thay vì TÊN (`Hộp`) — thiếu tra `unitOptions`/`unitNameByCode`.
2. Đổi công thức hiển thị theo yêu cầu: từ quy đổi thẳng về đơn vị nhỏ nhất sang tuần tự từng bậc liền kề (`1 Hộp = 5 Vỉ · 1 Vỉ = 20 Viên`).
3. Header modal "Thêm thuốc"/"Thêm vật tư y tế" dính sát mép — thiếu khối bọc padding cho `ModalHeader` ở bố cục 3 vùng (header/nội dung cuộn/footer cố định), khác 2 modal Kho/Nhà cung cấp (bố cục đơn giản hơn, không dính).

**Đã xác minh thật**: `pnpm -w typecheck/lint` sạch toàn workspace, Playwright qua Chrome thật (nhiều kích thước cửa sổ). Không có migration/schema/permission nào đổi. Xem chi tiết `docs/DECISIONS.md` #149.

## 2026-09-15 (6)

### Kho Thuốc & Vật tư y tế — Giai đoạn 1: code xong (schema + backend + frontend), verify Playwright thật

Tiếp ngay sau khi chốt kế hoạch 5 giai đoạn (#146) và duyệt mockup GĐ1 (2 vòng chỉnh trực tiếp: panel chi tiết đổi từ "xổ trong bảng" kiểu KiotViet sang panel trượt phải; nút "Thêm mặt hàng" đổi từ 2 nút cạnh nhau sang 1 nút + menu xổ ra). Câu hỏi treo duy nhất của mockup (vị trí sidebar) chốt: dùng lại chỗ "Danh mục thuốc" cũ trong nhóm "Quản trị", không tách nhóm riêng.

**Schema** — migration `20260915140000_pharmacy_catalog_gd1` (viết tay, môi trường không có TTY): mở rộng `drug` (`item_type` MEDICINE/SUPPLY, `is_batch_managed`, `base_unit_code`, `default_sell_price`, `drug_group_code`, `route_code`, `national_code`, `manufacturer`, `min_stock_alert`, `max_stock_alert` — cột cũ giữ nguyên làm dữ liệu legacy). 4 bảng mới: `drug_unit` (chuỗi quy đổi N bậc), `drug_ingredient` (hoạt chất & hàm lượng, sửa lỗ hổng "thuốc phối hợp bị bỏ sót cảnh báo trùng hoạt chất" ở tầng dữ liệu), `supplier`, `warehouse` (seed "Kho chính" tự động). 3 category `reference_catalog` mới (`ACTIVE_INGREDIENT`/`DRUG_GROUP`/`DRUG_ROUTE`) — đơn vị tái dùng category `UNIT` có sẵn.

**Backend**: mở rộng module `drug` (không tạo module `pharmacy` riêng). `DrugController/Service/Repository` mở rộng bulk-replace hoạt chất/đơn vị trong cùng transaction. `SupplierController/Service/Repository`, `WarehouseController/Service/Repository` mới — dùng chung `drug.read`/`.manage`, không permission mới. Mã Nhà cung cấp/Kho tự sinh ngắn (`NCC`/`KH`, đúng khuôn `work_shift`).

**Frontend**: `PharmacyCatalogPage.tsx` (3 pill: Thuốc & Vật tư/Nhà cung cấp/Kho), `DrugCatalogPane.tsx` viết lại theo mockup đã chốt, `SupplierPane.tsx`/`WarehousePane.tsx` mới, 3 pill mới trong "Danh mục dùng chung" (Hoạt chất/Nhóm thuốc/Đường dùng, tái dùng `ReferenceCatalogPane.tsx`).

**Cố ý hoãn**: nâng cấp cảnh báo trùng hoạt chất (PRE-02) sang so theo mã — đụng luồng kê đơn đang chạy thật tại pilot, để dành việc riêng.

**Đã xác minh thật**: `packages/core` 193/193 (+6), `apps/api` 820/820 (+18), `packages/shared` 20/20, `apps/web` 5/5, `pnpm -w lint/typecheck/build` sạch (chunk khởi động 500.01 kB, vượt trần 10 byte — ghi vào `docs/CURRENT.md`). Playwright qua Chrome thật xác nhận toàn bộ luồng CRUD 3 pill + panel chi tiết + menu thêm mặt hàng, 0 lỗi console. Xem chi tiết `docs/DECISIONS.md` #148.

**Còn treo**: đồng bộ tài liệu cấu trúc (`CLAUDE.md`/`architecture.md`/`data-model.md`/`ERD.md`/`prd.md`/`plan.md`) cho GĐ1 — việc đầu tiên của phiên kế tiếp, trước khi làm GĐ2.

## 2026-09-15 (5)

### Kho Thuốc & Vật tư y tế — chốt hướng mở rộng v1, kế hoạch 5 giai đoạn (chưa code)

Chủ dự án yêu cầu xây phân hệ kho thuốc/VTYT dựa trên 4 tài liệu tham khảo (mâu thuẫn nhau ở vài điểm cấu trúc) — đối lập với `CLAUDE.md`/quyết định Sprint 4 (2026-08-25) từng giữ v1 ở mức "kê đơn không kho". Đã hỏi và xác nhận đảo hướng qua nhiều vòng `AskUserQuestion`: đưa vào v1 ngay, mô hình quầy thuốc tuỳ phòng khám, phạm vi đầy đủ. Lập kế hoạch 5 giai đoạn qua `EnterPlanMode` (mở rộng `drug` sẵn có thay vì bảng `items` mới, chuỗi quy đổi đơn vị N bậc, thẻ kho append-only làm nguồn sự thật, nguyên tắc "đơn thuốc là y lệnh — chỉ Phiếu xuất kho mới sinh tiền/trừ kho"). Mockup Giai đoạn 1 (Danh mục Thuốc & Vật tư, panel chi tiết kiểu KiotViet) đã qua 4 vòng chỉnh sửa. **Chưa viết code nghiệp vụ nào** — xem đầy đủ `docs/DECISIONS.md` #146.

### Cổng Đơn thuốc quốc gia — thêm port rỗng `EPrescriptionGatewayPort`

Đối chiếu đặc tả API chính thức (QĐ 808) với schema hiện có — phát hiện 2 điều kiện chặn cứng (chữ ký số CA thật, đăng ký mã liên thông thủ công) khiến đây đúng là hạng mục v3 (BHYT + chữ ký số) theo `prd.md` Appendix A. Chủ dự án xác nhận chưa đăng ký với cổng, nên chỉ thêm 1 port rỗng (đúng khuôn `InsuranceGatewayPort`) để chỗ sẵn, không thêm cột schema nào. **Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch, chunk web không đổi (499.96 kB). Xem `docs/DECISIONS.md` #147.

## 2026-09-15 (4)

### S6-01 — Hoàn tất verify Playwright banner cảnh báo sao lưu

Việc treo duy nhất còn lại của S6-01 (#141): banner `BackupStatusBanner.tsx` trước đây chỉ verify qua Docker thật + HTTP e2e, chưa qua trình duyệt thật. Hoá ra không cần dựng container `backup` thật như dự tính — `LocalFileBackupStatusAdapter` chỉ đọc file JSON tại `BACKUP_STATUS_FILE` mỗi request, không quan tâm ai ghi ra file đó. Đặt tạm biến này trỏ 1 file JSON tay + khởi động lại API dev, rồi dùng Chrome thật (Playwright) đăng nhập `dev.admin`, lần lượt ghi đè file JSON theo 4 kịch bản + `page.reload()`.

**Đã xác minh thật**: cả 3 lý do cảnh báo (`LAST_RUN_FAILED`/`STALE`/`NEVER_RUN`) hiện đúng banner đỏ + đúng nội dung, trạng thái lành mạnh ẩn banner đúng, không lỗi console. Đã khôi phục `.env`/API về đúng baseline sau khi kiểm. Không đổi code/schema. Xem chi tiết `docs/DECISIONS.md` #145.

## 2026-09-15 (3)

### S6-06/07/08 — Xuất bệnh án PDF, tài liệu xử lý sự cố, checklist GA v1

Sprint 6 làm nốt 3 việc không cần máy chủ pilot thật (còn lại S6-02/S6-04 cần pilot thật).

**S6-06 (ADM-05, P1)** — "Xuất bệnh án PDF" sinh PDF THẬT ở backend (`puppeteer-core` + Chromium hệ thống, port mới `PdfRendererPort` — port thứ 9 của dự án), gồm toàn bộ hồ sơ bệnh nhân (hành chính + tiền sử + mọi lượt khám đã hoàn tất). Permission riêng `patient.export_medical_record` (mặc định `doctor`/`clinic_admin`, khác `patient.read` cấp cho cả 4 vai trò lâm sàng — nội dung PDF nhạy cảm hơn KPI tóm tắt). `POST /encounters/patient-medical-record/export` — lý do xuất bắt buộc ở BODY (không phải query string, tránh lộ PII/PHI qua URL/log). Nút "Xuất bệnh án PDF" ở đầu trang "Hồ sơ bệnh nhân". Sửa `apps/api/Dockerfile` (thêm `chromium` qua apt) + `deploy/on-prem/docker-compose.yml` (`CHROMIUM_EXECUTABLE_PATH`).

Bug hiệu năng thật phát hiện lúc build (không phải lúc dùng thử): mở rộng hàm tải file dùng chung để hỗ trợ POST đẩy chunk khởi động web vượt 500kB lần đầu tiên — sửa bằng viết logic tải riêng cho tính năng này trong chunk lazy của trang bệnh nhân thay vì sửa hàm dùng chung, chunk khởi động về lại dưới ngưỡng (499.96 kB).

**S6-07** — `docs/troubleshooting.md` mới: xử lý sự cố thường gặp cho nhân viên phòng khám không rành IT (khác `docs/Deploy.md` cho người cài đặt kỹ thuật), dựa trên sự cố thật đã gặp trong các phiên trước.

**S6-08** — `docs/GA-checklist.md` mới: theo dõi sống điều kiện gate GA v1 + chỉ số PRD, phần lớn còn `[ ]` chờ dữ liệu pilot thật.

**Đã xác minh thật**: `packages/core` +4 test, `apps/api` +5 test HTTP e2e dùng Chromium thật (không mock) — 781/792 test pass (1 flake đã biết, không liên quan). `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 499.96 kB. Boot thật `node dist/main.js` xác nhận DI wiring đúng.

**Verify Chrome thật hoàn tất cùng ngày** (`puppeteer-core` trỏ Chrome cài sẵn): nút "Xuất bệnh án PDF" đúng cho bác sĩ, ẩn đúng cho lễ tân (không có quyền) — xác nhận RBAC frontend qua UI thật. Request thật trả đúng PDF, byte khớp chính xác với server sinh ra. Phát hiện + sửa 1 sự cố vận hành quen thuộc (permission mới chưa `pnpm db:seed`). 1 giới hạn công cụ kiểm thử (Chrome huỷ bước lưu file `blob:` khi click tự động qua CDP) đã xác nhận KHÔNG phải lỗi sản phẩm bằng đối chứng với "Xuất Excel" có sẵn — bị ảnh hưởng giống hệt. Xem chi tiết `docs/DECISIONS.md` #144.

## 2026-09-15 (2)

### S6-05 — Lưu nháp offline cho form khám (ENC-06)

Autosave ghi chú SOAP (mỗi 4 giây) và lưu chẩn đoán (ngay mỗi lần đổi) trước đây IM LẶNG nuốt lỗi khi mất mạng — không có lưới an toàn phía client, có thể mất trắng nội dung nếu đóng trình duyệt lúc offline. Thêm: phát hiện lỗi mạng thật (`isNetworkError()`, phân biệt với lỗi nghiệp vụ server trả về) → lưu nháp vào `localStorage` (`shared/offline-draft-storage.ts`, dùng chung) → banner amber "Mất mạng — đã lưu tạm..." → tự đồng bộ khi có mạng lại (`shared/hooks/useOnlineRetry.ts`, sự kiện `online` + retry 15s) hoặc ngay lúc mở lại trang (khôi phục từ `localStorage`, ưu tiên hơn dữ liệu server).

**Bug hạ tầng thật phát hiện lúc verify Playwright**: TanStack Query v5 mặc định `networkMode: 'online'` khiến `mutateAsync()` TREO VÔ THỜI HẠN khi `navigator.onLine=false` (không throw, không resolve) thay vì reject nhanh như fetch thật (~30ms đã đo) — vô hiệu hoá hoàn toàn cơ chế phát hiện lỗi mạng. Sửa bằng `networkMode: 'always'` cho đúng 2 mutation liên quan (`useSaveClinicalNoteMutation`/`useSaveDiagnosesMutation`). Cũng phát hiện + sửa bug version-staleness: gọi đồng bộ ngay sau khi nạp dữ liệu server đọc nhầm state React CŨ (chưa kịp áp dụng qua re-render), gửi `version: undefined` cho section đã tồn tại → 500 lỗi unique constraint.

**Đã xác minh thật qua Playwright + Chrome thật** (không giả lập, dùng `context.setOffline()`): gõ ghi chú/thêm chẩn đoán lúc mất mạng → banner hiện đúng trong ~5s, `localStorage` chứa đúng nội dung; đóng tab lúc offline, có mạng lại, mở lại trang → tự khôi phục + tự đồng bộ, xác nhận dữ liệu đúng trên server qua API. `pnpm -w typecheck/lint/build` sạch, chunk web không đổi (499.93 kB). Xem chi tiết `docs/DECISIONS.md` #143.

## 2026-09-15

### S6-03 — Rà soát bảo mật đầy đủ theo checklist `.claude/docs/security-audit.md`

Rà soát toàn diện bằng 2 agent Explore song song + tự kiểm chứng lại các phát hiện quan trọng. Phần lớn hệ thống PASS (mã hoá PII, cấm xoá cứng, JWT/Argon2id/khoá tài khoản, break-glass, audit log DB grant, không hardcode role ở backend...). Sửa 4 lỗ hổng/vi phạm thật:

1. **Rate limit tra cứu bệnh nhân** — `GET /patients`, `/check-duplicate`, `/by-phone`, `/by-national-id` trước đây không giới hạn, có thể dò CCCD/SĐT/mã bệnh nhân bằng cách quét. Thêm throttler `patient-lookup` (50 request/phút/IP, `iam.module.ts`).
2. **`CashVoucherRepository.list()` không giới hạn** — bỏ trống `from`/`to` trả về toàn bộ lịch sử thu-chi của tenant. Mặc định 90 ngày gần nhất khi bỏ trống (`CashVoucherService.resolveDateRange()`, dùng `toVietnamDateParts`).
3. **Export không ghi audit log** — 3 endpoint `cash-book/*/export` + `work-shift-assignments/export` không ghi gì. Thêm `recordExportAudit()` ở 2 service liên quan.
4. **3 chỗ hardcode `'doctor'` ngoài `workflow-roles.ts`** (`TopBar.tsx`, `RoomSessionGate.tsx`, `clinic.queries.ts`) — xác nhận qua `docs/DECISIONS.md` #054/#094 đây đều là quyết định nghiệp vụ có chủ ý (không phải bug), gom về hằng số mới `DOCTOR_ONLY_ROLES` (khác `DOCTOR_QUEUE_ROLES`) để không lệch nguồn như sự cố #119.

**Đã xác minh thật**: 8 test HTTP mới (rate limit 429 thật, mặc định/tường minh phạm vi ngày, audit log export cả 4 endpoint), `apps/api` 787/787 pass, `pnpm -w typecheck/lint/build` sạch, chunk web 499.88 kB. Xem chi tiết `docs/DECISIONS.md` #142.

### Verify Playwright — mở rộng "Thông tin phòng khám" (#140)

Verify hoàn tất qua Chrome thật: sửa+lưu đủ 7 trường mới (Mã cơ sở KCB/Số giấy phép/Người chịu trách nhiệm chuyên môn/Website/1 dòng Mạng xã hội/Tên tài khoản+Số tài khoản+Ngân hàng), PATCH trả đúng dữ liệu, F5 giữ nguyên, không lỗi console. Phát hiện 1 sự cố môi trường (không phải bug sản phẩm): tiến trình `pnpm dev` (api :3001) đang chạy là bản cũ chưa nạp code #140/#141 sau lần dừng tạm để regenerate Prisma Client — khởi động lại tiến trình thì đúng ngay. Dữ liệu test đã dọn sạch khỏi tenant dev qua UI thật. Xem `docs/DECISIONS.md` #140.

## 2026-09-14 (5)

### S6-01 — Sao lưu tự động: cảnh báo khi thất bại/trễ hạn (ADM-04)

Sprint 6 (Triển khai và GA) bắt đầu — S6-01. `deploy/on-prem/backup/backup.sh` đã có lịch chạy hằng ngày từ S4-05 nhưng chỉ ghi log Docker, không ai theo dõi. Thêm: ghi trạng thái sau mỗi lần chạy ra file JSON (volume dùng chung với container `api`), banner đỏ toàn cục cho `clinic_admin` khi lần chạy gần nhất thất bại HOẶC quá 30 giờ chưa có lần thành công nào — bắt cả lỗi rõ ràng lẫn tình huống "im lặng" (container backup bị dừng/crash).

Port mới `BackupStatusPort` (`packages/core`), endpoint `GET /backup-status` (tái dùng `clinic_config.read`). Máy dev không đặt biến `BACKUP_STATUS_FILE` nên banner tự tắt, không cảnh báo giả.

**Đã xác minh thật**: `packages/core` 7/7, `apps/api` 12/12 test mới (adapter + HTTP e2e), Docker thật (build ảnh backup, chạy container join network Postgres dev — xác nhận thành công/thất bại/giữ `lastSuccessAt` qua nhiều lần chạy đều đúng). `pnpm -w typecheck/lint/build` sạch, chunk khởi động 499.86 kB (banner đã lazy). Xem chi tiết `docs/DECISIONS.md` #141.

## 2026-09-14 (4)

### Mở rộng "Thông tin phòng khám" — Mã cơ sở KCB, Giấy phép, Người chịu trách nhiệm chuyên môn, Website, Mạng xã hội, Tài khoản & Thanh toán

Thêm loạt trường mới vào trang "Thông tin phòng khám": Mã cơ sở khám chữa bệnh, Số giấy phép hoạt động (tái dùng cột `licenseNo` có sẵn), Người chịu trách nhiệm chuyên môn, Website — thêm vào khung "Thông tin cơ bản" hiện có. Khung mới "Mạng xã hội" (nhiều dòng, mỗi dòng chọn Nền tảng + Link, bấm "+" thêm dòng) và khung mới "Thông tin tài khoản & Thanh toán" (Tên tài khoản ngân hàng/Số tài khoản/Ngân hàng). Không kiểm định dạng URL cho Website/link mạng xã hội (giống cách xử lý SĐT/Mã số thuế hiện tại).

Migration `20260914130000_tenant_profile_extended_fields` (7 cột mới trên `tenant`, không permission mới). Icon nền tảng mạng xã hội đổi từ cờ emoji Unicode (đã thử trước đó, không hiển thị đúng trên Windows/Chrome) sang icon SVG thật của `@phosphor-icons/react`.

**Đã xác minh thật**: `apps/api` `clinic-profile-http.spec.ts` 18/18 pass (mở rộng 2 test), `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk khởi động không đổi (499.41 kB). Xem chi tiết `docs/DECISIONS.md` #140.

### Cờ tiền tệ dạng icon SVG thay text 2 chữ cái

Cờ Unicode (🇻🇳/🇺🇸...) trước đây hiện thành text 2 chữ cái trên Windows/Chrome (hệ điều hành không có glyph cờ). Đổi sang `country-flag-icons` (SVG nhúng lúc build, không phụ thuộc CDN/font hệ điều hành). `Combobox.tsx` (shared) thêm field `icon?: ReactNode` tuỳ chọn cho `ComboboxOption` — hiện cả ở danh sách xổ xuống lẫn ô đã chọn (ô input chỉ nhận text nên icon là 1 phần tử `absolute` đè lên). Áp dụng cho combobox "Đơn vị tiền tệ" ở "Thông tin phòng khám".

**Đã xác minh thật**: `pnpm -w typecheck/lint/build/test` sạch toàn workspace, chunk khởi động không đổi (499.41 kB — `country-flag-icons` chỉ nằm trong chunk lazy `ClinicConfigPage`).

## 2026-09-14 (3)

### Chuỗi chỉnh sửa trực tiếp sau "Chế độ phòng khám 1 người" (#138)

Đổi tên "Chế độ phòng khám 1 người" → "Chế độ xử lý nhanh" (bỏ badge "MỚI"). Vá 3 bug thật phát hiện lúc dùng thử: lặp tên "BS. BS." ở khối tổng kết ca khám, khung 5 ô KPI tràn ra ngoài viền (thiếu `min-w-0`, đổi sang lưới đều 5 cột), icon check quá nhỏ dễ vỡ nét ở màn xác nhận. Làm nổi bật khung "Có ca thu ngân đang mở", bỏ chữ thừa "(chủ phòng khám / kế toán)", tăng cỡ chữ 2 khung ghi chú xác nhận.

**Tách "In phiếu" thành màn riêng** cho cả 2 luồng chốt ca (mặc định lẫn "Chế độ xử lý nhanh") — màn thành công giờ chỉ còn nội dung xác nhận, bấm "In phiếu" mới mở dialog riêng chứa phiếu in.

**Redesign màn thành công "Chốt ca" mặc định thành "bảng tóm tắt Chốt ca"** — mockup Artifact duyệt 3 vòng (dọc → lưới 2 cột → giãn ngang đúng bề rộng dialog thật) trước khi code: dòng xác nhận gọn + lưới 2 cột lớn (trái: doanh thu ca + thông tin ca, phải: lưới 3×2 chi tiết tiền + dòng "Nộp về" nổi bật). Trích 2 hàm tính dùng chung với phiếu in, tránh trùng công thức.

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch, chunk web không đổi (499.40 kB), Playwright qua Chrome thật cả 2 luồng (khớp số lẫn có chênh lệch để xác nhận màu đỏ). Xem chi tiết `docs/DECISIONS.md` #139.

## 2026-09-14 (2)

### "Chế độ phòng khám 1 người" (Solo Clinic Workflow)

Phòng khám chỉ 1 người (bác sĩ tự làm Tiếp nhận/Khám/Thu ngân) bật công tắc mới `soloClinicWorkflowEnabled` (mặc định TẮT, "Cấu hình thanh toán") — bấm "Đóng ca hôm nay" mở 1 màn hình gộp "Kết thúc ngày làm việc" (Tổng kết ngày → Kiểm đếm tiền mặt → Đối soát → Hoàn tất) thay vì phải thao tác 3 nơi tách biệt (Đóng ca khám/Chốt ca thu ngân/Duyệt phiếu). Xác nhận cuối cùng chạy tuần tự cả 3 bước, tự động Duyệt nếu actor có quyền. Loại trừ lẫn nhau 2 chiều với "Đa thu ngân". Trích xuất `WizardStepper.tsx`/`CloseShiftSteps.tsx` dùng chung giữa `CloseShiftDialog.tsx` cũ và `EndOfDayDialog.tsx` mới.

Bug thật phát hiện lúc verify Playwright: màn thành công không hiện sau khi hoàn tất (component cha unmount wizard ngay khi ca thu ngân vừa đóng làm query "ca đang mở" trả về null) — đã sửa bằng cách khoá lại ca đã bắt được lần đầu, không phụ thuộc giá trị query sống nữa.

**Đã xác minh thật**: `packages/core` 170/170, `packages/shared` 20/20, `apps/web` 5/5, `apps/api` 770/770 pass, `pnpm -w typecheck/lint/build` sạch (chunk 499.40 kB). Playwright qua Chrome thật xác nhận toàn bộ luồng + toggle khoá chéo, không lỗi console/HTTP. Xem chi tiết `docs/DECISIONS.md` #138.

## 2026-09-14

### Verify Playwright cho Chiết khấu trên "Chi tiết thanh toán" (#137)

Hoàn tất phần verify Playwright tự động còn treo từ #137 (2026-09-09). Dữ liệu test tạo qua HTTP API — xác nhận đúng thiết kế: chiết khấu "Toàn hoá đơn"/"Từng dịch vụ" loại trừ lẫn nhau, tính đúng `dueAmount`, không crash ở kịch bản chọn kiểu rồi rời ô không gõ số (bug 500 cũ đã sửa), F5 giữ đúng số tiền và không tự điền lại "Lý do chiết khấu" cũ, pill mệnh giá + nút "Vừa đủ" đúng, Thu tiền thành công. Không phát hiện bug mới. Xem chi tiết `docs/DECISIONS.md` #137.

## 2026-09-09

### Chiết khấu trên "Chi tiết thanh toán" + pill mệnh giá "Tiền khách đưa"

Thu ngân áp chiết khấu %/tiền cho phiếu thu — "Toàn hoá đơn" hoặc "Từng dịch vụ" (2 cách loại trừ lẫn nhau, chọn 1 cho mỗi phiếu), bắt buộc lý do, chỉ sửa được khi phiếu còn "Chờ thu". Dòng chiết khấu hiện trên cả màn hình lẫn phiếu in. Thêm dãy pill mệnh giá tiền VNĐ (bấm cộng dồn) + nút "Vừa đủ" ở ô "Tiền khách đưa", cộng ô "Nhập số khác" cho khu vực gợi ý nạp Ví tạm ứng (chủ dự án yêu cầu thêm cùng phiên).

Tách `totalAmount` (gross) khỏi `dueAmount` (net, số tiền THẬT thu/hoàn) — sửa lại mọi nơi tính tiền thật (thu tiền, trừ ví, tổng kết cuối ngày, danh sách Thu ngân, cảnh báo huỷ lượt khám...) để dùng `dueAmount`, tránh sai số khi có phiếu chiết khấu. Phát hiện + sửa 1 bug thật lúc code: audit log hoàn tiền trước đây ghi nhầm số gross thay vì số thật đã thu.

**Redesign theo phản hồi trực tiếp trên `pnpm dev`, cùng ngày**: bỏ popup chọn cách chiết khấu, chuyển hẳn sang nhập ngay tại chỗ — mặc định chỉ hiện 2 nút chọn ("Từng dịch vụ"/"Toàn hoá đơn"), chọn 1 mới hiện ô nhập tương ứng (cột riêng trong bảng dịch vụ hoặc ô trong khung thanh toán). `TwoOptionToggle.tsx` mới (công tắc trượt dùng chung) — sửa 1 lần lệch vị trí do tính bằng `%`/`calc()` không đáng tin cậy, chuyển sang đo toạ độ thật (`getBoundingClientRect()`). Vá 1 bug sập 500 thật (đổi %/Tiền qua lại rồi rời ô chưa gõ số gửi lên trạng thái dở dang khiến `BigInt(null)` crash) — có test hồi quy. "Lý do chiết khấu" đổi sang không tự điền lại giá trị cũ mỗi lần tải trang. Xem chi tiết đầy đủ ở `docs/DECISIONS.md` #137.

**Đã xác minh**: `packages/core` 170/170 (+10), `apps/api` 762/762 (+20, gồm test hồi quy bug 500), `packages/shared` 20/20, `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch (chunk 498.71 kB). **Chưa verify Playwright tự động** — xác nhận qua chủ dự án tự dùng `pnpm dev`, phản hồi từng vòng qua ảnh chụp.

### "Ví tạm ứng" (Patient Advance-Payment Wallet) — hoàn tất, verify Playwright xong

Bệnh nhân nộp tiền trước (`patient_wallet`), hệ thống tự cấn trừ (`wallet_transaction`) lúc tiếp nhận nếu đủ số dư — invoice tự `PAID`, vào thẳng hàng đợi khám không qua quầy. Thiếu tiền thì thu ngân xử lý ở phiếu thu: trừ ví/nạp thêm/**trả hỗn hợp** (trừ hết ví + thu phần còn lại tiền mặt/CK trên cùng 1 phiếu, bật qua công tắc `walletMixedPaymentEnabled` mới ở "Cấu hình thanh toán"). Huỷ lượt khám đã trừ ví → hoàn về ví (không hoàn tiền mặt). Tất toán (`clinic_admin`) khoá ví + sinh phiếu chi `PCU`. Trang tổng hợp `/cash-book/wallets`.

Bước 0 mở rộng `Payment` từ 1 dòng/phiếu sang N dòng để hỗ trợ trả hỗn hợp (`revertPayment`/`refund` lặp mọi dòng hiệu lực), có test hồi quy xác nhận luồng cũ không đổi. Module mới `apps/api/src/modules/patient-wallet/`, `apps/web/src/features/patient-wallet/`. Xem chi tiết đầy đủ ở `docs/DECISIONS.md` #136.

**Đã xác minh**: `apps/api` 748/748, `packages/core` 160/160, `packages/shared` 20/20, `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch (chunk 498.53 kB). Playwright qua Chrome thật 18/18 kịch bản pass (nạp ví + in phiếu, auto-deduct đủ/thiếu tiền, trả hỗn hợp tạo đúng 2 dòng Payment, huỷ+hoàn tiền cộng lại đúng số dư, tất toán khoá ví, trang tổng hợp), không lỗi console.

**Bổ sung cùng ngày**: test race điều kiện auto-deduct (2 lượt tiếp nhận cùng bệnh nhân gần như đồng thời, ví chỉ đủ 1 lượt) — 5/5 lần chạy không flaky, không double-spend, không lượt tiếp nhận nào bị fail oan. Đối chiếu 4 KPI trang `/cash-book/wallets` với API — khớp tuyệt đối. Xem `docs/DECISIONS.md` #136.

## 2026-09-08 (7)

### "Bệnh nhân trong ngày" → "Trung tâm Điều phối Tiếp nhận"

Trang `/reception` từ thuần theo dõi trạng thái thành nơi lễ tân điều phối + thống kê, theo mockup HTML chủ dự án gửi (đã hỏi chốt 4 điểm lệch với cấu trúc v1: bỏ "Chờ Cận lâm sàng" ngoài phạm vi → thay "Chờ thanh toán"; điều phối theo Bác sĩ không theo Phòng; "Đổi bác sĩ" chỉ áp dụng khi `CHECKED_IN`; bỏ "Gọi loa" không có hệ thống PA thật).

Backend: permission mới `encounter.reassign`, endpoint `PATCH /encounters/:id/reassign`, `receptionListItemSchema` thêm `dob`/`invoiceStatus`, trích xuất `resolveDoctorDepartmentRouting()` dùng chung Tiếp nhận + Đổi bác sĩ.

Frontend: dải KPI 6 ô, gộp cột Mã LK+Họ tên+Tuổi, badge Trạng thái ưu tiên "Chờ thu" khi chưa thanh toán, cảnh báo "Chờ lâu", panel "Tải theo Bác sĩ" (nêu bật bác sĩ đã đóng ca nhưng còn bệnh nhân gán), dialog `ReassignDoctorDialog.tsx` mới, trích xuất `INVOICE_STATUS_META`.

**Đã xác minh**: `packages/core` 160/160, `apps/api` 725/725 (+9), `apps/web` 5/5, `pnpm -w typecheck/lint/build` sạch (chunk 497.96 kB). Playwright qua Chrome thật với dữ liệu tạo qua HTTP API — đủ 7 kịch bản (chờ khám/chờ lâu/chưa gán/đang khám/đã huỷ/hoàn tất/bác sĩ đóng ca còn bệnh nhân gán). Xem `docs/DECISIONS.md` #135.

## 2026-09-08 (6)

### Bỏ hẳn lỗi 401 /auth/refresh lặp lại mỗi lần tải trang chưa đăng nhập

Chủ dự án hỏi thẳng sau khi xem kết quả verify #133: "không lỗi nào ngoài 401 /auth/refresh sao không xử lý luôn". Nguyên nhân: `AppBootstrap.tsx` gọi `/auth/refresh` vô điều kiện mỗi lần khởi động app kể cả trình duyệt chưa từng đăng nhập — JS không đọc được cookie httpOnly để biết trước, nên request luôn 401 và Chrome tự in lỗi ở tầng mạng.

Thêm cờ nhẹ `nexamed_had_session` (`localStorage`, chỉ `'1'`/không có gì — không phải token, không lộ gì nhạy cảm) trong `auth.store.ts` (set khi `setSession`, xoá khi `clear`). `AppBootstrap.tsx` kiểm cờ này trước khi gọi refresh — không có cờ thì bỏ qua hẳn network call, chuyển thẳng sang trạng thái chưa đăng nhập.

**Đã xác minh qua Playwright/Chrome thật** (3 context riêng biệt): trình duyệt mới → 0 lỗi console; đăng nhập rồi F5 → vẫn giữ phiên, 0 lỗi; đăng xuất rồi tải lại → cờ đã xoá, 0 lỗi. `typecheck/build` sạch, chunk 497.75 kB. Xem `docs/DECISIONS.md` #134.

## 2026-09-08 (5)

### Đổi tên "Danh sách tiếp nhận"→"Bệnh nhân trong ngày" + bổ sung đủ trường "Thông tin hành chính"

Chạy `pnpm -w test` toàn workspace: `packages/shared` 20/20, `packages/core` 157/157, `apps/web` 5/5 pass. `apps/api` 715 test, 2 file fail lúc chạy chung — chạy lại riêng 9/9 pass sạch, xác nhận race điều kiện tiền nhiệm đã biết (`role_permission`/`code_sequence`), không liên quan thay đổi phiên này.

Đổi tên menu con "Danh sách tiếp nhận" → "Bệnh nhân trong ngày" (sidebar, breadcrumb, `h1`, `aria-label` ở `ReceptionListPage.tsx`).

Rà soát lại "Thông tin hành chính" (trang Hồ sơ bệnh nhân) đúng theo form Thêm mới/Sửa (`PatientFormFields.tsx`): tách "Ngày / nơi cấp" thành 2 trường riêng, bổ sung "Năm sinh"/"Tuổi" (thiếu hoàn toàn trước đó), tách địa chỉ gộp 1 dòng thành 4 trường riêng (Tỉnh/Thành phố, Phường/Xã, Số nhà-đường, Khu phố) — tổng 16 trường đúng thứ tự form gốc, đổi nhãn "Số thẻ BHYT"→"Số bảo hiểm" cho khớp chữ dùng trong form.

**Đã xác minh**: `pnpm --filter @nexamed/web run typecheck/build` sạch, chunk không đổi (497.52 kB). Xem `docs/DECISIONS.md` #133.

## 2026-09-08 (4)

### Menu "Hồ sơ Bệnh nhân" mới dưới "Khám bệnh", tách khỏi "Tiếp nhận và Đặt lịch"

Chủ dự án yêu cầu tạo nhóm sidebar mới "Hồ sơ Bệnh nhân" ngay dưới "Khám bệnh", chuyển "Danh sách bệnh nhân" (trước ở trong "Tiếp nhận và Đặt lịch") vào đây, kèm yêu cầu kiểm tra phân quyền không bị lệch sau khi đổi vị trí.

`Sidebar.tsx`: nhóm cha/con mới cùng khuôn các nhóm khác, gate bằng ĐÚNG `canSeePatients` (`patient.read`) đã có sẵn — không đổi permission nào. Xác nhận route guard (`RequirePermissionRoute`) và trang "Vai trò & Phân quyền" (nhóm theo module, không theo vị trí sidebar) hoàn toàn độc lập với cấu trúc menu, nên đổi chỗ menu không ảnh hưởng gì tới việc áp quyền. Cập nhật breadcrumb 3 trang bệnh nhân khớp tên nhóm mới.

Phát hiện + sửa 1 bug hiệu năng lúc code: icon `IdentificationCard` mới đẩy chunk khởi động vượt ngưỡng 500 kB (501.09 kB) vì `Sidebar.tsx` không lazy — đổi sang `FileText` (icon có sẵn trong file), chunk về 497.52 kB.

**Đã xác minh**: `pnpm --filter @nexamed/web run typecheck/build` sạch. Chưa chạy Playwright trong phiên này. Xem `docs/DECISIONS.md` #132.

## 2026-09-08 (3)

### Đối chiếu lại "Hồ sơ bệnh nhân" đúng mockup gốc + tách 3 card sinh hiệu + favicon web app

Chủ dự án phản hồi bản #130 (mục ngay dưới) vẫn chưa khớp mockup đã chốt dù đã sửa 1 vòng. Đọc lại NGUYÊN VĂN HTML của Artifact "Hồ Sơ Bệnh Nhân NEXAMed" (Phương án 4 ★) làm chuẩn thay vì suy luận qua ảnh chụp — phát hiện lưới `lg:grid-cols-5` (bản fix trước) lẽ ra là `lg:grid-cols-4`, header "Thông tin hành chính" thiếu đúng icon `PencilSimple` (có icon-box thừa), và "Tiền sử bản thân & gia đình" phải là 1 card gộp (không phải 2 card compact như màn khám).

**Sửa đúng mockup**: `PatientAdministrativeInfoCard.tsx` (bỏ icon-box, thêm `PencilSimple` mở dialog sửa, `lg:grid-cols-4`), `PatientVitalHistoryTable.tsx` (cột "Ngày khám" đậm hơn các cột khác), `PatientClinicalKpiRow.tsx` (letter-spacing/overflow/nowrap khớp CSS gốc). `PatientHistorySummaryCard.tsx` mới — gộp đúng bố cục mockup (chip Bệnh lý nền/Thói quen 2 cột + bảng Tiền sử gia đình + khung Ghi chú), thay 2 lần gọi `PersonalHistoryCard`/`FamilyHistoryCard` ở trang này (2 component cũ giữ nguyên cho màn Khám bệnh).

**Theo phản hồi trực tiếp tiếp theo** (ghi đè mockup gốc): thêm 2 chỉ số Cân nặng/Chiều cao đo gần nhất, sau đó tách hẳn BMI/Cân nặng/Chiều cao thành 3 card riêng biệt; nhãn/giá trị "Thông tin hành chính" đổi cách phân cấp (nhãn nhạt, giá trị đậm) rồi giảm độ đậm lại sau khi thấy "nét quá đậm"; toàn bộ `font-extrabold` ở dải KPI giảm xuống `font-bold`; thêm icon nhỏ trước tiêu đề cả 3 khung (`IdentificationCard`/`Heartbeat`/`ClipboardText`). Chốt thành quy tắc mới **mục 4.1h `ui-guidelines.md`** ("Card chỉ-xem") để form khác dùng lại đúng, không phải nhắc lại.

**Favicon web app** — trước đây trống hoàn toàn (`apps/web/index.html` chưa từng khai `<link rel="icon">`). Thêm `apps/web/public/favicon.svg` (icon `Stethoscope` của Phosphor, nền tròn `blue-600`), hỏi qua `AskUserQuestion` trước khi chọn hướng thiết kế.

**Dữ liệu test đầy đủ trường** — script dùng-một-lần qua HTTP API thật (không SQL trực tiếp) tạo/cập nhật bệnh nhân "Trần Kiểm Thử Hồ Sơ" đủ CCCD/BHYT/dân tộc/quốc tịch/nghề nghiệp/địa chỉ/người thân/dị nguyên/3 bệnh lý nền-thói quen/2 dòng tiền sử gia đình/6 lượt khám COMPLETED có sinh hiệu tăng dần.

**Đã xác minh**: `pnpm --filter @nexamed/web run typecheck/build` sạch qua từng vòng, chunk web không đổi (496.65 kB). Xem `docs/DECISIONS.md` #131.

## 2026-09-08 (2)

### Rebuild trang chi tiết bệnh nhân thành "Hồ sơ bệnh nhân"

Chủ dự án yêu cầu xây lại `/patients/:id` thành trang hồ sơ giàu thông tin hơn (Hồ sơ bệnh án, Thông tin cá nhân, Lịch sử khám chữa bệnh...). Dùng `/ui-ux-pro-max` dựng mockup Artifact qua nhiều vòng (4 phương án bố cục, đổi hướng giữa chừng từ sidebar dọc sang dải định danh ngang) rồi `EnterPlanMode` lên kế hoạch kỹ thuật trước khi code.

**Bố cục mới**: dải định danh ngang (thay sidebar dọc) + dải KPI 2 tầng xếp chồng (Sinh hiệu gần nhất nổi bật kèm sparkline BMI vẽ tay bằng SVG + 3 chỉ số phụ: Tổng lượt khám/Lần khám gần nhất/Dị nguyên) + tab (chỉ "Thông tin cá nhân" xây đầy đủ đợt này, 2 tab còn lại "Sắp có"). "Sửa hồ sơ" đổi từ sửa-tại-chỗ sang dialog riêng (`PatientEditDialog.tsx`).

**Backend**: 1 endpoint mới `GET /encounters/patient-clinical-summary?patientId=` (module `encounter`, không cần port/import chéo module), gate `patient.read` (global mọi vai trò — cố ý xem đủ mọi bác sĩ, không giới hạn `data_scope=personal` như `encounter.read` ở nơi khác, quyết định áp dụng luôn cho "Lịch sử khám" khi xây ở đợt sau). Không migration.

**Frontend**: trích xuất `AllergyBanner`/`HistoryBoxCard`/`PersonalHistoryCard`/`FamilyHistoryCard` từ `EncounterConsultationPage.tsx` ra `features/patient/` dùng chung (dọn ~150 dòng trùng lặp), gộp `GENDER_LABEL` trùng lặp 3 nơi. 8 component mới cho trang hồ sơ.

**2 bug thật phát hiện lúc chủ dự án xem trực tiếp, đã sửa cùng phiên**: style dải KPI phụ lệch mockup đã duyệt (màu nhãn, bo góc, khoảng đệm — sửa khớp lại chính xác); card "Thông tin hành chính" sót `max-w-5xl` từ bản phác thảo có sidebar, gây trống lớn bên phải ở bố cục full-width mới.

**Đã xác minh thật**: `apps/api` 715/715 test pass (+64 mới cho endpoint mới), `packages/core` 157/157, `packages/shared` 20/20, `apps/web` 5/5. `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 496.65 kB (không phình, không thêm thư viện chart mới). Playwright qua Chrome thật (dữ liệu test tạo qua HTTP API — bệnh nhân, 3 lượt khám hoàn tất, sinh hiệu, dị ứng, 2 tài khoản bác sĩ/điều dưỡng) xác nhận KPI/sparkline/bảng sinh hiệu/badge BMI đúng số liệu thật đối chiếu DB, dialog "Sửa hồ sơ" và "+ Thêm tiền sử" hoạt động đúng, màn Khám bệnh không regress sau khi trích xuất. Xem `docs/DECISIONS.md` #130.

## 2026-09-08

### Dải KPI dãn full-width + "Huỷ phiếu xuyên ca đã chốt" (chỉ clinic_admin) + cảnh báo ca treo qua ngày

Chuỗi phản hồi trực tiếp trên bản chạy thật, tiếp nối #128. 3 việc:

**1. `StatCardRow` dãn full-width** — root thiếu `flex-1` nên không lớn theo wrapper cha dù đã full-width. Mockup Artifact 4 phương án, chốt phương án A (giữ bố cục, chỉ canh giữa). Sửa: thêm `flex-1 min-w-0` + `items-center text-center`; đường phân cách `divide-x` đổi sang `<span>` riêng `h-10 self-center`; số "chốt hạ" (Chênh lệch/Số dư cuối kỳ) đổi `text-slate-900` → `text-blue-600` để phân biệt bằng màu.

**2. "Huỷ phiếu" xuyên ca đã chốt — chỉ `clinic_admin`.** Trước đây không có đường sửa sai nào cho `cash_voucher`/Chuyển quỹ sau khi ca chứa nó đã Chốt. Chốt qua `AskUserQuestion`: chỉ cho Huỷ (không Sửa) rồi lập phiếu mới — đúng triết lý "sửa = bản ghi mới"; quyền tái dùng `cashier_shift.manage` có sẵn, không thêm permission mới. `CashVoucherService.voidVoucher()` tách khỏi `assertEditable()`; `REJECTED`/`isAutoGenerated` vẫn chặn tuyệt đối kể cả admin. Audit `cash_voucher.voided` thêm field `forcedAfterShiftClosed`.

**3. Cảnh báo mềm "ca thu ngân treo qua ngày hôm sau".** `openShift()` trước không kiểm tra mốc ngày — quên Chốt ca thì hôm sau vẫn thu tiền, lặng lẽ cộng dồn vào ca cũ. Chốt cảnh báo mềm, không chặn thu tiền (đúng triết lý cảnh báo-không-chặn). Banner đỏ (`bg-rose-600`, tách màu khỏi nút "Chốt ca"/badge "Chờ thu" amber cạnh đó) ở `InvoiceListPage.tsx` khi ca mở khác ngày hôm nay, kèm giờ mở thật + nút "Chốt ca ngay".

**Đã xác minh thật**: `apps/api` 705/712 test pass toàn suite (2 fail là race điều kiện tiền nhiệm đã biết, không liên quan; `cash-voucher-http.spec.ts` chạy riêng 38/38 sạch). `pnpm -w typecheck/lint/build` sạch toàn workspace. Playwright qua Chrome thật xác nhận cả 3 phần đúng thiết kế, không phát hiện bug — dữ liệu test đã dọn sạch. Xem `docs/DECISIONS.md` #129.

## 2026-09-07 (3)

### Redesign lần 2 dải KPI "Sổ quỹ & Thu chi" — bỏ khuôn thẻ/icon-vòng-tròn "giống AI tạo"

Chủ dự án phản hồi trực tiếp bản redesign lần 1 (mục ngay dưới): "không thích dạng thẻ có badge kiểu này vì nó giống AI tạo quá". Dùng `/ui-ux-pro-max` (domain `style`, nhóm "Financial Dashboard") tra cách phần mềm tài chính thật trình bày số liệu tổng kết — màu sắc gắn vào CHÍNH con số, không trang trí quanh nó bằng thẻ/icon riêng.

`shared/ui/StatCard.tsx` viết lại hoàn toàn: bỏ hẳn khuôn "mỗi số liệu 1 thẻ + icon lồng vòng tròn nền màu + viền trái đậm màu" (khuôn rất phổ biến ở UI do AI sinh ra) — đổi component `StatCard` (từng thẻ) thành `StatCardRow` (nhận mảng `items`, tự dựng **1 dải liền khối chia ngăn bằng đường kẻ mảnh** `divide-x`). Icon giờ nhỏ, phẳng (không lồng vòng tròn), cạnh nhãn. Màu chỉ gắn vào CHÍNH con số (`text-emerald-600`/`text-rose-600` cho Thu/Chi — đúng cách bảng chứng từ trong CÙNG các trang này đã tô màu cột Số tiền, không bịa quy ước mới), số liệu trung tính (Chênh lệch/Số dư) giữ `text-slate-900`. `emphasis` (số liệu "chốt hạ") giờ chỉ tăng cỡ chữ 1 nấc, không còn đổi màu nền/viền riêng. Áp dụng lại cho cả 3 màn hình `CashVoucherListPage.tsx`/`CashFlowReportPage.tsx`/`CashBookPage.tsx`.

**Đã xác minh thật**: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web không đổi bất thường (thuần đổi CSS/markup, không đổi logic). `apps/api` 171/171 test module `cash-book`/`clinic` không regression (đổi thuần frontend, không đụng backend). Playwright qua Chrome thật (dùng lại dev server đang chạy sẵn) xác nhận cả 3 màn hình hiện đúng dải KPI kiểu mới — 1 dải liền khối, không còn thẻ/icon-vòng-tròn riêng lẻ.

## 2026-09-07 (2)

### Redesign dải KPI "Sổ quỹ & Thu chi" (3 màn hình) + Xuất Excel cho "Phiếu thu/chi" và "Sổ quỹ"

Chủ dự án yêu cầu trực tiếp: thiết kế lại dải tổng kết (toolbar + thẻ số liệu) ở "Phiếu thu / Phiếu chi" cho "hiện đại và y tế hơn, có điểm nhấn hơn", sau đó mở rộng sang "Sổ quỹ"/"Báo cáo dòng tiền", cùng lúc thêm "Xuất Excel" cho 2 màn hình còn thiếu (đã có sẵn ở "Báo cáo dòng tiền").

**Thiết kế**: trích xuất `shared/ui/StatCard.tsx` mới (trùng lặp lần 3 giữa 3 trang, đúng ngưỡng phải gộp) — đổi từ nền tô màu nhạt toàn thẻ sang thẻ trắng + viền trái đậm màu theo `tone` + icon trong vòng tròn nhạt màu, cùng ngôn ngữ thị giác với `ShiftStatTile` (`DoctorEndShiftDialog.tsx`, panel mẫu hiện đại nhất trong app, dựng sau khi tra `/ui-ux-pro-max`) thay vì phát minh phong cách mới. Prop `emphasis` cho thẻ "chốt hạ" của dải (Chênh lệch/Số dư cuối kỳ) — đổi nền sang tông nhạt + icon nổi trên nền trắng để tạo phân cấp thị giác, không cần chữ to hơn. Áp dụng cho `CashVoucherListPage.tsx`/`CashFlowReportPage.tsx`/`CashBookPage.tsx`.

**Backend — Xuất Excel mới**: `CashBookExportService` thêm `buildCashVoucherListExcel()`/`buildCashBookLedgerExcel()` (đúng khuôn `buildCashFlowReportExcel()` có sẵn). 2 endpoint mới trên `CashBookReportController` — `GET /cash-book/vouchers/export` (đúng bộ lọc `CashVoucherListPage.tsx` đang xem, quyền `cash_voucher.read` — KHÔNG đòi `cash_voucher.report` như Báo cáo dòng tiền vì đây là tra cứu vận hành, không phải báo cáo quản trị tổng hợp) và `GET /cash-book/ledger/export` (cùng quyền `ledger()`). `CashBookModule` export thêm `CashVoucherService` để `CashBookReportService` gọi lại `list()` có sẵn (tránh chép lại logic tổng kết); `CashBookReportService` thêm `getVoucherExportData()` (gộp `list()` + resolve tên `incomeExpenseTypeCode`/`cashAccountId` qua `REFERENCE_CATALOG_READER_PORT`/`CashAccountRepository`, đúng khuôn `getCashFlowReport()`). Nhãn tiếng Việt cho trạng thái/loại chứng từ khai RIÊNG ở backend (không dùng chung với `apps/web`) — cùng lý do bug bundler đã gặp lặp lại (#032/#091/#114): hằng số từ `packages/shared` không luôn resolve được qua `vite build`.

**Frontend**: `cash-voucher.api.ts`/`cash-book-ledger.api.ts` thêm hàm export tải file thô qua `downloadFile()` (đúng khuôn `cash-flow-report.api.ts`), 2 hook mutation mới. Nút "Xuất Excel" (`variant="secondary"`, icon `DownloadSimple`) thêm vào toolbar `CashVoucherListPage.tsx` (trước "Chuyển quỹ"/"Lập phiếu") và `CashBookPage.tsx` (đối diện bộ lọc, cùng vị trí "Báo cáo dòng tiền").

**Đã xác minh thật**: `cash-book-report-http.spec.ts` +6 test (24/24), `apps/api` 708/708 test pass (1 lần dính flake race cleanup `tenant-fixture.ts` đã biết khi chạy song song ở `drug-http.spec.ts`, pass 100% khi chạy riêng, không liên quan). `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 496.49 kB (không đổi bất thường). Playwright qua Chrome thật (dùng lại dev server đang chạy sẵn): cả 3 màn hình hiện đúng dải KPI mới, 2 nút "Xuất Excel" mới tải file `.xlsx` thành công (`phieu-thu-chi-*.xlsx`/`so-quy-*.xlsx`), không lỗi console ngoài dự kiến.

## 2026-09-07

### "Tự động thu gọn menu khi chuyển trang" — công tắc mới ở "Cấu hình chung"

Chủ dự án yêu cầu trực tiếp: mở rộng hành vi tự thu gọn sidebar (trước chỉ hardcode riêng ở màn hình khám, S3-06) thành tuỳ chọn áp dụng cho MỌI trang, bật/tắt được ở "Cấu hình chung" (pill "Cấu hình phòng khám", `/admin/system-config`). Chốt 3 điểm qua `AskUserQuestion` trước khi code: (1) áp dụng cho mọi trang chứ không riêng nhóm "làm việc rộng"; (2) luôn ép thu gọn lại ở MỖI lần điều hướng, kể cả khi người dùng vừa tự mở lại tay (không tự khôi phục); (3) cờ toàn tenant (`tenant_setting`, không phải tuỳ chọn cá nhân từng tài khoản) — riêng màn hình khám GIỮ NGUYÊN hành vi tự thu gọn CỐ ĐỊNH hiện có, không đi qua cờ này (đã hỏi và chốt, để không thoái lui hành vi đang chạy thật ở pilot).

`tenant_setting.sidebar_auto_collapse_enabled` mới (TẮT theo mặc định — an toàn, giữ nguyên hành vi hiện tại), đọc/ghi qua `GET/PATCH /clinic-settings` có sẵn + chiếu tối thiểu tự-phục vụ `GET /clinic-settings/sidebar-auto-collapse-enabled` (mọi nhân viên đọc được, không cần `clinic_config.read`, đúng khuôn `allow-staff-self-schedule-enabled`). `apps/web/src/shared/layout/sidebar.context.tsx` thêm `useAutoCollapseSidebarOnNavigate(enabled)` — hook mới, độc lập hoàn toàn với `useAutoCollapseSidebar()` cũ (chỉ màn khám dùng), ép `setCollapsed(true)` mỗi khi `location.pathname` đổi. Gọi ở cấp `Sidebar.tsx` (không phải trang con) để bắt được MỌI lượt điều hướng, kể cả không qua sidebar. `GeneralConfigPane.tsx` thêm Boxed Section "Giao diện" mới (trích `ToggleSwitch` dùng chung trong file, thay 2 khối markup lặp lại).

**Đã xác minh thật**: `clinic-http.spec.ts` +4 test (698/698 tổng `apps/api` — 2 file flake race `role_permission` tiền nhiệm đã biết khi chạy song song, pass 100% khi chạy riêng), `packages/core`/`packages/shared`/`apps/web` test không regression. `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 496.45 kB (không đổi bất thường). Playwright qua Chrome thật (dùng lại dev server đang chạy sẵn, không khởi động instance thứ hai): TẮT → điều hướng nhiều lần → sidebar không bị ép (240px); BẬT → bấm menu điều hướng → tự thu gọn (64px); tự mở lại tay (240px) → điều hướng tiếp → ép thu gọn lại ngay (64px, đúng quyết định "không tự khôi phục lựa chọn tay"); khôi phục công tắc về TẮT sau khi kiểm. Không có migration/ERD nào đổi (chỉ thêm 1 key `tenant_setting`, đúng khuôn các cờ đơn giản khác).

### "Sổ quỹ & Thu chi" Giai đoạn 2 — Sổ quỹ + Báo cáo dòng tiền + Chuyển quỹ + Thủ quỹ riêng

Trước khi bắt đầu: vá tài liệu B7 của GĐ1 (#121/#122) bị bỏ sót — thêm đoạn "Sổ quỹ & Thu chi tại quầy" vào `CLAUDE.md` (phạm vi v1) và mục 3.5/3.6/4/5/9 vào `docs/ERD.md` (v1.44). Kế hoạch GĐ2 duyệt qua `EnterPlanMode` (`jiggly-meandering-leaf.md`), chủ dự án chốt làm đủ cả 4 phần: Sổ quỹ, Báo cáo dòng tiền, Chuyển quỹ lập tay, Thủ quỹ riêng.

**Schema** (migration `20260907090000_cash_book_transfer_and_drawer`): `cash_voucher` thêm `counter_account_id` (nullable — có giá trị = phiếu Chuyển quỹ), `is_auto_generated`; `income_expense_type_code` đổi NOT NULL → NULLABLE + CHECK mới (C25) ép đúng 1 trong 2 hình dạng phiếu. `cash_account` thêm `owner_user_id` (chủ két riêng). `cashier_shift` thêm `drawer_account_id` (snapshot két riêng lúc mở ca). Không bảng mới.

**Backend**: mở rộng `CashVoucherService.create()` cho Chuyển quỹ (server ép `direction='EXPENSE'`, không qua duyệt); module mới `CashBookReportModule` (`CashBookReportService`/`CashBookExportService`, tách khỏi `CashBookModule` để tránh vòng phụ thuộc mới với `BillingModule`) — `GET /cash-book/ledger` (Sổ quỹ), `GET /cash-book/cash-flow-report` (+ `/export` Excel qua `exceljs`). `CashierShiftService.openShift()` tự cấp két riêng (find-or-create) khi bật "Thủ quỹ riêng"; `close()` tự sinh phiếu Chuyển quỹ gộp két riêng về quỹ CASH mặc định — **cố ý không gắn `cashier_shift_id` vào chính ca đang chốt** (phát hiện lúc viết test: nếu gắn, "Tính toán lại" sẽ tự nạp lại phiếu này và cộng dồn `cashOutAmount` mỗi lần tính lại). `InvoiceService.resolveCashAccountId()` mở rộng route tiền thu khám vào đúng két riêng của actor đang có ca mở. Permission mới `cash_voucher.report` (chỉ `clinic_admin`).

**Bug bảo mật thật phát hiện lúc viết test**: nhánh Chuyển quỹ ban đầu chỉ gác bằng `cash_voucher.create` (receptionist cũng có) dù thiết kế đã chốt "chỉ ai có `cash_account.manage`" — đã thêm kiểm tra quyền tường minh trong Service.

**Frontend**: `CashBookPage.tsx` (Sổ quỹ, số dư luỹ kế), `CashFlowReportPage.tsx` (Báo cáo dòng tiền + Xuất Excel), `TransferVoucherFormDialog.tsx` (Chuyển quỹ, chỉ hiện cho `clinic_admin`), toggle "Thủ quỹ riêng" trong Cấu hình thanh toán (khoá tới khi bật "Đa thu ngân"), cập nhật `CashVoucherListPage`/`CashAccountPane` hiển thị đúng phiếu Chuyển quỹ/két riêng, sidebar + router. OpenAPI + web codegen đã sinh lại (2 endpoint mới, `export` không đăng ký — đúng tiền lệ `/work-shift-assignments/export`).

Tiện vá: `tenant-fixture.ts` đổi thứ tự xoá `cashier_shift` lên trước `cash_account` (FK `drawer_account_id` mới khiến thứ tự cũ vỡ).

**Đã xác minh thật**: `apps/api` 697/697 test pass (34 test mới, gồm kịch bản end-to-end Thủ quỹ riêng đầy đủ), `packages/core` 157/157, `packages/shared` 20/20, `apps/web` 5/5. `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk khởi động 496.00 kB (dưới ngưỡng 500kB). Migration đã áp thật lên Postgres dev. **Chưa verify Playwright/trình duyệt thật.** Xem `docs/DECISIONS.md` #124.

### Verify Playwright #124 (Sổ quỹ, Chuyển quỹ, Báo cáo dòng tiền) + 5 bug thật phát hiện + sửa

Verify qua Chrome thật + chủ dự án tự dùng `pnpm dev` song song, phản hồi trực tiếp nhiều vòng. Xác nhận đúng thiết kế: Thu tiền khám → Sổ quỹ ghi nhận đúng; Chuyển quỹ → 2 quỹ liên quan đều đúng; Báo cáo dòng tiền loại trừ Chuyển quỹ khỏi "Theo Loại thu chi"/tổng toàn phòng khám nhưng có tính vào "Theo Quỹ".

**5 bug thật phát hiện + sửa**: (1) `CashBookPage.tsx` (Sổ quỹ) đảo hiển thị sang MỚI→CŨ (trước phải cuộn xuống cuối mới thấy số dư hiện tại); (2) `TransferVoucherFormDialog.tsx` — 2 cột không giãn đều (đổi CSS grid sang flex `flex-1` tường minh), badge nhóm bị vùng cuộn cắt mất phần trên ngay lúc mở form (thêm `pt-4`), "Ngày phát sinh" để hở nửa hàng (trả lại full-width + input gọn); (3) `CashVoucherDetailDialog.tsx` chưa phân biệt phiếu Chuyển quỹ — hiện "Loại thu chi: —" khó hiểu, không rõ tiền chuyển đi đâu — thêm nhánh hiện "Quỹ đích"/"Quỹ nguồn", ẩn nút "Sửa" (form Sửa không có trường Quỹ đích, sửa qua đó phá ràng buộc C25); (4) **bug nghiêm trọng nhất** — Sổ quỹ/danh sách phiếu sắp SAI thứ tự khi 2 chứng từ cùng "Ngày phát sinh": `cash_voucher.occurredAt` là ngày chọn tay (lưu nửa đêm), còn `payment.paidAt` là giờ thật — so thẳng khiến phiếu luôn "sớm hơn" mọi khoản thu cùng ngày dù lập sau. Sửa `CashVoucherRepository.list()` thêm tie-break `createdAt desc`, `CashBookReportService.getLedger()` đổi sort: so ngày lịch VN trước, cùng ngày so `createdAt` thật. Test hồi quy mới tự xác nhận bắt được bug (revert code cũ → fail đúng lỗi quan sát được → khôi phục → pass).

Sự cố vận hành: `config.json` lệch cổng API với `.env` (leftover phiên trước) — đã sửa khớp `3001`; dev server nền của tôi và của chủ dự án cùng chiếm cổng 3001 gây `EADDRINUSE` — đã dừng tiến trình của tôi.

**Đã xác minh thật**: `apps/api` 698/698 test pass (toàn bộ suite), `pnpm -w typecheck/build` sạch, Playwright xác nhận cả 5 fix bằng ảnh chụp + đo pixel thật, riêng bug (4) xác nhận lại trên đúng dữ liệu chủ dự án tạo. Dữ liệu test đã huỷ lượt khám + hoàn tiền qua HTTP API — 1 phiếu Chuyển quỹ test không huỷ được vì ca thu ngân liên quan đã đóng giữa phiên (đúng thiết kế khoá sau khi ca đóng, không phải lỗi). Xem `docs/DECISIONS.md` #125.

### Verify "Thủ quỹ riêng" (phần cuối của #124) — đúng thiết kế, không phát hiện bug

Bật tạm "Đa thu ngân" + "Thủ quỹ riêng", dùng tài khoản thu ngân test riêng (không đụng ca đang mở của `dev.admin`). Xác nhận qua Chrome thật + API: mở ca tự sinh két riêng (`type=DRAWER`); 3 khoản thu tiền mặt trong ca route đúng vào két riêng, không lẫn quỹ chung; chốt ca qua đúng wizard 4 bước, tự sinh phiếu Chuyển quỹ quét ĐÚNG số dư sổ quỹ thật của két riêng (không phải số "vốn đầu ca" đếm tay — số đó chỉ là đối soát, không phải giao dịch thật) về quỹ tiền mặt chung, két riêng về đúng 0đ. Dữ liệu test đã dọn sạch qua HTTP API, 2 công tắc trả về tắt. **Cả 4/4 phần GĐ2 đã verify Playwright xong.** Xem `docs/DECISIONS.md` #125.

## 2026-09-06

### Redesign "Lập phiếu thu/chi" + "Lưu và in phiếu" + cố định header/footer modal

Chuỗi phản hồi trực tiếp trên ảnh chụp (`CashVoucherFormDialog.tsx`/`CashVoucherListPage.tsx`, tiếp nối #122). Xem `docs/DECISIONS.md` #123.

**Redesign form**: lưới dọc cũ → Boxed Section Form Pattern 2 khối ("Thông tin phiếu" 6 trường lưới 3×2, "Chi tiết" 2 trường full-width), modal nới `max-w-xl`→`max-w-4xl`, tab Thu/Chi đổi sang segmented control có icon `ArrowCircleDown`/`ArrowCircleUp`. Trích xuất `shared/ui/BoxedSection.tsx` dùng chung (trùng lặp lần 3 với `WorkShiftFormModal.tsx`/`BusinessCodeTemplateFormModal.tsx`), retrofit cả 2 file cũ không đổi giao diện.

**Bug thật phát hiện qua ảnh chụp**: header/nút hành động cuộn chung với nội dung form, trôi mất khỏi khung nhìn khi nội dung dài — sửa bằng tách 3 vùng cố định-cuộn-cố định (`flex-shrink-0`/`min-h-0 flex-1 overflow-y-auto`/`flex-shrink-0`), đúng khuôn `ExamTypeFormModal.tsx`.

**Khối tổng kết Thu/Chi/Chênh lệch** (`CashVoucherListPage.tsx`): đổi sang 3 thẻ tách rời nền màu nhạt. 2 vòng chỉnh chữ đối lập trong cùng phiên — thử nhạt/mảnh hơn theo yêu cầu đầu ("không quá đậm gây vỡ"), phản hồi ngay "chữ mỏng quá" → chốt lại `text-2xl font-bold`/`text-xs font-bold` màu đặc.

**Tính năng mới — "Lưu và in phiếu"**: `CashVoucherFormDialog.onSubmit` đổi trả về `Promise<CashVoucher>` (thay `Promise<void>`, cập nhật cả 4 nơi gọi) để form tự lấy `id` phiếu vừa lưu, gọi `POST .../print` (tái dùng `usePrintCashVoucherMutation`) → render `CashVoucherPrintView` → `window.print()` → tự đóng — đúng nguyên kỹ thuật `CashVoucherDetailDialog.handlePrint()` có sẵn.

**Đã xác minh thật**: `pnpm --filter @nexamed/web run typecheck/build` sạch, chunk khởi động không đổi (490.55 kB). Playwright qua Chrome thật cài sẵn trên máy (headless, `playwright-core` cài tạm ngoài repo) — header/footer cố định đúng (toạ độ không đổi khi cuộn nội dung), luồng "Lưu và in phiếu" đúng end-to-end (tạo phiếu → đánh dấu đã in → `window.print()` gọi đúng 1 lần, stub no-op vì hộp thoại in là native OS không tự động hoá được → dialog tự đóng), xác nhận `printedAt` đã ghi qua API. Không lỗi console ngoài `401 /auth/refresh` đã biết + 1 lỗi `404 /favicon.ico` độc lập xác nhận không liên quan (file favicon vốn chưa từng có). 2 phiếu test đã huỷ qua HTTP API, không để lại dữ liệu rác.

## 2026-09-05

### "Thu chi tại quầy" (Sổ quỹ & Thu chi Giai đoạn 1) — hoàn tất backend + frontend

Hoàn thiện module `cash-book` đã bắt đầu từ backend commit trước đó (`274b0c7`) — nay đủ cả API lẫn giao diện, kế hoạch tại `reactive-moseying-flask.md`.

**Backend — hoàn tất theo đúng thứ tự B3 còn lại của plan**: viết `cash-account-http.spec.ts` (12 test) + `cash-voucher-http.spec.ts` (33 test, bao phủ scope `personal`/`global`, công tắc duyệt phiếu chi, duyệt/từ chối/huỷ, phiếu gắn ca đã chốt tự khoá, cách ly tenant). Phát hiện và sửa 2 lỗ hổng thật trong lúc làm: (1) `CashBookModule` viết xong từ trước nhưng **chưa từng được import vào `app.module.ts`** — nếu không phát hiện, toàn bộ `/cash-accounts`/`/cash-vouchers` sẽ 404 khi chạy thật; (2) seed quỹ mặc định mới (dùng `code_sequence`) làm vỡ cleanup của 3 file test cũ (`auth.spec.ts`/`rbac.spec.ts`/`sync-role-permissions.spec.ts`, đều KHÔNG dùng `tenant-fixture.ts` chung) do FK RESTRICT — sửa cleanup + tách hàm `ensureDefaultCashAccount()` dùng chung cho cả lúc tạo tenant mới lẫn backfill tenant cũ qua `syncRolePermissionsForAllTenants()` (chạy mỗi lần API khởi động). Backfill thật trên Postgres dev xác nhận đủ 14/14 tenant có quỹ tiền mặt mặc định + 129 dòng `role_permission` mới. Thêm 11 route `cash-book` vào `generate-openapi.ts` (trước đó chưa đăng ký, dù schema `packages/shared` đã có).

**Frontend — toàn bộ tính năng mới** (`apps/web/src/features/cash-book/`): `CashAccountPane.tsx` (quản lý Quỹ, mục con mới trong pill "Cấu hình thanh toán" → tách thành 2 mục con "Cấu hình"/"Quỹ"), `CashVoucherListPage.tsx` (`/cash-book/vouchers`, List Screen Pattern, lọc khoảng ngày/loại/trạng thái + thanh tổng kết Tổng thu/Tổng chi/Chênh lệch lấy từ server), `CashVoucherFormDialog.tsx` (Lập phiếu — "Lưu và nhập tiếp", Enter-to-submit), `CashVoucherDetailDialog.tsx` (Sửa/Huỷ/Duyệt/Từ chối/In), `CashVoucherPrintView.tsx` (khổ A5). Sidebar thêm nhóm mới "Sổ quỹ & Thu chi". 2 nút tắt "Tạo phiếu thu/chi" (Thu ngân + bước đếm tiền của Chốt ca) mở chung `CashVoucherFormDialog`. Thêm toggle "Phiếu chi phải được duyệt" vào `PaymentConfigPane.tsx`.

**3 lỗi thật phát hiện lúc kiểm bằng Playwright (Chrome thật, tenant demo riêng tạo qua `db:seed:dev-tenant`), sửa ngay**: (1) `CashVoucherFormDialog` — 2 ô "Hình thức"/"Quỹ" không tự điền giá trị mặc định vì `useState` khởi tạo chỉ chạy 1 lần lúc mount, trong khi danh mục Hình thức/Quỹ tải bất đồng bộ (React Query) nên rỗng tại thời điểm đó — sửa bằng `useEffect` backfill khi dữ liệu về, chỉ khi field còn rỗng (không đè lựa chọn người dùng đã đổi); (2) `CashVoucherListPage.tsx`/`CashAccountPane.tsx` thiếu hẳn `SelectionCheckbox`/`useRowSelection`/`SelectionToolbar` — vi phạm quy tắc đã chốt ở `.claude/docs/ui-guidelines.md` mục 4.6 (mọi bảng CRUD/quản lý thật phải có checkbox chọn dòng hàng loạt), chủ dự án phát hiện — bổ sung cho cả 2; (3) `CashVoucherDetailDialog.tsx` — nút "Duyệt"/"Từ chối" vẫn hiện cho phiếu đã bị huỷ (voided) nhưng còn ở trạng thái `PENDING_APPROVAL` (tình huống có thật: người lập tự huỷ phiếu trước khi ai duyệt), bấm vào luôn nhận `404` — thêm điều kiện `!voucher.voided`.

**Tính năng mới ngoài kế hoạch, yêu cầu trực tiếp cùng phiên**: "Phiếu trong ca của tôi" (`MyShiftVouchersDialog.tsx`, nút tắt mới ở trang "Thu ngân") — thu ngân xem lại TOÀN BỘ phiếu đã lập trong ca đang mở, gộp CẢ tiền thu khám (`invoice`/`payment`) lẫn phiếu thu/chi ngoài khám (`cash_voucher`), thuần liệt kê KHÔNG tính tổng/chênh lệch (đã hỏi và chốt qua trao đổi trực tiếp — xem `docs/DECISIONS.md` #122). Giới hạn đã biết, chấp nhận có chủ đích để không phải sửa backend: phần tiền khám lọc theo `paidAt` ở client trên nền `GET /billing/invoices?date=` (vốn lọc theo `checkedInAt`, không phải ngày thu tiền) — trường hợp hiếm bệnh nhân tiếp nhận hôm trước/thu tiền hôm sau trong ca đang xem sẽ không thấy ở đây. Phiếu ngoài khám lọc chính xác qua `cashierShiftId` ở backend, không có giới hạn này.
**2 vòng chỉnh sửa giao diện trực tiếp trên bản chạy thật**: đổi tiêu đề tự viết tay sang `ModalHeader` dùng chung (vi phạm mục 4.1g bị chủ dự án phát hiện) + thêm hẳn tiêu đề cột (GIỜ/LOẠI/DIỄN GIẢI/SỐ TIỀN/TRẠNG THÁI); nới rộng dialog `max-w-2xl`→`max-w-4xl` + thêm khoảng cách cột (`gap-x-4`) theo phản hồi "quá dính nhau".
**1 bug thật nghiêm trọng phát hiện lúc chủ dự án tự kiểm bằng chuột thật** (không lộ ra khi kiểm bằng script tự động dùng `scrollIntoViewIfNeeded()`/gán `scrollTop` trực tiếp — cả hai đều "hoạt động" dù layout sai): vùng danh sách dùng `h-full` (height:100%) trên div lồng bên trong một div cha chỉ có `max-h-[85vh]` (không phải `height` cố định) — `h-full` không resolve được thành chiều cao cố định, khiến div tự giãn theo TOÀN BỘ nội dung (đo được 2170px thay vì bị giới hạn) thay vì bị giới hạn; nhìn ngoài tưởng bị cắt đúng (viền `overflow-hidden` của div cha che phần thừa) nhưng cuộn chuột không còn tác dụng vì `overflow-y-auto` không có gì để cuộn (`scrollHeight === clientHeight`). Sửa bằng gộp 2 lớp div cuộn thành 1 (`min-h-0 flex-1 overflow-y-auto` áp thẳng lên chính flex item, bỏ hẳn `h-full` lồng trong) — flexbox tự tính chiều cao cố định cho flex item, không cần qua `height:100%`. Đã xác minh lại bằng lăn chuột thật qua Playwright: `clientHeight` từ 2170px (bằng `scrollHeight`, không cuộn được) xuống đúng 628px, `scrollTop` di chuyển đúng sau khi lăn chuột. Stress test 43 dòng dữ liệu thật (tạo qua UI, "Lưu và nhập tiếp") — cuộn mượt, không vỡ layout.

**Bug thứ 4, phát hiện ngay sau đó ở trang "Vai trò & Phân quyền"**: 2 module mới `cash_account`/`cash_voucher` hiện tên thô (snake_case) thay vì tiếng Việt trong bảng ma trận — `apps/web/src/features/role/permission-grouping.ts` có cơ chế `MODULE_LABELS` + fallback về tên thô cho module chưa kịp thêm nhãn, nhưng quên thêm 2 module mới này (đúng lỗ hổng đã lặp lại nhiều lần trước đó — file có sẵn comment ghi chú "4 module đã có permission từ trước nhưng chưa từng thêm nhãn ở đây"). Bổ sung `cash_account: 'Quỹ'`, `cash_voucher: 'Phiếu thu/chi'`.

Xem `docs/DECISIONS.md` #122.

Đã xác minh: `apps/api` 676/676 test pass (không tính 1 flake cleanup tiền-nhiệm đã biết khi chạy song song, `drug-http.spec.ts`, pass 8/8 khi chạy riêng), `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk khởi động 490.50 kB (dưới ngưỡng 500kB). Playwright qua Chrome thật trên tenant demo riêng: toàn bộ luồng Quỹ (thêm quỹ ngân hàng, đặt mặc định), Phiếu thu/chi (tạo/xem/in/huỷ/duyệt/từ chối, cả hai trạng thái công tắc duyệt), "Phiếu trong ca của tôi" (43 dòng, cuộn chuột thật) — không lỗi console ngoài dự kiến.

### Seed sẵn 13 "Nghề nghiệp" mặc định (mã chính thức, cùng mục đích "build cho khách luôn sẵn danh mục" như Đơn vị tính)

Chủ dự án gửi `NgheNghiep.md` (13 dòng, có sẵn mã chính thức — khác Đơn vị tính) copy byte-for-byte vào `docs/data/nghe-nghiep.md`. Thêm `OCCUPATION_ITEMS` vào `packages/core/src/reference-catalog/data.ts` (cùng mảng với `ETHNICITY_ITEMS`/`NATIONALITY_ITEMS`/`EMPLOYMENT_TYPE_ITEMS` — category này KHÔNG có trong `REFERENCE_CATALOG_SHORT_CODE_PREFIXES` nên giữ nguyên `code` cho trước thay vì tự sinh mã ngắn tuần tự) + vòng lặp seed mới trong `seed-reference-catalog.ts`, upsert theo `(category, code)` đúng khuôn `EMPLOYMENT_TYPE_ITEMS`. Cập nhật lại comment enum `OCCUPATION`/`UNIT` ở `schema.prisma` (trước ghi "không seed cứng", nay đã seed).

Không migration/API/frontend nào đổi — category `OCCUPATION` đã có UI quản lý + Combobox ở form bệnh nhân từ #061.

Đã xác minh: `packages/core` 155/155 test (+1 `data.spec.ts`), `apps/api` `reference-catalog-http.spec.ts` 15/15 không regression, `pnpm -w typecheck/lint/build` sạch (chunk web không đổi, 486.66 kB). Chạy `db:seed` thật trên Postgres dev, xác nhận qua query trực tiếp: đúng 13 dòng mới upsert theo mã (1 dòng dữ liệu test cũ có sẵn từ trước không bị đụng), chạy lại lần 2 xác nhận không tạo trùng.

### Seed sẵn 47 "Đơn vị tính" mặc định (build cho khách luôn có sẵn danh mục)

Chủ dự án gửi `Donvitinh.md` (47 đơn vị duy nhất — file gốc 48 dòng nhưng "Gói" lặp lại 1 lần, đã bỏ dòng lặp), copy byte-for-byte vào `docs/data/don-vi-tinh.md` (đúng tiền lệ `allergen-catalog.md`). Thêm `UNIT_SEED_ITEMS` (`packages/core/src/reference-catalog/unit-seed-data.ts`) và `seedUnits()` trong `seed-reference-catalog.ts` — idempotent THEO TÊN (không theo `code`, đúng khuôn `seedAllergenCatalog()`, vì nguồn dữ liệu này không có mã chính thức): mục đã tồn tại (kể cả do `clinic_admin` tự tạo trùng tên trước khi seed chạy) được bỏ qua, không ghi đè. Mã tự sinh NGẮN, TUẦN TỰ qua `GlobalCodeSequenceRepository` (tiền tố `DV` có sẵn từ #113), cột "Mô tả" của file gốc (ký hiệu viết tắt, ví dụ "Microgam"→"µg") map thẳng vào cột `reference_catalog.description` có sẵn. Chạy `pnpm db:seed` là danh mục có sẵn ngay — không cần thao tác tay, đúng yêu cầu "build source cho khách luôn sẵn danh mục".

Không migration/API/frontend nào đổi — thuần seed data cho category `UNIT` đã có UI quản lý từ trước (#078). Người dùng vẫn thêm được đơn vị mới qua chức năng "Thêm mới" bình thường, tiếp đúng mạch số đếm (không trùng mã).

Đã xác minh: `packages/core` 154/154 test (+3 `unit-seed-data.spec.ts`), `apps/api` `reference-catalog-http.spec.ts` 15/15 không regression, `pnpm -w typecheck/lint/build` sạch (chunk web không đổi, 486.66 kB — thuần backend). Chạy `db:seed` thật trên Postgres dev, xác nhận qua query trực tiếp: 46 dòng mới tạo (1 dòng "Lần" đã tồn tại sẵn từ trước nên bỏ qua đúng thiết kế), mã `DV00003`..`DV00048` không trùng, chạy lại lần 2 xác nhận không tạo trùng (idempotent).

### Danh mục "Loại thu chi" + chuẩn "Lưu và nhập tiếp" cho mọi form Thêm mới Quản trị + `ModalHeader` dùng chung

Danh mục dùng chung mới `INCOME_EXPENSE_TYPE` (mã tự sinh `TC00001`..., cột `direction` Chi tiền/Thu tiền) chuẩn bị cho chức năng "Thu chi tại quầy"/Sổ quỹ sắp làm (chưa xây). Thêm chuẩn mới **"Lưu và nhập tiếp"** cho toàn bộ 8 nhóm form Thêm mới ở Quản trị (danh mục dùng chung, Phòng/Tầng, Khoa/Phòng, Thuốc, Dị nguyên, Ca làm việc, Tài khoản) — lưu xong không đóng modal, tự làm trống để nhập tiếp bản ghi khác, kèm banner xanh báo đã lưu (`useSaveFlash`/`SaveFlashBanner`). Rà soát phát hiện + sửa 2 nợ kỹ thuật cũ: các modal nhỏ từng xếp input 1 cột dọc (vi phạm mục 4.1) nay chuyển lưới ngang; header modal đổi sang dùng chung `ModalHeader.tsx` (badge icon đặc + tiêu đề đậm + phụ đề dạng pill). Tiện sửa 2 lỗi bố cục khác: "Ca làm việc" hết sinh thanh cuộn dọc thừa (nới rộng modal + 2 khối giờ làm việc/giờ nghỉ cạnh nhau), thanh pill "Danh mục dùng chung"/"Cấu hình hệ thống" đổi từ cuộn ngang sang xuống dòng (tránh xót cấu hình khi danh sách pill dài).

Xem `docs/DECISIONS.md` #121.

Đã xác minh: `pnpm -w typecheck/lint/build` sạch, `apps/api` 629/629 test pass, migration đã áp lên Postgres dev, smoke test HTTP thật + Playwright qua Chrome thật (`playwright-core` trỏ thẳng Chrome cài sẵn, né tải Chromium bundled) xác nhận toàn bộ luồng đúng thiết kế, không phát hiện bug.

### Redesign hộp thoại "Chốt ca" (Thu ngân) + trường "Tổng doanh thu ca" mới

Chủ dự án yêu cầu dựng lại giao diện hộp thoại "Chốt ca" bằng mockup Artifact tương tác trước khi code (giữ nguyên luồng 4 bước + màn xác nhận/in phiếu, chỉ đổi cách trình bày). Sau khi chốt mockup, code thẳng vào `CloseShiftDialog.tsx`/`DenominationCounter.tsx`/`CashierShiftReceiptView.tsx`.

Thêm trường tính toán mới **"Tổng doanh thu ca"** = Tiền mặt (đã trừ hoàn) + Phi tiền mặt (đã trừ hoàn theo từng phương thức, dữ liệu backend `computeCashierShiftTotals()` đã netted sẵn — không đổi API/schema) — KHÔNG cộng Vốn đầu ca. Trở thành hero chính ở Bước 1 (Tổng kết hệ thống), có thanh tỷ lệ trực quan tiền mặt/phi tiền mặt, thêm vào đầu phiếu in. "Tiền mặt dự kiến trong két" cũ lùi thành ô phụ.

Chuỗi chỉnh sửa qua nhiều vòng phản hồi trực tiếp trên `pnpm dev`: cột "Số tờ" đổi capsule trắng/xám nhẹ; dòng tổng đổi màu thương hiệu `bg-blue-600`; khung popup dãn +20%; dựng lại stepper 4 bước thành lưới `grid-cols-4` (sửa lỗi số/chữ không thẳng hàng do 2 công thức `flex-1` khác nhau) kèm dấu tick cho bước đã qua và đổi màu sang `emerald-600`.

**2 bug thật phát hiện + sửa lúc chủ dự án tự xem**: (1) "Đối soát mù" bật chỉ ẩn ô "tiền mặt dự kiến trong két" nhưng để lộ "Tổng thu tiền mặt"/"Chi tiền mặt" — cộng trừ tay với "Vốn đầu ca" (luôn hiện) suy ra ngay số cần giấu, mất tác dụng đối soát mù — đã ẩn luôn 2 ô đó khi bật. (2) Nút trừ/cộng ép `Button` dùng chung với `className="px-0"` thua trận CSS specificity trước `px-4` mặc định của variant, khiến icon `Minus`/`Plus` bị nuốt mất (nút hiện ô trắng rỗng) — sửa bằng `<button>` tay riêng cho control đổi giá trị này.

Xem `docs/DECISIONS.md` #120.

Đã xác minh: `pnpm -w typecheck/lint` sạch, `pnpm --filter @nexamed/web run build` sạch, chunk khởi động không đổi (486.54 kB, `cashier-shift` vốn đã lazy). Không migration/schema/API contract nào đổi. Chưa verify Playwright — toàn bộ xác nhận qua chủ dự án tự xem trực tiếp trên `pnpm dev`.

## 2026-09-04

### Bảo mật: thu hồi quyền qua "Vai trò & Phân quyền" không có tác dụng (backend) + menu/route không theo quyền thật (frontend)

Chủ dự án báo lễ tân `linh.tran` đã bị gỡ hết quyền Thu ngân vẫn thấy menu "Thu ngân" (bấm vào treo trang) — hỏi thẳng "nếu cho phép người dùng phân quyền vai trò mà không áp dụng được quyền đó theo vai trò thì có ý nghĩa gì", yêu cầu rà soát toàn hệ thống.

**Bug gốc nghiêm trọng nhất**: `findScopesForUserPermission()` (`permission-lookup.helper.ts`, hàm DUY NHẤT `PermissionGuard` dùng cho MỌI endpoint) thiếu `deletedAt: null` — quyền đã thu hồi hoặc vai trò đã gỡ khỏi tài khoản vẫn còn hiệu lực vĩnh viễn. Đã sửa + thêm `findAllPermissionsForUser()` + test hồi quy xác nhận bắt được bug (chạy lại với code cũ → 2/3 test fail đúng).

**Frontend**: rà soát phát hiện 19 file `apps/web` hardcode tên vai trò để ẩn/hiện menu/nút thay vì tra quyền thật. Thêm `currentUserSchema.permissions`, hook `usePermission.ts` (`useHasPermission`/`useDataScope`/`useHasAnyPermission`), sửa cả 19 file, thêm route guard (`RequirePermissionRoute`/`RequireAnyPermissionRoute`) bọc toàn bộ route trong `router.tsx` (trước chỉ ẩn menu, gõ thẳng URL vẫn vào được). Nhóm "Quản trị" tách từ 1 khối thành 7 mục con tự kiểm tra đúng quyền riêng.

Xem `docs/DECISIONS.md` #119.

Đã xác minh: `apps/api` 611/611 pass (2 flake đã biết, pass riêng) gồm `permission-lookup.helper.spec.ts` mới, `encounter-http.spec.ts` 61/61 (break-glass HTTP end-to-end không đổi). `pnpm -w typecheck/build` sạch, chunk web 486.53 kB raw/141.77 kB gzip. `.claude/docs/security-audit.md` mở rộng quy tắc chống hardcode sang frontend + bắt buộc test hồi quy cho hàm tra quyền mới.

### Hiện lại khối "Thực thu" ở thanh tổng kết Thu ngân

Chủ dự án yêu cầu trực tiếp hiện lại số "Thực thu" (`netTotalAmount = paidTotalAmount - refundedTotalAmount`) tại `/billing` — trước đó #111 đã ẩn để gọn thanh tổng kết. `InvoiceListPage.tsx` thêm 1 khối giữa "Đã thu hôm nay" và "Đã hoàn" (đúng thứ tự dòng tiền), dùng thẳng `netTotalAmount` backend đã tính sẵn — không đổi API/schema. `pnpm -w typecheck/build` sạch, chunk `InvoiceListPage` không đổi bất thường.

### Popup "Tổng hợp ca khám hôm nay" khi Đóng ca

Chủ dự án yêu cầu: khi bác sĩ bấm "Đóng ca hôm nay" (chủ động hoặc hệ thống tự nhắc hết giờ làm việc), hiện thêm 1 giao diện tổng hợp ca đã khám trong ngày để bác sĩ xác nhận. Mockup Artifact duyệt nhiều vòng trước khi code — 3 điểm phạm vi chốt qua `AskUserQuestion` (số liệu tính CẢ NGÀY hôm nay không riêng phiên ACTIVE hiện tại; gộp 1 dialog duy nhất; "Huỷ khám" chỉ tính ca đã gán cho đúng bác sĩ này), sau đó nhiều vòng chỉnh trực tiếp trên mockup tĩnh (bố cục quá bó hẹp → nới rộng; nền xám bị chê "AI look" → đổi sang panel màu thương hiệu `brand-teal`; chữ `font-extrabold` bị chê "vỡ nét" → hạ về `font-bold`; thêm lời chào cá nhân hoá có tên bác sĩ) — có tra `/ui-ux-pro-max` để đối chiếu nguyên tắc bố cục, không áp dụng gợi ý đổi bảng màu của công cụ vì xung đột token đã chốt.

`DoctorEndShiftDialog.tsx` (#094) mở đầu bằng panel nền teal: avatar + "BS. {tên} đã hoàn thành ngày làm việc hôm nay với:" + 5 thẻ chỉ số (Đã gọi khám/Đã hoàn thành/TB thời gian-ca/Huỷ khám/Đơn thuốc đã kê). Backend mới `GET /doctor-availability/{doctorId}/shift-summary` (cùng quyền/scope `setStatus()`) — `EncounterRepository.getShiftCounts()` + `PrescriptionRepository.countSignedForDoctorToday()` (export thêm từ `EncounterModule`, dùng chung đúng tiền lệ #042), hàm thuần `computeShiftSummary()` mới ở `packages/core`.

Xem `docs/DECISIONS.md` #118.

Đã xác minh: `packages/core` +4 test (151/151), `apps/api` +7 test (619/626, 7 skip flake `geo-http.spec.ts` đã biết không liên quan), `pnpm -w typecheck/lint/build` sạch. Playwright qua Chrome thật (tài khoản bác sĩ test tạo/xoá qua HTTP API bằng `dev.admin`) xác nhận khớp gần như tuyệt đối với mockup đã duyệt, không lỗi console ngoài `401 /auth/refresh` đã biết.

### "Đa thu ngân" — nhiều ca thu ngân chạy song song + sửa tương tác 2 công tắc

Chủ dự án hỏi tiếp sau công tắc "Yêu cầu mở ca": phòng khám có 3 thu ngân làm việc CÙNG LÚC (mỗi người 1 két riêng) thì "Chốt ca" hiện tại (chỉ 1 két dùng chung, chỉ 1 ca OPEN toàn tenant) có đáp ứng được không. Lập kế hoạch qua `EnterPlanMode` trước khi code (chạm ràng buộc DB + cách gán tiền vào ca).

Thêm `tenant_setting.cashier_shift_multi_cashier_enabled` (mặc định TẮT — giữ nguyên "1 két dùng chung"). Migration đổi partial unique index `cashier_shift` từ theo-tenant sang theo-từng-thu-ngân; `payment` thêm cột `cashier_shift_id` (nullable, gắn lúc thu/hoàn tiền). Giữ 2 luồng tính tổng kết ca song song (TẮT: theo thời gian, không đổi code; BẬT: theo FK) — tránh vỡ "Tính toán lại" cho ca cũ. An toàn đua tranh khi mở ca chuyển từ ràng buộc DB sang `pg_advisory_xact_lock` (lần đầu dùng trong dự án). `billing` ⇄ `cashier-shift` phụ thuộc module 2 chiều thật — dùng `forwardRef()` lần đầu trong dự án, đã xác nhận DI khởi động thật thành công.

Ngay sau khi hỏi phân tích tương tác 2 công tắc, phát hiện lỗi: nút "Mở ca ngay" duy nhất bị ẩn theo công tắc "Yêu cầu mở ca" — bật "Đa thu ngân" cùng lúc tắt "Yêu cầu mở ca" thì không ai bấm mở ca được ở đâu cả, tính năng mới vô dụng. Đảo hướng 1 phần quyết định trước đó: "Yêu cầu mở ca" giờ chỉ gate "Thu tiền", không còn quyết định hiện/ẩn banner+nút — chỉ đổi câu chữ theo bắt buộc/tuỳ chọn. Tiện sửa khối "Đã hoàn" ở thanh tổng kết `/billing` luôn hiện (kể cả 0đ) thay vì ẩn gây lệch layout.

Xem `docs/DECISIONS.md` #117, `docs/ERD.md` v1.43.

Đã xác minh: `cashier-shift-http.spec.ts` +6 test (43/43, race 2 người khác nhau/cùng người, thu tiền song song không lẫn ca), `clinic-http.spec.ts` +2 test (34/34). Tổng 620 test `apps/api` (18 flake `role_permission` đã biết, pass riêng). `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 481.62 kB (không đổi). Playwright qua Chrome thật xác nhận cả tổ hợp 4 trạng thái 2 công tắc + fix "Đã hoàn".

### "Yêu cầu mở ca trước khi thu tiền" — công tắc tắt gate Chốt ca cho phòng khám nhỏ

Chủ dự án hỏi UX của "Chốt ca" (#112) với phòng khám nhỏ 1 người kiêm tiếp nhận/thu ngân/khám bệnh — gate "phải mở ca mới thu tiền được" chỉ là ma sát khi không có ai để đối soát chéo. Thêm công tắc `tenant_setting.cashier_shift_required_enabled` (mặc định BẬT, đúng khuôn `cashierShiftBlindCloseEnabled`), đặt trong pill "Cấu hình thanh toán" cạnh "Chế độ đối soát Mù".

Tắt: `InvoiceDetailPage.handlePay()` bỏ hẳn gate đòi ca đang mở (backend vốn không đòi, gate thuần frontend); `InvoiceListPage.tsx` ẩn hoàn toàn banner "Chưa mở ca hôm nay" + nút "Chốt ca" (chốt qua `AskUserQuestion`: ẩn hẳn, không giữ dạng nút nhỏ tuỳ chọn). Trang "Phiếu chốt ca" riêng (`/billing/cashier-shifts`) giữ nguyên, vẫn đóng được ca lỡ còn mở từ trước.

Xem `docs/DECISIONS.md` #116, `docs/ERD.md` v1.42.

Đã xác minh: `clinic-http.spec.ts` +3 test (32/32), tổng 612 test `apps/api` (16 flake `role_permission` race đã biết, pass 100% khi chạy riêng). `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 481.62 kB.

Sau khi xem bản chạy thật, chủ dự án chỉnh lại văn bản 2 công tắc: rút gọn mô tả "Yêu cầu mở ca trước khi thu tiền", đổi tên "Chế độ đối soát Mù" → "Đối soát độc lập". Verify Playwright hoàn tất (Chrome thật, `dev.admin`): text đúng, ẩn/hiện banner+nút đúng cả 2 chiều — và **test thu tiền thật đầu-cuối**: tạo phiếu thu 250.000đ qua HTTP API, tắt công tắc, bấm "Thu tiền" → thành công ngay không bị chặn. Dữ liệu test đã dọn sạch qua đúng quy trình nghiệp vụ (đánh dấu chưa thu → huỷ lượt khám), không SQL trực tiếp.

## 2026-09-03

### Bug thật "Mở ca" crash 500 (tái phát từ #114) — sửa xong + redesign nút Mở ca/Chốt ca

Chủ dự án tự dùng thử "Chốt ca" trên bản chạy thật, bấm "Mở ca" gặp lỗi 500. Nguyên nhân: khuôn mã MẶC ĐỊNH của 7 loại mã nghiệp vụ (#114) đều chứa token `[Tháng]` (chỉ để hiển thị giống khuôn cũ) nhưng `BusinessCodeService.generate()` không phân biệt "khuôn mặc định" với "khuôn tenant chủ động lưu" — tính `periodKey` theo tháng ngay cả khi chưa ai cấu hình gì, vi phạm lời hứa tương thích ngược đã chốt ở #114. Với `cashier_shift` (module mới, mọi mã sinh trong tháng 09), bộ đếm chu kỳ mới bắt đầu lại từ 1, trùng mã cũ đã cấp ở bộ đếm liên tục → vi phạm UNIQUE `shift_no` → 500. Lỗi tiềm ẩn cho cả 7 loại mã, không riêng cashier_shift.

Sửa: chỉ tính `periodKey` thật khi tenant THẬT SỰ đã lưu cấu hình riêng cho loại mã đó; dùng khuôn mặc định thì luôn ép `periodKey=''`. Xem `docs/DECISIONS.md` #115.

Cùng phiên: redesign nút "Mở ca" (nút nhỏ ẩn trong thanh công cụ → banner xanh đậm full-width) và "Chốt ca" (viền nhạt → nền đặc `amberSolid` + icon, variant mới trong `Button.tsx`) theo phản hồi trực tiếp "không nổi bật". 2 bug phụ: `GET /cashier-shifts/current` thiếu hẳn `handoverNote` của ca trước (người mở ca không đọc được ghi chú bàn giao); module `cashier_shift` thiếu nhãn tiếng Việt ở "Vai trò & Phân quyền".

Verify Playwright #113/#114 (giao song song) hoàn tất cùng lúc: cả hai đúng thiết kế, không bug nghiệp vụ. Phát hiện thêm 1 sự cố hạ tầng không liên quan code — Vite dep pre-bundle kẹt (`@tanstack/react-virtual` 504) — đã sửa bằng xoá cache `.vite` + restart web dev server.

Đã xác minh: mở ca thật qua API thành công, số tiếp đúng mạch (không nhảy về 1); 254 test liên quan pass (business-code/cashier-shift/patient/appointment/reception/billing/user-account), không regression; `pnpm -w typecheck` sạch toàn workspace.

### "Cấu hình mẫu mã phát sinh" cho mã nghiệp vụ có tháng-năm

Tiếp ngay sau rút gọn Nhóm A — chủ dự án yêu cầu cho Nhóm B (mã có tháng-năm: patient_code, encounter_no, booking_code, employee_code, department.code, invoice_no, cashier_shift.shift_no) tự cấu hình được theo tenant, dạng `[Năm][Tháng] [Ký tự][số đếm]` + số bắt đầu đếm. Kế hoạch kỹ thuật duyệt qua `EnterPlanMode` trước khi code.

Chốt qua `AskUserQuestion`: đổi khuôn chỉ áp dụng mã tạo MỚI (mã cũ giữ nguyên); bộ đếm tự reset theo chu kỳ mịn nhất trong khuôn (có `[Tháng]` → reset tháng, chỉ `[Năm]` → reset năm, không có → chạy liên tục như hiện tại); "Số bắt đầu đếm" chỉ đặt được 1 lần rồi khoá vĩnh viễn; chèn token qua nút bấm, không kéo-thả; từng tenant tự cấu hình riêng.

`code_sequence` thêm cột `period_key` (mặc định `''`, tương thích ngược tuyệt đối — không cascade/backfill). `tenant_setting` thêm key `business_code_templates`. `BusinessCodeService` (module `clinic`) mới, điểm gọi DUY NHẤT thay 7 nơi gọi `formatDisplayCode` trực tiếp trước đây. Pill mới "Cấu hình mẫu mã phát sinh" trong Cấu hình hệ thống, lazy.

Bug bundler thật lặp lại (#032/#091): Rollup không dò được export của `packages/shared/src/business-code.ts` (cả hằng số lẫn hàm) qua `vite build` — khai lại 3 hàm xem trước THUẦN CLIENT tại `apps/web/src/features/clinic/business-code-preview.ts`.

Xem `docs/DECISIONS.md` #114, `docs/ERD.md` v1.41.

Đã xác minh: `packages/shared` 20/20 (+12), `apps/api` (+3 `code-sequence.repository.spec.ts`, +11 `business-code-http.spec.ts` mới), toàn bộ 7 spec HTTP của các module đã migrate KHÔNG cần sửa gì (mặc định giữ nguyên format cũ). `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 481.24 kB. Migration áp thật lên Postgres dev. Chưa verify Playwright cho màn hình mới.

### Mã tự sinh NGẮN, TUẦN TỰ cho danh mục — thay cơ chế ngẫu nhiên cũ

Chủ dự án yêu cầu trực tiếp: mã tự sinh (dạng `AC-3F9B2A1D`, 11-12 ký tự, ngẫu nhiên không theo thứ tự) quá dài, muốn rút gọn theo khuôn `<2 ký tự><5 chữ số>` (vd `HV00001`), sinh theo đúng thứ tự đã tạo. Phạm vi CHỈ nhóm "mã danh mục" (6 category `reference_catalog` không có nguồn dữ liệu chính thức — Học vị/Chức danh/Trạng thái-Hình thức làm việc/Đơn vị tính/Hình thức thanh toán + Nhóm dị nguyên/Dị nguyên + Ca làm việc) — KHÔNG đụng "mã nghiệp vụ" có tháng-năm (patient_code, encounter_no...) đã chốt riêng.

Bảng mới `global_code_sequence` (toàn hệ thống, khoá theo `prefix`) cấp số cho 3 nhóm danh mục toàn hệ thống; `work_shift` (tenant-scoped) dùng lại `code_sequence` có sẵn. Migration `20260903190000_short_sequential_catalog_codes` đánh số lại TOÀN BỘ mã cũ đã tồn tại (chỉ dòng khớp đúng mẫu ngẫu nhiên cũ, không đụng mã seed cố định như `CASH`/`FULL_TIME`) + cascade UPDATE sang mọi cột đang lưu thẳng mã dạng chuỗi (`user_account.*_code`, `exam_type_price.unit_code`, `encounter_service_item.unit_code`, `invoice_line.unit_code`, `payment.method`, `invoice.pending_payment_method`).

Xem `docs/DECISIONS.md` #113, `docs/ERD.md` v1.40.

Đã xác minh: migration áp thật lên Postgres dev, xác nhận cascade đúng qua query trực tiếp; `packages/core` 145/145; `apps/api` 576/594 pass + 18 skip (2 flake đã biết, pass riêng); `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web không đổi (480.68 kB). Chưa verify Playwright.

**Việc còn treo, khác phạm vi trên**: chủ dự án yêu cầu tiếp — dựng "Cấu hình mẫu mã phát sinh" cho nhóm mã nghiệp vụ có tháng-năm (khuôn tự cấu hình được, số bắt đầu đếm) — tính năng mới, chưa thiết kế/code.

### Bổ sung bộ lọc "Thu ngân" ở "Danh sách phiếu chốt ca"

Điểm còn treo duy nhất của "Chốt ca" (#112) — chủ dự án xác nhận cần bổ sung. Không dựng endpoint liệt kê thu ngân riêng: dùng lại `GET /users` có sẵn (`useUserAccountsQuery()`, đúng khuôn `ActivityLogPage.tsx`), lọc phía client chỉ giữ tài khoản có vai trò `receptionist`/`clinic_admin` (2 vai trò duy nhất có quyền `cashier_shift.create`). Thêm `<select>` vào toolbar `CashierShiftListPage.tsx`, nối tham số `cashierId` đã có sẵn trong `ListCashierShiftsQuery`.

Đã xác minh: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web không đổi, Playwright qua Chrome thật xác nhận dropdown hiện đúng danh sách đã lọc vai trò và lọc kết quả không lỗi.

### "Chốt ca" (BIL-05, đối soát tiền mặt/két) — hoàn tất, verify Playwright, sửa 5 lỗi thật

Tiếp nối phiên trước để dở dang ("CHƯA XONG, CHƯA TEST"). Hoàn tất theo đúng thứ tự việc treo: typecheck `apps/web` lần đầu (phát hiện 2 lỗi thật — `queryKey()` truyền sai kiểu, thiếu `handoverNote` trong schema/service khiến "Sửa phiếu" không đọc lại được giá trị hiện tại), viết 37 test HTTP e2e mới (`cashier-shift-http.spec.ts`, đủ mở/chốt/khớp/lệch/race/quyền sở hữu/danh sách/duyệt/xử lý chênh lệch/sửa sau chốt/cách ly tenant), vá lỗ hổng `tenant-fixture.ts` thiếu dọn `cashier_shift` (vỡ FK khi test). Toàn bộ 594/594 test `apps/api` pass (2 flake đã biết, xác nhận riêng).

Verify Playwright qua Chrome thật (chủ dự án đồng thời tự dùng thử trên dev server, báo trực tiếp từng lỗi) phát hiện + sửa 5 vấn đề thật: (1) dialog "Chốt ca" tự đóng ngay sau khi chốt thành công, mất luôn màn hình phiếu in (do phụ thuộc dữ liệu sống thay vì snapshot); (2) mẫu in khổ A4/A5 lệch hẳn kích thước giấy thật (dùng px màn hình thay vì mm vật lý); (3) bản xem trước A4 bị flexbox co hẹp (thêm `shrink-0`); (4) không có nút thoát sau khi in (nút X bị ẩn nhầm ở màn hình thành công); (5) theo yêu cầu, bấm "In phiếu" giờ tự thoát dialog ngay sau khi hộp thoại in của trình duyệt đóng lại.

Đảo hướng thiết kế qua `AskUserQuestion`: bỏ hẳn việc bắt buộc "Mở ca" ngay khi vào "Danh sách cần thu" nếu chưa có ca mở (chủ dự án phản biện đúng — chốt ca xong không có lý do gì bắt mở ca mới ngay) — nay trang luôn xem được, chỉ chặn đúng lúc bấm "Thu tiền" (tự bật popup Mở ca, mở xong tự tiếp tục thu tiền), có thêm nút "Mở ca" chủ động.

Xem `docs/DECISIONS.md` #112, `docs/ERD.md` v1.39, `docs/product/prd.md` v1.3 (BIL-05).

Đã xác minh: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 480.68 kB, Playwright qua Chrome thật (mở ca → chốt ca → in 2 khổ đúng tỉ lệ vật lý → danh sách → duyệt phiếu → không bị ép mở ca lại).

### Verify Playwright: "Khoá bảng ca" theo tháng (work_shift_assignment, #110)

Việc còn treo ghi ở `docs/CURRENT.md` — verify qua Chrome thật cho cả 2 biến thể của banner khoá. `dev.admin` (có quyền `work_shift_assignment.unlock`): tháng trước bị khoá đúng (banner amber + nút "Sửa"), bấm "Sửa" mở khoá tạm thời (banner slate + "Khoá lại") và ghi được 1 ca thật vào tháng đã khoá; tăng `workShiftAssignmentLockGraceDays` lên 15 thì tháng trước tự mở khoá không cần bấm "Sửa", trả về 0 thì khoá lại ngay. Tạo riêng 1 vai trò + 1 tài khoản test qua HTTP API (sao chép ma trận `clinic_admin`, bỏ đúng quyền `unlock`) để xác nhận biến thể còn lại: banner khoá hiện nhưng KHÔNG có nút "Sửa", đúng thông báo liên hệ người có quyền. Không phát hiện bug mới. Đã dọn sạch dữ liệu test (ca/tài khoản/vai trò) và trả cấu hình về mặc định.

Xem `docs/DECISIONS.md` #110.

### Redesign khung tổng kết Thu ngân + đồng bộ popup xác nhận có số tiền

Khung tổng kết "Thu ngân" (`InvoiceListPage.tsx`) đổi sang dải "thẻ số liệu" hiện đại (icon tròn, nhãn hoa nhỏ, số đậm, ngăn viền dọc), khối "Còn chờ thu" tô nền đặc amber; 2 vòng chỉnh theo phản hồi trực tiếp (giảm độ đậm chữ số tiền, khối "Còn chờ thu" hết kéo giãn to). Thêm cột "Đã hoàn" vào bảng danh sách. Giải thích lại cách tính "Đã thu hôm nay"/"Thực thu" cho chủ dự án (logic gốc #085, không đổi).

Đồng bộ 3 popup xác nhận có hiện số tiền (`CancelEncounterDialog.tsx`, dùng chung 4 nơi; `RefundDialog` trong `InvoiceDetailPage.tsx`; `ReleaseEncounterDialog.tsx`) — 2 dialog sau đã lệch chuẩn `CancelEncounterDialog.tsx` (overlay/shadow/padding sai, `RefundDialog` còn thiếu `<form>` bọc — vi phạm quy tắc Enter-to-submit mục 4.4), đã sửa khớp lại. Đổi khung cảnh báo số tiền sang huy hiệu tròn đặc + nền nhạt (đúng khuôn "huy hiệu số" đã duyệt ở `DoctorEndShiftDialog.tsx`, #095) thay khung chữ viền nhạt cũ.

Xem `docs/DECISIONS.md` #111.

Đã xác minh: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 477.58 kB (không đổi bất thường), Playwright qua Chrome thật.

### "Khoá bảng ca" theo tháng (work_shift_assignment) — chuẩn bị nền cho chấm công/tính lương v2

Ngoài kế hoạch, chủ dự án yêu cầu trực tiếp. Lịch làm việc của tháng cũ bị khoá TOÀN BỘ (Thêm/Sửa/Xoá/Nhập Excel) sau một mốc "chốt bảng ca" cấu hình được theo tenant (`tenant_setting.work_shift_assignment_lock_grace_days`, mặc định 0 = khoá ngay khi sang tháng mới) — áp dụng cho MỌI actor kể cả `clinic_admin`, trừ ai có đặc quyền mới `work_shift_assignment.unlock` ("Sửa lịch đã khoá", cấu hình qua Vai trò & Phân quyền, mặc định seed `clinic_admin`/`system_admin`). Có quyền cũng KHÔNG tự động mở khoá giao diện — phải bấm nút "Sửa" tường minh mới lộ nút thao tác (chốt qua phản hồi trực tiếp chủ dự án, đảo hướng so với bản thiết kế đầu).

Phát hiện + sửa thêm giữa phiên: "Lịch làm việc nhân viên" hiện sai nhân viên theo thời gian — nhân viên mới tạo lộ ra ở tháng trước ngày tạo, nhân viên nghỉ việc bị mất khỏi cả tháng họ còn làm. Sửa bằng lọc theo `createdAt`/`updatedAt` (2 field mới, additive, `userAccountSummarySchema`).

Xem `docs/DECISIONS.md` #110.

Đã xác minh: `packages/core` `month-lock.spec.ts` mới (11/11, tổng 138/138), `apps/api` 549/557 pass + 7 skip (2 suite flake đã biết, pass 100% khi chạy riêng), `work-shift-assignment-http.spec.ts` chạy riêng 12/12 không regression, `pnpm -w typecheck/lint/build` sạch toàn workspace. Không có migration (chỉ thêm permission catalog + `tenant_setting` key). Đã `db:seed` + build lại + khởi động lại API, xác nhận qua `curl` thật. Chưa verify Playwright chính thức cho luồng khoá/mở khoá — chủ dự án đã tự test trực tiếp qua `pnpm dev` và phản hồi từng vòng.

### Fix: "Bộ phận Lễ Tân" (hành chính) lọt vào danh sách chọn "Chuyển vào hàng đợi" ở Tiếp nhận

Chủ dự án phát hiện lúc xem demo: `department` dùng chung cho tổ chức nhân sự (phân loại tuỳ chọn qua `department_type`, thuần mô tả) và điều phối "Hàng đợi ảo" (`encounter.departmentId`, #064) — `GET /departments/options` trả về mọi Khoa/Phòng active, không phân biệt lâm sàng/hành chính. Thêm cột `department.participatesInQueue` (mặc định `true`, tách khỏi `department_type` — dựa vào tên loại để lọc sẽ vỡ ngầm khi đổi tên) — checkbox "Nhận bệnh nhân / hiện trong Hàng đợi khám" trong form Thêm/Sửa Khoa-Phòng. `listActiveOptions()` lọc thêm điều kiện này; trang quản lý danh sách Khoa/Phòng không đổi, chỉ thêm cột hiển thị trạng thái. Xem `docs/DECISIONS.md` #105.

Đã xác minh: `user-account-hr-profile-http.spec.ts` +1 test, 550/557 test `apps/api` (7 skip do 1 flake `geo-http.spec.ts` đã biết), `pnpm -w typecheck/lint/build` sạch, `pnpm run db:check-schema` sạch. Migration đã áp lên Postgres dev. Chưa verify Playwright/trình duyệt thật.

### Badge trạng thái toàn app: nền nhạt → nền đặc

Chủ dự án phản hồi badge "Đang hoạt động"/"Có/Không" nhìn nhợt nhạt (gửi ảnh mẫu tham khảo) — sửa mẫu ở trang "Khoa/Phòng" cho xem trước, duyệt xong áp dụng toàn app theo đúng token "Tín hiệu Y tế" đã có sẵn ở `ui-guidelines.md` mục 2.1 (nền đặc `bg-emerald-500`/`bg-amber-500`/`bg-rose-600` + chữ trắng, vô hiệu `bg-slate-300`) — nhiều màn hình trước đó code sai thành nhạt. Component mới `shared/ui/StatusBadge.tsx`. Rà soát toàn `apps/web/src`, đổi ~15 vị trí (danh mục isActive, trạng thái lượt khám/lịch hẹn/phiếu thu, badge bác sĩ ở TopBar...), cố ý GIỮ NGUYÊN vài nơi khác bản chất (nền toàn ô lưới lịch hẹn cần nhạt để chữ đọc được, cảnh báo mềm ICD-10, banner/alert khung viền, chip phân loại không phải trạng thái). Ghi quy tắc bắt buộc vào `.claude/docs/ui-guidelines.md` mục 2.1a. Xem `docs/DECISIONS.md` #106.

Đã xác minh: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 477.56 kB (không đổi bất thường). Không đổi backend/schema.

### Fix: "Lịch làm việc nhân viên"/"Thông tin tài khoản" mất "Bộ phận Lễ Tân" khỏi bộ lọc Khoa (do #105 gây ra)

`GET /departments/options` là endpoint dùng chung nhiều nơi, không riêng điều phối "Hàng đợi khám" — #105 lọc cứng `participatesInQueue=true` ngay trong repository làm 2 nơi khác (`StaffWorkSchedulePage.tsx`, `MyAccountDialog.tsx`) mất luôn "Bộ phận Lễ Tân" khỏi kết quả. Sửa: endpoint mặc định trả TOÀN BỘ Khoa active như trước #105, thêm query param tường minh `queueOnly=true` chỉ dùng ở 3 nơi điều phối hàng đợi thật sự (`ReceptionIntakeForm.tsx`/`ReceptionDoctorQueuePage.tsx`/`DoctorQueueButton.tsx`). `StaffWorkSchedulePage.tsx` đổi hẳn sang `GET /departments` đầy đủ (an toàn vì trang này đã giới hạn chỉ `clinic_admin`). Xem `docs/DECISIONS.md` #107.

Đã xác minh: viết lại test #105 rộng hơn (14/14), 557/557 test `apps/api` (không flake), `pnpm -w typecheck/lint/build` sạch, chunk web 477.56 kB.

### "Lịch làm việc nhân viên" — chọn nhiều ngày theo từng dòng nhân viên (bulk-apply ca lặp lại cả tháng)

Chủ dự án nêu vấn đề: nhân viên có lịch cố định lặp lại cả tháng, bấm từng ngày để thêm ca rất tốn công. Cơ chế bulk-apply đã có sẵn (dùng ở "Lịch làm việc của tôi", #101/#102) nhưng chưa nối vào trang quản lý nhiều nhân viên. Thêm nút "Chọn nhiều ngày" riêng từng dòng (chỉ 1 dòng active cùng lúc, tránh áp nhầm ca cho người khác) + nút "Chọn cả tháng" chọn hết ngày còn lại trong 1 lần bấm + thanh công cụ "Áp dụng ca cho N ngày đã chọn" ở cuối trang. Không có API/migration mới — dùng lại nguyên `bulkCreateWorkShiftAssignment`/`useRowSelection`/`SelectionToolbar` đã có. Xem `docs/DECISIONS.md` #108.

Tiện thể gọn lại banner "Tự đăng ký ca đang bị tắt" ở "Lịch làm việc của tôi" (từ khung viền màu hổ phách sang chú thích chữ nhỏ màu xám — đây là trạng thái cấu hình chứ không phải cảnh báo khẩn) + đổi câu chữ theo yêu cầu chủ dự án.

Đã xác minh: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk `StaffWorkSchedulePage` 26.81 kB, chunk khởi động chính 477.56 kB (không đổi). Không đổi backend/schema.

Sửa thêm ngay sau đó: nút "Chọn nhiều ngày"/"Chọn cả tháng" lúc đầu viết tay không nền/viền, chủ dự án phản hồi khó thấy — đổi sang dùng `Button` component (`variant="primary"/"secondary"`) đúng quy tắc bắt buộc đã có.

### Fix: "Nhật ký hoạt động" hiện mã kỹ thuật thay tiếng Việt cho các module gần đây

Rà soát toàn bộ `writeAuditLog(...)` trong backend, phát hiện `ACTION_LABELS`/`ENTITY_TYPE_LABELS` (`packages/shared/src/audit/`) thiếu nhãn cho mọi module thêm sau ngày khảo sát gốc (29/08/2026): `work_shift`/`work_shift_assignment` (#101/#102), `doctor_availability` (#094), cộng 1 lỗi cũ hơn (`appointment.no_show` — action thật trong code nhưng dictionary có 2 khoá sai `marked_no_show`/`auto_no_show` chưa từng khớp) và thiếu `tenant_setting`/`user_account.self_updated`. Bổ sung 11 action + 4 entityType. Xem `docs/DECISIONS.md` #109.

Đã xác minh: `action-labels.spec.ts`/`entity-type-labels.spec.ts` +2 test (8/8), `pnpm -w typecheck/lint/build` sạch toàn workspace. Khởi động lại dev server để nạp bản `packages/shared` mới.

## 2026-09-02

### Redesign dialog "Đóng ca hôm nay"/"Tạm nghỉ" — bớt đổ bóng, huy hiệu số nổi bật, sửa câu mô tả

Chủ dự án phản hồi trực tiếp: 2 dialog `DoctorEndShiftDialog.tsx`/`DoctorBreakDialog.tsx` nhìn "quá AI"/đổ bóng nhiều, câu mô tả vô nghĩa. Mockup Artifact 3 phương án duyệt trước khi code (chốt "Phương án A — huy hiệu số"). Đổi `shadow-xl` → `shadow-md ring-1 ring-slate-200` (nhẹ tay hơn, vẫn nổi khỏi overlay); khối "Còn N lượt khám chưa xử lý" đổi từ khung viền/nền vàng nguyên khối sang huy hiệu số tròn đặc màu (`bg-amber-400`) + nền rất nhạt không viền — số liệu là điểm nhấn đầu tiên đập vào mắt thay vì chìm trong câu chữ. Sửa 2 câu: placeholder ví dụ lý do "hết giờ làm" ở dialog Đóng ca (vô lý — trường hợp đó đã có dialog riêng tự bật) → "có việc đột xuất, cần rời phòng khám sớm..."; câu mô tả dialog Tạm nghỉ "bạn sẽ tạm không được điều phối ca khám mới" (thuật ngữ hệ thống, câu bị động) → "bạn chỉ tạm ngừng nhận ca khám mới" (khớp văn phong dialog kia). Phạm vi CHỈ 2 dialog này — 3 dialog xác nhận khác (`CancelEncounterDialog`/`ReleaseEncounterDialog`/`BreakGlassDialog`) vẫn giữ đúng `shadow-xl` theo `.claude/docs/ui-guidelines.md` mục 2.2, chưa đổi.

Đã xác minh: `pnpm -w typecheck/lint/build` sạch, chunk web không đổi (477.58 kB). Playwright qua Chrome thật (tài khoản bác sĩ test tạo qua HTTP API, kèm 1 lượt khám test để thấy huy hiệu số) — cả 2 dialog hiển thị đúng như mockup đã chốt, đã huỷ lượt khám + vô hiệu hoá tài khoản test sau khi kiểm.

### "Cấu hình chung" — công tắc bật/tắt tự đăng ký ca cho nhân viên

Làm nốt việc còn treo cuối phiên #104. Mục con mới "Cấu hình chung" trong pill "Cấu hình phòng khám" (dưới "Ca làm việc") — 1 công tắc `allowStaffSelfScheduleEnabled` (`tenant_setting`, mặc định `true` — giữ nguyên hành vi hiện tại), đọc/ghi qua `GET/PATCH /clinic-settings` có sẵn (không permission mới). Thêm chiếu tối thiểu tự-phục vụ `GET /clinic-settings/allow-staff-self-schedule-enabled` (đúng khuôn `deferred-payment-enabled`) để `MyWorkSchedulePage.tsx` đọc được dù không có `clinic_config.read`. Tắt: `WorkShiftAssignmentService` chặn `create`/`bulkCreate`/`copy`/`remove` cho scope `personal` (lỗi mới `WORK_SHIFT_ASSIGNMENT_SELF_SCHEDULE_DISABLED`, 403) — `list()` và scope `global` (clinic_admin ở "Lịch làm việc nhân viên") không bị ảnh hưởng; trang "Lịch làm việc của tôi" ẩn hết nút tự đăng ký/xoá/chọn nhiều ngày/sao chép, chỉ còn xem lịch đã phân công + banner cảnh báo.

Đã xác minh: `apps/api` +7 test (`clinic-http.spec.ts`, `work-shift-assignment-http.spec.ts`), 538/540 test không regression (2 flake `geo-http.spec.ts`/`icd10-http.spec.ts` đã biết, pass 100% khi chạy riêng), `pnpm -w typecheck/lint/build` sạch (chunk web 477.58 kB). Playwright qua Chrome thật (dùng lại dev server đang chạy sẵn, tài khoản `dev.admin`): tắt công tắc → banner + ẩn hết nút tự đăng ký đúng ngay; bật lại → nút hiện lại đúng, dữ liệu ca cũ giữ nguyên. Không migration/schema mới.

### Vá permission `work_shift.read` thiếu, redesign "Lịch làm việc nhân viên" sang xem-theo-tháng, thêm Nhập/Xuất Excel — xem `docs/DECISIONS.md` #104

Tiếp ngay sau bug "Lịch làm việc của tôi" (mục dưới): phát hiện thêm bug RBAC nghiêm trọng hơn — `GET /work-shifts` đòi `clinic_config.read` (chỉ `clinic_admin`) khiến 4/5 vai trò bị 403 hoàn toàn ngay khi vào trang, dù tính năng tự đăng ký ca dành cho MỌI nhân viên. Sửa bằng permission riêng `work_shift.read` (global, cấp cho 4 vai trò thường + clinic_admin).

- Xác minh cơ chế khoá lịch (canEdit + chặn xoá 409 `WORK_SHIFT_ASSIGNMENT_LOCKED`) hoạt động đúng qua test thật với tài khoản bác sĩ (chưa từng verify trước đó).
- Redesign toàn diện "Lịch làm việc nhân viên": màu phủ toàn thẻ ca (áp dụng cả "Lịch làm việc của tôi"), tên NV kèm mã (bỏ avatar), viền lưới rõ hơn, tiêu đề cột "Thứ hai ⓵" kiểu mới, đổi từ xem-theo-tuần sang **xem nguyên 1 tháng** (cột tên cố định + cuộn ngang, nút "Cuộn tuần"). 1 bug dựng-rồi-sửa: `scroll-snap-type` xung đột với cột `sticky` (lỗi Chromium đã biết) — bỏ snap tự động, thay nút cuộn chủ động.
- Tính năng mới: Nhập/Xuất Excel cho "Lịch làm việc nhân viên" — đổi định dạng file giữa chừng từ hàng-dọc sang **bảng ngang** (cột = ngày trong tháng) theo yêu cầu trực tiếp; tháng luôn chọn tường minh ở UI, không dò từ file. Dùng `exceljs` (backend-only).
- Loạt chỉnh sửa text nhỏ: đổi nhãn/mô tả ở nhiều pane cấu hình cho khớp thực tế.

Đã xác minh: `pnpm -w typecheck/lint` sạch, build web sạch (477.25 kB), 533/533 test `apps/api` không regression, Playwright + API test cho toàn bộ luồng mới. Không có migration/schema DB mới. **Còn treo, chưa code**: mục "Cấu hình chung" mới (dưới "Ca làm việc") + công tắc bật/tắt tự đăng ký ca cho nhân viên — xem `docs/CURRENT.md`.

### Fix "Lịch làm việc của tôi" hiện nhầm ca của TẤT CẢ nhân viên thay vì chỉ của chính actor

Phát hiện khi tạo dữ liệu demo nhiều tài khoản cùng có ca trong tuần (trước giờ chỉ verify với 1 tài khoản/lần nên chưa lộ). Nguyên nhân: `MyWorkSchedulePage.tsx` gọi `useWorkShiftAssignmentsQuery` không truyền `userId` — với actor có `work_shift_assignment.read=global` (`clinic_admin`), backend không có gì để lọc theo actor nên trả về ca của toàn bộ tenant thay vì chỉ của người đang đăng nhập. Sửa: truyền tường minh `userId = user.id` (từ `useAuthStore`) vào query, đúng ý nghĩa "của tôi" bất kể data_scope là `personal` hay `global`. Chỉ đổi frontend, không đổi API/schema.

Đã xác minh: `pnpm -w typecheck`/`lint` sạch, Playwright qua Chrome thật xác nhận trang chỉ còn hiện đúng ca của actor đang đăng nhập.

### Verify Playwright #102, làm nốt "Tháng" (Month view), sự cố seed thiếu permission, badge "Có ca hôm nay" ở Tiếp nhận — xem `docs/DECISIONS.md` #103

Quay lại việc treo đầu phiên (`docs/CURRENT.md` mục "Đang chờ"): verify Playwright cho "Ca làm việc" Giai đoạn 2.

- **Phát hiện + sửa 2 vấn đề thật**: (1) nút "Chọn nhiều ngày" của mockup không tồn tại — checkbox hiện luôn thay vì ẩn theo chế độ; (2) permission `work_shift_assignment.*` chưa từng seed vào DB dev (bug vận hành lặp lại #087/#089) — rebuild `packages/core` + `db:seed` + sync role_permission, xác nhận qua API.
- **Làm "Tháng" (Month view)** — hoãn ở #102, giờ làm theo yêu cầu trực tiếp, mở rộng hơn mockup gốc: chọn nhiều ngày + đăng ký ca + "Sao chép tháng trước" ngay trong Tháng (không cần quay về Tuần).
- Bỏ dropdown `ActionMenu` cho "Sao chép..." — mỗi view giờ chỉ 1 hành động sao chép, hiện thẳng nút.
- Redesign khung Tuần/Tháng qua 2 vòng phản hồi trực tiếp: bọc thẻ trắng bo góc + đổ bóng, "Hôm nay" tô nền xanh đậm, cuối tuần tông xám riêng, nút thêm ca dùng `Button variant="add"` thay viết tay.
- Bổ sung 2 chỗ mockup có nhưng code #102 bỏ sót: bộ lọc Khoa + tìm bác sĩ ở "Lịch làm việc nhân viên"; dòng "Chưa đăng ký ca — theo giờ chung" ở lưới Lịch hẹn.
- **Quyết định kiến trúc**: Tiếp nhận **không lọc, không chặn cứng** bác sĩ theo "có ca hôm nay" — chỉ **đánh dấu** badge + **xác nhận nhẹ** (không chặn) khi công tắc "Chặn đặt lịch ngoài ca" đang bật, đúng nhất quán với quy tắc đã chốt ở lưới Lịch hẹn (#102 điểm 5).
- Đổi câu mô tả công tắc "Chặn đặt lịch ngoài ca đã đăng ký"; dời trường "Lý do tiếp nhận" lên trên "Chuyển vào hàng đợi".
- **Đã xác minh**: `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web không đổi bất thường (476.57 kB), Playwright qua Chrome thật.

### Xác nhận lại bug CORS #100 đã vá thành công trên máy pilot thật

Chủ dự án build lại + cập nhật đúng máy đã gặp lỗi — đăng nhập bình thường. Hết treo, xem `docs/DECISIONS.md` #100.

### Định nghĩa lại "ca khám" cho thông báo tự động hết giờ — CHỐT: giữ nguyên hành vi hiện tại

Sau khi cân nhắc các phương án đã phân tích ở phiên trước, chủ dự án chọn giữ nguyên `useClosingTimeReminder` như hiện có, không sửa gì. Hết treo.

### Danh mục "Ca làm việc" — Giai đoạn 1 (thêm/sửa/xoá mẫu ca) — xem `docs/DECISIONS.md` #101

Chủ dự án hỏi lại tính năng "Ca làm việc riêng từng bác sĩ" (từng lùi ở #030). Hỏi rõ mục đích qua `AskUserQuestion` — mô hình đủ 2 tầng (danh mục mẫu ca → bác sĩ đăng ký theo tuần/tháng → lọc lưới Lịch hẹn + chặn đặt lịch ngoài ca), sau đó chủ dự án thu hẹp việc làm ngay xuống đúng **Giai đoạn 1: danh mục mẫu ca**.

- Dùng EnterPlanMode (3 agent Explore song song) + mockup Artifact duyệt 3 vòng trước khi code.
- **Đổi kiến trúc giữa chừng lúc duyệt mockup**: đề xuất đầu tái dùng `reference_catalog` — phát hiện đó là danh mục **toàn hệ thống** (không `tenant_id`), sai bản chất cho dữ liệu riêng từng phòng khám. Chốt lại: bảng MỚI `work_shift`, **tenant-scoped**, cùng khuôn `room`/`department` (migration `20260902090000_work_shift`).
- 9 trường (chốt qua 2 vòng bổ sung trực tiếp): tên, mã tự sinh, giờ bắt đầu/kết thúc, màu (8 giá trị cố định — không color-picker tự do), giờ nghỉ giữa ca (tuỳ chọn, độc lập với), tổng thời gian nghỉ (nhập giờ hoặc phút), số giờ công chuẩn (nhập giờ).
- Modal riêng `WorkShiftFormModal.tsx` theo Boxed Section Form Pattern (3 khối: Thông tin chung/Giờ làm việc/Giờ nghỉ giữa ca) — sửa lại từ bản mockup đầu bị chủ dự án bác vì xếp input thành 1 cột dọc (vi phạm `.claude/docs/ui-guidelines.md` mục 4.1).
- Mục con mới "Ca làm việc" trong Cấu hình hệ thống → Cấu hình phòng khám (`ClinicConfigPage.tsx`).
- Không permission mới — dùng lại `clinic_config.read`/`.update`.
- **Đã xác minh thật**: `work-shift-http.spec.ts` mới (10/10 — CRUD, validate giờ endTime<=startTime/giờ nghỉ ngoài khoảng ca → 422, sai định dạng → 400, cách ly tenant), tổng 535 test `apps/api` + 127 `packages/core` pass, không regression. `pnpm -w typecheck/lint/build` sạch toàn workspace. Playwright qua Chrome thật: thêm ca đủ 9 trường → hiện đúng (chấm màu, mã tự sinh) → sửa → validate giờ chặn đúng tại chỗ. Dữ liệu test đã xoá sạch.
- **Chưa làm** (Giai đoạn 2, chưa thiết kế chi tiết): bác sĩ đăng ký ca theo tuần/tháng, bảng lịch làm việc toàn thể nhân viên, lọc cột bác sĩ ở lưới Lịch hẹn, chặn đặt lịch ngoài ca.

## 2026-09-01

### S4-07 cài pilot thật thành công; S4-08 — vá bug thật do pilot báo cáo — xem `docs/DECISIONS.md` #100

Chủ dự án xác nhận **S4-07 (cài đặt tại pilot) đã cài thành công**. Ngay sau đó phát sinh việc đầu tiên của S4-08/S5-01 (vá lỗi từ pilot thật): cập nhật lên bản `2026.09.05` xong, đăng nhập báo lỗi chung chung. DevTools xác nhận **CORS error**, response OPTIONS đến từ `Microsoft-IIS/10.0` — request rơi vào IIS có sẵn trên Windows đang chiếm cổng 80, không tới container `web`.

- Nguyên nhân: `install.ps1`/`install.sh` hỏi lại "Địa chỉ IP LAN" và **ghi đè** `WEB_ORIGIN`/`config.json.apiBaseUrl` ở MỌI lần chạy (khác các bí mật khác chỉ sinh khi `.env` chưa có) — lần cập nhật đã xoá mất workaround cổng `8080` máy đó từng chỉnh tay để né xung đột cổng 80, khiến trình duyệt gọi nhầm sang cổng 80 (IIS) dù container `web` vẫn `healthy` bình thường ở cổng đúng.
- Sửa: `WEB_ORIGIN`/`apiBaseUrl` giờ chỉ hỏi/ghi ở lần cài đầu tiên hoặc khi truyền rõ `-WebOrigin`/`--web-origin` — các lần cập nhật sau giữ nguyên giá trị đang chạy thật. Cập nhật `docs/Deploy.md` 2.3b đính chính khẳng định sai trước đó ("an toàn, không đụng `.env`/`config.json`" — đúng với việc giải nén, sai với chính bước script tự ghi).
- **Chưa verify lại trên máy pilot thật** — cần chủ dự án build lại + cập nhật để xác nhận đăng nhập được; trước mắt có thể tự sửa tay `config.json.apiBaseUrl` đúng cổng `web` đang chạy (xem `docker compose ps`) rồi `docker compose restart web`.

### Diễn tập phục hồi thật (S6-02) — sửa bug thật chặn restore hoàn toàn — xem `docs/DECISIONS.md` #099

Chủ dự án hỏi trực tiếp "làm sao restore" — lần đầu dự án thực sự kiểm chứng chiều khôi phục (trước chỉ có chiều tạo backup tự động, S6-02 vẫn "chưa làm" theo `docs/Deploy.md`).

- Test thật: dựng stack riêng, tạo tenant, `pg_dump -Fc` (đúng lệnh `backup.sh` dùng), mô phỏng "máy hỏng" (`docker compose down -v`), thử `pg_restore` — **thất bại 29 lỗi**, `function unaccent(text) does not exist`.
- Nguyên nhân thật: `nexamed_unaccent_lower()` (migration S2-02) gọi `unaccent(input)` không ghi rõ schema — bình thường chạy đúng (search_path mặc định có `public`), nhưng `pg_restore` cố ý đặt `search_path=''` (vá bảo mật CVE-2018-1058 của Postgres) khiến tên hàm không resolve được. Loại trừ nhiều hướng sai trước khi tìm ra (không phải `--clean`, không phải thiếu extension, không phải thứ tự TOC) — tìm bằng đọc trực tiếp script SQL thật (`pg_restore -f -`).
- Sửa: migration mới `20260901120000_fix_unaccent_search_path` (`public.unaccent`, forward-only). Rà soát toàn bộ migration khác — chỉ đúng 1 chỗ dính lỗi này.
- **Giới hạn đã biết**: backup tạo TRƯỚC khi máy cập nhật fix này vẫn "chụp" lại hàm lỗi cũ, restore vẫn cần 1 lệnh sửa tay (đã ghi vào `docs/Deploy.md` 2.3c).
- **Đã xác minh thật**: áp fix → dump lại → xoá schema → restore 0 lỗi → dữ liệu đúng nguyên bản → đăng nhập thật qua nginx `200`; build lại ảnh `nexamed-api`, test cả 2 kịch bản (cài mới, cập nhật từ bản đang chạy có dữ liệu) qua đúng cơ chế tự động `prisma migrate deploy` — không cần can thiệp tay ở cả 2.
- Thêm `docs/Deploy.md` mục 2.3c (hướng dẫn restore từng bước) + 2.3d (bảng tra cứu lệnh Docker cần biết).

### Cải thiện tiếp on-prem sau phản hồi trực tiếp — xem `docs/DECISIONS.md` #098

- `build-and-export.ps1` đổi sang tự động gom sẵn 1 thư mục `deploy/on-prem/package/` chứa đủ mọi file cần gửi máy khách — trước đó phải tự nhặt 5 file rải rác, dễ nhầm lẫn.
- Viết lại toàn bộ `docs/Deploy.md` mục 2.3 theo phong cách numbered step-by-step sau phản hồi "file deploy viết rất khó hiểu, không làm theo được" — thêm mục "Xử lý sự cố thường gặp" ghi lại đúng 2 lỗi thật gặp khi tự làm theo (giải nén `.zip` lồng thêm 1 lớp thư mục, cổng 80 bị chiếm trên máy khách kèm hệ quả lỡ chạy `docker compose up -d` trực tiếp bỏ lỡ bước tạo tài khoản quản trị).

### Sửa mô hình phân phối on-prem: build ở máy dev/CI, máy khách chỉ nhận ảnh Docker đã build sẵn — xem `docs/DECISIONS.md` #098

Chủ dự án phát hiện đúng vấn đề: cách S4-05 (#097) làm — copy toàn bộ source code sang máy khách rồi `docker compose build` tại chỗ — làm lộ mã nghiệp vụ `.ts`, `.git`, và tài liệu nội bộ (`.claude/docs/`, `docs/DECISIONS.md`, `docs/CURRENT.md`, kể cả 1 sự cố bảo mật thật đã ghi lại) cho bất kỳ ai truy cập máy khách. Không chấp nhận được với phần mềm thương mại.

- Đã bàn 3 phương án qua thảo luận trực tiếp: `docker save`/`docker load` qua file `.tar`, private registry, lọc bớt file nhạy cảm nhưng vẫn build tại máy khách — chốt **`docker save`/`docker load`** (không cần internet/registry ở máy khách, đúng quy mô 1 pilot, mở rộng sang registry sau này không phải sửa lại Dockerfile/compose).
- `deploy/on-prem/docker-compose.yml`: 4 service đổi `build:`→`image: nexamed-<tên>:${NEXAMED_VERSION:?...}`. `deploy/on-prem/build-and-export.ps1` mới (chạy ở máy dev/CI — build 3 ảnh + `docker save`/gzip). `install.ps1`/`install.sh`: bước build đổi thành nạp ảnh (`docker load` + xác minh bằng `docker image inspect`, tự nhận diện version nếu chỉ có 1 bộ trong `images/`).
- **Dung lượng thật đo được**: `nexamed-api` 1.66GB raw → nén gzip chỉ 358.6MB; tổng cả 3 ảnh ~532MB — nhẹ hơn nhiều so với lo ngại ban đầu, đủ nhẹ để chuyển USB/mạng nội bộ. Đã hỏi có cần tối ưu multi-stage build (giảm thêm được) không — chốt **giữ nguyên**, chưa cần ở quy mô 1 pilot.
- **4 bug thật phát hiện lúc khảo sát/verify** (không phải suy luận, TẤT CẢ chưa từng lộ ở #097 vì lần đó verify bằng Docker thủ công): (1) `context: ..` trong compose cũ resolve sai thành `deploy/` thay vì gốc repo — tự biến mất vì bỏ hẳn `build:`; (2) `install.ps1`/`build-and-export.ps1` fail parse trên Windows PowerShell 5.1 do thiếu BOM UTF-8 (file chứa tiếng Việt/dấu "—"); (3) `New-RandomSecret()` dùng `[RandomNumberGenerator]::Fill()` — static method chỉ có ở .NET Core/5+, không có ở .NET Framework mà PowerShell 5.1 chạy trên đó — sửa sang `.Create()`+`.GetBytes()`; (4) logic tự nhận diện version đọc nhầm "0.0.1-test" thành "0" do PowerShell tự bung mảng-1-phần-tử thành chuỗi — sửa bằng bọc `@(...)`.
- Case NAS Synology DS423 (ARM Realtek RTD1619B, RAM 2GB — dưới ngưỡng tối thiểu 4GB đã chốt) nêu ra lúc bàn bạc — quyết định mặc định chỉ build `linux/amd64`, chưa đầu tư `arm64` (tham số `-Platform` sẵn sàng khi cần).
- **Đã xác minh thật toàn bộ chu trình 2 giai đoạn** (không dừng ở đọc code): build thật 3 ảnh qua `build-and-export.ps1` → giả lập đúng máy khách (thư mục riêng ngoài repo, xác nhận không có file `.ts`/`.git`/`docs`) → `install.ps1` qua Windows PowerShell 5.1 thật (phát hiện+sửa 3 bug ngay lúc chạy) → `docker load`+`docker compose up -d` cả 5 container `healthy` → tạo tenant thật → **đăng nhập thật qua nginx proxy trả `200`+token đúng**. Đã dọn sạch container/volume/image/file test sau khi xong.
- Cập nhật `docs/Deploy.md` (Phần 2 viết lại), `.dockerignore`/`.gitignore` gốc, `docs/CURRENT.md`, `docs/TASK.md`.

TopBar: tách "Tạm nghỉ/Đóng ca" ra bánh răng riêng + "Thông tin tài khoản" popup tự xem/sửa hồ sơ — xem `docs/DECISIONS.md` #095/#096:

- Bánh răng (`GearSix`, Phosphor) mới cạnh avatar — chỉ hiện khi `isDoctor` VÀ đang ở `/reception/doctor-queue` hoặc `/encounters/:id`, chứa "Tạm nghỉ"/"Đóng ca hôm nay" (hoặc "Quay lại làm việc"/"Mở lại ca làm việc") — y nguyên logic 3 trạng thái từ #094, chỉ đổi nơi chứa. Avatar rút lại đúng 1 mục "Đăng xuất". Chấm trạng thái BREAK/ENDED chuyển từ avatar sang bánh răng. 3 badge chip (quá giờ/tạm nghỉ/đóng ca) giữ nguyên hiện mọi trang.
- Mục "Thông tin tài khoản" mới trong menu avatar — mở popup (không phải trang riêng) cho tài khoản đang đăng nhập tự xem hồ sơ đầy đủ + sửa đúng 4 trường liên hệ (SĐT/Email/Ngày sinh/Giới tính) + đổi mật khẩu (bắt mật khẩu hiện tại + xác nhận mật khẩu mới trùng khớp ở FE, tái dùng nguyên `POST /auth/change-password` có sẵn). Mọi trường hồ sơ nhân sự/pháp lý khác khoá cứng, chỉ Quản trị sửa qua `PATCH /users/:id` có sẵn.
- Backend mới: `GET/PATCH /api/v1/users/me` (tự-phục vụ, không qua `PermissionGuard`, mọi vai trò dùng được) + `updateOwnProfileRequestSchema` (`packages/shared`) giới hạn đúng 4 trường, tách hẳn khỏi DTO admin.
- Cả 2 thay đổi đều duyệt qua mockup Artifact nhiều vòng (so sánh Trước/Sau, thử tương tác trực tiếp) trước khi code, theo yêu cầu trực tiếp của chủ dự án.
- Tách `getInitials()` ra `apps/web/src/shared/format/initials.ts` (dùng chung lần 2 — `TopBar.tsx` + `MyAccountDialog.tsx` mới).
- **Đã xác minh**: `user-account-me-http.spec.ts` mới (5/5, tách file riêng tránh vượt rate-limit login `/auth/login`), tổng 80/80 test module `iam` pass, không regression. `pnpm -w typecheck/lint/build` sạch toàn workspace, chunk web 473.29 kB (dưới ngưỡng 500 kB, `MyAccountDialog` tách chunk lazy riêng 13.73 kB). Playwright qua Chrome thật (`hoang.tran`, dữ liệu/mật khẩu khôi phục đúng giá trị gốc sau khi kiểm): bánh răng hiện/ẩn đúng theo trang, sửa SĐT lưu/đóng-mở lại đúng, đổi mật khẩu thật (rồi đổi lại) thành công, validate xác nhận mật khẩu đúng.
- Cập nhật `docs/CURRENT.md`, `docs/TASK.md`, `docs/DECISIONS.md` (#095, #096).

**Ngoài kế hoạch, cùng ngày** — thảo luận định nghĩa lại "ca khám" cho thông báo tự động hết giờ/Đóng ca (tránh nhắc bác sĩ chỉ đăng nhập làm việc khác) — **chủ động gác lại, chưa code**. Xem `docs/CURRENT.md` mục "Đang chờ".

**Cùng ngày, chuỗi chỉnh sửa nhỏ trực tiếp trên bản chạy thật** — đổi câu mô tả khung "Đổi mật khẩu" ở popup "Thông tin tài khoản" cho rõ nghĩa hơn; đổi độ đậm tên tài khoản trong header cùng popup từ `font-extrabold`→`font-bold` (lặp lại đúng lỗi đã sửa ở #090, ghi thành quy tắc ghi nhớ để không lặp lại lần 3); thêm icon (`Clock`/`Stethoscope`/`CheckCircle`, màu khớp viền từng cột) trước tiêu đề 3 cột "Hàng đợi khám", tăng cỡ icon/chữ tiêu đề đó lên 1-2 bậc theo yêu cầu.

### S4-05 (đóng gói on-premise) + phần code S4-06 — xem `docs/DECISIONS.md` #097

Toàn bộ tính năng nghiệp vụ Sprint 5/6 đã xong nhưng chưa từng đóng gói/cài đặt on-prem thật (S4-05→08 treo từ Sprint 4) — pilot chưa từng chạy ngoài Playwright giả lập. Máy chủ pilot đầu tiên xác nhận là **PC thường tại phòng khám, chưa có server nội bộ** — ưu tiên trường hợp này, thiết kế dùng chung được cho NAS/máy chủ chuyên dụng sau này.

- `deploy/on-prem/` mới: `docker-compose.yml` (5 service — `postgres`/`migrate`/`api`/`web`/`backup`), `apps/api/Dockerfile` + `apps/web/Dockerfile`, `backup/Dockerfile`+`backup.sh` (`pg_dump -Fc` hằng ngày + tự dọn quá hạn), `install.ps1` (Windows PC) + `install.sh` (Linux/NAS) — tự sinh bí mật, build+up, chờ `api` healthy, hướng dẫn/tạo tenant pilot đầu tiên.
- `GET /health` mới (loại khỏi prefix `api/v1`) cho Docker healthcheck. Script sản xuất `apps/api/scripts/seed-pilot-tenant.ts` (khác `seed-dev-tenant.ts` chỉ dev) + `rotate-app-role-password.ts` (đổi mật khẩu role `nexamed_app` khỏi giá trị hard-code trong migration, #010).
- `docs/pilot-onboarding.md` mới (S4-06 phần tài liệu) — hướng dẫn sử dụng + giáo án đào tạo 2 giờ theo vai trò (lễ tân/bác sĩ/quản trị), cho nhân viên phòng khám.
- **1 bug thật phát hiện lúc verify container end-to-end**: cookie `refresh_token` gắn `Secure` theo `NODE_ENV==='production'`, bị trình duyệt âm thầm bỏ qua trên origin `http://` (on-prem PC/NAS mặc định không TLS) → refresh hỏng không báo lỗi, nhân viên bị đăng xuất mỗi 15 phút. Sửa bằng biến `COOKIE_SECURE` mới, tách khỏi `NODE_ENV`, mặc định `false` ở on-prem.
- **Đã xác minh thật**: build + CHẠY cả 2 ảnh Docker thật (không dừng ở đọc Dockerfile) — dựng full stack thật trên network cô lập, đăng nhập thật qua nginx proxy, `GET /health` 200 qua HTTP thật, `docker inspect` xác nhận `healthy`. `apps/api` 518/525 pass + 7 skip (1 file flake `geo-http.spec.ts` đã biết, pass 100% khi chạy riêng), `pnpm -w typecheck` sạch.
- Còn treo: S4-07 (cài đặt thật tại pilot)/S4-08 (đệm lỗi) — cần phòng khám pilot cụ thể; S6-01→04/S6-07 (cảnh báo backup, diễn tập phục hồi, audit bảo mật, đo hiệu năng, tài liệu vận hành đầy đủ) — thuộc Sprint 6.
- Cập nhật `docs/CURRENT.md`, `docs/TASK.md`, `docs/DECISIONS.md` (#097), `docs/Deploy.md` (viết lại Phần 2).
