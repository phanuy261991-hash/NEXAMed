import type { PharmacyControlledReport, PharmacyDispensedReport, PharmacyMarginReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { CONTROLLED_FILTER_ITEMS, CONTROLLED_TYPE_LABEL, formatMarginPercent, PHARMACY_ITEM_FILTER_LABEL, PHARMACY_ITEM_TYPE_LABEL } from './pharmacy-model';

/**
 * Hàm THUẦN đổi báo cáo Thuốc và vật tư (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy qua
 * loại chứng từ `REPORT`. Số tiền không hậu tố "đ" (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
export interface PharmacyPrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number): string => value.toLocaleString('vi-VN');
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;

function subtitle(ctx: PharmacyPrintContext, filterLine: string): string[] {
  return [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : []), filterLine];
}

export function buildPharmacyDispensedPrintSpec(report: PharmacyDispensedReport, ctx: PharmacyPrintContext): ReportPrintSpec {
  const capped = report.itemCount > report.rows.length;
  return {
    title: 'Thuốc và vật tư đã phát',
    subtitleLines: subtitle(ctx, `Loại: ${PHARMACY_ITEM_FILTER_LABEL[report.itemType]}`),
    infoLines: [
      `Mặt hàng: ${n(report.itemCount)} · Phiếu xuất kho: ${n(report.issueCount)} · Giá trị thực phát: ${n(report.amount)} · Khách trả lại: ${n(report.returnedAmount)}`,
      'Theo phiếu xuất kho bán theo đơn đã ghi sổ. Số lượng theo đơn vị cơ sở; giá trị theo giá bán, trước chiết khấu.',
    ],
    sections: [
      {
        columns: [
          { header: 'Mã' },
          { header: 'Mặt hàng' },
          { header: 'Loại' },
          { header: 'ĐVT' },
          { header: 'Đã xuất', align: 'right' },
          { header: 'Khách trả lại', align: 'right' },
          { header: 'Thực phát', align: 'right' },
          { header: 'Số phiếu', align: 'right' },
          { header: 'Giá trị thực phát', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.code, r.name, PHARMACY_ITEM_TYPE_LABEL[r.itemType], r.unitName, n(r.quantity), n(r.returnedQuantity), n(r.netQuantity), n(r.issueCount), n(r.amount)]),
        emptyText: 'Không có thuốc hay vật tư nào được phát trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} mặt hàng có giá trị cao nhất trong ${n(report.itemCount)} mặt hàng.` : undefined,
  };
}

export function buildPharmacyMarginPrintSpec(report: PharmacyMarginReport, ctx: PharmacyPrintContext): ReportPrintSpec {
  const t = report.totals;
  const capped = t.itemCount > report.rows.length;
  return {
    title: 'Lãi gộp thuốc và vật tư',
    subtitleLines: subtitle(ctx, `Loại: ${PHARMACY_ITEM_FILTER_LABEL[report.itemType]}`),
    infoLines: [
      `Tiền bán: ${n(t.sell)} · Giá vốn: ${n(t.cost)} · Lãi gộp: ${n(t.margin)} · Biên lãi gộp: ${formatMarginPercent(t.marginPercent)}`,
      'Tiền bán: theo ngày khám, sau chiết khấu, đã trừ phần hoàn. Giá vốn: theo thẻ kho. Chỉ tính thuốc, vật tư; chưa trừ nhân sự, mặt bằng, khấu hao.',
    ],
    sections: [
      {
        columns: [
          { header: 'Mặt hàng' },
          { header: 'Loại' },
          { header: 'ĐVT' },
          { header: 'Số lượng', align: 'right' },
          { header: 'Tiền bán', align: 'right' },
          { header: 'Giá vốn', align: 'right' },
          { header: 'Lãi gộp', align: 'right' },
          { header: 'Biên lãi gộp', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.name, PHARMACY_ITEM_TYPE_LABEL[r.itemType], r.unitName, n(r.quantity), n(r.sell), n(r.cost), n(r.margin), formatMarginPercent(r.marginPercent)]),
        totalRows: [[`Cộng ${n(t.itemCount)} mặt hàng`, '', '', '', n(t.sell), n(t.cost), n(t.margin), formatMarginPercent(t.marginPercent)]],
        emptyText: 'Không có thuốc hay vật tư nào được bán trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} mặt hàng có lãi gộp cao nhất trong ${n(t.itemCount)} mặt hàng; dòng Cộng tính trên tất cả.` : undefined,
  };
}

export function buildPharmacyControlledPrintSpec(report: PharmacyControlledReport, ctx: PharmacyPrintContext): ReportPrintSpec {
  const filterLabel = CONTROLLED_FILTER_ITEMS.find((i) => i.id === report.controlType)?.label ?? 'Tất cả';
  const capped = report.entryCount > report.entries.length;
  const multiBranch = report.branchCount > 1;
  return {
    title: 'Thuốc kiểm soát đặc biệt',
    subtitleLines: subtitle(ctx, `Phân loại: ${filterLabel}`),
    infoLines: [`Mặt hàng: ${n(report.itemCount)} · Lượt phát cho người bệnh: ${n(report.entryCount)}`, 'Số liệu theo thẻ kho, đơn vị cơ sở. Đây là bảng theo dõi nội bộ, không phải mẫu báo cáo gửi cơ quan quản lý.'],
    sections: [
      {
        title: 'Tồn kho và biến động',
        columns: [
          { header: 'Mã' },
          { header: 'Mặt hàng' },
          { header: 'Phân loại' },
          { header: 'ĐVT' },
          { header: 'Tồn đầu kỳ', align: 'right' },
          { header: 'Nhập', align: 'right' },
          { header: 'Phát cho người bệnh', align: 'right' },
          { header: 'Xuất khác', align: 'right' },
          { header: 'Tồn cuối kỳ', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.code, r.name, CONTROLLED_TYPE_LABEL[r.controlType], r.unitName, n(r.openingQuantity), n(r.receivedQuantity), n(r.dispensedQuantity), n(r.otherOutQuantity), n(r.closingQuantity)]),
        emptyText: 'Không có thuốc kiểm soát đặc biệt nào có tồn hoặc biến động trong kỳ đã chọn.',
      },
      {
        title: 'Từng lượt phát cho người bệnh',
        columns: [
          { header: 'Ngày' },
          { header: 'Số phiếu xuất' },
          { header: 'Mặt hàng' },
          { header: 'Phân loại' },
          { header: 'Số lượng', align: 'right' },
          { header: 'Mã bệnh nhân' },
          { header: 'Họ tên' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
        ],
        rows: report.entries.map((e) => [formatDobDisplay(e.date), e.issueNo, `${e.drugName} (${e.unitName})`, CONTROLLED_TYPE_LABEL[e.controlType], n(e.quantity), e.patientCode, e.patientName, ...(multiBranch ? [e.branchName] : [])]),
        emptyText: 'Không có lượt phát nào trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.entries.length)} lượt phát mới nhất trong ${n(report.entryCount)} lượt.` : undefined,
  };
}
