import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClinicalOrderItem, Prisma } from '@prisma/client';
import {
  allocateInvoiceDueToLines,
  CLINIC_CONFIG_READER_PORT,
  ClinicalOrderPriceMissingError,
  computeInvoiceDiscount,
  computePackageRepriceDelta,
  ConcurrentModificationError,
  evaluateDeclinableItem,
  evaluateDeclinableItems,
  getVietnamDateString,
  InvoiceClosedError,
  remainingLineAmount,
  SERVICE_CONSUMPTION_DECLINE_PORT,
  ServiceDeclineBlockedError,
  ServiceDeclineReasonInvalidError,
  type ClinicConfigReaderPort,
  type ServiceConsumptionDeclinePort,
  type DeclinableOrderItem,
  type DeclinePackageMode,
} from '@nexamed/core';
import {
  SERVICE_DECLINE_BLOCKED_LABELS,
  type DeclineQuoteRequest,
  type DeclineServicesRequest,
  type Invoice as InvoiceDto,
  type ServiceDeclineAction,
  type ServiceDeclinePreview,
  type ServiceDeclineQuote,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { InvoiceRefundService } from '../billing/invoice-refund.service';
import { toInvoiceResponse } from '../billing/invoice.service';
import { InvoiceRepository, type InvoiceWithLines } from '../billing/invoice.repository';
import { itemKey, PriceableCatalogService, type ItemRef } from '../pricing/priceable-catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { ClinicalOrderRepository, type ClinicalOrderWithLines } from './clinical-order.repository';

type OrderItemRow = ClinicalOrderWithLines['items'][number];

/** Một dòng chỉ định có liên quan tới phiếu thu đang mở, kèm dòng hoá đơn tương ứng và tiền thật của dòng đó. */
interface RelevantItem {
  item: OrderItemRow;
  lineId: string;
  lineIndex: number;
  /** Phần tiền thật (sau chiết khấu) của dòng hoá đơn. Với dịch vụ con trong gói đây là tiền của CẢ dòng gói. */
  lineNet: number;
  /** Đã hoàn bao nhiêu trên dòng hoá đơn này (cộng dồn các lần hoàn). */
  refunded: number;
}

interface Loaded {
  invoice: InvoiceWithLines;
  order: ClinicalOrderWithLines | null;
  rows: RelevantItem[];
}

interface Plan {
  selected: RelevantItem[];
  /** Dòng hoá đơn bị gỡ hẳn (phiếu chưa thu) hoặc hoàn hết phần còn lại (phiếu đã thu). */
  removeLines: { lineId: string; gross: bigint; net: number; quantity: number }[];
  /** Dòng gói được tính lại giá (chỉ phiếu chưa thu, chế độ tính lại theo giá lẻ). */
  repriceLines: { lineId: string; packageId: string; oldGross: bigint; newGross: bigint }[];
  action: ServiceDeclineAction;
  amount: number;
  surcharge: number;
  newDueAmount: number | null;
  refundBreakdown: { method: string; amount: number }[];
}

/**
 * "Khách không làm dịch vụ" (docs/DECISIONS.md #280) — bác sĩ đã chỉ định dịch vụ kỹ thuật nhưng ra quầy khách không muốn làm.
 *
 * Đặt ở module `clinical-order` (sở hữu dòng chỉ định, đã import `BillingModule` một chiều); `billing` chỉ mở nguyên liệu tính tiền (`InvoiceRefundService`).
 * MỘT luồng, HAI nhánh theo trạng thái phiếu — máy chủ tự chọn, client không chọn:
 *   - phiếu `UNPAID` → gỡ dòng hoá đơn, trừ tổng tiền;
 *   - phiếu `PAID`   → hoàn tiền theo đúng phương thức đã thu (ví trước), KHÔNG nhập lại kho.
 * Cả hai: dòng chỉ định → `CANCELLED` + lý do + người + lúc (KHÔNG soft-delete: đây là SỰ KIỆN của người bệnh, khác bác sĩ gỡ dòng vừa thêm sai).
 *
 * Quy tắc giao dịch (CLAUDE.md, #264): các port tự mở transaction (công tắc gói, ca/két thu ngân) được đọc TRƯỚC khi mở transaction chính.
 */
@Injectable()
export class ServiceDeclineService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ClinicalOrderRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly invoiceRefundService: InvoiceRefundService,
    private readonly catalog: PriceableCatalogService,
    private readonly pricing: PricingService,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
    // Vật tư tiêu hao đã ghi cho dịch vụ định bỏ (#297 GĐ4) — port nhận `tx`, chạy trong transaction của luồng này, KHÔNG tự mở transaction.
    @Inject(SERVICE_CONSUMPTION_DECLINE_PORT) private readonly consumption: ServiceConsumptionDeclinePort,
  ) {}

  /** Mở hộp thoại: các dịch vụ liên quan tới phiếu + dòng nào bỏ được / vì sao không. */
  async preview(tenantId: string, branchId: string, actorId: string, encounterId: string, invoiceId: string): Promise<ServiceDeclinePreview> {
    const packageMode = await this.clinicConfig.getPackageDeclineMode(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const loaded = await this.load(tx, tenantId, branchId, encounterId, invoiceId);
      const { invoice, order, rows } = loaded;
      const paid = invoice.status === 'PAID';
      const verdicts = evaluateDeclinableItems(rows.map(toDeclinable), packageMode, paid);
      const packageName = new Map((order?.packages ?? []).map((p) => [p.id, p.packageName]));
      const consumption = await this.consumption.describeActive(tx, tenantId, branchId, actorId, rows.map((r) => r.item.id));
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceStatus: invoice.status,
        invoiceVersion: invoice.version,
        packageMode,
        action: invoice.status === 'UNPAID' ? 'REMOVE_LINE' : paid ? 'REFUND' : null,
        items: rows.map((r, i) => {
          const verdict = verdicts[i]!.verdict;
          return {
            orderItemId: r.item.id,
            name: r.item.name,
            quantity: r.item.quantity,
            status: r.item.status,
            packageId: r.item.clinicalOrderPackageId,
            packageName: r.item.clinicalOrderPackageId === null ? null : (packageName.get(r.item.clinicalOrderPackageId) ?? null),
            // Dịch vụ con trong gói không có giá riêng (gói có MỘT dòng hoá đơn) — tiền do endpoint báo giá tính.
            amount: r.item.clinicalOrderPackageId === null ? remainingLineAmount({ lineNet: r.lineNet, refundedAmount: r.refunded }) : null,
            declinable: verdict.declinable,
            blockedReason: verdict.declinable ? null : verdict.reason,
            blockedLabel: verdict.declinable ? null : SERVICE_DECLINE_BLOCKED_LABELS[verdict.reason],
          };
        }),
        consumptions: consumption.items.map((c) => ({ orderItemId: c.orderItemId, issueNo: c.issueNo, lines: c.lines, totalCost: c.totalCost })),
        canReverseConsumption: consumption.canReverse,
      };
    });
  }

  /** Số tiền hiện ở chân hộp thoại. Chỉ ĐỌC — không ghi gì; dùng CHUNG `buildPlan` với `decline` nên con số báo trước luôn bằng con số sẽ ghi. */
  async quote(tenantId: string, branchId: string, encounterId: string, dto: DeclineQuoteRequest): Promise<ServiceDeclineQuote> {
    const packageMode = await this.clinicConfig.getPackageDeclineMode(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const loaded = await this.load(tx, tenantId, branchId, encounterId, dto.invoiceId);
      const plan = await this.buildPlan(tx, tenantId, loaded, dto.orderItemIds, packageMode);
      return {
        action: plan.action,
        itemCount: plan.selected.length,
        amount: plan.amount,
        surcharge: plan.surcharge,
        newDueAmount: plan.newDueAmount,
        refundBreakdown: plan.refundBreakdown,
      };
    });
  }

  async decline(tenantId: string, branchId: string, actorId: string, encounterId: string, dto: DeclineServicesRequest, meta: RequestMeta): Promise<InvoiceDto> {
    // Port tự mở transaction → đọc TRƯỚC transaction chính (CLAUDE.md, #264).
    const packageMode = await this.clinicConfig.getPackageDeclineMode(tenantId);
    const ctx = await this.invoiceRefundService.resolveRefundContext(tenantId, branchId, actorId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Xếp hàng mọi thao tác hoàn/bỏ trên CÙNG một phiếu trước khi đọc — cùng khuôn hoàn thuốc (#203).
      await this.invoiceRepository.lockForRefund(tx, tenantId, dto.invoiceId);
      const loaded = await this.load(tx, tenantId, branchId, encounterId, dto.invoiceId);
      const { invoice } = loaded;
      // Phiên bản cũ → 409 ngay, trước mọi kiểm tra khác (cùng khuôn refundItems).
      if (invoice.version !== dto.invoiceVersion) throw new ConcurrentModificationError();
      if (!(await this.repository.isActiveDeclineReason(tx, tenantId, dto.reasonCode))) throw new ServiceDeclineReasonInvalidError();

      const plan = await this.buildPlan(tx, tenantId, loaded, dto.orderItemIds, packageMode);
      const selectedIds = plan.selected.map((r) => r.item.id);
      const note = dto.reasonNote && dto.reasonNote.length > 0 ? dto.reasonNote : null;

      // 1) Dòng chỉ định → CANCELLED + lý do. Có điều kiện `status = ORDERED`: kỹ thuật viên vừa lấy mẫu giữa lúc thu ngân bấm xác nhận thì số dòng đổi lệch → huỷ cả giao dịch.
      const changed = await this.repository.markDeclined(tx, tenantId, selectedIds, { reasonCode: dto.reasonCode, note, actorId, at: new Date() });
      if (changed !== selectedIds.length) throw new ConcurrentModificationError();

      // 1b) Vật tư tiêu hao đã ghi cho các dịch vụ này (#297 GĐ4): KHÔNG tự hoàn kho. Bắt buộc chọn "Giữ nguyên" hoặc "Đảo phiếu" (cần quyền riêng + lý do); đảo phiếu nằm trong CÙNG giao dịch.
      const consumed = await this.consumption.describeActive(tx, tenantId, branchId, actorId, selectedIds);
      if (consumed.items.length > 0) {
        if (!dto.consumptionAction) throw new BadRequestException('Chọn cách xử lý vật tư đã ghi cho dịch vụ này: giữ nguyên hoặc đảo phiếu và hoàn kho.');
        if (dto.consumptionAction === 'REVERSE') {
          if (!consumed.canReverse) throw new ForbiddenException('Bạn không có quyền đảo phiếu tiêu hao. Chọn "Giữ nguyên" hoặc nhờ quản lý.');
          for (const item of consumed.items) {
            await this.consumption.reverse(tx, tenantId, branchId, actorId, item.issueId, dto.consumptionReason ?? '', meta);
          }
        }
      }

      // 2) Tiền.
      const { reasons } = await this.repository.findDeclineNames(tx, tenantId, [dto.reasonCode], []);
      const reasonText = `${reasons.get(dto.reasonCode) ?? dto.reasonCode}${note ? ` — ${note}` : ''}`;

      if (invoice.status === 'UNPAID') {
        if (plan.removeLines.length > 0) {
          const grossRemoved = plan.removeLines.reduce((sum, l) => sum + l.gross, 0n);
          await this.invoiceRepository.removeOrderLines(tx, tenantId, invoice.id, plan.removeLines.map((l) => l.lineId), actorId, grossRemoved);
        }
        for (const r of plan.repriceLines) {
          if ((await this.invoiceRepository.repriceOrderLine(tx, tenantId, invoice.id, r.lineId, r.newGross, actorId)) === 0) throw new ConcurrentModificationError();
          await this.repository.updatePackagePrice(tx, tenantId, r.packageId, r.newGross, actorId);
        }
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'invoice.service_declined',
          entityType: 'invoice',
          entityId: invoice.id,
          beforeJson: { status: invoice.status, totalAmount: String(invoice.totalAmount) },
          afterJson: {
            orderItemIds: selectedIds,
            names: plan.selected.map((r) => r.item.name),
            reasonCode: dto.reasonCode,
            reasonNote: note,
            action: plan.action,
            amount: plan.amount,
            surcharge: plan.surcharge,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      } else {
        // Phiếu đã thu. `buildPlan` đã chặn mọi trạng thái khác (đã đóng sổ → InvoiceClosedError).
        if (plan.removeLines.length > 0 && plan.amount > 0) {
          await this.invoiceRefundService.refundServiceLinesInTx(
            tx,
            ctx,
            invoice,
            plan.removeLines.filter((l) => l.net > 0).map((l) => ({ invoiceLineId: l.lineId, quantity: l.quantity, amount: l.net })),
            reasonText,
            meta,
          );
        } else {
          // Không có tiền để hoàn (chỉ bỏ dịch vụ trong gói ở chế độ giữ nguyên giá gói, hoặc dòng 0 đồng): vẫn phải để lại dấu vết trong nhật ký.
          await writeAuditLog(tx, tenantId, {
            actorId,
            action: 'invoice.service_declined',
            entityType: 'invoice',
            entityId: invoice.id,
            beforeJson: { status: invoice.status },
            afterJson: { orderItemIds: selectedIds, names: plan.selected.map((r) => r.item.name), reasonCode: dto.reasonCode, reasonNote: note, action: plan.action, amount: 0 },
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        }
      }

      const updated = await this.invoiceRepository.findByIdWithLines(tx, tenantId, branchId, invoice.id);
      return toInvoiceResponse(updated!);
    });
  }

  // ---------------------------------------------------------------------------------------------

  /** Phiếu + phiếu chỉ định + tiền thật từng dòng. Phiếu không thuộc lượt khám trên URL / chi nhánh khác → 404 (không lộ tồn tại). */
  private async load(tx: Prisma.TransactionClient, tenantId: string, branchId: string, encounterId: string, invoiceId: string): Promise<Loaded> {
    const invoice = await this.invoiceRepository.findByIdWithLines(tx, tenantId, branchId, invoiceId);
    if (!invoice || invoice.encounterId !== encounterId) throw new NotFoundException();
    const order = await this.repository.findActiveByEncounter(tx, tenantId, encounterId);

    const nets = allocateInvoiceDueToLines({
      totalAmount: Number(invoice.totalAmount),
      discountType: invoice.discountType,
      discountValue: invoice.discountValue !== null ? Number(invoice.discountValue) : null,
      lines: invoice.lines.map((l) => ({ lineTotal: Number(l.lineTotal), discountType: l.discountType, discountValue: l.discountValue !== null ? Number(l.discountValue) : null })),
    });
    const refundedByLine = new Map<string, number>();
    for (const refund of invoice.refunds) {
      for (const rl of refund.lines) refundedByLine.set(rl.invoiceLineId, (refundedByLine.get(rl.invoiceLineId) ?? 0) + Number(rl.amount));
    }
    const lineIndexByItem = new Map<string, number>();
    const lineIndexByPackage = new Map<string, number>();
    invoice.lines.forEach((l, index) => {
      if (l.sourceOrderItemId !== null) lineIndexByItem.set(l.sourceOrderItemId, index);
      if (l.sourceOrderPackageId !== null) lineIndexByPackage.set(l.sourceOrderPackageId, index);
    });

    const rows: RelevantItem[] = [];
    for (const item of order?.items ?? []) {
      const lineIndex = item.clinicalOrderPackageId === null ? lineIndexByItem.get(item.id) : lineIndexByPackage.get(item.clinicalOrderPackageId);
      // Dòng không nằm trên phiếu này (đã tính ở phiếu khác, hoặc chỉ định ra ngoài) → không thuộc hộp thoại của phiếu này.
      if (lineIndex === undefined) continue;
      const line = invoice.lines[lineIndex]!;
      rows.push({ item, lineId: line.id, lineIndex, lineNet: nets[lineIndex] ?? 0, refunded: refundedByLine.get(line.id) ?? 0 });
    }
    return { invoice, order, rows };
  }

  /**
   * Quyết định ghi gì và số tiền bao nhiêu — DÙNG CHUNG cho báo giá và xác nhận. Ném lỗi nghiệp vụ nếu có dòng không bỏ được.
   *
   * Bỏ hết các dịch vụ còn lại của một gói = bỏ cả gói (khách không trả tiền cho gói không còn dịch vụ nào), bất kể chế độ.
   */
  private async buildPlan(tx: Prisma.TransactionClient, tenantId: string, loaded: Loaded, orderItemIds: string[], packageMode: DeclinePackageMode): Promise<Plan> {
    const { invoice, order, rows } = loaded;
    if (invoice.status !== 'UNPAID' && invoice.status !== 'PAID') throw new InvoiceClosedError();
    const paid = invoice.status === 'PAID';

    const wanted = [...new Set(orderItemIds)];
    const byId = new Map(rows.map((r) => [r.item.id, r]));
    const selected: RelevantItem[] = [];
    for (const id of wanted) {
      const row = byId.get(id);
      if (!row) throw new BadRequestException('Dịch vụ không thuộc phiếu thu này.');
      const verdict = evaluateDeclinableItem(toDeclinable(row), packageMode, paid);
      if (!verdict.declinable) throw new ServiceDeclineBlockedError(row.item.name, SERVICE_DECLINE_BLOCKED_LABELS[verdict.reason]);
      selected.push(row);
    }
    const selectedSet = new Set(wanted);

    const removeLines: Plan['removeLines'] = [];
    const repriceLines: Plan['repriceLines'] = [];
    const seenLines = new Set<string>();
    const addRemoval = (row: RelevantItem): void => {
      if (seenLines.has(row.lineId)) return;
      seenLines.add(row.lineId);
      const line = invoice.lines[row.lineIndex]!;
      removeLines.push({ lineId: row.lineId, gross: line.lineTotal, net: remainingLineAmount({ lineNet: row.lineNet, refundedAmount: row.refunded }), quantity: line.quantity });
    };

    // Dịch vụ LẺ: mỗi dịch vụ một dòng hoá đơn.
    for (const row of selected) if (row.item.clinicalOrderPackageId === null) addRemoval(row);

    // Dịch vụ trong GÓI: gom theo gói.
    const packageIds = [...new Set(selected.map((r) => r.item.clinicalOrderPackageId).filter((v): v is string => v !== null))];
    for (const packageId of packageIds) {
      const anyRow = selected.find((r) => r.item.clinicalOrderPackageId === packageId)!;
      const stillActive = (order?.items ?? []).filter((i) => i.clinicalOrderPackageId === packageId && i.status !== 'CANCELLED');
      const kept = stillActive.filter((i) => !selectedSet.has(i.id));
      if (kept.length === 0) {
        addRemoval(anyRow);
      } else if (packageMode === 'REPRICE_SINGLE') {
        const line = invoice.lines[anyRow.lineIndex]!;
        const keptListPrices = await this.listPrices(tx, tenantId, kept);
        const { repricedTotal } = computePackageRepriceDelta({ packageLineNet: Number(line.lineTotal), keptListPrices });
        repriceLines.push({ lineId: anyRow.lineId, packageId, oldGross: line.lineTotal, newGross: BigInt(repricedTotal) });
      }
      // KEEP_PACKAGE_PRICE: không đổi tiền, chỉ đặt dòng chỉ định sang CANCELLED.
    }

    if (!paid) {
      const removedIds = new Set(removeLines.map((l) => l.lineId));
      const repriced = new Map(repriceLines.map((r) => [r.lineId, r.newGross]));
      const remaining = invoice.lines.filter((l) => !removedIds.has(l.id)).map((l) => ({ ...l, lineTotal: repriced.get(l.id) ?? l.lineTotal }));
      const newTotal = remaining.reduce((sum, l) => sum + l.lineTotal, 0n);
      const asDiscountInput = (total: bigint, lines: { lineTotal: bigint; discountType: typeof invoice.discountType; discountValue: bigint | null }[]) =>
        computeInvoiceDiscount({
          totalAmount: Number(total),
          discountType: invoice.discountType,
          discountValue: invoice.discountValue !== null ? Number(invoice.discountValue) : null,
          lines: lines.map((l) => ({ lineTotal: Number(l.lineTotal), discountType: l.discountType, discountValue: l.discountValue !== null ? Number(l.discountValue) : null })),
        }).dueAmount;
      const before = asDiscountInput(invoice.totalAmount, invoice.lines);
      const after = asDiscountInput(newTotal, remaining);
      const changesMoney = removeLines.length > 0 || repriceLines.length > 0;
      return {
        selected,
        removeLines,
        repriceLines,
        action: changesMoney ? 'REMOVE_LINE' : 'NO_MONEY_CHANGE',
        amount: Math.max(0, before - after),
        surcharge: Math.max(0, after - before),
        newDueAmount: after,
        refundBreakdown: [],
      };
    }

    const refundTotal = removeLines.reduce((sum, l) => sum + l.net, 0);
    return {
      selected,
      removeLines,
      repriceLines,
      action: refundTotal > 0 ? 'REFUND' : 'NO_MONEY_CHANGE',
      amount: refundTotal,
      surcharge: 0,
      newDueAmount: null,
      refundBreakdown: refundTotal > 0 ? this.invoiceRefundService.allocateAcrossPayments(invoice, refundTotal) : [],
    };
  }

  /**
   * Giá LẺ hôm nay của các dịch vụ con còn lại trong gói (đơn giá × số lượng). Dịch vụ con trong gói không lưu giá riêng (`unitPrice = null`) nên phải tra lại bảng giá
   * theo ngày hiện tại — khớp cách chốt giá lúc chỉ định (`ClinicalOrderService.addPackages`). Thiếu giá → báo rõ dịch vụ nào, không đoán.
   */
  private async listPrices(tx: Prisma.TransactionClient, tenantId: string, children: ClinicalOrderItem[]): Promise<number[]> {
    const today = getVietnamDateString();
    const refs: ItemRef[] = children.map((c) => (c.itemKind === 'EXAM_TYPE' ? { itemKind: 'EXAM_TYPE', ref: c.examTypeCode as string } : { itemKind: 'TECHNICAL_SERVICE', ref: c.technicalServiceId as string }));
    const loaded = await this.catalog.load(tx, tenantId, today, refs);
    const prices: number[] = [];
    for (const [index, child] of children.entries()) {
      const ref = refs[index]!;
      const scope = loaded.get(itemKey(ref.itemKind, ref.ref))?.item.scopes.find((s: { amount: number | null }) => s.amount !== null);
      if (!scope) throw new ClinicalOrderPriceMissingError(child.name);
      const [resolved] = await this.pricing.resolveWithin(tx, tenantId, today, [
        { itemKind: ref.itemKind, ref: ref.ref, priceTypeCode: scope.priceTypeCode ?? undefined, unitCode: scope.unitCode ?? undefined },
      ]);
      if (!resolved || resolved.amount === null) throw new ClinicalOrderPriceMissingError(child.name);
      prices.push(resolved.amount * child.quantity);
    }
    return prices;
  }
}

function toDeclinable(row: RelevantItem): DeclinableOrderItem {
  return {
    orderItemId: row.item.id,
    status: row.item.status,
    packageId: row.item.clinicalOrderPackageId,
    invoiceLineId: row.lineId,
    lineNet: row.lineNet,
    refundedAmount: row.refunded,
  };
}
