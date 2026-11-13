import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PurchaseOrderStatus, PurchaseOrderSummary } from '@nexamed/shared';

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  REJECTED: 'Từ chối',
  APPROVED: 'Đã duyệt',
  ORDERED: 'Đã đặt NCC',
  PARTIALLY_RECEIVED: 'Nhận một phần',
  RECEIVED: 'Đã nhận đủ',
  CLOSED: 'Đã đóng (nhận thiếu)',
  CANCELLED: 'Đã huỷ',
};

/** "Xuất Excel" danh sách Đơn đặt hàng NCC (docs/DECISIONS.md #298 giai đoạn 2; quy tắc #287: mọi bảng kê có Excel) — `exceljs`, chỉ ở backend. */
@Injectable()
export class PurchaseOrderExportService {
  async buildListExcel(view: 'mine' | 'approval', items: PurchaseOrderSummary[], multiBranch: boolean): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Đơn đặt hàng NCC');
    sheet.addRow([view === 'mine' ? 'Danh sách đơn đặt hàng NCC của chi nhánh' : 'Danh sách đơn đặt hàng NCC cần duyệt']);
    sheet.addRow([]);
    const header = ['Số đơn', 'Ngày lập', 'Nhà cung cấp', 'Kho nhận', ...(multiBranch ? ['Chi nhánh'] : []), 'Giao dự kiến', 'Số dòng', 'Đã nhận đủ (dòng)', 'Tổng dự kiến', 'Trạng thái', 'Người lập', 'Lý do từ chối/huỷ/đóng'];
    sheet.addRow(header);
    for (const r of items) {
      sheet.addRow([
        r.orderNo,
        r.createdAt.slice(0, 10),
        r.supplierName,
        r.warehouseName,
        ...(multiBranch ? [r.branchName] : []),
        r.expectedDate ?? '',
        r.lineCount,
        r.receivedLineCount,
        r.totalAmount,
        STATUS_LABEL[r.status],
        r.createdByName,
        r.rejectionReason ?? r.cancellationReason ?? r.closedReason ?? '',
      ]);
    }
    header.forEach((_, i) => {
      sheet.getColumn(i + 1).width = i === 0 ? 18 : 22;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }
}
