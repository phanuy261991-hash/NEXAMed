import type { StockIssueDetail, StockIssueType } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';

const TYPE_LABEL: Record<StockIssueType, string> = {
  RETAIL_SALE: 'Phát thuốc theo đơn',
  INTERNAL_ALLOCATION: 'Cấp phát nội bộ',
  SERVICE_CONSUMPTION: 'Tiêu hao dịch vụ',
  TRANSFER_OUT: 'Chuyển kho',
  RETURN_TO_SUPPLIER: 'Trả nhà cung cấp',
  WRITE_OFF: 'Xuất huỷ (hỏng/hết hạn)',
  COUNT_SHORTAGE: 'Xuất cân bằng kiểm kê',
};

/**
 * Bản in "Phiếu xuất kho" (Kho Thuốc GĐ3, `docs/DECISIONS.md` #171) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument`
 * lo theo bản mẫu `STOCK_ISSUE` (#211), file này chỉ giữ phần THÂN. CHỈ in phiếu ĐÃ XUẤT (`status='POSTED'`, nơi gọi
 * tự gate). Nhận dữ liệu qua props, không tự gọi API.
 */
export function StockIssuePrintView({ issue }: { issue: StockIssueDetail }) {
  return (
    <PrintDocument
      documentType="STOCK_ISSUE"
      title="Phiếu xuất kho"
      subtitle={
        <p>
          Số: <strong>{issue.issueNo}</strong>
        </p>
      }
      signatures={[{ label: 'Người lập phiếu', name: issue.createdByName }, { label: 'Người nhận hàng' }, { label: 'Thủ kho' }]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Loại phiếu: <strong>{TYPE_LABEL[issue.issueType]}</strong>
        </p>
        <p>
          Ngày xuất: <strong>{formatPrintDate(issue.occurredAt)}</strong>
        </p>
        <p>
          Kho xuất: <strong>{issue.warehouseName}</strong>
        </p>
        {issue.patientFullName && (
          <p>
            Bệnh nhân: <strong>{issue.patientFullName}</strong> {issue.patientCode && `(${issue.patientCode})`}
          </p>
        )}
        {issue.departmentName && (
          <p>
            Khoa/Phòng tiếp nhận: <strong>{issue.departmentName}</strong>
          </p>
        )}
        {issue.supplierName && (
          <p>
            Nhà cung cấp: <strong>{issue.supplierName}</strong>
          </p>
        )}
        {issue.sourceReceiptNo && (
          <p>
            Phiếu nhập gốc: <strong>{issue.sourceReceiptNo}</strong>
          </p>
        )}
        <p>
          Người lập phiếu: <strong>{issue.createdByName}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên hàng</th>
            <th className="w-28 py-1.5">Lô</th>
            <th className="w-16 py-1.5 text-right">SL</th>
            <th className="w-24 py-1.5 text-right">Đơn giá</th>
            <th className="w-28 py-1.5 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {issue.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">
                {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
              </td>
              <td className="py-1.5">{line.batchNo ?? '—'}</td>
              <td className="py-1.5 text-right">{line.quantity}</td>
              <td className="py-1.5 text-right">{formatVnd(issue.issueType === 'RETURN_TO_SUPPLIER' ? (line.returnUnitPrice ?? 0) : line.sellPrice)}</td>
              <td className="py-1.5 text-right">{formatVnd(line.lineAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end border-t-2 border-slate-800 pt-2 text-base font-bold">
        <span>
          {issue.issueType === 'RETURN_TO_SUPPLIER' ? 'Giá trị trừ công nợ' : 'Tổng cộng'}: {formatVnd(issue.totalAmount)}
        </span>
      </div>

      {issue.note && (
        <p className="mt-2">
          <span className="font-semibold">{issue.prescriptionId ? 'Ghi chú' : 'Lý do'}:</span> {issue.note}
        </p>
      )}
    </PrintDocument>
  );
}
