# HANDOFF — Mã đơn thuốc Bộ Y tế: giai đoạn 2 đã kiểm, mẫu in đơn thuốc cấu hình được, rà lỗi kế thừa khổ giấy — 2026-10-20 (phần 2)

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`**, không nhánh/PR, CHỈ khi chủ dự án bảo. Mockup đã chốt thì **bám sát, khác thì báo** (chủ dự án nhắc lại 20/10). Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh ở ĐẦU tổng kết. **Chủ dự án dặn (20/10): tính năng "cấu hình" phải kiểm vòng kín — lưu cấu hình rồi dùng thật xem có áp không, không dừng ở giao diện; và đọc `docs/ERD-2.md` (bản "-2") trước `docs/ERD.md` khi làm schema.** UI mới theo `.claude/docs/ui-guidelines.md` mục 15–16.
> Quy ước tài liệu dài (CLAUDE.md): chỉ đọc file gốc `docs/DECISIONS.md`, `CHANGELOG.md`, `CURRENT.md`, `TASK.md`, `ERD.md` (+ `ERD-2.md`); `docs/archive/` chỉ mở khi tra mục cụ thể. Bàn giao trước: `HANDOFF-MaDonThuocBYT-GD1-GD2-TachTaiLieu-2026-10-20.md`.

## 0. Trạng thái một câu
Mã đơn thuốc chuẩn Bộ Y tế (#242): **giai đoạn 1–2 XONG, đã kiểm test + Chrome thật**; mã chuẩn đã hiện ở lịch sử khám/PDF bệnh án/phiếu xuất kho; tiêu đề đơn “N”/“H” khoá theo mẫu Thông tư 52/2017; **bản in đơn thuốc có thông tin bệnh nhân + mục riêng đơn N/H cấu hình bật/tắt được trong Quản lý mẫu in** (mockup đã duyệt); rà lỗi kế thừa khổ giấy tìm và sửa 2 lỗi. **Kế tiếp: giai đoạn 3 (liên thông), chưa bắt đầu.**

## 1. Đã làm phiên này (tất cả đã commit)
### 1.1 Giai đoạn 2 — kiểm và sửa
- Spec `prescription-document-http.spec.ts` 12/12 + kiểm đột biến. **Lỗi thật tìm được**: bật chế độ "Chuẩn Bộ Y tế" ở phòng khám đã có đơn ký làm bộ đếm mã nội bộ DT đếm lại từ 1 (khuôn thành "chủ động", chu kỳ tháng) → trùng `prescription_no`, ký đơn lỗi 500. Sửa bằng cờ `implicitPeriod` ở entry `business_code_templates` (`business-code.service.ts`, `clinic-settings.repository.ts`) — #242 bổ sung 8.
- `tenant-fixture.ts` dọn thêm `prescription_document`; `drug-import-http.spec.ts` cột "Trạng thái" nhích 26→27 (thêm cột Đông y).
- Kiểm Chrome thật (1280→3440px): ô mã KCB, công tắc Chuẩn Bộ Y tế + bảng sẵn sàng, pill "Loại đơn thuốc", kê/ký/tách đơn, in, "Phát thuốc" nhóm theo đơn, danh mục thuốc (Đông y), luồng "Sửa đơn" (đính chính giữ mã C/H/Y, mã -N không dùng lại). Hàng tab màn khám xuống 2 dòng ở 1280px (lỗi cũ từ #090) đã sửa (`EncounterConsultationPage.tsx`).
- Chủ dự án duyệt 4 sai khác nhỏ so với mockup; riêng "Mã cơ sở KCB" chuyển lên ĐẦU PHIẾU (prop `headerExtra` của `PrintDocument`) — #242 bổ sung 10.

### 1.2 Mã chuẩn hiện thêm ở (#242 bổ sung 11)
Tab "Lịch sử khám" + hộp chi tiết lượt khám cũ (`prescriptionDocuments` ở `patientEncounterHistoryClinicalSchema`), PDF bệnh án (dòng "Mã đơn", `MedicalRecordEncounterEntry.prescriptionDocuments`), phiếu xuất kho (`StockIssueSummary.prescriptionDocuments`: chi tiết/danh sách/bản in "Theo đơn …"). Đơn cũ vẫn hiện mã DT. Tiêu đề in: đơn N/H luôn **ĐƠN THUỐC “N”/“H”** (ngoặc kép cong; prop `fixedTitle` — bản mẫu "TOA THUỐC" không đè được). Đơn C và Y theo bản mẫu. **Chưa xác nhận**: tên mẫu đơn cổ truyền (Thông tư 44/2018: nguồn ghi "ĐƠN THUỐC THANG ĐIỀU TRỊ NGOẠI TRÚ", chưa đối chiếu văn bản gốc) — tiêu đề Y còn là đề xuất.

### 1.3 Mẫu in đơn thuốc cấu hình được (#242 bổ sung 12) — mockup https://claude.ai/artifact/987PJudhUHqajfen7ibV3q
- Khối `prescriptionInfo` trong cấu hình bản mẫu (shared `print-template.ts`): mã BN, CCCD (+ "ẩn dòng"/"dòng chấm" khi chưa có, mặc định ẨN), địa chỉ, SĐT, cân nặng (lần đo mới nhất có ghi, chưa đo → dòng chấm), người giám hộ (trẻ < 72 tháng, CCCD giám hộ luôn dòng chấm); riêng đơn N/H: Đợt (N), số lượng bằng chữ (N), ô người nhận thuốc (N+H). Mặc định BẬT hết; thiếu khối trong JSON = bật hết (máy chủ điền). **Không migration.** Số thẻ BHYT để sau (cùng S2-04).
- API: `GET /encounters/:id/prescription-print-info` (`encounter.read_clinical` + `@AuditView`, chỉ chi nhánh đang làm; CCCD giải mã CHỈ khi người in có `patient.read`). Gọi khi đơn đã ký, KHÔNG nằm trong `consultation`. Đã đăng ký OpenAPI, sinh lại `openapi-schema.d.ts`.
- Web: `prescription-print-fields.ts` (hàm thuần quyết định ô nào in), `shared/format/vietnamese-number-words.ts` (đọc số thành chữ), `PrescriptionPrintView` dựng lại, hai khối công tắc ở `PrintTemplateConfigPanel`, xem trước 4 tab (`PrintDocumentPreview`, `print-samples.ts`). Sai khác nhỏ so với mockup (đã báo, chờ chủ dự án duyệt): ô tick thay công tắc trượt; bố cục bản in dùng khung sẵn có; nhật ký xem dùng `encounter.viewed`.
- **Rà kế thừa khổ giấy (chủ dự án yêu cầu) — 2 lỗi, đã sửa**: (1) `deriveConfigForPaper` không kế thừa ô chữ ký + "(Ký, ghi rõ họ tên)" (mọi chứng từ nhiều khổ) và `prescriptionInfo`; nay kế thừa, trừ ràng buộc K80, có tham số `basePaperSize`. (2) "Thiết lập nhanh" đổi sang khổ chưa có bản mẫu tạo từ mặc định trơn → mất chỉnh sửa; nay kế thừa từ bản đang là mặc định. Chặn quên về sau: `packages/shared/src/print-template.spec.ts` quét MỌI chứng từ × MỌI khổ và buộc mọi khoá mới của `printTemplateConfigSchema` xếp "kế thừa" hoặc "riêng từng khổ".
- **Ghi chú thiết kế, KHÔNG phải lỗi**: lần đầu lưu một khổ khác khổ dựng sẵn, hệ thống tự lưu thêm bản dựng sẵn (vd. A4) nên khổ đó có cấu hình RIÊNG, không đổi theo khổ kia.

### 1.4 Kết quả test cuối phiên
shared 96, core 457, web 195, **full API 1541/1541** (96 file). Ma trận phân quyền áp thật (`permission-matrix-enforcement-http.spec.ts`) 7/7 và tự phủ route mới. Cô lập tenant/chi nhánh: mọi test xanh. Typecheck + eslint sạch ở file đã chạm. Kiểm đột biến đã làm ở: bỏ `supersedeDocuments`, ép loại C, bỏ mã chuẩn ở lịch sử/phiếu xuất kho, bỏ chặn CCCD theo quyền, bỏ điều kiện cân nặng, bỏ kế thừa khổ giấy ở "Thiết lập nhanh".

## 2. Việc kế tiếp
1. **Giai đoạn 3 — liên thông** (mockup 8a–8d đã chốt; kế hoạch ở bàn giao 20/10 phần 1, mục 3: công tắc tổng + trang "Liên thông đơn thuốc", `PrescriptionInteropPort` + token 7 ngày, hàm dựng gói `gui-don-thuoc` thuần, bảng `prescription_submission` (outbox), ô nhập bổ sung 8b, dải kiểm dữ liệu 8a, hàng chờ 8c). Mọi bảng mới theo 4 câu hỏi chi nhánh (CLAUDE.md). **Trước khi code phải hỏi đơn vị vận hành cổng**: sandbox, chữ ký số, chữ hoa/thường mã đơn, cách cập nhật đơn đã gửi khi đính chính, "72 tháng", danh mục hình thức điều trị, tên trường chẩn đoán, app-name/app-key, địa chỉ API nhà thuốc. API nhà thuốc (8e) làm SAU, duyệt riêng. Dữ liệu "Đợt dùng thuốc" của đơn N sẽ có ở giai đoạn này (hiện in dòng chấm).
2. **Chủ dự án tự kiểm nghiệm** (danh sách 30 mục ở mục 4): mục 1–26 đã có thể kiểm; 27–30 (mẫu in) nay cũng kiểm được. Điều kiện chốt: đạt hết + dược sĩ xác nhận (a) mẫu đơn N/H đúng Thông tư 52/2017 (b) tên mẫu đơn cổ truyền (Y).
3. Việc nhỏ còn mở: số thẻ BHYT trên đơn (S2-04); dòng nhật ký riêng cho "in đơn kèm CCCD"; đơn N/H in 3 bản (hiện theo "Số liên" của bản mẫu); hộp in thật của trình duyệt chưa kiểm (chỉ giả lập chế độ in); chủ dự án duyệt 3 sai khác ở 1.3.
4. Việc treo cũ (không đổi, xem `docs/CURRENT.md`): kiểm bằng mắt kê đơn chế độ Chặn/"Sửa đơn" liều lẻ/"Mẫu lời dặn"; `weight-audit`; bố cục tablet; gói thuê bao + giấy phép; S6-02/S6-04; BHYT S2-04; phát hành 1.0.0 sau pilot; hạ tầng SaaS chờ báo giá; gói on-prem chưa dựng lại.

## 3. Trạng thái môi trường dev và bẫy
- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345`. Dữ liệu thử còn lại (không xoá được): 4 thuốc `VF2010-*`, lượt khám `VF2010 E1/E2/E3`, đơn mẫu "VF2010 mẫu gây nghiện + hướng thần", mã KCB chi nhánh `79001`/`79002`. Chế độ Chuẩn Bộ Y tế đang **TẮT**; mẫu in Đơn thuốc đã lưu A5 (mặc định) + A4, mọi công tắc bật.
- Môi trường khác cần `db:deploy` (3 migration `20261016110000_…`, `20261020090000_…`, `20261020100000_…`) + `db:seed` + khởi động lại API. Phiên này **không thêm migration, không thêm quyền**.
- Sau khi sửa `packages/shared`: `pnpm --filter @nexamed/shared build` (và `core`) rồi mới chạy test API; dev server cần khởi động lại để nạp dist mới. Thêm route mới: `pnpm --filter @nexamed/api run openapi:generate` rồi `pnpm --filter @nexamed/web run api:codegen`.
- Web chỉ import KIỂU từ `@nexamed/shared` (dist CommonJS); hằng giá trị dùng ở web phải có bản sao + test lệch bản (mẫu: `ALL_ON_PRESCRIPTION_INFO` ↔ `DEFAULT_PRESCRIPTION_INFO_CONFIG`).
- Test API cùng lúc dev server + Chrome có thể hết bộ nhớ ảo: tắt dev server trước khi chạy full test.
- Playwright kiểm Chrome: cài `playwright-core@1.49.1` ở thư mục tạm (scratchpad), Chrome ở `C:\Program Files\Google\Chrome\Application\chrome.exe`; script mẫu đăng nhập qua giao diện rồi chụp ảnh. `window.print()` không chạy trong headless — kiểm bản in bằng `page.emulateMedia({ media: 'print' })`.
- Bài học thiết kế: KHÔNG gọi port chi nhánh (transaction riêng) từ bên trong transaction khác (cạn bể kết nối khi ký đồng thời) — tra mã cơ sở TRƯỚC (`resolveFacilityCodeForBranch`). Tạo mẫu in ở khổ khác khổ dựng sẵn tự lưu thêm bản dựng sẵn (xem 1.3).

