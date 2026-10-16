# HANDOFF — Kê đơn liều lẻ, dọn giao diện, chuẩn bị mã đơn thuốc Bộ Y tế — 2026-10-16 (phần 2, cuối ngày)

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`** (không nhánh/PR), CHỈ khi chủ dự án bảo. Mockup mới phải được "duyệt"/"chốt mockup" rõ ràng trước khi code. Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh. UI mới theo `.claude/docs/ui-guidelines.md` mục 15 (kiểm nhiều cỡ màn hình), mục 16 (độ đậm chữ — **đọc phần "Lưu ý hiển thị thật"**).
> Đây là phần tiếp của `HANDOFF-DangNhap-DoDamChu-ConfirmDialog-MaDonThuoc-2026-10-16.md` (sáng cùng ngày). Đọc file đó trước nếu cần bối cảnh về màn đăng nhập mới, khoá đăng nhập luỹ tiến và chuẩn độ đậm.

## 0. Trạng thái một câu

Phiên này làm xong và đã commit + push: (a) **Kê đơn: liều chia lẻ ¼ viên, thuốc không chia được (cảnh báo hoặc chặn), số ngày chung, pill liều, lời dặn riêng của đơn, thêm thuốc là lưu nháp ngay** (#241); (b) sửa thanh chẩn đoán dính ở tab Kê đơn (chỉ hiện khi cuộn khuất khối chẩn đoán) + ô "Thêm thuốc vào đơn" dính + lỗi bấm pill lần đầu không ăn; (c) màn đăng nhập thêm câu chào theo giờ; (d) **việc A–D của bàn giao sáng**: 9 hộp xác nhận cũ sang `ConfirmDialog`, lỗi bố cục màn nhỏ/rất rộng, độ đậm chữ trong bảng, thẻ KPI phẳng không đổ bóng; (e) **mã đơn thuốc Bộ Y tế: chủ dự án đã chốt 8 câu (#242), CHƯA mockup, CHƯA code**. Đã dựng 4 trang Artifact (mockup kê đơn, bảng giá, báo giá, mockup Giấy phép) — xem mục 5.

## 1. Đã làm (chi tiết để tra)

### 1.1 Kê đơn (#241, migration `20261016110000_prescription_fractional_dose`)
- **Liều lẻ**: 4 cột `dose_*` của `prescription_item`/`prescription_template_item` đổi `SMALLINT` → `NUMERIC(5,2)` + CHECK bội của 0,25; `quantity` vẫn INTEGER = **làm tròn lên** (tính qua số nguyên đơn vị ¼ viên: `doseToQuarters`, `computePrescriptionQuantity` ở `packages/shared/src/prescription.ts`; bản sao web `apps/web/src/features/encounter/prescription-dose-preview.ts` — sửa một nơi phải sửa nơi kia). Prisma trả Decimal → repository đổi sang number.
- **Thuốc không chia được**: `drug.is_splittable` (mặc định true), ô "Cho phép chia nhỏ" ở form thuốc; cảnh báo `not_splittable` (key `not_splittable:<drugId>`, bỏ qua được như #228); công tắc `prescriptionSplitBlockEnabled` ở Cấu hình thanh toán (mặc định tắt, endpoint tự-phục vụ `GET /clinic-settings/prescription-split-block-enabled`) → bật thì **ký và đính chính bị chặn** `422 PRESCRIPTION_NON_SPLITTABLE_DOSE`.
- **Thêm thuốc là lưu nháp ngay** (để cảnh báo trùng hoạt chất hiện liền) → `PUT .../prescription-items` KHÔNG còn bắt dòng có liều; **ký** chặn `422 PRESCRIPTION_ITEM_MISSING_DOSE`, **đính chính** bắt buộc liều (400).
- **Lời dặn riêng của đơn**: `prescription.doctor_advice` (trigger bất biến sau ký đã cập nhật), gửi kèm lưu nháp, đính chính chép/đổi được, dùng lại `AdviceTemplateDialog`; chỉ tăng `version` khi nội dung đổi thật.
- **Web**: `dose-controls.tsx` (`DoseInput` gõ `1/2`, `0,5`, `1 1/2`; `DosePatternPills`; `DoseQuickChips`), `StickyDiagnosisBar.tsx`, `PrescriptionPanel.tsx` viết lại phần dòng thuốc. Nút "Điền nhanh" nằm CÙNG hàng pill và chỉ đổi `visibility` (đổi `display` làm pill bị đẩy giữa lúc nhấn chuột → phải bấm 2 lần — đã tái hiện và sửa).
- **Giải thích câu "vì sao 2 thuốc cùng hoạt chất không báo"**: cảnh báo do server tính từ đơn ĐÃ LƯU; trước đây thêm thuốc chưa lưu thì chưa có. Chủ dự án chưa cho biết tên 2 thuốc đã thử nên chưa loại trừ trường hợp thuốc thiếu dữ liệu hoạt chất.

### 1.2 Giao diện
- Đăng nhập: câu chào "Xin chào, Buổi trưa !!!" theo giờ Việt Nam (`shared/format/greeting.ts`, đổi mỗi phút) kèm biểu tượng, ngang hàng logo; "Đăng nhập" + dòng "Nhập thông tin tài khoản của bạn" căn giữa (câu chào căn trái).
- 9 hộp xác nhận cũ → `ConfirmDialog` (+ hộp "Bác sĩ đang nghỉ"). Không còn khối `max-w-sm rounded-lg bg-white p-5 shadow-xl` viết tay.
- Bố cục: Mẫu in tự vừa khổ giấy (`print-preview-zoom.ts`), bảng dòng hàng Phiếu nhập kho có `lineMinWidth`, đường dẫn đầu trang `truncate`, trần nội dung 2200px ở `AppShell` + 1800px ở danh sách bệnh nhân.
- **Độ đậm chữ**: phát hiện **Segoe UI không có bậc 500 → `font-medium` hiển thị GIỐNG `font-semibold`**. Luật CSS ở `app/index.css` hạ chữ trung tính (slate/blue) trong `[role=cell]`/`td` về 400 (trừ `tabular-nums`, badge `rounded`, `uppercase`, `button`).
- Thẻ KPI "Bệnh nhân trong ngày" (`ReceptionListPage.tsx`): nền trắng + viền mảnh, KHÔNG bóng/nền pha màu; màu chỉ ở ô biểu tượng nền đặc.

### 1.3 Kiểm chứng đã chạy
Shared 40, core 447, web 153, `prescription-http.spec` 31/31 (+9 test #241, đã kiểm đột biến), full API: mọi file xanh (lần đầu 3 file đỏ: 1 do tôi quên khai route mới ở `permission-matrix-enforcement-http.spec.ts` — đã sửa; 1 do máy hết bộ nhớ ảo khi chạy test cùng dev server; 1 lỗi chập chờn cũ của upload logo). Lint toàn repo + typecheck sạch. Chrome thật: kê đơn (thêm thuốc → lưu nháp, ½, làm tròn, cảnh báo, pill, số ngày chung, thanh/ô dính), đăng nhập (1440/390), hộp Vai trò mới / Đặt lại mật khẩu / Xuất bệnh án, Mẫu in 1280, danh sách bệnh nhân 3440, bộ kiểm 54 trang × 10 cỡ (0 vấn đề từ 1280px trở lên). **Cô lập tenant**: có test công tắc chặn của tenant A không rò sang tenant B.

## 2. VIỆC CÒN TREO (theo mức nên làm)

1. **Mã đơn thuốc Bộ Y tế (#242) — ĐÃ NHẬN TÀI LIỆU LIÊN THÔNG THẬT (QĐ 808): đọc `docs/product/prescription-code-moh.md` mục 9 và `docs/product/references/qd-808-donthuocquocgia-api.md`** (tiền chất → H được xác nhận; gửi đơn chạy bằng mã liên thông + mật khẩu từng bác sĩ và cơ sở, token 7 ngày; `ma_thuoc` bắt buộc; còn cần hỏi đơn vị vận hành về sandbox/chữ ký số/chữ hoa-thường mã đơn). — 8 câu ĐÃ CHỐT (xem `docs/product/prescription-code-moh.md` mục 7b): mã cơ sở 5 chữ số mỗi chi nhánh; 7 chữ số thập phân bộ đếm chung 4 loại đơn; bảng ánh xạ loại thuốc → loại đơn sửa được (mặc định N/H/C/Y; **tiền chất → H đã được tài liệu 808 xác nhận; thuốc độc → C vẫn chưa có văn bản**); cờ "Đông y" ở danh mục thuốc; đơn nhiều loại tự tách khi ký; kê tự do chỉ loại C; đơn cũ không cấp hồi tố; **cả 3 giai đoạn** (GĐ3 = port + outbox + kiểm dữ liệu, mỏng vì chưa có tài liệu kết nối thật). **Việc kế tiếp: dựng mockup** (nhập mã cơ sở theo chi nhánh + công tắc chế độ chuẩn; màn xem trước "sẽ ký thành N đơn"; ô "Đông y"; trang bảng ánh xạ; bản in nhiều tờ) → chủ dự án duyệt → code GĐ1 → GĐ2 → GĐ3. Đừng code trước khi duyệt mockup (đụng schema, in đơn, kho, đính chính).
2. **Kiểm bằng mắt còn thiếu**: kê đơn — chế độ Chặn trên UI, hộp "Sửa đơn" với liều lẻ, hộp "Mẫu lời dặn" trong màn kê đơn; hộp xác nhận mới chuyển chưa chụp: Hoàn tiền, Nạp & thu ngay, Tất toán ví, Huỷ đính chính cận lâm sàng, 3 hộp Tiếp nhận (cần dữ liệu riêng).
3. **Độ đậm chữ**: chưa chạy lại `weight-audit` sau luật CSS trong bảng; chỗ ngoài bảng (nút, nav, thẻ danh sách) vẫn hiển thị đặc trên Windows — nếu chủ dự án vẫn thấy đặc, làm luật tương tự theo vùng.
4. **Bố cục máy tính bảng (ưu tiên thấp)**: `/patients`, `/suppliers/:id` ở 768px; `/cash-book/report` và Mẫu in ở 1024px.
5. **Gói thuê bao + giấy phép ký số (chủ dự án bảo làm SAU)**: đã chốt hướng — giấy phép Ed25519 + quyền lợi theo gói (ẩn module, giới hạn tài khoản/chi nhánh), hết hạn ân hạn **7 ngày** rồi chỉ xem (không khoá/xoá hồ sơ), gắn **mã cài đặt sinh lúc cài**, gia hạn tải tệp (bước 1) rồi tự lấy từ máy chủ phát hành (bước 2, cần máy chủ chưa có). Mockup trang Giấy phép chờ duyệt. Đảo ngược quyết định cũ #070/#072 ("không license/DRM") — chủ dự án đã đồng ý nhưng nên ghi `DECISIONS` khi bắt đầu code.
6. **Việc treo cũ**: S6-04 đo tải trên máy chủ pilot thật; S6-02 diễn tập phục hồi; BHYT (S2-04); phát hành `1.0.0` sau pilot; ảnh nền đăng nhập do phòng khám tự tải; chọn nhà cung cấp hạ tầng SaaS (chờ báo giá); **gói on-prem CHƯA dựng lại** cho các thay đổi hôm nay (chỉ dựng khi sắp giao khách). Môi trường khác cần `db:deploy` (migration `20261016110000_…`) + khởi động lại API.

## 3. Bẫy đã gặp / điều cần biết

- **Windows Chrome**: `font-medium` ≡ `font-semibold` (xem 1.2). UI mới nên tự kiểm trên Chrome Windows, đừng tin thang 3 mức.
- **Prisma generate lỗi EPERM** khi dev server đang chạy (khoá file engine) — tắt `pnpm dev` (cổng 5173/3001) trước. Chạy full API test cùng lúc với dev server + Chrome có thể báo "paging file is too small" (spec `billing-http` đỏ giả) — chạy riêng khi máy rảnh.
- **Git Bash**: giá trị biến môi trường bắt đầu bằng `/` bị đổi thành đường dẫn Windows → đặt `MSYS_NO_PATHCONV=1` (đặc biệt `UI_AUDIT_EXTRA`, `ONLY`). Dấu backtick trong `node -e "..."` bị shell ăn — viết script bằng công cụ Write rồi chạy. Tài liệu `docs/*.md` và nhiều file mã dùng CRLF — script vá phải đọc, đổi `\r\n`→`\n`, sửa, ghi lại đúng kiểu.
- `GET /users` phân trang theo `cursor` (tối đa 100/trang, `limit=200` bị từ chối) — script dọn dữ liệu phải duyệt hết trang và lọc đúng tiền tố (`^rxui\d+$`), in danh sách trước khi sửa.
- Bộ kiểm giao diện: `scripts/ui-audit/` (cần `playwright-core` cài ở thư mục tạm, đặt `PLAYWRIGHT_CORE`); `UI_AUDIT_EXTRA='/nhan|/duong-dan'` thêm trang cần dữ liệu riêng. Không chạy hai bản song song (refresh token xoay vòng).
- Tab Kê đơn: `sticky top-0` trong khung có padding bị lệch bằng đúng padding — dùng `-top-4` khi khung `p-4`. Ô "Thêm thuốc vào đơn" dính ngay dưới thanh chẩn đoán qua biến CSS `--sticky-diagnosis-h` đặt trên khung cuộn.
- Tailwind v4: `z-9` thay `z-[9]`, `top-[calc(var(--x,0px)-1rem)]` không cần dấu gạch dưới.
- **Dữ liệu thử còn trong dev DB (hệ thống không xoá được)**: vài bệnh nhân/lượt khám `rxui…` (tài khoản `rxui…` đã vô hiệu hoá), một phiếu điều chuyển hoàn tất (2 viên Kho chính → Kho Nhi) và phiếu nhập `PNK2610000028`, bệnh nhân "PERFLOAD…" từ trước. Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, đăng nhập `dev.admin` / `Dev@12345`.

## 4. Chạy thử nhanh
`pnpm dev` (web 5173 + API 3001). Kiểm Kê đơn: cần một lượt khám `IN_CONSULTATION` có chẩn đoán chính — dựng qua API (tạo tài khoản bác sĩ tiền tố `rxui`, bệnh nhân có CCCD, đặt lịch, check-in, thu tiền, `start`, `PUT diagnoses`) rồi đăng nhập bằng chính tài khoản đó, tab "Kê đơn thuốc". Mô hình test e2e tham khảo: `apps/api/src/modules/encounter/prescription-http.spec.ts` (`prepareEncounterInConsultation`).

## 5. Trang Artifact (riêng tư, chia sẻ từ menu Share)
- Mockup kê đơn (liều lẻ, pill, số ngày chung, lời dặn, thuốc không chia được): https://claude.ai/artifact/2JVm4ZUHTMaRNj17kBjmFh (bản 5, ĐÃ duyệt)
- Bảng giá gói SaaS/VPS/on-prem/NAS + bộ tính: https://claude.ai/artifact/YSijuwPrDQbrwNJXNeHoUC
- Mẫu báo giá gửi khách: https://claude.ai/artifact/TLtikwCjEtrio7KwhB3wnU
- Mockup trang Giấy phép: https://claude.ai/artifact/JjurgKXKABJVs6n85TmQ1C (chờ duyệt)

## 6. Tài liệu đã cập nhật phiên này
`docs/DECISIONS.md` #240 (bổ sung 1–2) / #241 / #242, `docs/CHANGELOG.md`, `docs/TASK.md`, `docs/ERD.md` (v1.77), `.claude/docs/data-model.md`, `.claude/docs/ui-guidelines.md` (mục 16: lưu ý hiển thị thật + thẻ KPI), `docs/product/prescription-code-moh.md` (mục 7b + mục 9 phân tích tài liệu liên thông), `docs/product/references/qd-808-donthuocquocgia-api.md` (bản tham chiếu QĐ 808), `scripts/ui-audit/` (`UI_AUDIT_EXTRA`).
