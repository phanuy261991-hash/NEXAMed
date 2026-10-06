import type { CashVoucher } from '@nexamed/shared';
import { formatPrintDateTime } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';

/**
 * Bản in Phiếu thu/chi tiền mặt (Sổ quỹ & Thu chi GĐ1) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản
 * mẫu `CASH_VOUCHER` ("Quản lý mẫu in", docs/DECISIONS.md #211; A4/A5 hoặc K80 máy in nhiệt). Tên hiển thị của
 * `incomeExpenseTypeCode`/`cashAccountId`/`paymentMethodCode` do nơi gọi tự map từ danh mục đã tải sẵn (không resolve ở
 * backend — xem comment `cashVoucherSchema`).
 */
export function CashVoucherPrintView({
  voucher,
  incomeExpenseTypeLabel,
  cashAccountName,
  paymentMethodLabel,
}: {
  voucher: CashVoucher;
  incomeExpenseTypeLabel: string;
  cashAccountName: string;
  paymentMethodLabel: string;
}) {
  const isIncome = voucher.direction === 'INCOME';
  return (
    <PrintDocument
      documentType="CASH_VOUCHER"
      title={isIncome ? 'Phiếu thu' : 'Phiếu chi'}
      subtitle={
        <>
          <p className="text-xs text-slate-500">{formatPrintDateTime(voucher.occurredAt)}</p>
          <p className="mt-1">
            Số: <strong>{voucher.voucherNo}</strong>
          </p>
        </>
      }
      signatures={[{ label: 'Người lập phiếu', name: voucher.createdByName }, { label: isIncome ? 'Người nộp tiền' : 'Người nhận tiền' }]}
    >
      <div className="mt-5 space-y-1.5 text-slate-700">
        <p>
          <span className="text-slate-500">{isIncome ? 'Người nộp tiền:' : 'Người nhận tiền:'}</span> <strong className="text-slate-900">{voucher.partnerName ?? '—'}</strong>
        </p>
        <p>
          <span className="text-slate-500">Lý do {isIncome ? 'thu' : 'chi'}:</span> <strong className="text-slate-900">{voucher.description}</strong>
        </p>
        <p>
          <span className="text-slate-500">Loại thu chi:</span> <strong className="text-slate-900">{incomeExpenseTypeLabel}</strong>
        </p>
        <p>
          <span className="text-slate-500">Hình thức:</span> <strong className="text-slate-900">{paymentMethodLabel}</strong>
        </p>
        <p>
          <span className="text-slate-500">Quỹ:</span> <strong className="text-slate-900">{cashAccountName}</strong>
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
    </PrintDocument>
  );
}
