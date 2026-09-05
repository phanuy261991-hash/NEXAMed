import type { CashVoucher, ClinicPrintHeader } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';

function formatPrintDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} ngày ${String(vn.getUTCDate()).padStart(2, '0')} tháng ${String(vn.getUTCMonth() + 1).padStart(2, '0')} năm ${vn.getUTCFullYear()}`;
}

/**
 * Khổ in Phiếu thu/chi (Sổ quỹ & Thu chi GĐ1) — A5 (128mm), đúng khuôn `InvoicePrintView.tsx`/
 * `CashierShiftReceiptView.tsx` (`.print-area`, hạ tầng in chung `apps/web/src/app/index.css`).
 * Tên hiển thị của `incomeExpenseTypeCode`/`cashAccountId`/`paymentMethodCode` do nơi gọi tự map
 * từ danh mục đã tải sẵn (không resolve ở backend — xem comment `cashVoucherSchema`).
 */
export function CashVoucherPrintView({
  voucher,
  clinicHeader,
  incomeExpenseTypeLabel,
  cashAccountName,
  paymentMethodLabel,
}: {
  voucher: CashVoucher;
  clinicHeader: ClinicPrintHeader;
  incomeExpenseTypeLabel: string;
  cashAccountName: string;
  paymentMethodLabel: string;
}) {
  const isIncome = voucher.direction === 'INCOME';
  return (
    <div className="print-area shrink-0 bg-white shadow-sm" style={{ width: '128mm' }}>
      <div className="p-8">
        <div className="mb-6 flex items-center gap-3 border-b-2 border-slate-800 pb-3">
          {clinicHeader.printLogoUrl && <img src={clinicHeader.printLogoUrl} alt="" className="h-12 w-12 object-contain" />}
          <div>
            <p className="text-sm font-bold uppercase text-slate-900">{clinicHeader.name}</p>
            {clinicHeader.address && <p className="text-xs text-slate-500">{clinicHeader.address}</p>}
            {clinicHeader.phone && <p className="text-xs text-slate-500">ĐT: {clinicHeader.phone}</p>}
          </div>
        </div>

        <h1 className="text-center text-xl font-bold uppercase tracking-wide text-slate-900">{isIncome ? 'Phiếu thu' : 'Phiếu chi'}</h1>
        <p className="text-center text-xs text-slate-500">{formatPrintDateTime(voucher.occurredAt)}</p>
        <p className="mt-1 text-center text-sm">
          Số: <strong>{voucher.voucherNo}</strong>
        </p>

        <div className="mt-5 space-y-1.5 text-sm text-slate-700">
          <p>
            <span className="text-slate-400">{isIncome ? 'Người nộp tiền:' : 'Người nhận tiền:'}</span>{' '}
            <strong className="text-slate-900">{voucher.partnerName ?? '—'}</strong>
          </p>
          <p>
            <span className="text-slate-400">Lý do {isIncome ? 'thu' : 'chi'}:</span> <strong className="text-slate-900">{voucher.description}</strong>
          </p>
          <p>
            <span className="text-slate-400">Loại thu chi:</span> <strong className="text-slate-900">{incomeExpenseTypeLabel}</strong>
          </p>
          <p>
            <span className="text-slate-400">Hình thức:</span> <strong className="text-slate-900">{paymentMethodLabel}</strong>
          </p>
          <p>
            <span className="text-slate-400">Quỹ:</span> <strong className="text-slate-900">{cashAccountName}</strong>
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between border-y-2 border-slate-800 py-3">
          <span className="font-bold text-slate-900">Số tiền</span>
          <span className="text-lg font-bold text-slate-900">{formatVnd(voucher.amount)}</span>
        </div>

        {voucher.note && (
          <p className="mt-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Ghi chú:</span> {voucher.note}
          </p>
        )}

        <div className="mt-12 flex justify-between text-center text-sm">
          <div>
            <p className="font-semibold">Người lập phiếu</p>
            <p className="mt-14 font-semibold">{voucher.createdByName}</p>
          </div>
          <div>
            <p className="font-semibold">{isIncome ? 'Người nộp tiền' : 'Người nhận tiền'}</p>
            <p className="mt-14 text-xs text-slate-400">(Ký, ghi rõ họ tên)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
