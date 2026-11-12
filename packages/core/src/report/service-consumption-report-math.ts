import { computeInvoiceDiscount } from '../billing/invoice-discount';
import { roundHalfUpDiv } from '../pricing/resolve-effective-price';
import { allocateAmountByWeights, lineNetWeight, type RevenueLineInput } from './dashboard-math';
import { sharePercent } from './revenue-report-math';

/**
 * Phép tính thuần của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9). Không biết gì về truy vấn hay giao diện.
 * Chi phí = tổng (số lượng × giá vốn lô lúc xuất) của phiếu tiêu hao đang hiệu lực; Từ #297 bổ sung 4 có thêm DOANH THU và LÃI GỘP DỊCH VỤ (doanh thu ghi nhận trừ chi phí tiêu hao) tính trên các lượt đã ghi tiêu hao; KHÔNG phải báo cáo lãi lỗ toàn diện (không nhân sự, mặt bằng, khấu hao).
 */

/** Chi phí trung bình mỗi lượt, làm tròn nửa lên về 1 đồng; chưa có lượt nào thì `null` (không chia cho 0). */
export function averageCostPerVisit(totalCost: number, visitCount: number): number | null {
  if (visitCount <= 0) return null;
  return roundHalfUpDiv(Math.max(0, totalCost), visitCount);
}

export interface ConsumptionItemCost {
  name: string;
  cost: number;
  quantity: number;
}

/**
 * Tên các mặt hàng "dùng nhiều nhất" của một dịch vụ: xếp theo chi phí giảm dần, bằng nhau thì theo số lượng giảm dần rồi theo tên (ổn định giữa các lần xem);
 * lấy `limit` mặt hàng đầu, bỏ mặt hàng chi phí 0 khi vẫn còn mặt hàng có chi phí.
 */
export function topConsumedItemNames(items: ConsumptionItemCost[], limit: number): string[] {
  const hasCost = items.some((i) => i.cost > 0);
  return items
    .filter((i) => !hasCost || i.cost > 0)
    .slice()
    .sort((a, b) => b.cost - a.cost || b.quantity - a.quantity || a.name.localeCompare(b.name, 'vi'))
    .slice(0, Math.max(0, limit))
    .map((i) => i.name);
}

// ---- Doanh thu và lãi gộp dịch vụ (docs/DECISIONS.md #297 bổ sung 4) ----

/** Một dòng hoá đơn đủ để chia tiền: giá trị dòng, chiết khấu riêng của dòng và nguồn của dòng. */
export type ConsumptionRevenueLine = RevenueLineInput;

/** Một phiếu thu (đã loại phiếu huỷ/hoàn toàn phần ở nơi truy vấn) cùng MỌI dòng của nó — cần đủ dòng để chia chiết khấu toàn phiếu đúng. */
export interface ConsumptionRevenueInvoice {
  totalAmount: number;
  discountType: RevenueLineInput['discountType'];
  discountValue: number | null;
  lines: readonly ConsumptionRevenueLine[];
}

/** Một dịch vụ nằm trong gói, dùng để chia tiền dòng gói xuống từng dịch vụ theo giá niêm yết (`weight` = đơn giá × số lượng; 0 hoặc không có giá thì chia đều). */
export interface ConsumptionPackageItem {
  packageId: string;
  orderItemId: string;
  weight: number;
}

export interface ConsumptionRevenueIndex {
  /** Doanh thu ghi nhận theo dòng chỉ định lẻ hoặc dịch vụ trong gói (khoá = id `clinical_order_item`). */
  byOrderItem: ReadonlyMap<string, number>;
  /** Doanh thu ghi nhận theo dịch vụ khám chọn lúc tiếp nhận (khoá = id `encounter_service_item`). */
  byServiceItem: ReadonlyMap<string, number>;
}

/**
 * Chia số tiền ghi nhận (`dueAmount` sau chiết khấu, KHÔNG dùng `invoice.total_amount`) của từng phiếu xuống từng dòng theo tỉ trọng giá trị dòng — cùng cách báo cáo Doanh thu "Theo nhóm và dịch vụ" —
 * rồi gắn vào dịch vụ: dòng chỉ định lẻ → theo dòng chỉ định; dòng dịch vụ khám → theo dịch vụ khám; dòng GÓI → chia tiếp cho các dịch vụ trong gói theo `weight`.
 * Phiếu chưa thu và đã thu đều tính; phiếu đã huỷ/hoàn toàn phần không được truyền vào nên dịch vụ của họ không có doanh thu (chi phí vẫn còn → lãi gộp âm).
 */
export function indexConsumptionRevenue(invoices: readonly ConsumptionRevenueInvoice[], packageItems: readonly ConsumptionPackageItem[]): ConsumptionRevenueIndex {
  const byOrderItem = new Map<string, number>();
  const byServiceItem = new Map<string, number>();
  const byPackage = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.lines.length === 0) continue;
    const due = computeInvoiceDiscount({ totalAmount: invoice.totalAmount, discountType: invoice.discountType, discountValue: invoice.discountValue, lines: invoice.lines }).dueAmount;
    const parts = allocateAmountByWeights(due, invoice.lines.map(lineNetWeight));
    invoice.lines.forEach((line, i) => {
      const part = parts[i] ?? 0;
      if (line.sourceOrderItemId) byOrderItem.set(line.sourceOrderItemId, (byOrderItem.get(line.sourceOrderItemId) ?? 0) + part);
      else if (line.sourceServiceItemId) byServiceItem.set(line.sourceServiceItemId, (byServiceItem.get(line.sourceServiceItemId) ?? 0) + part);
      else if (line.sourceOrderPackageId) byPackage.set(line.sourceOrderPackageId, (byPackage.get(line.sourceOrderPackageId) ?? 0) + part);
    });
  }
  const itemsByPackage = new Map<string, ConsumptionPackageItem[]>();
  for (const item of packageItems) {
    const list = itemsByPackage.get(item.packageId) ?? [];
    list.push(item);
    itemsByPackage.set(item.packageId, list);
  }
  for (const [packageId, amount] of byPackage) {
    const items = itemsByPackage.get(packageId) ?? [];
    if (items.length === 0) continue;
    const weights = items.map((it) => Math.max(0, it.weight));
    const parts = allocateAmountByWeights(amount, weights.some((w) => w > 0) ? weights : weights.map(() => 1));
    items.forEach((it, i) => byOrderItem.set(it.orderItemId, (byOrderItem.get(it.orderItemId) ?? 0) + (parts[i] ?? 0)));
  }
  return { byOrderItem, byServiceItem };
}

/** Doanh thu của MỘT lượt dịch vụ; không tìm thấy dòng hoá đơn (phiếu huỷ, hoàn toàn phần, hoặc dịch vụ bị bỏ) là 0. */
export function visitRevenue(index: ConsumptionRevenueIndex, ref: { orderItemId: string | null; serviceItemId: string | null }): number {
  if (ref.orderItemId) return index.byOrderItem.get(ref.orderItemId) ?? 0;
  if (ref.serviceItemId) return index.byServiceItem.get(ref.serviceItemId) ?? 0;
  return 0;
}

/** Biên lãi gộp = lãi gộp ÷ doanh thu, một chữ số thập phân; `null` khi doanh thu không dương (lượt đã hoàn tiền) — web ghi "—". */
export function serviceMarginPercent(revenue: number, margin: number): number | null {
  return sharePercent(margin, revenue);
}
