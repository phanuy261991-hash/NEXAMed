# Coding Standards — NEXAMed

## Ranh giới module

Module **không** import trực tiếp module khác. Ba cách giao tiếp hợp lệ:

1. **Interface trong `packages/core/ports`** — khi cần đọc dữ liệu đồng bộ. Ví dụ `encounter` cần thông tin bệnh nhân: khai báo `PatientReaderPort` trong core, `patient` module hiện thực, DI ráp lại.
2. **Domain event** — khi hành động ở module A kéo theo phản ứng ở module B. Ví dụ `encounter.checked_in` → module `notification` gửi nhắc.
3. **Application service điều phối** — khi một use case chạm nhiều module trong cùng transaction. Đặt ở `apps/api/src/modules/<domain-chủ-đạo>`.

Cấm: `import { PatientService } from '../patient/patient.service'`.

## Event

- Tên event: `<domain>.<động từ quá khứ>` — `appointment.created`, `encounter.checked_in`, `prescription.signed`.
- Payload chỉ chứa ID và dữ liệu tối thiểu; không nhét cả entity. Handler tự đọc lại nếu cần.
- v1 dùng in-memory bus chạy đồng bộ trong transaction: handler lỗi thì rollback thao tác gốc. Khi chuyển sang message broker, handler phải idempotent — viết handler idempotent ngay từ bây giờ (kiểm tra trạng thái trước khi hành động, không giả định chỉ chạy một lần).

## Tầng trong API

```
Controller  → validate input (Zod), gọi service, map response. Không if/else nghiệp vụ.
Service     → điều phối use case, mở transaction, phát event. Không viết SQL.
Repository  → chỗ duy nhất gọi Prisma. Luôn lọc tenant_id và deleted_at IS NULL.
```

Transaction mở ở service, truyền client transaction xuống repository để ghi audit nằm cùng transaction với thao tác nghiệp vụ.

## Chống trùng lặp

- Trước khi viết hàm mới, tìm trong `packages/core` và `packages/shared`. Trùng logic lần thứ hai là dấu hiệu phải trích xuất ra dùng chung — không copy-paste rồi sửa nhẹ.
- Quy tắc nghiệp vụ (ngưỡng, công thức, danh sách trạng thái hợp lệ) khai báo một chỗ trong `packages/core`, cả web và api dùng chung. Không viết lại validation ở client theo trí nhớ.
- Component xuất hiện ở từ 2 màn hình trở lên chuyển vào `apps/web/src/shared`.
- Ngược lại, không trừu tượng hoá sớm: một lần dùng thì để nguyên tại chỗ, đừng dựng abstraction cho tình huống chưa xảy ra.

## Xử lý lỗi

