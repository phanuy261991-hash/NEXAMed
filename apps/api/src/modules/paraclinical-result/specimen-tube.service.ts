import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CLINIC_CONFIG_READER_PORT,
  canRecollectSpecimenTube,
  canSplitSpecimenTube,
  canUncollectSpecimenTube,
  deriveQueueBucket,
  joinGroupAbbreviations,
  normalizeScannedSid,
  ParaclinicalItemInvalidStateError,
  ParaclinicalPaymentRequiredError,
  planSpecimenTubes,
  SpecimenScanRequiredError,
  SpecimenTubeInvalidStateError,
  type ClinicConfigReaderPort,
} from '@nexamed/core';
import {
  calculateAgeYears,
  specimenCapLabel,
  type CollectSpecimenTubesRequest,
  type LookupSpecimenTubeResponse,
  type PrintSpecimenTubesRequest,
  type RecollectSpecimenTubeRequest,
  type SpecimenCollectionState,
  type SpecimenTubeView,
  type SplitSpecimenTubeRequest,
  type UncollectSpecimenTubesRequest,
} from '@nexamed/shared';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { BusinessCodeService } from '../clinic/business-code.service';
import { ClinicalOrderRepository } from '../clinical-order/clinical-order.repository';
import { UserAccountRepository } from '../iam/user-account.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { asCapColor, enrich, toGender, type EnrichedItem } from './paraclinical-item.helpers';
import type { ResultAccessScope } from './paraclinical-result.service';
import { SpecimenTubeRepository, type TubeRow } from './specimen-tube.repository';

/**
 * Lấy mẫu xét nghiệm có ống mẫu, mã ống (SID) và tem mã vạch (docs/DECISIONS.md #220). Mọi thao tác chạy trong 1 transaction, khoá theo phiếu chỉ định (cùng khoá với
 * `ParaclinicalResultService`) để lấy mẫu / nhập kết quả không ghi chồng nhau, và trả lại ĐÚNG trạng thái hộp thoại để web vẽ lại. Phạm vi Khoa/Phòng như hàng đợi (ngoài phạm vi → 404).
 */
