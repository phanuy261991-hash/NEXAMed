import { useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import type { CashierShiftDetail, ClinicPrintHeader } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';

type ReceiptFormat = 'roll' | 'a5' | 'a4';

const FORMAT_LABEL: Record<ReceiptFormat, string> = { roll: 'Cuộn nhỏ', a5: 'Khổ A5', a4: 'Khổ A4' };

function formatDateTimeVn(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  return `${hh}:${mm} ${dd}/${mo}`;
}

/**
 * "Phiếu bàn giao ca" — 3 khổ in (cuộn nhỏ/A5/A4, mockup duyệt 2026-09-03), dùng CHUNG cho lúc vừa
 * chốt ca lẫn "In lại phiếu" ở Danh sách phiếu chốt ca. Tái dùng đúng hạ tầng in sẵn có (`.print-
 * area`/`@media print`, `apps/web/src/app/index.css`, xem `InvoicePrintView.tsx`) — chỉ khổ đang
 * chọn mới mang class `print-area` nên chỉ đúng khổ đó được in, không cần kỹ thuật `hidden`/
 * `print:block` (khác InvoicePrintView vì view này vốn đã ẩn/hiện qua render có điều kiện của
 * React, không cần ẩn kép bằng CSS).
 */
export function CashierShiftReceiptView({ shift, clinicHeader }: { shift: CashierShiftDetail; clinicHeader: ClinicPrintHeader }) {
  const [format, setFormat] = useState<ReceiptFormat>('roll');
  const diff = (shift.countedCashAmount ?? 0) - (shift.expectedCashAmount ?? 0);

  return (
    <div>
      <div className="flex justify-center mb-4">
        <div className="inline-flex gap-1 rounded-md border border-slate-300 p-1">
          {(['roll', 'a5', 'a4'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded px-3.5 py-1.5 text-xs font-semibold ${f === format ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
            >
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-hover flex justify-center overflow-x-auto rounded-lg bg-slate-100 py-6">
        {format === 'roll' && <RollReceipt shift={shift} clinicHeader={clinicHeader} diff={diff} />}
        {(format === 'a5' || format === 'a4') && <FormalReceipt shift={shift} clinicHeader={clinicHeader} diff={diff} width={format === 'a5' ? 380 : 520} />}
      </div>

      <div className="mt-4 flex justify-center">
        <Button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5">
          <Printer size={16} weight="regular" aria-hidden="true" />
          In phiếu
        </Button>
      </div>
    </div>
  );
}

function RollReceipt({ shift, clinicHeader, diff }: { shift: CashierShiftDetail; clinicHeader: ClinicPrintHeader; diff: number }) {
  return (
    <div
      className="print-area relative border border-slate-200 bg-white px-4 pt-5 pb-4"
      style={{ width: 300, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.55 }}
    >
      <div className="text-center font-bold">PHIẾU BÀN GIAO CA</div>
      <div className="mb-2 text-center text-[11px] text-slate-500">{clinicHeader.name}</div>
      <div className="my-2 border-t border-dashed border-slate-300" />
      <Row label="Ca" value={shift.shiftLabel} />
      <Row label="Thu ngân" value={shift.cashierName} />
      <Row label="Mở ca" value={formatDateTimeVn(shift.openedAt)} />
      <Row label="Chốt ca" value={shift.closedAt ? formatDateTimeVn(shift.closedAt) : '—'} />
      <div className="my-2 border-t border-dashed border-slate-300" />
      <Row label="Vốn đầu ca" value={String(shift.openingFloatActual)} />
      <Row label="Thu tiền mặt" value={String(shift.cashInAmount ?? 0)} />
      <Row label="Hoàn tiền mặt" value={`-${shift.cashOutAmount ?? 0}`} />
      <Row label="Thực đếm" value={String(shift.countedCashAmount ?? 0)} bold />
      <Row label="Chênh lệch" value={diff === 0 ? '0' : `${diff > 0 ? '+' : ''}${diff}`} bold className={diff !== 0 ? 'text-rose-600' : undefined} />
      <div className="my-2 border-t border-dashed border-slate-300" />
      <Row label="Để lại vốn ca sau" value={String(shift.keepForNextAmount ?? 0)} />
      <Row label="Nộp về" value={String(shift.submittedAmount ?? 0)} bold />
      <div className="my-2 border-t border-dashed border-slate-300" />
      <div className="mt-3 text-center text-[11px] text-slate-500">Chữ ký thu ngân</div>
      <div className="mx-auto mt-6 w-2/3 border-b border-slate-300" />
    </div>
  );
}

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''} ${className ?? ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function FormalReceipt({ shift, clinicHeader, diff, width }: { shift: CashierShiftDetail; clinicHeader: ClinicPrintHeader; diff: number; width: number }) {
  return (
    <div className="print-area bg-white shadow-sm" style={{ width }}>
      <div className="p-8">
        <div className="mb-6 text-center">
          <div className="text-base font-bold text-slate-900">{clinicHeader.name.toUpperCase()}</div>
          {(clinicHeader.address ?? clinicHeader.phone) && (
            <div className="mt-0.5 text-xs text-slate-500">
              {clinicHeader.address}
              {clinicHeader.address && clinicHeader.phone ? ' · ' : ''}
              {clinicHeader.phone ? `ĐT: ${clinicHeader.phone}` : ''}
            </div>
          )}
        </div>
        <div className="mb-6 text-center">
          <div className="text-lg font-bold uppercase tracking-wide text-slate-900">Phiếu bàn giao ca làm việc</div>
          <div className="mt-1 text-xs text-slate-500">Số phiếu: {shift.shiftNo}</div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-700">
          <div>
            <span className="text-slate-400">Ca làm việc:</span> <span className="font-semibold text-slate-900">{shift.shiftLabel}</span>
          </div>
          <div>
            <span className="text-slate-400">Thu ngân:</span> <span className="font-semibold text-slate-900">{shift.cashierName}</span>
          </div>
          <div>
            <span className="text-slate-400">Giờ mở ca:</span> <span className="font-semibold text-slate-900">{formatDateTimeVn(shift.openedAt)}</span>
          </div>
          <div>
            <span className="text-slate-400">Giờ chốt ca:</span> <span className="font-semibold text-slate-900">{shift.closedAt ? formatDateTimeVn(shift.closedAt) : '—'}</span>
          </div>
        </div>

        <table className="mb-6 w-full text-sm">
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-1.5 text-slate-600">Vốn đầu ca</td>
              <td className="py-1.5 text-right font-semibold text-slate-900">{formatVnd(shift.openingFloatActual)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-1.5 text-slate-600">Thu tiền mặt trong ca</td>
              <td className="py-1.5 text-right font-semibold text-slate-900">{formatVnd(shift.cashInAmount ?? 0)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-1.5 text-slate-600">Hoàn tiền mặt trong ca</td>
              <td className="py-1.5 text-right font-semibold text-rose-600">−{formatVnd(shift.cashOutAmount ?? 0)}</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-1.5 font-semibold text-slate-900">Tổng tiền mặt thực đếm</td>
              <td className="py-1.5 text-right font-bold text-slate-900">{formatVnd(shift.countedCashAmount ?? 0)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-1.5 text-slate-600">Chênh lệch</td>
              <td className={`py-1.5 text-right font-semibold ${diff !== 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {diff === 0 ? '0 đ' : `${diff > 0 ? '+' : '−'}${formatVnd(Math.abs(diff))}`}
              </td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-1.5 text-slate-600">Để lại vốn ca sau</td>
              <td className="py-1.5 text-right font-semibold text-slate-900">{formatVnd(shift.keepForNextAmount ?? 0)}</td>
            </tr>
            <tr>
              <td className="py-2 font-bold text-slate-900">Tiền mặt nộp về</td>
              <td className="py-2 text-right text-base font-bold text-blue-700">{formatVnd(shift.submittedAmount ?? 0)}</td>
            </tr>
          </tbody>
        </table>

        {shift.cashDiscrepancyReason && (
          <div className="mb-8 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Lý do chênh lệch:</span> {shift.cashDiscrepancyReason}
          </div>
        )}

        <div className="grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
          <div>
            <div className="mb-10 font-semibold text-slate-700">Thu ngân bàn giao</div>
            <div className="border-t border-slate-300 pt-1">{shift.cashierName}</div>
          </div>
          <div>
            <div className="mb-10 font-semibold text-slate-700">Người nhận bàn giao</div>
            <div className="border-t border-slate-300 pt-1">(Ký, ghi rõ họ tên)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
