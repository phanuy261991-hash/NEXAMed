/**
 * Kho Thuốc GĐ2 (docs/DECISIONS.md #146) — bình quân gia quyền liên hoàn cho hàng KHÔNG quản lý
 * theo lô (`drug.isBatchManaged=false`), tính lại ngay sau mỗi lần duyệt phiếu nhập (không đợi
 * cuối kỳ). Làm tròn round-half-up về 1 đồng, chỉ làm tròn ở bước cuối (CLAUDE.md — cột tiền).
 * Hàng CÓ quản lý theo lô dùng giá vốn ĐÍCH DANH (`inventory_batch.unitCost`), không qua hàm này.
 */
export function computeWeightedAverageCost(existingQuantity: number, existingUnitCost: bigint, incomingQuantity: number, incomingUnitCost: bigint): bigint {
  const totalQuantity = existingQuantity + incomingQuantity;
  if (totalQuantity <= 0) return incomingUnitCost;

  const totalValue = existingUnitCost * BigInt(existingQuantity) + incomingUnitCost * BigInt(incomingQuantity);
  const divisor = BigInt(totalQuantity);
  const quotient = totalValue / divisor;
  const remainder = totalValue % divisor;
  // Round-half-up: remainder*2 >= divisor thì làm tròn lên.
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}
