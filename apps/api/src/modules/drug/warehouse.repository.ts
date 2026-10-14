import { Injectable } from '@nestjs/common';
import type { Prisma, Warehouse } from '@prisma/client';

export interface CreateWarehouseData {
  code: string;
  name: string;
  branchId: string;
  departmentId: string | null;
  isDefault: boolean;
}

export interface UpdateWarehouseData {
  name?: string;
  branchId?: string;
  departmentId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

/** Kèm tên Khoa/Phòng quản lý (tuỳ chọn) và tên chi nhánh — `WarehouseService` map sang `WarehouseSummary`. */
export type WarehouseWithDepartment = Warehouse & { department: { name: string } | null; branch: { name: string } };

const INCLUDE = { department: { select: { name: true } }, branch: { select: { name: true } } } as const;

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `warehouse` (docs/DECISIONS.md #146, GĐ1).
 *
 * Đợt 2 chi nhánh (#233): mọi tra cứu theo id đều BẮT BUỘC `branchId` (kho của chi nhánh khác → null → 404, cùng triết lý cô lập tenant). Chỉ
 * `findByIdAnyBranch` bỏ lọc chi nhánh — dành riêng cho điều chuyển kho (kho đối ứng thuộc chi nhánh khác) và đọc tên để hiển thị.
 */
@Injectable()
export class WarehouseRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateWarehouseData): Promise<Warehouse> {
    return tx.warehouse.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string): Promise<WarehouseWithDepartment | null> {
    return tx.warehouse.findFirst({ where: { tenantId, branchId, id, deletedAt: null }, include: INCLUDE });
  }

  /** CHỈ cho nghiệp vụ liên chi nhánh có chủ đích (điều chuyển kho: kho nguồn/đích) và hiển thị tên — mọi nơi khác dùng `findById` có `branchId`. */
  findByIdAnyBranch(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<WarehouseWithDepartment | null> {
    return tx.warehouse.findFirst({ where: { tenantId, id, deletedAt: null }, include: INCLUDE });
  }

  /** Không phân trang — cùng lý do `RoomRepository.list()` (quy mô nhỏ). `branchIds` = chi nhánh được phép đọc (xem `resolveBranchScope`). */
  list(tx: Prisma.TransactionClient, tenantId: string, branchIds: string[]): Promise<WarehouseWithDepartment[]> {
    return tx.warehouse.findMany({
      where: { tenantId, branchId: { in: branchIds }, deletedAt: null },
      include: INCLUDE,
      orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  /** CHỈ cho ô chọn kho nhận của điều chuyển liên chi nhánh (#233): mọi kho ĐANG HOẠT ĐỘNG của công ty, không lọc chi nhánh. */
  listActiveAllBranches(tx: Prisma.TransactionClient, tenantId: string): Promise<WarehouseWithDepartment[]> {
    return tx.warehouse.findMany({
      where: { tenantId, isActive: true, deletedAt: null },
      include: INCLUDE,
      orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  /** Kho Thuốc GĐ3 (#163) — "Tự động phát thuốc lúc ký đơn" không có màn hình chọn tay, cần TỰ
   * resolve kho mặc định. Fallback kho ACTIVE tạo sớm nhất (`id` UUIDv7 time-ordered, `asc`) nếu
   * chi nhánh chưa từng đánh dấu kho nào `isDefault` (dữ liệu cũ trước #146 seed đúng 1 kho, KHÔNG
   * đảm bảo `isDefault=true` — xem `ensureDefaultWarehouse`). Đợt 2 (#233): LUÔN trong một chi nhánh. */
  async findDefault(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<Warehouse | null> {
    const marked = await tx.warehouse.findFirst({ where: { tenantId, branchId, isDefault: true, isActive: true, deletedAt: null } });
    if (marked) return marked;
    return tx.warehouse.findFirst({ where: { tenantId, branchId, isActive: true, deletedAt: null }, orderBy: { id: 'asc' } });
  }

  /** Bỏ cờ "Kho mặc định" khỏi mọi kho KHÁC `excludeId` CÙNG CHI NHÁNH — gọi TRƯỚC khi set kho mới thành mặc
   * định, tránh vỡ partial unique `(tenant_id, branch_id) WHERE is_default AND deleted_at IS NULL`. */
  async clearDefaultExcept(tx: Prisma.TransactionClient, tenantId: string, branchId: string, excludeId: string | null, actorId: string): Promise<void> {
    await tx.warehouse.updateMany({
      where: { tenantId, branchId, isDefault: true, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      data: { isDefault: false, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /** Kho đã có phát sinh nào chưa (phiếu nhập/xuất/kiểm kê/điều chuyển, tồn) — nếu có thì KHÔNG đổi chi nhánh được (xem `WarehouseService`). */
  async hasActivity(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
    const [receipts, issues, counts, transfers, balances] = await Promise.all([
      tx.stockReceipt.count({ where: { tenantId, warehouseId: id } }),
      tx.stockIssue.count({ where: { tenantId, warehouseId: id } }),
      tx.stockCount.count({ where: { tenantId, warehouseId: id } }),
      tx.stockTransfer.count({ where: { tenantId, OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] } }),
      tx.stockBalance.count({ where: { tenantId, warehouseId: id } }),
    ]);
    return receipts + issues + counts + transfers + balances > 0;
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateWarehouseData,
  ): Promise<number> {
    const result = await tx.warehouse.updateMany({
      where: { tenantId, branchId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
