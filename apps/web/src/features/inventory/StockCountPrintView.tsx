import type { ClinicPrintHeader, StockCountDetail } from '@nexamed/shared';

function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `Ngày ${String(vn.getUTCDate()).padStart(2, '0')} tháng ${String(vn.getUTCMonth() + 1).padStart(2, '0')} năm ${vn.getUTCFullYear()}`;
}

function diffLabel(diff: number | null): string {
  if (diff === null) return '—';
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return 'Khớp';
}

/**
 * Bố cục in "Phiếu kiểm kê" (Kho Thuốc GĐ4, rà soát lỗ hổng quy trình 22/09/2026, `docs/DECISIONS.md`
 * #171) — đúng khuôn `InvoicePrintView.tsx`/`CashVoucherPrintView.tsx` (`.print-area`, hạ tầng in
 * chung `apps/web/src/app/index.css`). CHỈ in phiếu ĐÃ DUYỆT (nơi gọi tự gate — `difference` chỉ có
 * giá trị thật sau khi Duyệt). Nhận dữ liệu qua props, không tự gọi API.
 */
export function StockCountPrintView({ count, clinicHeader }: { count: StockCountDetail; clinicHeader: ClinicPrintHeader }) {
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

      <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-wide">Phiếu kiểm kê</h1>
      <p className="text-center text-sm">
        Số: <strong>{count.countNo}</strong>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
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

      <table className="mt-6 w-full border-collapse text-sm">
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
        <p className="mt-3 text-sm">
          <span className="font-semibold">Lý do chênh lệch:</span> {count.approvalReason}
        </p>
      )}
      {count.note && (
        <p className="mt-1 text-sm">
          <span className="font-semibold">Ghi chú:</span> {count.note}
        </p>
      )}

      <div className="mt-12 flex justify-between text-center text-sm">
        <div>
          <p className="font-semibold">Người kiểm kê</p>
          <p className="mt-14 text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
        </div>
        <div>
          <p className="font-semibold">Thủ kho</p>
          <p className="mt-14 text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
        </div>
        <div>
          <p className="font-semibold">Người duyệt</p>
          <p className="mt-14 font-semibold">{count.approvedByName ?? ''}</p>
        </div>
      </div>
    </div>
  );
}
