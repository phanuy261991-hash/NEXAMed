import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  LabPartnerDisabledError,
  classifyLabPartnerStatementItem,
  formatVietnamDateDisplay,
  getVietnamDateString,
  isInLabPartnerStatementPeriod,
  labPartnerStatementDate,
  matchesLabPartnerStatementFilter,
  summarizeLabPartnerStatement,
  vietnamDayEndUtc,
  vietnamDayStartUtc,
  type ClinicConfigReaderPort,
} from '@nexamed/core';
import { LAB_PARTNER_STATEMENT_MAX_ROWS, type LabPartnerPendingSummary, type LabPartnerStatementQuery, type LabPartnerStatementResponse, type LabPartnerStatementRow } from '@nexamed/shared';
import { buildTableReportExcel } from '../../common/report-table-excel';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { UserAccountRepository } from '../iam/user-account.repository';
import { SupplierDebtService } from '../supplier-debt/supplier-debt.service';
import { LabPartnerDispatchRepository } from './lab-partner-dispatch.repository';

interface Actor {
  tenantId: string;
  userId: string;
}

/**
 * Bảng kê mẫu xét nghiệm gửi đối tác (docs/DECISIONS.md #291, GĐ4): theo MỘT đối tác (= nhà cung cấp), CHUNG cả công ty (hiện đủ dòng của mọi chi nhánh, đúng như công nợ NCC).
 * Mỗi dòng một dịch vụ; chỉ mẫu ĐÃ CÓ KẾT QUẢ cộng vào số phát sinh công nợ (chờ kết quả là dự kiến, không nhận hiện 0 đ). Số dư đầu/cuối kỳ lấy từ CHÍNH sổ công nợ (`listLedger`)
 * trong cùng khoảng ngày nên khớp với tab "Sổ công nợ". Phân loại dòng nằm ở `@nexamed/core` (hàm thuần). Công tắc "Dùng đối tác xét nghiệm" tắt thì trả 409 như các API gửi mẫu.
 * Mỗi lần đọc một transaction riêng, tuần tự (không lồng nhau, #264).
 */
