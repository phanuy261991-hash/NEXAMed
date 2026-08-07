# Architecture — NEXAMed

## Cấu trúc monorepo

Cây thư mục đầy đủ xem `project-structure.md`. Bốn khối:

- `apps/web` — React SPA, chia theo feature/domain.
- `apps/api` — NestJS, chia theo module domain, cộng thư mục `infrastructure` chứa adapter.
- `packages/core` — logic nghiệp vụ thuần + `ports/` khai báo interface hạ tầng. Không phụ thuộc NestJS, Prisma, React.
- `packages/shared` — type, Zod schema, enum dùng chung web + api.

Chiều phụ thuộc một hướng: `apps/*` → `packages/core` → (không phụ thuộc gì). `packages/*` không import ngược lên `apps/*`.

## Domain module

Tên module trùng nhau giữa web và api.

**Trong phạm vi v1:**

| Module | Trách nhiệm |
|---|---|
| `patient` | Hồ sơ hành chính bệnh nhân, tra cứu, chống trùng |
| `appointment` | Đặt lịch, lịch bác sĩ, hàng đợi |
| `reception` | Tiếp nhận/check-in, tạo encounter, sinh hiệu ban đầu |
| `encounter` | Lượt khám: state machine, chẩn đoán ICD-10, ghi chú lâm sàng |
| `prescription` | Kê đơn thuốc, ký đơn, in đơn |
| `iam` | Tài khoản, vai trò, phiên đăng nhập, audit log |
| `clinic` | Tenant, cấu hình phòng khám, phòng, danh mục nội bộ |

**Ngoài v1 (không tạo module, không viết code):** `pharmacy`, `billing`, `insurance`, `report`.

## Tầng trong API (bắt buộc theo thứ tự)

`Controller` (validate input bằng Zod, không chứa logic)
→ `Service` (logic nghiệp vụ, mở transaction)
→ `Repository` (chỗ duy nhất được gọi Prisma client, chỗ duy nhất áp điều kiện `tenant_id`)

Không gọi Prisma trực tiếp từ controller hoặc service. Transaction mở ở service và truyền client transaction xuống repository, để ghi audit nằm cùng transaction với thao tác nghiệp vụ.

## Luồng dữ liệu phía web

Server state qua TanStack Query, cache key `[tenantId, domain, entityId]` — luôn có `tenantId` để không rò cache khi đổi tenant. Zustand chỉ giữ client state tạm (bộ lọc, wizard đang mở). Không mirror dữ liệu server vào Zustand; nguồn sự thật là cache của Query.

## Luồng nghiệp vụ v1

```
Đặt lịch → Check-in (tạo encounter) → Điều dưỡng ghi sinh hiệu
   → Bác sĩ khám: chẩn đoán ICD-10 + ghi chú → Kê đơn + ký → In đơn → Hoàn tất
```

Mỗi bước phát domain event nội bộ (`encounter.checked_in`, `encounter.completed`, `prescription.signed`). Module khác lắng nghe event thay vì import chéo service. Event handler ghi audit; handler thất bại thì rollback cả thao tác gốc. Viết handler idempotent ngay từ v1 để chuyển sang message broker sau này không phải sửa.

## Ports và adapter

Mọi thứ nằm ngoài tiến trình (file, tin nhắn, ký số, cổng BHYT, phân giải danh tính bệnh nhân) đi qua interface trong `packages/core/ports`, hiện thực ở `apps/api/src/infrastructure`. Service chỉ biết interface. Bảng port và adapter tương ứng xem `project-structure.md`.

## Quy ước API

- REST, prefix `/api/v1`, resource số nhiều: `/api/v1/encounters/:id`.
- Response bọc `{ data, meta }`; lỗi trả `{ error: { code, message, details } }`, `code` là hằng số khai báo trong `packages/shared`.
- Truy cập bản ghi không thuộc tenant hiện tại trả `404`, không phải `403`.
- Phân trang cursor cho danh sách bệnh nhân và lượt khám; không dùng offset.
