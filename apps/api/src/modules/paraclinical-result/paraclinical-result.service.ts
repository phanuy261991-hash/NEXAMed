import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ParaclinicalResultValue, Prisma } from '@prisma/client';
import {
  CLINIC_CONFIG_READER_PORT,
  checkParaclinicalSectionComplete,
  deriveQueueBucket,
  evaluateLabValue,
  formatLabReferenceText,
  getVietnamDateString,
  groupQueueItems,
  ParaclinicalItemInvalidStateError,
  ParaclinicalPaymentRequiredError,
  ParaclinicalResultIncompleteError,
  PARACLINICAL_QUEUE_BUCKETS,
  parseLabNumber,
  selectLabReference,
  stripVietnameseDiacritics,
  vietnamDayRange,
  type ClinicConfigReaderPort,
  type LabReferenceRow,
  type ParaclinicalItemStatus,
} from '@nexamed/core';
import {
  calculateAgeYears,
  type ListParaclinicalQueueQuery,
  type ListParaclinicalQueueResponse,
  type ParaclinicalQueueBucket,
  type ParaclinicalReference,
  type ParaclinicalResultForm,
  type ParaclinicalResultSection,
  type ParaclinicalResultValueView,
  type SaveParaclinicalResultRequest,
  type StartParaclinicalItemsRequest,
  type StartParaclinicalItemsResponse,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ClinicalOrderRepository, type QueueItemRow } from '../clinical-order/clinical-order.repository';
import { UserAccountRepository } from '../iam/user-account.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { TechnicalServiceRepository, type IndicatorLinkFullRow } from '../technical-service/technical-service.repository';
import { ParaclinicalResultRepository, type ResultValueData, type ResultWithValues } from './paraclinical-result.repository';

type Gender = 'male' | 'female' | 'other';

interface EnrichedItem {
  row: QueueItemRow;
  id: string;
  clinicalOrderId: string;
  serviceKind: 'LAB' | 'IMAGING' | 'FUNCTIONAL';
  status: ParaclinicalItemStatus;
  paid: boolean;
}

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';
const normalizeText = (v: string | null | undefined): string | null => (blank(v) ? null : (v as string).trim());

function toGender(raw: string): Gender | null {
  return raw === 'male' || raw === 'female' || raw === 'other' ? raw : null;
}

/** Dòng chỉ định đã thu tiền: dòng hoá đơn của chính nó (lẻ) hoặc của gói chứa nó, và MỌI dòng đó nằm trên hoá đơn `PAID`. */
function isPaid(row: QueueItemRow): boolean {
  const lines = row.clinicalOrderPackageId === null ? row.invoiceLines : (row.package?.invoiceLines ?? []);
  return lines.length > 0 && lines.every((l) => l.invoice.status === 'PAID');
}

function enrich(rows: QueueItemRow[]): EnrichedItem[] {
  return rows
    .filter((r) => r.technicalService !== null)
    .map((row) => ({
      row,
      id: row.id,
      clinicalOrderId: row.clinicalOrderId,
      serviceKind: row.technicalService!.serviceKind,
      status: row.status as ParaclinicalItemStatus,
      paid: isPaid(row),
    }));
}

function toReferenceRow(r: { sex: LabReferenceRow['sex']; ageFromYears: number; ageToYears: number | null; lowValue: number | null; highValue: number | null; lowInclusive: boolean; highInclusive: boolean; normalText: string | null; displayText: string | null }): LabReferenceRow {
  return {
    sex: r.sex,
    ageFromYears: r.ageFromYears,
    ageToYears: r.ageToYears,
    lowValue: r.lowValue,
    highValue: r.highValue,
    lowInclusive: r.lowInclusive,
    highInclusive: r.highInclusive,
    normalText: r.normalText,
    displayText: r.displayText,
  };
}

function choiceOptionsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Hàng đợi + thực hiện + nhập/duyệt kết quả cận lâm sàng (Cận lâm sàng GĐ4 đợt 1, docs/DECISIONS.md #212).
 * Luồng: ORDERED (đã thu tiền hoặc được phép thực hiện trước) → "Lấy mẫu / Gọi vào phòng" → IN_PROGRESS → nhập kết quả (nháp) → "Gửi duyệt" → RESULTED
 * → bác sĩ "Duyệt & trả kết quả" (ký) → COMPLETED. Xét nghiệm cùng phiếu + cùng trạng thái được GỘP thành 1 nhóm (một lần lấy mẫu, một màn nhập).
 */
@Injectable()
export class ParaclinicalResultService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly orderRepository: ClinicalOrderRepository,
    private readonly resultRepository: ParaclinicalResultRepository,
    private readonly technicalServiceRepository: TechnicalServiceRepository,
    private readonly userRepository: UserAccountRepository,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Hàng đợi
  // ---------------------------------------------------------------------------------------------

  async listQueue(tenantId: string, query: ListParaclinicalQueueQuery): Promise<ListParaclinicalQueueResponse> {
    const allowBeforePayment = await this.clinicConfigReader.getParaclinicalBeforePaymentEnabled(tenantId);
    const date = query.date ?? getVietnamDateString();
    const { startUtc, endUtc } = vietnamDayRange(date);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const items = enrich(await this.orderRepository.listQueueItems(tx, tenantId, { from: startUtc, to: endUtc }));
      const groups = groupQueueItems(items);

      const counts = Object.fromEntries(PARACLINICAL_QUEUE_BUCKETS.map((b) => [b, 0])) as Record<ParaclinicalQueueBucket, number>;
      const needle = query.q ? stripVietnameseDiacritics(query.q).toLowerCase() : null;
      const rows: ListParaclinicalQueueResponse['items'] = [];

      for (const group of groups) {
        const first = group[0]!;
        const bucket = deriveQueueBucket(first.status, first.paid, allowBeforePayment);
        if (bucket === null) continue;
        counts[bucket] += 1;
        if (query.bucket && query.bucket !== bucket) continue;

        const service = first.row.technicalService!;
        if (query.departmentId && service.departmentId !== query.departmentId) continue;

        const patient = first.row.order.encounter.patient;
        const serviceNames = group.map((g) => g.row.technicalService!.name);
        if (needle !== null) {
          const haystack = stripVietnameseDiacritics([patient.fullName, patient.patientCode, first.row.order.orderNo, ...serviceNames].join(' ')).toLowerCase();
          if (!haystack.includes(needle)) continue;
        }

        const waitingSince = first.status === 'IN_PROGRESS' && first.row.collectedAt ? first.row.collectedAt : first.row.order.createdAt;
        rows.push({
          key: first.id,
          itemIds: group.map((g) => g.id),
          orderNo: first.row.order.orderNo,
          encounterId: first.row.order.encounter.id,
          patientId: patient.id,
          patientName: patient.fullName,
          patientCode: patient.patientCode,
          ageYears: calculateAgeYears(patient.dob.toISOString()),
          gender: toGender(patient.gender),
          serviceKind: first.serviceKind,
          serviceNames,
          departmentId: service.department?.id ?? null,
          departmentName: service.department?.name ?? null,
          bucket,
          paid: group.every((g) => g.paid),
          waitingSince: waitingSince.toISOString(),
        });
      }

      // Tab "Đã trả kết quả": mới nhất lên đầu; các tab còn lại: chờ lâu nhất lên đầu.
      rows.sort((a, b) => (query.bucket === 'COMPLETED' ? b.waitingSince.localeCompare(a.waitingSince) : a.waitingSince.localeCompare(b.waitingSince)));
      return { items: rows, counts, allowBeforePayment };
    });
  }

  /** "Lấy mẫu" / "Gọi vào phòng": các dòng cùng phiếu ORDERED → IN_PROGRESS. */
  async startItems(tenantId: string, actorId: string, dto: StartParaclinicalItemsRequest, meta: RequestMeta): Promise<StartParaclinicalItemsResponse> {
    const allowBeforePayment = await this.clinicConfigReader.getParaclinicalBeforePaymentEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const ids = [...new Set(dto.itemIds)];
      const items = enrich(await this.orderRepository.findQueueItemsByIds(tx, tenantId, ids));
      if (items.length !== ids.length) throw new NotFoundException();
      const orderId = items[0]!.clinicalOrderId;
      if (items.some((i) => i.clinicalOrderId !== orderId)) throw new ParaclinicalItemInvalidStateError('Chỉ lấy mẫu / gọi vào phòng được các dịch vụ cùng một phiếu chỉ định.');
      await this.lockOrder(tx, tenantId, orderId);
      this.assertEncounterOpen(items[0]!);
      for (const item of items) {
        if (item.status !== 'ORDERED') throw new ParaclinicalItemInvalidStateError(`"${item.row.name}" không ở trạng thái chờ lấy mẫu / gọi vào phòng.`);
        if (!item.paid && !allowBeforePayment) throw new ParaclinicalPaymentRequiredError();
      }

      const count = await this.orderRepository.markStarted(tx, tenantId, ids, actorId, new Date());
      if (count !== ids.length) throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại hàng đợi.');

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'paraclinical.started',
        entityType: 'clinical_order',
        entityId: orderId,
        afterJson: { itemIds: ids, count },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { itemId: ids[0]! };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Màn nhập / duyệt kết quả
  // ---------------------------------------------------------------------------------------------

  async getForm(tenantId: string, actorId: string, itemId: string): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.buildForm(tx, tenantId, actorId, itemId));
  }

  /** Lưu nháp, hoặc gửi duyệt khi `dto.submit`. Người có quyền `enter` (không cần quyền duyệt). */
  async save(tenantId: string, actorId: string, itemId: string, dto: SaveParaclinicalResultRequest, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEditable(group);

      const results = await this.persistSections(tx, tenantId, actorId, group, dto, dto.submit);
      const ids = group.map((g) => g.id);
      if (dto.submit) {
        await this.orderRepository.transitionStatus(tx, tenantId, ids, ['IN_PROGRESS', 'RESULTED'], 'RESULTED', actorId);
      }
      for (const r of results) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: dto.submit ? 'paraclinical_result.submitted' : 'paraclinical_result.saved',
          entityType: 'paraclinical_result',
          entityId: r.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      return this.buildForm(tx, tenantId, actorId, itemId);
    });
  }

  /** "Duyệt & trả kết quả" (ký): lưu nội dung gửi kèm, kiểm đủ rồi ký mọi kết quả của nhóm trong CÙNG transaction. Người có quyền `approve`. */
  async approve(tenantId: string, actorId: string, itemId: string, dto: SaveParaclinicalResultRequest, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEditable(group);

      const results = await this.persistSections(tx, tenantId, actorId, group, dto, true);
      const signedAt = new Date();
      for (const r of results) {
        const signed = await this.resultRepository.sign(tx, tenantId, r.id, actorId, signedAt);
        if (signed !== 1) throw new ParaclinicalItemInvalidStateError('Kết quả đã được duyệt trước đó.');
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'paraclinical_result.approved',
          entityType: 'paraclinical_result',
          entityId: r.id,
          afterJson: { signedAt: signedAt.toISOString() },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      const ids = group.map((g) => g.id);
      const moved = await this.orderRepository.transitionStatus(tx, tenantId, ids, ['IN_PROGRESS', 'RESULTED'], 'COMPLETED', actorId);
      if (moved !== ids.length) throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
      return this.buildForm(tx, tenantId, actorId, itemId);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Nội bộ
  // ---------------------------------------------------------------------------------------------

  private async lockOrder(tx: Prisma.TransactionClient, tenantId: string, orderId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:paraclinical:${orderId}`}, 0))`;
  }

  private assertEncounterOpen(item: EnrichedItem): void {
    if (item.row.order.encounter.status === 'CANCELLED') throw new ParaclinicalItemInvalidStateError('Lượt khám đã huỷ — không thực hiện dịch vụ này được nữa.');
  }

  /** Nhập/sửa/gửi duyệt chỉ khi chưa duyệt xong (IN_PROGRESS hoặc RESULTED); kết quả đã duyệt là bản ký, chỉ đính chính (đợt sau). */
  private assertEditable(group: EnrichedItem[]): void {
    this.assertEncounterOpen(group[0]!);
    for (const item of group) {
      if (item.status === 'ORDERED') throw new ParaclinicalItemInvalidStateError('Chưa lấy mẫu / gọi vào phòng — thực hiện bước đó trước khi nhập kết quả.');
      if (item.status === 'COMPLETED') throw new ParaclinicalItemInvalidStateError('Kết quả đã duyệt là bản ký — không sửa trực tiếp được.');
    }
  }

  /** Nhóm dòng cùng màn nhập với `itemId`: xét nghiệm cùng phiếu + cùng trạng thái + cùng tình trạng thu tiền; dịch vụ khác loại thì đứng một mình. */
  private async resolveGroup(tx: Prisma.TransactionClient, tenantId: string, itemId: string): Promise<EnrichedItem[]> {
    const [anchor] = enrich(await this.orderRepository.findQueueItemsByIds(tx, tenantId, [itemId]));
    if (!anchor) throw new NotFoundException();
    if (anchor.status === 'CANCELLED') throw new NotFoundException();
    if (anchor.serviceKind !== 'LAB') return [anchor];
    const siblings = enrich(await this.orderRepository.findQueueItemsByOrder(tx, tenantId, anchor.clinicalOrderId));
    return siblings.filter((s) => s.serviceKind === 'LAB' && s.status === anchor.status && s.paid === anchor.paid);
  }

  private patientContext(item: EnrichedItem): { gender: Gender | null; ageYears: number | null } {
    const patient = item.row.order.encounter.patient;
    return { gender: toGender(patient.gender), ageYears: calculateAgeYears(patient.dob.toISOString()) };
  }

  private async buildForm(tx: Prisma.TransactionClient, tenantId: string, actorId: string, itemId: string): Promise<ParaclinicalResultForm> {
    const group = await this.resolveGroup(tx, tenantId, itemId);
    const first = group[0]!;
    if (first.status === 'ORDERED') throw new ParaclinicalItemInvalidStateError('Chưa lấy mẫu / gọi vào phòng — thực hiện bước đó trước khi nhập kết quả.');
    const ctx = this.patientContext(first);
    const patient = first.row.order.encounter.patient;

    const serviceIds = [...new Set(group.map((g) => g.row.technicalServiceId!))];
    const [links, results] = await Promise.all([
      this.technicalServiceRepository.listIndicatorLinksFull(tx, tenantId, serviceIds),
      this.resultRepository.findActiveByItemIds(tx, tenantId, group.map((g) => g.id)),
    ]);
    const linksByService = new Map<string, IndicatorLinkFullRow[]>();
    for (const link of links) {
      const list = linksByService.get(link.technicalServiceId) ?? [];
      list.push(link);
      linksByService.set(link.technicalServiceId, list);
    }
    const resultByItem = new Map(results.map((r) => [r.clinicalOrderItemId, r]));

    const sections: ParaclinicalResultSection[] = [];
    for (const item of group) {
      const service = item.row.technicalService!;
      const result = resultByItem.get(item.id) ?? null;
      const specimen = service.specimenTypeCode ? await this.referenceCatalogRepository.findByCategoryAndCode(tx, 'SPECIMEN_TYPE', service.specimenTypeCode) : null;
      sections.push({
        itemId: item.id,
        technicalServiceId: service.id,
        code: item.row.code,
        name: item.row.name,
        serviceKind: service.serviceKind,
        resultType: service.resultType,
        specimenTypeName: specimen?.name ?? null,
        departmentName: service.department?.name ?? null,
        status: item.status,
        indicators: this.buildIndicatorViews(linksByService.get(service.id) ?? [], result, ctx),
        descriptionText: result?.descriptionText ?? null,
        conclusionText: result?.conclusionText ?? null,
      });
    }

    const signed = results.find((r) => r.signedAt !== null) ?? null;
    const any = results[0] ?? null;
    const approverRows = await this.userRepository.listActiveUsersWithPermission(tx, tenantId, 'paraclinical_result', 'approve');
    const nameIds = [actorId, first.row.order.encounter.doctorId, any?.performedBy, signed?.signedBy].filter((x): x is string => typeof x === 'string');
    const names = new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, [...new Set(nameIds)])).map((u) => [u.id, u.fullName]));
    const performedById = any?.performedBy ?? actorId;

    return {
      orderNo: first.row.order.orderNo,
      encounterId: first.row.order.encounter.id,
      encounterNo: first.row.order.encounter.encounterNo,
      patientName: patient.fullName,
      patientCode: patient.patientCode,
      patientGender: ctx.gender,
      ageYears: ctx.ageYears,
      doctorName: first.row.order.encounter.doctorId ? (names.get(first.row.order.encounter.doctorId) ?? null) : null,
      collectedAt: first.row.collectedAt?.toISOString() ?? null,
      bucket: deriveQueueBucket(first.status, first.paid, true) as ParaclinicalQueueBucket,
      sections,
      performedById,
      performedByName: names.get(performedById) ?? null,
      resultedAt: any?.resultedAt?.toISOString() ?? null,
      approverId: any?.approverId ?? null,
      approvers: approverRows.map((u) => ({ id: u.id, fullName: u.displayName ?? u.fullName })),
      signedAt: signed?.signedAt?.toISOString() ?? null,
      signedByName: signed?.signedBy ? (names.get(signed.signedBy) ?? null) : null,
    };
  }

  /**
   * Danh sách chỉ số của một dịch vụ. Bản NHÁP/chưa có kết quả: theo định nghĩa HIỆN TẠI, khoảng tham chiếu chọn lại theo giới tính × tuổi bệnh nhân.
   * Bản ĐÃ DUYỆT: lấy nguyên các dòng đã lưu (tên/đơn vị/khoảng tham chiếu đã chụp lại) — in lại sau này không đổi dù danh mục bị sửa.
   */
  private buildIndicatorViews(links: IndicatorLinkFullRow[], result: ResultWithValues | null, ctx: { gender: Gender | null; ageYears: number | null }): ParaclinicalResultValueView[] {
    const signed = result?.signedAt != null;
    if (signed && result) {
      return result.values.map((v) => {
        const reference = (v.referenceSnapshot as ParaclinicalReference | null) ?? null;
        const row = reference ? toReferenceRow(reference) : null;
        return {
          indicatorId: v.labIndicatorId,
          code: v.indicatorCode,
          name: v.indicatorName,
          abbreviation: v.abbreviation,
          unit: v.unit,
          valueType: v.valueType,
          decimals: v.decimals,
          choiceOptions: [],
          reference,
          referenceText: formatLabReferenceText(row, v.decimals),
          valueText: v.valueText,
          note: v.note,
          interpretationText: v.interpretationText,
          flag: !blank(v.valueText) ? evaluateLabValue(v.valueType, v.valueText as string, row) : null,
        };
      });
    }

    const stored = new Map<string, ParaclinicalResultValue>((result?.values ?? []).map((v) => [v.labIndicatorId, v]));
    return links.map((link) => {
      const indicator = link.indicator;
      const row = selectLabReference(indicator.references.map(toReferenceRow), ctx);
      const current = stored.get(indicator.id);
      const valueText = current?.valueText ?? null;
      return {
        indicatorId: indicator.id,
        code: indicator.code,
        name: indicator.name,
        abbreviation: indicator.abbreviation,
        unit: indicator.unit,
        valueType: indicator.valueType,
        decimals: indicator.decimals,
        choiceOptions: choiceOptionsOf(indicator.choiceOptions),
        reference: row,
        referenceText: formatLabReferenceText(row, indicator.decimals),
        valueText,
        note: current?.note ?? null,
        interpretationText: link.interpretationText,
        flag: !blank(valueText) ? evaluateLabValue(indicator.valueType, valueText as string, row) : null,
      };
    });
  }

  /**
   * Ghi nội dung các mục gửi lên vào `paraclinical_result` (+ giá trị chỉ số). `strict` = gửi duyệt/duyệt: kiểm kết quả đã ĐỦ (mọi dịch vụ của nhóm phải có mặt
   * trong request). Trả danh sách kết quả của cả nhóm (đã tạo nếu chưa có).
   */
  private async persistSections(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    group: EnrichedItem[],
    dto: SaveParaclinicalResultRequest,
    strict: boolean,
  ): Promise<{ id: string }[]> {
    const byItem = new Map(group.map((g) => [g.id, g]));
    const seen = new Set<string>();
    for (const section of dto.sections) {
      if (!byItem.has(section.itemId) || seen.has(section.itemId)) throw new ParaclinicalItemInvalidStateError('Mục kết quả không thuộc nhóm đang nhập hoặc bị trùng.');
      seen.add(section.itemId);
    }
    if (strict && seen.size !== group.length) throw new ParaclinicalResultIncompleteError('Thiếu kết quả của một số dịch vụ trong nhóm — nhập đủ rồi mới gửi duyệt/duyệt.');

    const ctx = this.patientContext(group[0]!);
    const serviceIds = [...new Set(group.map((g) => g.row.technicalServiceId!))];
    const links = await this.technicalServiceRepository.listIndicatorLinksFull(tx, tenantId, serviceIds);
    const linksByService = new Map<string, IndicatorLinkFullRow[]>();
    for (const link of links) {
      const list = linksByService.get(link.technicalServiceId) ?? [];
      list.push(link);
      linksByService.set(link.technicalServiceId, list);
    }
    const existing = new Map((await this.resultRepository.findActiveByItemIds(tx, tenantId, group.map((g) => g.id))).map((r) => [r.clinicalOrderItemId, r]));
    const resultedAt = dto.resultedAt ? new Date(dto.resultedAt) : new Date();
    const approverId = dto.approverId ?? null;

    const out: { id: string }[] = [];
    const problems: string[] = [];
    for (const section of dto.sections) {
      const item = byItem.get(section.itemId)!;
      const service = item.row.technicalService!;
      const wantsIndicators = service.resultType === 'INDICATORS' || service.resultType === 'BOTH';
      const wantsNarrative = service.resultType === 'NARRATIVE' || service.resultType === 'BOTH';
      const serviceLinks = wantsIndicators ? (linksByService.get(service.id) ?? []) : [];

      const inputByIndicator = new Map(section.values.map((v) => [v.indicatorId, v]));
      for (const id of inputByIndicator.keys()) {
        if (!serviceLinks.some((l) => l.indicatorId === id)) throw new ParaclinicalItemInvalidStateError('Có chỉ số không thuộc dịch vụ này.');
      }

      const valueData: ResultValueData[] = serviceLinks.map((link, index) => {
        const indicator = link.indicator;
        const input = inputByIndicator.get(indicator.id);
        const row = selectLabReference(indicator.references.map(toReferenceRow), ctx);
        return {
          labIndicatorId: indicator.id,
          indicatorCode: indicator.code,
          indicatorName: indicator.name,
          abbreviation: indicator.abbreviation,
          unit: indicator.unit,
          valueType: indicator.valueType,
          decimals: indicator.decimals,
          valueText: normalizeText(input?.valueText),
          note: normalizeText(input?.note),
          interpretationText: link.interpretationText,
          referenceSnapshot: row as unknown as Prisma.InputJsonObject | null,
          sortOrder: index,
        };
      });

      const descriptionText = wantsNarrative ? normalizeText(section.descriptionText) : null;
      // Nhận xét/kết luận của người thực hiện lưu ở MỌI loại dịch vụ (xét nghiệm cũng có "Nhận xét"); chỉ NARRATIVE/BOTH mới BẮT BUỘC (xem checkParaclinicalSectionComplete).
      const conclusionText = normalizeText(section.conclusionText);

      if (strict) {
        problems.push(
          ...checkParaclinicalSectionComplete({
            serviceName: item.row.name,
            resultType: service.resultType,
            indicators: serviceLinks.map((l, i) => ({ name: l.indicator.name, valueType: l.indicator.valueType, choiceOptions: choiceOptionsOf(l.indicator.choiceOptions), valueText: valueData[i]!.valueText })),
            descriptionText,
            conclusionText,
          }),
        );
      } else {
        // Bản nháp vẫn không được lưu giá trị SỐ sai định dạng (tránh dữ liệu rác) — chỉ báo lỗi, không bắt phải đủ.
        for (const v of valueData) {
          if (v.valueType === 'NUMBER' && v.valueText !== null && parseLabNumber(v.valueText) === null) problems.push(`"${item.row.name}" — ${v.indicatorName}: "${v.valueText}" không phải số hợp lệ.`);
        }
      }

      const current = existing.get(item.id);
      const base = { descriptionText, conclusionText, performedBy: actorId, resultedAt, approverId };
      let resultId: string;
      if (current) {
        if (current.signedAt !== null) throw new ParaclinicalItemInvalidStateError('Kết quả đã duyệt là bản ký — không sửa trực tiếp được.');
        const updated = await this.resultRepository.updateDraft(tx, tenantId, current.id, actorId, base);
        if (updated !== 1) throw new ParaclinicalItemInvalidStateError('Kết quả vừa được người khác duyệt — tải lại.');
        resultId = current.id;
        if (problems.length === 0) await this.resultRepository.upsertValues(tx, tenantId, actorId, resultId, current.values, valueData);
      } else {
        const created = await this.resultRepository.createResult(tx, tenantId, actorId, { clinicalOrderItemId: item.id, ...base });
        resultId = created.id;
        if (problems.length === 0) await this.resultRepository.upsertValues(tx, tenantId, actorId, resultId, [], valueData);
      }
      out.push({ id: resultId });
    }

    if (problems.length > 0) throw new ParaclinicalResultIncompleteError(problems.join(' '));
    return out;
  }
}
