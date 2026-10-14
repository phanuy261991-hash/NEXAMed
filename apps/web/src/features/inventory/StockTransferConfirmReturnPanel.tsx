import { useMemo, useState } from 'react';
import { Check, Warning } from '@phosphor-icons/react';
import type { ConfirmStockTransferReturnRequest, StockTransferDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useConfirmStockTransferReturnMutation } from './inventory.queries';
import { REJECT_RECEIPT_REASON_LABEL } from './stock-transfer-meta';

interface ReturnInput {
  quantityReturnedBack: string;
  note: string;
}

const GRID = '40px minmax(220px,1.6fr) 170px 100px 130px 110px minmax(220px,1.4fr)';

/**
 * "Xác nhận đã nhận lại hàng" của chi nhánh GỬI sau khi chi nhánh nhận TỪ CHỐI NHẬN cả phiếu (Đợt 2 chi nhánh, docs/DECISIONS.md #233, mockup 4b-2).
 * Cùng màn kiểm đếm như Kiểm nhận: nhận lại ĐỦ → tồn kho gửi tăng lại đúng lô + giá vốn cũ, phiếu thành "Đã hoàn trả"; nhận lại THIẾU → phần thiếu ghi thẳng là
 * hao hụt, ghi chú bắt buộc (không còn vòng xử lý thứ hai).
 */