## 4. Danh sách kiểm nghiệm để chốt (chủ dự án tự thử trên giao diện)
**Chuẩn bị**: đã `db:deploy` + khởi động lại API; đăng nhập `dev.admin`; có thuốc thường, thuốc Gây nghiện, thuốc Đông y.

**A. Mã cơ sở và bật chế độ chuẩn**
1. Sửa chi nhánh, mã KCB 4 hoặc 6 số → báo "phải gồm đúng 5 chữ số"; 5 số → lưu được, cột "Mã KCB" hiện mã.
2. Xoá mã KCB một chi nhánh (công ty cũng chưa có mã) rồi bật "Chuẩn Bộ Y tế" → bị chặn, nêu tên chi nhánh thiếu mã.
3. Đủ mã → bật được; khuôn khoá, 7 chữ số, bảng "sẵn sàng" liệt kê từng chi nhánh với mã kế tiếp đúng.
4. Chi nhánh không có mã riêng nhưng công ty có mã (ô "Mã cơ sở khám chữa bệnh" ở Thông tin phòng khám — KHÔNG lấy từ chi nhánh mặc định) → ký ở chi nhánh đó, mã bắt đầu bằng mã công ty, bộ đếm nối tiếp chi nhánh cùng mã.
5. Tắt chế độ → hộp xác nhận; đơn đã cấp giữ mã chuẩn; đơn mới có mã DT kế tiếp, không trùng.

