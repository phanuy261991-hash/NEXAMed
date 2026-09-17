import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, X } from '@phosphor-icons/react';
import type { StockIssueLineInput } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useHasPermission } from '../auth/usePermission';
import { useDrugsQuery } from '../drug/drug.queries';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useCreateStockIssueMutation, usePrescriptionDispenseStatusQuery } from './inventory.queries';

interface BatchOption {
  batchId: string;
  batchNo: string;
  expiryDate: string | null;
  quantityOnHand: number;
}

interface BatchRow {
  key: string;
  batchId: string;
  quantity: string;
}

interface DraftLine {
  key: string;
  prescriptionItemId: string | null;
  drugId: string;
  drugName: string;
  isBatchManaged: boolean;
  /** `null` = dòng OTC không theo đơn, không giới hạn số lượng theo kê đơn. */
  maxQuantity: number | null;
  prescribedQuantity: number | null;
  sellPrice: number;
  /** Chỉ dùng khi `!isBatchManaged` — không quản lý lô thì luôn đúng 1 dòng số lượng. */
  quantity: string;
  /** Chỉ dùng khi `isBatchManaged` — mỗi dòng 1 lô + số lượng riêng, tự tách theo FEFO lúc nạp,
   * sửa/thêm/bớt được (mockup đã chốt "khách chỉ lấy 1 phần"/"1 loại thuốc phát từ nhiều lô"). */
  batchRows: BatchRow[];
  batchOptions: BatchOption[];
  /** Bỏ chọn = khách chưa lấy dòng này hôm nay — không tính vào phiếu xuất, đơn vẫn giữ "còn phát"
   * cho lần sau (mockup đã chốt, docs/DECISIONS.md #163 → sửa lại đủ ở #165). */
  selected: boolean;
}

interface SuccessInfo {
  issueNo: string;
  totalAmount: number;
  encounterId: string;
  attachedInvoice: { invoiceId: string; invoiceNo: string; invoiceType: 'SERVICE' | 'DRUG' } | null;
}

/** Tự tách 1 số lượng cần phát qua nhiều lô theo thứ tự FEFO (đã sắp sẵn từ BE) — lấy hết lô đang
 * xét tới khi đủ, lô cuối chỉ lấy phần còn thiếu. Không đủ tồn tổng thì để dòng cuối vượt quá (BE
 * chặn lại đúng, FE chỉ gợi ý mặc định, dược sĩ tự sửa số nếu cần). */
function autoSplitFefo(batches: BatchOption[], totalNeeded: number): BatchRow[] {
  const rows: BatchRow[] = [];
  let remaining = totalNeeded;
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantityOnHand, remaining);
    if (take > 0) {
      rows.push({ key: crypto.randomUUID(), batchId: b.batchId, quantity: String(take) });
      remaining -= take;
    }
  }
  if (rows.length === 0) {
    const first = batches[0];
    if (first) rows.push({ key: crypto.randomUUID(), batchId: first.batchId, quantity: '0' });
  }
  return rows;
}

function batchLabel(b: BatchOption): string {
  return `Lô ${b.batchNo}${b.expiryDate ? ` · HSD ${b.expiryDate}` : ''} · Còn ${b.quantityOnHand}`;
}

/**
 * "Phát thuốc" (Kho Thuốc GĐ3, docs/DECISIONS.md #163, sửa lại đủ theo mockup ở #165) — component
 * DÙNG CHUNG cho cả trang riêng `DispenseQueuePage.tsx` (bấm 1 dòng) lẫn `PrescriptionPanel.tsx`
 * (nút "Phát thuốc" trong màn khám). Mỗi dòng thuốc kê hiện kê/đã phát/còn lại, checkbox bỏ chọn
 * dòng khách chưa lấy hôm nay (không bắt buộc phát hết 1 lần); thuốc quản lý theo lô tự tách nhiều
 * lô theo FEFO khi 1 lô không đủ, mỗi lô 1 dòng số lượng riêng sửa/thêm/bớt được. Dòng đã phát ĐỦ
 * vẫn hiện (chỉ đọc, không ẩn khỏi danh sách — để dược sĩ luôn thấy trọn vẹn đơn gốc). Sau khi phát
 * xong KHÔNG tự điều hướng sang Thu ngân (#163 điểm 6) — chỉ hiện popup xác nhận đứng nguyên tại
 * đây, nút "Xem hoá đơn" tuỳ chọn ẩn hẳn nếu thiếu quyền `invoice.read`.
 */
