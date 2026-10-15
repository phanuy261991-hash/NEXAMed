import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, permissionKey } from '@nexamed/core';
import { USER_ROLES, type DataScope, type UserRole } from '@nexamed/shared';
import type { UnitOfWorkService } from './unit-of-work.service';
import { backfillBranchDefaults, ensureDefaultBranch, ensureDefaultCashAccount, ensureDefaultWarehouse } from './seed-tenant-roles';
import { seedSystemReferenceDataForTenant } from './seed-reference-catalog';

/** Module quyền cũ trước khi tách cận lâm sàng thành 2 menu (docs/DECISIONS.md #215). */
const LEGACY_PARACLINICAL_MODULE = 'paraclinical_result';
const SPLIT_PARACLINICAL_MODULES = ['lab_result', 'imaging_result'] as const;
const ROLES_ADDED_AFTER_TENANT_CREATION: readonly UserRole[] = ['lab_technician', 'imaging_technician'];

/**
 * Tách quyền cận lâm sàng (#215): mọi vai trò (hệ thống lẫn tuỳ biến) đang có `paraclinical_result.<hành động>` được cấp lại ĐÚNG hành động đó, cùng phạm vi, cho cả
 * `lab_result` và `imaging_result` rồi thu hồi (soft-delete) dòng cũ — không ai mất quyền, quản trị viên bỏ bớt nhóm không cần ở "Vai trò & Phân quyền" sau đó.
 * Idempotent; chỉ thu hồi dòng cũ khi CẢ HAI quyền mới đã có trong danh mục (chưa chạy `db:seed` thì giữ nguyên, lần khởi động sau làm tiếp).
 */
export async function migrateLegacyParaclinicalPermissions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
  permissionIdByKey: ReadonlyMap<string, string>,
): Promise<string[]> {
  const legacy = await tx.permission.findMany({ where: { module: LEGACY_PARACLINICAL_MODULE } });
  if (legacy.length === 0) return [];
  const actionByLegacyId = new Map(legacy.map((p) => [p.id, p.action]));
  const rows = await tx.rolePermission.findMany({ where: { tenantId, deletedAt: null, permissionId: { in: legacy.map((p) => p.id) } } });

  const added: string[] = [];
  const convertedIds: string[] = [];
  for (const row of rows) {
    const action = actionByLegacyId.get(row.permissionId)!;
    const targets = SPLIT_PARACLINICAL_MODULES.map((module) => ({ key: `${module}.${action}`, permissionId: permissionIdByKey.get(`${module}.${action}`) }));
    if (targets.some((target) => !target.permissionId)) continue;
    await tx.rolePermission.createMany({
      data: targets.map((target) => ({ tenantId, roleId: row.roleId, permissionId: target.permissionId as string, dataScope: row.dataScope, createdBy: actorId, updatedBy: actorId })),
      skipDuplicates: true,
    });
    convertedIds.push(row.id);
    for (const target of targets) added.push(`${tenantId}/${row.roleId}/${target.key}`);
  }
  if (convertedIds.length > 0) {
    await tx.rolePermission.updateMany({
      where: { tenantId, id: { in: convertedIds } },
      data: { deletedAt: new Date(), deletedReason: 'Tách quyền cận lâm sàng thành Xét nghiệm / CĐHA & Thăm dò chức năng (docs/DECISIONS.md #215)', updatedBy: actorId, version: { increment: 1 } },
    });
  }
  return added;
}

