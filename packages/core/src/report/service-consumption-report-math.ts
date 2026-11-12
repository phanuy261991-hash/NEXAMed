import { roundHalfUpDiv } from '../pricing/resolve-effective-price';

/**
 * Phép tính thuần của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9). Không biết gì về truy vấn hay giao diện.
 * Chi phí = tổng (số lượng × giá vốn lô lúc xuất) của phiếu tiêu hao đang hiệu lực; KHÔNG vào lãi gộp, KHÔNG phải báo cáo lãi lỗ.
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
