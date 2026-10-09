import { Injectable } from '@nestjs/common';
import { computeInvoiceDiscount, summarizeEncounterInvoices, type EncounterBillingReaderPort, type EncounterBillingSummary } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { InvoiceRepository } from '../../modules/billing/invoice.repository';

/**
 * Adapter thật cho `EncounterBillingReaderPort` (docs/DECISIONS.md #223) — chỉ đọc, tự mở transaction riêng. Tính `dueAmount` bằng ĐÚNG `computeInvoiceDiscount()` mà
 * `InvoiceService` dùng (không tự cộng tay `totalAmount`), rồi gộp theo lượt khám bằng `summarizeEncounterInvoices()` (core, thuần). Đăng ký ở `EncounterBillingReaderModule` (`@Global()`).
 */
@Injectable()
export class EncounterBillingReaderAdapter implements EncounterBillingReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly invoiceRepository: InvoiceRepository,
  ) {}

  async getSummaryByEncounter(tenantId: string, encounterIds: string[]): Promise<Map<string, EncounterBillingSummary>> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.invoiceRepository.listSummariesForEncounters(tx, tenantId, encounterIds));
    const byEncounter = new Map<string, { status: (typeof rows)[number]['status']; dueAmount: number; refundedAmount: number }[]>();
    for (const row of rows) {
      const due = computeInvoiceDiscount({
        totalAmount: Number(row.totalAmount),
        discountType: row.discountType,
        discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
        lines: row.lines.map((l) => ({ lineTotal: Number(l.lineTotal), discountType: l.discountType, discountValue: l.discountValue !== null ? Number(l.discountValue) : null })),
      }).dueAmount;
      const list = byEncounter.get(row.encounterId) ?? [];
      list.push({ status: row.status, dueAmount: due, refundedAmount: Number(row.refundedTotal) });
      byEncounter.set(row.encounterId, list);
    }
    const result = new Map<string, EncounterBillingSummary>();
    for (const [encounterId, invoices] of byEncounter) {
      const summary = summarizeEncounterInvoices(invoices);
      if (summary) result.set(encounterId, summary);
    }
    return result;
  }
}
