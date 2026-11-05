import { CONTROLLED_TYPE_LABEL, PHARMACY_CONTROLLED_ENTRY_LIMIT, PHARMACY_ITEM_TYPE_LABEL, PHARMACY_ROW_LIMIT } from '@nexamed/shared';
import type { PharmacyControlledReport, PharmacyDispensedReport, PharmacyMarginReport } from '@nexamed/shared';
import { formatReportDate, type ReportExcelHeader } from '../../common/report-excel-header';
import { buildTableReportExcel } from '../../common/report-table-excel';
import type { OperationsExcelContext } from './operations-report-export';

/**
 * Bản Excel của trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn;
 * ô số ghi SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
export type PharmacyExcelContext = OperationsExcelContext;

const ITEM_FILTER_LABEL = { ALL: 'Tất cả', MEDICINE: 'Thuốc', SUPPLY: 'Vật tư y tế' } as const;
const CONTROL_FILTER_LABEL = { ALL: 'Tất cả', ...CONTROLLED_TYPE_LABEL } as const;
const money = (value: number): string => value.toLocaleString('vi-VN');
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);

function header(ctx: PharmacyExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

export function buildPharmacyDispensedExcel(report: PharmacyDispensedReport, ctx: PharmacyExcelContext): Promise<Buffer> {
  const capped = report.itemCount > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Đã phát',
      header: header(ctx, 'Thuốc và vật tư đã phát', report.from, report.to),
      infoLines: [
        `Loại: ${ITEM_FILTER_LABEL[report.itemType]} · Mặt hàng: ${report.itemCount.toLocaleString('vi-VN')} · Phiếu xuất kho: ${report.issueCount.toLocaleString('vi-VN')} · Giá trị thực phát: ${money(report.amount)} · Khách trả lại: ${money(report.returnedAmount)}`,
        'Theo phiếu xuất kho bán theo đơn đã ghi sổ (phiếu đã huỷ không tính). Số lượng theo đơn vị cơ sở; giá trị theo giá bán, trước chiết khấu.',
      ],
      sections: [
        {
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Mã', width: 16 },
            { header: 'Mặt hàng', width: 38 },
            { header: 'Loại', width: 10 },
            { header: 'ĐVT', width: 10 },
            { header: 'Đã xuất', width: 12, numeric: true },
            { header: 'Khách trả lại', width: 14, numeric: true },
            { header: 'Thực phát', width: 12, numeric: true },
            { header: 'Số phiếu', width: 10, numeric: true },
            { header: 'Giá trị thực phát', width: 18, numeric: true },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.code, r.name, PHARMACY_ITEM_TYPE_LABEL[r.itemType], r.unitName, r.quantity, r.returnedQuantity, r.netQuantity, r.issueCount, r.amount]),
          emptyText: 'Không có thuốc hay vật tư nào được phát trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${PHARMACY_ROW_LIMIT.toLocaleString('vi-VN')} mặt hàng có giá trị cao nhất trong ${report.itemCount.toLocaleString('vi-VN')} mặt hàng.` : undefined,
    },
  ]);
}

export function buildPharmacyMarginExcel(report: PharmacyMarginReport, ctx: PharmacyExcelContext): Promise<Buffer> {
  const t = report.totals;
  const capped = t.itemCount > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Lãi gộp',
      header: header(ctx, 'Lãi gộp thuốc và vật tư', report.from, report.to),
      infoLines: [
        `Loại: ${ITEM_FILTER_LABEL[report.itemType]} · Tiền bán: ${money(t.sell)} · Giá vốn: ${money(t.cost)} · Lãi gộp: ${money(t.margin)} · Biên lãi gộp: ${pct(t.marginPercent)}`,
        'Tiền bán: theo ngày khám, sau chiết khấu, đã trừ phần hoàn. Giá vốn: theo thẻ kho lúc xuất. Chỉ tính thuốc, vật tư; chưa trừ nhân sự, mặt bằng, khấu hao.',
      ],
      sections: [
        {
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Mã', width: 16 },
            { header: 'Mặt hàng', width: 38 },
            { header: 'Loại', width: 10 },
            { header: 'ĐVT', width: 10 },
            { header: 'Số lượng', width: 12, numeric: true },
            { header: 'Tiền bán', width: 18, numeric: true },
            { header: 'Giá vốn', width: 18, numeric: true },
            { header: 'Lãi gộp', width: 18, numeric: true },
            { header: 'Biên lãi gộp', width: 14 },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.code, r.name, PHARMACY_ITEM_TYPE_LABEL[r.itemType], r.unitName, r.quantity, r.sell, r.cost, r.margin, pct(r.marginPercent)]),
          totalRows: [['Cộng', '', `${t.itemCount.toLocaleString('vi-VN')} mặt hàng`, '', '', '', t.sell, t.cost, t.margin, pct(t.marginPercent)]],
          emptyText: 'Không có thuốc hay vật tư nào được bán trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${PHARMACY_ROW_LIMIT.toLocaleString('vi-VN')} mặt hàng có lãi gộp cao nhất trong ${t.itemCount.toLocaleString('vi-VN')} mặt hàng; dòng Cộng tính trên tất cả.` : undefined,
    },
  ]);
}

export function buildPharmacyControlledExcel(report: PharmacyControlledReport, multiBranch: boolean, ctx: PharmacyExcelContext): Promise<Buffer> {
  const capped = report.entryCount > report.entries.length;
  return buildTableReportExcel([
    {
      name: 'Kiểm soát đặc biệt',
      header: header(ctx, 'Thuốc kiểm soát đặc biệt', report.from, report.to),
      infoLines: [
        `Phân loại: ${CONTROL_FILTER_LABEL[report.controlType]} · Mặt hàng: ${report.itemCount.toLocaleString('vi-VN')} · Lượt phát cho người bệnh: ${report.entryCount.toLocaleString('vi-VN')}`,
        'Số liệu theo thẻ kho, đơn vị cơ sở. Đây là bảng theo dõi nội bộ, không phải mẫu báo cáo gửi cơ quan quản lý.',
      ],
      sections: [
        {
          title: 'Tồn kho và biến động',
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Mã', width: 16 },
            { header: 'Mặt hàng', width: 38 },
            { header: 'Phân loại', width: 14 },
            { header: 'ĐVT', width: 10 },
            { header: 'Tồn đầu kỳ', width: 14, numeric: true },
            { header: 'Nhập', width: 12, numeric: true },
            { header: 'Phát cho người bệnh', width: 20, numeric: true },
            { header: 'Xuất khác', width: 12, numeric: true },
            { header: 'Tồn cuối kỳ', width: 14, numeric: true },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.code, r.name, CONTROLLED_TYPE_LABEL[r.controlType], r.unitName, r.openingQuantity, r.receivedQuantity, r.dispensedQuantity, r.otherOutQuantity, r.closingQuantity]),
          emptyText: 'Không có thuốc kiểm soát đặc biệt nào có tồn hoặc biến động trong kỳ đã chọn.',
        },
        {
          title: 'Từng lượt phát cho người bệnh',
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Ngày', width: 13 },
            { header: 'Số phiếu xuất', width: 18 },
            { header: 'Mã', width: 16 },
            { header: 'Mặt hàng', width: 34 },
            { header: 'Phân loại', width: 14 },
            { header: 'ĐVT', width: 10 },
            { header: 'Số lượng', width: 12, numeric: true },
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Họ tên', width: 26 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
          ],
          rows: report.entries.map((e, i) => [i + 1, formatReportDate(e.date), e.issueNo, e.drugCode, e.drugName, CONTROLLED_TYPE_LABEL[e.controlType], e.unitName, e.quantity, e.patientCode, e.patientName, ...(multiBranch ? [e.branchName] : [])]),
          emptyText: 'Không có lượt phát nào trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${PHARMACY_CONTROLLED_ENTRY_LIMIT.toLocaleString('vi-VN')} lượt phát mới nhất trong ${report.entryCount.toLocaleString('vi-VN')} lượt.` : undefined,
    },
  ]);
}
