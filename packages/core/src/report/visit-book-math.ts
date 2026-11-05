import { computeInvoiceDiscount, type DiscountType } from '../billing/invoice-discount';

/**
 * Phép tính thuần cho "Sổ khám bệnh" (docs/DECISIONS.md #287) — không biết gì về DB hay HTTP. Thành tiền của một lượt khám và danh sách dịch vụ đã tính tiền
 * được suy ra từ các phiếu CHƯA HUỶ (chưa thu + đã thu) của lượt khám đó, cùng định nghĩa "Ghi nhận" của Báo cáo ngày: `dueAmount` sau chiết khấu, KHÔNG dùng `invoice.total_amount`.
 */

export interface VisitBookInvoiceLine {
  /** Tên dịch vụ / thuốc đã chụp lúc lập phiếu (`invoice_line.exam_type_name`). */
  name: string;
  /** Dòng nguồn từ Phiếu xuất kho (thuốc, vật tư) — không đưa vào cột "Dịch vụ". */
  isDrug: boolean;
  lineTotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

export interface VisitBookInvoice {
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: readonly VisitBookInvoiceLine[];
}

/** Tổng tiền phải thu (sau chiết khấu) của các phiếu của MỘT lượt khám. */
export function sumVisitAmount(invoices: readonly VisitBookInvoice[]): number {
  return invoices.reduce(
    (sum, inv) => sum + computeInvoiceDiscount({ totalAmount: inv.totalAmount, discountType: inv.discountType, discountValue: inv.discountValue, lines: inv.lines }).dueAmount,
    0,
  );
}

/** Tên các dịch vụ (không gồm thuốc/vật tư) theo thứ tự xuất hiện, bỏ tên rỗng và tên lặp (so không phân biệt hoa thường). */
export function listVisitServiceNames(invoices: readonly VisitBookInvoice[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const inv of invoices) {
    for (const line of inv.lines) {
      if (line.isDrug) continue;
      const name = line.name.trim();
      if (name === '') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}
