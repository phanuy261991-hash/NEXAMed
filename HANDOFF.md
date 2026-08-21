# HANDOFF — Bàn giao phiên làm việc (tạm thời, xoá sau khi đã đọc/dùng xong)

**Ngày**: 2026-08-21. File này KHÔNG phải tài liệu chính thức của dự án — chỉ để phiên Claude Code
mới (không có lịch sử hội thoại này) đọc và tiếp tục ngay công việc đang dở. Sau khi tiếp tục xong,
có thể xoá file này (nội dung quan trọng cần giữ lâu dài sẽ được chuyển vào `docs/DECISIONS.md`,
`docs/CURRENT.md`, `docs/CHANGELOG.md` ở bước cuối).

## Đang làm: tính năng "Danh mục Dị nguyên" (Allergens) — mới, chưa commit

Chủ dự án yêu cầu thêm danh mục "Dị nguyên" trong menu "Danh mục Chuyên môn" (cạnh ICD-10), UI 2
cột (trái = Nhóm dị nguyên, phải = Dị nguyên thuộc nhóm đang chọn) — tham khảo UI "Khoa/Phòng"
(`DepartmentPane.tsx`). Đã lên kế hoạch qua `EnterPlanMode` + `AskUserQuestion`, được duyệt, đã code
xong toàn bộ backend + frontend + test + seed dữ liệu thật. Chưa cập nhật tài liệu dự án, chưa
commit.

### Quyết định đã chốt với chủ dự án (không tự đổi)
- Toàn hệ thống, KHÔNG tenant_id (giống `reference_catalog`/`icd10_catalog`), không phải theo từng
  phòng khám như Khoa/Phòng.
- Mã Nhóm dị nguyên VÀ mã Dị nguyên đều **tự sinh, không cho nhập tay** (client không gửi `code`).
- Bảng "Dị nguyên" (cột phải) hiện cột "Mã"; "Nhóm dị nguyên" (cột trái) KHÔNG hiện mã (dù DB có
  cột `code` cho cả 2 bảng, chỉ ẩn ở UI).
- Vị trí: pill "Dị nguyên" cạnh pill "ICD-10" trong `CatalogClinicalPage.tsx` (`/admin/catalog-clinical`).
- Permission riêng `allergen_catalog.read`/`allergen_catalog.manage` — KHÔNG tái dùng
  `reference_catalog.*` (khác trang: Dị nguyên ở "Danh mục Chuyên môn"/lâm sàng, reference_catalog
  ở "Danh mục hành chính").

### Đã code xong (toàn bộ file liên quan)

**Schema/migration**:
- `apps/api/prisma/schema.prisma` — model `AllergenGroup`, `Allergen` (không tenant_id, không 8 cột
  bắt buộc, không version — đúng ngoại lệ danh mục toàn hệ thống).
- `apps/api/prisma/migrations/20260821180000_allergen_catalog/migration.sql` — đã áp vào DB dev.

**packages/core**:
- `src/allergen/generate-code.ts` (+ `.spec.ts`) — `generateAllergenGroupCode()` (tiền tố `NDN-`),
  `generateAllergenCode()` (tiền tố `DN-`).
- `src/allergen/data.ts` (+ `.spec.ts`) — `ALLERGEN_CATALOG_SEED`: 7 nhóm, 150 dị nguyên, dữ liệu
  thật do chủ dự án cung cấp (xem dưới).
- `src/errors/allergen-errors.ts` — `AllergenGroupDuplicateCodeError`, `AllergenDuplicateCodeError`,
  `AllergenGroupInvalidReferenceError`.
- `src/rbac/permissions.ts` — thêm `allergen_catalog.read` (global: receptionist/nurse/doctor/
  clinic_admin), `allergen_catalog.manage` (global: chỉ clinic_admin).
- `src/index.ts` — export 2 mục mới ở trên.

**packages/shared**: `src/allergen.ts` (schemas Zod đầy đủ) + export trong `src/index.ts`.

**apps/api**: module mới `src/modules/allergen/` (`allergen-group.{controller,service,repository}.ts`,
`allergen.{controller,service,repository}.ts`, `allergen.module.ts`, `allergen-http.spec.ts` — 12
test, đã pass). Đăng ký `AllergenModule` trong `app.module.ts`. Thêm 2 mã lỗi mới vào
`common/domain-exception.filter.ts`. Đăng ký 10 endpoint mới trong `scripts/generate-openapi.ts`.

