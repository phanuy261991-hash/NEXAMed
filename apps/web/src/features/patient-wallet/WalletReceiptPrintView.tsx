import type { ClinicPrintHeader } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';

function formatPrintDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} ngày ${String(vn.getUTCDate()).padStart(2, '0')} tháng ${String(vn.getUTCMonth() + 1).padStart(2, '0')} năm ${vn.getUTCFullYear()}`;
}

/**
 * Khổ in "Phiếu thu tạm ứng" (Ví tạm ứng) — A5 (128mm), đúng khuôn `CashVoucherPrintView.tsx`/
 * `InvoicePrintView.tsx` (`.print-area`, hạ tầng in chung `apps/web/src/app/index.css`). Không có
 * dòng "bằng chữ" — `InvoicePrintView.tsx` (phiếu thu viện phí, cùng bản chất thu tiền) cũng không
 * có, giữ đồng nhất giữa 2 loại phiếu thu trong app thay vì chỉ thêm riêng cho phiếu này.
 */
export function WalletReceiptPrintView({
  clinicHeader,
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
  clinicHeader: ClinicPrintHeader;
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

        <h1 className="text-center text-xl font-bold uppercase tracking-wide text-slate-900">Phiếu thu tạm ứng</h1>
        <p className="text-center text-xs text-slate-500">{formatPrintDateTime(occurredAt)}</p>
        <p className="mt-1 text-center text-sm">
          Số: <strong>{voucherNo}</strong>
        </p>

        <div className="mt-5 space-y-1.5 text-sm text-slate-700">
          <p>
            <span className="text-slate-400">Họ tên:</span> <strong className="text-slate-900">{patientFullName}</strong>
          </p>
          <p>
            <span className="text-slate-400">Mã bệnh nhân:</span> <strong className="text-slate-900">{patientCode}</strong>
          </p>
          <p>
            <span className="text-slate-400">Lý do nộp:</span> <strong className="text-slate-900">{note ?? 'Nạp tạm ứng'}</strong>
          </p>
          <p>
            <span className="text-slate-400">Hình thức:</span> <strong className="text-slate-900">{paymentMethodLabel}</strong>
          </p>
          <p>
            <span className="text-slate-400">Số dư trước:</span> <strong className="text-slate-900">{formatVnd(balanceBefore)}</strong>
          </p>
          <p>
            <span className="text-slate-400">Số dư sau:</span> <strong className="text-slate-900">{formatVnd(balanceAfter)}</strong>
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between border-y-2 border-slate-800 py-3">
          <span className="font-bold text-slate-900">Số tiền nộp</span>
          <span className="text-lg font-bold text-slate-900">{formatVnd(amount)}</span>
        </div>

        <div className="mt-12 flex justify-between text-center text-sm">
          <div>
            <p className="font-semibold">Người nộp tiền</p>
            <p className="mt-14 text-xs text-slate-400">(Ký, ghi rõ họ tên)</p>
          </div>
          <div>
            <p className="font-semibold">Thu ngân</p>
            <p className="mt-14 text-xs text-slate-400">(Ký, ghi rõ họ tên)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
