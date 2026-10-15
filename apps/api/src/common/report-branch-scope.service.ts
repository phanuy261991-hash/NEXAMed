import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BRANCH_DIRECTORY_PORT, maxDataScope, type BranchDirectoryPort } from '@nexamed/core';
import type { ReportScopeSelection } from '@nexamed/shared';
import { findScopesForUserPermission } from '../infrastructure/persistence/permission-lookup.helper';
import { UnitOfWorkService } from '../infrastructure/persistence/unit-of-work.service';
import { requireBranchId } from './branch-context';

export interface ReportBranchScope {
  /** Chi nhánh báo cáo được đọc — luôn là điều kiện lọc `branch_id IN (...)` ở repository, không phải cờ bật/tắt. Chi nhánh đang làm việc luôn đứng đầu nếu nằm trong phạm vi. */
  branchIds: string[];
  /** `id → tên` của mọi chi nhánh trong phạm vi (kể cả chi nhánh đã ngưng — số liệu quá khứ vẫn phải hiện đúng nơi phát sinh). */
  names: Map<string, string>;
}

interface ScopeActor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Phạm vi chi nhánh của các BÁO CÁO TỔNG HỢP — Đợt 3 chi nhánh (docs/DECISIONS.md #235). Mặc định CHỈ chi nhánh đang làm việc (hành vi từ Đợt 2, không đổi).
 * `all`/`pick` (gộp nhiều chi nhánh, kể cả chi nhánh tài khoản chưa được gán) chỉ cho người có quyền `company_report.read`; thiếu quyền → 403 dù client tự gửi tham số.
 * Quyền này CHỈ mở rộng PHẠM VI — quyền xem của chính báo cáo (`cash_voucher.report`, `stock_receipt.report`...) vẫn do `PermissionGuard` kiểm ở controller.
 * Mọi chi nhánh lấy từ tenant của phiên (qua `BranchDirectoryPort`), id lạ/của tenant khác → 404 như cô lập tenant.
 */
@Injectable()
export class ReportBranchScopeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
  ) {}

  async hasCompanyReport(tenantId: string, userId: string): Promise<boolean> {
    const scopes = await this.unitOfWork.runInTenantScope(tenantId, (tx) => findScopesForUserPermission(tx, tenantId, userId, 'company_report', 'read'));
    return maxDataScope(scopes) !== 'none';
  }

  async assertCompanyReport(tenantId: string, userId: string): Promise<void> {
    if (!(await this.hasCompanyReport(tenantId, userId))) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Bạn không có quyền xem báo cáo toàn công ty.' });
    }
  }

  async resolve(actor: ScopeActor, selection: ReportScopeSelection): Promise<ReportBranchScope> {
    const currentBranchId = requireBranchId(actor);
    if (selection.scope !== 'current') {
      await this.assertCompanyReport(actor.tenantId, actor.userId);
    }
    const allNames = await this.branchDirectory.getBranchNames(actor.tenantId);

    let branchIds: string[];
    if (selection.scope === 'current') {
      branchIds = [currentBranchId];
    } else if (selection.scope === 'all') {
      branchIds = [...allNames.keys()];
    } else {
      branchIds = [...new Set(selection.branchIds)];
      if (branchIds.length === 0 || branchIds.some((id) => !allNames.has(id))) {
        throw new NotFoundException();
      }
    }
    branchIds.sort((a, b) => {
      if (a === currentBranchId) return -1;
      if (b === currentBranchId) return 1;
      return (allNames.get(a) ?? '').localeCompare(allNames.get(b) ?? '', 'vi');
    });
    return { branchIds, names: new Map(branchIds.map((id) => [id, allNames.get(id) ?? ''])) };
  }

  /**
   * Quỹ của chi nhánh KHÁC chỉ xem được khi có `company_report.read` (Sổ quỹ). Quỹ cùng chi nhánh đang làm luôn được phép; còn lại không đủ quyền → 404
   * (không lộ việc quỹ đó có tồn tại), đúng quy tắc cô lập chi nhánh của các màn khác.
   */
  async assertCanReadBranch(actor: ScopeActor, branchId: string): Promise<void> {
    if (branchId === requireBranchId(actor)) return;
    if (!(await this.hasCompanyReport(actor.tenantId, actor.userId))) {
      throw new NotFoundException();
    }
  }
}