**Seed dữ liệu thật** (chủ dự án cung cấp file `C:\Users\Administrator\Downloads\DiNguyen.md`):
- Copy nguyên văn vào `docs/data/allergen-catalog.md` (đúng tiền lệ ICD-10 — lưu nguồn gốc trong repo).
- `packages/core/src/allergen/data.ts` — nhúng tay thành mảng `ALLERGEN_CATALOG_SEED` (7 nhóm:
  Thuốc 50, Thực phẩm 40, Môi trường 13, Động vật 6, Côn trùng 10, Tiếp xúc 30, Khác 1 = 150).
- `apps/api/src/infrastructure/persistence/seed-allergen-catalog.ts` — seed idempotent THEO TÊN
  (không theo `code` vì code tự sinh ngẫu nhiên, không có mã nguồn cố định như ICD-10/dân tộc).
  Đã đăng ký vào `apps/api/prisma/seed/index.ts`.
- **Đã chạy `pnpm --filter @nexamed/api run db:seed` — xác nhận DB dev có đúng 7 nhóm/150 dị
  nguyên, chạy lại lần 2 vẫn đúng số (idempotent, không tạo trùng).**

**apps/web**: `src/features/allergen/` (`allergen.api.ts`, `allergen.queries.ts`, `AllergenPane.tsx`
— clone cấu trúc `DepartmentPane.tsx`). `CatalogClinicalPage.tsx` thêm pill "Dị nguyên".

### 3 lỗi thật đã phát hiện + sửa trong lúc kiểm tra bằng Chrome thật (Playwright, `playwright-core`
qua Chrome hệ thống — xem mục "Công cụ kiểm tra" bên dưới)

1. **403 lúc mới bật tính năng**: quên chạy `pnpm --filter @nexamed/api run db:seed` sau khi thêm
   permission mới vào `permissions.ts` — bảng `permission` (catalog) chỉ seed qua script riêng,
   KHÔNG tự chạy mỗi lần API khởi động (`syncRolePermissionsForAllTenants()` trong `main.ts` chỉ
   backfill `role_permission` dựa trên permission ĐÃ CÓ trong DB, bỏ qua permission chưa seed —
   xem comment trong `sync-role-permissions.ts` dòng ~44). **Bài học: thêm permission mới trong
   `packages/core/src/rbac/permissions.ts` LUÔN phải chạy `db:seed` rồi restart API để
   `syncRolePermissionsForAllTenants()` backfill cho tenant cũ.**
2. **Bug thật**: khi đang chọn 1 Nhóm dị nguyên cụ thể ở cột trái rồi bấm "Thêm Dị nguyên", form
   mặc định gán vào nhóm ĐẦU TIÊN trong danh sách (`groups[0]`) thay vì nhóm đang chọn — đã sửa
   bằng thêm prop `defaultGroupId={selectedGroupId ?? undefined}` truyền vào `AllergenFormModal`.
3. **Bug thật (đang dở — xem mục "VIỆC TIẾP THEO")**: danh sách Dị nguyên dài (50-150 dòng) KHÔNG
   cuộn được — div bọc bảng dùng `overflow-hidden` (cắt cứng, chặn cuộn) thay vì cho phép cuộn, và
   thiếu `min-h-0` truyền qua các tầng flexbox nên bảng tự giãn theo nội dung thay vì bị giới hạn
   chiều cao. **Đã sửa xong cho riêng `AllergenPane.tsx`**: thêm `min-h-0` vào 2 cột trái/phải,
   tách bảng vào 1 div con `h-full overflow-y-auto scroll-hover` riêng (div ngoài giữ
   `overflow-hidden` chỉ để bo góc đẹp), thêm `sticky top-0 z-10` cho `<thead>` để tiêu đề cột dính
   khi cuộn. **Đã xác minh qua Playwright thật**: cuộn được, tiêu đề dính đúng (xem screenshot đã
   chụp trong scratchpad phiên trước, không còn tồn tại sau khi phiên kết thúc).

