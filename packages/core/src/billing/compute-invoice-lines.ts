/**
 * Thu ngân cơ bản (Sprint 5/6, BIL-01) — tính danh sách `invoice_line` + tổng tiền phiếu thu từ
 * các dòng `encounter_service_item` đã chỉ định lúc Tiếp nhận. Hàm THUẦN (không phụ thuộc Prisma)
 * — dùng bởi `InvoiceRepository.createFromServiceItems()`.
 *
 * Quy tắc (docs/DECISIONS.md #080): CHỈ tính dòng có giá (`unitPrice != null`) — dòng dịch vụ chưa
 * cấu hình đơn giá hiệu lực bị BỎ QUA (không lỗi, không chặn tiếp nhận). Tiền là số nguyên đồng
 * (VND không có phần lẻ) — cộng nguyên `unitPrice * quantity`, không có phép chia/phần trăm nên
 * không phát sinh vấn đề làm tròn (CLAUDE.md: chỉ làm tròn ở bước cuối, không áp dụng ở đây vì
 * chưa từng có phép tính không nguyên).
 */

export interface ServiceItemForInvoice {
  id: string;
  examTypeCode: string;
  examTypeName: string;
  priceTypeCode: string | null;
  unitCode: string | null;
  /** `null` = dịch vụ chưa cấu hình đơn giá hiệu lực — bị loại khỏi phiếu thu. */
  unitPrice: number | null;
  quantity: number;
}

export interface ComputedInvoiceLine {
  sourceServiceItemId: string;
  examTypeCode: string;
  examTypeName: string;
  priceTypeCode: string | null;
  unitCode: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface ComputedInvoice {
  lines: ComputedInvoiceLine[];
  totalAmount: number;
}

export function computeInvoiceFromServiceItems(items: readonly ServiceItemForInvoice[]): ComputedInvoice {
  const lines: ComputedInvoiceLine[] = [];
  let totalAmount = 0;

  for (const item of items) {
    if (item.unitPrice === null) {
      continue;
    }
    const lineTotal = item.unitPrice * item.quantity;
    lines.push({
      sourceServiceItemId: item.id,
      examTypeCode: item.examTypeCode,
      examTypeName: item.examTypeName,
      priceTypeCode: item.priceTypeCode,
      unitCode: item.unitCode,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal,
    });
    totalAmount += lineTotal;
  }

  return { lines, totalAmount };
}
