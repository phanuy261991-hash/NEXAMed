import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, getVietnamDateString, type DoctorDirectoryPort } from '@nexamed/core';
import type { ExportWalletsQuery, WalletListItem } from '@nexamed/shared';
import { formatReportDateTime } from '../../common/report-excel-header';
import { buildTableReportExcel, REPORT_EXPORT_ROW_LIMIT } from '../../common/report-table-excel';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { PatientWalletService } from './patient-wallet.service';

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Đang hoạt động', CLOSED: 'Đã khoá' };
const PAGE_SIZE = 100;

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Xuất Excel "Ví tạm ứng" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Đúng bộ lọc đang xem (tìm, trạng thái); lặp qua các trang của `listWallets()` (mỗi lần một transaction riêng,
 * KHÔNG lồng nhau) tới hết hoặc `REPORT_EXPORT_ROW_LIMIT` dòng. Ví là dữ liệu CHUNG cả công ty nên đầu báo cáo không ghi chi nhánh.
 */
@Injectable()
export class PatientWalletExportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly walletService: PatientWalletService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async exportExcel(actor: Actor, query: ExportWalletsQuery, now: Date = new Date()): Promise<Buffer> {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, null), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);

    const items: WalletListItem[] = [];
    let first: Awaited<ReturnType<PatientWalletService['listWallets']>> | null = null;
    let cursor: string | undefined;
    let capped = false;
    for (;;) {
      const page = await this.walletService.listWallets(actor.tenantId, { q: query.q, status: query.status, cursor, limit: PAGE_SIZE });
      first ??= page;
      items.push(...page.items);
      if (!page.nextCursor) break;
      if (items.length >= REPORT_EXPORT_ROW_LIMIT) {
        capped = true;
        break;
      }
      cursor = page.nextCursor;
    }
    const rows = items.slice(0, REPORT_EXPORT_ROW_LIMIT);
    const today = getVietnamDateString(now);

    return buildTableReportExcel([
      {
        name: 'Ví tạm ứng',
        header: { clinicName: header.name, title: 'Ví tạm ứng', from: today, to: today, exportedByName: names.get(actor.userId) ?? 'Không rõ', exportedAt: now },
        infoLines: [
          `Đang giữ hộ khách: ${(first?.totalHeldBalance ?? 0).toLocaleString('vi-VN')} · Ví hoạt động: ${first?.activeWalletCount ?? 0} · Nạp hôm nay: ${(first?.toppedUpToday ?? 0).toLocaleString('vi-VN')} · Cấn trừ hôm nay: ${(first?.deductedToday ?? 0).toLocaleString('vi-VN')}`,
          `Bộ lọc: ${query.status ? STATUS_LABEL[query.status] : 'Tất cả trạng thái'}${query.q ? ` · Tìm: ${query.q}` : ''}`,
        ],
        sections: [
          {
            columns: [
              { header: 'Mã BN', width: 14 },
              { header: 'Họ tên', width: 28 },
              { header: 'Số điện thoại', width: 16 },
              { header: 'Số dư', width: 16, numeric: true },
              { header: 'Đã nạp', width: 16, numeric: true },
              { header: 'Đã dùng', width: 16, numeric: true },
              { header: 'Giao dịch gần nhất', width: 20 },
              { header: 'Trạng thái', width: 16 },
            ],
            rows: rows.map((w) => [w.patientCode, w.fullName, w.phone ?? '', w.balance, w.totalToppedUp, w.totalUsed, w.lastTransactionAt ? formatReportDateTime(new Date(w.lastTransactionAt)) : '', STATUS_LABEL[w.status] ?? w.status]),
            emptyText: 'Không có ví nào.',
          },
        ],
        note: capped ? `Chỉ xuất ${REPORT_EXPORT_ROW_LIMIT.toLocaleString('vi-VN')} dòng đầu tiên; thu hẹp bộ lọc để lấy phần còn lại.` : undefined,
      },
    ]);
  }

  /** Ghi nhật ký xuất Excel: số dư và thông tin bệnh nhân rời khỏi hệ thống nên phải có dấu vết. */
  async recordExportAudit(actor: Actor, query: ExportWalletsQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'wallet_list.exported',
        entityType: 'wallet_export',
        entityId: actor.tenantId,
        afterJson: { status: query.status ?? null, hasSearch: !!query.q },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
