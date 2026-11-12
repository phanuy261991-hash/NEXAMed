import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { StockRequestStatus, StockRequestSummary } from '@nexamed/shared';

const STATUS_LABEL: Record<StockRequestStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Đã gửi',
  ACCEPTED: 'Đã tiếp nhận',
  IN_PROGRESS: 'Đang xử lý',
  COMPLETED: 'Đã hoàn thành',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
  WITHDRAWN: 'Đã rút',
};

/** "Xuất Excel" danh sách Phiếu yêu cầu cấp hàng (docs/DECISIONS.md #298; quy tắc #287: mọi bảng kê có Excel) — `exceljs`, chỉ ở backend. */
@Injectable()
export class StockRequestExportService {
  async buildListExcel(view: 'mine' | 'incoming', items: StockRequestSummary[], multiBranch: boolean): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Yêu cầu cấp hàng');
    sheet.addRow([view === 'mine' ? 'Danh sách yêu cầu cấp hàng của tôi' : 'Danh sách yêu cầu cấp hàng cần duyệt']);
    sheet.addRow([]);
    const header = ['Số phiếu', 'Ngày lập', 'Kho xin', ...(multiBranch ? ['Chi nhánh xin'] : []), 'Kho cấp', ...(multiBranch ? ['Chi nhánh cấp'] : []), 'Mức khẩn', 'Ngày cần', 'Số dòng', 'Trạng thái', 'Người lập', 'Lý do từ chối/huỷ'];
    sheet.addRow(header);
    for (const r of items) {
      sheet.addRow([
        r.requestNo,
        r.createdAt.slice(0, 10),
        r.requestingWarehouseName,
        ...(multiBranch ? [r.requestingBranchName] : []),
        r.supplyingWarehouseName,
        ...(multiBranch ? [r.supplyingBranchName] : []),
        r.priority === 'URGENT' ? 'Khẩn' : 'Thường',
        r.neededBy ?? '',
        r.lineCount,
        STATUS_LABEL[r.status],
        r.createdByName,
        r.rejectionReason ?? r.cancellationReason ?? '',
      ]);
    }
    header.forEach((_, i) => {
      sheet.getColumn(i + 1).width = i === 0 ? 18 : 22;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }
}