export function DispensePrescriptionDialog({ prescriptionId, onClose, onDispensed }: { prescriptionId: string; onClose: () => void; onDispensed?: () => void }) {
  const navigate = useNavigate();
  const canViewInvoice = useHasPermission('invoice', 'read');
  const warehousesQuery = useWarehousesQuery();
  const warehouses = warehousesQuery.data?.items ?? [];
  const [warehouseId, setWarehouseId] = useState('');
  const effectiveWarehouseId = warehouseId || warehouses[0]?.id || '';

  const statusQuery = usePrescriptionDispenseStatusQuery(prescriptionId, effectiveWarehouseId || undefined, effectiveWarehouseId !== '');
  const createMutation = useCreateStockIssueMutation();

  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [otcQuery, setOtcQuery] = useState('');
  const debouncedOtcQuery = useDebouncedValue(otcQuery, 300);
  const otcSearch = useDrugsQuery({ q: debouncedOtcQuery.trim() || undefined, prescriptionOnly: false });

  // Dòng đã phát ĐỦ — chỉ đọc, tính thẳng từ query, không đưa vào draft (không bao giờ sửa được).
  const fullyDispensedLines = statusQuery.data?.lines.filter((l) => l.remainingQuantity === 0) ?? [];

  // Nạp draft từ response ĐÚNG 1 LẦN khi query load xong (không dùng useEffect — so `lines===null`
  // ngay trong render, đúng mẫu `PrescriptionPanel.tsx` reset draft theo key). Mặc định TICK sẵn
  // mọi dòng còn thuốc để phát (đúng hành vi cũ), khách chưa lấy hôm nay thì bác sĩ tự bỏ chọn.
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
          prescribedQuantity: l.prescribedQuantity,
          quantity: String(l.remainingQuantity),
          batchRows: l.isBatchManaged ? autoSplitFefo(l.suggestedBatches, l.remainingQuantity) : [],
          batchOptions: l.suggestedBatches,
          sellPrice: l.sellPrice,
          selected: true,
        })),
    );
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => (prev ? prev.map((l) => (l.key === key ? { ...l, ...patch } : l)) : prev));
  }

  function removeLine(key: string) {
    setLines((prev) => (prev ? prev.filter((l) => l.key !== key) : prev));
  }

  function updateBatchRow(lineKey: string, rowKey: string, patch: Partial<BatchRow>) {
    setLines((prev) =>
      prev
        ? prev.map((l) => (l.key === lineKey ? { ...l, batchRows: l.batchRows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) } : l))
        : prev,
    );
  }

  function addBatchRow(lineKey: string) {
    setLines((prev) =>
      prev
        ? prev.map((l) => {
            if (l.key !== lineKey) return l;
            const usedIds = new Set(l.batchRows.map((r) => r.batchId));
            const nextOption = l.batchOptions.find((b) => !usedIds.has(b.batchId)) ?? l.batchOptions[0];
            if (!nextOption) return l;
            return { ...l, batchRows: [...l.batchRows, { key: crypto.randomUUID(), batchId: nextOption.batchId, quantity: '0' }] };
          })
        : prev,
    );
  }

  function removeBatchRow(lineKey: string, rowKey: string) {
    setLines((prev) => (prev ? prev.map((l) => (l.key === lineKey ? { ...l, batchRows: l.batchRows.filter((r) => r.key !== rowKey) } : l)) : prev));
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
        prescribedQuantity: null,
        quantity: '1',
        batchRows: [],
        batchOptions: [],
        sellPrice: drug.defaultSellPrice ?? 0,
        selected: true,
      },
    ]);
    setOtcQuery('');
  }

  /** Tổng số lượng đang phân bổ của 1 dòng — dùng cả cho hiển thị lẫn payload gửi lên. */
  function lineQuantity(line: DraftLine): number {
    if (!line.isBatchManaged) return Number(line.quantity) || 0;
    return line.batchRows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  }

  /** 1 `DraftLine` batch-managed tách thành N dòng payload (1 dòng/lô có số lượng > 0) — kiểu trả
   * về khai TƯỜNG MINH theo đúng `StockIssueLineInput` (@nexamed/shared), không để TS tự suy literal
   * type `undefined` cho nhánh không quản lý lô (đã gây lỗi biên dịch thật khi viết bằng ternary
   * trực tiếp trong `flatMap`, xem docs/DECISIONS.md #165 mục 5). */
  function toIssueLines(l: DraftLine): StockIssueLineInput[] {
    if (l.isBatchManaged) {
      return l.batchRows
        .filter((r) => (Number(r.quantity) || 0) > 0)
        .map((r): StockIssueLineInput => ({ prescriptionItemId: l.prescriptionItemId, drugId: l.drugId, batchId: r.batchId, quantity: Math.max(1, Number(r.quantity) || 1) }));
    }
    return [{ prescriptionItemId: l.prescriptionItemId, drugId: l.drugId, quantity: Math.max(1, Number(l.quantity) || 1) }];
  }

  async function handleSubmit() {
    if (!lines || !effectiveWarehouseId) return;
    const submittedLines = lines.filter((l) => l.selected);
    if (submittedLines.length === 0) return;
    setError(null);
    for (const line of submittedLines) {
      if (line.isBatchManaged && line.batchRows.some((r) => !r.batchId)) {
        setError(`"${line.drugName}" quản lý theo lô — phải chọn đủ lô cho từng dòng.`);
        return;
      }
    }
    try {
      const result = await createMutation.mutateAsync({
        prescriptionId,
        warehouseId: effectiveWarehouseId,
        lines: submittedLines.flatMap(toIssueLines),
      });
      setSuccess({
        issueNo: result.issueNo,
        totalAmount: result.totalAmount,
        encounterId: statusQuery.data?.encounterId ?? '',
        attachedInvoice: result.attachedInvoice,
      });
      onDispensed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Phát thuốc thất bại, vui lòng thử lại.');
    }
  }

  function handleViewInvoice() {
    if (!success?.attachedInvoice || !success.encounterId) return;
    onClose();
    navigate(`/billing/${success.encounterId}?invoiceId=${success.attachedInvoice.invoiceId}`);
  }

  // "Đang chọn phát X/Y loại" — chỉ đếm dòng thuốc KÊ còn phải phát (không tính OTC, không tính
  // dòng đã phát đủ — đúng mockup: 4 dòng ví dụ nhưng đếm "3 loại", bỏ dòng Cetirizine đã phát đủ).
  const selectablePrescribedLines = (lines ?? []).filter((l) => l.maxQuantity !== null);
  const selectedPrescribedCount = selectablePrescribedLines.filter((l) => l.selected).length;
  const unselectedNames = selectablePrescribedLines.filter((l) => !l.selected).map((l) => l.drugName);

  const totalAmount = (lines ?? []).filter((l) => l.selected).reduce((sum, l) => sum + lineQuantity(l) * l.sellPrice, 0);
  const otcResults = (otcSearch.data?.items ?? []).filter((d) => !(lines ?? []).some((l) => l.drugId === d.id));
  const hasSelectedLine = (lines ?? []).some((l) => l.selected);
  const signedAtLabel = statusQuery.data?.signedAt
    ? new Date(statusQuery.data.signedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="dispense-title">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        {success ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-xl font-bold text-white">
              <CheckCircle size={24} weight="fill" aria-hidden="true" />
            </div>
            <p id="dispense-title" className="text-base font-bold text-slate-900">
              Đã phát thuốc thành công
            </p>
            <p className="text-sm text-slate-500">
              Phiếu <span className="font-semibold text-slate-700">{success.issueNo}</span>
            </p>
            {success.attachedInvoice && (
              <div className="w-full rounded-md bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
                Đã cộng <span className="font-bold">{formatVnd(success.totalAmount)}</span> vào{' '}
                <span className="font-bold">
                  {success.attachedInvoice.invoiceType === 'DRUG' ? 'hoá đơn thuốc riêng' : 'hoá đơn khám'} {success.attachedInvoice.invoiceNo}
                </span>
                .
              </div>
            )}
            <p className="text-xs text-slate-400">Thu ngân sẽ thu khoản này khi khách ra quầy thanh toán — không cần bạn xử lý thêm.</p>
            <div className="mt-1 flex gap-2">
              {canViewInvoice && success.attachedInvoice && (
                <Button type="button" variant="secondary" onClick={handleViewInvoice}>
                  Xem hoá đơn →
                </Button>
              )}
              <Button type="button" onClick={onClose}>
                Xong, quay lại hàng đợi
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="dispense-title" className="text-[15px] font-bold text-slate-900">
                  Phát thuốc
                </h2>
                {signedAtLabel && <p className="mt-0.5 text-xs text-slate-500">Đơn đã ký lúc {signedAtLabel}</p>}
              </div>
              <div className="flex items-center gap-3">
                {warehouses.length > 1 && (
                  <div className="w-56">
                    <Combobox id="dispense-warehouse" value={effectiveWarehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                  </div>
                )}
                <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
                  <X size={18} weight="bold" />
                </button>
              </div>
            </div>

            {statusQuery.isPending && (
              <div className="space-y-2 p-5">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}
            {statusQuery.isError && (
              <div className="p-5">
                <ErrorBanner message={statusQuery.error instanceof ApiError ? statusQuery.error.message : 'Không tải được trạng thái phát thuốc.'} onRetry={() => void statusQuery.refetch()} />
              </div>
            )}

            {lines && (
              <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {selectablePrescribedLines.length > 0 && (
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      Bấm bỏ chọn dòng nào khách <span className="font-semibold">chưa lấy hôm nay</span> — không bắt buộc phát hết mọi thuốc đã kê trong 1 lần.
                    </p>
                    <p className="shrink-0 text-xs font-bold text-blue-600">
                      Đang chọn phát {selectedPrescribedCount}/{selectablePrescribedLines.length} loại
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {lines.length === 0 && fullyDispensedLines.length === 0 && (
                    <p className="col-span-full py-4 text-center text-sm text-slate-500">Đơn thuốc không có dòng nào cần phát.</p>
                  )}
                  {lines.map((line) => {
                    const allocated = lineQuantity(line);
                    return (
                      <div key={line.key} className={`flex gap-2.5 rounded-lg border border-slate-200 p-3.5 ${!line.selected ? 'bg-slate-50' : ''}`}>
                        {line.maxQuantity !== null && (
                          <input
                            type="checkbox"
                            checked={line.selected}
                            onChange={(e) => updateLine(line.key, { selected: e.target.checked })}
                            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                            aria-label={`Chọn phát ${line.drugName}`}
                          />
                        )}
                        <div className={`min-w-0 flex-1 ${!line.selected ? 'opacity-50' : ''}`}>
                          <div className="mb-1.5 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-bold text-slate-900">{line.drugName}</p>
                              {line.maxQuantity !== null && (
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Kê {line.prescribedQuantity} · Còn lại {line.maxQuantity}
                                  {line.isBatchManaged && allocated !== line.maxQuantity && (
                                    <span className="ml-1 font-semibold text-amber-600">(đang phân bổ {allocated})</span>
                                  )}
                                </p>
                              )}
                            </div>
                            {line.isBatchManaged ? (
                              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-700">Quản lý theo lô</span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">Không quản lý lô</span>
                            )}
                            {line.maxQuantity === null && (
                              <button type="button" onClick={() => removeLine(line.key)} className="text-xs font-semibold text-rose-600 hover:text-rose-700">
                                Xoá
                              </button>
                            )}
                          </div>

                          {line.isBatchManaged ? (
                            <div className="flex flex-col gap-1.5">
                              {line.batchRows.map((row) => {
                                const opt = line.batchOptions.find((b) => b.batchId === row.batchId);
                                return (
                                  <div key={row.key} className="flex items-center gap-1.5 rounded-md border-2 border-blue-200 bg-blue-50/60 px-2.5 py-1.5">
                                    <div className="min-w-0 flex-1">
                                      <Combobox
                                        id={`dispense-batch-${row.key}`}
                                        value={row.batchId}
                                        onChange={(v) => updateBatchRow(line.key, row.key, { batchId: v })}
                                        options={line.batchOptions.map((b) => ({ value: b.batchId, label: batchLabel(b) }))}
                                        placeholder="Chọn lô..."
                                        disabled={!line.selected}
                                      />
                                    </div>
                                    <input
                                      type="number"
                                      min={0}
                                      max={opt?.quantityOnHand ?? undefined}
                                      value={row.quantity}
                                      disabled={!line.selected}
                                      onChange={(e) => updateBatchRow(line.key, row.key, { quantity: e.target.value })}
                                      className="w-16 shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                                    />
                                    {line.batchRows.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => removeBatchRow(line.key, row.key)}
                                        disabled={!line.selected}
                                        aria-label="Bỏ dòng lô này"
                                        className="shrink-0 text-slate-400 hover:text-rose-600 disabled:opacity-40"
                                      >
                                        <X size={13} weight="bold" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                              {line.batchRows.length < line.batchOptions.length && (
                                <button
                                  type="button"
                                  onClick={() => addBatchRow(line.key)}
                                  disabled={!line.selected}
                                  className="w-fit text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40"
                                >
                                  + Đổi/thêm lô khác
                                </button>
                              )}
                            </div>
                          ) : (
                            <label className="flex w-32 flex-col gap-0.5 text-xs font-semibold text-slate-600">
                              Số lượng
                              <input
                                type="number"
                                min={1}
                                max={line.maxQuantity ?? undefined}
                                value={line.quantity}
                                disabled={!line.selected}
                                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {fullyDispensedLines.map((line) => (
                    <div key={line.prescriptionItemId} className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                      <CheckCircle size={18} weight="fill" className="shrink-0 text-emerald-500" aria-hidden="true" />
                      <div className="flex flex-1 items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-500">{line.drugName}</p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            Kê {line.prescribedQuantity} · Đã phát {line.dispensedQuantity} · Còn lại 0
                          </p>
                        </div>
                        <StatusBadge tone="success">Đã phát đủ</StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>

                {unselectedNames.length > 0 && (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {unselectedNames.join(', ')} chưa được chọn — vẫn giữ nguyên &quot;còn phát&quot; trên đơn, khách có thể quay lại lấy sau (không mất y lệnh của bác sĩ).
                  </p>
                )}

                <div className="mt-4 rounded-lg border-2 border-dashed border-indigo-200 p-3.5">
                  <label htmlFor="dispense-otc-search" className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                    + Thêm hàng không theo đơn (khách mua thêm)
                  </label>
                  <input
                    id="dispense-otc-search"
                    type="search"
                    value={otcQuery}
                    onChange={(e) => setOtcQuery(e.target.value)}
                    placeholder="Gõ tên hàng không cần kê đơn..."
                    className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {otcQuery.trim() !== '' && (
                    <div className="mt-1.5 flex max-h-32 flex-col gap-1 overflow-y-auto">
                      {otcResults.length === 0 && <p className="px-1 py-1 text-xs text-slate-400">Không tìm thấy hàng không theo đơn khớp.</p>}
                      {otcResults.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => addOtcLine(d)}
                          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left text-sm hover:border-blue-400 hover:bg-brand-teal-tint"
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

            {error && <p className="px-5 text-xs font-medium text-rose-600">{error}</p>}

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3.5">
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  Tổng tiền: <span className="text-base text-slate-900">{formatVnd(totalAmount)}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">Chỉ tính tiền các dòng đang chọn — số tiền sẽ cộng vào hoá đơn tương ứng của lượt khám. Thu tiền vẫn xử lý riêng ở Thu ngân.</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Huỷ
                </Button>
                <Button type="button" onClick={() => void handleSubmit()} loading={createMutation.isPending} disabled={!hasSelectedLine}>
                  ✓ Xác nhận phát thuốc
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
