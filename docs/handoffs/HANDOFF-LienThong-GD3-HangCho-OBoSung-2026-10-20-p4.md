# HANDOFF — Liên thông đơn thuốc quốc gia (GĐ3): ô bổ sung 8b, dải kiểm 8a, hàng chờ gửi, bộ gửi nền, trang 8c đã xong — 2026-10-20 (phần 4)

> Hội thoại luôn tiếng Việt. **Commit/push thẳng `master`**, không nhánh/PR, CHỈ khi chủ dự án bảo (phiên này CHƯA được bảo commit — mọi thay đổi còn ở working tree). Mockup đã chốt thì **bám sát, khác thì báo**. Ảnh chụp kiểm tra để ở scratchpad, KHÔNG lưu vào repo. Sau mỗi đợt chạy lại TOÀN BỘ test, báo kết quả kèm bước cô lập tenant/chi nhánh ở ĐẦU tổng kết. Tính năng "cấu hình" phải kiểm vòng kín. UI theo `.claude/docs/ui-guidelines.md` mục 15–16.
> Quy ước tài liệu dài (CLAUDE.md): chỉ đọc file gốc `docs/DECISIONS.md` (#242 bổ sung 16–17 là mới nhất), `CHANGELOG.md`, `CURRENT.md`, `TASK.md`, `ERD.md` (+ `ERD-2.md` mục 3.12–3.13). Bàn giao trước: `HANDOFF-LienThong-GD3-CauHinh-KhungKetNoi-2026-10-20-p3.md`.

## 0. Trạng thái một câu
Giai đoạn 3 (#242) **xong phần code và kiểm bằng cổng giả** (test API/core/web + Chrome thật): ô bổ sung 8b, dải kiểm 8a, hàng chờ `prescription_submission` xếp lúc ký/đính chính, bộ gửi nền mỗi phút, "Gửi ngay"/"Gửi lại", trang "Đơn thuốc liên thông" (8c), danh mục "Hình thức điều trị". **CHƯA kiểm với cổng thật** (chưa có môi trường thử). Chưa commit.

## 1. Đã làm phiên này
- **Dữ liệu**: 2 migration `20261021090000_reference_catalog_treatment_form`, `20261021100000_prescription_interop_submission` (bảng `encounter_interop_kind_info`, `prescription_submission`, RLS + FORCE). ERD v1.81 (`docs/ERD-2.md` 3.13).
- **Shared/core**: DTO ở `packages/shared/src/prescription-interop.ts`; `retry-policy.ts`, `dose-period.ts`, port `INTEROP_SUBMISSION_SOURCE_PORT`, `submitPrescription` ở port cổng, 4 lỗi nghiệp vụ mới (`INTEROP_INFO_LOCKED`, `INTEROP_GUARDIAN_EDIT_FORBIDDEN`, `INTEROP_SEND_DISABLED`, `INTEROP_SUBMISSION_NOT_SENDABLE`).
- **API**: `modules/encounter/` thêm `encounter-interop-info.{repository,service}.ts`, `prescription-interop-data.service.ts` (gom dữ liệu gửi), `prescription-interop-source.module.ts` (@Global bind port); `modules/prescription-interop/` thêm `prescription-submission.{repository,service,controller,job}.ts`; `EncounterService.signPrescription/amendPrescription` xếp/đồng bộ hàng chờ; adapter cổng thêm `submitPrescription`; danh mục `TREATMENT_FORM` kiểm mã số ở `ReferenceCatalogService`.
- **Web** (`features/prescription-interop/`): `InteropInfoBlock.tsx` (chèn ở `PrescriptionPanel`), `InteropSubmissionListPage.tsx` (route `/prescription-interop/submissions`), `interop-info-view.ts` (hàm thuần + test), api/queries; pill "Hình thức điều trị" ở `CatalogAdminPage`; câu gợi ý công tắc tổng đổi về đúng mockup 8d.
- **Chủ dự án chốt trong phiên (20/10)**: mục menu "Đơn thuốc liên thông" nằm trong **Quản trị, dưới "Mẫu in"** (không ở "Khám bệnh").

## 2. Kết quả test cuối phiên
- **Cô lập tenant/chi nhánh (báo ĐẦU)**: `prescription-submission-http.spec.ts` có ca cô lập 2 chi nhánh cùng công ty + 2 công ty (danh sách, "Gửi ngay"/"Gửi lại", ô 8b GET/PUT — id lạ → 404; công ty khác bật liên thông thì lượt khám của ta cũng 404), và toàn bộ test cô lập sẵn có (`rls-coverage`, `branch-*`, `tenant-*`) xanh.
- **Toàn bộ**: API **100 file / 1628 test xanh**; core 485; web 212; shared 96; setup 76. `tsc` API + web sạch; ESLint các file mới sạch (spec e2e mới có `eslint-disable no-explicit-any` kèm lý do; `prescription-interop-gateway-http.spec.ts` cũ vẫn còn lỗi `any` có từ trước).
- **Test mới**: `prescription-submission-http.spec.ts` 19 ca; adapter `submitPrescription` 4 ca (spec adapter 29 ca); core `retry-policy.spec.ts` 8 ca; web `interop-info-view.spec.ts` 11 ca.
- **Kiểm đột biến 6/6 bị bắt**: M1 bỏ lọc chi nhánh ở `findInBranch` (lúc đầu SỐNG SÓT vì phạm vi cá nhân của `prescription.sign` chặn thay — đã siết ca cô lập cho bác sĩ chi nhánh B là NGƯỜI KÝ của dòng, sau đó bị bắt); M2 bỏ "thử lại ngay" khi bổ sung ô 8b; M3 lỗi dữ liệu cũng tự thử lại (bị bắt bởi test đơn vị core, e2e không đi qua nhánh đó); M4 luôn xếp hàng kể cả công tắc tắt; M5 đính chính sau khi gửi không thành AMENDED; M6 bỏ khoá sửa ô 8b sau khi gửi.
- **Chrome thật** (cổng giả cục bộ, tenant dev): ký 3 loại đơn C/N/Y, lưu ô 8b, người giám hộ trẻ <72 tháng, hàng chờ, "Gửi ngay"/từ chối/xem lỗi/"Gửi lại", cổng chết, tắt công tắc ẩn đủ (menu, khối, trang), danh mục hình thức điều trị (mã chữ bị chặn).

## 3. Bẫy đã gặp / điều cần biết
- **Web chỉ `import type` từ `@nexamed/shared`** (bản dist là CommonJS): import giá trị (hằng nhãn) làm trắng trang ở Chrome mà test đơn vị không bắt được → luôn kiểm Chrome thật trang mới.
- **Shell của công cụ ăn dấu `\`** trong chuỗi truyền qua `node -e`/heredoc (regex `\d` thành `d` — suýt gây lỗi âm thầm ở `ReferenceCatalogService`): viết script vá bằng công cụ Write rồi chạy `node file.cjs`; sau khi vá mã có regex, `grep` lại dòng đó.
- `prisma migrate deploy` chạy trực tiếp dùng role ứng dụng → lỗi quyền và để lại bản ghi migration "thất bại" (P3009): luôn dùng `pnpm db:deploy` (role migrate); nếu đã lỡ, `pnpm exec node scripts/with-migrate-url.mjs migrate resolve --rolled-back <tên>`.
- `tenant-fixture.ts` PHẢI xoá `prescription_submission`, `encounter_interop_kind_info` trước `prescription_document`/lượt khám (đã thêm); bảng mới sau này cũng vậy.
- Audit: chuỗi action trong khối `writeAuditLog` phải là literal (test `audit-labels-coverage` quét mã) — đừng truyền biến.
- Thứ tự kiểm `sendNow`: dòng thuộc chi nhánh/người dùng (404) TRƯỚC công tắc gửi (409), nếu không lộ sự tồn tại.
- Quan sát (chưa xử lý, có từ trước, KHÔNG do khối liên thông): ở màn khám `document.documentElement.scrollHeight` > chiều cao cửa sổ (≈1502 so với 1000 ở 1440×1000) trong khi `/`, `/patients`, `/reception` thì bằng nhau; ẩn khối liên thông không đổi số đo. Nên truy phần tử gây tràn nếu muốn.

## 4. Việc còn lại / câu hỏi treo
- Kiểm với cổng thật khi đơn vị vận hành cấp môi trường thử (gửi `docs/product/prescription-interop-questions.md`): đặc biệt câu 16 (giá trị "hình thức điều trị"), 10 (cập nhật đơn đã gửi khi đính chính), chữ hoa/thường mã đơn, tên trường chẩn đoán, khuôn `dot_dung_thuoc`, định dạng người giám hộ, `signature`.
- Nạp danh mục "Hình thức điều trị" chính thức (hai mục 1/2 ở tenant dev là dữ liệu thử của ta, không phải mã chính thức).
- API nhà thuốc (8e) làm sau, duyệt phạm vi riêng. Chữ ký số, số thẻ BHYT trên gói gửi (S2-04).
- Việc cũ không đổi: xem `docs/CURRENT.md` (S6-02/S6-04, 1.0.0 sau pilot, hạ tầng SaaS, gói on-prem chưa dựng lại, hộp in thật của trình duyệt).

## 5. Môi trường dev
- Tenant test cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, `dev.admin` / `Dev@12345` (vừa clinic_admin vừa doctor). Cuối phiên đã trả cấu hình về: liên thông TẮT, mã đơn thuốc chế độ "Tuỳ chỉnh". Dữ liệu thử còn lại (không xoá được): 3 đơn đã ký + hàng chờ của hai lượt khám thử, 2 mục "Hình thức điều trị", mã quốc gia 20 ký tự trên 3 thuốc VF2010, mã/mật khẩu liên thông mẫu của cơ sở `CS-UI-01` và bác sĩ `BS-UI-ADMIN`.
- Môi trường khác cần `pnpm db:deploy` (thêm 2 migration `20261021…`) + khởi động lại API; không có quyền mới.
- Kiểm Chrome: `playwright-core@1.49.1` ở thư mục tạm, Chrome ở `C:\Program Files\Google\Chrome\Application\chrome.exe`; cổng giả cục bộ `127.0.0.1:4455` (chế độ ok/reject/down) viết ở scratchpad, không lưu vào repo. Viewport cao (≥2300) để chụp cả vùng cuộn của màn khám.