**B. Loại đơn**
6. Pill "Loại đơn thuốc": mặc định N/H/H/C/C/Y; đổi Gây nghiện→C có cảnh báo, lưu được; "Khôi phục mặc định" trả lại; đơn đã ký trước không đổi.
7. Danh mục thuốc: tick "Đông y" → nhãn "Đông y", chi tiết "Có (đơn loại Y)"; xuất/nhập Excel cột "Đông y".

**C. Kê đơn, ký, đính chính**
8. Chế độ chuẩn bật, đơn một loại: mỗi dòng có chữ cái, không dải tách, nút "Ký đơn".
9. Đơn thường + gây nghiện + hướng thần + Đông y: dải "Khi ký, đơn này tách thành 4 đơn", nút "Ký 4 đơn".
10. Thuốc vừa gây nghiện vừa Đông y → loại N; dòng kê tự do luôn loại C.
11. "Đơn mẫu" và "Sao chép đơn lần trước": chữ cái và dải tách hiện ngay sau khi chèn.
12. Ký xong: N đơn, mã `790010000001-C`…, số liên tiếp, thứ tự C,N,H,Y; hai bác sĩ ký cùng lúc không trùng, không hụt.
13. "Sửa đơn": bỏ một loại → loại còn lại giữ mã, mã loại bị bỏ không dùng lại; thêm loại mới → mã mới; bản cũ vẫn xem được trong lịch sử.
14. Đơn ký TRƯỚC khi bật chế độ chuẩn: giữ mã DT, đính chính sau khi bật vẫn không có mã chuẩn.
15. Chế độ tắt: ký như cũ, một đơn, mã DT, không dải tách.

