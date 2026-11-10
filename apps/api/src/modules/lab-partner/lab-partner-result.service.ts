import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { CLINIC_CONFIG_READER_PORT, LabPartnerDisabledError, STORAGE_PORT, type ClinicConfigReaderPort, type StoragePort } from '@nexamed/core';
import {
  LAB_PARTNER_RESULT_MAX_BYTES,
  type ApproveLabPartnerResultRequest,
  type LabPartnerDoneRow,
  type LabPartnerQueueCounts,
  type ListLabPartnerAwaitingQuery,
  type ListLabPartnerAwaitingResponse,
  type ListLabPartnerDoneResponse,
  type ListLabPartnerQueueQuery,
  type ReceiveLabPartnerResultRequest,
  type ReceiveLabPartnerResultResponse,
  type RejectLabPartnerItemRequest,
  type ReturnLabPartnerResultRequest,
} from '@nexamed/shared';
import { canSeePartnerCost } from '../../common/partner-cost-access';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { signFileToken } from '../../infrastructure/storage/signed-url';
import { ClinicalOrderRepository } from '../clinical-order/clinical-order.repository';
import { UserAccountRepository } from '../iam/user-account.repository';
import { ParaclinicalResultRepository } from '../paraclinical-result/paraclinical-result.repository';
import { SupplierDebtService } from '../supplier-debt/supplier-debt.service';
import { LabPartnerDispatchRepository, type DoneItemRow } from './lab-partner-dispatch.repository';

/** Đường dẫn ký có hạn 60 phút tới tệp PDF — cùng cơ chế ảnh kết quả cận lâm sàng. */
const FILE_URL_TTL_SECONDS = 60 * 60;