@Injectable()
export class SpecimenTubeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly orderRepository: ClinicalOrderRepository,
    private readonly tubeRepository: SpecimenTubeRepository,
    private readonly userRepository: UserAccountRepository,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Hộp thoại "Lấy mẫu"
  // ---------------------------------------------------------------------------------------------

  /**
   * Mở hộp thoại lấy mẫu của một phiếu: SINH ỐNG (kèm SID) cho các xét nghiệm chưa có ống. Idempotent — mở lại không đẻ thêm ống; xét nghiệm mới thêm vào phiếu sau đó gộp vào
   * ống PENDING chưa in tem cùng loại mẫu, không thì tạo ống mới. Ống PENDING không còn xét nghiệm nào (bị huỷ chỉ định) tự đóng.
   */
  async open(tenantId: string, actorId: string, scope: ResultAccessScope, orderId: string, meta: RequestMeta): Promise<SpecimenCollectionState> {
    const scanRequired = await this.clinicConfigReader.getSpecimenScanRequired(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.lockOrder(tx, tenantId, orderId);
      const items = await this.scopedLabItems(tx, tenantId, actorId, scope, orderId);
      this.assertEncounterOpen(items[0]!);

      const tubes = await this.tubeRepository.findByOrder(tx, tenantId, orderId);
      for (const tube of tubes) {
        if (tube.status === 'PENDING' && tube.items.length === 0) {
          await this.tubeRepository.cancel(tx, tenantId, tube.id, actorId, 'Không còn xét nghiệm nào trong ống');
        }
      }
      const livePending = tubes.filter((t) => t.status === 'PENDING' && t.items.length > 0);
      const unassigned = items.filter((i) => i.status === 'ORDERED' && i.row.specimenTubeId === null);
      const plan = planSpecimenTubes(
        unassigned.map((i) => ({ itemId: i.id, specimenTypeCode: i.row.technicalService?.specimenTypeCode ?? null })),
        livePending.map((t) => ({ id: t.id, specimenTypeCode: t.specimenTypeCode, printCount: t.printCount })),
      );
      for (const { itemId, tubeId } of plan.attach) await this.orderRepository.setSpecimenTube(tx, tenantId, [itemId], tubeId, actorId);
      for (const planned of plan.create) {
        const catalog = planned.specimenTypeCode ? await this.referenceCatalogRepository.findByCategoryAndCode(tx, 'SPECIMEN_TYPE', planned.specimenTypeCode) : null;
        const tube = await this.createTube(tx, tenantId, actorId, orderId, {
          specimenTypeCode: planned.specimenTypeCode,
          specimenName: catalog?.name ?? null,
          capColor: catalog?.capColor ?? null,
        });
        await this.orderRepository.setSpecimenTube(tx, tenantId, planned.itemIds, tube.id, actorId);
        await this.audit(tx, tenantId, actorId, 'specimen_tube.created', tube.id, { sid: tube.sid, clinicalOrderId: orderId, itemCount: planned.itemIds.length }, meta);
      }
      return this.buildState(tx, tenantId, actorId, scope, orderId, scanRequired);
    });
  }

  /** "Tách" 1 xét nghiệm sang ống riêng (ống mới có SID mới) — chỉ khi ống chưa in tem, còn chờ lấy và còn > 1 xét nghiệm. */
  async split(tenantId: string, actorId: string, scope: ResultAccessScope, tubeId: string, dto: SplitSpecimenTubeRequest, meta: RequestMeta): Promise<SpecimenCollectionState> {
    const scanRequired = await this.clinicConfigReader.getSpecimenScanRequired(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [tube] = await this.loadTubes(tx, tenantId, actorId, scope, [tubeId]);
      const orderId = tube!.clinicalOrderId;
      await this.lockOrder(tx, tenantId, orderId);
      const fresh = (await this.tubeRepository.findByIds(tx, tenantId, [tubeId]))[0];
      if (!fresh) throw new NotFoundException();
      if (!canSplitSpecimenTube(fresh, fresh.items.length)) {
        throw new SpecimenTubeInvalidStateError('Chỉ tách được khi ống chưa in tem, chưa lấy và còn nhiều hơn 1 xét nghiệm.');
      }
      if (!fresh.items.some((i) => i.id === dto.itemId)) throw new NotFoundException();

      const created = await this.createTube(tx, tenantId, actorId, orderId, { specimenTypeCode: fresh.specimenTypeCode, specimenName: fresh.specimenName, capColor: fresh.capColor });
      await this.orderRepository.setSpecimenTube(tx, tenantId, [dto.itemId], created.id, actorId);
      await this.audit(tx, tenantId, actorId, 'specimen_tube.split', created.id, { sid: created.sid, fromTubeId: tubeId, itemId: dto.itemId }, meta);
      return this.buildState(tx, tenantId, actorId, scope, orderId, scanRequired);
    });
  }

  /** Ghi nhận in tem (web tự dựng tem từ dữ liệu đã tải rồi gọi hộp thoại in của trình duyệt) — tăng số lần in, nhớ giờ/người in cuối. */
  async print(tenantId: string, actorId: string, scope: ResultAccessScope, dto: PrintSpecimenTubesRequest, meta: RequestMeta): Promise<SpecimenCollectionState> {
    const scanRequired = await this.clinicConfigReader.getSpecimenScanRequired(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const ids = [...new Set(dto.tubeIds)];
      const tubes = await this.loadTubes(tx, tenantId, actorId, scope, ids);
      const orderId = tubes[0]!.clinicalOrderId;
      await this.lockOrder(tx, tenantId, orderId);
      for (const tube of tubes) {
        if (tube.status === 'CANCELLED') throw new SpecimenTubeInvalidStateError(`Ống ${tube.sid} đã huỷ — không in tem được.`);
      }
      const now = new Date();
      const count = await this.tubeRepository.markPrinted(tx, tenantId, ids, actorId, now);
      if (count !== ids.length) throw new SpecimenTubeInvalidStateError('Ống vừa được người khác xử lý — tải lại.');
      for (const tube of tubes) await this.audit(tx, tenantId, actorId, 'specimen_tube.printed', tube.id, { sid: tube.sid, printCount: tube.printCount + 1 }, meta);
      return this.buildState(tx, tenantId, actorId, scope, orderId, scanRequired);
    });
  }

  /**
   * Xác nhận đã lấy mẫu THEO TỪNG ỐNG: ống PENDING → COLLECTED (giờ + người + cách xác nhận) và các dòng xét nghiệm của ống `ORDERED → IN_PROGRESS` ("Đã lấy mẫu"). Ống chưa chọn ở lại
   * "Chờ lấy mẫu". Chưa thu tiền thì chặn (trừ khi phòng khám bật "thực hiện trước khi thu tiền"); bật "Bắt buộc quét đủ ống" thì từ chối `via=MANUAL`.
   */
  async collect(tenantId: string, actorId: string, scope: ResultAccessScope, dto: CollectSpecimenTubesRequest, meta: RequestMeta): Promise<SpecimenCollectionState> {
    const [scanRequired, allowBeforePayment] = await Promise.all([
      this.clinicConfigReader.getSpecimenScanRequired(tenantId),
      this.clinicConfigReader.getParaclinicalBeforePaymentEnabled(tenantId),
    ]);
    if (scanRequired && dto.tubes.some((t) => t.via === 'MANUAL')) throw new SpecimenScanRequiredError();
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const viaOf = new Map(dto.tubes.map((t) => [t.tubeId, t.via]));
      const tubes = await this.loadTubes(tx, tenantId, actorId, scope, [...viaOf.keys()]);
      const orderId = tubes[0]!.clinicalOrderId;
      await this.lockOrder(tx, tenantId, orderId);
      const fresh = await this.tubeRepository.findByIds(tx, tenantId, tubes.map((t) => t.id));
      const at = new Date();
      for (const tube of fresh) {
        if (tube.status !== 'PENDING') throw new SpecimenTubeInvalidStateError(`Ống ${tube.sid} không ở trạng thái chờ lấy mẫu.`);
        if (tube.items.length === 0) throw new SpecimenTubeInvalidStateError(`Ống ${tube.sid} không còn xét nghiệm nào.`);
        const itemIds = tube.items.map((i) => i.id);
        const enriched = enrich(await this.orderRepository.findQueueItemsByIds(tx, tenantId, itemIds));
        this.assertEncounterOpen(enriched[0]!);
        for (const item of enriched) {
          if (item.status !== 'ORDERED') throw new ParaclinicalItemInvalidStateError(`"${item.row.name}" không ở trạng thái chờ lấy mẫu.`);
          if (!item.paid && !allowBeforePayment) throw new ParaclinicalPaymentRequiredError();
        }
        const via = viaOf.get(tube.id)!;
        if ((await this.tubeRepository.markCollected(tx, tenantId, tube.id, actorId, at, via)) !== 1) {
          throw new SpecimenTubeInvalidStateError('Ống vừa được người khác xử lý — tải lại.');
        }
        if ((await this.orderRepository.markStarted(tx, tenantId, itemIds, actorId, at)) !== itemIds.length) {
          throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
        }
        await this.audit(tx, tenantId, actorId, 'specimen_tube.collected', tube.id, { sid: tube.sid, via, collectedAt: at.toISOString() }, meta);
      }
      return this.buildState(tx, tenantId, actorId, scope, orderId, scanRequired);
    });
  }

  /**
   * "Huỷ ống & lấy lại mẫu": ống cũ giữ ở `CANCELLED` kèm lý do (truy vết), sinh ống MỚI (SID mới, `replaces` trỏ ống cũ) nhận các xét nghiệm. Ống đã lấy thì xét nghiệm trở lại
   * "Chờ lấy mẫu". Chỉ khi các xét nghiệm trong ống chưa có kết quả nào.
   */
  async recollect(tenantId: string, actorId: string, scope: ResultAccessScope, tubeId: string, dto: RecollectSpecimenTubeRequest, meta: RequestMeta): Promise<SpecimenCollectionState> {
    const scanRequired = await this.clinicConfigReader.getSpecimenScanRequired(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [loaded] = await this.loadTubes(tx, tenantId, actorId, scope, [tubeId]);
      const orderId = loaded!.clinicalOrderId;
      await this.lockOrder(tx, tenantId, orderId);
      const tube = (await this.tubeRepository.findByIds(tx, tenantId, [tubeId]))[0];
      if (!tube) throw new NotFoundException();
      if (!canRecollectSpecimenTube(tube, tube.items.some((i) => i.results.length > 0))) {
        throw new SpecimenTubeInvalidStateError('Không huỷ ống được: ống đã huỷ hoặc xét nghiệm trong ống đã có kết quả.');
      }
      const itemIds = tube.items.map((i) => i.id);
      if (tube.status === 'COLLECTED' && (await this.orderRepository.revertToOrdered(tx, tenantId, itemIds, actorId)) !== itemIds.length) {
        throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
      }
      if ((await this.tubeRepository.cancel(tx, tenantId, tube.id, actorId, dto.reason)) !== 1) throw new SpecimenTubeInvalidStateError('Ống vừa được người khác xử lý — tải lại.');
      const replacement = await this.createTube(tx, tenantId, actorId, orderId, {
        specimenTypeCode: tube.specimenTypeCode,
        specimenName: tube.specimenName,
        capColor: tube.capColor,
        replacesTubeId: tube.id,
      });
      await this.orderRepository.setSpecimenTube(tx, tenantId, itemIds, replacement.id, actorId);
      await this.audit(tx, tenantId, actorId, 'specimen_tube.recollected', tube.id, { sid: tube.sid, newSid: replacement.sid, reason: dto.reason, wasCollected: tube.status === 'COLLECTED' }, meta);
      return this.buildState(tx, tenantId, actorId, scope, orderId, scanRequired);
    });
  }

  /** "Huỷ xác nhận đã lấy mẫu": trả các ống đã lấy về "Chờ lấy mẫu" (ống `COLLECTED → PENDING`, xét nghiệm `IN_PROGRESS → ORDERED`) kèm lý do — chỉ khi chưa có kết quả nào. */
  async uncollect(tenantId: string, actorId: string, scope: ResultAccessScope, dto: UncollectSpecimenTubesRequest, meta: RequestMeta): Promise<SpecimenCollectionState> {
    const scanRequired = await this.clinicConfigReader.getSpecimenScanRequired(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const ids = [...new Set(dto.tubeIds)];
      const loaded = await this.loadTubes(tx, tenantId, actorId, scope, ids);
      const orderId = loaded[0]!.clinicalOrderId;
      await this.lockOrder(tx, tenantId, orderId);
      const tubes = await this.tubeRepository.findByIds(tx, tenantId, ids);
      for (const tube of tubes) {
        if (!canUncollectSpecimenTube(tube, tube.items.some((i) => i.results.length > 0))) {
          throw new SpecimenTubeInvalidStateError(`Không huỷ xác nhận được ống ${tube.sid}: ống chưa lấy hoặc xét nghiệm đã có kết quả (kể cả bản nháp).`);
        }
        const itemIds = tube.items.map((i) => i.id);
        if ((await this.tubeRepository.revertCollected(tx, tenantId, tube.id, actorId)) !== 1) throw new SpecimenTubeInvalidStateError('Ống vừa được người khác xử lý — tải lại.');
        if ((await this.orderRepository.revertToOrdered(tx, tenantId, itemIds, actorId)) !== itemIds.length) {
          throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
        }
        await this.audit(tx, tenantId, actorId, 'specimen_tube.uncollected', tube.id, { sid: tube.sid, reason: dto.reason }, meta);
      }
      return this.buildState(tx, tenantId, actorId, scope, orderId, scanRequired);
    });
  }

  /** Tra mã ống (ô "Quét mã ống" ở hàng đợi và trong hộp thoại). 404 khi không có mã hoặc ngoài phạm vi Khoa/Phòng. */
  async lookup(tenantId: string, actorId: string, scope: ResultAccessScope, rawSid: string): Promise<LookupSpecimenTubeResponse> {
    const sid = normalizeScannedSid(rawSid);
    if (sid === '') throw new NotFoundException();
    const allowBeforePayment = await this.clinicConfigReader.getParaclinicalBeforePaymentEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const tube = await this.tubeRepository.findBySid(tx, tenantId, sid);
      if (!tube) throw new NotFoundException();
      const items = await this.scopedLabItems(tx, tenantId, actorId, scope, tube.clinicalOrderId);
      const order = items[0]!.row.order;
      const tubeItemIds = new Set(tube.items.map((i) => i.id));
      const inTube = items.filter((i) => tubeItemIds.has(i.id));
      const first = inTube[0];
      const replacedBy = tube.status === 'CANCELLED' ? await this.tubeRepository.findReplacementSid(tx, tenantId, tube.id) : null;
      return {
        tubeId: tube.id,
        sid: tube.sid,
        status: tube.status,
        orderId: order.id,
        orderNo: order.orderNo,
        patientName: order.encounter.patient.fullName,
        patientCode: order.encounter.patient.patientCode,
        bucket: first ? deriveQueueBucket(first.status, first.paid, allowBeforePayment) : null,
        itemId: tube.status === 'COLLECTED' && first ? first.id : null,
        replacedBySid: replacedBy?.sid ?? null,
        encounterCancelled: order.encounter.status === 'CANCELLED',
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Nội bộ
  // ---------------------------------------------------------------------------------------------

  private async createTube(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    orderId: string,
    snapshot: { specimenTypeCode: string | null; specimenName: string | null; capColor: string | null; replacesTubeId?: string | null },
  ): Promise<{ id: string; sid: string }> {
    const sid = await this.businessCodeService.generate(tx, tenantId, actorId, 'SPECIMEN_TUBE', new Date());
    return this.tubeRepository.create(tx, tenantId, actorId, { clinicalOrderId: orderId, sid, ...snapshot });
  }

  private async audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, action: string, tubeId: string, afterJson: Prisma.InputJsonObject, meta: RequestMeta): Promise<void> {
    await writeAuditLog(tx, tenantId, { actorId, action, entityType: 'specimen_tube', entityId: tubeId, afterJson, ip: meta.ip, userAgent: meta.userAgent });
  }

  /** Cùng khoá với `ParaclinicalResultService.lockOrder` — lấy mẫu và nhập kết quả của một phiếu không ghi chồng nhau. */
  private async lockOrder(tx: Prisma.TransactionClient, tenantId: string, orderId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:paraclinical:${orderId}`}, 0))`;
  }

  private assertEncounterOpen(item: EnrichedItem): void {
    if (item.row.order.encounter.status === 'CANCELLED') throw new ParaclinicalItemInvalidStateError('Lượt khám đã huỷ — không lấy mẫu được nữa.');
  }

  /** `undefined` = không giới hạn Khoa/Phòng; `null` = scope `department` mà tài khoản chưa gán phòng (không khớp phòng nào); chuỗi = Khoa/Phòng của tài khoản. */
  private async resolveScopeDepartment(tx: Prisma.TransactionClient, tenantId: string, actorId: string, scope: ResultAccessScope): Promise<string | null | undefined> {
    if (scope.dataScope !== 'department') return undefined;
    return this.userRepository.findDepartmentId(tx, tenantId, actorId);
  }

  /** Các dòng xét nghiệm (LAB) còn hiệu lực của phiếu mà tài khoản được phép thấy; không còn dòng nào → 404 (không lộ sự tồn tại). */
  private async scopedLabItems(tx: Prisma.TransactionClient, tenantId: string, actorId: string, scope: ResultAccessScope, orderId: string): Promise<EnrichedItem[]> {
    const all = enrich(await this.orderRepository.findQueueItemsByOrder(tx, tenantId, orderId)).filter((i) => i.serviceKind === 'LAB');
    const departmentId = await this.resolveScopeDepartment(tx, tenantId, actorId, scope);
    const visible = departmentId === undefined ? all : all.filter((i) => departmentId !== null && i.row.technicalService?.departmentId === departmentId);
    if (visible.length === 0) throw new NotFoundException();
    return visible;
  }

  /** Nạp ống theo id: phải cùng MỘT phiếu và nằm trong phạm vi Khoa/Phòng (ngoài phạm vi / không có → 404). */
  private async loadTubes(tx: Prisma.TransactionClient, tenantId: string, actorId: string, scope: ResultAccessScope, tubeIds: string[]): Promise<TubeRow[]> {
    const ids = [...new Set(tubeIds)];
    const tubes = await this.tubeRepository.findByIds(tx, tenantId, ids);
    if (tubes.length !== ids.length) throw new NotFoundException();
    const orderId = tubes[0]!.clinicalOrderId;
    if (tubes.some((t) => t.clinicalOrderId !== orderId)) throw new SpecimenTubeInvalidStateError('Chỉ thao tác được các ống cùng một phiếu chỉ định.');
    await this.scopedLabItems(tx, tenantId, actorId, scope, orderId);
    return tubes;
  }

  private async buildState(tx: Prisma.TransactionClient, tenantId: string, actorId: string, scope: ResultAccessScope, orderId: string, scanRequired: boolean): Promise<SpecimenCollectionState> {
    const items = await this.scopedLabItems(tx, tenantId, actorId, scope, orderId);
    const order = items[0]!.row.order;
    const encounter = order.encounter;
    const patient = encounter.patient;
    const tubes = await this.tubeRepository.findByOrder(tx, tenantId, orderId);
    const visibleTubes = tubes.filter((t) => t.status === 'CANCELLED' || t.items.length > 0);

    const sidById = new Map(tubes.map((t) => [t.id, t.sid]));
    const replacedBySid = new Map<string, string>();
    for (const t of tubes) if (t.replacesTubeId) replacedBySid.set(t.replacesTubeId, t.sid);

    const userIds = [...new Set([encounter.doctorId, ...visibleTubes.map((t) => t.collectedBy)].filter((v): v is string => v !== null))];
    const names = new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, userIds)).map((u) => [u.id, u.fullName]));

    const abbreviationCache = new Map<string, string | null>();
    const abbreviationOf = async (code: string | null | undefined): Promise<string | null> => {
      if (!code) return null;
      if (!abbreviationCache.has(code)) abbreviationCache.set(code, (await this.referenceCatalogRepository.findByCategoryAndCode(tx, 'TECH_SERVICE_CATEGORY', code))?.abbreviation ?? null);
      return abbreviationCache.get(code)!;
    };

    const views: SpecimenTubeView[] = [];
    for (const tube of visibleTubes) {
      const hasAnyResult = tube.items.some((i) => i.results.length > 0);
      const capColor = asCapColor(tube.capColor);
      views.push({
        id: tube.id,
        sid: tube.sid,
        status: tube.status,
        specimenName: tube.specimenName,
        capColor,
        capLabel: specimenCapLabel(capColor),
        groupAbbreviation: joinGroupAbbreviations(await Promise.all(tube.items.map((i) => abbreviationOf(i.technicalService?.categoryCode)))),
        printCount: tube.printCount,
        lastPrintedAt: tube.lastPrintedAt?.toISOString() ?? null,
        collectedAt: tube.collectedAt?.toISOString() ?? null,
        collectedByName: tube.collectedBy ? (names.get(tube.collectedBy) ?? null) : null,
        collectedVia: tube.collectedVia,
        cancelReason: tube.cancelReason,
        cancelledAt: tube.status === 'CANCELLED' ? tube.updatedAt.toISOString() : null,
        replacesSid: tube.replacesTubeId ? (sidById.get(tube.replacesTubeId) ?? null) : null,
        replacedBySid: replacedBySid.get(tube.id) ?? null,
        items: tube.items.map((i) => ({ itemId: i.id, name: i.name, canSplit: canSplitSpecimenTube(tube, tube.items.length) })),
        canRecollect: canRecollectSpecimenTube(tube, hasAnyResult),
        canUncollect: canUncollectSpecimenTube(tube, hasAnyResult),
      });
    }

    return {
      orderId,
      orderNo: order.orderNo,
      encounterId: encounter.id,
      encounterNo: encounter.encounterNo ?? null,
      patientName: patient.fullName,
      patientCode: patient.patientCode,
      patientBirthYear: Number.isNaN(patient.dob.getTime()) ? null : patient.dob.getUTCFullYear(),
      patientAgeYears: calculateAgeYears(patient.dob.toISOString()),
      patientGender: toGender(patient.gender),
      patientPhone: patient.phone ?? null,
      doctorName: encounter.doctorId ? (names.get(encounter.doctorId) ?? null) : null,
      orderedAt: order.createdAt.toISOString(),
      paid: items.every((i) => i.paid),
      scanRequired,
      tubes: views,
    };
  }
}
