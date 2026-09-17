import { useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useDrugsQuery } from '../drug/drug.queries';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useCreateStockIssueMutation, usePrescriptionDispenseStatusQuery } from './inventory.queries';

interface DraftLine {
  key: string;
  prescriptionItemId: string | null;
  drugId: string;
  drugName: string;
  isBatchManaged: boolean;
  /** `null` = dòng OTC không theo đơn, không giới hạn số lượng theo kê đơn. */
  maxQuantity: number | null;
  quantity: string;
  batchId: string;
  batchOptions: { value: string; label: string }[];
  sellPrice: number;
}

/**
 * "Phát thuốc" (Kho Thuốc GĐ3, docs/DECISIONS.md #163) — component DÙNG CHUNG cho cả trang riêng
 * `DispenseQueuePage.tsx` (bấm 1 dòng) lẫn `PrescriptionPanel.tsx` (nút "Phát thuốc" trong màn
 * khám, chỉ hiện khi đơn đã ký). Mỗi dòng thuốc kê hiện kê/đã phát/còn lại, `Combobox` chọn lô
 * (mặc định gợi ý FEFO — đã sắp theo hạn dùng, sửa được), số lượng phát (validate ≤ còn lại ngay
 * trên FE, BE chặn lại lần cuối). Sau khi phát xong KHÔNG tự điều hướng sang Thu ngân (#146 điểm
 * 6) — chỉ hiện popup xác nhận đứng nguyên tại đây.
 */
