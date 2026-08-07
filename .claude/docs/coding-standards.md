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

## Git

- Nhánh: `feat/<domain>-<mô tả ngắn>`, `fix/<domain>-<mô tả ngắn>`.
- Commit theo Conventional Commits: `feat(encounter): ...`.
- Một PR một mục đích. PR đụng vào schema phải kèm migration và cập nhật `.claude/docs/data-model.md` trong cùng PR.
