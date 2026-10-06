import { formatPrintDateTime } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintDocument } from '../../shared/print/PrintDocument';

/**
 * Bản in "Phiếu thu tạm ứng" (Ví tạm ứng) — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu
 * `WALLET_TOPUP_RECEIPT` ("Quản lý mẫu in", docs/DECISIONS.md #211; A4/A5 hoặc K80 máy in nhiệt). Không có dòng "bằng
 * chữ" — `InvoicePrintView.tsx` (phiếu thu viện phí, cùng bản chất thu tiền) cũng không có, giữ đồng nhất giữa 2 loại
 * phiếu thu trong app.
 */
export function WalletReceiptPrintView({
  voucherNo,
  occurredAt,
  patientFullName,
  patientCode,
  note,
  paymentMethodLabel,
  balanceBefore,
  balanceAfter,
  amount,
}: {
  voucherNo: string;
  occurredAt: string;
  patientFullName: string;
  patientCode: string;
  note: string | null;
  paymentMethodLabel: string;
  balanceBefore: number;
  balanceAfter: number;
  amount: number;
}) {
  return (
    <PrintDocument
      documentType="WALLET_TOPUP_RECEIPT"
      title="Phiếu thu tạm ứng"
      subtitle={
        <>
          <p className="text-xs text-slate-500">{formatPrintDateTime(occurredAt)}</p>
          <p className="mt-1">
            Số: <strong>{voucherNo}</strong>
          </p>
        </>
      }
      signatures={[{ label: 'Người nộp tiền' }, { label: 'Thu ngân' }]}
    >
      <div className="mt-5 space-y-1.5 text-slate-700">
        <p>
          <span className="text-slate-500">Họ tên:</span> <strong className="text-slate-900">{patientFullName}</strong>
        </p>
        <p>
          <span className="text-slate-500">Mã bệnh nhân:</span> <strong className="text-slate-900">{patientCode}</strong>
        </p>
        <p>
          <span className="text-slate-500">Lý do nộp:</span> <strong className="text-slate-900">{note ?? 'Nạp tạm ứng'}</strong>
        </p>
        <p>
          <span className="text-slate-500">Hình thức:</span> <strong className="text-slate-900">{paymentMethodLabel}</strong>
        </p>
        <p>
          <span className="text-slate-500">Số dư trước:</span> <strong className="text-slate-900">{formatVnd(balanceBefore)}</strong>
        </p>
        <p>
          <span className="text-slate-500">Số dư sau:</span> <strong className="text-slate-900">{formatVnd(balanceAfter)}</strong>
        </p>
      </div>

      <div className="mt-5 flex items-center justify-between border-y-2 border-slate-800 py-3">
        <span className="font-bold text-slate-900">Số tiền nộp</span>
        <span className="text-lg font-bold text-slate-900">{formatVnd(amount)}</span>
      </div>
    </PrintDocument>
  );
}