export function DispensePrescriptionDialog({ prescriptionId, onClose, onDispensed }: { prescriptionId: string; onClose: () => void; onDispensed?: () => void }) {
  const warehousesQuery = useWarehousesQuery();
  const warehouses = warehousesQuery.data?.items ?? [];
  const [warehouseId, setWarehouseId] = useState('');
  const effectiveWarehouseId = warehouseId || warehouses[0]?.id || '';

  const statusQuery = usePrescriptionDispenseStatusQuery(prescriptionId, effectiveWarehouseId || undefined, effectiveWarehouseId !== '');
  const createMutation = useCreateStockIssueMutation();

  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [otcQuery, setOtcQuery] = useState('');
  const debouncedOtcQuery = useDebouncedValue(otcQuery, 300);
  const otcSearch = useDrugsQuery({ q: debouncedOtcQuery.trim() || undefined, prescriptionOnly: false });

  // Nạp draft từ response ĐÚNG 1 LẦN khi query load xong (không dùng useEffect — so `lines===null`
  // ngay trong render, đúng mẫu `PrescriptionPanel.tsx` reset draft theo key).
  if (lines === null && statusQuery.isSuccess) {
    setLines(
      statusQuery.data.lines
        .filter((l) => l.remainingQuantity > 0)
        .map((l) => ({
          key: l.prescriptionItemId,
          prescriptionItemId: l.prescriptionItemId,
          drugId: l.drugId,
          drugName: l.drugName,
          isBatchManaged: l.isBatchManaged,
          maxQuantity: l.remainingQuantity,
          quantity: String(l.remainingQuantity),
          batchId: l.suggestedBatches[0]?.batchId ?? '',
          batchOptions: l.suggestedBatches.map((b) => ({
            value: b.batchId,
            label: `Lô ${b.batchNo}${b.expiryDate ? ` · HSD ${b.expiryDate}` : ''} · Còn ${b.quantityOnHand}`,
          })),
          sellPrice: l.sellPrice,
        })),
    );
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => (prev ? prev.map((l) => (l.key === key ? { ...l, ...patch } : l)) : prev));
  }

  function removeLine(key: string) {
    setLines((prev) => (prev ? prev.filter((l) => l.key !== key) : prev));
  }

  function addOtcLine(drug: { id: string; name: string; isBatchManaged: boolean; defaultSellPrice: number | null }) {
    setLines((prev) => [
      ...(prev ?? []),
      {
        key: crypto.randomUUID(),
        prescriptionItemId: null,
        drugId: drug.id,
        drugName: drug.name,
        isBatchManaged: drug.isBatchManaged,
        maxQuantity: null,
        quantity: '1',
        batchId: '',
        batchOptions: [],
        sellPrice: drug.defaultSellPrice ?? 0,
      },
    ]);
    setOtcQuery('');
  }

  async function handleSubmit() {
    if (!lines || lines.length === 0 || !effectiveWarehouseId) return;
    setError(null);
    for (const line of lines) {
      if (line.isBatchManaged && !line.batchId) {
        setError(`"${line.drugName}" quản lý theo lô — phải chọn lô.`);
        return;
      }
    }
    try {
      await createMutation.mutateAsync({
        prescriptionId,
        warehouseId: effectiveWarehouseId,
        lines: lines.map((l) => ({
          prescriptionItemId: l.prescriptionItemId,
          drugId: l.drugId,
          batchId: l.isBatchManaged ? l.batchId : undefined,
          quantity: Math.max(1, Number(l.quantity) || 1),
        })),
      });
      setSuccess(true);
      onDispensed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Phát thuốc thất bại, vui lòng thử lại.');
    }
  }

  const totalAmount = (lines ?? []).reduce((sum, l) => sum + (Number(l.quantity) || 0) * l.sellPrice, 0);
  const otcResults = (otcSearch.data?.items ?? []).filter((d) => !(lines ?? []).some((l) => l.drugId === d.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="dispense-title">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white p-5 shadow-xl">
        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p id="dispense-title" className="text-base font-bold text-slate-900">
              Đã phát thuốc thành công
            </p>
            <p className="text-sm text-slate-500">Phiếu xuất kho đã ghi nhận, tồn kho đã cập nhật.</p>
            <Button type="button" onClick={onClose}>
              Đóng
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 id="dispense-title" className="text-[15px] font-semibold text-slate-900">
                Phát thuốc
              </h2>
              {warehouses.length > 1 && (
                <div className="w-56">
                  <Combobox id="dispense-warehouse" value={effectiveWarehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                </div>
              )}
            </div>

            {statusQuery.isPending && (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}
            {statusQuery.isError && (
              <div className="mt-3">
                <ErrorBanner message={statusQuery.error instanceof ApiError ? statusQuery.error.message : 'Không tải được trạng thái phát thuốc.'} onRetry={() => void statusQuery.refetch()} />
              </div>
            )}

            {lines && (
              <div className="scroll-hover mt-3 flex-1 space-y-2 overflow-y-auto">
                {lines.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Đơn thuốc đã phát đủ — không còn dòng nào cần phát.</p>}
                {lines.map((line) => (
                  <div key={line.key} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-900">{line.drugName}</p>
                      {line.maxQuantity === null && (
                        <button type="button" onClick={() => removeLine(line.key)} className="text-xs font-semibold text-rose-600 hover:text-rose-700">
                          Xoá
                        </button>
                      )}
                    </div>
                    {line.maxQuantity !== null && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Kê {line.maxQuantity + (statusQuery.data?.lines.find((s) => s.prescriptionItemId === line.prescriptionItemId)?.dispensedQuantity ?? 0)} · Còn lại {line.maxQuantity}
                      </p>
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_140px]">
                      {line.isBatchManaged ? (
                        <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
                          Lô (gợi ý FEFO)
                          <Combobox
                            id={`dispense-batch-${line.key}`}
                            value={line.batchId}
                            onChange={(v) => updateLine(line.key, { batchId: v })}
                            options={line.batchOptions}
                            placeholder="Chọn lô..."
                          />
                        </label>
                      ) : (
                        <div />
                      )}
                      <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
                        Số lượng
                        <input
                          type="number"
                          min={1}
                          max={line.maxQuantity ?? undefined}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </label>
                    </div>
                  </div>
                ))}

                <div className="pt-1">
                  <label htmlFor="dispense-otc-search" className="text-xs font-semibold text-slate-600">
                    + Thêm hàng không theo đơn
                  </label>
                  <input
                    id="dispense-otc-search"
                    type="search"
                    value={otcQuery}
                    onChange={(e) => setOtcQuery(e.target.value)}
                    placeholder="Gõ tên hàng không cần kê đơn..."
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {otcQuery.trim() !== '' && (
                    <div className="mt-1.5 flex max-h-32 flex-col gap-1 overflow-y-auto">
                      {otcResults.length === 0 && <p className="px-1 py-1 text-xs text-slate-400">Không tìm thấy hàng không theo đơn khớp.</p>}
                      {otcResults.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => addOtcLine(d)}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm hover:border-blue-400 hover:bg-brand-teal-tint"
                        >
                          <span className="font-semibold text-slate-900">{d.name}</span>
                          {d.defaultSellPrice !== null && <span className="ml-1.5 text-xs text-slate-500">{formatVnd(d.defaultSellPrice)}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
              <p className="text-sm font-semibold text-slate-700">
                Tổng tiền: <span className="text-slate-900">{formatVnd(totalAmount)}</span>
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Đóng
                </Button>
                <Button type="button" onClick={() => void handleSubmit()} loading={createMutation.isPending} disabled={!lines || lines.length === 0}>
                  Xác nhận phát thuốc
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
