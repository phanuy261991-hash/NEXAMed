import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Pill, Plus, Trash, X } from '@phosphor-icons/react';
import type { StockIssueLineInput } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
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
  /** Tồn kho THẬT tại kho đang chọn — khác hẳn `maxQuantity` (còn lại theo đơn). `null` cho dòng
   * OTC (không tra tồn riêng, `addOtcLine` không có nguồn dữ liệu này). */
  warehouseStockOnHand: number | null;
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
 * "Phát thuốc" (Kho Thuốc GĐ3, docs/DECISIONS.md #163, sửa lại đủ theo mockup ở #165, redesign
 * style 21/09/2026 theo yêu cầu chủ dự án — giữ nguyên toàn bộ hành vi/logic nghiệp vụ, chỉ đổi
 * cách trình bày: `ModalHeader`/`SelectionCheckbox` dùng chung, Phosphor icon thay ký tự Unicode,
 * rút gọn các dòng chú thích dài) — component DÙNG CHUNG cho cả trang riêng `DispenseQueuePage.tsx`
 * (bấm 1 dòng) lẫn `PrescriptionPanel.tsx` (nút "Phát thuốc" trong màn khám). Mỗi dòng thuốc kê
 * hiện kê/đã phát/còn lại, checkbox bỏ chọn dòng khách chưa lấy hôm nay (không bắt buộc phát hết 1
 * lần); thuốc quản lý theo lô tự tách nhiều lô theo FEFO khi 1 lô không đủ, mỗi lô 1 dòng số lượng
 * riêng sửa/thêm/bớt được. Dòng đã phát ĐỦ vẫn hiện (chỉ đọc, không ẩn khỏi danh sách — để dược sĩ
 * luôn thấy trọn vẹn đơn gốc). Sau khi phát xong KHÔNG tự điều hướng sang Thu ngân (#163 điểm 6) —
 * chỉ hiện popup xác nhận đứng nguyên tại đây, nút "Xem hoá đơn" tuỳ chọn ẩn hẳn nếu thiếu quyền
 * `invoice.read`.
 */
export function DispensePrescriptionDialog({ prescriptionId, onClose, onDispensed }: { prescriptionId: string; onClose: () => void; onDispensed?: () => void }) {
  const navigate = useNavigate();
  const canViewInvoice = useHasPermission('invoice', 'read');
  const warehousesQuery = useWarehousesQuery();
  // Phân quyền theo Khoa/Phòng (retrofit #173/#177) — đúng khuôn `StockCountFormPage.tsx`. Backend
  // LUÔN enforce lại (404 nếu chọn sai kho) — lọc ở đây thuần UX, tránh hiện lựa chọn chắc chắn bị chặn.
  const createDataScope = useDataScope('stock_issue', 'create');
  const actorDepartmentId = useActorDepartmentId();
  const isDepartmentScoped = createDataScope === 'department';
  const warehouses = (warehousesQuery.data?.items ?? []).filter((w) => !isDepartmentScoped || w.departmentId === actorDepartmentId);
  const [warehouseId, setWarehouseId] = useState('');
  const effectiveWarehouseId = warehouseId || warehouses[0]?.id || '';

  const statusQuery = usePrescriptionDispenseStatusQuery(prescriptionId, effectiveWarehouseId || undefined, effectiveWarehouseId !== '');
  const createMutation = useCreateStockIssueMutation();

  const [lines, setLines] = useState<DraftLine[] | null>(null);
  // Kho đã dùng để nạp `lines` lần gần nhất — đổi kho phải nạp LẠI (tồn/lô theo từng kho khác nhau
  // hoàn toàn), khác `lines===null` thuần chỉ nạp lần đầu (bug thật: đổi kho xong vẫn hiện tồn kho/
  // lô của kho CŨ vì guard cũ không bao giờ chạy lại — chủ dự án phát hiện 22/09/2026). Cùng mẫu
  // `loadedForId` đã dùng ở `EncounterConsultationPage.tsx` khi đổi ca khám không nạp lại dữ liệu.
  const [loadedForWarehouseId, setLoadedForWarehouseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [otcQuery, setOtcQuery] = useState('');
  const debouncedOtcQuery = useDebouncedValue(otcQuery, 300);
  const otcSearch = useDrugsQuery({ q: debouncedOtcQuery.trim() || undefined, prescriptionOnly: false });

  // Dòng đã phát ĐỦ — chỉ đọc, tính thẳng từ query, không đưa vào draft (không bao giờ sửa được).
  const fullyDispensedLines = statusQuery.data?.lines.filter((l) => l.remainingQuantity === 0) ?? [];

  // Nạp draft từ response khi query load xong, và NẠP LẠI mỗi khi đổi kho (tồn/lô khác hẳn theo
  // từng kho — bug thật đã sửa 22/09/2026: trước đây chỉ nạp 1 lần bằng guard `lines===null`, đổi
  // kho xong statusQuery refetch đúng dữ liệu mới nhưng `lines` không cập nhật theo, vẫn hiện tồn
  // kho/lô của kho ĐẦU TIÊN mãi mãi). So sánh `loadedForWarehouseId` ngay trong render (không dùng
  // `useEffect`), cùng mẫu `loadedForId` đã dùng ở `EncounterConsultationPage.tsx` khi đổi ca khám.
  // Mặc định TICK sẵn mọi dòng còn thuốc để phát (đúng hành vi cũ), khách chưa lấy hôm nay thì bác
  // sĩ tự bỏ chọn.
  if (loadedForWarehouseId !== effectiveWarehouseId && statusQuery.isSuccess) {
    setLoadedForWarehouseId(effectiveWarehouseId);
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
          warehouseStockOnHand: l.warehouseStockOnHand,
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
        warehouseStockOnHand: null,
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
  // Chỉ loại thuốc đã có DÒNG OTC (chưa theo đơn, tránh thêm trùng lặp vô ích) — KHÔNG loại thuốc
  // đã có dòng THEO ĐƠN, để dược sĩ vẫn thêm được "mua thêm ngoài số đã kê" thành dòng OTC riêng
  // (đúng thuốc đã kê, khách lấy vượt số kê) — xem cuộc trao đổi nghiệp vụ, chốt trực tiếp.
  const otcResults = (otcSearch.data?.items ?? []).filter((d) => !(lines ?? []).some((l) => l.drugId === d.id && l.prescriptionItemId === null));
  const hasSelectedLine = (lines ?? []).some((l) => l.selected);
  const signedAtLabel = statusQuery.data?.signedAt
    ? new Date(statusQuery.data.signedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Phát thuốc">
      <div className={`flex max-h-[88vh] w-full flex-col rounded-xl bg-white shadow-xl ${success ? 'max-w-sm' : 'max-w-5xl'}`}>
        {success ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white">
              <CheckCircle size={24} weight="fill" aria-hidden="true" />
            </div>
            <p className="text-base font-bold text-slate-900">Đã phát thuốc thành công</p>
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
            <p className="text-xs text-slate-400">Thu ngân sẽ thu khi khách thanh toán.</p>
            <div className="mt-1 flex w-full flex-col gap-2">
              <Button type="button" onClick={onClose} className="w-full">
                Xong, quay lại hàng đợi
              </Button>
              {canViewInvoice && success.attachedInvoice && (
                <Button type="button" variant="secondary" onClick={handleViewInvoice} className="w-full">
                  Xem hoá đơn →
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 pt-5">
              <ModalHeader
                icon={Pill}
                title="Phát thuốc"
                onClose={onClose}
                right={
                  <div className="flex items-center gap-2.5">
                    {signedAtLabel && <StatusBadge tone="success">Đã ký {signedAtLabel}</StatusBadge>}
                    {warehouses.length > 1 && (
                      <div className="w-56">
                        <Combobox id="dispense-warehouse" value={effectiveWarehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                      </div>
                    )}
                  </div>
                }
              />
            </div>

            {statusQuery.data && (
              <div className="px-5 pb-4">
                {/* Bệnh nhân — trước đây KHÔNG hiện ở đâu trong dialog này, chỉ có ở trang hàng đợi
                    bên ngoài (rà soát 22/09/2026, chủ dự án phát hiện). Đặt riêng 1 dòng, nổi bật
                    nhất trong khối — đây là thứ dược sĩ cần xác nhận ĐẦU TIÊN trước khi phát. */}
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5">
                  <span className="text-sm font-semibold text-blue-900">Bệnh nhân:</span>
                  <span className="text-[15px] font-bold text-blue-950">{statusQuery.data.patientFullName}</span>
                  <span className="text-sm font-semibold text-blue-700">({statusQuery.data.patientCode})</span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">Mã đơn thuốc</span>
                      <span className="font-bold text-teal-600">{statusQuery.data.prescriptionNo ?? '—'}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">BS Kê đơn</span>
                      <span className="truncate font-bold text-slate-900">{statusQuery.data.signedByName ?? '—'}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">Ngày kê</span>
                      <span className="font-bold text-slate-900">{signedAtLabel ?? '—'}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                    <p className="text-sm font-semibold text-amber-900">Chẩn đoán lâm sàng</p>
                    <p className="mt-1.5 text-[15px] font-bold text-amber-950">{statusQuery.data.diagnosisLabel ?? '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {statusQuery.isPending && (
              <div className="space-y-2 px-5 pb-5">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}
            {statusQuery.isError && (
              <div className="px-5 pb-5">
                <ErrorBanner message={statusQuery.error instanceof ApiError ? statusQuery.error.message : 'Không tải được trạng thái phát thuốc.'} onRetry={() => void statusQuery.refetch()} />
              </div>
            )}

            {lines && (
              <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                {selectablePrescribedLines.length > 0 && (
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-500">
                      Bỏ chọn dòng khách <span className="font-semibold text-slate-700">chưa lấy hôm nay</span>.
                    </p>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                      {selectedPrescribedCount}/{selectablePrescribedLines.length} loại đang chọn
                    </span>
                  </div>
                )}

                <div className="flex flex-col divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {lines.length === 0 && fullyDispensedLines.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-500">Đơn thuốc không có dòng nào cần phát.</p>
                  )}
                  {lines.map((line) => {
                    const allocated = lineQuantity(line);
                    return (
                      <div key={line.key} className={`flex flex-col gap-2 px-4 py-3 ${!line.selected ? 'bg-slate-50' : ''}`}>
                        <div className="flex items-center gap-3">
                          {line.maxQuantity !== null && (
                            <SelectionCheckbox checked={line.selected} onChange={() => updateLine(line.key, { selected: !line.selected })} ariaLabel={`Chọn phát ${line.drugName}`} />
                          )}
                          <div className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 ${!line.selected ? 'opacity-50' : ''}`}>
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                              <p className="truncate text-[15px] font-bold text-slate-900">{line.drugName}</p>
                              {line.isBatchManaged ? (
                                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-700">Theo lô</span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">Không theo lô</span>
                              )}
                              {line.maxQuantity !== null && (
                                <p className="text-xs font-semibold text-slate-600">
                                  Đã kê đơn <span className="font-bold text-slate-900">{line.prescribedQuantity}</span> · Còn lại{' '}
                                  <span className="font-bold text-slate-900">{line.maxQuantity}</span>
                                  {line.isBatchManaged && allocated !== line.maxQuantity && (
                                    <span className="ml-1 font-bold text-amber-600">(đang chọn {allocated})</span>
                                  )}
                                  {line.warehouseStockOnHand !== null && (
                                    <>
                                      {' '}
                                      · Tồn kho{' '}
                                      <span className={`font-bold ${line.warehouseStockOnHand < line.maxQuantity ? 'text-rose-600' : 'text-slate-900'}`}>
                                        {line.warehouseStockOnHand}
                                      </span>
                                    </>
                                  )}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              {!line.isBatchManaged && (
                                <div className="flex items-center gap-2">
                                  <label htmlFor={`dispense-qty-${line.key}`} className="text-sm font-semibold text-slate-800">
                                    Số lượng
                                  </label>
                                  <input
                                    id={`dispense-qty-${line.key}`}
                                    type="number"
                                    min={1}
                                    max={line.maxQuantity ?? undefined}
                                    value={line.quantity}
                                    disabled={!line.selected}
                                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                                    className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
                                  />
                                </div>
                              )}
                              {line.maxQuantity === null && (
                                <button type="button" onClick={() => removeLine(line.key)} aria-label={`Xoá ${line.drugName}`} className="text-slate-400 hover:text-rose-600">
                                  <Trash size={15} weight="bold" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {line.isBatchManaged && (
                          <div className="flex flex-col gap-1.5 pl-7">
                            {line.batchRows.map((row) => {
                                const opt = line.batchOptions.find((b) => b.batchId === row.batchId);
                                return (
                                  <div key={row.key} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
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
                                      className="w-16 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
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
                                  className="flex w-fit items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40"
                                >
                                  <Plus size={12} weight="bold" aria-hidden="true" /> Đổi/thêm lô khác
                                </button>
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}

                  {fullyDispensedLines.map((line) => (
                    <div key={line.prescriptionItemId} className="flex items-center gap-2.5 bg-slate-50 px-4 py-3">
                      <CheckCircle size={18} weight="fill" className="shrink-0 text-emerald-500" aria-hidden="true" />
                      <div className="flex flex-1 items-center justify-between">
                        <div>
                          <p className="text-[15px] font-bold text-slate-500">{line.drugName}</p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            Đã kê đơn {line.prescribedQuantity} · Đã phát {line.dispensedQuantity} · Còn lại 0
                          </p>
                        </div>
                        <StatusBadge tone="success">Đã phát đủ</StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>

                {unselectedNames.length > 0 && (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {unselectedNames.join(', ')} chưa chọn — vẫn giữ &quot;còn phát&quot; cho lần sau.
                  </p>
                )}

                <div className="mt-4 rounded-lg border-2 border-dashed border-indigo-200 p-3.5">
                  <label htmlFor="dispense-otc-search" className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                    <Plus size={12} weight="bold" aria-hidden="true" /> Thêm hàng không theo đơn (khách mua thêm)
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

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tổng tiền</p>
                <p className="text-xl font-bold tabular-nums text-slate-900">{formatVnd(totalAmount)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <p className="hidden max-w-[200px] text-[11px] text-slate-400 sm:block">Cộng vào hoá đơn, thu tiền xử lý ở Thu ngân.</p>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="secondary" onClick={onClose}>
                    Huỷ
                  </Button>
                  <Button type="button" variant="success" onClick={() => void handleSubmit()} loading={createMutation.isPending} disabled={!hasSelectedLine}>
                    <CheckCircle size={16} weight="bold" aria-hidden="true" />
                    Xác nhận phát thuốc
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