/** Vai trò hệ thống thêm SAU khi tenant đã tạo (vd. 2 vai trò Kỹ thuật viên, #215): tạo nếu tenant chưa có — `seedDefaultRolesForTenant` chỉ chạy lúc tạo tenant mới. */
export async function ensureSystemRoles(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<void> {
  // Chỉ bổ sung cho tenant THẬT (đã có vai trò hệ thống) — không biến tenant trống thành tenant có vai trò.
  const hasSystemRoles = await tx.role.findFirst({ where: { tenantId, isSystemDefault: true }, select: { id: true } });
  if (!hasSystemRoles) return;
  for (const roleName of ROLES_ADDED_AFTER_TENANT_CREATION) {
    const existing = await tx.role.findFirst({ where: { tenantId, name: roleName } });
    if (existing) continue;
    await tx.role.create({ data: { tenantId, name: roleName, isSystemDefault: true, createdBy: actorId, updatedBy: actorId } });
  }
}

/**
 * Đồng bộ `role_permission` còn thiếu cho MỘT tenant, so với `DEFAULT_ROLE_PERMISSIONS`
 * (packages/core/src/rbac/permissions.ts) — chỉ THÊM dòng còn thiếu cho vai trò
 * `is_system_default=true`, không sửa/xoá dòng đã có (an toàn với tuỳ biến ADM-07 sau này) và
 * không đụng vai trò tuỳ biến do `clinic_admin` tự tạo.
 *
 * Bối cảnh: `seedDefaultRolesForTenant()` chỉ chạy lúc TẠO tenant — tenant đã tồn tại trước khi
 * một permission mới ra đời sẽ không tự có role_permission tương ứng (phát hiện thật lúc làm
 * reference_catalog, xem docs/CURRENT.md mục "Đang chờ" trước khi có hàm này).
 */
export async function syncRolePermissionsForTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
): Promise<string[]> {
  const permissions = await tx.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((p) => [permissionKey(p), p.id]));

  await ensureSystemRoles(tx, tenantId, actorId);

  const roles = await tx.role.findMany({
    where: { tenantId, isSystemDefault: true, deletedAt: null },
  });

  const added: string[] = await migrateLegacyParaclinicalPermissions(tx, tenantId, actorId, permissionIdByKey);

  for (const role of roles) {
    if (!(USER_ROLES as readonly string[]).includes(role.name)) continue;
    const matrix = DEFAULT_ROLE_PERMISSIONS[role.name as UserRole];

    const existing = await tx.rolePermission.findMany({
      where: { tenantId, roleId: role.id, deletedAt: null },
      select: { permissionId: true },
    });
    const existingPermissionIds = new Set(existing.map((rp) => rp.permissionId));

    const candidates: { key: string; permissionId: string; dataScope: DataScope }[] = [];
    for (const key of Object.keys(matrix)) {
      const dataScope = matrix[key];
      const permissionId = permissionIdByKey.get(key);
      // permission chưa seed vào DB (quên chạy `pnpm db:seed` sau khi thêm permission mới) —
      // bỏ qua thay vì throw, vì hàm này chạy nền lúc khởi động, không được chặn cả API đứng lên.
      if (!permissionId || !dataScope || existingPermissionIds.has(permissionId)) continue;
      candidates.push({ key, permissionId, dataScope });
    }
    if (candidates.length === 0) continue;

    // `createMany({ skipDuplicates: true })` thay vì `create()` từng dòng: đọc-rồi-ghi
    // (existingPermissionIds ở trên, insert ở đây) không atomic — nếu một tiến trình khác (API
    // instance khác cùng khởi động, hoặc trong test, một spec khác đang seed cùng lúc trong DB
    // test dùng chung) đã chèn đúng dòng này ở khoảng giữa, `create()` từng dòng sẽ ném P2002 VÀ
    // (khác biệt quan trọng) làm ABORT CẢ TRANSACTION Postgres đang mở — mọi câu lệnh tiếp theo
    // trong cùng transaction (kể cả try/catch ở tầng JS) đều lỗi 25P02 cho tới khi rollback, dù đã
    // "bắt" được lỗi ném ra. `createMany` với `skipDuplicates` xử lý xung đột bằng `ON CONFLICT DO
    // NOTHING` ở tầng SQL — không bao giờ ném lỗi, không bao giờ làm abort transaction.
    await tx.rolePermission.createMany({
      data: candidates.map((c) => ({
        tenantId,
        roleId: role.id,
        permissionId: c.permissionId,
        dataScope: c.dataScope,
        createdBy: actorId,
        updatedBy: actorId,
      })),
      skipDuplicates: true,
    });
    for (const c of candidates) {
      added.push(`${tenantId}/${role.name}/${c.key}`);
    }
  }

  return added;
}

/**
 * Kiểm tra danh mục `permission` có đủ mọi quyền khai báo trong `DEFAULT_ROLE_PERMISSIONS`
 * (packages/core/src/rbac/permissions.ts) hay chưa — CHỈ ĐỌC, không tự ghi (bảng `permission` đã
 * revoke INSERT/UPDATE khỏi role app `nexamed_app` — chỉ `pnpm db:seed` chạy bằng role đặc quyền
 * mới ghi được, xem seed-permissions.ts). Gọi lúc khởi động (`main.ts`) để log CẢNH BÁO RÕ RÀNG
 * thay vì âm thầm bỏ qua như dòng comment ở `syncRolePermissionsForTenant` phía trên vẫn làm —
 * sự cố thật đã lặp lại nhiều lần (permission mới thêm vào code nhưng quên chạy lại `db:seed`
 * trên DB dev lâu năm → role_permission không có gì để đồng bộ → menu biến mất, không có dấu hiệu
 * lỗi nào trong log cho tới khi debug thủ công, xem docs/DECISIONS.md #159).
 */
export async function findMissingPermissionKeys(prisma: PrismaClient): Promise<string[]> {
  const expectedKeys = new Set<string>();
  for (const matrix of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
    for (const key of Object.keys(matrix)) expectedKeys.add(key);
  }
  const existingKeys = new Set((await prisma.permission.findMany()).map((p) => permissionKey(p)));
  return [...expectedKeys].filter((key) => !existingKeys.has(key)).sort();
}

