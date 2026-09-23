import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, MagnifyingGlass, Trash, Truck, Warning } from '@phosphor-icons/react';
import type { CreateStockTransferRequest, DrugSummary, ReceiveStockTransferLineInput, StockTransferStatus } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
import { useDrugsQuery } from '../drug/drug.queries';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { getDrugBatchBalances } from './inventory.api';
import {
  useCreateStockTransferMutation,
  useReceiveStockTransferMutation,
  useShipStockTransferMutation,
  useStockBalancesQuery,
  useStockTransferQuery,
  useUpdateStockTransferMutation,
} from './inventory.queries';
import { StockTransferRejectDialog } from './StockTransferRejectDialog';

interface DraftLine {
  key: string;
  drugId: string;
  drugCode: string;
  drugName: string;
  isBatchManaged: boolean;
  batchId: string | null;
  batchNo: string;
  expiryDate: string;
  /** Tồn khả dụng tại kho NGUỒN — CHỈ hiển thị tham khảo, Duyệt xuất mới kiểm thật lại. */
  availableQuantity: number;
  quantityShipped: string;
}

interface ReceiveInput {
  quantityReceived: string;
  varianceNote: string;
}

const STATUS_META: Record<StockTransferStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  IN_TRANSIT: { label: 'Đang vận chuyển', tone: 'warning' },
  COMPLETED: { label: 'Hoàn tất', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

function makeKey(): string {
  return Math.random().toString(36).slice(2);
}

function todayVn(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function formatDateTimeVn(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * "Tạo phiếu điều chuyển" / "Sửa Nháp" / "Xác nhận nhận hàng" / "Xem chi tiết" — Kho Thuốc GĐ4, phần
 * "Điều chuyển kho" (docs/DECISIONS.md #170, mockup đã duyệt). TRANG RIÊNG (không modal, đúng khuôn
 * `StockReceiptFormPage.tsx`/`StockCountFormPage.tsx`) — dùng CHUNG 1 component cho cả 4 chế độ theo
 * trạng thái phiếu:
 * - `DRAFT` (tạo mới/sửa Nháp): form đầy đủ, search-and-pick mặt hàng theo lô tại kho NGUỒN.
 * - `IN_TRANSIT`: header chỉ đọc + bảng "Xác nhận nhận hàng" (SL thực nhận, bắt buộc ghi chú khi thiếu).
 * - `COMPLETED`/`REJECTED`: chỉ đọc toàn bộ.
 */
export function StockTransferFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const canApprove = useHasPermission('stock_transfer', 'approve');

  const transferQuery = useStockTransferQuery(id ?? '', isEdit);
  const warehousesQuery = useWarehousesQuery();
  // Phân quyền theo Khoa/Phòng (docs/DECISIONS.md #170) — lọc dropdown kho NGUỒN theo Khoa actor khi
  // scope `department` (lập phiếu = hành động của kho nguồn). Backend LUÔN enforce lại (404 nếu chọn
  // sai kho) — lọc ở đây thuần UX.
  const createDataScope = useDataScope('stock_transfer', 'create');
  const actorDepartmentId = useActorDepartmentId();
  const isDepartmentScoped = createDataScope === 'department';

  const createMutation = useCreateStockTransferMutation();
  const updateMutation = useUpdateStockTransferMutation();
  const shipMutation = useShipStockTransferMutation();
  const receiveMutation = useReceiveStockTransferMutation();

  const status = transferQuery.data?.status;
  const isDraftEditable = !isEdit || status === 'DRAFT';
  const isReceiving = isEdit && status === 'IN_TRANSIT';
  const isPureReadOnly = isEdit && (status === 'COMPLETED' || status === 'REJECTED');

  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayVn());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [addingDrugId, setAddingDrugId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [receiveInputs, setReceiveInputs] = useState<Record<string, ReceiveInput>>({});
  const [loadedForId, setLoadedForId] = useState<string | null>(null);

  useBreadcrumb([
    { label: 'Quản lý kho' },
    { label: 'Điều chuyển kho', to: '/inventory/transfers' },
    { label: isPureReadOnly ? 'Chi tiết' : isReceiving ? 'Xác nhận nhận hàng' : isEdit ? 'Sửa Nháp' : 'Tạo phiếu' },
  ]);

  // Nạp dữ liệu phiếu đã có vào state form — chỉ khi CHUYỂN SANG phiếu khác (đúng bài học
  // `loadedForId` đã sửa ở `EncounterConsultationPage.tsx`, tránh lẫn dữ liệu 2 phiếu).
  useEffect(() => {
    if (!transferQuery.data || transferQuery.data.id === loadedForId) return;
    const t = transferQuery.data;
    setFromWarehouseId(t.fromWarehouseId);
    setToWarehouseId(t.toWarehouseId);
    setOccurredAt(t.occurredAt.slice(0, 10));
    setNote(t.note ?? '');
    setLines(
      t.lines.map((l) => ({
        key: l.id,
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        isBatchManaged: l.isBatchManaged,
        batchId: l.batchId,
        batchNo: l.batchNo ?? '',
        expiryDate: l.expiryDate ?? '',
        availableQuantity: 0,
        quantityShipped: String(l.quantityShipped),
      })),
    );
    setReceiveInputs(
      Object.fromEntries(t.lines.map((l) => [l.id, { quantityReceived: String(l.quantityReceived ?? l.quantityShipped), varianceNote: l.varianceNote ?? '' }])),
    );
    setLoadedForId(t.id);
  }, [transferQuery.data, loadedForId]);

  const debouncedDrugQuery = useDebouncedValue(drugQuery, 300);
  const isSearchingDrug = drugQuery.trim() !== '';
  const drugSearchQuery = useDrugsQuery({ q: debouncedDrugQuery.trim() || undefined });
  const existingDrugIds = useMemo(() => new Set(lines.map((l) => l.drugId)), [lines]);
  const searchResults = isSearchingDrug ? (drugSearchQuery.data?.items ?? []).filter((d) => !existingDrugIds.has(d.id)) : [];

  // Tồn TỔNG HỢP tại kho NGUỒN theo drugId — dùng cho hàng KHÔNG quản lý theo lô.
  const balancesQuery = useStockBalancesQuery({ warehouseId: fromWarehouseId || undefined, belowMinOnly: false });
  const flatBalanceByDrugId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of balancesQuery.data?.items ?? []) map.set(item.drugId, item.quantityOnHand);
    return map;
  }, [balancesQuery.data]);

  async function expandDrugToLines(drug: DrugSummary): Promise<DraftLine[]> {
    if (!drug.isBatchManaged) {
      const available = flatBalanceByDrugId.get(drug.id) ?? 0;
      return [{ key: makeKey(), drugId: drug.id, drugCode: drug.code, drugName: drug.name, isBatchManaged: false, batchId: null, batchNo: '', expiryDate: '', availableQuantity: available, quantityShipped: '' }];
    }
    const res = await getDrugBatchBalances(drug.id, fromWarehouseId);
    return res.items
      .filter((b) => b.quantityOnHand > 0)
      .map((b) => ({
        key: makeKey(),
        drugId: drug.id,
        drugCode: drug.code,
        drugName: drug.name,
        isBatchManaged: true,
        batchId: b.batchId,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate ?? '',
        availableQuantity: b.quantityOnHand,
        quantityShipped: '',
      }));
  }

  async function addDrug(drug: DrugSummary) {
    if (!fromWarehouseId || existingDrugIds.has(drug.id)) {
      setDrugQuery('');
      return;
    }
    setAddingDrugId(drug.id);
    try {
      const newLines = await expandDrugToLines(drug);
      if (newLines.length === 0) {
        setFormError(`"${drug.name}" hiện không còn tồn tại kho nguồn.`);
      } else {
        setLines((prev) => [...prev, ...newLines]);
        setFormError(null);
      }
      setDrugQuery('');
      setHighlightedIndex(0);
    } finally {
      setAddingDrugId(null);
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const picked = searchResults[highlightedIndex] ?? searchResults[0];
      if (picked) void addDrug(picked);
    }
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function buildPayload(): CreateStockTransferRequest | null {
    if (!fromWarehouseId) {
      setFormError('Phải chọn Kho nguồn.');
      return null;
    }
    if (!toWarehouseId) {
      setFormError('Phải chọn Kho đích.');
      return null;
    }
    if (fromWarehouseId === toWarehouseId) {
      setFormError('Kho nguồn và kho đích phải khác nhau.');
      return null;
    }
    if (lines.length === 0) {
      setFormError('Phải có ít nhất 1 dòng hàng.');
      return null;
    }
    for (const l of lines) {
      if (!l.quantityShipped || Number(l.quantityShipped) <= 0) {
        setFormError(`Dòng "${l.drugName}" thiếu số lượng chuyển hợp lệ.`);
        return null;
      }
    }
    setFormError(null);
    return {
      fromWarehouseId,
      toWarehouseId,
      occurredAt: `${occurredAt}T00:00:00+07:00`,
      note: note || undefined,
      lines: lines.map((l) => ({ drugId: l.drugId, batchId: l.batchId ?? undefined, quantityShipped: Number(l.quantityShipped) })),
    };
  }

  async function handleSave(andShip: boolean) {
    const payload = buildPayload();
    if (!payload) return;

    let savedId: string | undefined;
    let savedVersion: number | undefined;
    try {
      if (isEdit && id) {
        const updated = await updateMutation.mutateAsync({ id, body: { ...payload, version: transferQuery.data!.version } });
        savedId = id;
        savedVersion = updated.version;
      } else {
        const created = await createMutation.mutateAsync(payload);
        savedId = created.id;
        savedVersion = created.version;
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Lưu phiếu thất bại, vui lòng thử lại.');
      return;
    }

    if (!andShip || !savedId) {
      navigate('/inventory/transfers');
      return;
    }
    try {
      await shipMutation.mutateAsync({ id: savedId, body: { version: savedVersion! } });
      navigate('/inventory/transfers');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Duyệt xuất thất bại, vui lòng thử lại.');
    }
  }

  async function handleReceive() {
    if (!transferQuery.data) return;
    const linesPayload: ReceiveStockTransferLineInput[] = transferQuery.data.lines.map((l) => {
      const input = receiveInputs[l.id] ?? { quantityReceived: String(l.quantityShipped), varianceNote: '' };
      return { lineId: l.id, quantityReceived: Number(input.quantityReceived || 0), varianceNote: input.varianceNote.trim() || undefined };
    });
    try {
      await receiveMutation.mutateAsync({ id: transferQuery.data.id, body: { version: transferQuery.data.version, lines: linesPayload } });
      navigate('/inventory/transfers');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Xác nhận nhận hàng thất bại, vui lòng thử lại.');
    }
  }

  if (isEdit && transferQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isEdit && transferQuery.isError) {
    return <ErrorBanner message={transferQuery.error instanceof ApiError ? transferQuery.error.message : 'Không tải được phiếu.'} onRetry={() => void transferQuery.refetch()} />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || shipMutation.isPending;
  const warehouseOptions = (warehousesQuery.data?.items ?? []).filter((w) => !isDepartmentScoped || w.departmentId === actorDepartmentId);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{isPureReadOnly ? 'Chi tiết phiếu điều chuyển kho' : isReceiving ? 'Xác nhận nhận hàng' : isEdit ? 'Sửa phiếu điều chuyển kho' : 'Tạo phiếu điều chuyển kho'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? transferQuery.data!.transferNo : 'Tạo phiếu điều chuyển kho'}</h2>
          {isEdit && transferQuery.data && <StatusBadge tone={STATUS_META[transferQuery.data.status].tone}>{STATUS_META[transferQuery.data.status].label}</StatusBadge>}
        </div>
        <div className="flex gap-2">
          {isDraftEditable && isEdit && canApprove && (
            <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
              Từ chối
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory/transfers')}>
            ← Quay lại danh sách
          </Button>
        </div>
      </div>

      {/* ============ Header — chọn kho/ngày/ghi chú (editable khi DRAFT) hoặc chỉ đọc ============ */}
      {isDraftEditable ? (
        <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Kho nguồn <span className="text-rose-500">*</span>
            </label>
            <Combobox
              id="transfer-from-warehouse"
              value={fromWarehouseId}
              disabled={lines.length > 0}
              onChange={setFromWarehouseId}
              placeholder="— Chọn kho —"
              options={warehouseOptions.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Kho đích <span className="text-rose-500">*</span>
            </label>
            <Combobox
              id="transfer-to-warehouse"
              value={toWarehouseId}
              onChange={setToWarehouseId}
              placeholder="— Chọn kho —"
              options={(warehousesQuery.data?.items ?? []).filter((w) => w.id !== fromWarehouseId).map((w) => ({ value: w.id, label: w.name }))}
            />
            <p className="mt-1 text-xs text-slate-400">Danh sách tự loại bỏ kho nguồn đã chọn.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Ngày chuyển <span className="text-rose-500">*</span>
            </label>
            <DateInput id="transfer-occurred-at" value={occurredAt} onChange={setOccurredAt} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">Ghi chú</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Chuyển bổ sung..."
              className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900"
            />
          </div>
        </div>
      ) : (
        <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Kho nguồn</p>
            <p className="text-base font-semibold text-slate-900">{transferQuery.data!.fromWarehouseName}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Kho đích</p>
            <p className="text-base font-semibold text-slate-900">{transferQuery.data!.toWarehouseName}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Ngày xuất</p>
            <p className="text-base font-semibold text-slate-900">
              {transferQuery.data!.shippedAt ? `${formatDateTimeVn(transferQuery.data!.shippedAt)} · ${transferQuery.data!.shippedByName}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Ghi chú phiếu</p>
            <p className="text-base font-semibold text-slate-900">{transferQuery.data!.note || '—'}</p>
          </div>
        </div>
      )}

      {/* ============ Xác nhận nhận hàng — banner cảnh báo ============ */}
      {isReceiving && (
        <div className="flex flex-shrink-0 items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm">
          <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0 text-blue-600" aria-hidden="true" />
          <p className="font-medium text-blue-900">Nhập đúng số lượng THỰC NHẬN. Có thể thấp hơn số đã xuất (bắt buộc ghi lý do) — không được nhập cao hơn.</p>
        </div>
      )}

      {/* ============ Search-and-pick (chỉ khi DRAFT) ============ */}
      {isDraftEditable && (
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative flex-1">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={drugQuery}
              disabled={!fromWarehouseId}
              onChange={(e) => {
                setDrugQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Gõ tên/mã/mã vạch mặt hàng tại Kho nguồn — Enter/Tab để thêm nhanh..."
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
            />
            {isSearchingDrug && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg scroll-hover">
                {searchResults.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Không tìm thấy, hoặc đã có sẵn trong phiếu.</p>}
                {searchResults.map((d, idx) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={addingDrugId !== null}
                    onClick={() => void addDrug(d)}
                    className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 disabled:opacity-60 ${idx === highlightedIndex ? 'bg-brand-teal-tint' : 'hover:bg-slate-50'}`}
                  >
                    <span className="font-bold text-slate-900">{d.name}</span> <span className="text-xs font-semibold text-slate-400">({d.code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-slate-400">Chỉ hiện mặt hàng đang có tồn tại Kho nguồn</span>
        </div>
      )}

      {/* ============ Bảng dòng hàng ============ */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 && isDraftEditable ? (
          <EmptyState icon={MagnifyingGlass} title="Chưa có dòng hàng nào" description="Gõ tên thuốc/vật tư ở ô trên để thêm dòng hàng." />
        ) : isDraftEditable ? (
          <div role="table" aria-label="Dòng hàng điều chuyển" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 820 }}>
              <div role="row" style={{ gridTemplateColumns: '1.8fr 150px 150px 50px' }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-left">Lô / Hạn sử dụng (tại kho nguồn)</div>
                <div role="columnheader" className="py-2.5 text-right">Tồn khả dụng</div>
                <div role="columnheader" className="py-2.5 text-center">SL dự kiến chuyển</div>
                <div role="columnheader" className="py-2.5" />
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lines.map((l) => (
                  <div key={l.key} role="row" style={{ gridTemplateColumns: '1.8fr 150px 150px 50px', minHeight: 52 }} className="grid items-center border-b border-slate-100 px-4 text-sm">
                    <div role="cell" className="min-w-0 truncate">
                      <span className="font-bold text-slate-900">{l.drugName}</span> <span className="text-xs font-medium text-slate-400">({l.drugCode})</span>
                      {l.isBatchManaged && (
                        <span className="ml-1 text-slate-500">
                          — Lô {l.batchNo} {l.expiryDate && <>· HSD {l.expiryDate.split('-').reverse().join('/')}</>}
                        </span>
                      )}
                      {!l.isBatchManaged && <span className="ml-1 text-slate-400">— (không quản lý lô)</span>}
                    </div>
                    <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{l.availableQuantity}</div>
                    <div role="cell" className="text-center">
                      <input
                        type="number"
                        min={1}
                        max={l.availableQuantity || undefined}
                        value={l.quantityShipped}
                        onChange={(e) => updateLine(l.key, { quantityShipped: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                      />
                    </div>
                    <div role="cell" className="text-center">
                      <button type="button" onClick={() => removeLine(l.key)} aria-label={`Xoá dòng ${l.drugName}`} className="text-slate-400 hover:text-rose-600">
                        <Trash size={16} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ minWidth: 960 }} className="scroll-hover h-full overflow-x-auto">
            <div role="row" style={{ gridTemplateColumns: '1.6fr 130px 150px 1.4fr' }} className="grid border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
              <div role="columnheader" className="py-2.5 text-left">Mặt hàng / Lô</div>
              <div role="columnheader" className="py-2.5 text-center">SL đã xuất</div>
              <div role="columnheader" className="py-2.5 text-center">{isReceiving ? 'SL thực nhận' : 'SL thực nhận'}</div>
              <div role="columnheader" className="py-2.5 text-left">{isReceiving ? 'Ghi chú chênh lệch' : 'Ghi chú chênh lệch'}</div>
            </div>
            {transferQuery.data!.lines.map((l) => {
              const input = receiveInputs[l.id] ?? { quantityReceived: String(l.quantityShipped), varianceNote: '' };
              const receivedNum = Number(input.quantityReceived || 0);
              const isShort = isReceiving && receivedNum < l.quantityShipped;
              return (
                <div key={l.id} role="row" style={{ gridTemplateColumns: '1.6fr 130px 150px 1.4fr', minHeight: 56 }} className={`grid items-center border-b border-slate-100 px-4 text-sm ${isShort ? 'bg-amber-50/50' : ''}`}>
                  <div role="cell" className="font-bold text-slate-900">
                    {l.drugName}
                    <span className="block text-xs font-medium text-slate-400">{l.isBatchManaged ? `Lô ${l.batchNo}${l.expiryDate ? ` · HSD ${l.expiryDate.split('-').reverse().join('/')}` : ''}` : '— (không quản lý lô)'}</span>
                  </div>
                  <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{l.quantityShipped}</div>
                  <div role="cell" className="text-center">
                    {isReceiving ? (
                      <input
                        type="number"
                        min={0}
                        max={l.quantityShipped}
                        value={input.quantityReceived}
                        onChange={(e) => setReceiveInputs((prev) => ({ ...prev, [l.id]: { ...input, quantityReceived: e.target.value } }))}
                        className={`w-24 rounded-md border px-1.5 py-1.5 text-center text-sm font-semibold ${isShort ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-300 text-slate-900'}`}
                      />
                    ) : (
                      <span className="tabular-nums">{l.quantityReceived ?? '—'}</span>
                    )}
                  </div>
                  <div role="cell">
                    {isReceiving ? (
                      isShort ? (
                        <div>
                          <input
                            type="text"
                            value={input.varianceNote}
                            onChange={(e) => setReceiveInputs((prev) => ({ ...prev, [l.id]: { ...input, varianceNote: e.target.value } }))}
                            placeholder="Bắt buộc nhập lý do..."
                            className="w-full rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-sm font-semibold text-amber-900"
                          />
                          <p className="mt-1 text-xs font-semibold text-amber-700">Thiếu {l.quantityShipped - receivedNum} so với đã xuất — bắt buộc ghi lý do</p>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-emerald-700">
                          <Check size={14} aria-hidden="true" />
                          <span className="text-xs font-semibold">Khớp — không cần ghi chú</span>
                        </span>
                      )
                    ) : (
                      <span className="text-slate-700">{l.varianceNote || '—'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ Footer hành động ============ */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
        {isDraftEditable && (
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" loading={saving} onClick={() => void handleSave(false)}>
              Lưu nháp
            </Button>
            <Button type="button" loading={saving} onClick={() => void handleSave(true)}>
              Duyệt (Xuất kho ngay)
            </Button>
          </div>
        )}
        {isReceiving && canApprove && (
          <Button type="button" className="ml-auto" loading={receiveMutation.isPending} onClick={() => void handleReceive()}>
            <Truck size={15} weight="bold" aria-hidden="true" />
            Xác nhận đã nhận hàng
          </Button>
        )}
      </div>
      {isReceiving && (
        <p className="flex-shrink-0 px-1 text-xs text-slate-500">
          Xác nhận là <strong>MỘT LẦN DUY NHẤT</strong> — không nhận nhiều đợt/một phần. Sau khi xác nhận: sinh phiếu Nhập kho tại kho đích đúng SL thực nhận. Phần chênh lệch chỉ ghi vào Nhật ký hoạt
          động để tra soát — kho nguồn không đảo ngược.
        </p>
      )}
      {isDraftEditable && (
        <p className="flex-shrink-0 px-1 text-xs text-slate-500">
          Bấm "Duyệt" sẽ trừ tồn kho NGUỒN ngay lập tức và chuyển phiếu sang "Đang vận chuyển" — chờ kho đích xác nhận nhận hàng.
        </p>
      )}

      {rejecting && transferQuery.data && (
        <StockTransferRejectDialog
          transferId={transferQuery.data.id}
          transferNo={transferQuery.data.transferNo}
          version={transferQuery.data.version}
          onDone={() => navigate('/inventory/transfers')}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  );
}