## VIỆC TIẾP THEO — chủ dự án vừa yêu cầu, ĐANG LÀM DỞ khi bị ngắt

> "kiểm tra lại các danh mục khác tiêu đề cột cuộn không dính cố định chỉnh lại cho đồng bộ nhớ ghi
> vào thiết kế để sau này tạo giao diện danh sách không phải nhắc"

Đã grep ra danh sách file có cùng pattern bảng danh mục (`overflow-hidden rounded-lg border` +
`<table`) CẦN KIỂM TRA xem có bị cùng lỗi (không cuộn được / thead không sticky) như `AllergenPane`
bị trước khi sửa hay không:

1. `apps/web/src/features/reception/ReceptionIntakeForm.tsx`
2. `apps/web/src/features/department/DepartmentPane.tsx`
3. `apps/web/src/features/clinic/RoomPane.tsx`
4. `apps/web/src/features/reference-catalog/ReferenceCatalogPane.tsx`
5. `apps/web/src/features/user-account/UserAccountPane.tsx`
6. `apps/web/src/features/catalog-clinical/Icd10Pane.tsx`
7. `apps/web/src/features/geo/GeoPane.tsx`
8. `apps/web/src/features/allergen/AllergenPane.tsx` (đã sửa xong, dùng làm MẪU CHUẨN để đối chiếu)

**Việc cần làm theo thứ tự**:
1. Đọc từng file trong 7 file còn lại (1-7), tìm đúng đoạn bọc `<table>` (thường dạng
   `<div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><table>...`).
   Kiểm tra: (a) cha của nó có `min-h-0` không (nếu cha là flex-col container với `flex-1`), (b) div
   bọc bảng có tách riêng 1 lớp `overflow-y-auto` bên trong hay đang để `overflow-hidden` chặn cuộn
   luôn, (c) `<thead>` có `sticky top-0 z-10` chưa.
2. Sửa đồng bộ theo ĐÚNG mẫu đã áp dụng cho `AllergenPane.tsx` (xem diff cụ thể — mẫu chuẩn):
   ```tsx
   <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
     <div className="scroll-hover h-full overflow-y-auto">
       <table className="w-full border-collapse text-sm">
         <thead className="sticky top-0 z-10">
           <tr className="border-b-2 border-blue-600 bg-slate-100 ...">...</tr>
         </thead>
         <tbody>...</tbody>
       </table>
     </div>
   </div>
   ```
   Và div cha trực tiếp (cột chứa bảng, kiểu `flex flex-col`) phải có thêm `min-h-0` (không chỉ
   `flex-1`) để chiều cao truyền đúng qua các tầng flexbox lồng nhau — nếu không bảng vẫn tự giãn
   theo nội dung và tràn ra ngoài thay vì bị giới hạn để cuộn.
   **LƯU Ý**: không phải file nào trong 7 file cũng chắc chắn bị lỗi — có thể một số đã đúng sẵn
   (ví dụ nếu danh sách luôn ngắn/không dùng flex-1 bao ngoài). Chỉ sửa nơi THỰC SỰ bị (kiểm tra kỹ
   trước khi sửa, không sửa hàng loạt không cần thiết).
