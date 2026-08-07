# Project Structure — NEXAMed

Nguyên tắc: triển khai hiện tại là **on-premise một instance cho một phòng khám**, nhưng cấu trúc thư mục phải cho phép chuyển sang **triển khai tập trung nhiều tenant** và **tích hợp hệ thống ngoài** mà không phải sắp xếp lại code. Cách đạt được: logic nghiệp vụ không biết gì về hạ tầng, hạ tầng nằm ở rìa dưới dạng adapter.

## Cây thư mục

```
nexamed/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ modules/<domain>/         # appointment, reception, encounter, prescription, patient, iam, tenant
│  │  │  │  ├─ <domain>.controller.ts # chỉ validate + gọi service + map response
│  │  │  │  ├─ <domain>.service.ts    # điều phối use case, mở transaction
│  │  │  │  ├─ <domain>.repository.ts # chỗ DUY NHẤT gọi Prisma / viết SQL
│  │  │  │  ├─ dto/                   # Zod schema request/response của module
│  │  │  │  └─ events/                # event phát ra và handler lắng nghe
│  │  │  ├─ infrastructure/           # adapter hiện thực các port của core
│  │  │  │  ├─ persistence/           # PrismaService, unit of work, tenant context
│  │  │  │  ├─ storage/               # local-disk.adapter.ts  (sau: s3.adapter.ts)
│  │  │  │  ├─ eventbus/              # in-memory.adapter.ts   (sau: rabbitmq/kafka)
│  │  │  │  ├─ signature/             # noop.adapter.ts        (sau: ca-provider)
│  │  │  │  ├─ insurance/             # noop.adapter.ts        (sau: cổng giám định BHYT)
│  │  │  │  └─ notification/          # noop.adapter.ts        (sau: SMS/Zalo)
│  │  │  ├─ common/                   # guard, interceptor, filter, decorator
│  │  │  └─ config/                   # đọc và validate biến môi trường bằng Zod
│  │  └─ prisma/                      # schema.prisma + migrations
│  └─ web/
│     ├─ src/features/<domain>/       # page, component, hook, api client theo domain
│     ├─ src/shared/                  # UI primitives, layout, hook dùng chung
│     └─ src/app/                     # router, provider, bootstrap
├─ packages/
│  ├─ core/                           # logic nghiệp vụ thuần TypeScript
│  │  ├─ <domain>/                    # entity, value object, quy tắc, state machine
│  │  ├─ ports/                       # interface: StoragePort, EventBusPort, SignaturePort,
│  │  │                               # InsuranceGatewayPort, NotificationPort, PatientIdentityPort
│  │  └─ errors/                      # lớp lỗi nghiệp vụ, mã lỗi
│  └─ shared/                         # type, Zod schema, hằng số dùng chung web + api
├─ deploy/
│  ├─ on-prem/                        # docker-compose, script cài đặt, backup, hướng dẫn vận hành
│  └─ cloud/                          # để trống ở v1, không tạo file rỗng giả
├─ docs/                              # tài liệu cho người, khác với .claude/docs
│  └─ product/                        # PRD, plan triển khai (vòng đời theo sprint/release)
└─ .claude/docs/                      # tài liệu cho agent
```

## Quy tắc đặt code

| Loại code | Đặt ở | Không đặt ở |
|---|---|---|
| Công thức, quy tắc nghiệp vụ, state machine | `packages/core/<domain>` | service, controller, component |
| Type và schema dùng cả web lẫn api | `packages/shared` | lặp lại ở hai bên |
| Truy vấn DB | `apps/api/src/modules/<domain>/*.repository.ts` | service, controller |
| Gọi hệ thống ngoài | `apps/api/src/infrastructure/<loại>/*.adapter.ts` | service |
| Component dùng ≥2 màn hình | `apps/web/src/shared` | copy sang từng feature |

`packages/core` **không** import: NestJS, Prisma, React, `process.env`, thư viện HTTP. Kiểm bằng ESLint rule `no-restricted-imports` — vi phạm là fail CI.

## Port và adapter đã định nghĩa sẵn ở v1

| Port | Adapter v1 (on-prem) | Adapter dự kiến sau |
|---|---|---|
| `StoragePort` | ghi file lên disk cục bộ | S3 / MinIO |
| `EventBusPort` | in-memory, đồng bộ trong transaction | RabbitMQ hoặc Kafka |
| `SignaturePort` | no-op, chỉ ghi `signed_at`/`signed_by` | tích hợp CA, ký PKCS#7 |
| `InsuranceGatewayPort` | no-op, trả `NOT_IMPLEMENTED` | cổng giám định BHYT |
| `NotificationPort` | no-op, ghi log nhắc lịch | SMS / Zalo OA / email |
| `PatientIdentityPort` | trả chính `patient.id` của tenant | master patient index liên tenant |

Adapter no-op **phải tồn tại và được đăng ký**, không để service gọi vào `undefined`. Khi triển khai thật, chỉ thay đăng ký DI trong module, không sửa service.

## Cấu hình và triển khai

- Toàn bộ cấu hình đọc từ biến môi trường, validate bằng Zod ở `apps/api/src/config`. Không đọc `process.env` rải rác trong code.
- Không hard-code đường dẫn tuyệt đối, tên máy chủ, hay giá trị đặc thù một phòng khám. Giá trị riêng theo phòng khám để ở bảng `tenant_setting`.
- Bản on-prem chạy bằng `deploy/on-prem/docker-compose.yml`: api, web (nginx), postgres, dịch vụ backup. Không giả định máy chủ có internet.
- Backup: script `pg_dump` theo lịch, ghi ra thư mục cấu hình được. Không dùng dịch vụ cloud ở v1.
- Sẵn sàng cho triển khai tập trung: không lưu state trong RAM tiến trình (session, cache nghiệp vụ, bộ đếm). Cần state chia sẻ thì đi qua DB hoặc port riêng.

## Quy ước đặt tên file

- File TypeScript: `kebab-case.ts`, hậu tố theo vai trò (`.controller.ts`, `.service.ts`, `.repository.ts`, `.adapter.ts`, `.spec.ts`).
- Component React: `PascalCase.tsx`, một component chính mỗi file.
- Thư mục đặt theo domain, không theo loại kỹ thuật và không theo ngày tháng hay tên người.
- Migration Prisma giữ tên do CLI sinh, không đổi tên thủ công.
