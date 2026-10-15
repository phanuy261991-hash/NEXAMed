import { useMemo, useState } from 'react';
import { Check, Truck, Warning } from '@phosphor-icons/react';
import type { ReceiveStockTransferLineInput, StockTransferDetail, StockTransferVarianceReason } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useReceiveStockTransferMutation } from './inventory.queries';
import { StockTransferRejectReceiptDialog } from './StockTransferRejectReceiptDialog';
import { VARIANCE_REASON_LABEL } from './stock-transfer-meta';

interface ReceiveInput {
  quantityReceived: string;
  varianceReason: StockTransferVarianceReason | '';
  varianceNote: string;
}

const GRID = '40px minmax(220px,1.6fr) 170px 90px 110px 110px 200px minmax(180px,1.2fr)';
const REASON_OPTIONS = (Object.keys(VARIANCE_REASON_LABEL) as StockTransferVarianceReason[]).map((value) => ({ value, label: VARIANCE_REASON_LABEL[value] }));

function formatExpiry(iso: string | null): string {
  return iso ? iso.split('-').reverse().slice(1).join('/') : '';
}

/**
 * Màn "Kiểm nhận hàng" của chi nhánh NHẬN (Đợt 2 chi nhánh, docs/DECISIONS.md #233, mockup màn 4b-1): đếm thực tế, nhập "Thực nhận" từng dòng (mặc định
 * bằng số trên phiếu). Dòng thiếu BẮT BUỘC chọn lý do ("Khác" thì phải ghi chú); nhận NHIỀU hơn bị chặn. KHÔNG hiện giá vốn (Q3). Hàng thực nhận
 * vào kho đích ngay khi xác nhận; phần thiếu chuyển sang "chờ bên gửi xử lý". Có thêm "Từ chối nhận cả phiếu" (nút đỏ). Một lần duy nhất.
 */
