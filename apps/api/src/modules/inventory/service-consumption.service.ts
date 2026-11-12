import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getVietnamDateString, maxDataScope, selectFefoBatches, type ActiveServiceConsumption } from '@nexamed/core';
import type {
  ConsumptionRecord,
  ConsumptionService,
  EncounterConsumptionResponse,
  PutServiceNormRequest,
  RecordConsumptionRequest,
  ReverseConsumptionRequest,
  ServiceConsumptionKind,
  ServiceNormQuery,
  ServiceNormResponse,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import type { RequestMeta } from '../../common/request-meta';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockBalanceRepository } from './stock-balance.repository';
import { StockIssueService } from './stock-issue.service';
import { ServiceConsumptionRepository } from './service-consumption.repository';

/** Lượt khám đã tiếp nhận mới có dịch vụ để ghi tiêu hao (chưa tiếp nhận / đã huỷ / không đến thì không). */
const RECORDABLE_ENCOUNTER_STATUSES = new Set(['CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED']);

/**
 * "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4): định mức (chung cả công ty), ghi tiêu hao (phiếu xuất `SERVICE_CONSUMPTION`, theo chi nhánh qua kho) và đảo phiếu.
 * Không thu thêm tiền khách, không đụng hoá đơn. Mọi việc ghi nằm trong MỘT transaction, KHÔNG gọi port bên trong (#264).
 */
