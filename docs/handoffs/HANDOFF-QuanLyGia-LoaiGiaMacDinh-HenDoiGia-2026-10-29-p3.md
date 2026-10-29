# HANDOFF — Quản lý giá (Loại giá mặc định, một giá gốc, Hẹn đổi giá, #268) + hai việc nhỏ của #267 — 2026-10-29 (phần 3)

> Hội thoại luôn tiếng Việt. Commit/push thẳng `master` CHỈ khi chủ dự án yêu cầu. Trước push: `pnpm typecheck` + `pnpm lint` + đúng 1 lượt full API (đọc DÒNG TỔNG KẾT của vitest, không tin mã thoát của lệnh nền có `tail`).

## Trạng thái một câu
Mọi thứ đã commit + push, `master` khớp `origin/master` (HEAD `c9697b5`); trọn bộ API 1856 xanh, web 421 xanh, typecheck/lint/`db:check-schema` sạch; **chưa xem CI GitHub** của các commit mới. Không có việc dở trong cây làm việc.

## Commit của phiên này (cũ → mới)
| Commit | Nội dung |
|---|---|
| `70b5f92` | Test cho "Sao chép đơn lần trước" mang kiểu kê (#267): tách logic ra `features/encounter/prescription-draft-lines.ts`, `singleDoseText` chuyển về `prescription-dose-preview.ts` |
| `a9eee51` | Sửa lỗi: sao chép đơn lần trước KHÔNG còn làm mất thuốc kê tự do (trước đây đơn đang kê có MỘT dòng tự do thì mọi dòng tự do của đơn cũ bị bỏ im lặng; nay so theo TÊN, bỏ khoảng trắng, không phân biệt hoa/thường) |
| `7f27c71` | **#268 quản lý giá** (30 file, xem dưới) |
| `c9697b5` | Sửa tài liệu trạng thái cho khớp "đã push" |

## #268 — điều đã chốt (đọc `docs/DECISIONS.md` #268 để biết lý do đầy đủ)
- **Chỉ Dịch vụ khám có Loại giá** (giữ nguyên form, lễ tân chọn tay). **Dịch vụ kỹ thuật/Thuốc/VTYT/Gói**: MỘT giá gốc + `price_list`.
- **Loại giá mặc định** = `reference_catalog.is_default` (một/công ty, CHECK chỉ `PRICE_TYPE` đang dùng, partial unique). **KHÔNG hồi tố**; chỉ công ty chưa có Loại giá nào được nạp sẵn "Thường" (`THUONG`) ở `seedReferenceCatalogForTenant`.
- **Tiếp nhận** chọn sẵn mức mặc định CHỈ khi dịch vụ có đơn giá hiệu lực hôm nay cho mức đó; không thì TRỐNG (không tự nhảy sang mức khác).
- **Máy chủ**: `PriceableCatalogService.priceTypeOrder` xếp mặc định ĐẦU → chỉ định cận lâm sàng, tra giá, giá lẻ của gói theo mặc định, không còn phụ thuộc thứ tự danh mục. Chỉ định đã lưu không đổi (giá chụp lúc lập).
- **Dịch vụ kỹ thuật**: form chỉ còn Đơn vị tính + Đơn giá + ô "Hẹn đổi giá từ ngày…". Cột `technical_service_price.price_type_code` và khoảng ngày GIỮ trong CSDL (chỉ ẩn ở giao diện). Hẹn đổi giá = thêm dòng cùng mức từ ngày hẹn, dòng hiện hành tự đóng vào HÔM TRƯỚC; đến ngày hẹn KHÔNG có job nào chạy (tra theo ngày áp giá lúc tính tiền).
- **Bảng giá**: dòng "Giá mới" của dịch vụ kỹ thuật hiện "Giá gốc", không còn ô Loại giá.
- **Đã loại khỏi phạm vi (đừng bàn lại)**: luật tự động "ngoài giờ"; giá BHYT; tầng giá dạng CỘT (`price_vip`…); Loại giá ở mức lượt khám.

## Chỗ nào trong mã
- DB: `apps/api/prisma/migrations/20261029140000_reference_catalog_default_price_type/` (cột + CHECK + partial unique). Môi trường khác cần **`db:deploy` + `db:seed`**.
- API: `reference-catalog.service.ts` (cờ mặc định, `isDefaultFlagViolation`), `reference-catalog.repository.ts` (`clearDefaultExcept`, `setActive` bỏ cờ khi ẩn), `pricing/priceable-catalog.service.ts` (`priceTypeOrder`), lỗi mới `REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED`.
- Web: `reference-catalog/ReferenceCatalogPane.tsx` (cột + ô tích), `reception/default-price-type.ts` + `ReceptionIntakeForm.tsx`, `paraclinical/technical-service-price-model.ts` (logic thuần: chọn mức, tách dòng, `buildPriceLines`, kiểm hợp lệ) + `TechnicalServiceFormDialog.tsx`, `pricing/PriceListDetailPage.tsx`.
- Test: `reference-catalog-default-http.spec.ts` (14), `clinical-order-http.spec.ts` (+1), `technical-service-http.spec.ts` (+1), `technical-service-price-model.spec.ts` (34), `default-price-type.spec.ts` (7). Đã kiểm đột biến (chỉ sót ca thiếu lọc `tenant_id` — RLS che nên không quan sát qua HTTP).

## Việc còn lại (đều cần chủ dự án hoặc môi trường khác)
1. **Chủ dự án xem lại 4 điểm lệch mockup** ghi ở #268: ghi chú đầu trang Loại giá nằm TRÊN thanh công cụ; dòng nhắc "mặc định — đổi được" ở Tiếp nhận nằm DƯỚI hàng chọn dịch vụ; Đơn vị tính/Đơn giá có `*` và THỰC SỰ bắt buộc cho dịch vụ thực hiện tại phòng khám (form cũ cho lưu không giá); hộp "còn N mức giá cũ đã ẩn".
2. **Lớp chặn máy chủ cho dòng "Giá mới" sai mức** — CHƯA làm vì mâu thuẫn quyết định ghi sẵn ở `PriceListService.validateLines` ("cho phép đặt giá cho mức chưa có"); cần chủ dự án duyệt đảo ngược. Giao diện đã hết chọn sai.
3. **Sau khi nâng cấp máy pilot**: công ty đang có Loại giá sẽ KHÔNG có mặc định cho tới khi chủ phòng khám tự tích một mục — báo họ, nếu không Tiếp nhận vẫn để trống như cũ (không lỗi). Gói on-prem chưa dựng lại cho các thay đổi từ 16/10.
4. **#267 còn mở**: gửi câu hỏi 22a (thuốc "khi cần" không có số ngày thì cổng đơn thuốc xử lý sao) cho đơn vị vận hành — `docs/product/prescription-interop-questions.md`; chủ dự án xem lại điểm lệch mockup của #267 phần 1 (5 điểm) và phần 2 (3 điểm).
5. **CI GitHub** của `7f27c71`/`c9697b5`/`a9eee51`/`70b5f92` chưa kiểm (lần xanh gần nhất đã biết: các commit #263–#264).
6. Việc treo cũ không đổi: S6-02/S6-04 trên máy chủ pilot, phát hành `1.0.0`, kiểm cổng đơn thuốc thật, hạ tầng SaaS, gói Nhi khoa (tạm dừng), gỡ luật tường lửa "NEXAMed LAN test 8181" (cần Administrator).

## Bẫy đã gặp (đừng lặp lại)
- **`replacePrices` của dịch vụ kỹ thuật là "thay sạch"** (xoá mềm mọi dòng rồi ghi lại): mọi form gửi giá PHẢI mang kèm mọi dòng ẩn nguyên vẹn (`buildPriceLines`) — bỏ sót là mất mức giá cũ.
- **Web không import mã chạy từ `packages/*`** (#073): luật xếp mức ở web (`rankPriceTypeCodes`) và máy chủ (`priceTypeOrder`) là HAI bản phải khớp nhau; sửa một bên là sửa cả hai.
- **Chỉnh sửa bám theo Ô chứ không theo MỨC**: gõ giá trước lúc danh mục Loại giá tải xong thì ghi nhầm mức — đã sửa bằng khung xương (`Skeleton`) tới khi danh mục về; đừng bỏ.
- **Vá file bằng shell dễ hỏng** (CRLF + dấu `\`): dùng script Node có tiện ích vá giữ kiểu xuống dòng, kiểm `old` xuất hiện đúng một lần. Nhiều file `.ts/.md` của repo là CRLF.
- **Không xoá cứng được dịch vụ kỹ thuật/mục danh mục** (không có route DELETE): dọn dữ liệu thử bằng `PATCH {version, isActive:false}`; mã đã dùng không tạo lại được → khôi phục mục đã ẩn. Danh sách giao diện vẫn hiện mục đã ẩn nên kịch bản Chrome phải đặt TÊN DUY NHẤT mỗi lần chạy (từng mở nhầm bản ghi cũ và tưởng là lỗi sản phẩm).
- **Kiểm LAN IP với dev server**: `apps/web/public/config.json` (git-ignored) bỏ `apiBaseUrl` + chạy `VITE_DEV_API_PROXY=http://localhost:3001 npx vite --host 0.0.0.0 --port 5190 --strictPort` → mở `http://<IP LAN>:5190` (IP máy này lúc kiểm: `192.168.3.16`). Nhớ **khôi phục `config.json`** (`apiBaseUrl: http://localhost:3001` + `tenantId`) và tắt các tiến trình sau khi xong.
- Đừng tắt mọi `chrome.exe` (có thể đóng Chrome của chủ dự án): chỉ `browser.close()` của Playwright hoặc kill đúng PID.
- Không dùng superuser SQL để sửa dữ liệu nghiệp vụ; dev tenant cố định `01a0cc3c-8626-746b-9d2a-5ea0268ec19f`, đăng nhập `dev.admin` / `Dev@12345`. Dev tenant hiện KHÔNG có Loại giá mặc định (các mục `PT_SERVICE`/`PT_NORMAL`/`PT_VIP`, chưa ai tích).

## Kiểm bằng Chrome thật (đã làm, kịch bản nằm ở thư mục tạm của phiên — KHÔNG trong repo)
`chrome-gia.cjs` (21 kiểm: Loại giá + ô tích, Tiếp nhận chọn sẵn, thêm dịch vụ + Hẹn đổi giá, sửa dịch vụ nhiều mức giữ mức ẩn, lỗi 503 giữ dữ liệu) chạy 21/21 qua `localhost` VÀ qua IP LAN HTTP; `chrome-banggia.cjs` 3/3. Cần Playwright: `PLAYWRIGHT_CORE=/c/Users/Administrator/node_modules/playwright-core`. Nếu cần chạy lại, dựng lại theo mô tả trên (hoặc đưa vào `scripts/ui-audit/` nếu chủ dự án muốn giữ lâu dài). Dev server đã tắt cuối phiên (`pnpm dev` → API 3001 + web 5173).

## Gợi ý việc kế tiếp
Hỏi chủ dự án trả lời mục 1–2 ở trên; kiểm CI; nếu sắp giao khách thì dựng lại gói on-prem + nhắc họ tích Loại giá mặc định.