/** Tệp PDF thật bắt đầu bằng `%PDF-` (không tin Content-Type/tên tệp do máy khách gửi). */
export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.byteLength >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Nhận kết quả từ đối tác (docs/DECISIONS.md #291 bổ sung 5): MỘT tệp PDF gắn cho nhiều dịch vụ của cùng đối tác → mỗi dịch vụ có một kết quả nháp (đính kèm PDF) chờ bác sĩ duyệt;
 * ghi nợ đối tác (đúng giá đã chụp lúc gửi) NGAY lúc nhận, cùng giao dịch. Đối tác không nhận → mẫu về "Chờ gửi" (0 đ). Bác sĩ duyệt (ký) → kết quả chính thức.
 * "Trả lại kỹ thuật viên" (sai tệp/thiếu trang) chỉ khi CHƯA duyệt: bỏ kết quả nháp, đảo bút toán, mẫu về "Đã gửi chờ kết quả".
 * Tệp lưu ra kho TRƯỚC khi mở giao dịch (port lưu trữ không được gọi trong `runInTenantScope`, #264) và dọn lại nếu giao dịch lỗi.
 */
@Injectable()
export class LabPartnerResultService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: LabPartnerDispatchRepository,
    private readonly orderRepository: ClinicalOrderRepository,
    private readonly resultRepository: ParaclinicalResultRepository,
    private readonly userRepository: UserAccountRepository,
    private readonly supplierDebt: SupplierDebtService,
    private readonly configService: ConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
  ) {}

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfig.getLabPartnerEnabled(tenantId))) throw new LabPartnerDisabledError();
  }

  private async counts(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<LabPartnerQueueCounts> {
    const [pending, sent, done, awaitingApproval] = await Promise.all([
      this.repository.countPending(tx, tenantId, branchId),
      this.repository.countByStatus(tx, tenantId, branchId, 'SENT'),
      this.repository.countByStatus(tx, tenantId, branchId, 'RECEIVED'),
      this.repository.countAwaitingApproval(tx, tenantId, branchId),
    ]);
    return { pending, sent, done, awaitingApproval };
  }

  /** Chỉ các số đếm (chấm số ở menu, làm mới nhẹ) — không tải danh sách. */
  async getCounts(tenantId: string, branchId: string): Promise<{ counts: LabPartnerQueueCounts }> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({ counts: await this.counts(tx, tenantId, branchId) }));
  }

  async listDone(tenantId: string, actorId: string, branchId: string, query: ListLabPartnerQueueQuery): Promise<ListLabPartnerDoneResponse> {
    await this.assertEnabled(tenantId);
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const costVisible = await canSeePartnerCost(tx, tenantId, actorId);
      const rows = await this.repository.listDoneItems(tx, tenantId, branchId, { supplierId: query.supplierId, q: query.q });
      const items = await this.buildDoneRows(tx, tenantId, rows, costVisible, encryptionKey);
      return { items, counts: await this.counts(tx, tenantId, branchId), costVisible };
    });
  }

  /**
   * Kết quả đối tác chờ duyệt cho khối "chờ duyệt" ở màn khám (`encounterId`) và Tổng quan bác sĩ (`mine` = chỉ lượt khám của chính người gọi). Công tắc tắt thì trả rỗng
   * (không ném 409) để các màn không phải xử lý lỗi chỉ vì phòng khám không dùng đối tác.
   */
  async listAwaiting(tenantId: string, actorId: string, branchId: string, query: ListLabPartnerAwaitingQuery): Promise<ListLabPartnerAwaitingResponse> {
    if (!(await this.clinicConfig.getLabPartnerEnabled(tenantId))) return { items: [], costVisible: false };
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const costVisible = await canSeePartnerCost(tx, tenantId, actorId);
      const rows = await this.repository.listAwaitingItems(tx, tenantId, branchId, { encounterId: query.encounterId, doctorId: query.mine ? actorId : undefined });
      return { items: await this.buildDoneRows(tx, tenantId, rows, costVisible, encryptionKey), costVisible };
    });
  }

  private async buildDoneRows(tx: Prisma.TransactionClient, tenantId: string, rows: DoneItemRow[], costVisible: boolean, encryptionKey: string): Promise<LabPartnerDoneRow[]> {
    const results = await this.resultRepository.findActiveByItemIds(tx, tenantId, rows.map((r) => r.clinicalOrderItemId));
    const resultByItem = new Map(results.map((r) => [r.clinicalOrderItemId, r]));
    const userIds = [...new Set(rows.flatMap((r) => [r.receivedBy, resultByItem.get(r.clinicalOrderItemId)?.signedBy ?? null]).filter((id): id is string => !!id))];
    const names = userIds.length > 0 ? new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, userIds)).map((u) => [u.id, u.fullName])) : new Map<string, string>();
    return rows.map((row) => this.toDoneRow(row, resultByItem.get(row.clinicalOrderItemId), names, costVisible, tenantId, encryptionKey));
  }

  private toDoneRow(
    row: DoneItemRow,
    result: { signedAt: Date | null; signedBy: string | null; conclusionText: string | null } | undefined,
    names: Map<string, string>,
    costVisible: boolean,
    tenantId: string,
    encryptionKey: string,
  ): LabPartnerDoneRow {
    const item = row.orderItem;
    const exp = Math.floor(Date.now() / 1000) + FILE_URL_TTL_SECONDS;
    const receivedAt = row.receivedAt ?? row.dispatch.sentAt;
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
      receivedAt: receivedAt.toISOString(),
      receivedByName: row.receivedBy ? (names.get(row.receivedBy) ?? null) : null,
      dueAt: row.dueAt?.toISOString() ?? null,
      late: row.dueAt !== null && receivedAt.getTime() > row.dueAt.getTime(),
      unitCost: costVisible ? Number(row.unitCost) : null,
      approval: result?.signedAt ? 'APPROVED' : 'PENDING',
      approvedAt: result?.signedAt?.toISOString() ?? null,
      approvedByName: result?.signedBy ? (names.get(result.signedBy) ?? null) : null,
      conclusionText: result?.conclusionText ?? null,
      fileName: row.resultFile?.fileName ?? 'ket-qua.pdf',
      fileUrl: row.resultFile ? `/api/v1/files/${signFileToken({ tenantId, key: row.resultFile.storageKey, exp }, encryptionKey)}` : '',
    };
  }

  /** Nhận tệp PDF kết quả cho các dòng đã gửi của MỘT đối tác. */
  async receive(
    tenantId: string,
    actorId: string,
    branchId: string,
    dto: ReceiveLabPartnerResultRequest,
    file: { buffer: Buffer; originalname: string } | undefined,
    meta: RequestMeta,
  ): Promise<ReceiveLabPartnerResultResponse> {
    await this.assertEnabled(tenantId);
    if (!file || file.buffer.byteLength === 0) throw new BadRequestException('Chọn tệp PDF kết quả của đối tác.');
    if (file.buffer.byteLength > LAB_PARTNER_RESULT_MAX_BYTES) throw new BadRequestException('Tệp vượt quá 10 MB, chọn tệp nhỏ hơn.');
    if (!isPdfBuffer(file.buffer)) throw new BadRequestException('Chỉ nhận tệp PDF.');
    const ids = [...new Set(dto.itemIds)];
    if (ids.length !== dto.itemIds.length) throw new BadRequestException('Có mẫu bị chọn trùng.');
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (receivedAt.getTime() > Date.now() + 60_000) throw new UnprocessableEntityException('Giờ nhận không được ở tương lai.');
    const fileName = file.originalname.slice(0, 200) || 'ket-qua.pdf';

    const key = `lab-partner/${randomUUID()}.pdf`;
    await this.storage.save(tenantId, key, file.buffer, 'application/pdf');
    try {
      return await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
        const rows = await this.repository.findActiveDispatchItems(tx, tenantId, branchId, ids, 'SENT');
        if (rows.length !== ids.length) throw new ConflictException('Có mẫu không còn ở trạng thái "Đã gửi chờ kết quả" (đã nhận kết quả hoặc đã bị từ chối) — tải lại danh sách.');
        const suppliers = new Set(rows.map((r) => r.dispatch.supplierId));
        if (suppliers.size !== 1) throw new UnprocessableEntityException('Một tệp kết quả chỉ gắn cho các mẫu của cùng một đối tác.');
        const supplier = rows[0]!.dispatch.supplier;
        for (const row of rows) {
          if (receivedAt.getTime() < row.dispatch.sentAt.getTime()) throw new UnprocessableEntityException(`Giờ nhận không được trước giờ gửi mẫu của đợt ${row.dispatch.dispatchNo}.`);
        }

        const resultFile = await this.repository.createResultFile(tx, tenantId, actorId, {
          branchId,
          supplierId: rows[0]!.dispatch.supplierId,
          storageKey: key,
          fileName,
          contentType: 'application/pdf',
          sizeBytes: file.buffer.byteLength,
          receivedAt,
          note: dto.note ?? null,
        });

        for (const row of rows) {
          const moved = await this.repository.markReceived(tx, tenantId, actorId, row.id, { receivedAt, resultFileId: resultFile.id });
          if (moved !== 1) throw new ConflictException('Có mẫu vừa được người khác xử lý — tải lại danh sách.');
          const existing = await this.resultRepository.findActiveByItemIds(tx, tenantId, [row.clinicalOrderItemId]);
          if (existing.length > 0) throw new ConflictException('Dịch vụ này đã có kết quả — không nhận thêm.');
          const result = await this.resultRepository.createResult(tx, tenantId, actorId, {
            clinicalOrderItemId: row.clinicalOrderItemId,
            descriptionText: null,
            conclusionText: null,
            performedBy: actorId,
            resultedAt: receivedAt,
            approverId: null,
          });
          await this.resultRepository.createImage(tx, tenantId, actorId, { resultId: result.id, storageKey: key, fileName, contentType: 'application/pdf', sizeBytes: file.buffer.byteLength, sortOrder: 0 });
          const itemMoved = await this.orderRepository.transitionStatus(tx, tenantId, [row.clinicalOrderItemId], ['IN_PROGRESS'], 'RESULTED', actorId);
          if (itemMoved !== 1) throw new ConflictException('Dịch vụ không còn ở trạng thái đang thực hiện — tải lại danh sách.');
          await this.supplierDebt.recordLabPartnerReceipt(tx, tenantId, actorId, {
            supplierId: row.dispatch.supplierId,
            dispatchItemId: row.id,
            amount: row.unitCost,
            occurredAt: receivedAt,
            note: `${row.dispatch.dispatchNo}${row.orderItem.specimenTube?.sid ? ` · ${row.orderItem.specimenTube.sid}` : ''}`,
            meta,
          });
        }
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'lab_partner_dispatch.received',
          entityType: 'lab_partner_dispatch',
          entityId: rows[0]!.dispatch.id,
          afterJson: { supplierId: rows[0]!.dispatch.supplierId, itemCount: rows.length, resultFileId: resultFile.id },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { receivedCount: rows.length, supplierName: supplier.name, fileName, receivedAt: receivedAt.toISOString() };
      });
    } catch (err) {
      await this.storage.delete(tenantId, key).catch(() => undefined); // giao dịch lỗi thì dọn tệp vừa lưu, không để rác không ai trỏ tới
      throw err;
    }
  }

  /** Đối tác không nhận mẫu: dòng gửi → REJECTED (giữ lịch sử, 0 đ), mẫu tự về "Chờ gửi". */
  async reject(tenantId: string, actorId: string, branchId: string, itemId: string, dto: RejectLabPartnerItemRequest, meta: RequestMeta): Promise<void> {
    await this.assertEnabled(tenantId);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [row] = await this.repository.findActiveDispatchItems(tx, tenantId, branchId, [itemId], 'SENT');
      if (!row) throw new NotFoundException();
      const moved = await this.repository.markRejected(tx, tenantId, actorId, row.id, dto.reason);
      if (moved !== 1) throw new ConflictException('Mẫu vừa được người khác xử lý — tải lại danh sách.');
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'lab_partner_dispatch.rejected',
        entityType: 'lab_partner_dispatch',
        entityId: row.dispatch.id,
        afterJson: { itemId, supplierId: row.dispatch.supplierId, reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /** Bác sĩ duyệt (ký) kết quả đối tác: kết quả nháp → bản ký, dịch vụ → COMPLETED. */
  async approve(tenantId: string, actorId: string, branchId: string, itemId: string, dto: ApproveLabPartnerResultRequest, meta: RequestMeta): Promise<void> {
    await this.assertEnabled(tenantId);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [row] = await this.repository.findActiveDispatchItems(tx, tenantId, branchId, [itemId], 'RECEIVED');
      if (!row) throw new NotFoundException();
      const [result] = await this.resultRepository.findActiveByItemIds(tx, tenantId, [itemId]);
      if (!result) throw new ConflictException('Dịch vụ chưa có kết quả để duyệt.');
      if (result.signedAt) throw new ConflictException('Kết quả đã được duyệt.');
      if (dto.conclusionText !== undefined) {
        const updated = await this.resultRepository.updateDraft(tx, tenantId, result.id, actorId, {
          descriptionText: result.descriptionText,
          conclusionText: dto.conclusionText === '' ? null : dto.conclusionText,
          performedBy: result.performedBy ?? actorId,
          resultedAt: result.resultedAt,
          approverId: result.approverId,
        });
        if (updated !== 1) throw new ConflictException('Kết quả vừa được người khác xử lý — tải lại danh sách.');
      }
      const signedAt = new Date();
      const signed = await this.resultRepository.sign(tx, tenantId, result.id, actorId, signedAt);
      if (signed !== 1) throw new ConflictException('Kết quả vừa được người khác duyệt.');
      const moved = await this.orderRepository.transitionStatus(tx, tenantId, [itemId], ['RESULTED'], 'COMPLETED', actorId);
      if (moved !== 1) throw new ConflictException('Dịch vụ không còn ở trạng thái chờ duyệt — tải lại danh sách.');
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'lab_partner_dispatch.approved',
        entityType: 'paraclinical_result',
        entityId: result.id,
        afterJson: { signedAt: signedAt.toISOString(), dispatchNo: row.dispatch.dispatchNo },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /** Trả lại kỹ thuật viên (chưa duyệt): bỏ kết quả nháp + tệp đính kèm, đảo bút toán nợ, mẫu về "Đã gửi chờ kết quả". */
  async returnToTechnician(tenantId: string, actorId: string, branchId: string, itemId: string, dto: ReturnLabPartnerResultRequest, meta: RequestMeta): Promise<void> {
    await this.assertEnabled(tenantId);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [row] = await this.repository.findActiveDispatchItems(tx, tenantId, branchId, [itemId], 'RECEIVED');
      if (!row) throw new NotFoundException();
      const [result] = await this.resultRepository.findActiveByItemIds(tx, tenantId, [itemId]);
      if (result?.signedAt) throw new ConflictException('Kết quả đã được duyệt — không trả lại được, dùng "Đính chính" nếu cần sửa.');
      if (result) {
        const removed = await this.resultRepository.softDeleteDraftWithImages(tx, tenantId, result.id, actorId, 'returned_to_technician');
        if (removed !== 1) throw new ConflictException('Kết quả vừa được người khác xử lý — tải lại danh sách.');
      }
      const itemMoved = await this.orderRepository.transitionStatus(tx, tenantId, [itemId], ['RESULTED'], 'IN_PROGRESS', actorId);
      if (itemMoved !== 1) throw new ConflictException('Dịch vụ không còn ở trạng thái chờ duyệt — tải lại danh sách.');
      const moved = await this.repository.markReturnedToSent(tx, tenantId, actorId, row.id);
      if (moved !== 1) throw new ConflictException('Mẫu vừa được người khác xử lý — tải lại danh sách.');
      await this.supplierDebt.reverseLabPartnerReceipt(tx, tenantId, actorId, row.id, dto.reason, meta);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'lab_partner_dispatch.returned',
        entityType: 'lab_partner_dispatch',
        entityId: row.dispatch.id,
        afterJson: { itemId, reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }
}