**D. In**
16. "In tất cả (N tờ)": mỗi đơn một tờ, ngắt trang đúng, "Tờ n/N", mã cơ sở KCB ở đầu phiếu, có mã vạch.
17. Quét mã vạch bằng điện thoại/đầu đọc → đúng số đơn.
18. Đơn N/H: tiêu đề **ĐƠN THUỐC “N”/“H”** dù bản mẫu đặt "Toa thuốc"; đơn C và Y theo bản mẫu.
19. In thật trên máy in A4 và A5: không tràn lề, không ngắt trang giữa một đơn.

**E. Mã chuẩn hiện ở nơi khác**
20. Phát thuốc nhóm theo đơn; phát xong, phiếu xuất kho (chi tiết + bản in) có "Theo đơn …".
21. Hồ sơ bệnh nhân → Lịch sử khám → "Tất cả": cột Đơn thuốc hiện mã chuẩn từng đơn; đơn cũ hiện mã DT; hộp chi tiết lượt khám có mã + chữ cái.
22. "Xuất bệnh án PDF": mục Đơn thuốc có dòng "Mã đơn: … (loại)".

**F. Phân quyền và an toàn**
23. Đăng nhập lễ tân: không sửa được mã chi nhánh, chế độ mã đơn, bảng ánh xạ.
24. Công ty khác không thấy mã cơ sở, bảng ánh xạ, mã đơn của công ty này.
25. Nhật ký hoạt động có dòng khi đổi bảng ánh xạ, đổi chế độ, bật/tắt.

