import type { Prisma, PrismaClient } from '@prisma/client';
import { BRANCH_CODE_PREFIX, DEFAULT_ROLE_PERMISSIONS, formatShortSequentialCode, permissionKey } from '@nexamed/core';
import { USER_ROLES } from '@nexamed/shared';
import { CodeSequenceRepository } from './code-sequence.repository';
import { seedSystemReferenceDataForTenant } from './seed-reference-catalog';

/** "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — tiền tố mã `cash_account`, theo tenant (khác 6
 * category `reference_catalog` toàn hệ thống ở #113), đúng khuôn `WorkShiftService`. */
const CASH_ACCOUNT_CODE_PREFIX = 'QU';
// Stateless (không phụ thuộc DI nào) — khởi tạo tay vì hàm này chạy ngoài NestJS container (seed script/test).
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
export async function ensureDefaultCashAccount(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string, name = 'Quỹ tiền mặt'): Promise<void> {
  // Đợt 2 chi nhánh (docs/DECISIONS.md #233): quỹ tiền mặt mặc định THEO TỪNG CHI NHÁNH.
  const existingDefaultCashAccount = await tx.cashAccount.findFirst({ where: { tenantId, branchId, type: 'CASH', isDefault: true, deletedAt: null } });
  if (existingDefaultCashAccount) {
    return;
  }
  const seq = await codeSequenceRepository.next(tx, tenantId, CASH_ACCOUNT_CODE_PREFIX, actorId);
  const code = formatShortSequentialCode(CASH_ACCOUNT_CODE_PREFIX, seq);
  await tx.cashAccount.create({
    data: {
      tenantId,
      branchId,
      code,
      name,
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
 * Chi nhánh MẶC ĐỊNH (docs/DECISIONS.md #231) — mọi tenant luôn có ít nhất 1 chi nhánh (giống "Khoa chung" #064); tên/địa chỉ/SĐT lấy từ `tenant`.
 * Tạo nếu chưa có; trả chi nhánh mặc định. Phòng khám 1 chi nhánh không thấy khái niệm này trên giao diện.
 */
export async function ensureDefaultBranch(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<{ id: string }> {
  const existing = await tx.branch.findFirst({ where: { tenantId, isDefault: true, deletedAt: null }, select: { id: true } });
  if (existing) {
    return existing;
  }
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, address: true, phone: true } });
  const seq = await codeSequenceRepository.next(tx, tenantId, BRANCH_CODE_PREFIX, actorId);
  return tx.branch.create({
    data: {
      tenantId,
      code: formatShortSequentialCode(BRANCH_CODE_PREFIX, seq),
      name: tenant?.name ?? 'Cơ sở chính',
      address: tenant?.address ?? null,
      phone: tenant?.phone ?? null,
      isDefault: true,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
    },
    select: { id: true },
  });
}

/**
 * Chi nhánh MỚI (Đợt 2 chi nhánh, docs/DECISIONS.md #233, Q2) tự có sẵn 1 kho mặc định + 1 quỹ tiền mặt mặc định để phát thuốc / thu tiền được ngay.
 * Tên mặc định "Kho <tên chi nhánh>", "Quỹ tiền mặt <tên chi nhánh>" — sửa được sau ở Danh mục.
 */
export async function provisionBranchDefaults(tx: Prisma.TransactionClient, tenantId: string, branchId: string, branchName: string, actorId: string): Promise<void> {
  await ensureDefaultWarehouse(tx, tenantId, actorId, branchId, `Kho ${branchName}`);
  await ensureDefaultCashAccount(tx, tenantId, actorId, branchId, `Quỹ tiền mặt ${branchName}`);
}

/**
 * Bù kho + quỹ tiền mặt mặc định cho các chi nhánh ĐANG THIẾU (chi nhánh tạo từ Đợt 1 #231, trước khi `provisionBranchDefaults` tồn tại). Chạy mỗi lần API khởi động
 * (qua `syncRolePermissionsForAllTenants`), idempotent. Chỉ bù khi chi nhánh CHƯA có kho nào / chưa có quỹ tiền mặt nào — chi nhánh đã tự thêm kho/quỹ thì giữ nguyên, không tạo thêm bản mặc định.
 * Chi nhánh mặc định không xử lý ở đây (đã có bước ensure riêng). Trả số kho + quỹ vừa tạo.
 */
export async function backfillBranchDefaults(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<number> {
  const branches = await tx.branch.findMany({ where: { tenantId, isDefault: false, isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  let created = 0;
  for (const branch of branches) {
    if ((await tx.warehouse.count({ where: { tenantId, branchId: branch.id, deletedAt: null } })) === 0) {
      await ensureDefaultWarehouse(tx, tenantId, actorId, branch.id, `Kho ${branch.name}`);
      created += 1;
    }
    if ((await tx.cashAccount.count({ where: { tenantId, branchId: branch.id, type: 'CASH', deletedAt: null } })) === 0) {
      await ensureDefaultCashAccount(tx, tenantId, actorId, branch.id, `Quỹ tiền mặt ${branch.name}`);
      created += 1;
    }
  }
  return created;
}

/** Kho Thuốc & Vật tư y tế GĐ1 (docs/DECISIONS.md #146) — tiền tố mã `warehouse`, theo tenant,
 * đúng khuôn CASH_ACCOUNT_CODE_PREFIX ở trên. */
const WAREHOUSE_CODE_PREFIX = 'KH';

/**
 * Kho Thuốc & Vật tư y tế GĐ1 — tạo Kho mặc định NẾU tenant chưa có, đúng khuôn
 * `ensureDefaultCashAccount`/`department` "Khoa chung" (#064): điều kiện tiên quyết để module Kho
 * (GĐ2+) luôn có ít nhất 1 kho để nhập/xuất, và để web tự ẩn UI chọn kho khi tenant chỉ có 1 kho.
 */
export async function ensureDefaultWarehouse(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string, name = 'Kho chính'): Promise<void> {
  // Đợt 2 chi nhánh (#233): kho mặc định THEO TỪNG CHI NHÁNH.
  const existingDefault = await tx.warehouse.findFirst({ where: { tenantId, branchId, isDefault: true, deletedAt: null } });
  if (existingDefault) {
    return;
  }
  const seq = await codeSequenceRepository.next(tx, tenantId, WAREHOUSE_CODE_PREFIX, actorId);
  const code = formatShortSequentialCode(WAREHOUSE_CODE_PREFIX, seq);
  await tx.warehouse.create({
    data: {
      tenantId,
      branchId,
      code,
      name,
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

  const defaultBranch = await ensureDefaultBranch(tx as Prisma.TransactionClient, tenantId, actorId);
  await ensureDefaultCashAccount(tx as Prisma.TransactionClient, tenantId, actorId, defaultBranch.id);
  await ensureDefaultWarehouse(tx as Prisma.TransactionClient, tenantId, actorId, defaultBranch.id);
  // Dòng danh mục BẮT BUỘC cho hệ thống (CASH/WALLET, loại thu chi hệ thống, từ viết tắt ICD-10) — danh mục riêng theo tenant (#230).
  await seedSystemReferenceDataForTenant(tx, tenantId, actorId);

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
    const rows = Object.keys(matrix).map((key) => {
      const dataScope = matrix[key];
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId || !dataScope) {
        throw new Error(`DEFAULT_ROLE_PERMISSIONS tham chiếu permission chưa seed: "${key}"`);
      }
      return { tenantId, roleId: role.id, permissionId, dataScope, createdBy: actorId, updatedBy: actorId };
    });
    // `createMany` + `skipDuplicates` (ON CONFLICT DO NOTHING) thay cho `create()` từng dòng: `syncRolePermissionsForAllTenants()`
    // (chạy lúc API khởi động, quét MỌI tenant) có thể chèn trước đúng các dòng này khi một API khác vừa boot song song —
    // `create()` sẽ ném P2002 và làm abort cả transaction (lỗi lặp lại ở 3 spec khi chạy toàn bộ bộ test).
    await tx.rolePermission.createMany({ data: rows, skipDuplicates: true });
  }
}