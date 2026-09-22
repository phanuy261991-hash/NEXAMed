import type { ClinicPrintHeader, StockIssueDetail, StockIssueType } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';

function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `Ngày ${String(vn.getUTCDate()).padStart(2, '0')} tháng ${String(vn.getUTCMonth() + 1).padStart(2, '0')} năm ${vn.getUTCFullYear()}`;
}

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
 * Bố cục in "Phiếu xuất kho" (Kho Thuốc GĐ3, bổ sung 22/09/2026, `docs/DECISIONS.md` #171) — đúng
 * khuôn `InvoicePrintView.tsx`/`StockReceiptPrintView.tsx`. CHỈ in phiếu ĐÃ XUẤT (`status='POSTED'`,
 * nơi gọi tự gate). Nhận dữ liệu qua props, không tự gọi API.
 */
export function StockIssuePrintView({ issue, clinicHeader }: { issue: StockIssueDetail; clinicHeader: ClinicPrintHeader }) {
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

      <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-wide">Phiếu xuất kho</h1>
      <p className="text-center text-sm">
        Số: <strong>{issue.issueNo}</strong>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
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
        <p>
          Người lập phiếu: <strong>{issue.createdByName}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
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
              <td className="py-1.5 text-right">{formatVnd(line.sellPrice)}</td>
              <td className="py-1.5 text-right">{formatVnd(line.lineAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end border-t-2 border-slate-800 pt-2 text-base font-bold">
        <span>Tổng cộng: {formatVnd(issue.totalAmount)}</span>
      </div>

      {issue.note && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Ghi chú:</span> {issue.note}
        </p>
      )}

      <div className="mt-12 flex justify-between text-center text-sm">
        <div>
          <p className="font-semibold">Người lập phiếu</p>
          <p className="mt-14 font-semibold">{issue.createdByName}</p>
        </div>
        <div>
          <p className="font-semibold">Người nhận hàng</p>
          <p className="mt-14 text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
        </div>
        <div>
          <p className="font-semibold">Thủ kho</p>
          <p className="mt-14 text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
        </div>
      </div>
    </div>
  );
}
