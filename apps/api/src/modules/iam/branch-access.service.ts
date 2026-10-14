import { Injectable } from '@nestjs/common';
import type { Branch, Prisma } from '@prisma/client';
import type { BranchLite } from '@nexamed/shared';
import { BranchRepository } from './branch.repository';

export function toBranchLite(row: Branch): BranchLite {
  return { id: row.id, code: row.code, name: row.name, address: row.address, isDefault: row.isDefault };
}

/**
 * "Tôi được làm việc ở chi nhánh nào" (docs/DECISIONS.md #231) — nguồn sự thật duy nhất cho đăng nhập, đổi chi nhánh và gán chi nhánh.
 *
 * Quy tắc: công ty chỉ có ≤ 1 chi nhánh hoạt động thì MỌI tài khoản coi như thuộc chi nhánh đó (không cần dòng `user_branch` — phòng khám 1
 * chi nhánh không phải biết khái niệm này); từ 2 chi nhánh trở lên thì chỉ chi nhánh được gán rõ ràng (`user_branch`).
 */
@Injectable()
export class BranchAccessService {
  constructor(private readonly branchRepository: BranchRepository) {}

  async resolveAssigned(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<Branch[]> {
    const active = await this.branchRepository.list(tx, tenantId, false);
    if (active.length <= 1) return active;
    return this.branchRepository.listAssignedBranches(tx, tenantId, userId);
  }

  /** Công ty có từ 2 chi nhánh hoạt động trở lên không (độc lập với số chi nhánh tài khoản được gán). */
  async isMultiBranchCompany(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    return (await this.branchRepository.list(tx, tenantId, false)).length >= 2;
  }
}
