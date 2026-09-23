import type { ClinicPrintHeader, StockTransferDetail } from '@nexamed/shared';

function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `Ngày ${String(vn.getUTCDate()).padStart(2, '0')} tháng ${String(vn.getUTCMonth() + 1).padStart(2, '0')} năm ${vn.getUTCFullYear()}`;
}

/**
 * Bố cục in "Phiếu điều chuyển kho" (Kho Thuốc GĐ4, bổ sung 23/09/2026, chủ dự án yêu cầu trực
 * tiếp sau khi verify "Điều chuyển kho" — xem `docs/DECISIONS.md` #173) — đúng khuôn
 * `StockReceiptPrintView.tsx`/`StockIssuePrintView.tsx`. Một phiếu DÙNG CHUNG cho CẢ HAI kho: kho
 * NGUỒN in ngay sau khi Duyệt xuất (status `IN_TRANSIT`, cột "SL thực nhận" còn trống) để kèm theo
 * hàng; kho ĐÍCH in lại/in mới sau khi Xác nhận nhận hàng (status `COMPLETED`, cột "SL thực nhận"
 * + ghi chú chênh lệch đã có đủ) để lưu hồ sơ nhận hàng — không phải 2 bố cục riêng, cùng 1
 * component tự đổi nội dung theo dữ liệu đã có trên phiếu. Không hiển thị giá vốn/thành tiền —
 * "Điều chuyển kho" không phải chứng từ Thu/Chi, giá chỉ snapshot nội bộ để tính giá vốn liên hoàn.
 * Nhận dữ liệu qua props, không tự gọi API. CHỈ in được phiếu `IN_TRANSIT`/`COMPLETED` (nơi gọi tự
 * gate — `DRAFT` chưa xuất kho, `REJECTED` không có hàng di chuyển).
 */
export function StockTransferPrintView({ transfer, clinicHeader }: { transfer: StockTransferDetail; clinicHeader: ClinicPrintHeader }) {
  const isCompleted = transfer.status === 'COMPLETED';

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

      <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-wide">Phiếu điều chuyển kho</h1>
      <p className="text-center text-sm">
        Số: <strong>{transfer.transferNo}</strong>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
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

      <table className="mt-6 w-full border-collapse text-sm">
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
        <p className="mt-3 text-sm">
          <span className="font-semibold">Ghi chú phiếu:</span> {transfer.note}
        </p>
      )}

      <div className="mt-12 flex justify-between text-center text-sm">
        <div>
          <p className="font-semibold">Người lập phiếu</p>
          <p className="mt-14 font-semibold">{transfer.createdByName}</p>
        </div>
        <div>
          <p className="font-semibold">Thủ kho nguồn (giao hàng)</p>
          <p className="mt-14 font-semibold">{transfer.shippedByName ?? ''}</p>
        </div>
        <div>
          <p className="font-semibold">Thủ kho đích (nhận hàng)</p>
          <p className="mt-14 font-semibold">{isCompleted ? (transfer.receivedByName ?? '') : ''}</p>
          {!isCompleted && <p className="text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>}
        </div>
      </div>
    </div>
  );
}
