import { NotFoundException } from '@nestjs/common';
import type { DoctorDirectoryPort } from '@nexamed/core';
import type { DataScope } from '@nexamed/shared';

/**
 * Phân quyền theo Khoa/Phòng cho mọi module "vận hành kho" (`stock_count`/`stock_transfer`,
 * docs/DECISIONS.md #170, retrofit cho `stock_receipt`/`stock_issue` #173) — trích xuất dùng chung
 * sau khi cùng 1 khuôn lặp lại lần thứ 3/4 (`StockCountService`/`StockTransferService` rồi tới
 * `StockReceiptService`/`StockIssueService`), đúng nguyên tắc "trùng lặp lần hai mới trích xuất"
 * của `CLAUDE.md`. Đặt ở `apps/api/src/common/` (không phải `packages/core`) vì `assertWarehouseInScope`
 * ném thẳng `NotFoundException` của NestJS — `packages/core` không được phụ thuộc framework.
 */

/** Chỉ gọi port khi `dataScope==='department'` (mặc định 5 vai trò hệ thống vẫn `global`, không đụng
 * nhánh này). `DoctorDirectoryPort` tự mở transaction RIÊNG — gọi TRƯỚC transaction chính của caller. */
export async function resolveActorDepartmentId(
  doctorDirectory: DoctorDirectoryPort,
  tenantId: string,
  actorId: string,
  dataScope: DataScope,
): Promise<string | null> {
  if (dataScope !== 'department') return null;
  return doctorDirectory.getDoctorDepartmentId(tenantId, actorId);
}

/** Chặn 404 (không phải 403, đúng `.claude/docs/multi-tenancy.md`) nếu 1 kho cụ thể không thuộc
 * đúng Khoa của actor khi scope `department` — `actorDepartmentId=null` (actor chưa gán Khoa) LUÔN
 * chặn, cùng cách xử lý an toàn mặc định `encounter.service.ts` đã dùng cho "Nhận ca". */
export function assertWarehouseInScope(warehouseDepartmentId: string | null, dataScope: DataScope, actorDepartmentId: string | null): void {
  if (dataScope !== 'department') return;
  if (actorDepartmentId === null || warehouseDepartmentId !== actorDepartmentId) {
    throw new NotFoundException();
  }
}

/** XEM (GET) khi 1 nghiệp vụ liên quan tới 2 kho cùng lúc (Điều chuyển kho) — nới hơn thao tác ghi:
 * actor thuộc Khoa quản lý kho NÀY **hoặc** kho KIA đều xem được. */
export function assertEitherWarehouseInScope(
  warehouseDepartmentIdA: string | null,
  warehouseDepartmentIdB: string | null,
  dataScope: DataScope,
  actorDepartmentId: string | null,
): void {
  if (dataScope !== 'department') return;
  const inScope = actorDepartmentId !== null && (warehouseDepartmentIdA === actorDepartmentId || warehouseDepartmentIdB === actorDepartmentId);
  if (!inScope) throw new NotFoundException();
}
