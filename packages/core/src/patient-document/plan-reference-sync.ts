/**
 * Tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299 giai đoạn 2): so khớp tập dòng THAM CHIẾU chỉ đọc đang có với tập cần có theo các nguồn (kết quả cận lâm sàng đã duyệt, ảnh thẻ BHYT,
 * ảnh đại diện). Phần thuần, không biết Prisma/Nest, để kiểm bằng unit test và dùng lại khi thêm nguồn mới (Nha khoa, Sản khoa...).
 *
 * Khoá so khớp là `storageKey` (cùng khoá lưu ⇒ cùng một tệp gốc): MỘT tệp gốc chỉ có MỘT dòng tham chiếu dù nhiều nguồn trỏ tới (một PDF của đối tác gắn cho nhiều dịch vụ
 * của cùng bệnh nhân). Nguồn đứng trước trong danh sách `desired` thắng — người gọi sắp xếp ổn định (cũ nhất trước) để dòng không nhảy qua lại giữa các lần đối chiếu.
 */
export interface ReferenceKey {
  storageKey: string;
}

/** Phần của dòng tham chiếu có thể đổi khi nguồn đổi mà tệp gốc vẫn giữ nguyên khoá. */
export interface ReferenceMutable {
  sourceType: string;
  sourceId: string;
  encounterId: string | null;
  branchId: string;
}

export interface ReferenceSyncPlan<D extends ReferenceKey & ReferenceMutable> {
  /** Có ở nguồn nhưng chưa có dòng tham chiếu. */
  toCreate: D[];
  /** Có cả hai nhưng thông tin nguồn đã đổi (ví dụ dịch vụ được gắn đầu tiên đổi). */
  toUpdate: { id: string; data: ReferenceMutable }[];
  /** Có dòng tham chiếu nhưng nguồn đã mất (ảnh bị gỡ, kết quả bị đính chính, thẻ bị xoá, công tắc BHYT tắt). */
  toRemoveIds: string[];
}

export function planReferenceSync<D extends ReferenceKey & ReferenceMutable, E extends ReferenceKey & ReferenceMutable & { id: string }>(
  desired: readonly D[],
  existing: readonly E[],
): ReferenceSyncPlan<D> {
  const wanted = new Map<string, D>();
  for (const entry of desired) {
    if (!wanted.has(entry.storageKey)) wanted.set(entry.storageKey, entry);
  }

  const have = new Map<string, E>();
  const toRemoveIds: string[] = [];
  for (const row of existing) {
    // Dữ liệu cũ lỡ có hai dòng cùng khoá (không xảy ra khi đã có chỉ mục duy nhất) thì giữ dòng đầu, gỡ dòng thừa.
    if (have.has(row.storageKey)) toRemoveIds.push(row.id);
    else have.set(row.storageKey, row);
  }

  const toCreate: D[] = [];
  const toUpdate: { id: string; data: ReferenceMutable }[] = [];
  for (const [key, entry] of wanted) {
    const row = have.get(key);
    if (!row) {
      toCreate.push(entry);
      continue;
    }
    if (row.sourceType !== entry.sourceType || row.sourceId !== entry.sourceId || row.encounterId !== entry.encounterId || row.branchId !== entry.branchId) {
      toUpdate.push({ id: row.id, data: { sourceType: entry.sourceType, sourceId: entry.sourceId, encounterId: entry.encounterId, branchId: entry.branchId } });
    }
  }
  for (const [key, row] of have) {
    if (!wanted.has(key)) toRemoveIds.push(row.id);
  }
  return { toCreate, toUpdate, toRemoveIds };
}