- Lỗi nghiệp vụ dùng lớp trong `packages/core/errors`, có `code` là hằng số (`ENCOUNTER_INVALID_TRANSITION`, `APPOINTMENT_SLOT_CONFLICT`). Không ném `Error` trần, không ném chuỗi.
- Filter toàn cục map lỗi core sang HTTP: nghiệp vụ → 409/422, không tìm thấy hoặc khác tenant → 404, thiếu quyền → 403.
- Message lỗi trả client không chứa PII/PHI, không lộ tên bảng hay câu SQL.
- Không nuốt lỗi bằng `catch {}` rỗng. Không `console.log` để debug trong code merge vào `main`.
- **Phía giao diện, MỌI chức năng mới tự xử lý lỗi và gắn màn lỗi tương ứng** (chủ dự án chốt 23/10/2026, `docs/DECISIONS.md` #255): tải dữ liệu → `ErrorBanner`/`RecordLoadError`; thao tác ghi → thông báo cụ thể giữ dữ liệu; route mới ngoài `AppShell` → `errorElement: <RouteErrorScreen />`; không hiện `code`/thông điệp thô. Checklist 5 mục ở `.claude/docs/ui-guidelines.md` mục 17b — làm đủ trước khi báo xong, không đợi nhắc.

## TypeScript

- `strict: true`. Cấm `any` (dùng `unknown` rồi thu hẹp). Cấm `as` để ép kiểu qua mặt compiler, trừ khi có comment giải thích lý do.
- Type dữ liệu vào từ ngoài (request body, response bên thứ ba) luôn qua Zod parse, không `as SomeType`.
- Enum trạng thái khai báo trong `packages/shared` và dùng chung cả DB (Prisma enum), api và web.
- Hàm public trong `packages/core` khai báo rõ kiểu trả về, không dựa hoàn toàn vào suy luận.

## Đặt tên

- Biến và hàm tiếng Anh; comment và message hướng tới người dùng cuối bằng tiếng Việt.
- Thuật ngữ nghiệp vụ giữ nguyên một cách gọi trong toàn hệ thống: `encounter` (lượt khám), `appointment` (lịch hẹn), `tenant` (phòng khám), `prescription` (đơn thuốc). Không xen kẽ `visit`/`encounter` hay `clinic`/`tenant`.
- Boolean đặt tên khẳng định: `isSigned`, không `isNotSigned`.

## Test

- `packages/core`: unit test cho mọi quy tắc nghiệp vụ và mọi cạnh của state machine, không cần DB.
- Repository và use case chạm DB: integration test trên Postgres thật (testcontainers hoặc DB test riêng), không mock Prisma.
- Mỗi endpoint chạm dữ liệu bệnh nhân bắt buộc có test cách ly tenant (xem `multi-tenancy.md`).
- Sửa bug thì viết test tái hiện bug trước khi sửa.

## Hiệu suất (bắt buộc — chốt 2026-08-22, `docs/DECISIONS.md` #073)

Yêu cầu thường trực của chủ dự án: **luôn đảm bảo hiệu suất ứng dụng**, không đợi tới lúc chậm mới sửa. Các ngưỡng dưới đây đo được, kiểm được — không dựa vào cảm tính hay trí nhớ.

### Bundle web

- **Chunk khởi động (`index-*.js`) không vượt 500 kB** (ngưỡng cảnh báo mặc định của Vite). Vượt là dấu hiệu phải tách chunk, không phải để nâng `chunkSizeWarningLimit` cho hết cảnh báo. Số đo tham chiếu 2026-08-22 sau khi tách: **440 kB** (gzip 132 kB).
- **Mọi trang nghiệp vụ mới BẮT BUỘC thêm vào `app/router.tsx` dưới dạng `lazy(() => import(...))`**, không import tĩnh. Ngoại lệ cố ý (giữ eager, đã cân nhắc — không tự ý mở rộng danh sách này): `LoginPage`, `RequireAuth`, `AppShell`, `DashboardPage`, `ChangePasswordPage`, `NotFoundPage`/`ComingSoonPage`.
- Component export **named** nên phải map `.then((m) => ({ default: m.X }))` — không đổi file trang sang default export chỉ để tiện lazy (phá quy ước named export của codebase).
- `<Suspense>` đặt **quanh vùng nội dung trong `AppShell`**, không bọc cả app — Sidebar/TopBar phải còn nguyên trong lúc tải chunk. Fallback dùng chung: `shared/ui/PageFallback.tsx`.
- Kiểm nhanh trước khi merge thay đổi lớn ở web: `pnpm --filter @nexamed/web run build` và đọc bảng chunk — không có cảnh báo "chunks larger than 500 kB".

### Ranh giới phụ thuộc vì lý do hiệu suất

- **`apps/web` KHÔNG được import `@nexamed/core`** — đã cưỡng chế bằng ESLint (`no-restricted-imports` trên `apps/web/**`), không còn dựa vào quy ước ngầm. Lý do: `packages/core` chứa dữ liệu seed lớn phục vụ riêng tầng API (`icd10/data.ts` ~9.1 MB, `geo/data.ts` ~280 kB) — kéo vào web là rủi ro phình bundle trình duyệt.
- Cần một hàm thuần đang nằm ở `core` cho cả hai phía? **Chuyển hàm đó sang `packages/shared`**, không mở dependency `web → core`. (Tiền lệ: `stripVietnameseDiacritics` từng được thử import vào web, làm vỡ Rollup build — `docs/DECISIONS.md` #065.)
- Dữ liệu danh mục lớn phục vụ web thì đi qua **API + phân trang/tìm kiếm phía server**, không nhúng vào bundle.

### API và cơ sở dữ liệu

- Mọi truy vấn danh sách/tìm kiếm phải dựa trên index đã có (xem `docs/ERD.md` mục 5); thêm màn hình danh sách mới mà truy vấn theo cột chưa có index thì thêm index trong cùng migration.
- Endpoint gộp nhiều nguồn dữ liệu (kiểu `GET /encounters/:id/consultation`) phải tránh N+1 — join hoặc gom truy vấn, không lặp query theo từng dòng.
- Ngưỡng đã cam kết trong `docs/product/prd.md` mục 5, **đo bằng script thật, không ước lượng**: tìm bệnh nhân trên 50.000 hồ sơ **dưới 1 giây** (đo thật: < 35 ms — `apps/api/scripts/perf-patient-search.ts`); tải màn hình khám có đủ tiền sử **dưới 2 giây** (đo thật: 33 ms — `perf-consultation.ts`). Thêm màn hình nặng tương tự thì viết script đo cùng khuôn, chạy tay, không đưa vào CI.
- Danh sách có thể phình lớn ở web: virtualization bắt buộc (`.claude/docs/ui-guidelines.md` mục 9).

## Git

- Nhánh: `feat/<domain>-<mô tả ngắn>`, `fix/<domain>-<mô tả ngắn>`.
- Commit theo Conventional Commits: `feat(encounter): ...`.
- Một PR một mục đích. PR đụng vào schema phải kèm migration và cập nhật `.claude/docs/data-model.md` trong cùng PR.

## Import từ `@nexamed/shared` ở `apps/web` (bài học 15/10/2026, `docs/DECISIONS.md` #235/#236)

`apps/web` chỉ được import **KIỂU** (`import type`) từ `@nexamed/shared` — bản dist của gói là CommonJS nên Vite dev không nạp được giá trị (hằng số, schema Zod, hàm): trang trắng ở trình duyệt dù test, typecheck và build đều xanh, chỉ lộ khi chạy thật. Cần một hằng số/danh sách dùng ở web thì khai báo tại chỗ (`as const satisfies readonly Kiểu[]` để giữ khớp kiểu dùng chung), không import giá trị.

## Node 26 (chốt 23/10/2026, `docs/DECISIONS.md` #253)

Runtime của dự án là **Node 26** (LTS từ 28/10/2026; Node 20 đã hết hỗ trợ bảo mật từ 30/04/2026). Khi viết mã mới:

- **Mã server** (`apps/api`, `apps/setup`, `scripts/`, `packages/core`) được dùng API ổn định của Node 26. KHÔNG dùng API đã gỡ/deprecated ở Node 26: `http.Server.prototype.writeHeader` (dùng `writeHead`), module `_stream_*`, `module.register()`, `url.parse()` (dùng `new URL()`), cờ `--experimental-transform-types`.
- **Mã chạy ở trình duyệt** (`apps/web`, `packages/shared`) không được giả định API riêng của Node; `packages/shared` chỉ có KIỂU được `apps/web` import (xem mục ngay dưới).
- **KHÔNG dùng** Temporal, `Map.getOrInsert`/`getOrInsertComputed`, `Iterator.concat` (V8 14.6) và không có kế hoạch dùng: TypeScript 5.9.3 của dự án không có kiểu cho Temporal (báo `TS2304`); chỉ TypeScript 7.x có (đã kiểm 23/10/2026) nhưng `typescript-eslint` 8.66 chỉ hỗ trợ TypeScript < 6.1 nên chưa nâng được mà không hỏng lint. `tsconfig.base.json` giữ `target`/`lib` `ES2022`. Ngày giờ giữ quy ước `timestamptz` UTC + quy đổi `Asia/Ho_Chi_Minh` ở tầng hiển thị. Chỉ xét lại khi có nhu cầu nghiệp vụ thật và được chủ dự án duyệt.
- **Dockerfile**: ảnh Node 25+ không còn `corepack` → cài pnpm bằng `npm install -g pnpm@9.15.9` (đúng `packageManager`). Ảnh API `node:26-bookworm-slim`, trình cài đặt `node:26-alpine`.
- **`@types/node` cùng bậc với Node** (hiện `^26`); đổi Node thì đổi cả `engines`, `node-version` trong CI, các `FROM` trong Dockerfile, CLAUDE.md và `docs/Deploy.md` trong CÙNG một lần.
- Kiểm sau khi đổi Node: typecheck + lint + build + test mọi gói (≥ 3 lượt toàn bộ API liên tiếp), dựng ảnh Docker thật và chạy thử chuỗi nginx → API → Postgres.
