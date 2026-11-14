import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import {
  ConcurrentModificationError,
  DOCUMENT_CONTENT_TYPE,
  IdempotencyKeyInvalidError,
  PatientAlreadyMergedError,
  PatientDocumentNameTakenError,
  PatientDocumentFolderNameTakenError,
  PatientDocumentFolderNotEmptyError,
  PatientDocumentInvalidFileError,
  PatientDocumentReadOnlyError,
  STORAGE_PORT,
  getVietnamDateString,
  isValidIdempotencyKey,
  maxDataScope,
  sniffDocumentKind,
  type DocumentKind,
  type StoragePort,
} from '@nexamed/core';
import {
  PATIENT_DOCUMENT_CATEGORIES,
  PATIENT_DOCUMENT_DISPLAY_NAME_MAX,
  PATIENT_DOCUMENT_MAX_BYTES,
  PATIENT_DOCUMENT_PERMISSION_MODULE,
  patientDocumentGroupOf,
  type CreatePatientDocumentFolderRequest,
  type ListPatientDocumentEncounterOptionsResponse,
  type ListPatientDocumentsQuery,
  type ListPatientDocumentsResponse,
  type PatientDocument,
  type PatientDocumentAccess,
  type PatientDocumentCategory,
  type PatientDocumentFolder,
  type PatientDocumentGroup,
  type RenamePatientDocumentFolderRequest,
  type UpdatePatientDocumentRequest,
  type UploadPatientDocumentForm,
} from '@nexamed/shared';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { signFileToken } from '../../infrastructure/storage/signed-url';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PatientRepository } from '../patient/patient.repository';
import { PatientDocumentReferenceRepository, type ResultImageContext } from './patient-document-reference.repository';
import { PatientDocumentReferenceSync } from './patient-document-reference-sync.service';
import { PatientDocumentRepository, type DocumentCursor, type PatientDocumentRow } from './patient-document.repository';

/** Đường dẫn ký sống 15 phút, làm mới mỗi lần gọi lại danh sách (cùng thời hạn ảnh thẻ BHYT). */
const URL_TTL_SECONDS = 15 * 60;

type Action = 'read' | 'upload' | 'delete';

const KIND_BY_TYPE: Record<DocumentKind, PatientDocument['kind']> = { jpg: 'image', png: 'image', pdf: 'pdf', dcm: 'dicom' };

