import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PatientDocumentCategory } from '@nexamed/shared';

/**
 * Tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299) — chỗ DUY NHẤT gọi Prisma cho `patient_document` và `patient_document_folder`.
 * Tệp theo BỆNH NHÂN nên chung cả công ty: mọi truy vấn chỉ lọc `tenantId` + `patientId` (không lọc chi nhánh); `branchId` chỉ ghi nơi tải lên.
 * Mọi hàm đọc nhận `categories` = các loại tệp người xem được phép xem (nhóm quyền), để lễ tân không bao giờ nhận tệp lâm sàng.
 */
const ROW_INCLUDE = { folder: { select: { name: true } } } satisfies Prisma.PatientDocumentInclude;
export type PatientDocumentRow = Prisma.PatientDocumentGetPayload<{ include: typeof ROW_INCLUDE }>;

export interface DocumentListFilter {
  categories: PatientDocumentCategory[];
  category?: PatientDocumentCategory;
  folderId?: string | 'none';
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface DocumentCursor {
  uploadDate: Date;
  uploadedAt: Date;
  id: string;
}

export interface CreateDocumentData {
  branchId: string;
  folderId: string | null;
  encounterId: string | null;
  category: PatientDocumentCategory;
  storageKey: string;
  fileName: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  note: string | null;
  uploadDate: Date;
}

export interface UpdateDocumentData {
  displayName?: string;
  category?: PatientDocumentCategory;
  folderId?: string | null;
  encounterId?: string | null;
  note?: string | null;
}

export interface CategoryAggregate {
  category: PatientDocumentCategory;
  count: number;
  totalBytes: number;
  firstUploadDate: Date | null;
  lastUploadDate: Date | null;
}

export interface FolderRow {
  id: string;
  name: string;
  version: number;
}

function buildWhere(tenantId: string, patientId: string, filter: DocumentListFilter): Prisma.PatientDocumentWhereInput {
  const and: Prisma.PatientDocumentWhereInput[] = [{ category: { in: filter.category ? filter.categories.filter((c) => c === filter.category) : filter.categories } }];
  if (filter.folderId === 'none') and.push({ folderId: null });
  else if (filter.folderId) and.push({ folderId: filter.folderId });
  if (filter.dateFrom || filter.dateTo) {
    and.push({ uploadDate: { ...(filter.dateFrom ? { gte: new Date(filter.dateFrom) } : {}), ...(filter.dateTo ? { lte: new Date(filter.dateTo) } : {}) } });
  }
  if (filter.q) {
    and.push({
      OR: [
        { displayName: { contains: filter.q, mode: 'insensitive' } },
        { fileName: { contains: filter.q, mode: 'insensitive' } },
        { note: { contains: filter.q, mode: 'insensitive' } },
      ],
    });
  }
  return { tenantId, patientId, deletedAt: null, AND: and };
}

@Injectable()
export class PatientDocumentRepository {
  /** Một trang, mới nhất trước: (ngày tải ↓, giờ tải ↓, id ↓). `cursor` là bản ghi cuối của trang trước. */
  listPage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    filter: DocumentListFilter,
    take: number,
    cursor: DocumentCursor | null,
  ): Promise<PatientDocumentRow[]> {
    const where = buildWhere(tenantId, patientId, filter);
    const cursorWhere: Prisma.PatientDocumentWhereInput[] = cursor
      ? [
          {
            OR: [
              { uploadDate: { lt: cursor.uploadDate } },
              { uploadDate: cursor.uploadDate, uploadedAt: { lt: cursor.uploadedAt } },
              { uploadDate: cursor.uploadDate, uploadedAt: cursor.uploadedAt, id: { lt: cursor.id } },
            ],
          },
        ]
      : [];
    return tx.patientDocument.findMany({
      where: { ...where, AND: [...(where.AND as Prisma.PatientDocumentWhereInput[]), ...cursorWhere] },
      include: ROW_INCLUDE,
      orderBy: [{ uploadDate: 'desc' }, { uploadedAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  /** Đếm, dung lượng, ngày đầu/cuối theo từng loại (KHÔNG theo bộ lọc, chỉ theo các loại được phép xem). */
  async aggregateByCategory(tx: Prisma.TransactionClient, tenantId: string, patientId: string, categories: PatientDocumentCategory[]): Promise<CategoryAggregate[]> {
    const rows = await tx.patientDocument.groupBy({
      by: ['category'],
      where: { tenantId, patientId, deletedAt: null, category: { in: categories } },
      _count: { _all: true },
      _sum: { sizeBytes: true },
      _min: { uploadDate: true },
      _max: { uploadDate: true },
    });
    return rows.map((r) => ({
      category: r.category,
      count: r._count._all,
      totalBytes: r._sum.sizeBytes ?? 0,
      firstUploadDate: r._min.uploadDate,
      lastUploadDate: r._max.uploadDate,
    }));
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, patientId: string, id: string): Promise<PatientDocumentRow | null> {
    return tx.patientDocument.findFirst({ where: { tenantId, patientId, id, deletedAt: null }, include: ROW_INCLUDE });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, patientId: string, actorId: string, data: CreateDocumentData): Promise<PatientDocumentRow> {
    return tx.patientDocument.create({
      data: { tenantId, patientId, ...data, createdBy: actorId, updatedBy: actorId },
      include: ROW_INCLUDE,
    });
  }

  /** `updateMany` + kiểm `count` — `version = ?` nằm trong cùng WHERE (khoá lạc quan). */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateDocumentData,
  ): Promise<number> {
    const result = await tx.patientDocument.updateMany({
      where: { tenantId, patientId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Xoá MỀM kèm lý do; tệp trên đĩa giữ nguyên (không xoá cứng dữ liệu nghiệp vụ). */
  async softDeleteIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    reason: string,
  ): Promise<number> {
    const result = await tx.patientDocument.updateMany({
      where: { tenantId, patientId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Đã có tệp TẢI TAY cùng tên hiển thị (không phân biệt hoa thường) trong hồ sơ này chưa; bỏ qua chính tệp `excludeId` khi đổi tên. */
  async uploadNameExists(tx: Prisma.TransactionClient, tenantId: string, patientId: string, name: string, excludeId?: string): Promise<boolean> {
    const found = await tx.patientDocument.findFirst({
      where: { tenantId, patientId, deletedAt: null, sourceType: 'UPLOAD', displayName: { equals: name.trim(), mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return found !== null;
  }

  // ---------------------------------------------------------------- thư mục tự tạo

  async listFolders(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<FolderRow[]> {
    return tx.patientDocumentFolder.findMany({
      where: { tenantId, patientId, deletedAt: null },
      select: { id: true, name: true, version: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /** Số tệp, dung lượng, ngày tải gần nhất của từng thư mục tự tạo — chỉ tính các loại được phép xem. */
  async aggregateByFolder(tx: Prisma.TransactionClient, tenantId: string, patientId: string, categories: PatientDocumentCategory[]) {
    const rows = await tx.patientDocument.groupBy({
      by: ['folderId'],
      where: { tenantId, patientId, deletedAt: null, folderId: { not: null }, category: { in: categories } },
      _count: { _all: true },
      _sum: { sizeBytes: true },
      _max: { uploadDate: true },
    });
    return new Map(rows.map((r) => [r.folderId as string, { count: r._count._all, totalBytes: r._sum.sizeBytes ?? 0, lastUploadDate: r._max.uploadDate }]));
  }

  findFolder(tx: Prisma.TransactionClient, tenantId: string, patientId: string, id: string): Promise<FolderRow | null> {
    return tx.patientDocumentFolder.findFirst({ where: { tenantId, patientId, id, deletedAt: null }, select: { id: true, name: true, version: true } });
  }

  /** Tên thư mục (không phân biệt hoa thường) đã có trong hồ sơ này chưa — bỏ qua chính thư mục `excludeId` khi đổi tên. */
  async folderNameExists(tx: Prisma.TransactionClient, tenantId: string, patientId: string, name: string, excludeId?: string): Promise<boolean> {
    const found = await tx.patientDocumentFolder.findFirst({
      where: { tenantId, patientId, deletedAt: null, name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return found !== null;
  }

  createFolder(tx: Prisma.TransactionClient, tenantId: string, patientId: string, actorId: string, name: string): Promise<FolderRow> {
    return tx.patientDocumentFolder.create({
      data: { tenantId, patientId, name, createdBy: actorId, updatedBy: actorId },
      select: { id: true, name: true, version: true },
    });
  }

  async renameFolderIfVersionMatches(tx: Prisma.TransactionClient, tenantId: string, patientId: string, id: string, expectedVersion: number, actorId: string, name: string): Promise<number> {
    const result = await tx.patientDocumentFolder.updateMany({
      where: { tenantId, patientId, id, version: expectedVersion, deletedAt: null },
      data: { name, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async softDeleteFolderIfVersionMatches(tx: Prisma.TransactionClient, tenantId: string, patientId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.patientDocumentFolder.updateMany({
      where: { tenantId, patientId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'removed', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Số tệp còn trong thư mục (mọi loại, kể cả loại người xoá không xem được) — dùng để chặn xoá thư mục còn tệp. */
  countInFolder(tx: Prisma.TransactionClient, tenantId: string, patientId: string, folderId: string): Promise<number> {
    return tx.patientDocument.count({ where: { tenantId, patientId, folderId, deletedAt: null } });
  }

  /**
   * Gộp hồ sơ (PAT-04): chuyển MỌI tệp và thư mục của hồ sơ nguồn sang hồ sơ đích — không mất tệp nào. Thư mục nguồn trùng tên (không phân biệt hoa thường) với một thư mục
   * đã có ở hồ sơ đích thì tệp được xếp vào thư mục đích đó và thư mục nguồn bị xoá mềm; còn lại thư mục được chuyển nguyên. Trả số tệp đã chuyển.
   */
  async moveAll(tx: Prisma.TransactionClient, tenantId: string, fromPatientId: string, toPatientId: string, actorId: string): Promise<number> {
    const [sourceFolders, targetFolders] = await Promise.all([this.listFolders(tx, tenantId, fromPatientId), this.listFolders(tx, tenantId, toPatientId)]);
    const targetByName = new Map(targetFolders.map((f) => [f.name.trim().toLowerCase(), f.id]));
    for (const folder of sourceFolders) {
      const sameName = targetByName.get(folder.name.trim().toLowerCase());
      if (sameName) {
        await tx.patientDocument.updateMany({ where: { tenantId, patientId: fromPatientId, folderId: folder.id }, data: { folderId: sameName } });
        await tx.patientDocumentFolder.updateMany({
          where: { tenantId, id: folder.id },
          data: { deletedAt: new Date(), deletedReason: 'merged', updatedBy: actorId, version: { increment: 1 } },
        });
      } else {
        await tx.patientDocumentFolder.updateMany({ where: { tenantId, id: folder.id }, data: { patientId: toPatientId, updatedBy: actorId, version: { increment: 1 } } });
      }
    }
    // Tên tệp không được trùng trong hồ sơ đích: tệp nguồn trùng tên được thêm hậu tố "(từ hồ sơ gộp)" thay vì làm hỏng cả lần gộp.
    const [sourceDocs, targetDocs] = await Promise.all([
      tx.patientDocument.findMany({ where: { tenantId, patientId: fromPatientId, deletedAt: null, sourceType: 'UPLOAD' }, select: { id: true, displayName: true }, orderBy: { id: 'asc' } }),
      tx.patientDocument.findMany({ where: { tenantId, patientId: toPatientId, deletedAt: null, sourceType: 'UPLOAD' }, select: { displayName: true } }),
    ]);
    const taken = new Set(targetDocs.map((d) => d.displayName.trim().toLowerCase()));
    for (const doc of sourceDocs) {
      let name = doc.displayName.trim();
      if (taken.has(name.toLowerCase())) {
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 ? name.slice(dot) : '';
        const base = dot > 0 ? name.slice(0, dot) : name;
        let attempt = 1;
        let candidate: string;
        do {
          const suffix = ` (từ hồ sơ gộp${attempt > 1 ? ` ${attempt}` : ''})`;
          candidate = `${base.slice(0, Math.max(1, 200 - suffix.length - ext.length))}${suffix}${ext}`;
          attempt += 1;
        } while (taken.has(candidate.toLowerCase()));
        name = candidate;
        await tx.patientDocument.updateMany({ where: { tenantId, id: doc.id }, data: { displayName: name } });
      }
      taken.add(name.toLowerCase());
    }
    const result = await tx.patientDocument.updateMany({
      where: { tenantId, patientId: fromPatientId, deletedAt: null },
      data: { patientId: toPatientId, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  // ---------------------------------------------------------------- tra cứu phụ

  /** Lượt khám gần đây của bệnh nhân để chọn "Gắn với lượt khám" (mọi chi nhánh — tệp đi theo bệnh nhân). */
  listRecentEncounters(tx: Prisma.TransactionClient, tenantId: string, patientId: string, take: number) {
    return tx.encounter.findMany({
      where: { tenantId, patientId, deletedAt: null },
      select: { id: true, encounterNo: true, checkedInAt: true, examTypeCode: true },
      orderBy: [{ checkedInAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  findEncounterBrief(tx: Prisma.TransactionClient, tenantId: string, patientId: string, encounterId: string) {
    return tx.encounter.findFirst({ where: { tenantId, patientId, id: encounterId, deletedAt: null }, select: { id: true } });
  }

  async encounterBriefs(tx: Prisma.TransactionClient, tenantId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return tx.encounter.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, encounterNo: true, checkedInAt: true, examTypeCode: true } });
  }

  async examTypeNames(tx: Prisma.TransactionClient, tenantId: string, codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await tx.referenceCatalog.findMany({ where: { tenantId, category: 'EXAM_TYPE', code: { in: codes } }, select: { code: true, name: true } });
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  async userNames(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.userAccount.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, displayName: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.displayName ?? r.fullName]));
  }

  async branchNames(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.branch.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Công ty có từ 2 chi nhánh đang hoạt động không (quyết định có hiện cột Chi nhánh). */
  async hasMultipleBranches(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const count = await tx.branch.count({ where: { tenantId, deletedAt: null, isActive: true } });
    return count >= 2;
  }
}