export function StockTransferConfirmReturnPanel({ transfer, onDone, onCancel }: { transfer: StockTransferDetail; onDone: () => void; onCancel: () => void }) {
  const [inputs, setInputs] = useState<Record<string, ReturnInput>>(() =>
    Object.fromEntries(transfer.lines.map((l) => [l.id, { quantityReturnedBack: String(l.quantityShipped), note: '' } satisfies ReturnInput])),
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useConfirmStockTransferReturnMutation();

  const rows = useMemo(
    () =>
      transfer.lines.map((l) => {
        const input = inputs[l.id]!;
        const back = input.quantityReturnedBack.trim() === '' ? NaN : Number(input.quantityReturnedBack);
        const diff = Number.isNaN(back) ? 0 : back - l.quantityShipped;
        return { line: l, input, back, diff, short: diff < 0, over: diff > 0, invalid: Number.isNaN(back) || back < 0 || !Number.isInteger(back) };
      }),
    [transfer.lines, inputs],
  );
  const hasBlocking = rows.some((r) => r.invalid || r.over || (r.short && r.input.note.trim() === ''));
  const shortCount = rows.filter((r) => r.short).length;

  function update(lineId: string, patch: Partial<ReturnInput>) {
    setInputs((prev) => ({ ...prev, [lineId]: { ...prev[lineId]!, ...patch } }));
  }

  async function handleSubmit() {
    setError(null);
    const body: ConfirmStockTransferReturnRequest = {
      version: transfer.version,
      lines: rows.map((r) => ({ lineId: r.line.id, quantityReturnedBack: r.back, note: r.input.note.trim() || undefined })),
    };
    try {
      await mutation.mutateAsync({ id: transfer.id, body });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Xác nhận nhận lại hàng thất bại, vui lòng thử lại.');
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hasBlocking) void handleSubmit();
      }}
    >
      <div className="flex flex-shrink-0 items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-sm">
        <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0 text-violet-600" aria-hidden="true" />
        <div className="min-w-0 font-medium text-violet-900">
          <p className="break-words">
            <strong>{transfer.toBranchName}</strong> đã từ chối nhận hàng
            {transfer.receiveRejectReason ? ` (${REJECT_RECEIPT_REASON_LABEL[transfer.receiveRejectReason]})` : ''}
            {transfer.receiveRejectedByName ? ` — ${transfer.receiveRejectedByName}` : ''}.
          </p>
          {transfer.receiveRejectNote && <p className="mt-0.5 break-words text-violet-800">&quot;{transfer.receiveRejectNote}&quot;</p>}
          <p className="mt-0.5 text-violet-800">Kiểm đếm hàng thực tế đã về rồi xác nhận. Nhận lại thiếu thì phần thiếu ghi thẳng là hao hụt (bắt buộc ghi chú).</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="scroll-hover h-full overflow-auto">
          <div role="table" aria-label="Nhận lại hàng" style={{ minWidth: 1040 }}>
            <div role="row" style={{ gridTemplateColumns: GRID }} className="grid gap-x-2 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
              <div role="columnheader" className="py-2.5 text-center">#</div>
              <div role="columnheader" className="py-2.5 text-left">Thuốc / vật tư</div>
              <div role="columnheader" className="py-2.5 text-center">Lô · Hạn dùng</div>
              <div role="columnheader" className="py-2.5 text-center">SL đã xuất</div>
              <div role="columnheader" className="py-2.5 text-center">Nhận lại</div>
              <div role="columnheader" className="py-2.5 text-center">Chênh lệch</div>
              <div role="columnheader" className="py-2.5 text-left">Ghi chú</div>
            </div>
            {rows.map((r, index) => (
              <div key={r.line.id} role="row" style={{ gridTemplateColumns: GRID, minHeight: 60 }} className={`grid items-center gap-x-2 border-b border-slate-100 px-4 text-sm ${r.short ? 'bg-amber-50/60' : ''}`}>
                <div role="cell" className="text-center text-slate-500">{index + 1}</div>
                <div role="cell" className="min-w-0 py-2">
                  <p className="truncate font-bold text-slate-900" title={r.line.drugName}>{r.line.drugName}</p>
                  <p className="truncate text-xs font-medium text-slate-400">{r.line.drugCode}</p>
                </div>
                <div role="cell" className="text-center text-xs font-medium text-slate-700">
                  {r.line.isBatchManaged ? `${r.line.batchNo ?? ''}${r.line.expiryDate ? ` · ${r.line.expiryDate.split('-').reverse().slice(1).join('/')}` : ''}` : '— (không quản lý lô)'}
                </div>
                <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{r.line.quantityShipped}</div>
                <div role="cell" className="text-center">
                  <input
                    type="number"
                    min={0}
                    max={r.line.quantityShipped}
                    aria-label={`Nhận lại ${r.line.drugName}`}
                    value={r.input.quantityReturnedBack}
                    onChange={(e) => update(r.line.id, { quantityReturnedBack: e.target.value })}
                    className={`w-20 rounded-md border px-1.5 py-1.5 text-center text-sm font-bold ${r.short || r.over || r.invalid ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-slate-300 text-slate-900'}`}
                  />
                </div>
                <div role="cell" className="text-center font-semibold tabular-nums">
                  {r.invalid ? (
                    <span className="text-rose-600">—</span>
                  ) : r.diff === 0 ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      0 <Check size={14} weight="bold" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="text-rose-600">{r.diff > 0 ? `+${r.diff}` : r.diff}</span>
                  )}
                </div>
                <div role="cell" className="pr-1">
                  {r.short ? (
                    <input
                      type="text"
                      aria-label={`Ghi chú ${r.line.drugName}`}
                      value={r.input.note}
                      onChange={(e) => update(r.line.id, { note: e.target.value })}
                      placeholder="Bắt buộc ghi chú lý do thiếu..."
                      className={`w-full rounded-md border px-2 py-1.5 text-sm font-semibold text-slate-900 ${r.input.note.trim() === '' ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                    />
                  ) : r.over ? (
                    <span className="text-xs font-semibold text-rose-600">Không được nhận lại nhiều hơn số đã xuất</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {shortCount > 0 && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>{shortCount} dòng nhận lại thiếu</strong> — phần thiếu sẽ được ghi là hao hụt điều chuyển.
        </div>
      )}

      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {error && <p className="mr-auto text-sm font-medium text-rose-600">{error}</p>}
        <Button type="button" variant="secondary" onClick={onCancel}>
          Để sau
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={hasBlocking}>
          Xác nhận đã nhận lại hàng
        </Button>
      </div>
    </form>
  );
}
