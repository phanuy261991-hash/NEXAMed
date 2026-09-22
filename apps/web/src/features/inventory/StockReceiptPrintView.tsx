import type { ClinicPrintHeader, StockReceiptDetail, StockReceiptType } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { unitLabel } from '../drug/useUnitNameByCode';

function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `Ngày ${String(vn.getUTCDate()).padStart(2, '0')} tháng ${String(vn.getUTCMonth() + 1).padStart(2, '0')} năm ${vn.getUTCFullYear()}`;
}

const TYPE_LABEL: Record<StockReceiptType, string> = {
  PURCHASE: 'Nhập nhà cung cấp',
  OPENING_BALANCE: 'Nhập khởi tạo (Đầu kỳ)',
  TRANSFER_IN: 'Nhập chuyển kho',
  RETURN_FROM_USE: 'Nhập hoàn trả',
  COUNT_SURPLUS: 'Nhập cân bằng kiểm kê',
};

/**
 * Bố cục in "Phiếu nhập kho" (Kho Thuốc GĐ2, bổ sung 22/09/2026, `docs/DECISIONS.md` #171) — đúng
 * khuôn `InvoicePrintView.tsx`. CHỈ in phiếu ĐÃ DUYỆT (nơi gọi tự gate). Nhận dữ liệu qua props,
 * không tự gọi API.
 */
export function StockReceiptPrintView({
  receipt,
  clinicHeader,
  unitNameByCode,
}: {
  receipt: StockReceiptDetail;
  clinicHeader: ClinicPrintHeader;
  /** Mã đơn vị (UNIT) -> tên hiển thị (`useUnitNameByCode()`) — bắt buộc truyền vào, `unitCode` thô
   * (ví dụ "DV00001") không có ý nghĩa với người đọc phiếu in (chủ dự án phát hiện 22/09/2026). */
  unitNameByCode: Map<string, string>;
}) {
  return (
    <div className="print-area hidden bg-white p-10 text-slate-900 print:block">
      <div className="flex items-center gap-4 border-b-2 border-slate-800 pb-3">
        {clinicHeader.printLogoUrl && <img src={clinicHeader.printLogoUrl} alt="" className="h-16 w-16 object-contain" />}
        <div>
          <p className="text-lg font-bold uppercase">{clinicHeader.name}</p>
          {clinicHeader.address && <p className="text-sm">Địa chỉ: {clinicHeader.address}</p>}
          {clinicHeader.phone && <p className="text-sm">Điện thoại: {clinicHeader.phone}</p>}
        </div>
      </div>

      <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-wide">Phiếu nhập kho</h1>
      <p className="text-center text-sm">
        Số: <strong>{receipt.receiptNo}</strong>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
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

      <table className="mt-6 w-full border-collapse text-sm">
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
        <p className="mt-2 text-sm">
          <span className="font-semibold">Ghi chú:</span> {receipt.note}
        </p>
      )}

      <div className="mt-12 flex justify-between text-center text-sm">
        <div>
          <p className="font-semibold">Người lập phiếu</p>
          <p className="mt-14 font-semibold">{receipt.createdByName}</p>
        </div>
        <div>
          <p className="font-semibold">Người giao hàng</p>
          <p className="mt-14 text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
        </div>
        <div>
          <p className="font-semibold">Thủ kho</p>
          <p className="mt-14 font-semibold">{receipt.approvedByName ?? ''}</p>
        </div>
      </div>
    </div>
  );
}
