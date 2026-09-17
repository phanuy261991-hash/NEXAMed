# Handoff — Kho Thuốc GĐ3, sửa lỗi sau verify (17/09/2026)

## Tóm tắt 1 câu

Đã gỡ xong `autoDispenseOnSignEnabled` (sai thiết kế) + sửa xong 3 lỗ hổng mockup + làm xong nhóm hiển thị hoá đơn (đã verify Playwright thật cho 4 việc này), nhưng đang **DỞ DANG giữa chừng** việc thứ 5 ("tách nhiều lô") — `apps/web` **hiện đang lỗi biên dịch TypeScript, chưa build được** — dừng theo yêu cầu chủ dự án, chưa kịp sửa nốt.

## Vì sao có phiên này

Tiếp nối trực tiếp `docs/handoffs/HANDOFF-KhoThuoc-GD3-2026-09-17.md` (GĐ3 code+test xong, `docs/DECISIONS.md` #164) — phiên này lẽ ra chỉ để verify Playwright, nhưng chủ dự án hỏi trực tiếp 1 câu thực tế lúc xem qua code trước khi verify: *"phòng khám 1 bác sĩ, khách chỉ lấy 2/3 loại kê thì `autoDispenseOnSignEnabled` xử lý sao?"* — soi ra tính năng này tự động trừ kho ĐỦ số lượng đã kê ngay lúc ký, không hỏi lại ai, sai hoàn toàn với thực tế (khách quyết định lấy gì là lúc trao đổi tại quầy, không phải lúc bác sĩ ký đơn). Từ đó dẫn tới chuỗi sửa liên tiếp, xem chi tiết đầy đủ ở `docs/DECISIONS.md` #165.

## Việc ĐÃ XONG (đã xác minh Playwright thật, có thể tin dùng)

1. **Gỡ hẳn `autoDispenseOnSignEnabled`** — xoá sạch backend (port/repository/service/controller/schema/module wiring 2 chiều `EncounterModule↔InventoryModule`), frontend (`PaymentConfigPane.tsx`), test liên quan.
2. **Nút "Phát thuốc" ở màn khám** — đổi gate từ tính năng đã gỡ sang tái dùng `soloClinicWorkflowEnabled` có sẵn (`PrescriptionPanel.tsx`).
3. **3 lỗ hổng so với mockup gốc, sửa xong**: checkbox bỏ chọn từng dòng thuốc kê (khách chỉ lấy 1 phần), dòng "Đã phát đủ" hiện read-only thay vì ẩn, nút "Xem hoá đơn" ở màn thành công (ẩn/hiện đúng theo quyền `invoice.read`).
4. **Nhóm hiển thị hoá đơn + xem đúng hoá đơn DRUG riêng** — `?invoiceId=` tuỳ chọn ở `GET /billing/invoices/:encounterId`, bảng dòng nhóm "Dịch vụ khám"/"Tiền thuốc — Phiếu xuất ..." (chỉ hiện khi ≥2 nhóm), khối tham chiếu chéo giữa các hoá đơn cùng lượt khám.

**Xác minh**: `pnpm -w typecheck/lint/build` sạch toàn workspace (tại thời điểm này, TRƯỚC việc 5); `apps/api` 844 pass + 11 skip (1 flake `icd10-http.spec.ts` đã biết). Playwright qua Chrome thật (2 tài khoản `test.gd3.doctor`/`dev.admin` tạo qua HTTP API) xác nhận đúng cả 4 việc trên, kể cả ảnh chụp thật cho thấy 1 hoá đơn nhóm đúng 2 phiếu xuất khác nhau với subtotal đúng.

## Việc DỞ DANG (KHÔNG dùng được, đang lỗi)

### 5. Tách "1 loại thuốc phát từ nhiều lô cùng lúc" (đúng mockup)

**Lý do làm**: sau khi xem ảnh Playwright thật, chủ dự án nhận xét dialog "Phát thuốc" khác mockup đã duyệt khá nhiều (thiếu phụ đề, nút đóng, badge, và quan trọng nhất — mockup cho 1 thuốc tách phát từ NHIỀU lô cùng lúc khi 1 lô không đủ, code chỉ cho chọn đúng 1 lô/dòng). Chủ dự án chọn "làm tất cả" (cả phần hình thức lẫn phần tách nhiều lô).

**Đã làm**:
- **Backend** (`apps/api/src/modules/inventory/stock-issue.service.ts`, hàm `buildAndValidateLines()`): phát hiện + sửa 1 lỗ hổng THẬT — kiểm "không vượt số đã kê"/"đủ tồn theo lô" trước đây tính ĐỘC LẬP TỪNG DÒNG, không cộng dồn trong CÙNG 1 request. Đã sửa bằng 2 map `claimedByItem`/`claimedByStockKey` cộng dồn ngay trong vòng lặp. **Phần backend này ĐÃ ĐÚNG, không lỗi, chỉ CHƯA CÓ TEST cho 2 kịch bản mới** (2 dòng cùng `prescriptionItemId` khác lô cộng đúng; 2 dòng cùng `(drugId,batchId)` không vượt tồn thật).
- **Frontend** (`apps/web/src/features/inventory/DispensePrescriptionDialog.tsx`): viết lại toàn bộ — `DraftLine.batchId/quantity` (1 lô) đổi thành `DraftLine.batchRows: {batchId,quantity}[]` (nhiều lô), tự tách theo FEFO lúc nạp (`autoSplitFefo()`), mỗi dòng lô có Combobox đổi lô + input số lượng + nút xoá dòng, nút "+ Đổi/thêm lô khác". Đồng thời sửa luôn phần hình thức (subtitle "Đã ký lúc...", nút đóng ✕, badge "Quản lý theo lô"/"Không quản lý lô", dialog rộng hơn `max-w-4xl` 2 cột thẻ thuốc, footer chú thích, nút đổi màu/label theo mockup).

**LỖI CHƯA SỬA — `pnpm -w typecheck` (apps/web) đang FAIL với đúng 2 lỗi**, cả hai đều trong `DispensePrescriptionDialog.tsx`:

1. **`autoSplitFefo()`, dòng ~73**: `batches[0].batchId` — TS báo "Object is possibly undefined" dù trước đó đã kiểm `batches.length > 0`. Nguyên nhân: TS không narrow được qua điều kiện kép `if (rows.length === 0 && batches.length > 0)`. **Cách sửa**: gán biến trung gian rồi kiểm riêng, ví dụ:
   ```ts
   if (rows.length === 0) {
     const first = batches[0];
     if (first) rows.push({ key: crypto.randomUUID(), batchId: first.batchId, quantity: '0' });
   }
   ```

2. **`handleSubmit()`, khối `lines: submittedLines.flatMap(...)`**: nhánh ternary (`isBatchManaged ? [...].map(...) : [{...batchId: undefined...}]`) — TS suy kiểu `batchId: undefined` (literal) cho nhánh OTC thay vì `string | undefined`, không khớp với kiểu phần tử mảng của nhánh kia (`batchId: string`) → lỗi gán mảng union `Type ... is not assignable to type ...`. **Cách sửa**: khai kiểu phần tử tường minh trước khi đưa vào mảng, ví dụ tách hẳn thành 1 hàm helper có kiểu trả về rõ ràng:
   ```ts
   type IssueLineInput = { prescriptionItemId: string | null; drugId: string; batchId?: string; quantity: number };
   function toIssueLines(l: DraftLine): IssueLineInput[] {
     if (l.isBatchManaged) {
       return l.batchRows
         .filter((r) => (Number(r.quantity) || 0) > 0)
         .map((r): IssueLineInput => ({ prescriptionItemId: l.prescriptionItemId, drugId: l.drugId, batchId: r.batchId, quantity: Math.max(1, Number(r.quantity) || 1) }));
     }
     return [{ prescriptionItemId: l.prescriptionItemId, drugId: l.drugId, quantity: Math.max(1, Number(l.quantity) || 1) }];
   }
   // handleSubmit: lines: submittedLines.flatMap(toIssueLines)
   ```
   Kiểm lại đúng field name `CreateStockIssueRequest['lines'][number]` thật (import từ `@nexamed/shared`) thay vì tự định nghĩa lại type trùng, để không lệch khi schema đổi sau này.

**Sau khi sửa 2 lỗi trên, việc cần làm tiếp (CHƯA làm gì cả)**:
- Chạy lại `pnpm -w typecheck/lint/build` tới khi sạch.
- Viết 2 test mới cho backend (`stock-issue-http.spec.ts`): (a) 1 đơn kê 20 viên, lô A chỉ có 15 → gửi 2 dòng (15 lô A + 5 lô B) trong CÙNG 1 request → phải thành công, trừ đúng cả 2 lô; (b) gửi 2 dòng cùng lô A với tổng vượt tồn thật của lô A → phải bị chặn `StockIssueInsufficientStockError` (test hồi quy xác nhận đúng lỗ hổng đã sửa, không phải suy luận).
- Chạy lại toàn bộ `apps/api` test suite xác nhận không hồi quy.
- **Verify Playwright thật cho toàn bộ việc 5** (tách nhiều lô + mọi chỉnh sửa hình thức) — CHƯA làm gì, dialog mới viết chưa từng mở qua trình duyệt thật lần nào.
- Sau khi xong: cập nhật `docs/DECISIONS.md` #165 mục 5 từ "DỞ DANG" → xác nhận thật, cập nhật `docs/TASK.md`/`docs/CURRENT.md`.

## Trạng thái máy/môi trường lúc dừng

- **Chưa commit gì trong phiên này** — toàn bộ thay đổi đang ở working tree. `git status --short` liệt kê đủ ở `docs/DECISIONS.md` #165 (24 file `apps/api`+`apps/web`+`packages/*`).
- **`pnpm dev` (api cổng 3001 + web cổng 5173) đang chạy nền** — background task id `bd1n5jqod` trong session này. Nếu phiên mới không thấy tiến trình này còn sống, chạy lại `pnpm dev` từ thư mục gốc.
- **Postgres dev** (`localhost:5433`, container `nexamed-postgres-1`) đang chạy, đã `db:deploy` + `db:generate` + `db:seed` đầy đủ, không có migration mới nào trong phiên này (chỉ đổi code, không đổi schema).
- **`apps/web/public/config.json`** đã đổi `tenantId` sang `01a0ae93-8d3a-7cc1-bfc9-e3563a99b5fa` (tenant dev MỚI, tenant cũ trong file gốc không còn tồn tại trong DB hiện tại — không rõ vì sao, có thể DB đã bị reset ở phiên nào đó trước đây). File này gitignore, không ảnh hưởng git.
- **Dữ liệu test đã tạo qua HTTP API, CHƯA DỌN**: tài khoản `dev.admin`/`Dev@12345` (clinic_admin) + `test.gd3.doctor`/`Test@12345` (doctor) trên tenant trên; 2 bệnh nhân test ("Nguyễn Thị Test GĐ3", "Trần Văn Test GĐ3B"); 2 lượt khám + đơn thuốc đã ký; 4 thuốc test (`GD3-PARA`/`GD3-AMOX`/`GD3-VITC`/`GD3-OTC`, cộng `GD3-OTC2` — lưu ý `GD3-OTC` bị tạo SAI `isPrescriptionOnly` do itemType SUPPLY bị backend ép `true`, đã bỏ không dùng, thay bằng `GD3-OTC2` đúng); đã bật `soloClinicWorkflowEnabled=true` cho tenant này (nhớ tắt lại nếu không cần trước khi bàn giao pilot). Script tạo dữ liệu + kết quả (`test-context.json`/`test-context-2.json`) nằm ở scratchpad phiên này (`.../scratchpad/pw-verify/`), không thuộc repo, sẽ mất khi dọn scratchpad — nếu cần lặp lại, phải chạy lại `setup.mjs`/`setup2.mjs` (đã viết sẵn, chạy được ngay).
- **Ảnh chụp Playwright đã có** ở `.../scratchpad/pw-verify/shots/` (15+ ảnh) — bằng chứng trực quan cho việc 1-4 đã verify đúng, đáng xem lại nếu nghi ngờ trước khi tin lời tường thuật.

## Việc tiếp theo (đúng thứ tự ưu tiên)

1. **Sửa 2 lỗi TS ở trên** (đã ghi rõ cách sửa, ước lượng 15-30 phút).
2. Viết 2 test hồi quy backend cho cộng dồn nhiều lô.
3. Chạy lại toàn bộ `pnpm -w typecheck/lint/build` + `apps/api` test suite.
4. Verify Playwright thật cho việc 5 (dùng lại `test-context.json` nếu còn, hoặc chạy lại `setup.mjs`).
5. Cập nhật `docs/DECISIONS.md` #165 mục 5, `docs/TASK.md`, `docs/CURRENT.md` từ "DỞ DANG" sang xác nhận xong.
6. Sau khi GĐ3 THẬT SỰ xong (không còn phần nào dở dang): xoá 2 tài khoản/2 bệnh nhân/dữ liệu test khỏi tenant dev qua HTTP API (không SQL trực tiếp), tắt lại `soloClinicWorkflowEnabled` nếu chủ dự án không cần bật mặc định.
7. Tiếp tục Giai đoạn 4 (Kiểm kê/điều chuyển/báo cáo) — chưa lập kế hoạch.

## Rủi ro / lưu ý khi tiếp tục

- **KHÔNG báo cáo GĐ3 "đã xong"** cho tới khi việc 5 xử lý dứt điểm — hiện `apps/web` không build được, đây là trạng thái CHẶN, không phải "còn thiếu tính năng phụ".
- Backend đã sửa xong lỗ hổng cộng dồn (an toàn), nhưng CHƯA có test tự động xác nhận — không giả định "chắc đúng" chỉ vì đọc code thấy hợp lý, phải viết test trước khi coi là xong (đúng thông lệ mọi phiên trước của dự án).
- File `GD3-OTC` (thuốc test cũ, sai `isPrescriptionOnly`) vẫn còn tồn tại trong DB dev — không gây lỗi gì (chỉ là dữ liệu rác không dùng), dọn cùng lúc dọn dữ liệu test khác ở bước 6.

## Tham chiếu

- Quyết định đầy đủ: `docs/DECISIONS.md` #163 (kế hoạch GĐ3) → #164 (code+test xong) → #165 (phiên này — gỡ auto-dispense, sửa mockup, nhóm hoá đơn, DỞ DANG tách nhiều lô).
- Handoff trước: `docs/handoffs/HANDOFF-KhoThuoc-GD3-2026-09-17.md`.
- Mockup gốc đã tham chiếu lại trong phiên: `https://claude.ai/artifact/EFrHTSWbDiZrA2uLhpCXtK` (GĐ3), mockup tab hoá đơn DRUG đã dựng nhưng KHÔNG dùng (bị bỏ giữa chừng sau khi làm rõ yêu cầu thật): `https://claude.ai/artifact/GNuNtpVEBWncPjbZ58rn6K`.
- File đổi trong phiên: xem danh sách đầy đủ ở `docs/DECISIONS.md` #165 (24 file `apps/api`/`apps/web`/`packages/*`), file mới duy nhất là handoff này.