function kindOfContentType(contentType: string): PatientDocument['kind'] {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  return 'dicom';
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const viDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function encodeCursor(row: PatientDocumentRow): string {
  return Buffer.from(JSON.stringify({ d: isoDate(row.uploadDate), t: row.uploadedAt.toISOString(), id: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string | undefined): DocumentCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { d?: unknown; t?: unknown; id?: unknown };
    if (typeof parsed.d !== 'string' || typeof parsed.t !== 'string' || typeof parsed.id !== 'string') return null;
    const uploadDate = new Date(parsed.d);
    const uploadedAt = new Date(parsed.t);
    if (Number.isNaN(uploadDate.getTime()) || Number.isNaN(uploadedAt.getTime())) return null;
    return { uploadDate, uploadedAt, id: parsed.id };
  } catch {
    return null;
  }
}

/** Multer đọc tên tệp UTF-8 như latin1 → ghép lại cho đúng dấu tiếng Việt. */
function decodeOriginalName(raw: string): string {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  const name = decoded.includes('�') ? raw : decoded;
  return name.replace(/[\\/]+/g, '_').split('').filter((ch) => ch.charCodeAt(0) >= 32).join('').trim().slice(0, PATIENT_DOCUMENT_DISPLAY_NAME_MAX) || 'tep';
}

/**
 * Tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299). Quyền theo HAI nhóm độc lập (`patient_document` cho tệp lâm sàng,
 * `patient_contract` cho hợp đồng và giấy tờ): controller chỉ cho qua khi có ít nhất một nhóm, còn service tự lọc/chặn theo nhóm của TỪNG tệp.
 * Tệp lưu ngoài DB qua StoragePort tại `patient/<patientId>/documents/<uuid>.<ext>`; thư mục "ngày" là nhóm lúc đọc theo `upload_date` (giờ Việt Nam).
 */
@Injectable()
export class PatientDocumentService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PatientDocumentRepository,
    private readonly referenceRepository: PatientDocumentReferenceRepository,
    private readonly referenceSync: PatientDocumentReferenceSync,
    private readonly patientRepository: PatientRepository,
    private readonly configService: ConfigService,
    private readonly idempotency: IdempotencyService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  // ---------------------------------------------------------------- quyền

  private async resolveAccess(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<PatientDocumentAccess> {
    const has = async (group: PatientDocumentGroup, action: Action): Promise<boolean> =>
      maxDataScope(await findScopesForUserPermission(tx, tenantId, userId, PATIENT_DOCUMENT_PERMISSION_MODULE[group], action)) !== 'none';
    return {
      clinical: { read: await has('clinical', 'read'), upload: await has('clinical', 'upload'), delete: await has('clinical', 'delete') },
      contract: { read: await has('contract', 'read'), upload: await has('contract', 'upload'), delete: await has('contract', 'delete') },
    };
  }

  private allowedCategories(access: PatientDocumentAccess): PatientDocumentCategory[] {
    return PATIENT_DOCUMENT_CATEGORIES.filter((c) => access[patientDocumentGroupOf(c)].read);
  }

  private assertCan(access: PatientDocumentAccess, category: PatientDocumentCategory, action: Action): void {
    if (!access[patientDocumentGroupOf(category)][action]) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Bạn không có quyền thực hiện thao tác này với loại tệp đó.' });
    }
  }

  private assertCanManageFolders(access: PatientDocumentAccess): void {
    if (!access.clinical.upload && !access.contract.upload) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Bạn không có quyền tạo hoặc sửa thư mục.' });
    }
  }

  // ---------------------------------------------------------------- danh sách

  async list(tenantId: string, userId: string, branchId: string, patientId: string, query: ListPatientDocumentsQuery): Promise<ListPatientDocumentsResponse> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const patient = await this.patientRepository.findById(tx, tenantId, patientId);
      if (!patient) throw new NotFoundException();
      const access = await this.resolveAccess(tx, tenantId, userId);
      const categories = this.allowedCategories(access);
      if (categories.length === 0) {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Bạn không có quyền xem hình ảnh và tài liệu của bệnh nhân.' });
      }
      // Giai đoạn 2 (#299 bổ sung 3): trang ĐẦU của mỗi lần mở tab tự đối chiếu dòng tham chiếu với nguồn (kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện) rồi mới đếm và liệt kê,
      // nên tổng quan và danh sách luôn khớp nhau. Các trang sau (có con trỏ) dùng lại kết quả đó. Hồ sơ đã gộp không còn nhận dòng mới.
      if (!query.cursor && patient.mergedIntoId === null) {
        await this.referenceSync.sync(tx, tenantId, userId, { patientId, photoKey: patient.photoKey, updatedAt: patient.updatedAt, updatedBy: patient.updatedBy });
      }

      const rows = await this.repository.listPage(
        tx,
        tenantId,
        patientId,
        { categories, category: query.category, folderId: query.folderId, q: query.q, dateFrom: query.dateFrom, dateTo: query.dateTo },
        query.limit + 1,
        decodeCursor(query.cursor),
      );
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;

      const [userNames, branchNames, encounterLabels, aggregates, folders, folderAggregates, multiBranch, resultContexts] = await Promise.all([
        this.repository.userNames(tx, tenantId, [...new Set(page.map((r) => r.createdBy))]),
        this.repository.branchNames(tx, tenantId, [...new Set(page.map((r) => r.branchId))]),
        this.encounterLabels(tx, tenantId, patientId, page.map((r) => r.encounterId).filter((id): id is string => id !== null)),
        this.repository.aggregateByCategory(tx, tenantId, patientId, categories),
        this.repository.listFolders(tx, tenantId, patientId),
        this.repository.aggregateByFolder(tx, tenantId, patientId, categories),
        this.repository.hasMultipleBranches(tx, tenantId),
        this.referenceRepository.resultImageContexts(tx, tenantId, page.filter((r) => r.sourceType === 'PARACLINICAL_IMAGE' && r.sourceId !== null).map((r) => r.sourceId as string)),
      ]);

      const sum = (pick: (a: (typeof aggregates)[number]) => number) => aggregates.reduce((acc, a) => acc + pick(a), 0);
      const dates = aggregates.flatMap((a) => [a.firstUploadDate, a.lastUploadDate]).filter((d): d is Date => d !== null).map(isoDate).sort();
      const summary = {
        total: sum((a) => a.count),
        totalBytes: sum((a) => a.totalBytes),
        firstUploadDate: dates[0] ?? null,
        lastUploadDate: dates.at(-1) ?? null,
        byCategory: PATIENT_DOCUMENT_CATEGORIES.filter((c) => categories.includes(c)).map((category) => {
          const found = aggregates.find((a) => a.category === category);
          return {
            category,
            count: found?.count ?? 0,
            totalBytes: found?.totalBytes ?? 0,
            lastUploadDate: found?.lastUploadDate ? isoDate(found.lastUploadDate) : null,
          };
        }),
      };

      const folderItems: PatientDocumentFolder[] = folders.map((f) => {
        const agg = folderAggregates.get(f.id);
        return { id: f.id, name: f.name, version: f.version, fileCount: agg?.count ?? 0, totalBytes: agg?.totalBytes ?? 0, lastUploadDate: agg?.lastUploadDate ? isoDate(agg.lastUploadDate) : null };
      });

      return {
        items: page.map((row) => this.toDocument(tenantId, row, encryptionKey, userNames, branchNames, encounterLabels, branchId, resultContexts)),
        nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
        summary,
        folders: folderItems,
        access,
        multiBranch,
        currentBranchId: branchId,
      };
    });
  }

  async encounterOptions(tenantId: string, userId: string, patientId: string): Promise<ListPatientDocumentEncounterOptionsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientExists(tx, tenantId, patientId);
      this.assertCanManageFolders(await this.resolveAccess(tx, tenantId, userId));
      const rows = await this.repository.listRecentEncounters(tx, tenantId, patientId, 50);
      const labels = await this.encounterLabels(tx, tenantId, patientId, rows.map((r) => r.id));
      return { items: rows.map((r) => ({ id: r.id, label: labels.get(r.id) ?? r.encounterNo })) };
    });
  }

  // ---------------------------------------------------------------- tải lên

  /**
   * Tải lên CÓ khoá chống ghi trùng (docs/DECISIONS.md #257 áp cho tải tệp, #299): interceptor toàn cục bỏ qua multipart vì chưa đọc được tệp, nên ở đây khoá được giữ chỗ
   * SAU khi tệp đã tới handler — vân tay = người gửi + chi nhánh + hash nội dung tệp + các trường kèm theo. Cùng khoá + cùng nội dung gửi lại (mạng đứt sau khi máy chủ đã ghi) thì
   * trả ĐÚNG kết quả cũ, không ghi tệp thứ hai. Các lời gọi khoá nằm NGOÀI transaction của `upload` (mỗi lời gọi tự mở transaction ngắn riêng — #264).
   */
  async uploadOnce(
    tenantId: string,
    actorId: string,
    branchId: string,
    patientId: string,
    form: UploadPatientDocumentForm,
    file: { buffer: Buffer; originalname: string },
    rawRequestKey: string | undefined,
    path: string,
    meta: RequestMeta,
  ): Promise<PatientDocument> {
    if (rawRequestKey === undefined) return this.upload(tenantId, actorId, branchId, patientId, form, file, meta);
    const requestKey = rawRequestKey.trim().toLowerCase();
    if (!isValidIdempotencyKey(requestKey)) throw new IdempotencyKeyInvalidError();
    const requestHash = createHash('sha256')
      .update([patientId, actorId, branchId, createHash('sha256').update(file.buffer).digest('hex'), form.category, form.folderId ?? '', form.encounterId ?? '', form.note ?? ''].join('\n'))
      .digest('hex');
    const outcome = await this.idempotency.acquire(tenantId, actorId, { requestKey, requestHash, method: 'POST', path });
    if (outcome.kind === 'replay') return outcome.value as PatientDocument;
    try {
      const result = await this.upload(tenantId, actorId, branchId, patientId, form, file, meta);
      await this.idempotency.complete(tenantId, actorId, outcome.id, result);
      return result;
    } catch (error) {
      await this.idempotency.fail(tenantId, actorId, outcome.id);
      throw error;
    }
  }

  async upload(
    tenantId: string,
    actorId: string,
    branchId: string,
    patientId: string,
    form: UploadPatientDocumentForm,
    file: { buffer: Buffer; originalname: string },
    meta: RequestMeta,
  ): Promise<PatientDocument> {
    if (file.buffer.byteLength === 0) throw new PatientDocumentInvalidFileError('Tệp rỗng, hãy chọn tệp khác.');
    if (file.buffer.byteLength > PATIENT_DOCUMENT_MAX_BYTES) {
      throw new PatientDocumentInvalidFileError(`Tệp vượt quá ${PATIENT_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB, hãy chọn tệp nhỏ hơn.`);
    }
    const kind = sniffDocumentKind(file.buffer);
    if (!kind) throw new PatientDocumentInvalidFileError('Chỉ nhận ảnh JPG, PNG, tệp PDF hoặc DICOM.');

    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    const contentType = DOCUMENT_CONTENT_TYPE[kind];
    const originalName = decodeOriginalName(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const uploadDate = getVietnamDateString(new Date());

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      this.assertCan(await this.resolveAccess(tx, tenantId, actorId), form.category, 'upload');
      await this.assertFolderAndEncounter(tx, tenantId, patientId, form.folderId ?? null, form.encounterId ?? null);
      if (await this.repository.uploadNameExists(tx, tenantId, patientId, originalName)) throw new PatientDocumentNameTakenError(originalName);

      const key = `patient/${patientId}/documents/${randomUUID()}.${kind}`;
      await this.storage.save(tenantId, key, file.buffer, contentType);
      try {
        const row = await this.repository.create(tx, tenantId, patientId, actorId, {
          branchId,
          folderId: form.folderId ?? null,
          encounterId: form.encounterId ?? null,
          category: form.category,
          storageKey: key,
          fileName: originalName,
          displayName: originalName,
          contentType,
          sizeBytes: file.buffer.byteLength,
          sha256,
          note: form.note ?? null,
          uploadDate: new Date(uploadDate),
        });
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'patient_document.uploaded',
          entityType: 'patient_document',
          entityId: row.id,
          // KHÔNG ghi tên tệp (có thể chứa tên bệnh nhân) — chỉ id bệnh nhân, loại và dung lượng.
          afterJson: { patientId, category: row.category, kind: KIND_BY_TYPE[kind], sizeBytes: row.sizeBytes },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        const [userNames, branchNames, encounterLabels] = await Promise.all([
          this.repository.userNames(tx, tenantId, [actorId]),
          this.repository.branchNames(tx, tenantId, [branchId]),
          this.encounterLabels(tx, tenantId, patientId, row.encounterId ? [row.encounterId] : []),
        ]);
        return this.toDocument(tenantId, row, encryptionKey, userNames, branchNames, encounterLabels, branchId, new Map());
      } catch (error) {
        await this.storage.delete(tenantId, key); // ghi DB lỗi thì dọn tệp vừa lưu, không để rác không ai trỏ tới
        // Hai yêu cầu cùng tên chạy song song: chỉ mục duy nhất chặn bản thứ hai (P2002) → cùng thông báo như kiểm trước.
        if ((error as { code?: string } | null)?.code === 'P2002') throw new PatientDocumentNameTakenError(originalName);
        throw error;
      }
    });
  }

  // ---------------------------------------------------------------- sửa / xoá tệp

  async update(tenantId: string, actorId: string, patientId: string, documentId: string, dto: UpdatePatientDocumentRequest, meta: RequestMeta): Promise<{ ok: true }> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      const access = await this.resolveAccess(tx, tenantId, actorId);
      const existing = await this.repository.findById(tx, tenantId, patientId, documentId);
      // Người không có quyền xem loại tệp này thấy "không tìm thấy" (không tiết lộ tệp có tồn tại).
      if (!existing || !access[patientDocumentGroupOf(existing.category)].read) throw new NotFoundException();
      if (existing.sourceType !== 'UPLOAD') throw new PatientDocumentReadOnlyError();
      this.assertCan(access, existing.category, 'upload');
      if (dto.category !== undefined) this.assertCan(access, dto.category, 'upload');
      await this.assertFolderAndEncounter(tx, tenantId, patientId, dto.folderId ?? null, dto.encounterId ?? null);
      if (dto.displayName !== undefined && dto.displayName.trim().toLowerCase() !== existing.displayName.trim().toLowerCase()) {
        if (await this.repository.uploadNameExists(tx, tenantId, patientId, dto.displayName, documentId)) throw new PatientDocumentNameTakenError(dto.displayName);
      }

      const data: Parameters<PatientDocumentRepository['updateIfVersionMatches']>[6] = {};
      if (dto.displayName !== undefined) data.displayName = dto.displayName;
      if (dto.category !== undefined) data.category = dto.category;
      if (dto.folderId !== undefined) data.folderId = dto.folderId;
      if (dto.encounterId !== undefined) data.encounterId = dto.encounterId;
      if (dto.note !== undefined) data.note = dto.note === null || dto.note === '' ? null : dto.note;

      const count = await this.repository.updateIfVersionMatches(tx, tenantId, patientId, documentId, dto.version, actorId, data);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient_document.updated',
        entityType: 'patient_document',
        entityId: documentId,
        afterJson: { patientId, changed: Object.keys(data) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ok: true as const };
    });
  }

  async remove(tenantId: string, actorId: string, patientId: string, documentId: string, version: number, reason: string, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      const access = await this.resolveAccess(tx, tenantId, actorId);
      const existing = await this.repository.findById(tx, tenantId, patientId, documentId);
      if (!existing || !access[patientDocumentGroupOf(existing.category)].read) throw new NotFoundException();
      if (existing.sourceType !== 'UPLOAD') throw new PatientDocumentReadOnlyError();
      this.assertCan(access, existing.category, 'delete');
      const count = await this.repository.softDeleteIfVersionMatches(tx, tenantId, patientId, documentId, version, actorId, reason);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient_document.removed',
        entityType: 'patient_document',
        entityId: documentId,
        beforeJson: { patientId, category: existing.category },
        afterJson: { reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  // ---------------------------------------------------------------- thư mục tự tạo

  async createFolder(tenantId: string, actorId: string, patientId: string, dto: CreatePatientDocumentFolderRequest, meta: RequestMeta): Promise<PatientDocumentFolder> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      this.assertCanManageFolders(await this.resolveAccess(tx, tenantId, actorId));
      if (await this.repository.folderNameExists(tx, tenantId, patientId, dto.name)) throw new PatientDocumentFolderNameTakenError();
      const folder = await this.repository.createFolder(tx, tenantId, patientId, actorId, dto.name);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient_document_folder.created',
        entityType: 'patient_document_folder',
        entityId: folder.id,
        afterJson: { patientId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { id: folder.id, name: folder.name, version: folder.version, fileCount: 0, totalBytes: 0, lastUploadDate: null };
    });
  }

  async renameFolder(tenantId: string, actorId: string, patientId: string, folderId: string, dto: RenamePatientDocumentFolderRequest, meta: RequestMeta): Promise<{ ok: true }> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      this.assertCanManageFolders(await this.resolveAccess(tx, tenantId, actorId));
      if (!(await this.repository.findFolder(tx, tenantId, patientId, folderId))) throw new NotFoundException();
      if (await this.repository.folderNameExists(tx, tenantId, patientId, dto.name, folderId)) throw new PatientDocumentFolderNameTakenError();
      const count = await this.repository.renameFolderIfVersionMatches(tx, tenantId, patientId, folderId, dto.version, actorId, dto.name);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient_document_folder.renamed',
        entityType: 'patient_document_folder',
        entityId: folderId,
        afterJson: { patientId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ok: true as const };
    });
  }

  async removeFolder(tenantId: string, actorId: string, patientId: string, folderId: string, version: number, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      this.assertCanManageFolders(await this.resolveAccess(tx, tenantId, actorId));
      if (!(await this.repository.findFolder(tx, tenantId, patientId, folderId))) throw new NotFoundException();
      const remaining = await this.repository.countInFolder(tx, tenantId, patientId, folderId);
      if (remaining > 0) throw new PatientDocumentFolderNotEmptyError(remaining);
      const count = await this.repository.softDeleteFolderIfVersionMatches(tx, tenantId, patientId, folderId, version, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient_document_folder.removed',
        entityType: 'patient_document_folder',
        entityId: folderId,
        afterJson: { patientId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  // ---------------------------------------------------------------- phụ trợ

  private async assertPatientExists(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<void> {
    if (!(await this.patientRepository.findById(tx, tenantId, patientId))) throw new NotFoundException();
  }

  /** Tải lên/sửa/xoá: hồ sơ đã gộp vào hồ sơ khác không còn nhận thay đổi. */
  private async assertPatientUsable(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<void> {
    const patient = await this.patientRepository.findById(tx, tenantId, patientId);
    if (!patient) throw new NotFoundException();
    if (patient.mergedIntoId !== null) throw new PatientAlreadyMergedError();
  }

  /** Thư mục và lượt khám được chọn phải thuộc đúng bệnh nhân này (id của bệnh nhân/công ty khác → 404). */
  private async assertFolderAndEncounter(tx: Prisma.TransactionClient, tenantId: string, patientId: string, folderId: string | null, encounterId: string | null): Promise<void> {
    if (folderId && !(await this.repository.findFolder(tx, tenantId, patientId, folderId))) throw new NotFoundException();
    if (encounterId && !(await this.repository.findEncounterBrief(tx, tenantId, patientId, encounterId))) throw new NotFoundException();
  }

  /** Nhãn lượt khám "13/11/2026 · Khám tổng quát" (tên loại khám, thiếu thì dùng số lượt khám). */
  private async encounterLabels(tx: Prisma.TransactionClient, tenantId: string, _patientId: string, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const encounters = await this.repository.encounterBriefs(tx, tenantId, unique);
    const names = await this.repository.examTypeNames(tx, tenantId, [...new Set(encounters.map((e) => e.examTypeCode).filter((c): c is string => c !== null))]);
    return new Map(encounters.map((e) => [e.id, `${viDate(getVietnamDateString(e.checkedInAt))} · ${(e.examTypeCode && names.get(e.examTypeCode)) || e.encounterNo}`]));
  }

  private toDocument(
    tenantId: string,
    row: PatientDocumentRow,
    encryptionKey: string,
    userNames: Map<string, string>,
    branchNames: Map<string, string>,
    encounterLabels: Map<string, string>,
    currentBranchId: string,
    resultContexts: Map<string, ResultImageContext>,
  ): PatientDocument {
    const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
    // Ảnh thẻ BHYT và ảnh đại diện đi theo hồ sơ, không thuộc chi nhánh nào: không hiện tên chi nhánh và không tô nền "chi nhánh khác" (lưu tạm ở chi nhánh mặc định).
    const unbranched = row.sourceType === 'INSURANCE_CARD' || row.sourceType === 'PATIENT_PHOTO';
    const context = row.sourceType === 'PARACLINICAL_IMAGE' && row.sourceId ? resultContexts.get(row.sourceId) : undefined;
    return {
      id: row.id,
      patientId: row.patientId,
      category: row.category,
      source: row.sourceType,
      readOnly: row.sourceType !== 'UPLOAD',
      sourceLabel: context?.serviceName ?? null,
      sourceRef: context ? { orderItemId: context.orderItemId, encounterId: context.encounterId, group: context.group } : null,
      fileName: row.fileName,
      displayName: row.displayName,
      contentType: row.contentType,
      kind: kindOfContentType(row.contentType),
      sizeBytes: row.sizeBytes,
      note: row.note,
      folderId: row.folderId,
      folderName: row.folder?.name ?? null,
      encounterId: row.encounterId,
      encounterLabel: row.encounterId ? (encounterLabels.get(row.encounterId) ?? null) : null,
      uploadedAt: row.uploadedAt.toISOString(),
      uploadDate: isoDate(row.uploadDate),
      uploadedByName: userNames.get(row.createdBy) ?? '—',
      branchId: unbranched ? currentBranchId : row.branchId,
      branchName: unbranched ? null : (branchNames.get(row.branchId) ?? null),
      url: `/api/v1/files/${signFileToken({ tenantId, key: row.storageKey, exp }, encryptionKey)}`,
      version: row.version,
    };
  }
}
