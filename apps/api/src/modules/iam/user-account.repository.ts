import { Injectable } from '@nestjs/common';
import type { Prisma, UserAccount } from '@prisma/client';

export interface CreateUserAccountData {
  username: string;
  passwordHash: string;
  fullName: string;
  licenseNo: string | null;
  departmentId: string | null;
  employeeCode: string | null;
  phone: string | null;
  personalEmail: string | null;
  companyEmail: string | null;
  academicTitleCode: string | null;
  positionCode: string | null;
  employmentStatusCode: string | null;
  employmentTypeCode: string | null;
  canSignMedicalRecord: boolean;
  mustChangePassword: boolean;
  isActive: boolean;
}

export interface UpdateUserAccountData {
  fullName?: string;
  licenseNo?: string | null;
  departmentId?: string | null;
  phone?: string | null;
  personalEmail?: string | null;
  companyEmail?: string | null;
  academicTitleCode?: string | null;
  positionCode?: string | null;
  employmentStatusCode?: string | null;
  employmentTypeCode?: string | null;
  canSignMedicalRecord?: boolean;
  mustChangePassword?: boolean;
  isActive?: boolean;
  passwordHash?: string;
}

/**
 * CRUD tài khoản + gán vai trò (S2-07, ADM-01) — chỗ DUY NHẤT gọi Prisma cho `user_account`
 * ngoài phần đăng nhập (đã có `UserAccountAuthRepository`, không lặp lại ở đây — xem
 * .claude/docs/coding-standards.md).
 */
@Injectable()
export class UserAccountRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateUserAccountData): Promise<UserAccount> {
    return tx.userAccount.create({
      data: {
        tenantId,
        username: data.username,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        licenseNo: data.licenseNo,
        departmentId: data.departmentId,
        employeeCode: data.employeeCode,
        phone: data.phone,
        personalEmail: data.personalEmail,
        companyEmail: data.companyEmail,
        academicTitleCode: data.academicTitleCode,
        positionCode: data.positionCode,
        employmentStatusCode: data.employmentStatusCode,
        employmentTypeCode: data.employmentTypeCode,
        canSignMedicalRecord: data.canSignMedicalRecord,
        mustChangePassword: data.mustChangePassword,
        isActive: data.isActive,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<UserAccount | null> {
    return tx.userAccount.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { cursor?: string; take: number },
  ): Promise<UserAccount[]> {
    return tx.userAccount.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { id: 'asc' },
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /** `updateMany` + kiểm `count` — cùng lý do `PatientRepository.updateIfVersionMatches`. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateUserAccountData,
  ): Promise<number> {
    const result = await tx.userAccount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  createUserRoles(tx: Prisma.TransactionClient, tenantId: string, actorId: string, userId: string, roleIds: readonly string[]): Promise<Prisma.BatchPayload> {
    return tx.userRole.createMany({
      data: roleIds.map((roleId) => ({ tenantId, userId, roleId, createdBy: actorId, updatedBy: actorId })),
    });
  }

  /**
   * Bác sĩ đang active — phục vụ `DoctorDirectoryPort` (S2-09, cột bác sĩ trên màn hình Lịch
   * hẹn). Sắp theo `fullName` để cột trên lưới ổn định thứ tự (khác `list()` sắp theo `id`, mục
   * đích khác nhau — đây phục vụ hiển thị, không phải phân trang).
   */
  async listActiveDoctors(tx: Prisma.TransactionClient, tenantId: string): Promise<{ id: string; fullName: string; departmentId: string | null }[]> {
    const rows = await tx.userAccount.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        userRoles: { some: { deletedAt: null, role: { tenantId, deletedAt: null, name: 'doctor' } } },
      },
      select: { id: true, fullName: true, departmentId: true },
      orderBy: { fullName: 'asc' },
    });
    return rows;
  }

  /** "Hàng đợi ảo" (#064) — Khoa của một bác sĩ cụ thể, phục vụ `DoctorDirectoryPort.getDoctorDepartmentId`. `null` nếu không tồn tại/không active hoặc chưa gán Khoa. */
  async findDepartmentId(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<string | null> {
    const row = await tx.userAccount.findFirst({
      where: { tenantId, id: userId, deletedAt: null, isActive: true },
      select: { departmentId: true },
    });
    return row?.departmentId ?? null;
  }

  /**
   * Tên hiển thị theo id, phục vụ `DoctorDirectoryPort.getUserFullNames` — không lọc `isActive`/
   * `deletedAt` (khác `findDepartmentId`) vì mục đích chỉ để hiển thị tên đã từng thao tác (ví dụ
   * "Người tiếp nhận"), kể cả tài khoản sau này bị vô hiệu hoá/xoá thì tên cũ vẫn nên hiện đúng.
   */
  async findFullNamesByIds(tx: Prisma.TransactionClient, tenantId: string, userIds: readonly string[]): Promise<{ id: string; fullName: string }[]> {
    if (userIds.length === 0) return [];
    return tx.userAccount.findMany({
      where: { tenantId, id: { in: [...userIds] } },
      select: { id: true, fullName: true },
    });
  }

  /**
   * Gỡ toàn bộ gán vai trò hiện có (soft-delete — .claude/docs/data-model.md cấm xoá cứng,
   * quyền DB `nexamed_app` cũng không có `DELETE`). UNIQUE(tenant_id, user_id, role_id) đã đổi
   * thành PARTIAL (`WHERE deleted_at IS NULL`, migration `*_user_role_partial_unique_s2_07`) nên
   * gán lại đúng vai trò vừa gỡ ở lần đổi sau không vi phạm constraint.
   */
  softDeleteAllUserRoles(tx: Prisma.TransactionClient, tenantId: string, actorId: string, userId: string): Promise<Prisma.BatchPayload> {
    return tx.userRole.updateMany({
      where: { tenantId, userId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'role_reassigned', updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
