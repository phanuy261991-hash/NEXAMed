import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '../infrastructure/persistence/audit-log.helper';
import type { ReportBranchScope } from './report-branch-scope.service';
import type { RequestMeta } from './request-meta';

/**
 * Phần DÙNG CHUNG của việc xuất Excel mọi báo cáo điều hành (docs/DECISIONS.md #287): dựng ngữ cảnh đầu báo cáo và ghi nhật ký xuất. Trích ra từ ba service báo cáo (vận hành, doanh thu, bác sĩ)
 * để không lặp lại. Hàm THUẦN/nhận `tx` — không tự đọc port (service đọc tên phòng khám và tên người xuất TRƯỚC khi mở transaction, #264).
 */
export interface ReportExportContext {
  clinicName: string;
  branchName: string | null;
  scopeLabel: string | null;
  exportedByName: string;
  exportedAt: Date;
}

/** Đầu báo cáo: một chi nhánh thì ghi tên chi nhánh; gộp từ hai chi nhánh thì ghi danh sách chi nhánh ở dòng "Phạm vi". */
export function buildReportExportContext(clinicName: string, branchName: string | null, scope: ReportBranchScope, exportedByName: string, exportedAt: Date): ReportExportContext {
  const multi = scope.branchIds.length > 1;
  return {
    clinicName,
    branchName: multi ? null : branchName,
    scopeLabel: multi ? scope.branchIds.map((id) => scope.names.get(id) ?? '').join(', ') : null,
    exportedByName,
    exportedAt,
  };
}

export interface ReportExportAuditSpec {
  /** Ví dụ `revenue_report.exported`. */
  action: string;
  /** Ví dụ `revenue_report_export`. */
  entityType: string;
}

/** Ghi nhật ký xuất Excel: ai xuất, báo cáo nào, kỳ nào, chi nhánh nào thật sự đã đọc (không ghi từ khoá tìm vì có thể là tên/SĐT). */
export async function writeReportExportAudit(
  tx: Prisma.TransactionClient,
  actor: { tenantId: string; userId: string },
  spec: ReportExportAuditSpec,
  report: string,
  query: { from: string; to: string },
  resolvedBranchIds: string[],
  meta: RequestMeta,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeAuditLog(tx, actor.tenantId, {
    actorId: actor.userId,
    action: spec.action,
    entityType: spec.entityType,
    entityId: actor.tenantId,
    afterJson: { report, from: query.from, to: query.to, resolvedBranchIds, ...extra },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}