/**
 * Đồng bộ nền cho MỘT tenant trong transaction của tenant đó: quyền theo vai trò + chi nhánh/kho/quỹ mặc định + danh mục hệ thống. Tách riêng khỏi `syncRolePermissionsForAllTenants` để test
 * chỉ chạm đúng tenant của mình (CSDL test dùng chung, quét mọi tenant sẽ ghi vào tenant của spec khác đang chạy song song).
 */
export async function syncTenantFoundation(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<string[]> {
  const syncResult = await syncRolePermissionsForTenant(tx, tenantId, actorId);
  const isRealTenant = (await tx.role.findFirst({ where: { tenantId, isSystemDefault: true }, select: { id: true } })) !== null;
  // "Thu chi tại quầy" GĐ1 — backfill quỹ tiền mặt mặc định cho tenant TẠO TRƯỚC tính năng
  // này (seedDefaultRolesForTenant chỉ chạy lúc tạo tenant mới, không tự chạy lại cho tenant cũ).
  // Chi nhánh mặc định (#231) — tenant tạo trước tầng chi nhánh đã được migration backfill; bước này chỉ còn là lưới an toàn.
  let defaultBranchId: string | null = null;
  if (isRealTenant) {
    defaultBranchId = (await ensureDefaultBranch(tx, tenantId, actorId)).id;
  } else {
    defaultBranchId = (await tx.branch.findFirst({ where: { tenantId, isDefault: true, deletedAt: null }, select: { id: true } }))?.id ?? null;
  }
  // Đợt 2 chi nhánh (#233): quỹ + kho mặc định theo chi nhánh MẶC ĐỊNH (chi nhánh khác tự có khi tạo, xem `provisionBranchDefaults`).
  if (defaultBranchId) await ensureDefaultCashAccount(tx, tenantId, actorId, defaultBranchId);
  // Kho Thuốc & Vật tư y tế GĐ1 (docs/DECISIONS.md #146) — cùng lý do backfill Kho mặc định
  // cho tenant tạo trước tính năng này.
  if (defaultBranchId) await ensureDefaultWarehouse(tx, tenantId, actorId, defaultBranchId);
  // Chi nhánh tạo từ Đợt 1 (trước khi chi nhánh mới tự có kho/quỹ, #233) — bù kho + quỹ tiền mặt cho chi nhánh nào đang thiếu. Chỉ tenant THẬT (đã có vai trò hệ thống).
  if (isRealTenant) await backfillBranchDefaults(tx, tenantId, actorId);
  // Danh mục riêng theo tenant (#230) — bổ sung dòng hệ thống thêm SAU này cho tenant THẬT (đã có vai trò hệ thống);
  // tenant trống do test dựng dở không bị biến thành tenant có danh mục.
  if (isRealTenant) await seedSystemReferenceDataForTenant(tx, tenantId, actorId);
  return syncResult;
}

/**
 * Chạy `syncRolePermissionsForTenant` cho MỌI tenant — gọi một lần lúc API khởi động
 * (`main.ts`), idempotent (an toàn gọi lại mỗi lần start). Không dùng cho tenant bị soft-delete.
 */
export async function syncRolePermissionsForAllTenants(
  prisma: PrismaClient,
  unitOfWork: UnitOfWorkService,
  actorId: string,
  /** Chỉ dùng trong test: giới hạn danh sách tenant (CSDL test dùng chung giữa các spec chạy song song — quét mọi tenant sẽ ghi vào tenant của spec khác). Production không truyền. */
  onlyTenantIds?: readonly string[],
): Promise<string[]> {
  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null, ...(onlyTenantIds ? { id: { in: [...onlyTenantIds] } } : {}) }, select: { id: true } });

  const added: string[] = [];
  for (const tenant of tenants) {
    let result: string[];
    try {
      result = await unitOfWork.runInTenantScope(tenant.id, (tx) => syncTenantFoundation(tx, tenant.id, actorId));
    } catch (err) {
      // Tenant bị xoá/vô hiệu hoá GIỮA lúc đang quét (danh sách `tenants` đọc từ trước) — không phải lỗi đồng bộ, bỏ qua tenant đó.
      // Lỗi với tenant CÒN tồn tại vẫn được ném lại. (Trong test, các file spec dùng chung CSDL tạo/dọn tenant song song.)
      const stillActive = await prisma.tenant.findFirst({ where: { id: tenant.id, deletedAt: null }, select: { id: true } });
      if (!stillActive) continue;
      throw err;
    }
    added.push(...result);
  }
  return added;
}