@Injectable()
export class ServiceConsumptionService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ServiceConsumptionRepository,
    private readonly stockIssueService: StockIssueService,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly warehouseRepository: WarehouseRepository,
  ) {}

  // ============ Định mức ============

  async getNorm(tenantId: string, query: ServiceNormQuery): Promise<ServiceNormResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.loadNorm(tx, tenantId, query.kind, query.ref));
  }

  private async loadNorm(tx: Prisma.TransactionClient, tenantId: string, kind: ServiceConsumptionKind, ref: string): Promise<ServiceNormResponse> {
    const rows = await this.repository.listNorms(tx, tenantId, kind, ref);
    const drugs = await this.repository.findDrugs(tx, tenantId, rows.map((r) => r.drugId));
    const byId = new Map(drugs.map((d) => [d.id, d]));
    return {
      kind,
      ref,
      lines: rows.flatMap((r) => {
        const d = byId.get(r.drugId);
        return d ? [{ drugId: d.id, drugCode: d.code, drugName: d.name, itemType: d.itemType, baseUnitCode: d.baseUnitCode, quantity: r.quantity }] : [];
      }),
    };
  }

  async putNorm(tenantId: string, actorId: string, query: ServiceNormQuery, dto: PutServiceNormRequest, meta: RequestMeta): Promise<ServiceNormResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const exists = await this.repository.serviceExists(tx, tenantId, query.kind, query.ref);
      if (!exists) throw new NotFoundException();
      const drugs = await this.repository.findDrugs(tx, tenantId, dto.lines.map((l) => l.drugId));
      if (drugs.length !== dto.lines.length) throw new UnprocessableEntityException('Có vật tư hoặc thuốc không còn trong danh mục.');
      await this.repository.replaceNorms(tx, tenantId, actorId, query.kind, query.ref, dto.lines);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'service_consumption_norm.updated',
        entityType: 'service_consumption_norm',
        entityId: query.kind === 'TECHNICAL_SERVICE' ? query.ref : tenantId,
        afterJson: { kind: query.kind, ref: query.ref, lineCount: dto.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.loadNorm(tx, tenantId, query.kind, query.ref);
    });
  }

  // ============ Dịch vụ + định mức + phiếu đã ghi của một lượt khám ============

  async getForEncounter(tenantId: string, branchId: string, actorId: string, encounterId: string): Promise<EncounterConsumptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.repository.findEncounter(tx, tenantId, branchId, encounterId);
      if (!encounter) throw new NotFoundException();
      const canSeeCost = await this.canSeeCost(tx, tenantId, actorId);

      const [serviceItems, orderItems, issues] = await Promise.all([
        this.repository.listServiceItems(tx, tenantId, encounterId),
        this.repository.listOrderItems(tx, tenantId, encounterId),
        this.repository.listActiveIssues(tx, tenantId, branchId, encounterId),
      ]);
      const norms = await this.repository.listNormsForServices(
        tx,
        tenantId,
        [...new Set(serviceItems.map((s) => s.examTypeCode))],
        [...new Set(orderItems.map((o) => o.technicalServiceId).filter((v): v is string => v !== null))],
      );
      const normDrugs = await this.repository.findDrugs(tx, tenantId, [...new Set(norms.map((n) => n.drugId))]);
      const drugById = new Map(normDrugs.map((d) => [d.id, d]));
      const performerNames = await this.repository.findUserNames(tx, tenantId, [...new Set(issues.map((i) => i.performedBy).filter((v): v is string => v !== null))]);

      const normLines = (match: (n: (typeof norms)[number]) => boolean) =>
        norms.filter(match).flatMap((n) => {
          const d = drugById.get(n.drugId);
          return d ? [{ drugId: d.id, drugCode: d.code, drugName: d.name, itemType: d.itemType, baseUnitCode: d.baseUnitCode, quantity: n.quantity }] : [];
        });

      const toRecord = (issue: (typeof issues)[number]): ConsumptionRecord => ({
        id: issue.id,
        issueNo: issue.issueNo,
        occurredAt: issue.occurredAt.toISOString(),
        performedBy: issue.performedBy!,
        performedByName: performerNames.get(issue.performedBy!) ?? 'Không rõ',
        lines: issue.lines.map((l) => ({
          drugId: l.drug.id,
          drugCode: l.drug.code,
          drugName: l.drug.name,
          itemType: l.drug.itemType,
          baseUnitCode: l.drug.baseUnitCode,
          quantity: l.quantity,
          batchNo: l.batch?.batchNo ?? null,
          expiryDate: l.batch?.expiryDate ? l.batch.expiryDate.toISOString().slice(0, 10) : null,
          unitCost: canSeeCost ? Number(l.unitCost) : null,
        })),
        totalCost: canSeeCost ? issue.lines.reduce((sum, l) => sum + Number(l.unitCost) * l.quantity, 0) : null,
      });

      const services: ConsumptionService[] = [
        ...serviceItems.map((s) => {
          const issue = issues.find((i) => i.encounterServiceItemId === s.id);
          return {
            target: { kind: 'ENCOUNTER_SERVICE_ITEM' as const, id: s.id },
            serviceKind: 'EXAM_TYPE' as const,
            serviceCode: s.examTypeCode,
            serviceName: s.examTypeName,
            status: null,
            norm: normLines((n) => n.serviceKind === 'EXAM_TYPE' && n.examTypeCode === s.examTypeCode),
            record: issue ? toRecord(issue) : null,
          };
        }),
        ...orderItems.map((o) => {
          const issue = issues.find((i) => i.clinicalOrderItemId === o.id);
          return {
            target: { kind: 'CLINICAL_ORDER_ITEM' as const, id: o.id },
            serviceKind: 'TECHNICAL_SERVICE' as const,
            serviceCode: o.code,
            serviceName: o.name,
            status: o.status,
            norm: normLines((n) => n.serviceKind === 'TECHNICAL_SERVICE' && n.technicalServiceId === o.technicalServiceId),
            record: issue ? toRecord(issue) : null,
          };
        }),
      ];
      return { encounterId, canSeeCost, services };
    });
  }

  // ============ Ghi tiêu hao ============

  async record(tenantId: string, branchId: string, actorId: string, dto: RecordConsumptionRequest, meta: RequestMeta): Promise<EncounterConsumptionResponse> {
    try {
      await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
        const encounter = await this.repository.findEncounter(tx, tenantId, branchId, dto.encounterId);
        if (!encounter) throw new NotFoundException();
        if (!RECORDABLE_ENCOUNTER_STATUSES.has(encounter.status)) {
          throw new UnprocessableEntityException('Lượt khám chưa được tiếp nhận hoặc đã huỷ, chưa ghi vật tư tiêu hao được.');
        }

        if (dto.target.kind === 'CLINICAL_ORDER_ITEM') {
          const item = await this.repository.findOrderItem(tx, tenantId, dto.encounterId, dto.target.id);
          if (!item) throw new NotFoundException();
          if (item.performance !== 'IN_HOUSE' || item.status === 'CANCELLED') throw new UnprocessableEntityException('Dịch vụ này không làm tại phòng khám hoặc đã bị huỷ, không ghi vật tư được.');
        } else if (!(await this.repository.findServiceItem(tx, tenantId, dto.encounterId, dto.target.id))) {
          throw new NotFoundException();
        }
        if (await this.repository.findActiveIssueForTarget(tx, tenantId, dto.target)) {
          throw new ConflictException('Dịch vụ này đã ghi vật tư tiêu hao. Muốn ghi lại, hãy đảo phiếu cũ trước.');
        }

        const warehouse = await this.warehouseRepository.findDefault(tx, tenantId, branchId);
        if (!warehouse) throw new UnprocessableEntityException('Chi nhánh chưa có kho để trừ vật tư.');
        const drugs = await this.repository.findDrugs(tx, tenantId, dto.lines.map((l) => l.drugId));
        const drugById = new Map(drugs.map((d) => [d.id, d]));
        const today = getVietnamDateString();

        const issueLines: { drugId: string; batchId: string | null; quantity: number; unitCost: bigint }[] = [];
        for (const line of dto.lines) {
          const drug = drugById.get(line.drugId);
          if (!drug) throw new UnprocessableEntityException('Có vật tư hoặc thuốc không còn trong danh mục.');
          if (drug.isBatchManaged) {
            const batches = await this.inventoryBatchRepository.listWithBalanceForDrug(tx, tenantId, branchId, drug.id, warehouse.id);
            // FEFO: lô hết hạn sớm nhất trước; lô ĐÃ hết hạn không dùng để xuất tiêu hao.
            const usable = batches.filter((b) => !b.expiryDate || b.expiryDate.toISOString().slice(0, 10) >= today);
            const allocation = selectFefoBatches(
              usable.map((b) => ({ batchId: b.batchId, quantityOnHand: b.quantityOnHand, expiryDate: b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : null })),
              line.quantity,
            );
            if (!allocation) {
              const available = usable.reduce((sum, b) => sum + b.quantityOnHand, 0);
              throw new UnprocessableEntityException(`Không đủ tồn kho "${drug.name}": cần ${line.quantity}, còn dùng được ${available}.`);
            }
            for (const a of allocation) {
              const batch = usable.find((b) => b.batchId === a.batchId)!;
              issueLines.push({ drugId: drug.id, batchId: a.batchId, quantity: a.quantity, unitCost: batch.unitCost });
            }
          } else {
            const balance = await this.stockBalanceRepository.findByKey(tx, tenantId, drug.id, warehouse.id, null);
            const onHand = balance?.quantityOnHand ?? 0;
            if (onHand < line.quantity) throw new UnprocessableEntityException(`Không đủ tồn kho "${drug.name}": cần ${line.quantity}, còn ${onHand}.`);
            issueLines.push({ drugId: drug.id, batchId: null, quantity: line.quantity, unitCost: balance?.averageUnitCost ?? 0n });
          }
        }

        const issue = await this.stockIssueService.createServiceConsumptionIssue(tx, tenantId, actorId, {
          warehouseId: warehouse.id,
          encounterId: dto.encounterId,
          clinicalOrderItemId: dto.target.kind === 'CLINICAL_ORDER_ITEM' ? dto.target.id : null,
          encounterServiceItemId: dto.target.kind === 'ENCOUNTER_SERVICE_ITEM' ? dto.target.id : null,
          performedBy: actorId,
          occurredAt: new Date(),
          note: `Tiêu hao theo dịch vụ, lượt khám ${encounter.encounterNo}`,
          lines: issueLines,
        });
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'service_consumption.recorded',
          entityType: 'stock_issue',
          entityId: issue.id,
          afterJson: { encounterId: dto.encounterId, targetKind: dto.target.kind, lineCount: issueLines.length },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      });
    } catch (e) {
      // Hai người cùng ghi một dịch vụ: chỉ mục duy nhất chặn lần sau (P2002) → 409 thay vì lỗi hệ thống.
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Dịch vụ này vừa được ghi vật tư tiêu hao. Tải lại để xem.');
      throw e;
    }
    return this.getForEncounter(tenantId, branchId, actorId, dto.encounterId);
  }

  // ============ Đảo phiếu ============

  async reverse(tenantId: string, branchId: string, actorId: string, issueId: string, dto: ReverseConsumptionRequest, meta: RequestMeta): Promise<EncounterConsumptionResponse> {
    const encounterId = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.reverseInTx(tx, tenantId, branchId, actorId, issueId, dto.reason, meta, false));
    return this.getForEncounter(tenantId, branchId, actorId, encounterId);
  }

  /** Đảo phiếu trong transaction của người gọi. `viaDecline` = đảo cùng lúc thu ngân bỏ dịch vụ (ghi vào nhật ký để truy ngược). */
  private async reverseInTx(tx: Prisma.TransactionClient, tenantId: string, branchId: string, actorId: string, issueId: string, reason: string, meta: RequestMeta, viaDecline: boolean): Promise<string> {
    const issue = await this.repository.findIssueForReverse(tx, tenantId, branchId, issueId);
    if (!issue || !issue.encounterId) throw new NotFoundException();
    if (issue.status !== 'POSTED') throw new ConflictException('Phiếu tiêu hao này đã được đảo.');
    await this.stockIssueService.voidPostedForAdjustment(tx, tenantId, branchId, actorId, issueId, reason, meta);
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'service_consumption.reversed',
      entityType: 'stock_issue',
      entityId: issueId,
      afterJson: viaDecline ? { reason, viaServiceDecline: true } : { reason },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return issue.encounterId;
  }

  // ============ Cho hộp "Khách không làm dịch vụ" (qua `ServiceConsumptionDeclinePort`) ============
  // Hai hàm dưới chạy TRONG transaction của người gọi (nhận `tx`), KHÔNG tự mở transaction (#264).

  async describeActiveForDecline(tx: Prisma.TransactionClient, tenantId: string, branchId: string, actorId: string, orderItemIds: string[]): Promise<{ canReverse: boolean; items: ActiveServiceConsumption[] }> {
    const [issues, canSeeCost, canReverse] = await Promise.all([
      this.repository.listActiveIssuesForOrderItems(tx, tenantId, branchId, orderItemIds),
      this.canSeeCost(tx, tenantId, actorId),
      this.canReverse(tx, tenantId, actorId),
    ]);
    return {
      canReverse,
      items: issues.flatMap((issue) =>
        issue.clinicalOrderItemId === null
          ? []
          : [
              {
                orderItemId: issue.clinicalOrderItemId,
                issueId: issue.id,
                issueNo: issue.issueNo,
                lines: issue.lines.map((l) => ({ drugName: l.drug.name, quantity: l.quantity, baseUnitCode: l.drug.baseUnitCode })),
                totalCost: canSeeCost ? issue.lines.reduce((sum, l) => sum + Number(l.unitCost) * l.quantity, 0) : null,
              },
            ],
      ),
    };
  }

  async reverseForDecline(tx: Prisma.TransactionClient, tenantId: string, branchId: string, actorId: string, issueId: string, reason: string, meta: RequestMeta): Promise<void> {
    await this.reverseInTx(tx, tenantId, branchId, actorId, issueId, reason, meta, true);
  }

  private async canReverse(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<boolean> {
    return maxDataScope(await findScopesForUserPermission(tx, tenantId, actorId, 'service_consumption', 'reverse')) !== 'none';
  }

  private async canSeeCost(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<boolean> {
    return maxDataScope(await findScopesForUserPermission(tx, tenantId, actorId, 'service_consumption', 'report')) !== 'none';
  }
}
