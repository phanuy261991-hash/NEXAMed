import { useDrugQuery } from './drug.queries';
import { factorToBaseUnit, parsePositiveQuantity } from './base-quantity';
import { unitLabel, useUnitNameByCode } from './useUnitNameByCode';

/**
 * Dòng nhỏ "= 500 Viên" dưới ô số lượng: cho thấy ngay số lượng nhập theo đơn vị đang chọn tương đương bao nhiêu đơn vị NHỎ NHẤT (đơn vị ghi kho). Chỉ hiện khi đơn vị đang chọn
 * KHÁC đơn vị nhỏ nhất và số lượng hợp lệ; chỉ để xem trước, máy chủ quy đổi thật lúc Duyệt phiếu. Dùng chung cho Đơn đặt hàng NCC và Phiếu nhập kho (mỗi mặt hàng chỉ gọi chi tiết một lần nhờ bộ nhớ đệm).
 */
export function BaseQuantityHint({ drugId, unitCode, quantity, className }: { drugId: string; unitCode: string; quantity: string | number; className?: string }) {
  const drugQuery = useDrugQuery(drugId);
  const unitNameByCode = useUnitNameByCode();
  const drug = drugQuery.data;
  const qty = parsePositiveQuantity(quantity);
  if (!drug || !drug.baseUnitCode || !unitCode || unitCode === drug.baseUnitCode || qty === null) return null;
  const factor = factorToBaseUnit(drug.baseUnitCode, drug.units, unitCode);
  if (factor === null) return null;
  const baseName = unitLabel(unitNameByCode, drug.baseUnitCode);
  return (
    <p className={className ?? 'mt-0.5 text-xs font-medium tabular-nums text-slate-500'} title={`1 ${unitLabel(unitNameByCode, unitCode)} = ${factor.toLocaleString('vi-VN')} ${baseName}`}>
      = {(qty * factor).toLocaleString('vi-VN')} {baseName}
    </p>
  );
}
