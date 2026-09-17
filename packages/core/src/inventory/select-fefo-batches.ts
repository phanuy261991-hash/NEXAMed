export interface FefoBatchCandidate {
  batchId: string;
  quantityOnHand: number;
  /** `null` = không có hạn dùng (vật tư y tế không hạn) — xếp CUỐI, sau mọi lô có hạn. */
  expiryDate: string | null;
}

export interface FefoAllocation {
  batchId: string;
  quantity: number;
}

/**
 * FEFO (First-Expired-First-Out) — Kho Thuốc GĐ3 (docs/DECISIONS.md #163). Sắp các lô còn tồn theo
 * `expiryDate` TĂNG DẦN (hết hạn sớm nhất trước, lô không hạn dùng xếp cuối), rồi phân bổ THAM LAM
 * (greedy) lần lượt từng lô tới khi đủ số lượng cần. Trả `null` nếu tổng tồn của mọi lô truyền vào
 * không đủ số lượng yêu cầu — không phân bổ một phần.
 *
 * Hàm THUẦN, chỉ tính gợi ý mặc định — dược sĩ vẫn CHỌN LÔ KHÁC được nếu muốn (không ép cứng FEFO,
 * đúng khuôn `stock_receipt` cho chọn `batchNo` tự do). Web chỉ hiển thị đúng thứ tự này, không
 * tính lại (`apps/web` không import `@nexamed/core`, #073) — BE gọi hàm này rồi trả kết quả.
 */
export function selectFefoBatches(candidates: readonly FefoBatchCandidate[], quantityNeeded: number): FefoAllocation[] | null {
  if (quantityNeeded <= 0) {
    return [];
  }

  const sorted = [...candidates]
    .filter((c) => c.quantityOnHand > 0)
    .sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0;
    });

  const totalOnHand = sorted.reduce((sum, c) => sum + c.quantityOnHand, 0);
  if (totalOnHand < quantityNeeded) {
    return null;
  }

  const allocations: FefoAllocation[] = [];
  let remaining = quantityNeeded;
  for (const candidate of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(candidate.quantityOnHand, remaining);
    allocations.push({ batchId: candidate.batchId, quantity: take });
    remaining -= take;
  }
  return allocations;
}

/**
 * Sắp thứ tự GỢI Ý (không phân bổ số lượng) — dùng cho `suggestedBatches` trả về FE ở
 * `GET /inventory/prescriptions/:id/dispense-status`, để dược sĩ thấy đúng thứ tự FEFO trước khi
 * tự chọn số lượng/lô. Cùng luật sắp với `selectFefoBatches()`.
 */
export function sortBatchesByFefo<T extends { expiryDate: string | null }>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return 0;
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0;
  });
}
