import { Injectable } from '@nestjs/common';
import type { Prisma, Supplier } from '@prisma/client';

export interface CreateSupplierData {
  code: string;
  name: string;
  taxCode: string | null;
  phone: string | null;
  address: string | null;
  contactName: string | null;
}

export interface UpdateSupplierData {
  name?: string;
  taxCode?: string | null;
  phone?: string | null;
  address?: string | null;
  contactName?: string | null;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `supplier` (docs/DECISIONS.md #146, GĐ1). */
@Injectable()
export class SupplierRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateSupplierData): Promise<Supplier> {
    return tx.supplier.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Supplier | null> {
    return tx.supplier.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Không phân trang — cùng lý do `RoomRepository.list()` (quy mô nhỏ, vài chục nhà cung cấp/phòng khám). */
  list(tx: Prisma.TransactionClient, tenantId: string, includeInactive: boolean): Promise<Supplier[]> {
    return tx.supplier.findMany({
      where: { tenantId, deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateSupplierData,
  ): Promise<number> {
    const result = await tx.supplier.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
