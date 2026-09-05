import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, formatShortSequentialCode, permissionKey } from '@nexamed/core';
import { USER_ROLES } from '@nexamed/shared';
import { CodeSequenceRepository } from './code-sequence.repository';

/** "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — tiền tố mã `cash_account`, theo tenant (khác 6
 * category `reference_catalog` toàn hệ thống ở #113), đúng khuôn `WorkShiftService`. */
const CASH_ACCOUNT_CODE_PREFIX = 'QU';
// Stateless (không phụ thuộc DI nào) — cùng cách khởi tạo tay đã dùng ở `seed-allergen-catalog.ts`
// cho `GlobalCodeSequenceRepository`, vì hàm này chạy ngoài NestJS container (seed script/test).
const codeSequenceRepository = new CodeSequenceRepository();

/**
 * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — tạo quỹ tiền mặt mặc định NẾU tenant chưa có, điều
 * kiện tiên quyết để `InvoiceService.resolveCashAccountId()` gắn được `payment.cashAccountId` ngay
 * từ lượt thu tiền đầu tiên. Quỹ ngân hàng KHÔNG seed sẵn — `clinic_admin` tự tạo khi cần.
 *
 * Tách riêng khỏi `seedDefaultRolesForTenant` (gọi lúc TẠO tenant mới) để `syncRolePermissionsForAllTenants()`
 * (chạy mỗi lần API khởi động, mọi tenant kể cả tenant CŨ đã tồn tại từ trước khi có tính năng
 * này) cũng gọi lại được — cùng lý do `syncRolePermissionsForTenant` tồn tại: tenant tạo trước một
 * tính năng mới sẽ không tự có dữ liệu nền tương ứng nếu không backfill.
 */
export async function ensureDefaultCashAccount(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<void> {
  const existingDefaultCashAccount = await tx.cashAccount.findFirst({ where: { tenantId, type: 'CASH', isDefault: true } });
  if (existingDefaultCashAccount) {
    return;
  }
  const seq = await codeSequenceRepository.next(tx, tenantId, CASH_ACCOUNT_CODE_PREFIX, actorId);
  const code = formatShortSequentialCode(CASH_ACCOUNT_CODE_PREFIX, seq);
  await tx.cashAccount.create({
    data: {
      tenantId,
      code,
      name: 'Quỹ tiền mặt',
      type: 'CASH',
      openingBalance: 0n,
      openingBalanceAt: new Date(),
      isDefault: true,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });
}

/**
 * Seed 5 vai trò mặc định (is_system_default = true) + ma trận role_permission, VÀ Khoa mặc định
 * ("Khoa chung", `docs/DECISIONS.md` #064) cho MỘT tenant, theo DEFAULT_ROLE_PERMISSIONS
 * (packages/core/src/rbac/permissions.ts). Gọi khi tạo tenant mới (chưa có module tạo tenant —
 * S2+) và dùng lại trong test. Khoa mặc định là điều kiện tiên quyết cho "Hàng đợi ảo" —
 * `encounter.departmentId` bắt buộc NOT NULL, mọi tenant phải có sẵn ít nhất 1 Khoa trước khi có
 * lượt khám đầu tiên.
 *
 * Yêu cầu: danh mục `permission` đã được seed trước (xem seed-permissions.ts) — hàm này
 * không tự tạo permission.
 */
export async function seedDefaultRolesForTenant(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const existingDefaultDepartment = await tx.department.findFirst({ where: { tenantId, isDefault: true } });
  if (!existingDefaultDepartment) {
    await tx.department.create({
      data: { tenantId, name: 'Khoa chung', code: null, isDefault: true, isActive: true, createdBy: actorId, updatedBy: actorId },
    });
  }

  await ensureDefaultCashAccount(tx as Prisma.TransactionClient, tenantId, actorId);

  const permissions = await tx.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((p) => [permissionKey(p), p.id]));

  for (const roleName of USER_ROLES) {
    const role = await tx.role.create({
      data: {
        tenantId,
        name: roleName,
        isSystemDefault: true,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    const matrix = DEFAULT_ROLE_PERMISSIONS[roleName];
    for (const key of Object.keys(matrix)) {
      const dataScope = matrix[key];
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId || !dataScope) {
        throw new Error(`DEFAULT_ROLE_PERMISSIONS tham chiếu permission chưa seed: "${key}"`);
      }
      await tx.rolePermission.create({
        data: {
          tenantId,
          roleId: role.id,
          permissionId,
          dataScope,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }
  }
}