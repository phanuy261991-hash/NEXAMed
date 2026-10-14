import type { StockTransferDetail } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';
import { VARIANCE_REASON_LABEL } from './stock-transfer-meta';

/**
 * Bản in "Phiếu điều chuyển kho" / "Biên bản kiểm nhận" (Kho Thuốc GĐ4, `docs/DECISIONS.md` #173/#174; Đợt 2 chi nhánh #233) — khung/đầu trang/chữ
 * ký/khổ giấy do `PrintDocument` lo theo bản mẫu `STOCK_TRANSFER` (#211), file này chỉ giữ phần THÂN. Một phiếu DÙNG CHUNG cho CẢ HAI bên: bên GỬI in ngay
 * sau Duyệt xuất để kèm hàng (cột nhận còn trống); sau khi bên nhận kiểm nhận, bản in tự thêm số thực nhận, chênh lệch, lý do và ô ký của người nhận.
 * Đầu phiếu lấy theo chi nhánh GỬI (phiếu thuộc chi nhánh gửi). KHÔNG in giá vốn/thành tiền ở bất kỳ bản nào — "Điều chuyển kho" không phải chứng
 * từ Thu/Chi và chi nhánh nhận không được thấy giá vốn. Nhận dữ liệu qua props, không tự gọi API.
 */
export function StockTransferPrintView({ transfer }: { transfer: StockTransferDetail }) {
  const received = transfer.receivedAt !== null;
  const crossBranch = transfer.fromBranchId !== transfer.toBranchId;

  return (
    <PrintDocument
      documentType="STOCK_TRANSFER"
      branchId={transfer.fromBranchId}
      title={received ? 'Biên bản kiểm nhận điều chuyển kho' : 'Phiếu điều chuyển kho'}
      subtitle={
        <p>
          Số: <strong>{transfer.transferNo}</strong>
        </p>
      }
      signatures={[
        { label: 'Người lập phiếu', name: transfer.createdByName },
        { label: 'Thủ kho nguồn (giao hàng)', name: transfer.shippedByName },
        { label: 'Thủ kho đích (nhận hàng)', name: received ? transfer.receivedByName : null },
      ]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Kho nguồn (xuất): <strong>{transfer.fromWarehouseName}</strong>
        </p>
        <p>
          Nhận tại: <strong>{crossBranch ? `${transfer.toBranchName} / ${transfer.toWarehouseName}` : transfer.toWarehouseName}</strong>
        </p>
        <p>
          Ngày xuất: <strong>{transfer.shippedAt ? formatPrintDate(transfer.shippedAt) : '—'}</strong>
        </p>
        <p>
          Người duyệt xuất: <strong>{transfer.shippedByName ?? '—'}</strong>
        </p>
        {received && (
          <>
            <p>
              Ngày kiểm nhận: <strong>{transfer.receivedAt ? formatPrintDate(transfer.receivedAt) : '—'}</strong>
            </p>
            <p>
              Người kiểm nhận: <strong>{transfer.receivedByName ?? '—'}</strong>
            </p>
          </>
        )}
        <p>
          Người lập phiếu: <strong>{transfer.createdByName}</strong>
        </p>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Tên hàng</th>
            <th className="w-28 py-1.5">Lô/HSD</th>
            <th className="w-20 py-1.5 text-right">SL phiếu</th>
            <th className="w-20 py-1.5 text-right">Thực nhận</th>
            <th className="w-20 py-1.5 text-right">Chênh lệch</th>
            <th className="py-1.5 text-left">Lý do / ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {transfer.lines.map((line, i) => {
            const diff = line.quantityReceived === null ? null : line.quantityReceived - line.quantityShipped;
            const reason = line.varianceReason ? VARIANCE_REASON_LABEL[line.varianceReason] : null;
            return (
              <tr key={line.id} className="border-b border-slate-300 align-top">
                <td className="py-1.5">{i + 1}</td>
                <td className="py-1.5 font-semibold">
                  {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
                </td>
                <td className="py-1.5">{line.batchNo ? `${line.batchNo}${line.expiryDate ? ` · HSD ${line.expiryDate}` : ''}` : '—'}</td>
                <td className="py-1.5 text-right">{line.quantityShipped}</td>
                <td className="py-1.5 text-right">{line.quantityReceived ?? '—'}</td>
                <td className="py-1.5 text-right">{diff === null ? '—' : diff === 0 ? '0' : diff}</td>
                <td className="py-1.5">{[reason, line.varianceNote && line.varianceNote !== reason ? line.varianceNote : null].filter(Boolean).join(': ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {transfer.note && (
        <p className="mt-3">
          <span className="font-semibold">Ghi chú phiếu:</span> {transfer.note}
        </p>
      )}
    </PrintDocument>
  );
}
