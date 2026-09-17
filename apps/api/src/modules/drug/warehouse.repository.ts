import { Injectable } from '@nestjs/common';
import type { Prisma, Warehouse } from '@prisma/client';

export interface CreateWarehouseData {
  code: string;
  name: string;
  departmentId: string | null;
  isDefault: boolean;
}

export interface UpdateWarehouseData {
  name?: string;
  departmentId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

/** Kèm tên Khoa/Phòng quản lý (tuỳ chọn) — `WarehouseService` map sang `WarehouseSummary.departmentName`. */
export type WarehouseWithDepartment = Warehouse & { department: { name: string } | null };

/** Chỗ DUY NHẤT gọi Prisma cho bảng `warehouse` (docs/DECISIONS.md #146, GĐ1). */
@Injectable()
export class WarehouseRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateWarehouseData): Promise<Warehouse> {
    return tx.warehouse.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<WarehouseWithDepartment | null> {
    return tx.warehouse.findFirst({ where: { tenantId, id, deletedAt: null }, include: { department: { select: { name: true } } } });
  }

  /** Không phân trang — cùng lý do `RoomRepository.list()` (quy mô nhỏ). */
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<WarehouseWithDepartment[]> {
    return tx.warehouse.findMany({
      where: { tenantId, deletedAt: null },
      include: { department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** Kho Thuốc GĐ3 (#163) — "Tự động phát thuốc lúc ký đơn" không có màn hình chọn tay, cần TỰ
   * resolve kho mặc định. Fallback kho ACTIVE tạo sớm nhất (`id` UUIDv7 time-ordered, `asc`) nếu
   * tenant chưa từng đánh dấu kho nào `isDefault` (dữ liệu cũ trước #146 seed đúng 1 kho, KHÔNG
   * đảm bảo `isDefault=true` — xem `ensureDefaultWarehouse`). */
  async findDefault(tx: Prisma.TransactionClient, tenantId: string): Promise<Warehouse | null> {
    const marked = await tx.warehouse.findFirst({ where: { tenantId, isDefault: true, isActive: true, deletedAt: null } });
    if (marked) return marked;
    return tx.warehouse.findFirst({ where: { tenantId, isActive: true, deletedAt: null }, orderBy: { id: 'asc' } });
  }

  /** Bỏ cờ "Kho mặc định" khỏi mọi kho KHÁC `excludeId` — gọi TRƯỚC khi set kho mới thành mặc
   * định, tránh vỡ partial unique `(tenant_id) WHERE is_default AND deleted_at IS NULL`. */
  async clearDefaultExcept(tx: Prisma.TransactionClient, tenantId: string, excludeId: string | null, actorId: string): Promise<void> {
    await tx.warehouse.updateMany({
      where: { tenantId, isDefault: true, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      data: { isDefault: false, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateWarehouseData,
  ): Promise<number> {
    const result = await tx.warehouse.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
