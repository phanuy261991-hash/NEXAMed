import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CLINIC_CONFIG_READER_PORT, LabPartnerDisabledError, type ClinicConfigReaderPort } from '@nexamed/core';
import type {
  LabPartnerOption,
  LabPartnerPendingRow,
  LabPartnerQueueCounts,
  LabPartnerSentRow,
  ListLabPartnerPendingResponse,
  ListLabPartnerQueueQuery,
  ListLabPartnerSentResponse,
  SendLabPartnerSamplesRequest,
  SendLabPartnerSamplesResponse,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { canSeePartnerCost } from '../../common/partner-cost-access';
import { BusinessCodeService } from '../clinic/business-code.service';
import { UserAccountRepository } from '../iam/user-account.repository';
import { LabPartnerDispatchRepository, type DispatchableItemRow, type SentItemRow } from './lab-partner-dispatch.repository';

/**
 * Hàng đợi "Gửi mẫu đối tác" (docs/DECISIONS.md #291) — lát cắt "Gửi mẫu đi": xem mẫu chờ gửi (kèm đối tác + giá trả của từng dịch vụ), gửi một đợt cho MỘT đối tác (hệ thống áp ĐÚNG giá của cặp
 * dịch vụ × đối tác đó và CHỤP LẠI vào dòng gửi), xem mẫu đã gửi chờ kết quả. Theo CHI NHÁNH đang làm việc; giá trả là giá vốn nên chỉ người có quyền (`canSeePartnerCost`) thấy con số.
 * Công tắc "Dùng đối tác xét nghiệm" tắt thì mọi API ở đây trả 409 `LAB_PARTNER_DISABLED` (đọc cấu hình NGOÀI transaction, #264).
 */
@Injectable()
export class LabPartnerDispatchService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: LabPartnerDispatchRepository,
    private readonly businessCodeService: BusinessCodeService,
    private readonly userRepository: UserAccountRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
  ) {}

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfig.getLabPartnerEnabled(tenantId))) throw new LabPartnerDisabledError();
  }

  private async counts(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<LabPartnerQueueCounts> {
    const [pending, sent, done] = await Promise.all([
      this.repository.countPending(tx, tenantId, branchId),
      this.repository.countByStatus(tx, tenantId, branchId, 'SENT'),
      this.repository.countByStatus(tx, tenantId, branchId, 'RECEIVED'),
    ]);
    return { pending, sent, done };
  }

  async listPending(tenantId: string, actorId: string, branchId: string, query: ListLabPartnerQueueQuery): Promise<ListLabPartnerPendingResponse> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const costVisible = await canSeePartnerCost(tx, tenantId, actorId);
      const items = await this.repository.listPendingItems(tx, tenantId, branchId, query.q);
      const serviceIds = [...new Set(items.map((i) => i.technicalServiceId).filter((id): id is string => id !== null))];
      const priceRows = await this.repository.listPriceOptions(tx, tenantId, serviceIds);
      const optionsByService = new Map<string, LabPartnerOption[]>();
      for (const p of priceRows) {
        const list = optionsByService.get(p.technicalServiceId) ?? [];
        list.push({ supplierId: p.supplierId, supplierCode: p.supplierCode, supplierName: p.supplierName, isDefault: p.isDefault, amount: costVisible ? Number(p.amount) : null });
        optionsByService.set(p.technicalServiceId, list);
      }
      const collectorIds = [...new Set(items.map((i) => i.collectedBy ?? i.specimenTube?.collectedBy).filter((id): id is string => !!id))];
      const names = await this.namesOf(tx, tenantId, collectorIds);
      const rows: LabPartnerPendingRow[] = items.map((item) => this.toPendingRow(item, optionsByService.get(item.technicalServiceId ?? '') ?? [], names));
      return { items: rows, counts: await this.counts(tx, tenantId, branchId), costVisible };
    });
  }

  async listSent(tenantId: string, actorId: string, branchId: string, query: ListLabPartnerQueueQuery): Promise<ListLabPartnerSentResponse> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const costVisible = await canSeePartnerCost(tx, tenantId, actorId);
      const items = await this.repository.listSentItems(tx, tenantId, branchId, { supplierId: query.supplierId, q: query.q });
      const names = await this.namesOf(tx, tenantId, [...new Set(items.map((i) => i.dispatch.sentBy))]);
      const now = Date.now();
      const rows: LabPartnerSentRow[] = items.map((item) => this.toSentRow(item, costVisible, names, now));
      return { items: rows, counts: await this.counts(tx, tenantId, branchId), costVisible };
    });
  }

  /** Gửi một đợt cho MỘT đối tác: kiểm từng mẫu (đã lấy, dịch vụ cấu hình gửi đối tác, chưa gửi, đối tác có giá cho dịch vụ), áp giá của cặp và chụp lại. */
  async send(tenantId: string, actorId: string, branchId: string, dto: SendLabPartnerSamplesRequest, meta: RequestMeta): Promise<SendLabPartnerSamplesResponse> {
    await this.assertEnabled(tenantId);
    const ids = [...new Set(dto.itemIds)];
    if (ids.length !== dto.itemIds.length) throw new BadRequestException('Có mẫu bị chọn trùng.');
    const sentAt = dto.sentAt ? new Date(dto.sentAt) : new Date();
    if (sentAt.getTime() > Date.now() + 60_000) throw new UnprocessableEntityException('Giờ gửi không được ở tương lai.');

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const partner = await this.repository.findActivePartner(tx, tenantId, dto.supplierId);
      if (!partner) throw new UnprocessableEntityException('Đối tác không tồn tại, đã ngưng hoặc chưa được đánh dấu là đối tác xét nghiệm.');
      const items = await this.repository.findItemsByIds(tx, tenantId, branchId, ids);
      if (items.length !== ids.length) throw new NotFoundException();
      const alreadySent = await this.repository.findActivelyDispatchedItemIds(tx, tenantId, ids);
      const costVisible = await canSeePartnerCost(tx, tenantId, actorId);

      const prepared: { item: DispatchableItemRow; unitCost: bigint; dueAt: Date | null }[] = [];
      for (const item of items) {
        const service = item.technicalService;
        const label = `"${service?.name ?? item.name}" của ${item.order.encounter.patient.fullName}`;
        if (!service || !service.sentToPartner || !service.isPerformedInHouse || item.performance !== 'IN_HOUSE') {
          throw new UnprocessableEntityException(`Dịch vụ ${label} không cấu hình "Gửi đối tác".`);
        }
        if (item.status !== 'IN_PROGRESS' || item.specimenTube?.status !== 'COLLECTED') {
          throw new UnprocessableEntityException(`Mẫu ${label} chưa lấy hoặc đã được xử lý.`);
        }
        if (alreadySent.has(item.id)) throw new ConflictException(`Mẫu ${label} đã được gửi.`);
        const collectedAt = item.collectedAt ?? item.specimenTube.collectedAt;
        if (collectedAt && sentAt.getTime() < collectedAt.getTime()) throw new UnprocessableEntityException(`Giờ gửi không được trước giờ lấy mẫu của ${label}.`);
        const price = await this.repository.findPrice(tx, tenantId, service.id, dto.supplierId);
        if (!price) throw new UnprocessableEntityException(`Đối tác "${partner.name}" chưa có giá trả cho dịch vụ "${service.name}".`);
        const dueAt = service.turnaroundMinutes ? new Date(sentAt.getTime() + service.turnaroundMinutes * 60_000) : null;
        prepared.push({ item, unitCost: price.amount, dueAt });
      }

      const dispatchNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'LAB_PARTNER_DISPATCH', sentAt);
      const dispatch = await this.repository.createDispatch(tx, tenantId, actorId, { branchId, dispatchNo, supplierId: dto.supplierId, sentAt, note: dto.note ?? null });
      try {
        await this.repository.createDispatchItems(
          tx,
          tenantId,
          actorId,
          dispatch.id,
          prepared.map((p) => ({ clinicalOrderItemId: p.item.id, specimenTubeId: p.item.specimenTube?.id ?? null, unitCost: p.unitCost, dueAt: p.dueAt })),
        );
      } catch (err) {
        // Hai người cùng gửi một mẫu: ràng buộc duy nhất (một lần gửi hiệu lực mỗi dòng chỉ định) chặn lần sau.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Có mẫu vừa được người khác gửi — tải lại danh sách.');
        throw err;
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'lab_partner_dispatch.created',
        entityType: 'lab_partner_dispatch',
        entityId: dispatch.id,
        afterJson: { dispatchNo, supplierId: dto.supplierId, itemCount: prepared.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return {
        dispatchId: dispatch.id,
        dispatchNo,
        supplierId: dto.supplierId,
        supplierName: partner.name,
        sentAt: sentAt.toISOString(),
        items: prepared.map((p) => ({ itemId: p.item.id, unitCost: costVisible ? Number(p.unitCost) : null, dueAt: p.dueAt?.toISOString() ?? null })),
      };
    });
  }

  private async namesOf(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    return new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, ids)).map((u) => [u.id, u.fullName]));
  }

  private toPendingRow(item: DispatchableItemRow, options: LabPartnerOption[], names: Map<string, string>): LabPartnerPendingRow {
    const collectedBy = item.collectedBy ?? item.specimenTube?.collectedBy ?? null;
    const collectedAt = item.collectedAt ?? item.specimenTube?.collectedAt ?? null;
    return {
      itemId: item.id,
      orderNo: item.order.orderNo,
      patientId: item.order.encounter.patient.id,
      patientName: item.order.encounter.patient.fullName,
      patientCode: item.order.encounter.patient.patientCode,
      serviceCode: item.technicalService?.code ?? item.code ?? '',
      serviceName: item.technicalService?.name ?? item.name,
      specimenName: item.specimenTube?.specimenName ?? null,
      tubeSid: item.specimenTube?.sid ?? null,
      collectedAt: collectedAt?.toISOString() ?? null,
      collectedByName: collectedBy ? (names.get(collectedBy) ?? null) : null,
      options,
    };
  }

  private toSentRow(row: SentItemRow, costVisible: boolean, names: Map<string, string>, now: number): LabPartnerSentRow {
    const item = row.orderItem;
    return {
      itemId: item.id,
      dispatchId: row.dispatch.id,
      dispatchNo: row.dispatch.dispatchNo,
      supplierId: row.dispatch.supplierId,
      supplierName: row.dispatch.supplier.name,
      orderNo: item.order.orderNo,
      patientId: item.order.encounter.patient.id,
      patientName: item.order.encounter.patient.fullName,
      patientCode: item.order.encounter.patient.patientCode,
      serviceName: item.technicalService?.name ?? item.name,
      tubeSid: item.specimenTube?.sid ?? null,
      sentAt: row.dispatch.sentAt.toISOString(),
      sentByName: names.get(row.dispatch.sentBy) ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      overdue: row.dueAt !== null && row.dueAt.getTime() < now,
      unitCost: costVisible ? Number(row.unitCost) : null,
    };
  }
}
