import type { StockTransferDetail } from '@nexamed/shared';
import { formatPrintDate } from '../../shared/format/print-date';
import { PrintDocument } from '../../shared/print/PrintDocument';

/**
 * Bản in "Phiếu điều chuyển kho" (Kho Thuốc GĐ4, `docs/DECISIONS.md` #173/#174) — khung/đầu trang/chữ ký/khổ giấy do
 * `PrintDocument` lo theo bản mẫu `STOCK_TRANSFER` (#211), file này chỉ giữ phần THÂN. Một phiếu DÙNG CHUNG cho CẢ
 * HAI kho: kho NGUỒN in ngay sau khi Duyệt xuất (status `IN_TRANSIT`, cột "SL thực nhận" còn trống) để kèm theo hàng;
 * kho ĐÍCH in lại/in mới sau khi Xác nhận nhận hàng (status `COMPLETED`, đủ "SL thực nhận" + ghi chú chênh lệch) để
 * lưu hồ sơ nhận hàng — cùng 1 component tự đổi nội dung theo dữ liệu đã có. Không hiển thị giá vốn/thành tiền —
 * "Điều chuyển kho" không phải chứng từ Thu/Chi. CHỈ in được phiếu `IN_TRANSIT`/`COMPLETED` (nơi gọi tự gate). Nhận
 * dữ liệu qua props, không tự gọi API.
 */
export function StockTransferPrintView({ transfer }: { transfer: StockTransferDetail }) {
  const isCompleted = transfer.status === 'COMPLETED';

  return (
    <PrintDocument
      documentType="STOCK_TRANSFER"
      title="Phiếu điều chuyển kho"
      subtitle={
        <p>
          Số: <strong>{transfer.transferNo}</strong>
        </p>
      }
      signatures={[
        { label: 'Người lập phiếu', name: transfer.createdByName },
        { label: 'Thủ kho nguồn (giao hàng)', name: transfer.shippedByName },
        { label: 'Thủ kho đích (nhận hàng)', name: isCompleted ? transfer.receivedByName : null },
      ]}
    >
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          Kho nguồn (xuất): <strong>{transfer.fromWarehouseName}</strong>
        </p>
        <p>
          Kho đích (nhận): <strong>{transfer.toWarehouseName}</strong>
        </p>
        <p>
          Ngày xuất: <strong>{transfer.shippedAt ? formatPrintDate(transfer.shippedAt) : '—'}</strong>
        </p>
        <p>
          Người duyệt xuất: <strong>{transfer.shippedByName ?? '—'}</strong>
        </p>
        {isCompleted && (
          <>
            <p>
              Ngày nhận: <strong>{transfer.receivedAt ? formatPrintDate(transfer.receivedAt) : '—'}</strong>
            </p>
            <p>
              Người xác nhận nhận hàng: <strong>{transfer.receivedByName ?? '—'}</strong>
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
            <th className="w-20 py-1.5 text-right">SL đã xuất</th>
            <th className="w-20 py-1.5 text-right">SL thực nhận</th>
            <th className="py-1.5 text-left">Ghi chú chênh lệch</th>
          </tr>
        </thead>
        <tbody>
          {transfer.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5 font-semibold">
                {line.drugName} <span className="font-normal text-slate-500">({line.drugCode})</span>
              </td>
              <td className="py-1.5">{line.batchNo ? `${line.batchNo}${line.expiryDate ? ` · HSD ${line.expiryDate}` : ''}` : '—'}</td>
              <td className="py-1.5 text-right">{line.quantityShipped}</td>
              <td className="py-1.5 text-right">{line.quantityReceived ?? '—'}</td>
              <td className="py-1.5">{line.varianceNote ?? '—'}</td>
            </tr>
          ))}
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
