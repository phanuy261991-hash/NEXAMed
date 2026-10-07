import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PriceListDetail } from '@nexamed/shared';

/** Nhãn khai RIÊNG ở backend — hằng số của `apps/web`/`packages/shared` (giá trị) không resolve được qua ranh giới build, cùng lý do `ReceptionExportService`. */
const KIND_LABELS: Record<PriceListDetail['lines'][number]['itemKind'], string> = {
  EXAM_TYPE: 'Dịch vụ khám',
  TECHNICAL_SERVICE: 'Dịch vụ kỹ thuật',
  PACKAGE: 'Gói dịch vụ',
  DRUG: 'Thuốc',
  MEDICAL_SUPPLY: 'Vật tư y tế',
};

const STATUS_LABELS: Record<PriceListDetail['status'], string> = {
  ACTIVE: 'Đang áp dụng',
  UPCOMING: 'Sắp áp dụng',
  EXPIRED: 'Đã hết hạn',
  STOPPED: 'Đã ngừng',
};

function vnDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * "Xuất Excel" một bảng giá có thời hạn (Cận lâm sàng GĐ2, docs/DECISIONS.md #212, nút ở chân trang chi tiết bảng giá). Cột khớp bảng
 * trên màn hình: Loại, Mã, Tên, Phạm vi (Loại giá/Đơn vị), Giá mặc định, Cách tính, Giá trị, Giá áp dụng. Phạm vi xuất ra dạng MÃ
 * (`priceTypeCode`/`unitCode`) vì tên danh mục thuộc module khác — người dùng đối chiếu bằng mã trong danh mục.
 */
@Injectable()
export class PriceListExportService {
  async build(detail: PriceListDetail): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bảng giá');

    sheet.addRow([`${detail.code} — ${detail.name}`]).font = { bold: true, size: 13 };
    sheet.addRow([`Hiệu lực: ${vnDate(detail.effectiveFrom)} – ${vnDate(detail.effectiveTo)} · Độ ưu tiên: ${detail.priority} · ${STATUS_LABELS[detail.status]}`]);
    sheet.addRow([]);
    const header = sheet.addRow(['Loại', 'Mã', 'Tên mặt hàng', 'Loại giá / Đơn vị', 'Giá mặc định (đ)', 'Cách tính', 'Giá trị', 'Giá áp dụng (đ)']);
    header.font = { bold: true };

    for (const line of detail.lines) {
      sheet.addRow([
        KIND_LABELS[line.itemKind],
        line.code,
        line.name,
        line.priceTypeCode ?? line.unitCode ?? (line.itemKind === 'PACKAGE' ? 'Trọn gói' : 'Mọi loại giá / mọi bậc'),
        line.baseAmount ?? '',
        line.mode === 'PERCENT_OFF' ? 'Giảm %' : 'Giá mới',
        line.mode === 'PERCENT_OFF' ? `${line.value}%` : line.value,
        line.finalAmount ?? '',
      ]);
    }
    sheet.columns = [{ width: 18 }, { width: 16 }, { width: 44 }, { width: 24 }, { width: 18 }, { width: 12 }, { width: 14 }, { width: 18 }];
    for (const col of [5, 8]) sheet.getColumn(col).numFmt = '#,##0';

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
