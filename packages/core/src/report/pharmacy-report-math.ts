import { computeInvoiceDiscount, type DiscountType } from '../billing/invoice-discount';
import { allocateAmountByWeights, lineNetWeight } from './dashboard-math';

/**
 * Phép tính thuần của trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287): LÃI GỘP = tiền bán trừ giá vốn thẻ kho của RIÊNG thuốc/vật tư — không phải lãi lỗ toàn diện (không nhân sự,
 * mặt bằng, khấu hao). Không biết gì về DB hay HTTP.
 *
 * Quy tắc: TIỀN BÁN của một dòng thuốc = phần của `dueAmount` (sau chiết khấu của phiếu) rơi vào dòng đó theo tỉ trọng giá trị dòng, trừ số tiền đã hoàn cho dòng (hoàn một phần #203);
 * GIÁ VỐN = giá vốn snapshot của dòng phiếu xuất × số lượng còn lại sau khi trừ phần ĐÃ NHẬP LẠI KHO (hàng trả về nhưng không nhập lại kho thì vẫn tính là vốn đã mất). Phiếu chưa thu
 * và đã thu đều tính (như cột Ghi nhận của báo cáo Doanh thu), phiếu đã huỷ/hoàn toàn phần không tính. KHÔNG dùng `invoice.total_amount`.
 */

export type PharmacyItemType = 'MEDICINE' | 'SUPPLY';
export type PharmacyItemFilter = 'ALL' | PharmacyItemType;

export interface MarginDrugInfo {
  drugId: string;
  code: string;
  name: string;
  itemType: PharmacyItemType;
  /** Mã đơn vị cơ sở của mặt hàng (tên đọc từ danh mục ở máy chủ). */
  unitCode: string | null;
}

export interface MarginInvoiceLine {
  lineTotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  /** `null` = dòng không phải thuốc/vật tư (dịch vụ khám, cận lâm sàng, gói) — chỉ dùng để chia chiết khấu. */
  drug: MarginDrugInfo | null;
  /** Số lượng đơn vị cơ sở của dòng (bằng số lượng dòng phiếu xuất). */
  quantity: number;
  /** Giá vốn một đơn vị cơ sở, snapshot lúc xuất. */
  unitCost: number;
  /** Số lượng và tiền đã hoàn cho dòng này (mọi lần hoàn một phần). */
  refundedQuantity: number;
  refundedAmount: number;
  /** Phần số lượng đã hoàn mà được nhập lại kho. */
  restockedQuantity: number;
}

export interface MarginInvoiceInput {
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: readonly MarginInvoiceLine[];
}

export interface MarginRow extends MarginDrugInfo {
  /** Số lượng bán ròng (đã trừ phần khách trả lại). */
  quantity: number;
  sell: number;
  cost: number;
  margin: number;
  /** Biên lãi gộp = lãi gộp ÷ tiền bán, một chữ số thập phân; `null` khi tiền bán không dương. */
  marginPercent: number | null;
}

export interface MarginTotals {
  sell: number;
  cost: number;
  margin: number;
  marginPercent: number | null;
  itemCount: number;
}

/** Biên theo phần trăm, một chữ số thập phân; `null` khi mẫu số không dương. */
export function marginPercentOf(margin: number, sell: number): number | null {
  return sell <= 0 ? null : Math.round((margin / sell) * 1000) / 10;
}

/**
 * Bộ cộng dồn lãi gộp theo mặt hàng. Nạp phiếu từng lô (máy chủ đọc theo tháng), `finish()` ra các dòng xếp theo lãi gộp giảm dần (bằng nhau thì theo tên) và tổng.
 * `itemFilter` lọc theo Loại (Thuốc / Vật tư y tế) NGAY KHI cộng, nên tổng luôn khớp các dòng đang xem.
 */
export function createMarginAccumulator(itemFilter: PharmacyItemFilter = 'ALL') {
  const rows = new Map<string, MarginRow>();

  return {
    addInvoices(invoices: readonly MarginInvoiceInput[]): void {
      for (const invoice of invoices) {
        if (!invoice.lines.some((l) => l.drug !== null)) continue;
        const due = computeInvoiceDiscount({ totalAmount: invoice.totalAmount, discountType: invoice.discountType, discountValue: invoice.discountValue, lines: invoice.lines }).dueAmount;
        const parts = allocateAmountByWeights(due, invoice.lines.map(lineNetWeight));
        invoice.lines.forEach((line, i) => {
          const drug = line.drug;
          if (drug === null || (itemFilter !== 'ALL' && drug.itemType !== itemFilter)) return;
          const sell = (parts[i] ?? 0) - line.refundedAmount;
          const cost = line.unitCost * Math.max(0, line.quantity - line.restockedQuantity);
          const row = rows.get(drug.drugId) ?? { ...drug, quantity: 0, sell: 0, cost: 0, margin: 0, marginPercent: null };
          row.quantity += line.quantity - line.refundedQuantity;
          row.sell += sell;
          row.cost += cost;
          rows.set(drug.drugId, row);
        });
      }
    },
    finish(): { rows: MarginRow[]; totals: MarginTotals } {
      const list = [...rows.values()];
      for (const row of list) {
        row.margin = row.sell - row.cost;
        row.marginPercent = marginPercentOf(row.margin, row.sell);
      }
      list.sort((a, b) => b.margin - a.margin || a.name.localeCompare(b.name, 'vi'));
      const sell = list.reduce((s, r) => s + r.sell, 0);
      const cost = list.reduce((s, r) => s + r.cost, 0);
      return { rows: list, totals: { sell, cost, margin: sell - cost, marginPercent: marginPercentOf(sell - cost, sell), itemCount: list.length } };
    },
  };
}
