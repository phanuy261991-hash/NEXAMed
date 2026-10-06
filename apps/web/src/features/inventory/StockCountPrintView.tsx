import type { StockCountDetail } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';

function diffLabel(diff: number | null): string {
  if (diff === null) return '—';
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return 'Khớp';
}

/**
 * Bản in "Phiếu kiểm kê" (Kho Thuốc GĐ4, `docs/DECISIONS.md` #171) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument`
 * lo theo bản mẫu `STOCK_COUNT` (#211), file này chỉ giữ phần THÂN. CHỈ in phiếu ĐÃ DUYỆT (nơi gọi tự gate —
 * `difference` chỉ có giá trị thật sau khi Duyệt). Nhận dữ liệu qua props, không tự gọi API.
 */
export function StockCountPrintView({ count }: { count: StockCountDetail }) {
  return (
    <PrintDocument
      documentType="STOCK_COUNT"
      title="Phiếu kiểm kê"
      subtitle={
        <p>
          Số: <strong>{count.countNo}</strong>
        </p>
      }
      signatures={[{ label: 'Người kiểm kê' }, { label: 'Thủ kho' }, { label: 'Người duyệt', name: count.approvedByName }]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Kho kiểm kê: <strong>{count.warehouseName}</strong>
        </p>
        <p>
          Ngày kiểm kê: <strong>{formatPrintDate(count.occurredAt)}</strong>
        </p>
        <p>
          Người kiểm kê: <strong>{count.createdByName}</strong>
        </p>
        <p>
          Người duyệt: <strong>{count.approvedByName ?? '—'}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên hàng</th>
            <th className="w-28 py-1.5">Lô/HSD</th>
            <th className="w-20 py-1.5 text-right">Tồn hệ thống</th>
            <th className="w-20 py-1.5 text-right">Thực đếm</th>
            <th className="w-20 py-1.5 text-right">Chênh lệch</th>
          </tr>
        </thead>
        <tbody>
          {count.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">
                {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
              </td>
              <td className="py-1.5">{line.batchNo ? `${line.batchNo}${line.expiryDate ? ` · HSD ${line.expiryDate}` : ''}` : '—'}</td>
              <td className="py-1.5 text-right">{line.systemQuantitySnapshot}</td>
              <td className="py-1.5 text-right">{line.countedQuantity}</td>
              <td className="py-1.5 text-right font-semibold">{diffLabel(line.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {count.approvalReason && (
        <p className="mt-3">
          <span className="font-semibold">Lý do chênh lệch:</span> {count.approvalReason}
        </p>
      )}
      {count.note && (
        <p className="mt-1">
          <span className="font-semibold">Ghi chú:</span> {count.note}
        </p>
      )}
    </PrintDocument>
  );
}
