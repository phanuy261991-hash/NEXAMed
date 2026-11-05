import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, getVietnamDateString, type DoctorDirectoryPort } from '@nexamed/core';
import type { AuditLogEntry, ExportAuditLogQuery } from '@nexamed/shared';
import { formatReportDate, formatReportDateTime } from '../../common/report-excel-header';
import { buildTableReportExcel, REPORT_EXPORT_ROW_LIMIT } from '../../common/report-table-excel';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { AuditLogService } from './audit-log.service';

const PAGE_SIZE = 100;

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Xuất Excel "Nhật ký kiểm toán" (docs/DECISIONS.md #287). Đúng bộ lọc đang xem (bệnh nhân, người dùng, khoảng ngày); lặp qua các trang của `AuditLogService.list()` tới hết hoặc
 * `REPORT_EXPORT_ROW_LIMIT` dòng (mỗi lần một transaction riêng, KHÔNG lồng nhau). Chỉ xuất NHÃN tiếng Việt và tên hiển thị — không xuất `beforeJson`/`afterJson` (có thể chứa dữ liệu nhạy cảm).
 * Bản thân việc xuất nhật ký cũng được ghi vào nhật ký.
 */
@Injectable()
export class AuditLogExportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly auditLogService: AuditLogService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async exportExcel(actor: Actor, query: ExportAuditLogQuery, now: Date = new Date()): Promise<Buffer> {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, null), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);

    const entries: AuditLogEntry[] = [];
    let cursor: string | undefined;
    let capped = false;
    for (;;) {
      const page = await this.auditLogService.list(actor.tenantId, { ...query, cursor, limit: PAGE_SIZE });
      entries.push(...page.items);
      if (!page.nextCursor) break;
      if (entries.length >= REPORT_EXPORT_ROW_LIMIT) {
        capped = true;
        break;
      }
      cursor = page.nextCursor;
    }
    const rows = entries.slice(0, REPORT_EXPORT_ROW_LIMIT);
    const today = getVietnamDateString(now);

    const filters = [
      query.from || query.to ? `Khoảng ngày: ${query.from ? formatReportDate(query.from) : '…'} – ${query.to ? formatReportDate(query.to) : '…'}` : null,
      query.actorId ? `Người thực hiện: ${names.get(query.actorId) ?? 'một người dùng'}` : null,
      query.patientId ? 'Theo một bệnh nhân' : null,
    ].filter((f): f is string => f !== null);

    return buildTableReportExcel([
      {
        name: 'Nhật ký kiểm toán',
        header: { clinicName: header.name, title: 'Nhật ký kiểm toán', from: query.from ?? today, to: query.to ?? today, exportedByName: names.get(actor.userId) ?? 'Không rõ', exportedAt: now },
        infoLines: [`Bộ lọc: ${filters.length > 0 ? filters.join(' · ') : 'Không lọc'}`],
        sections: [
          {
            columns: [
              { header: 'Thời gian', width: 18 },
              { header: 'Người thực hiện', width: 26 },
              { header: 'Hành động', width: 44 },
              { header: 'Đối tượng', width: 44 },
              { header: 'Truy cập khẩn cấp', width: 18 },
            ],
            rows: rows.map((e) => [formatReportDateTime(new Date(e.occurredAt)), e.actorName ?? 'Hệ thống', e.actionLabel, e.entityLabel, e.isBreakGlass ? 'Có' : '']),
            emptyText: 'Không có bản ghi nào khớp bộ lọc.',
          },
        ],
        note: capped ? `Chỉ xuất ${REPORT_EXPORT_ROW_LIMIT.toLocaleString('vi-VN')} dòng mới nhất; thu hẹp bộ lọc để lấy phần còn lại.` : undefined,
      },
    ]);
  }

  async recordExportAudit(actor: Actor, query: ExportAuditLogQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'audit_log.exported',
        entityType: 'audit_log_export',
        entityId: actor.tenantId,
        afterJson: { from: query.from ?? null, to: query.to ?? null, actorFiltered: !!query.actorId, patientFiltered: !!query.patientId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