3. Sau khi sửa xong tất cả, **ghi quy tắc này thành mục MỚI trong
   `.claude/docs/ui-guidelines.md`** (đọc file này trước để biết đánh số mục tiếp theo, có thể là
   mục 9c hoặc mục mới sau mục 9 "List Screen Pattern" / mục 4.4 "Enter-to-submit") — mô tả:
   - Mọi bảng danh mục (danh sách các mục quản lý qua UI dạng bảng `<table>`) PHẢI cuộn được khi nội
     dung dài hơn khung nhìn, KHÔNG dùng `overflow-hidden` trực tiếp trên div chứa `<table>` (chỉ
     dùng `overflow-hidden` cho div NGOÀI để giữ bo góc, còn scroll thật nằm ở div con riêng).
   - `<thead>` luôn `sticky top-0 z-10` để tiêu đề cột không biến mất khi cuộn sâu.
   - Toàn bộ chuỗi flex-col cha (từ layout ngoài cùng tới div bọc bảng) phải có `min-h-0` ở MỌI
     tầng có `flex-1`, nếu không trình duyệt sẽ để nội dung tự giãn thay vì bị giới hạn theo không
     gian thật — đây là lỗi thật đã xảy ra (`AllergenPane.tsx`, docs/DECISIONS.md #069/#070).
   - Đây là QUY TẮC BẮT BUỘC cho mọi bảng danh mục mới từ nay — không phải hỏi lại mỗi lần.
4. `pnpm -w run typecheck && pnpm -w run lint && pnpm -w run build` sạch (đã chạy build 1 lần
   trước khi bị ngắt — CẦN CHẠY LẠI sau khi sửa các file 1-7, chưa xác nhận xong).
5. Kiểm tra bằng Playwright thật (xem mục "Công cụ kiểm tra" bên dưới) ít nhất 1-2 trang đã sửa
   (ví dụ `ReferenceCatalogPane`/`DepartmentPane`) để xác nhận cuộn + sticky hoạt động đúng, không
   vỡ layout.

## Việc CHƯA làm sau khi xong mục trên

1. **Cập nhật tài liệu cho toàn bộ tính năng Dị nguyên + fix đồng bộ cuộn** (chưa làm bất kỳ file
   nào dưới đây cho tính năng này):
   - `docs/ERD.md` — bump version, thêm bảng `ALLERGEN_GROUP`/`ALLERGEN` vào sơ đồ mermaid mục 2,
     thêm dòng vào bảng mục 3.5 "Danh mục", thêm dòng lịch sử phiên bản mục 9.
   - `.claude/docs/data-model.md` — mục `allergen_group`/`allergen` (đúng khuôn `reference_catalog`).
   - `.claude/docs/security-audit.md` — thêm 2 permission mới vào bảng ma trận mặc định.
   - `docs/DECISIONS.md` — thêm entry mới **#069** (quyết định thiết kế: global scope, mã tự sinh,
     permission riêng, vị trí UI) VÀ có thể **#070** riêng cho phần "nạp dữ liệu thật + sửa đồng bộ
     lỗi cuộn tất cả bảng danh mục" (tách 2 entry cho rõ, vì là 2 phiên làm việc/2 loại thay đổi
     khác nhau — chốt kiến trúc vs. vận hành/bugfix).
   - `docs/CURRENT.md` — đoạn ngắn gọn (theo đúng phong cách các đoạn "Ngoài kế hoạch" đã có, xem
     các đoạn gần cuối file) mô tả tính năng mới + bug đã sửa + đã seed 150 dị nguyên thật.
   - `docs/CHANGELOG.md` — entry mới ở đầu file (ngày 2026-08-21, số thứ tự tiếp theo sau (5) hiện
     có), tóm tắt toàn bộ thay đổi.
2. **`pnpm -w run build` lần cuối** để xác nhận sạch (lệnh này ĐANG chạy dở khi bị ngắt lần đầu,
   chưa có kết quả).
3. **Hỏi chủ dự án có muốn commit + push không** (theo đúng thói quen — chỉ commit khi được yêu
   cầu rõ ràng, xem `CLAUDE.md`/system prompt). Thông điệp commit gợi ý theo đúng style repo (xem
   `git log`): `feat(api,web): danh muc Di nguyen (nhom + di nguyen), nap du lieu that, chuan hoa
   cuon bang danh muc - #069`.
4. **Dọn file `HANDOFF.md` này** sau khi đã đọc/dùng xong (không phải tài liệu chính thức, không
   nên còn tồn tại trong repo về lâu dài — nếu quên, ít nhất đừng commit nó).

## Công cụ kiểm tra UI đã dùng trong phiên trước (để tái sử dụ nếu cần)

- **Playwright**: KHÔNG có `chromium-cli` trong môi trường này. Cài `playwright-core` tạm ở
  scratchpad (`cd <scratchpad>/pw && npm install playwright-core@1.47`), dùng
  `executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'` (Chrome hệ thống
  thật, không tải Chromium bundled — từng bị treo do antivirus ở phiên rất trước).
- **Viết file script `.mjs` bằng tool Write, KHÔNG dùng bash heredoc** (`cat > file <<'EOF'`) để tạo
  file `.mjs` có chuỗi Windows path `C:\\...` — heredoc trong git-bash ăn mất dấu `\\` gây lỗi
  đường dẫn sai. Dùng Write tool trực tiếp là an toàn.
