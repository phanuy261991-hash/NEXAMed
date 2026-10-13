import type { Prisma } from '@prisma/client';

/**
 * "Tài khoản này có được làm việc ở chi nhánh X không" (docs/DECISIONS.md #231) — dùng chung cho mọi truy vấn lọc nhân viên theo chi nhánh
 * (danh sách bác sĩ, nhập Excel lịch làm việc...). Cùng quy tắc với `BranchAccessService`: công ty chỉ có ≤ 1 chi nhánh hoạt động thì MỌI
 * tài khoản coi như thuộc chi nhánh đó (không cần dòng `user_branch`); từ 2 chi nhánh trở lên thì chỉ chi nhánh được gán rõ ràng.
 */
export async function isMultiBranchTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  return (await tx.branch.count({ where: { tenantId, deletedAt: null, isActive: true } })) > 1;
}

/** Điều kiện `where` trên `user_account` để chỉ lấy tài khoản được làm việc ở `branchId` ({} nếu công ty 1 chi nhánh). */
export async function userBranchWhere(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<Prisma.UserAccountWhereInput> {
  if (!(await isMultiBranchTenant(tx, tenantId))) return {};
  return { branches: { some: { branchId, deletedAt: null } } };
}

/** Lọc danh sách `userIds` còn những tài khoản được làm việc ở `branchId`. */
export async function filterUserIdsInBranch(tx: Prisma.TransactionClient, tenantId: string, branchId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const where = await userBranchWhere(tx, tenantId, branchId);
  const rows = await tx.userAccount.findMany({ where: { tenantId, id: { in: userIds }, deletedAt: null, ...where }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