export function StockTransferReceivePanel({ transfer, receiverName, onDone, onCancel }: { transfer: StockTransferDetail; receiverName: string; onDone: () => void; onCancel: () => void }) {
  const [inputs, setInputs] = useState<Record<string, ReceiveInput>>(() =>
    Object.fromEntries(transfer.lines.map((l) => [l.id, { quantityReceived: String(l.quantityShipped), varianceReason: '', varianceNote: '' } satisfies ReceiveInput])),
  );
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const receiveMutation = useReceiveStockTransferMutation();

  function update(lineId: string, patch: Partial<ReceiveInput>) {
    setInputs((prev) => ({ ...prev, [lineId]: { ...prev[lineId]!, ...patch } }));
  }

  const rows = useMemo(
    () =>
      transfer.lines.map((l) => {
        const input = inputs[l.id]!;
        const received = input.quantityReceived.trim() === '' ? NaN : Number(input.quantityReceived);
        const diff = Number.isNaN(received) ? 0 : received - l.quantityShipped;
        return { line: l, input, received, diff, short: diff < 0, over: diff > 0, invalid: Number.isNaN(received) || received < 0 || !Number.isInteger(received) };
      }),
    [transfer.lines, inputs],
  );
  const varianceCount = rows.filter((r) => r.short).length;
  const hasBlocking = rows.some((r) => r.invalid || r.over || (r.short && (r.input.varianceReason === '' || (r.input.varianceReason === 'OTHER' && r.input.varianceNote.trim() === ''))));

  function receiveAll() {
    setInputs(Object.fromEntries(transfer.lines.map((l) => [l.id, { quantityReceived: String(l.quantityShipped), varianceReason: '', varianceNote: '' } satisfies ReceiveInput])));
  }

  async function handleConfirm() {
    setError(null);
    const lines: ReceiveStockTransferLineInput[] = rows.map((r) => ({
      lineId: r.line.id,
      quantityReceived: r.received,
      ...(r.short ? { varianceReason: r.input.varianceReason === '' ? undefined : r.input.varianceReason, varianceNote: r.input.varianceNote.trim() || undefined } : {}),
    }));
    try {
      await receiveMutation.mutateAsync({ id: transfer.id, body: { version: transfer.version, lines } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Xác nhận nhận hàng thất bại, vui lòng thử lại.');
    }
  }

  return (
    <>
      <form
        className="flex min-h-0 flex-1 flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hasBlocking) void handleConfirm();
        }}
      >
        <div className="flex flex-shrink-0 items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm">
          <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0 text-blue-600" aria-hidden="true" />
          <p className="font-medium text-blue-900">
            Đếm và nhập số <strong>thực nhận</strong> của từng dòng. Có thể thấp hơn số trên phiếu (bắt buộc chọn lý do), không được cao hơn — hàng dư thì báo bên gửi lập phiếu mới. Hàng thực nhận vào{' '}
            <strong className="break-words">{transfer.toWarehouseName}</strong> ngay khi xác nhận. Người kiểm nhận: <strong className="break-words">{receiverName}</strong>.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="scroll-hover h-full overflow-auto">
            <div role="table" aria-label="Kiểm nhận hàng" style={{ minWidth: 1130 }}>
              <div role="row" style={{ gridTemplateColumns: GRID }} className="grid gap-x-2 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">#</div>
                <div role="columnheader" className="py-2.5 text-left">Thuốc / vật tư</div>
                <div role="columnheader" className="py-2.5 text-center">Lô · Hạn dùng</div>
                <div role="columnheader" className="py-2.5 text-center">SL phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Thực nhận</div>
                <div role="columnheader" className="py-2.5 text-center">Chênh lệch</div>
                <div role="columnheader" className="py-2.5 text-left">Lý do chênh lệch</div>
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
                    {r.line.isBatchManaged ? `${r.line.batchNo ?? ''}${r.line.expiryDate ? ` · ${formatExpiry(r.line.expiryDate)}` : ''}` : '— (không quản lý lô)'}
                    {/* Huy hiệu "Cận hạn" (mockup Đợt 2): lô trong ngưỡng cảnh báo hạn dùng của phòng khám, hoặc đã hết hạn. */}
                    {r.line.expiryStatus && (
                      <div className="mt-0.5">
                        <StatusBadge tone={r.line.expiryStatus === 'EXPIRED' ? 'danger' : 'warning'}>
                          {r.line.expiryStatus === 'EXPIRED' ? 'Hết hạn' : `Cận hạn · còn ${r.line.daysUntilExpiry} ngày`}
                        </StatusBadge>
                      </div>
                    )}
                  </div>
                  <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{r.line.quantityShipped}</div>
                  <div role="cell" className="text-center">
                    <input
                      type="number"
                      min={0}
                      max={r.line.quantityShipped}
                      aria-label={`Thực nhận ${r.line.drugName}`}
                      value={r.input.quantityReceived}
                      onChange={(e) => update(r.line.id, { quantityReceived: e.target.value })}
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
                  <div role="cell">
                    {r.short ? (
                      <Combobox
                        id={`receive-reason-${r.line.id}`}
                        value={r.input.varianceReason}
                        onChange={(v) => update(r.line.id, { varianceReason: v as StockTransferVarianceReason | '' })}
                        placeholder="— Chọn lý do —"
                        options={REASON_OPTIONS}
                      />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                  <div role="cell" className="pr-1">
                    {r.short ? (
                      <input
                        type="text"
                        aria-label={`Ghi chú chênh lệch ${r.line.drugName}`}
                        value={r.input.varianceNote}
                        onChange={(e) => update(r.line.id, { varianceNote: e.target.value })}
                        placeholder={r.input.varianceReason === 'OTHER' ? 'Bắt buộc ghi chú...' : 'Ghi chú (tuỳ chọn)'}
                        className={`w-full rounded-md border px-2 py-1.5 text-sm font-semibold ${r.input.varianceReason === 'OTHER' && r.input.varianceNote.trim() === '' ? 'border-rose-400 bg-rose-50' : 'border-slate-300'} text-slate-900`}
                      />
                    ) : r.over ? (
                      <span className="text-xs font-semibold text-rose-600">Nhận nhiều hơn phiếu: không được phép</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {varianceCount > 0 && (
          <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>{varianceCount} dòng có chênh lệch.</strong> Hàng thực nhận vào kho ngay; phần thiếu chuyển sang &quot;chờ bên gửi xử lý&quot; để chi nhánh gửi quyết định.
          </div>
        )}

        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Button type="button" variant="danger" onClick={() => setRejecting(true)}>
            Từ chối nhận cả phiếu
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {error && <p className="mr-2 text-sm font-medium text-rose-600">{error}</p>}
            <Button type="button" variant="secondary" onClick={receiveAll}>
              Nhận đủ tất cả
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Huỷ
            </Button>
            <Button type="submit" loading={receiveMutation.isPending} disabled={hasBlocking}>
              <Truck size={15} weight="bold" aria-hidden="true" />
              Xác nhận nhận hàng
            </Button>
          </div>
        </div>
        <p className="flex-shrink-0 px-1 text-xs text-slate-500">Xác nhận là <strong>MỘT LẦN DUY NHẤT</strong> — không sửa lại số đã nhận (muốn đính chính phải qua bên gửi).</p>
      </form>

      {rejecting && (
        <StockTransferRejectReceiptDialog
          transferId={transfer.id}
          transferNo={transfer.transferNo}
          fromLabel={transfer.fromBranchId === transfer.toBranchId ? transfer.fromWarehouseName : transfer.fromBranchName}
          version={transfer.version}
          onDone={onDone}
          onClose={() => setRejecting(false)}
        />
      )}
    </>
  );
}