- **Tenant/tài khoản dev đang dùng để test** (tenant riêng tạo trong phiên trước, KHÔNG phải tenant
  gốc `01a01ea3-...` ban đầu trong `config.example.json`):
  - `apps/web/public/config.json` hiện đang trỏ `tenantId: "01a02381-ef0f-7a0a-9a1c-d9af5c845abf"`.
  - Tài khoản `dev.admin` / `Dev@12345` (vai trò `clinic_admin`) — **đã từng bị khoá do đăng nhập
    sai nhiều lần trong phiên trước, đã mở khoá bằng script Prisma trực tiếp** (update
    `failedLoginCount=0, lockedUntil=null` qua `MIGRATE_DATABASE_URL`). Nếu tái diễn, làm y hệt.
  - Tài khoản `dev.doctor` / `Dev@12345` (vai trò `doctor`) — tạo qua API bởi `dev.admin` ở phiên
    trước đó (dùng cho việc khác, không liên quan trực tiếp allergen).
  - Đã có dữ liệu test rác (nhóm "Debug nhom 1", "Nhóm test ...") được TẠO RA rồi ĐÃ XOÁ SẠCH bằng
    script dọn dẹp cuối phiên — KHÔNG còn tồn tại trong DB nữa (đã xác nhận qua truy vấn count).
  - Rate limit `/auth/login`: 10 request/phút/IP — tránh gọi liên tục khi test, chờ nếu bị 429.
- **Dev server**: chạy nền qua `pnpm dev` (background), cổng API 3000 / web 5173. **Mỗi khi sửa
  `schema.prisma`, PHẢI dừng server trước khi `prisma generate`** (Windows khoá file
  `query_engine-windows.dll.node` khi server đang chạy, gây lỗi `EPERM`) — tìm PID bằng
  `netstat -ano | grep :3000`, `taskkill //PID <pid> //F`, rồi `pnpm --filter @nexamed/api exec
  prisma generate`, migrate, sau đó khởi động lại `pnpm dev` (background) và đợi poll cổng phản
  hồi trước khi dùng Playwright.
- **Sau khi đổi API contract** (thêm/sửa endpoint hoặc schema Zod dùng trong `generate-openapi.ts`):
  luôn chạy `pnpm --filter @nexamed/api run openapi:generate` RỒI `pnpm --filter @nexamed/web run
  api:codegen` trước khi web typecheck được — không tự sửa tay `openapi.json`/`openapi-schema.d.ts`.

## Trạng thái kiểm tra tại thời điểm ghi file này

- `pnpm -w run typecheck` — sạch (đã chạy sau khi sửa lỗi cuộn AllergenPane).
- `pnpm -w run lint` — sạch, chỉ còn đúng 4 lỗi cấu hình ESLint đã biết từ trước (không liên quan,
  đã ghi nhận nhiều lần trong `docs/CHANGELOG.md` các phiên trước).
- `pnpm --filter @nexamed/api run test` (toàn bộ) — trước khi bắt đầu sửa lỗi cuộn: 386/387 pass,
  1 fail là flake MÔI TRƯỜNG đã biết từ trước (`appointment-http.spec.ts`, `new Date()` thật va
  chạm fixture cố định đúng ngày 21 hằng tháng — không liên quan allergen, đã ghi nhận nhiều lần
  trong CHANGELOG các phiên trước, KHÔNG phải regression).
- `pnpm --filter @nexamed/api exec vitest run src/modules/allergen` — 12/12 pass.
- `pnpm --filter @nexamed/core run test` — 85/85 pass (bao gồm 8 test allergen mới:
  `generate-code.spec.ts` 4 + `data.spec.ts` 4).
- `pnpm -w run build` — ĐÃ CHẠY 1 LẦN THÀNH CÔNG (trước khi sửa lỗi cuộn). **CẦN CHẠY LẠI** sau khi
  sửa lỗi cuộn AllergenPane (đã sửa) VÀ sau khi sửa đồng bộ 7 file còn lại (chưa làm) — lệnh này bị
  người dùng ngắt giữa chừng lúc đang chạy lần 2.
