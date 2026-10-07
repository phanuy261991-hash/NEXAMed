import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ParaclinicalResultValue, Prisma } from '@prisma/client';
import {
  CLINIC_CONFIG_READER_PORT,
  InvalidPhotoError,
  sniffImageExtension,
  STORAGE_PORT,
  type StoragePort,
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
  type ParaclinicalServiceKind,
} from '@nexamed/core';
import {
  calculateAgeYears,
  type DataScope,
  PARACLINICAL_IMAGE_MAX_BYTES,
  PARACLINICAL_IMAGE_MAX_COUNT,
  type ListParaclinicalQueueQuery,
  type AmendParaclinicalResultRequest,
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
import { signFileToken } from '../../infrastructure/storage/signed-url';
import { ClinicalOrderRepository, type QueueItemRow } from '../clinical-order/clinical-order.repository';
import { UserAccountRepository } from '../iam/user-account.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { TechnicalServiceRepository, type IndicatorLinkFullRow } from '../technical-service/technical-service.repository';
import { ParaclinicalResultRepository, type ResultValueData, type ResultWithValues } from './paraclinical-result.repository';

type Gender = 'male' | 'female' | 'other';

/**
 * Phạm vi của MỘT lần gọi (docs/DECISIONS.md #215): `dataScope` của quyền thuộc nhóm menu (`lab_result.*` hoặc `imaging_result.*`) + các loại dịch vụ mà nhóm đó phục vụ.
 * Dịch vụ ngoài `kinds` coi như không tồn tại với endpoint này (404) — tài khoản chỉ có quyền Xét nghiệm không mở được kết quả siêu âm và ngược lại.
 */
export interface ResultAccessScope {
  dataScope: DataScope;
  kinds: readonly ParaclinicalServiceKind[];
  /** Module quyền của nhóm (`lab_result` | `imaging_result`) — dùng để liệt kê bác sĩ có quyền duyệt đúng nhóm. */
  permissionModule: string;
}

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
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Hàng đợi
  // ---------------------------------------------------------------------------------------------

  async listQueue(tenantId: string, actorId: string, scope: ResultAccessScope, query: ListParaclinicalQueueQuery): Promise<ListParaclinicalQueueResponse> {
    const allowBeforePayment = await this.clinicConfigReader.getParaclinicalBeforePaymentEnabled(tenantId);
    const date = query.date ?? getVietnamDateString();
    const { startUtc, endUtc } = vietnamDayRange(date);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const scopeDepartmentId = await this.resolveScopeDepartment(tx, tenantId, actorId, scope.dataScope);
      // Scope `department` mà actor chưa gán Khoa/Phòng thì không khớp phòng nào → hàng đợi rỗng (không lỗi).
      const items = enrich(await this.orderRepository.listQueueItems(tx, tenantId, { from: startUtc, to: endUtc })).filter(
        (i) => scope.kinds.includes(i.serviceKind) && (scopeDepartmentId === undefined || (scopeDepartmentId !== null && i.row.technicalService?.departmentId === scopeDepartmentId)),
      );
      const groups = groupQueueItems(items);

      const counts = Object.fromEntries(PARACLINICAL_QUEUE_BUCKETS.map((b) => [b, 0])) as Record<ParaclinicalQueueBucket, number>;
      const needle = query.q ? stripVietnameseDiacritics(query.q).toLowerCase() : null;
      const rows: ListParaclinicalQueueResponse['items'] = [];
      // Tên Mẫu bệnh phẩm / Nhóm dịch vụ theo mã — tra 1 lần mỗi mã trong lượt gọi này.
      const catalogNames = new Map<string, Promise<string | null>>();
      const nameOf = (category: 'SPECIMEN_TYPE' | 'TECH_SERVICE_CATEGORY', code: string | null | undefined): Promise<string | null> => {
        if (!code) return Promise.resolve(null);
        const key = `${category}:${code}`;
        if (!catalogNames.has(key)) catalogNames.set(key, this.referenceCatalogRepository.findByCategoryAndCode(tx, category, code).then((r) => r?.name ?? null));
        return catalogNames.get(key)!;
      };

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

        const specimenNames = [...new Set((await Promise.all(group.map((g) => nameOf('SPECIMEN_TYPE', g.row.technicalService!.specimenTypeCode)))).filter((n): n is string => n !== null))];
        const categoryNames = [...new Set((await Promise.all(group.map((g) => nameOf('TECH_SERVICE_CATEGORY', g.row.technicalService!.categoryCode)))).filter((n): n is string => n !== null))];
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
          specimenNames,
          categoryNames,
          isAmendment: group.some((g) => g.row.results.some((r) => r.supersedesId !== null)),
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
  async startItems(tenantId: string, actorId: string, scope: ResultAccessScope, dto: StartParaclinicalItemsRequest, meta: RequestMeta): Promise<StartParaclinicalItemsResponse> {
    const allowBeforePayment = await this.clinicConfigReader.getParaclinicalBeforePaymentEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const ids = [...new Set(dto.itemIds)];
      const items = enrich(await this.orderRepository.findQueueItemsByIds(tx, tenantId, ids));
      if (items.length !== ids.length) throw new NotFoundException();
      for (const item of items) await this.assertInDepartmentScope(tx, tenantId, actorId, scope, item);
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

  async getForm(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.buildForm(tx, tenantId, actorId, scope, itemId));
  }

  /** Lưu nháp, hoặc gửi duyệt khi `dto.submit`. Người có quyền `enter` (không cần quyền duyệt). */
  async save(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string, dto: SaveParaclinicalResultRequest, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
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
      return this.buildForm(tx, tenantId, actorId, scope, itemId);
    });
  }

  /** "Duyệt & trả kết quả" (ký): lưu nội dung gửi kèm, kiểm đủ rồi ký mọi kết quả của nhóm trong CÙNG transaction. Người có quyền `approve`. */
  async approve(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string, dto: SaveParaclinicalResultRequest, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEditable(group);

      const results = await this.persistSections(tx, tenantId, actorId, group, dto, true);
      const supersededBy = new Map((await this.resultRepository.findActiveByItemIds(tx, tenantId, group.map((g) => g.id))).filter((r) => r.supersedesId !== null).map((r) => [r.id, r.supersedesId as string]));
      const signedAt = new Date();
      for (const r of results) {
        const signed = await this.resultRepository.sign(tx, tenantId, r.id, actorId, signedAt);
        if (signed !== 1) throw new ParaclinicalItemInvalidStateError('Kết quả đã được duyệt trước đó.');
        const supersedes = supersededBy.get(r.id);
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: supersedes ? 'paraclinical_result.amended' : 'paraclinical_result.approved',
          entityType: 'paraclinical_result',
          entityId: r.id,
          afterJson: supersedes ? { signedAt: signedAt.toISOString(), supersedesId: supersedes } : { signedAt: signedAt.toISOString() },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      const ids = group.map((g) => g.id);
      const moved = await this.orderRepository.transitionStatus(tx, tenantId, ids, ['IN_PROGRESS', 'RESULTED'], 'COMPLETED', actorId);
      if (moved !== ids.length) throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
      return this.buildForm(tx, tenantId, actorId, scope, itemId);
    });
  }

  /** Đường dẫn ký có hạn 60 phút (đủ cho 1 ca làm việc ở màn nhập + in phiếu) — cùng cơ chế `signFileToken` của ảnh đại diện bệnh nhân. */
  private signImageUrl(tenantId: string, key: string, encryptionKey: string): string {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    return `/api/v1/files/${signFileToken({ tenantId, key, exp }, encryptionKey)}`;
  }

  /**
   * Thêm ảnh đính kèm (siêu âm, X-quang...) vào kết quả của một dịch vụ đang thực hiện. Kiểm magic-byte (không tin Content-Type của client), ≤ 5 MB, tối đa 8 ảnh;
   * tạo bản nháp kết quả nếu chưa có. Chỉ khi chưa duyệt (đã duyệt là bản ký — DB còn trigger chặn lần nữa).
   */
  async addImage(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string, file: { buffer: Buffer; originalname: string }, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    if (file.buffer.byteLength > PARACLINICAL_IMAGE_MAX_BYTES) throw new InvalidPhotoError('Ảnh vượt quá 5MB, vui lòng chọn ảnh nhỏ hơn.');
    const extension = sniffImageExtension(file.buffer);
    if (!extension) throw new InvalidPhotoError('Chỉ nhận ảnh định dạng JPG hoặc PNG.');

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEditable(group);
      const item = group.find((g) => g.id === itemId) ?? group[0]!;
      if (item.serviceKind === 'LAB') throw new ParaclinicalItemInvalidStateError('Xét nghiệm không có ảnh đính kèm.');

      let [result] = await this.resultRepository.findActiveByItemIds(tx, tenantId, [item.id]);
      if (!result) {
        const created = await this.resultRepository.createResult(tx, tenantId, actorId, { clinicalOrderItemId: item.id, descriptionText: null, conclusionText: null, performedBy: actorId, resultedAt: null, approverId: null });
        result = { ...created, values: [] };
      }
      const count = await this.resultRepository.countImages(tx, tenantId, result.id);
      if (count >= PARACLINICAL_IMAGE_MAX_COUNT) throw new ParaclinicalItemInvalidStateError(`Mỗi kết quả tối đa ${PARACLINICAL_IMAGE_MAX_COUNT} ảnh.`);

      const key = `paraclinical/${result.id}/${randomUUID()}.${extension}`;
      await this.storage.save(tenantId, key, file.buffer, extension === 'jpg' ? 'image/jpeg' : 'image/png');
      try {
        const image = await this.resultRepository.createImage(tx, tenantId, actorId, {
          resultId: result.id,
          storageKey: key,
          fileName: file.originalname.slice(0, 200),
          contentType: extension === 'jpg' ? 'image/jpeg' : 'image/png',
          sizeBytes: file.buffer.byteLength,
          sortOrder: count,
        });
        await writeAuditLog(tx, tenantId, { actorId, action: 'paraclinical_result.image_added', entityType: 'paraclinical_result', entityId: result.id, afterJson: { imageId: image.id }, ip: meta.ip, userAgent: meta.userAgent });
      } catch (err) {
        await this.storage.delete(tenantId, key); // ghi DB lỗi thì dọn file vừa lưu, không để rác không ai trỏ tới
        throw err;
      }
      return this.buildForm(tx, tenantId, actorId, scope, itemId);
    });
  }

  /** Gỡ ảnh đính kèm (soft-delete; file giữ lại trong kho để truy vết). Chỉ khi kết quả chưa duyệt. */
  async removeImage(tenantId: string, actorId: string, scope: ResultAccessScope, imageId: string, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const image = await this.resultRepository.findImage(tx, tenantId, imageId);
      if (!image) throw new NotFoundException();
      const itemId = image.result.clinicalOrderItemId;
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEditable(group);
      await this.resultRepository.softDeleteImage(tx, tenantId, imageId, actorId, 'removed_by_user');
      await writeAuditLog(tx, tenantId, { actorId, action: 'paraclinical_result.image_removed', entityType: 'paraclinical_result', entityId: image.resultId, afterJson: { imageId }, ip: meta.ip, userAgent: meta.userAgent });
      return this.buildForm(tx, tenantId, actorId, scope, itemId);
    });
  }

  /** Ghi audit mỗi lần in phiếu kết quả (dữ liệu y tế đưa ra giấy) — web tự dựng bản in từ dữ liệu đã tải. Một dòng audit cho mỗi kết quả trong nhóm. */
  async recordPrint(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
      if (group[0]!.status === 'ORDERED') throw new ParaclinicalItemInvalidStateError('Chưa có kết quả để in.');
      const results = await this.resultRepository.findActiveByItemIds(tx, tenantId, group.map((g) => g.id));
      if (results.length === 0) throw new NotFoundException();
      for (const r of results) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'paraclinical_result.printed',
          entityType: 'paraclinical_result',
          entityId: r.id,
          afterJson: { signed: r.signedAt !== null },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
    });
  }

  /**
   * "Đính chính" kết quả ĐÃ DUYỆT (docs/DECISIONS.md #215, luồng chủ dự án chốt): người có quyền Nhập của nhóm đề nghị kèm lý do bắt buộc (Thông tư 46/2018/TT-BYT);
   * bản đã ký được giữ nguyên (soft-delete, không xoá) và thay bằng bản NHÁP sao chép nội dung + chỉ số + ảnh, dịch vụ quay lại "Đang thực hiện" để sửa rồi gửi duyệt;
   * bác sĩ có quyền Duyệt ký lại. Toàn bộ nhóm (xét nghiệm cùng phiếu) đính chính cùng lúc vì cùng một phiếu kết quả.
   */
  async startAmendment(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string, dto: AmendParaclinicalResultRequest, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEncounterOpen(group[0]!);
      if (group.some((g) => g.status !== 'COMPLETED')) throw new ParaclinicalItemInvalidStateError('Chỉ đính chính được kết quả đã duyệt.');

      const results = await this.resultRepository.findActiveByItemIds(tx, tenantId, group.map((g) => g.id));
      if (results.length !== group.length || results.some((r) => r.signedAt === null)) throw new ParaclinicalItemInvalidStateError('Kết quả chưa có bản đã duyệt để đính chính.');
      const images = await this.resultRepository.listImages(tx, tenantId, results.map((r) => r.id));

      for (const original of results) {
        const draft = await this.resultRepository.createAmendmentDraft(tx, tenantId, actorId, original, images.filter((img) => img.resultId === original.id), dto.reason);
        if (!draft) throw new ParaclinicalItemInvalidStateError('Kết quả vừa được người khác đính chính — tải lại.');
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'paraclinical_result.amendment_started',
          entityType: 'paraclinical_result',
          entityId: draft.id,
          afterJson: { supersedesId: original.id, reason: dto.reason },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      const ids = group.map((g) => g.id);
      const moved = await this.orderRepository.transitionStatus(tx, tenantId, ids, ['COMPLETED'], 'IN_PROGRESS', actorId);
      if (moved !== ids.length) throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
      return this.buildForm(tx, tenantId, actorId, scope, itemId);
    });
  }

  /** Huỷ đính chính đang soạn/chờ duyệt: bỏ bản nháp, KHÔI PHỤC bản đã duyệt cũ và đưa dịch vụ về "Đã trả kết quả". Người có quyền Nhập của nhóm. */
  async cancelAmendment(tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string, meta: RequestMeta): Promise<ParaclinicalResultForm> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
      await this.lockOrder(tx, tenantId, group[0]!.clinicalOrderId);
      this.assertEncounterOpen(group[0]!);
      const results = await this.resultRepository.findActiveByItemIds(tx, tenantId, group.map((g) => g.id));
      const drafts = results.filter((r) => r.supersedesId !== null && r.signedAt === null);
      if (drafts.length === 0) throw new ParaclinicalItemInvalidStateError('Không có đính chính nào đang soạn để huỷ.');

      for (const draft of drafts) {
        const restored = await this.resultRepository.restoreOriginal(tx, tenantId, actorId, draft);
        if (!restored) throw new ParaclinicalItemInvalidStateError('Đính chính vừa được người khác xử lý — tải lại.');
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'paraclinical_result.amendment_cancelled',
          entityType: 'paraclinical_result',
          entityId: draft.id,
          afterJson: { restoredId: draft.supersedesId },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      const draftItemIds = drafts.map((d) => d.clinicalOrderItemId);
      const moved = await this.orderRepository.transitionStatus(tx, tenantId, draftItemIds, ['IN_PROGRESS', 'RESULTED'], 'COMPLETED', actorId);
      if (moved !== draftItemIds.length) throw new ParaclinicalItemInvalidStateError('Dịch vụ vừa được người khác xử lý — tải lại.');
      return this.buildForm(tx, tenantId, actorId, scope, itemId);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Nội bộ
  // ---------------------------------------------------------------------------------------------

  /**
   * Phòng thực hiện actor được thấy: `undefined` = không giới hạn (scope global); `null` = scope `department` nhưng chưa gán Khoa/Phòng (không thấy gì);
   * chuỗi = chỉ thấy dịch vụ do ĐÚNG Khoa/Phòng đó thực hiện (`technical_service.department_id`) — phòng xét nghiệm và phòng chẩn đoán hình ảnh không thấy việc của nhau.
   */
  private async resolveScopeDepartment(tx: Prisma.TransactionClient, tenantId: string, actorId: string, dataScope: DataScope): Promise<string | null | undefined> {
    if (dataScope !== 'department') return undefined;
    return this.userRepository.findDepartmentId(tx, tenantId, actorId);
  }

  /** Chặn 404 (không phải 403, đúng multi-tenancy.md) khi dịch vụ không thuộc phòng của actor (scope `department`). */
  private async assertInDepartmentScope(tx: Prisma.TransactionClient, tenantId: string, actorId: string, scope: ResultAccessScope, item: EnrichedItem): Promise<void> {
    if (!scope.kinds.includes(item.serviceKind)) throw new NotFoundException();
    const scopeDepartmentId = await this.resolveScopeDepartment(tx, tenantId, actorId, scope.dataScope);
    if (scopeDepartmentId === undefined) return;
    if (scopeDepartmentId === null || item.row.technicalService?.departmentId !== scopeDepartmentId) throw new NotFoundException();
  }

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
  private async resolveGroup(tx: Prisma.TransactionClient, tenantId: string, itemId: string, actorId: string, scope: ResultAccessScope): Promise<EnrichedItem[]> {
    const [anchor] = enrich(await this.orderRepository.findQueueItemsByIds(tx, tenantId, [itemId]));
    if (!anchor) throw new NotFoundException();
    if (anchor.status === 'CANCELLED') throw new NotFoundException();
    await this.assertInDepartmentScope(tx, tenantId, actorId, scope, anchor);
    if (anchor.serviceKind !== 'LAB') return [anchor];
    const siblings = enrich(await this.orderRepository.findQueueItemsByOrder(tx, tenantId, anchor.clinicalOrderId));
    return siblings.filter((s) => s.serviceKind === 'LAB' && s.status === anchor.status && s.paid === anchor.paid);
  }

  private patientContext(item: EnrichedItem): { gender: Gender | null; ageYears: number | null } {
    const patient = item.row.order.encounter.patient;
    return { gender: toGender(patient.gender), ageYears: calculateAgeYears(patient.dob.toISOString()) };
  }

  private async buildForm(tx: Prisma.TransactionClient, tenantId: string, actorId: string, scope: ResultAccessScope, itemId: string): Promise<ParaclinicalResultForm> {
    const group = await this.resolveGroup(tx, tenantId, itemId, actorId, scope);
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
    const images = await this.resultRepository.listImages(tx, tenantId, results.map((r) => r.id));
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');

    const sections: ParaclinicalResultSection[] = [];
    for (const item of group) {
      const service = item.row.technicalService!;
      const result = resultByItem.get(item.id) ?? null;
      const specimen = service.specimenTypeCode ? await this.referenceCatalogRepository.findByCategoryAndCode(tx, 'SPECIMEN_TYPE', service.specimenTypeCode) : null;
      const category = service.categoryCode ? await this.referenceCatalogRepository.findByCategoryAndCode(tx, 'TECH_SERVICE_CATEGORY', service.categoryCode) : null;
      sections.push({
        itemId: item.id,
        technicalServiceId: service.id,
        code: item.row.code,
        name: item.row.name,
        serviceKind: service.serviceKind,
        resultType: service.resultType,
        specimenTypeName: specimen?.name ?? null,
        departmentName: service.department?.name ?? null,
        categoryName: category?.name ?? null,
        status: item.status,
        indicators: this.buildIndicatorViews(linksByService.get(service.id) ?? [], result, ctx),
        descriptionText: result?.descriptionText ?? null,
        conclusionText: result?.conclusionText ?? null,
        images: result ? images.filter((img) => img.resultId === result.id).map((img) => ({ id: img.id, fileName: img.fileName, url: this.signImageUrl(tenantId, img.storageKey, encryptionKey) })) : [],
      });
    }

    const signed = results.find((r) => r.signedAt !== null) ?? null;
    const any = results[0] ?? null;
    const approverRows = await this.userRepository.listActiveUsersWithPermission(tx, tenantId, scope.permissionModule, 'approve');
    const amended = results.find((r) => r.supersedesId !== null) ?? null;
    const original = amended?.supersedesId ? await this.resultRepository.findByIdIncludingDeleted(tx, tenantId, amended.supersedesId) : null;
    const nameIds = [actorId, first.row.order.encounter.doctorId, any?.performedBy, signed?.signedBy, original?.signedBy].filter((x): x is string => typeof x === 'string');
    const names = new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, [...new Set(nameIds)])).map((u) => [u.id, u.fullName]));
    const performedById = any?.performedBy ?? actorId;

    return {
      orderNo: first.row.order.orderNo,
      encounterId: first.row.order.encounter.id,
      encounterNo: first.row.order.encounter.encounterNo,
      patientName: patient.fullName,
      patientCode: patient.patientCode,
      patientGender: ctx.gender,
      patientDob: patient.dob.toISOString().slice(0, 10),
      patientPhone: patient.phone || null,
      ageYears: ctx.ageYears,
      registeredAt: first.row.order.createdAt.toISOString(),
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
      amendment: amended
        ? { reason: amended.amendmentReason ?? '', originalSignedAt: original?.signedAt?.toISOString() ?? null, originalSignedByName: original?.signedBy ? (names.get(original.signedBy) ?? null) : null }
        : null,
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
