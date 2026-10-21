# HANDOFF — Thẻ BHYT (S2-04): backend xong, web làm dở — 2026-10-21

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`**, không nhánh/PR (chủ dự án đã bảo commit + push cuối phiên này). Mockup đã chốt thì **bám sát ~95%, khác thì báo**. Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh ở ĐẦU tổng kết. UI theo `.claude/docs/ui-guidelines.md` (độ đậm tối đa semibold, `Button` dùng chung, kiểm nhiều cỡ màn hình, kiểm Chrome thật trang mới).
> Quy ước tài liệu dài (CLAUDE.md): chỉ đọc file gốc `docs/DECISIONS.md` (#243 + bổ sung 1 là mới nhất), `CHANGELOG.md`, `CURRENT.md`, `TASK.md`, `ERD.md` (+ `ERD-2.md` mục 3.14).

## ⚠ CẬP NHẬT CUỐI NGÀY 21/10/2026 — S2-04 ĐÃ XONG TOÀN BỘ
Mọi việc ở mục 3 bên dưới (1–8) **đã làm xong** trong phiên tiếp theo: web hoàn tất, kiểm Chrome thật (kể cả công tắc tắt = ẩn hết, 4 cỡ màn hình), kiểm đột biến (backend 13 + lõi 6, vá 3 lỗ hổng test), FULL test xanh (API 1655, core 509, web 237, shared 96, setup 76). Chi tiết + sai khác so với mockup: `docs/DECISIONS.md` #243 bổ sung 2–3. **2 việc chờ đã xong cùng ngày** (#243 bổ sung 4): số thẻ mới 12 chữ số chốt (không cần hỏi đơn vị vận hành); Tiếp nhận cho thêm thẻ nháp cho hồ sơ MỚI. Không còn việc treo. Phần dưới giữ nguyên làm lịch sử.

## 0. Trạng thái một câu
S2-04 (thẻ BHYT) đã **chốt định hướng + mockup (bản 3, chủ dự án "oki chốt mockup" 21/10)** và **backend + phần lớn web xong, test xanh**; còn LÀM DỞ phần web ở Tiếp nhận, hàng đợi/màn khám/lịch sử khám, ô tích ở Quản lý mẫu in, và kiểm Chrome thật. Mockup: https://claude.ai/artifact/FAi8GCjycj94s6EwTT9t6b (bản 3). Chưa có dữ liệu/cấu hình thật nào đổi: công tắc "Áp dụng BHYT" mặc định TẮT.

## 1. Đã làm (đều đã commit)
- **Quyết định** `docs/DECISIONS.md` #243 (9 mục + 10 câu mockup đã trả lời) và bổ sung 1 (tiến độ, sai khác so với mockup).
- **Lõi** `packages/core/src/insurance/insurance-card.ts` (+ spec 21 ca): `normalizeInsuranceCardNo` (bỏ khoảng trắng/gạch nối, chữ hoa), `detectInsuranceCardKind` (12 chữ số = mới `NEW_12`, 15 ký tự chữ+số = cũ `OLD_15`, khác = `UNKNOWN`), `resolveInsuranceCardValidity` (hạn trống = `UNKNOWN_EXPIRY`, không coi là hết hạn; thêm `NOT_STARTED`), `pickSuggestedInsuranceCard` (ưu tiên "còn hiệu lực" rồi "chưa rõ hạn", cùng mức thì thêm gần nhất). Bản sao tối thiểu ở web `insurance-card-view.ts`, hai bên dùng chung bộ vector test.
- **Dữ liệu**: migration `20261021120000_insurance_card` (bảng `insurance_card`, đủ 8 cột, RLS + FORCE, chung cả công ty, KHÔNG `branch_id`, số thẻ mã hoá `card_no_enc` + băm `card_no_hash`); model Prisma; `tenant-fixture` dọn bảng. ERD v1.82 (`docs/ERD-2.md` 3.14).
- **Cấu hình**: cờ `insuranceEnabled` (`tenant_setting` key `insurance_enabled`, mặc định TẮT) ở `ClinicSettings` (shared/repository/service), `ClinicConfigReaderPort.getInsuranceEnabled`, `GET /clinic-settings/insurance-enabled` (tự phục vụ).
- **API thẻ** (module `patient`): `PatientInsuranceCardRepository/Service/Controller` — `GET/POST /patients/:patientId/insurance-cards`, `PATCH/DELETE .../:cardId`, `POST .../:cardId/photo` (mặt trước/sau). Công tắc tắt → thêm/sửa/xoá/ảnh trả 409 `INSURANCE_DISABLED`. Cảnh báo mềm `UNRECOGNIZED_FORMAT`/`DUPLICATE_CARD_NO`. Nhật ký không ghi số thẻ; nhãn tiếng Việt đã thêm. Gộp hồ sơ chuyển thẻ sang hồ sơ đích. Tìm bệnh nhân theo số thẻ (khớp chính xác qua băm).
- **Tiếp nhận**: `insuranceCardId` ở `checkIn`/`registerDirect` (vắng = tự gợi ý, `null` = không dùng thẻ, uuid = thẻ đó; thẻ hết hạn/chưa hiệu lực → tự chi trả kèm lý do); bản chụp lưu ở `encounter.insurance_snapshot` với số thẻ MÃ HOÁ (`cardNoEnc`), công tắc tắt → `{ selfPay: true }` như cũ.
- **Đọc ra**: `insurance` (đã giải mã) ở `GET /encounters/:id/consultation`, từng lượt ở `GET /encounters/by-patient/:id/history`, `GET /encounters/:id/prescription-print-info` (chỉ người có `patient.read`), nhãn gọn ở `GET /reception/list` (không số thẻ), `GET /billing/invoices/:encounterId/insurance` (quyền `invoice.read`, cho phiếu thu in), bệnh án PDF (dòng theo ô tích của bản mẫu `MEDICAL_RECORD`).
- **Mẫu in**: trường `insurance: { show, whenSelfPay }` ở cấu hình bản mẫu (mặc định tắt, chỉ `PRESCRIPTION`/`INVOICE`/`MEDICAL_RECORD`, kế thừa khổ giấy, test quét kế thừa đã cập nhật).
- **Liên thông đơn thuốc**: gói gửi lấy số thẻ từ BẢN CHỤP của lượt khám và CHỈ gửi thẻ mới 12 chữ số (lõi + test đã đổi từ quy tắc 10 ký tự cũ). Tài liệu cổng QĐ 808 ghi 10 → vẫn phải hỏi đơn vị vận hành trước khi gửi thật.
- **Web đã xong**: pane "Thẻ BHYT" ở Cấu hình phòng khám (`InsuranceConfigPane`, công tắc tổng); khung "Thẻ bảo hiểm y tế" ở hồ sơ bệnh nhân + hộp thoại Thêm/Sửa (nhận diện kiểu thẻ, gợi ý CCCD, hạn trống, mức hưởng chọn nhanh, ảnh 2 mặt tải lên sau khi lưu) + xoá thẻ có xác nhận; bỏ ô "Số bảo hiểm" cũ khỏi form/thẻ hành chính; dòng "Số thẻ BHYT" ở đơn thuốc in, phiếu thu in, phiếu thu tổng hợp in + dữ liệu xem trước (`SAMPLE_INSURANCE`); hàm `formatInsurancePrintValue` + test.

## 2. Kết quả test cuối phiên
- **Cô lập tenant/chi nhánh (báo ĐẦU)**: `patient-insurance-card-http.spec.ts` có ca cô lập công ty (thẻ, tìm theo số thẻ, chọn thẻ ở Tiếp nhận, phiếu thu — id lạ → 404), ca chi nhánh (thẻ chung cả công ty: chi nhánh B thấy/sửa được; phiếu thu chi nhánh khác → 404), `rls-coverage`/`tenant-isolation`/ma trận quyền đều xanh.
- **API**: spec thẻ BHYT 24/24; full API chạy 1649/1652 trước khi sửa test mẫu in (2 test mẫu in đã sửa xong và xanh; 1 test `clinic-profile-http` logo in chập chờn khi chạy song song, chạy riêng 18/18 — không liên quan). `tsc` API sạch; ESLint các file mới sạch.
- **core 509, shared 96, web 232 (+ spec mới), `tsc` web sạch.** Chưa chạy lại FULL API sau các sửa cuối phiên (chỉ chạy riêng patient + print-template) — việc đầu tiên của phiên sau.
- **CHƯA làm**: kiểm đột biến (mutation) cho backend thẻ BHYT; kiểm Chrome thật bất kỳ màn nào của tính năng này.

## 3. Việc còn lại (theo thứ tự đề xuất)
1. **Quản lý mẫu in** (`apps/web/src/features/print-template/PrintTemplateConfigPanel.tsx`): thêm hàng ô tích "Số thẻ BHYT" (mockup màn 5): đơn thuốc nằm trong khối "Thông tin bệnh nhân — mọi loại đơn" (cạnh CCCD, kèm lựa chọn "Khi lượt khám tự chi trả: Ẩn cả dòng / In 'Tự chi trả'"); phiếu thu và bệnh án PDF thêm một khối tương ứng; khoá mờ khi công tắc tổng tắt (`useInsuranceEnabledQuery`). Ghi `config.insurance` (mặc định `show:false, whenSelfPay:'hide'`, hằng ở `insurance-print.ts`). Xoá câu "Số thẻ BHYT sẽ làm cùng việc lưu thẻ BHYT sau này" ở dòng ghi chú cuối khối đơn thuốc (đã làm xong).
2. **Tiếp nhận** (`ReceptionIntakeForm.tsx`, 1312 dòng; mockup màn 3): khối "Thẻ bảo hiểm y tế" (boxed, badge xanh) ngay dưới dòng chọn bệnh nhân; 4 trạng thái — có thẻ còn hiệu lực (thẻ gợi ý chọn sẵn, thẻ khác, "Không dùng thẻ", "Thêm thẻ"), thẻ chưa rõ hạn, thẻ hết hạn (dải hổ phách, tự chi trả), chưa có thẻ (gợi ý CCCD + "Thêm thẻ" mở `InsuranceCardDialog`). Gửi `insuranceCardId` (undefined = gợi ý, `null` = không dùng) ở cả check-in lẫn tiếp nhận trực tiếp; chỉ hiện khi công tắc bật. Dùng `useInsuranceCardsQuery(patientId, enabled)`. Form này CHƯA bọc `<form>` (ghi chú ui-guidelines 4.4) nên cẩn thận Enter.
3. **Nhãn BHYT ở hàng đợi/danh sách/màn khám** (mockup màn 4): `ReceptionListItem.insurance` (đã có từ API, `null` khi tắt) → badge nền đặc "BHYT 80%" (`info`) / "Tự chi trả" (`neutral`) ở `queue-card.tsx`/`ReceptionDoctorQueuePage`/`ReceptionListPage`; đầu màn khám (`EncounterConsultationPage`, `consultation.insurance`) hiện badge kèm số thẻ. Dùng `insuranceBadgeLabel` đã có.
4. **Lịch sử khám** (mockup màn 6): khung "Thẻ BHYT lúc khám — Đã chụp, không đổi" trong `EncounterHistoryDetailDialog`/`PatientEncounterHistoryTab` từ `PatientEncounterHistoryItem.insurance` (kể cả "Tự chi trả" + lý do `SELF_PAY_REASON_LABEL`).
5. **Tìm bệnh nhân theo số thẻ**: API đã làm; web chỉ cần đảm bảo ô tìm không chặn chuỗi dài/chữ cái (kiểm), placeholder không đổi.
6. **Kiểm Chrome thật** (tenant dev, công tắc bật/tắt): toàn bộ màn trên + mọi vai trò + 6 cỡ màn hình (ui-guidelines mục 15) + công ty 1 chi nhánh không đổi gì khi tắt. Chạy `scripts/ui-audit/layout-audit.cjs`. Kiểm vòng kín cấu hình: bật công tắc → thêm thẻ → tiếp nhận → in đơn/phiếu thu/PDF bệnh án với ô tích bật/tắt.
7. **Kiểm đột biến backend** (theo thói quen dự án): bỏ chuẩn hoá chữ hoa; bỏ lọc công ty ở `findPatientIdsByHash`; bỏ chặn 409 khi công tắc tắt; bỏ ưu tiên "còn hiệu lực"; chụp thẻ hết hạn; để lộ số thẻ plaintext vào snapshot — mỗi đột biến phải bị test bắt.
8. Chạy FULL API + core + shared + web, cập nhật `docs/CURRENT.md`/`TASK.md`/CHANGELOG, commit + push.

## 4. Sai khác nhỏ so với mockup (báo chủ dự án khi trình)
- Công tắc dùng khuôn trượt **teal** sẵn có của app (mọi công tắc cấu hình khác), không phải xanh dương của mockup.
- Thêm trạng thái hiệu lực "Chưa hiệu lực" (`NOT_STARTED`, ngày bắt đầu ở tương lai) — mockup chỉ có 3 trạng thái; thẻ này KHÔNG được gợi ý.
- Gợi ý thẻ: ưu tiên "còn hiệu lực" rồi mới "chưa rõ hạn" (đúng ví dụ ở mockup màn 3, không phải "thêm gần nhất" thuần túy).
- Phiếu thu in đọc thẻ qua endpoint riêng `GET /billing/invoices/:encounterId/insurance` gate `invoice.read` (thu ngân không có `patient.read` vẫn in được); đơn thuốc in chỉ trả thẻ cho người có `patient.read`.
- Chữ trên bản in: "Số thẻ BHYT: 079… (thẻ mới) · hiệu lực … · hưởng 80% · nơi ĐK KCB: …" (khớp câu chữ xem trước của mockup, nhưng hạn trống chỉ ghi "từ …, chưa rõ hạn" khi có ngày bắt đầu).
- Ô nhập "Mức hưởng" hiện ô số kèm "%" khi chọn "Khác" (mockup chỉ nói "nhập số 0–100").

## 5. Bẫy đã gặp / điều cần biết
- **Đọc công tắc bằng port TRƯỚC khi mở transaction**: `ClinicConfigReaderPort` mở transaction riêng; gọi bên trong transaction khác từng làm cạn bể kết nối (bài học #242 GĐ1). Mọi chỗ đã tuân thủ (`insuranceEnabled` đọc đầu hàm).
- **Build `@nexamed/core`/`@nexamed/shared` trước `tsc` API** (API đọc bản dist). Sau khi đổi lõi chạy `pnpm --filter @nexamed/core build`.
- **Shell ăn dấu `\`** trong heredoc/`node -e` (regex `\s`, đường dẫn Windows): viết script bằng công cụ Write rồi `node file.cjs`, đường dẫn dùng `/`. Đã gặp 3 lần phiên này.
- `ClinicConfigReaderPort` thêm phương thức → mọi mock của port ở test phải thêm (đã sửa `no-show.spec.ts`).
- `tenant-fixture.ts` phải xoá `insurance_card` trước `patient` (đã thêm); bảng mới sau này cũng vậy.
- Test mẫu in so sánh cấu hình mặc định: cấu hình phiếu thu/bệnh án/đơn thuốc nay có khối `insurance` do máy chủ điền — dùng `withDefaultPrintOptions`.
- Số thẻ trong snapshot là **base64 của bản mã hoá**, không bao giờ plaintext; đọc ra qua `PatientInsuranceCardService.toEncounterInsurance`. Mã băm dùng tiền tố `insurance-card:` để không trùng mã băm CCCD.
- Web chỉ `import type` từ `@nexamed/shared` (bản dist là CommonJS): các hằng/hàm giá trị phải có bản sao ở web (như `insurance-card-view.ts`, `insurance-print.ts`).

## 6. Môi trường dev
- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345`. Công tắc "Áp dụng BHYT" của tenant dev vẫn TẮT (chưa bật để thử). DB dev đã `db:deploy` migration `20261021120000_insurance_card`. Máy chủ dev đã tắt cuối phiên (`pnpm dev` để chạy lại). Môi trường khác cần `pnpm --filter @nexamed/api run db:deploy` + khởi động lại API; không có quyền mới nên không cần `db:seed`.
- Kiểm Chrome: `playwright-core@1.49.1` ở thư mục tạm (đã dùng), Chrome ở `C:\Program Files\Google\Chrome\Application\chrome.exe` (trong script dùng dấu `/`).

## 7. Việc khác còn treo (không đổi)
- **Gói chuyên khoa Nhi** đã có kế hoạch `docs/product/pediatric-pack-plan.md` (chủ dự án tạm dừng, còn 6 câu chưa chốt) — xem `docs/TASK.md`.
- Việc cũ: xem `docs/CURRENT.md` (kiểm cổng liên thông thật, API nhà thuốc 8e, S6-02/S6-04, 1.0.0 sau pilot, hạ tầng SaaS, gói on-prem chưa dựng lại).
- Đã sửa trong phiên: lỗi cả trang cuộn dọc ở tab Kê đơn (`Textarea`/`CheckTile` thêm `relative`, #240 bổ sung 4) và thêm kiểm tra `cuộn-dọc-trang` vào `scripts/ui-audit/layout-audit.cjs`.
