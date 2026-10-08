import type { StockReceiptDetail, StockReceiptType } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { unitLabel } from '../drug/useUnitNameByCode';

const TYPE_LABEL: Record<StockReceiptType, string> = {
  PURCHASE: 'Nhập nhà cung cấp',
  OPENING_BALANCE: 'Nhập khởi tạo (Đầu kỳ)',
  TRANSFER_IN: 'Nhập chuyển kho',
  RETURN_FROM_USE: 'Nhập hoàn trả',
  COUNT_SURPLUS: 'Nhập cân bằng kiểm kê',
};

/**
 * Bản in "Phiếu nhập kho" (Kho Thuốc GĐ2, `docs/DECISIONS.md` #171) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument`
 * lo theo bản mẫu `STOCK_RECEIPT` (#211), file này chỉ giữ phần THÂN. CHỈ in phiếu ĐÃ DUYỆT (nơi gọi tự gate). Nhận dữ
 * liệu qua props, không tự gọi API.
 */
export function StockReceiptPrintView({
  receipt,
  unitNameByCode,
}: {
  receipt: StockReceiptDetail;
  /** Mã đơn vị (UNIT) -> tên hiển thị (`useUnitNameByCode()`) — bắt buộc truyền vào, `unitCode` thô
   * (ví dụ "DV00001") không có ý nghĩa với người đọc phiếu in (chủ dự án phát hiện 22/09/2026). */
  unitNameByCode: Map<string, string>;
}) {
  return (
    <PrintDocument
      documentType="STOCK_RECEIPT"
      title="Phiếu nhập kho"
      subtitle={
        <p>
          Số: <strong>{receipt.receiptNo}</strong>
        </p>
      }
      signatures={[{ label: 'Người lập phiếu', name: receipt.createdByName }, { label: 'Người giao hàng' }, { label: 'Thủ kho', name: receipt.approvedByName }]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Loại phiếu: <strong>{TYPE_LABEL[receipt.receiptType]}</strong>
        </p>
        <p>
          Ngày nhập: <strong>{formatPrintDate(receipt.occurredAt)}</strong>
        </p>
        <p>
          Kho nhập: <strong>{receipt.warehouseName}</strong>
        </p>
        {receipt.supplierName && (
          <p>
            Nhà cung cấp: <strong>{receipt.supplierName}</strong>
          </p>
        )}
        {receipt.supplierInvoiceNo && (
          <p>
            Mã hoá đơn NCC: <strong>{receipt.supplierInvoiceNo}</strong>
          </p>
        )}
        <p>
          Người lập phiếu: <strong>{receipt.createdByName}</strong>
        </p>
        <p>
          Người duyệt: <strong>{receipt.approvedByName ?? '—'}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên hàng</th>
            <th className="w-28 py-1.5">Lô/HSD</th>
            <th className="w-16 py-1.5 text-center">ĐVT</th>
            <th className="w-16 py-1.5 text-right">SL</th>
            <th className="w-24 py-1.5 text-right">Giá vốn</th>
            <th className="w-28 py-1.5 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">
                {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
              </td>
              <td className="py-1.5">{line.batchNo ? `${line.batchNo}${line.expiryDate ? ` · HSD ${line.expiryDate}` : ''}` : '—'}</td>
              <td className="py-1.5 text-center">{unitLabel(unitNameByCode, line.unitCode)}</td>
              <td className="py-1.5 text-right">{line.quantity}</td>
              <td className="py-1.5 text-right">{formatVnd(line.unitCost)}</td>
              <td className="py-1.5 text-right">{formatVnd(line.lineAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end border-t-2 border-slate-800 pt-2 text-base font-bold">
        <span>Tổng cộng: {formatVnd(receipt.totalAmount)}</span>
      </div>

      {receipt.note && (
        <p className="mt-2">
          <span className="font-semibold">Ghi chú:</span> {receipt.note}
        </p>
      )}
    </PrintDocument>
  );
}
