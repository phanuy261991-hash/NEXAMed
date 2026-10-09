import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClinicalOrderItem, ClinicalOrderPackage, Invoice, InvoiceLine, Prisma } from '@prisma/client';
import {
  ClinicalOrderItemLockedError,
  ClinicalOrderPackageNotOrderableError,
  ClinicalOrderPriceMissingError,
  ClinicalOrderServiceNotInHouseError,
  EncounterNotInConsultationError,
  getVietnamDateString,
} from '@nexamed/core';
import type {
  ClinicalOrderDetail,
  ClinicalOrderItemInput,
  ClinicalOrderItemView,
  ClinicalOrderPackageView,
  DataScope,
  GetClinicalOrderResponse,
  SaveClinicalOrderRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { InvoiceRepository, type InvoiceLineToCreate } from '../billing/invoice.repository';
import { BusinessCodeService } from '../clinic/business-code.service';
import { EncounterRepository } from '../encounter/encounter.repository';
import { itemKey, PriceableCatalogService, type ItemRef } from '../pricing/priceable-catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { ServicePackageRepository } from '../pricing/service-package.repository';
import { TechnicalServiceRepository } from '../technical-service/technical-service.repository';
import { ClinicalOrderRepository, type ClinicalOrderWithLines, type CreateOrderItemData } from './clinical-order.repository';

type OrderItemRow = ClinicalOrderWithLines['items'][number];
type InvoiceLineWithInvoice = InvoiceLine & { invoice: Invoice };

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Chỉ định cận lâm sàng của bác sĩ (Cận lâm sàng GĐ3, docs/DECISIONS.md #212). Mỗi lượt khám 1 phiếu; "Lưu chỉ định" = thay TOÀN BỘ danh sách mong muốn,
 * server so khớp theo `id`: dòng mới → tạo (+ dòng hoá đơn nếu làm tại phòng khám); dòng/gói bị bỏ → gỡ (chỉ khi tiền CHƯA thu); đổi số lượng/đường làm =
 * gỡ cũ + tạo mới. Tiền ghi vào hoá đơn đúng khuôn tiền thuốc (#163): cộng vào hoá đơn khám đang chưa thu, không thì hoá đơn `PARACLINICAL` riêng.
 * Ngày chốt giá = ngày chỉ định (hôm nay, giờ Việt Nam). Giá snapshot — đổi bảng giá sau đó không đổi phiếu đã lưu.
 */
@Injectable()
export class ClinicalOrderService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ClinicalOrderRepository,
    private readonly encounterRepository: EncounterRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly technicalServiceRepository: TechnicalServiceRepository,
    private readonly servicePackageRepository: ServicePackageRepository,
    private readonly catalog: PriceableCatalogService,
    private readonly pricing: PricingService,
    private readonly businessCodeService: BusinessCodeService,
  ) {}

  async get(tenantId: string, actorId: string, dataScope: DataScope, encounterId: string): Promise<GetClinicalOrderResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertEncounterVisible(tx, tenantId, actorId, dataScope, encounterId);
      const order = await this.repository.findActiveByEncounter(tx, tenantId, encounterId);
      return { order: order ? await this.toDetail(tx, tenantId, order) : null };
    });
  }

  async save(tenantId: string, actorId: string, dataScope: DataScope, encounterId: string, dto: SaveClinicalOrderRequest, meta: RequestMeta): Promise<GetClinicalOrderResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.assertEncounterVisible(tx, tenantId, actorId, dataScope, encounterId);
      if (encounter.status !== 'IN_CONSULTATION') throw new EncounterNotInConsultationError();

      // 2 request "Lưu chỉ định" gần như đồng thời cho CÙNG lượt khám (2 máy cùng mở) xếp hàng — request sau thấy phiếu đã cập nhật của request trước.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:clinical-order:${encounterId}`}, 0))`;

      let order = await this.repository.findActiveByEncounter(tx, tenantId, encounterId);
      if (!order && dto.items.length === 0 && dto.packages.length === 0) return { order: null };
      if (!order) {
        const orderNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'CLINICAL_ORDER', new Date());
        const created = await this.repository.createOrder(tx, tenantId, actorId, { orderNo, encounterId });
        order = { ...created, items: [], packages: [] };
      }
      const today = getVietnamDateString();

      // ---- 1) so khớp dòng lẻ ----
      const standalone = order.items.filter((i) => i.clinicalOrderPackageId === null);
      const standaloneById = new Map(standalone.map((i) => [i.id, i]));
      const kept = new Set<string>();
      const toRemove: OrderItemRow[] = [];
      const toAdd: ClinicalOrderItemInput[] = [];
      const noteUpdates: { id: string; note: string | null }[] = [];
      for (const input of dto.items) {
        if (input.id === undefined) {
          toAdd.push(input);
          continue;
        }
        const current = standaloneById.get(input.id);
        if (!current || kept.has(input.id)) throw new BadRequestException('Dòng chỉ định không tồn tại hoặc bị trùng trong danh sách.');
        kept.add(input.id);
        const unchanged =
          current.performance === input.performance &&
          current.quantity === input.quantity &&
          current.technicalServiceId === (input.technicalServiceId ?? null) &&
          current.freeTextName === (input.freeTextName ?? null);
        if (unchanged) {
          if ((current.note ?? null) !== (input.note ?? null)) noteUpdates.push({ id: current.id, note: input.note ?? null });
        } else {
          toRemove.push(current);
          toAdd.push({ ...input, id: undefined });
        }
      }
      for (const current of standalone) if (!kept.has(current.id)) toRemove.push(current);

      // ---- 2) so khớp gói ----
      const packageById = new Map(order.packages.map((p) => [p.id, p]));
      const keptPackages = new Set<string>();
      const newPackageInputs: { servicePackageId: string }[] = [];
      for (const input of dto.packages) {
        if (input.id === undefined) {
          newPackageInputs.push({ servicePackageId: input.servicePackageId });
          continue;
        }
        if (!packageById.has(input.id) || keptPackages.has(input.id)) throw new BadRequestException('Gói chỉ định không tồn tại hoặc bị trùng trong danh sách.');
        keptPackages.add(input.id);
      }
      const removedPackages = order.packages.filter((p) => !keptPackages.has(p.id));
      const removedPackageIds = new Set(removedPackages.map((p) => p.id));
      const removedPackageChildren = order.items.filter((i) => i.clinicalOrderPackageId !== null && removedPackageIds.has(i.clinicalOrderPackageId));

      // ---- 3) gỡ: chỉ khi tiền CHƯA thu và dịch vụ chưa thực hiện ----
      await this.removeOrderParts(tx, tenantId, actorId, toRemove, removedPackages, removedPackageChildren);

      // ---- 4) thêm dòng lẻ ----
      const created = await this.addStandaloneItems(tx, tenantId, actorId, order, toAdd, today);
      // ---- 5) thêm gói ----
      const createdPackages = await this.addPackages(tx, tenantId, actorId, order, newPackageInputs, today, order.items.length + toAdd.length);

      for (const u of noteUpdates) await this.repository.updateItemNote(tx, tenantId, u.id, u.note, actorId);

      // ---- 6) tiền: dòng hoá đơn cho phần mới ----
      const newLines: InvoiceLineToCreate[] = [
        ...created.filter((c) => c.unitPrice !== null).map((c) => ({
          sourceOrderItemId: c.id,
          examTypeCode: c.code ?? '',
          examTypeName: c.name,
          unitPrice: c.unitPrice as bigint,
          quantity: c.quantity,
          lineTotal: (c.unitPrice as bigint) * BigInt(c.quantity),
        })),
        ...createdPackages.map((p) => ({ sourceOrderPackageId: p.id, examTypeCode: p.packageCode, examTypeName: p.packageName, unitPrice: p.unitPrice, quantity: 1, lineTotal: p.unitPrice })),
      ];
      if (newLines.length > 0) await this.attachInvoiceLines(tx, tenantId, actorId, encounterId, newLines);

      const bumped = await this.repository.bumpVersion(tx, tenantId, order.id, order.version, actorId);
      if (bumped === 0) throw new BadRequestException('Phiếu chỉ định vừa được cập nhật ở nơi khác — tải lại rồi lưu lại.');

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'clinical_order.saved',
        entityType: 'clinical_order',
        entityId: order.id,
        afterJson: { orderNo: order.orderNo, added: created.length, addedPackages: createdPackages.length, removed: toRemove.length + removedPackages.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const reloaded = await this.repository.findById(tx, tenantId, order.id);
      return { order: reloaded ? await this.toDetail(tx, tenantId, reloaded) : null };
    });
  }

  /** Ghi audit mỗi lần in phiếu chỉ định (dữ liệu y tế đưa ra giấy) — cùng khuôn in đơn thuốc. */
  async recordPrint(tenantId: string, actorId: string, dataScope: DataScope, encounterId: string, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertEncounterVisible(tx, tenantId, actorId, dataScope, encounterId);
      const order = await this.repository.findActiveByEncounter(tx, tenantId, encounterId);
      if (!order) throw new NotFoundException();
      await writeAuditLog(tx, tenantId, { actorId, action: 'clinical_order.printed', entityType: 'clinical_order', entityId: order.id, ip: meta.ip, userAgent: meta.userAgent });
    });
  }

  /**
   * Bác sĩ phụ trách mở tab "Kết quả cận lâm sàng" → đánh dấu mọi kết quả đã duyệt của lượt khám là ĐÃ XEM (tắt nhãn "Có kết quả mới" ở Hàng đợi khám, #221). Chỉ tính khi actor
   * LÀ bác sĩ phụ trách lượt khám — điều dưỡng/admin mở xem không làm mất thông báo của bác sĩ (trả `marked: 0`).
   */
  async markResultsSeen(tenantId: string, actorId: string, dataScope: DataScope, encounterId: string): Promise<{ marked: number }> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.assertEncounterVisible(tx, tenantId, actorId, dataScope, encounterId);
      if (encounter.doctorId !== actorId) return { marked: 0 };
      return { marked: await this.repository.markResultsSeen(tx, tenantId, encounterId, actorId) };
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async assertEncounterVisible(tx: Prisma.TransactionClient, tenantId: string, actorId: string, dataScope: DataScope, encounterId: string) {
    const encounter = await this.encounterRepository.findById(tx, tenantId, encounterId);
    if (!encounter || (dataScope === 'personal' && encounter.doctorId !== actorId)) throw new NotFoundException();
    return encounter;
  }

  /** Gỡ dòng/gói: kiểm khoá (đã thu/đã thực hiện) rồi gỡ dòng hoá đơn tương ứng + soft-delete dòng chỉ định. */
  private async removeOrderParts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    items: OrderItemRow[],
    packages: ClinicalOrderPackage[],
    packageChildren: OrderItemRow[],
  ): Promise<void> {
    if (items.length === 0 && packages.length === 0) return;
    for (const item of [...items, ...packageChildren]) {
      if (item.status !== 'ORDERED') throw new ClinicalOrderItemLockedError(item.name);
    }
    const lines = await this.invoiceRepository.findLinesByOrderSources(tx, tenantId, {
      itemIds: items.map((i) => i.id),
      packageIds: packages.map((p) => p.id),
    });
    const nameOfLine = (line: InvoiceLineWithInvoice): string =>
      items.find((i) => i.id === line.sourceOrderItemId)?.name ?? packages.find((p) => p.id === line.sourceOrderPackageId)?.packageName ?? line.examTypeName;
    for (const line of lines) {
      if (line.invoice.status !== 'UNPAID') throw new ClinicalOrderItemLockedError(nameOfLine(line));
    }
    const byInvoice = new Map<string, InvoiceLineWithInvoice[]>();
    for (const line of lines) byInvoice.set(line.invoiceId, [...(byInvoice.get(line.invoiceId) ?? []), line]);
    for (const [invoiceId, group] of byInvoice) {
      const removed = group.reduce((sum, l) => sum + l.lineTotal, 0n);
      await this.invoiceRepository.removeOrderLines(tx, tenantId, invoiceId, group.map((l) => l.id), actorId, removed);
    }
    await this.repository.softDeleteItems(tx, tenantId, [...items, ...packageChildren].map((i) => i.id), actorId, 'clinical_order_item_removed');
    await this.repository.softDeletePackages(tx, tenantId, packages.map((p) => p.id), actorId, 'clinical_order_package_removed');
  }

  private async addStandaloneItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    order: ClinicalOrderWithLines,
    inputs: ClinicalOrderItemInput[],
    today: string,
  ): Promise<ClinicalOrderItem[]> {
    if (inputs.length === 0) return [];
    const serviceIds = [...new Set(inputs.map((i) => i.technicalServiceId).filter((v): v is string => v !== undefined))];
    const services = new Map((await this.technicalServiceRepository.findRowsByIds(tx, tenantId, serviceIds)).map((s) => [s.id, s]));
    const inHouseRefs: ItemRef[] = inputs
      .filter((i) => i.performance === 'IN_HOUSE' && i.technicalServiceId !== undefined)
      .map((i) => ({ itemKind: 'TECHNICAL_SERVICE', ref: i.technicalServiceId as string }));
    const loaded = inHouseRefs.length > 0 ? await this.catalog.load(tx, tenantId, today, inHouseRefs) : new Map();

    const created: ClinicalOrderItem[] = [];
    let sortOrder = order.items.length;
    for (const input of inputs) {
      let data: CreateOrderItemData;
      if (input.technicalServiceId === undefined) {
        // Tên tự do — Zod đã ép EXTERNAL.
        data = {
          itemKind: 'FREE_TEXT',
          technicalServiceId: null,
          examTypeCode: null,
          freeTextName: input.freeTextName as string,
          code: null,
          name: input.freeTextName as string,
          performance: 'EXTERNAL',
          quantity: input.quantity,
          unitPrice: null,
          priceTypeCode: null,
          unitCode: null,
          clinicalOrderPackageId: null,
          note: input.note ?? null,
          sortOrder: sortOrder++,
        };
      } else {
        const service = services.get(input.technicalServiceId);
        if (!service || !service.isActive) throw new BadRequestException('Có dịch vụ không tồn tại hoặc đã ngừng sử dụng trong danh mục.');
        let unitPrice: bigint | null = null;
        let priceTypeCode: string | null = null;
        let unitCode: string | null = null;
        if (input.performance === 'IN_HOUSE') {
          if (!service.isPerformedInHouse) throw new ClinicalOrderServiceNotInHouseError(service.name);
          const scope = loaded.get(itemKey('TECHNICAL_SERVICE', service.id))?.item.scopes.find((s: { amount: number | null }) => s.amount !== null);
          if (!scope) throw new ClinicalOrderPriceMissingError(service.name);
          const [resolved] = await this.pricing.resolveWithin(tx, tenantId, today, [
            { itemKind: 'TECHNICAL_SERVICE', ref: service.id, priceTypeCode: scope.priceTypeCode ?? undefined, unitCode: scope.unitCode ?? undefined },
          ]);
          if (!resolved || resolved.amount === null) throw new ClinicalOrderPriceMissingError(service.name);
          unitPrice = BigInt(resolved.amount);
          priceTypeCode = scope.priceTypeCode;
          unitCode = scope.unitCode;
        }
        data = {
          itemKind: 'TECHNICAL_SERVICE',
          technicalServiceId: service.id,
          examTypeCode: null,
          freeTextName: null,
          code: service.code,
          name: service.name,
          performance: input.performance,
          quantity: input.quantity,
          unitPrice,
          priceTypeCode,
          unitCode,
          clinicalOrderPackageId: null,
          note: input.performance === 'EXTERNAL' ? (input.note ?? null) : null,
          sortOrder: sortOrder++,
        };
      }
      created.push(await this.repository.createItem(tx, tenantId, actorId, order.id, data));
    }
    return created;
  }

  /** Gói mới: chốt giá gói (sau bảng giá có thời hạn theo ngày chỉ định) + sinh dịch vụ con (không tính tiền riêng). */
  private async addPackages(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    order: ClinicalOrderWithLines,
    inputs: { servicePackageId: string }[],
    today: string,
    startSortOrder: number,
  ): Promise<ClinicalOrderPackage[]> {
    const created: ClinicalOrderPackage[] = [];
    let sortOrder = startSortOrder;
    for (const input of inputs) {
      const pkg = await this.servicePackageRepository.findById(tx, tenantId, input.servicePackageId);
      if (!pkg) throw new NotFoundException();
      const orderable = pkg.isActive && dateOnly(pkg.effectiveFrom) <= today && (pkg.effectiveTo === null || dateOnly(pkg.effectiveTo) >= today);
      if (!orderable) throw new ClinicalOrderPackageNotOrderableError(pkg.name);
      const [resolved] = await this.pricing.resolveWithin(tx, tenantId, today, [{ itemKind: 'PACKAGE', ref: pkg.id }]);
      if (!resolved || resolved.amount === null) throw new ClinicalOrderPackageNotOrderableError(pkg.name);

      const children = await this.servicePackageRepository.listItems(tx, tenantId, [pkg.id]);
      const refs: ItemRef[] = children.map((c) => (c.itemKind === 'EXAM_TYPE' ? { itemKind: 'EXAM_TYPE', ref: c.examTypeCode as string } : { itemKind: 'TECHNICAL_SERVICE', ref: c.technicalServiceId as string }));
      const childInfo = await this.catalog.load(tx, tenantId, today, refs);
      if (children.length === 0 || refs.some((r) => !childInfo.has(itemKey(r.itemKind, r.ref)))) throw new ClinicalOrderPackageNotOrderableError(pkg.name);

      const row = await this.repository.createPackage(tx, tenantId, actorId, order.id, {
        servicePackageId: pkg.id,
        packageCode: pkg.code,
        packageName: pkg.name,
        unitPrice: BigInt(resolved.amount),
      });
      created.push(row);
      for (const child of children) {
        const info = childInfo.get(itemKey(child.itemKind === 'EXAM_TYPE' ? 'EXAM_TYPE' : 'TECHNICAL_SERVICE', (child.examTypeCode ?? child.technicalServiceId) as string));
        await this.repository.createItem(tx, tenantId, actorId, order.id, {
          itemKind: child.itemKind === 'EXAM_TYPE' ? 'EXAM_TYPE' : 'TECHNICAL_SERVICE',
          technicalServiceId: child.technicalServiceId,
          examTypeCode: child.examTypeCode,
          freeTextName: null,
          code: info?.item.code ?? null,
          name: info?.item.name ?? '',
          performance: 'IN_HOUSE',
          quantity: child.quantity,
          unitPrice: null,
          priceTypeCode: null,
          unitCode: null,
          clinicalOrderPackageId: row.id,
          note: null,
          sortOrder: sortOrder++,
        });
      }
    }
    return created;
  }

  /**
   * Gắn tiền vào hoá đơn (đúng khuôn tiền thuốc, #163): hoá đơn khám đang UNPAID → cộng vào đó; không thì hoá đơn `PARACLINICAL` UNPAID gần nhất; không
   * có nữa → tạo mới. Retry 1 lần khi version lệch, rơi sang tạo hoá đơn riêng nếu vẫn kẹt.
   */
  private async attachInvoiceLines(tx: Prisma.TransactionClient, tenantId: string, actorId: string, encounterId: string, lines: InvoiceLineToCreate[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const service = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      const target = service && service.status === 'UNPAID' ? service : await this.invoiceRepository.findOpenParaclinicalInvoiceForEncounter(tx, tenantId, encounterId);
      if (!target) break;
      const count = await this.invoiceRepository.appendLines(tx, tenantId, target.id, target.version, actorId, lines);
      if (count > 0) return;
    }
    await this.invoiceRepository.createInvoiceWithLines(tx, tenantId, actorId, encounterId, 'PARACLINICAL', lines);
  }

  private async toDetail(tx: Prisma.TransactionClient, tenantId: string, order: ClinicalOrderWithLines): Promise<ClinicalOrderDetail> {
    const billedItemIds = order.items.filter((i) => i.clinicalOrderPackageId === null && i.unitPrice !== null).map((i) => i.id);
    const lines = await this.invoiceRepository.findLinesByOrderSources(tx, tenantId, { itemIds: billedItemIds, packageIds: order.packages.map((p) => p.id) });
    const invoiceOfItem = new Map(lines.filter((l) => l.sourceOrderItemId !== null).map((l) => [l.sourceOrderItemId as string, l.invoice]));
    const invoiceOfPackage = new Map(lines.filter((l) => l.sourceOrderPackageId !== null).map((l) => [l.sourceOrderPackageId as string, l.invoice]));
    const unpaid = (inv: Invoice | undefined): boolean => inv === undefined || inv.status === 'UNPAID';

    const items: ClinicalOrderItemView[] = order.items.map((i) => ({
      id: i.id,
      itemKind: i.itemKind,
      technicalServiceId: i.technicalServiceId,
      examTypeCode: i.examTypeCode,
      code: i.code,
      name: i.name,
      performance: i.performance,
      quantity: i.quantity,
      unitPrice: i.unitPrice === null ? null : Number(i.unitPrice),
      lineTotal: i.unitPrice === null ? null : Number(i.unitPrice) * i.quantity,
      packageId: i.clinicalOrderPackageId,
      placeName: i.technicalService?.department?.name ?? null,
      serviceKind: i.technicalService?.serviceKind ?? null,
      note: i.note,
      status: i.status,
      resultReturnedAt: i.results[0]?.signedAt?.toISOString() ?? null,
      amendmentPending: i.results[0] !== undefined && i.results[0].supersedesId !== null && i.results[0].signedAt === null,
      editable: i.status === 'ORDERED' && (i.clinicalOrderPackageId === null ? unpaid(invoiceOfItem.get(i.id)) : unpaid(invoiceOfPackage.get(i.clinicalOrderPackageId))),
    }));
    const packages: ClinicalOrderPackageView[] = order.packages.map((p) => ({
      id: p.id,
      servicePackageId: p.servicePackageId,
      code: p.packageCode,
      name: p.packageName,
      unitPrice: Number(p.unitPrice),
      editable: unpaid(invoiceOfPackage.get(p.id)),
    }));
    // Dòng đã huỷ (huỷ lượt khám, #219) không còn tính vào tạm tính.
    const inHouseTotal = items.reduce((sum, i) => sum + (i.status === 'CANCELLED' ? 0 : (i.lineTotal ?? 0)), 0) + packages.reduce((sum, p) => sum + p.unitPrice, 0);

    const invoiceMap = new Map<string, Invoice>();
    for (const l of lines) invoiceMap.set(l.invoice.id, l.invoice);
    return {
      id: order.id,
      orderNo: order.orderNo,
      encounterId: order.encounterId,
      version: order.version,
      createdAt: order.createdAt.toISOString(),
      items,
      packages,
      inHouseTotal,
      invoices: [...invoiceMap.values()].map((inv) => ({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, invoiceType: inv.invoiceType, status: inv.status })),
    };
  }
}
