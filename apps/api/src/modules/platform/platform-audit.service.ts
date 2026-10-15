import { Injectable } from '@nestjs/common';
import { PLATFORM_AUDIT_ACTION_LABELS, type ListPlatformAuditQuery, type ListPlatformAuditResponse } from '@nexamed/shared';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformOperatorRepository } from './platform-operator.repository';
import { PlatformTenantRepository } from './platform-tenant.repository';

/** Nhật ký vận hành nền tảng (đọc) — toàn bộ hoặc của một công ty. Có tên người vận hành và tên công ty; không có dữ liệu bệnh nhân. */
@Injectable()
export class PlatformAuditService {
  constructor(
    private readonly audit: PlatformAuditRepository,
    private readonly operators: PlatformOperatorRepository,
    private readonly tenants: PlatformTenantRepository,
  ) {}

  async list(query: ListPlatformAuditQuery): Promise<ListPlatformAuditResponse> {
    const rows = await this.audit.list({ tenantId: query.tenantId, cursor: query.cursor, take: query.limit + 1 });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const operatorIds = [...new Set(page.map((r) => r.operatorId).filter((id): id is string => id !== null))];
    const tenantIds = [...new Set(page.map((r) => r.targetTenantId).filter((id): id is string => id !== null))];
    const [operatorRows, tenantRows] = await Promise.all([Promise.all(operatorIds.map((id) => this.operators.findById(id))), tenantIds.length > 0 ? this.tenants.findByIds(tenantIds) : Promise.resolve([])]);
    const operatorNames = new Map(operatorRows.filter((o) => o !== null).map((o) => [o.id, o.fullName]));
    const tenantNames = new Map(tenantRows.map((t) => [t.id, t.name]));

    return {
      items: page.map((row) => {
        const detail = row.detailJson;
        const note = detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.note === 'string' ? detail.note : null;
        return {
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          operatorName: row.operatorId ? (operatorNames.get(row.operatorId) ?? null) : null,
          action: row.action,
          actionLabel: (PLATFORM_AUDIT_ACTION_LABELS as Record<string, string>)[row.action] ?? row.action,
          targetTenantId: row.targetTenantId,
          targetTenantName: row.targetTenantId ? (tenantNames.get(row.targetTenantId) ?? null) : null,
          note,
        };
      }),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
