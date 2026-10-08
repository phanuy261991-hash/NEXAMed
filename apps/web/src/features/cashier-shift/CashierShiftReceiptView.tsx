import type { CashierShiftDetail } from '@nexamed/shared';
import { formatPrintShortDateTime } from '../../shared/format/print-date';
import { formatVnd } from '../../shared/format/currency';
import { PrintButton } from '../../shared/print/PrintButton';
import { PrintDocument } from '../../shared/print/PrintDocument';

export function computeCashierShiftDiff(shift: CashierShiftDetail): number {
  return (shift.countedCashAmount ?? 0) - (shift.expectedCashAmount ?? 0);
}

/** "Tổng doanh thu ca" (`docs/DECISIONS.md` #120) — dùng chung cho phiếu in lẫn "bảng tóm tắt Chốt ca". */
export function computeCashierShiftTotalRevenue(shift: CashierShiftDetail): number {
  const cashNet = (shift.cashInAmount ?? 0) - (shift.cashOutAmount ?? 0);
  const nonCashNet = shift.nonCashBreakdown.reduce((sum, item) => sum + item.amount, 0);
  return cashNet + nonCashNet;
}

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''} ${className ?? ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * "Phiếu bàn giao ca" — khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `CASHIER_SHIFT_RECEIPT`
 * ("Quản lý mẫu in", docs/DECISIONS.md #211): khổ do bản mẫu quyết định (K80 máy in nhiệt = bố cục cuộn nhỏ, A5/A4 =
 * bố cục bảng đầy đủ), không còn bộ chọn khổ riêng ở đây. Dùng CHUNG cho lúc vừa chốt ca lẫn "In lại phiếu" ở Danh
 * sách phiếu chốt ca; hiện sẵn bản xem trước trong hộp thoại rồi mới bấm "In phiếu".
 *
 * `onAfterPrint` (tuỳ chọn) — gọi ngay sau khi trình duyệt đóng hộp thoại in (`window.print()` chặn luồng JS tới khi
 * người dùng in/huỷ) — dùng để tự thoát khỏi wizard "Chốt ca" ngay sau khi in (không dùng ở "In lại phiếu" từ Danh sách
 * phiếu chốt ca). Trình duyệt KHÔNG cho phép bỏ qua hộp thoại in bằng JS (giới hạn bảo mật nền tảng web).
 */
export function CashierShiftReceiptView({ shift, onAfterPrint }: { shift: CashierShiftDetail; onAfterPrint?: () => void }) {
  function handlePrint() {
    window.print();
    onAfterPrint?.();
  }

  return (
    <div>
      <div className="scroll-hover flex justify-center overflow-x-auto rounded-lg bg-slate-100 py-6">
        <div className="print-preview-shrink">
          <CashierShiftReceiptDocument shift={shift} display="screen" />
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <PrintButton documentType="CASHIER_SHIFT_RECEIPT" variant="primary" onPrint={handlePrint}>
          In phiếu
        </PrintButton>
      </div>
    </div>
  );
}

/** Nội dung phiếu (không có nút in/khung cuộn) — dùng cả ở hộp thoại trên và ở xem trước của "Quản lý mẫu in". */
export function CashierShiftReceiptDocument({ shift, display = 'print' }: { shift: CashierShiftDetail; display?: 'print' | 'screen' }) {
  const diff = computeCashierShiftDiff(shift);
  const totalRevenue = computeCashierShiftTotalRevenue(shift);
  return (
    <PrintDocument
      documentType="CASHIER_SHIFT_RECEIPT"
      title="Phiếu bàn giao ca"
      display={display}
      subtitle={<p>Số phiếu: {shift.shiftNo}</p>}
      signatures={[{ label: 'Thu ngân bàn giao', name: shift.cashierName }, { label: 'Người nhận bàn giao' }]}
    >
      {({ compact }) => (compact ? <RollBody shift={shift} diff={diff} totalRevenue={totalRevenue} /> : <FormalBody shift={shift} diff={diff} totalRevenue={totalRevenue} />)}
    </PrintDocument>
  );
}

/** Thân phiếu cho giấy cuộn K80 — mỗi dòng 1 cặp nhãn/số, vạch đứt ngăn nhóm (hợp máy in nhiệt đơn sắc). */
function RollBody({ shift, diff, totalRevenue }: { shift: CashierShiftDetail; diff: number; totalRevenue: number }) {
  const rule = <div className="my-2 border-t border-dashed border-slate-500" />;
  return (
    <div className="mt-2 leading-snug">
      <Row label="Doanh thu ca" value={formatVnd(totalRevenue)} bold />
      {rule}
      <Row label="Ca" value={shift.shiftLabel} />
      <Row label="Thu ngân" value={shift.cashierName} />
      <Row label="Mở ca" value={formatPrintShortDateTime(shift.openedAt)} />
      <Row label="Chốt ca" value={shift.closedAt ? formatPrintShortDateTime(shift.closedAt) : '—'} />
      {rule}
      <Row label="Vốn đầu ca" value={formatVnd(shift.openingFloatActual)} />
      <Row label="Thu tiền mặt" value={formatVnd(shift.cashInAmount ?? 0)} />
      <Row label="Hoàn tiền mặt" value={`-${formatVnd(shift.cashOutAmount ?? 0)}`} />
      <Row label="Thực đếm" value={formatVnd(shift.countedCashAmount ?? 0)} bold />
      <Row label="Chênh lệch" value={diff === 0 ? '0 đ' : `${diff > 0 ? '+' : '-'}${formatVnd(Math.abs(diff))}`} bold />
      {rule}
      <Row label="Để lại vốn ca sau" value={formatVnd(shift.keepForNextAmount ?? 0)} />
      <Row label="Nộp về" value={formatVnd(shift.submittedAmount ?? 0)} bold />
      {shift.cashDiscrepancyReason && <p className="mt-2 text-xs">Lý do chênh lệch: {shift.cashDiscrepancyReason}</p>}
    </div>
  );
}

/** Thân phiếu cho A5/A4 — bảng đầy đủ. */
function FormalBody({ shift, diff, totalRevenue }: { shift: CashierShiftDetail; diff: number; totalRevenue: number }) {
  return (
    <>
      <div className="mb-6 mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <span className="text-slate-500">Ca làm việc:</span> <span className="font-semibold">{shift.shiftLabel}</span>
        </div>
        <div>
          <span className="text-slate-500">Thu ngân:</span> <span className="font-semibold">{shift.cashierName}</span>
        </div>
        <div>
          <span className="text-slate-500">Giờ mở ca:</span> <span className="font-semibold">{formatPrintShortDateTime(shift.openedAt)}</span>
        </div>
        <div>
          <span className="text-slate-500">Giờ chốt ca:</span> <span className="font-semibold">{shift.closedAt ? formatPrintShortDateTime(shift.closedAt) : '—'}</span>
        </div>
      </div>

      <table className="w-full">
        <tbody>
          <tr className="border-b-2 border-slate-300">
            <td className="py-2 font-bold">Tổng doanh thu ca</td>
            <td className="py-2 text-right text-base font-bold">{formatVnd(totalRevenue)}</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 text-slate-600">Vốn đầu ca</td>
            <td className="py-1.5 text-right font-semibold">{formatVnd(shift.openingFloatActual)}</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 text-slate-600">Thu tiền mặt trong ca</td>
            <td className="py-1.5 text-right font-semibold">{formatVnd(shift.cashInAmount ?? 0)}</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 text-slate-600">Hoàn tiền mặt trong ca</td>
            <td className="py-1.5 text-right font-semibold">−{formatVnd(shift.cashOutAmount ?? 0)}</td>
          </tr>
          <tr className="border-b border-slate-300">
            <td className="py-1.5 font-semibold">Tổng tiền mặt thực đếm</td>
            <td className="py-1.5 text-right font-bold">{formatVnd(shift.countedCashAmount ?? 0)}</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 text-slate-600">Chênh lệch</td>
            <td className="py-1.5 text-right font-semibold">{diff === 0 ? '0 đ' : `${diff > 0 ? '+' : '−'}${formatVnd(Math.abs(diff))}`}</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 text-slate-600">Để lại vốn ca sau</td>
            <td className="py-1.5 text-right font-semibold">{formatVnd(shift.keepForNextAmount ?? 0)}</td>
          </tr>
          <tr>
            <td className="py-2 font-bold">Tiền mặt nộp về</td>
            <td className="py-2 text-right text-base font-bold">{formatVnd(shift.submittedAmount ?? 0)}</td>
          </tr>
        </tbody>
      </table>

      {shift.cashDiscrepancyReason && (
        <p className="mt-3 text-xs">
          <span className="font-semibold">Lý do chênh lệch:</span> {shift.cashDiscrepancyReason}
        </p>
      )}
    </>
  );
}