**G. Giao diện**
26. Màn khám ở 1280/1366/1536/1920px: hàng tab một dòng, không thanh cuộn ngang.

**H. Mẫu in đơn thuốc (đã code xong)**
27. Quản lý mẫu in → Đơn thuốc: hai khối công tắc; xem trước 4 tab đổi đúng theo từng công tắc.
28. **Lưu** cấu hình rồi in thật một đơn: mục đã tắt biến mất (mã BN, CCCD, cân nặng, địa chỉ, đợt, số lượng bằng chữ, ô người nhận thuốc). In ra khổ A5 ngang (khổ chưa có bản mẫu riêng) cũng áp; khổ đã có bản mẫu riêng dùng cấu hình riêng của khổ đó.
29. Bệnh nhân chưa có CCCD (trẻ em) → dòng CCCD ẩn (hoặc dòng chấm nếu chọn); trẻ dưới 72 tháng có dòng người giám hộ, người lớn không có. Cân nặng chưa đo → dòng chấm.
30. Đơn N: có "Đợt", "Sáu viên"… bằng chữ, ô người nhận thuốc; đơn H: ô người nhận thuốc, không có "Đợt". Tài khoản không có quyền xem hồ sơ bệnh nhân: không in được CCCD (dòng ẩn/chấm); mỗi lần in có dòng nhật ký xem lượt khám.
31. (Mới) Tắt "Ô chữ ký" ở bản mẫu khổ mặc định của MỘT chứng từ bất kỳ nhiều khổ (vd. Phiếu thu chi) → in ra khổ khác chưa có bản mẫu riêng cũng không có ô chữ ký; "Thiết lập nhanh" đổi khổ không làm mất tiêu đề/chữ ký/ghi chú/số liên đã chỉnh.

Tự động đã có test: mục 5, 6, 10, 12–15, 20–22, 24, 27–31 (phần dữ liệu/cấu hình); còn lại phải thử tay.

## 5. Tài liệu đã cập nhật phiên này
`docs/DECISIONS.md` (#242 bổ sung 8–12), `docs/CHANGELOG.md`, `docs/CURRENT.md`, `docs/TASK.md`; `docs/ERD-2.md`/`ERD.md` đã có từ phiên trước (v1.79), phiên này không đổi schema. Bộ nhớ: `feedback_prefer_v2_docs.md`, `feedback_verify_config_applies.md`.
