import { Injectable } from '@nestjs/common';
import type { Department, Prisma } from '@prisma/client';

export interface UpdateDepartmentData {
  name?: string;
  departmentTypeId?: string | null;
  isActive?: boolean;
}

/** Kèm tên loại (mở rộng ADM-01) — `DepartmentService` map sang `DepartmentSummary.departmentTypeName`. */
export type DepartmentWithType = Department & { departmentType: { name: string } | null };

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `department` — theo .claude/docs/coding-standards.md. Bảng đã
 * tồn tại từ S1-04b (phục vụ Data Scope `department`), lần đầu có module/API thật (mở rộng
 * ADM-01 — trường "Khoa/Phòng" trên form tài khoản + trang quản lý riêng).
 */
@Injectable()
export class DepartmentRepository {
  create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    name: string,
    code: string,
    departmentTypeId: string | null,
  ): Promise<Department> {
    return tx.department.create({
      data: { tenantId, name, code, departmentTypeId, createdBy: actorId, updatedBy: actorId },
    });
  }

  /**
   * "Khoa chung" tự sinh mỗi tenant (#064, `seedDefaultRolesForTenant`) — luôn tồn tại đúng 1 dòng
   * (partial unique `(tenant_id) WHERE is_default`), dùng làm fallback `departmentId` khi bác sĩ
   * chưa gán Khoa nào hoặc lúc Tiếp nhận chọn thẳng "Khoa chung".
   */
  findDefault(tx: Prisma.TransactionClient, tenantId: string): Promise<Department | null> {
    return tx.department.findFirst({ where: { tenantId, isDefault: true, deletedAt: null } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DepartmentWithType | null> {
    return tx.department.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { departmentType: { select: { name: true } } },
    });
  }

  /** "Hàng đợi ảo" (#064) — chiếu tối thiểu (chỉ Khoa đang active) cho `GET /departments/options`. */
  listActiveOptions(tx: Prisma.TransactionClient, tenantId: string): Promise<{ id: string; name: string }[]> {
    return tx.department.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Không lọc `isActive` — trả CẢ hai (đúng khuôn `RoomRepository.list()`), UI tự hiển thị trạng thái. */
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<DepartmentWithType[]> {
    return tx.department.findMany({
      where: { tenantId, deletedAt: null },
      include: { departmentType: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** `updateMany` + kiểm `count` — cùng lý do `RoomRepository.updateIfVersionMatches`. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateDepartmentData,
  ): Promise<number> {
    const result = await tx.department.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}