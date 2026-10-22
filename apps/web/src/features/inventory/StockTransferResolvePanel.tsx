import { useMemo, useState } from 'react';
import type { ResolveStockTransferVarianceRequest, StockTransferDetail, StockTransferVarianceResolution } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { useResolveStockTransferVarianceMutation } from './inventory.queries';
import { VARIANCE_REASON_LABEL, VARIANCE_RESOLUTION_LABEL } from './stock-transfer-meta';

const GRID = 'minmax(220px,1.5fr) 130px 80px 90px 80px 130px minmax(200px,1.4fr) 210px';
const RESOLUTION_OPTIONS = (Object.keys(VARIANCE_RESOLUTION_LABEL) as StockTransferVarianceResolution[]).map((value) => ({ value, label: VARIANCE_RESOLUTION_LABEL[value] }));

/**
 * "Xử lý chênh lệch" của chi nhánh GỬI (Đợt 2 chi nhánh, docs/DECISIONS.md #233, mockup màn 4b-3, Q7): phiếu "Nhận có chênh lệch" — mỗi dòng thiếu chọn MỘT
 * cách: "Hàng đã về kho gửi" (tồn kho gửi tăng lại, sinh phiếu nhập hoàn trả) hoặc "Ghi hao hụt" (không cộng tồn, vào báo cáo hao hụt). Chỉ bên gửi
 * thấy GIÁ TRỊ phần thiếu (giá vốn chốt lúc Duyệt xuất). Phải xử lý ĐỦ mọi dòng thiếu.
 */
export function StockTransferResolvePanel({ transfer, onDone, onCancel }: { transfer: StockTransferDetail; onDone: () => void; onCancel: () => void }) {
  const shortLines = useMemo(() => transfer.lines.filter((l) => l.quantityReceived !== null && l.quantityReceived < l.quantityShipped), [transfer.lines]);
  const [resolutions, setResolutions] = useState<Record<string, StockTransferVarianceResolution | ''>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useResolveStockTransferVarianceMutation();

  const rows = shortLines.map((l) => {
    const shortage = l.quantityShipped - (l.quantityReceived ?? 0);
    return { line: l, shortage, value: shortage * (l.unitCost ?? 0), resolution: resolutions[l.id] ?? '' };
  });
  const allResolved = rows.length > 0 && rows.every((r) => r.resolution !== '');
  const total = rows.reduce((s, r) => s + r.value, 0);
  const writeOffValue = rows.filter((r) => r.resolution === 'WRITE_OFF').reduce((s, r) => s + r.value, 0);
  const returnedValue = rows.filter((r) => r.resolution === 'RETURN_TO_SOURCE').reduce((s, r) => s + r.value, 0);

  async function handleSubmit() {
    setError(null);
    const body: ResolveStockTransferVarianceRequest = {
      version: transfer.version,
      note: note.trim() || undefined,
      lines: rows.map((r) => ({ lineId: r.line.id, resolution: r.resolution as StockTransferVarianceResolution })),
    };
    try {
      await mutation.mutateAsync({ id: transfer.id, body });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Xử lý chênh lệch thất bại, vui lòng thử lại.');
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (allResolved) void handleSubmit();
      }}
    >
      <div className="flex-shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
        Chi nhánh nhận <strong className="break-words">{transfer.toBranchName}</strong> báo nhận thiếu. Với <strong>từng dòng</strong>, chọn: <strong>Hàng đã về kho gửi</strong> (chỉ chọn khi hàng thật sự
        đã quay về) hoặc <strong>Ghi hao hụt</strong>. Phiếu giữ trạng thái chờ xử lý cho tới khi mọi dòng thiếu đều đã có cách xử lý.
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="scroll-hover h-full overflow-auto">
          <div role="table" aria-label="Xử lý chênh lệch" style={{ minWidth: 1170 }}>
            <div role="row" style={{ gridTemplateColumns: GRID }} className="grid gap-x-2 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
              <div role="columnheader" className="py-2.5 text-left">Thuốc / vật tư</div>
              <div role="columnheader" className="py-2.5 text-center">Lô</div>
              <div role="columnheader" className="py-2.5 text-center">SL xuất</div>
              <div role="columnheader" className="py-2.5 text-center">Thực nhận</div>
              <div role="columnheader" className="py-2.5 text-center">Thiếu</div>
              <div role="columnheader" className="py-2.5 text-right">Giá trị thiếu</div>
              <div role="columnheader" className="py-2.5 pl-3 text-left">Lý do bên nhận</div>
              <div role="columnheader" className="py-2.5 text-left">Cách xử lý</div>
            </div>
            {rows.map((r) => (
              <div key={r.line.id} role="row" style={{ gridTemplateColumns: GRID, minHeight: 60 }} className="grid items-center gap-x-2 border-b border-slate-100 px-4 text-sm">
                <div role="cell" className="min-w-0 py-2">
                  <p className="truncate font-semibold text-slate-900" title={r.line.drugName}>{r.line.drugName}</p>
                  <p className="truncate text-xs font-medium text-slate-400">{r.line.drugCode}</p>
                </div>
                <div role="cell" className="truncate text-center text-xs font-medium text-slate-700">{r.line.batchNo ?? '—'}</div>
                <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{r.line.quantityShipped}</div>
                <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{r.line.quantityReceived}</div>
                <div role="cell" className="text-center font-semibold tabular-nums text-rose-600">{r.shortage}</div>
                <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{formatVnd(r.value)}</div>
                <div role="cell" className="min-w-0 pl-3 text-left text-slate-700">
                  <p className="font-semibold">{r.line.varianceReason ? VARIANCE_REASON_LABEL[r.line.varianceReason] : '—'}</p>
                  {r.line.varianceNote && r.line.varianceNote !== (r.line.varianceReason ? VARIANCE_REASON_LABEL[r.line.varianceReason] : '') && (
                    <p className="break-words text-xs text-slate-500">&quot;{r.line.varianceNote}&quot;</p>
                  )}
                </div>
                <div role="cell">
                  <Combobox
                    id={`resolve-${r.line.id}`}
                    value={r.resolution}
                    onChange={(v) => setResolutions((prev) => ({ ...prev, [r.line.id]: v as StockTransferVarianceResolution | '' }))}
                    placeholder="— Chọn cách xử lý —"
                    options={RESOLUTION_OPTIONS}
                  />
                </div>
              </div>
            ))}
            <div className="grid items-center gap-x-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm" style={{ gridTemplateColumns: GRID }}>
              <div className="col-span-5 font-semibold text-slate-800">Tổng</div>
              <div className="text-right font-semibold tabular-nums text-slate-900">{formatVnd(total)}</div>
              <div className="col-span-2 pl-3 text-sm text-slate-700">
                Hao hụt ghi nhận: <strong className="tabular-nums">{formatVnd(writeOffValue)}</strong> · Hàng về kho gửi: <strong className="tabular-nums">{formatVnd(returnedValue)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="resolve-note" className="mb-1 block text-sm font-semibold text-slate-800">
          Ghi chú xử lý
        </label>
        <textarea
          id="resolve-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Vd: Đã gọi chi nhánh nhận xác nhận; băng gạc đã gửi trả bằng xe nội bộ."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {error && <p className="mr-auto text-sm font-medium text-rose-600">{error}</p>}
          <Button type="button" variant="secondary" onClick={onCancel}>
            Để sau
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!allResolved}>
            Xác nhận xử lý
          </Button>
        </div>
      </div>
    </form>
  );
}