@Injectable()
export class LabPartnerStatementService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: LabPartnerDispatchRepository,
    private readonly supplierDebtService: SupplierDebtService,
    private readonly clinicProfileService: ClinicProfileService,
    private readonly userRepository: UserAccountRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
  ) {}

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfig.getLabPartnerEnabled(tenantId))) throw new LabPartnerDisabledError();
  }

  async getStatement(tenantId: string, supplierId: string, query: LabPartnerStatementQuery, now: Date = new Date()): Promise<LabPartnerStatementResponse> {
    await this.assertEnabled(tenantId);
    if (query.from && query.to && query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const from = query.from ? vietnamDayStartUtc(query.from) : null;
    const to = query.to ? vietnamDayEndUtc(query.to) : null;

    const loaded = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.repository.findSupplierRef(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const rows = await this.repository.listStatementItems(tx, tenantId, supplierId, { basis: query.basis, from, to }, LAB_PARTNER_STATEMENT_MAX_ROWS + 1);
      return { supplier, rows };
    });
    // Số dư theo sổ công nợ trong cùng khoảng ngày (transaction riêng, sau khi transaction trên đã đóng).
    const ledger = await this.supplierDebtService.listLedger(tenantId, supplierId, { ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) });

    // "Đã thanh toán" = phiếu chi thật (bút toán PAYMENT, số âm); mọi biến động khác (ghi nợ xét nghiệm, đảo nợ khi trả lại kết quả, điều chỉnh) tính vào "Phát sinh".
    const paid = ledger.items.filter((e) => e.entryType === 'PAYMENT').reduce((sum, e) => sum - e.amountChange, 0);
    const truncated = loaded.rows.length > LAB_PARTNER_STATEMENT_MAX_ROWS;
    const kept = truncated ? loaded.rows.slice(0, LAB_PARTNER_STATEMENT_MAX_ROWS) : loaded.rows;
    const classified = kept
      // Bộ lọc kỳ đã chạy ở CSDL; kiểm lại bằng hàm thuần để hai nơi không lệch nhau.
      .filter((r) => isInLabPartnerStatementPeriod(labPartnerStatementDate({ sentAt: r.dispatch.sentAt, receivedAt: r.receivedAt }, query.basis), from, to))
      .map((r) => {
        const cls = classifyLabPartnerStatementItem({ status: r.status, sentAt: r.dispatch.sentAt, receivedAt: r.receivedAt, dueAt: r.dueAt }, now);
        const unitCost = Number(r.unitCost);
        const row: LabPartnerStatementRow = {
          itemId: r.id,
          dispatchNo: r.dispatch.dispatchNo,
          tubeSid: r.specimenTube?.sid ?? null,
          patientName: r.orderItem.order.encounter.patient.fullName,
          patientCode: r.orderItem.order.encounter.patient.patientCode,
          serviceName: r.orderItem.technicalService?.name ?? r.orderItem.name,
          sentAt: r.dispatch.sentAt.toISOString(),
          receivedAt: r.receivedAt?.toISOString() ?? null,
          turnaroundMinutes: cls.turnaroundMinutes,
          state: cls.state,
          late: cls.late,
          amount: cls.state === 'REJECTED' ? 0 : unitCost,
          branchName: r.dispatch.branch.name,
          rejectReason: r.rejectReason,
        };
        return { row, cls, unitCost };
      });

    const totals = summarizeLabPartnerStatement(classified.map((c) => ({ state: c.cls.state, late: c.cls.late, unitCost: c.unitCost })));
    const items = classified.filter((c) => matchesLabPartnerStatementFilter(c.cls, query.status)).map((c) => c.row);
    return {
      supplier: { code: loaded.supplier.code, name: loaded.supplier.name },
      items,
      truncated,
      summary: { ...totals, openingBalance: ledger.summary.openingBalance, closingBalance: ledger.summary.closingBalance, periodAccrued: ledger.summary.closingBalance - ledger.summary.openingBalance + paid, periodPaid: paid },
    };
  }

  /** Dải số trên trang chi tiết đối tác: mẫu đã gửi đang chờ kết quả (chưa ghi nợ). */
  async getPendingSummary(tenantId: string, supplierId: string): Promise<LabPartnerPendingSummary> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.repository.findSupplierRef(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const sum = await this.repository.sumWaitingForSupplier(tx, tenantId, supplierId);
      return { waitingCount: sum.count, waitingAmount: Number(sum.amount) };
    });
  }

  /** Excel "Bảng kê mẫu xét nghiệm gửi đối tác" — cùng số liệu với màn hình/bản in (gọi chính `getStatement`). */
  async exportExcel(actor: Actor, supplierId: string, query: LabPartnerStatementQuery, now: Date = new Date()): Promise<Buffer> {
    const statement = await this.getStatement(actor.tenantId, supplierId, query, now);
    const header = await this.clinicProfileService.getPrintHeader(actor.tenantId, null);
    const names = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => new Map((await this.userRepository.findFullNamesByIds(tx, actor.tenantId, [actor.userId])).map((u) => [u.id, u.fullName])));

    const vnd = (v: number) => v.toLocaleString('vi-VN');
    const dateTimeOf = (iso: string): string => {
      const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
    };
    const durationOf = (minutes: number | null): string => {
      if (minutes === null) return '';
      const h = Math.floor(minutes / 60);
      return h >= 24 ? `${Math.floor(h / 24)} ngày ${h % 24} giờ` : `${h} giờ ${minutes % 60} phút`;
    };
    const stateLabel = (r: LabPartnerStatementRow): string => (r.state === 'DONE' ? (r.late ? 'Đã có kết quả (quá hạn)' : 'Đã có kết quả') : r.state === 'WAITING' ? (r.late ? 'Quá hạn' : 'Chờ kết quả') : 'Không nhận');
    const showBranch = new Set(statement.items.map((r) => r.branchName).filter((n): n is string => !!n)).size > 1;
    const s = statement.summary;
    const today = getVietnamDateString(now);
    const period = query.from || query.to ? `Từ ${query.from ? formatVietnamDateDisplay(query.from) : 'đầu'} đến ${query.to ? formatVietnamDateDisplay(query.to) : 'nay'}` : 'Toàn bộ lịch sử';

    const excel = await buildTableReportExcel([
      {
        name: 'Bảng kê mẫu gửi đối tác',
        header: { clinicName: header.name, title: 'Bảng kê mẫu xét nghiệm gửi đối tác', from: query.from ?? today, to: query.to ?? today, exportedByName: names.get(actor.userId) ?? 'Không rõ', exportedAt: now },
        infoLines: [
          `Đối tác: ${statement.supplier.code} · ${statement.supplier.name}`,
          `Kỳ: ${period} · Tính theo ${query.basis === 'RECEIVED' ? 'ngày nhận kết quả' : 'ngày gửi'}`,
          `Số dư đầu kỳ: ${vnd(s.openingBalance)} · Phát sinh: ${vnd(s.periodAccrued)} · Đã thanh toán: ${vnd(s.periodPaid)} · Số dư cuối kỳ: ${vnd(s.closingBalance)}`,
          `Đã có kết quả: ${s.doneCount} mẫu = ${vnd(s.doneAmount)} đ · Chờ kết quả (chưa ghi nợ): ${s.waitingCount} mẫu, dự kiến ${vnd(s.waitingAmount)} đ · Không nhận: ${s.rejectedCount} mẫu`,
          ...(statement.truncated ? [`Chỉ có ${LAB_PARTNER_STATEMENT_MAX_ROWS.toLocaleString('vi-VN')} dòng đầu của kỳ — thu hẹp khoảng ngày để xem đủ.`] : []),
          'Thành tiền: chỉ mẫu đã có kết quả được ghi nợ; mẫu chờ kết quả là số dự kiến, mẫu đối tác không nhận là 0 đ.',
        ],
        sections: [
          {
            columns: [
              { header: 'STT', width: 6 },
              { header: 'Mã ống', width: 14 },
              { header: 'Mã đợt gửi', width: 16 },
              { header: 'Bệnh nhân', width: 26 },
              { header: 'Mã BN', width: 16 },
              { header: 'Dịch vụ', width: 30 },
              ...(showBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
              { header: 'Gửi lúc', width: 18 },
              { header: 'Nhận kết quả lúc', width: 18 },
              { header: 'Thời gian trả', width: 16 },
              { header: 'Thành tiền', width: 16, numeric: true },
              { header: 'Trạng thái', width: 22 },
            ],
            rows: statement.items.map((r, i) => [
              i + 1,
              r.tubeSid ?? '',
              r.dispatchNo,
              r.patientName,
              r.patientCode,
              r.serviceName,
              ...(showBranch ? [r.branchName ?? ''] : []),
              dateTimeOf(r.sentAt),
              r.receivedAt ? dateTimeOf(r.receivedAt) : r.state === 'REJECTED' ? 'Đối tác không nhận' : '',
              durationOf(r.turnaroundMinutes),
              r.state === 'WAITING' ? null : r.amount,
              stateLabel(r),
            ]),
            emptyText: 'Không có mẫu nào trong kỳ.',
          },
        ],
      },
    ]);
    return excel;
  }

  async recordExportAudit(actor: Actor, supplierId: string, query: LabPartnerStatementQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'supplier_debt.lab_partner_statement_exported',
        entityType: 'supplier_debt_export',
        entityId: supplierId,
        afterJson: { from: query.from ?? null, to: query.to ?? null, basis: query.basis, status: query.status },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
