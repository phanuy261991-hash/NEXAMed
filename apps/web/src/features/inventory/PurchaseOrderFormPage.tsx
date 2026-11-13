import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ListPlus, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import type { CreatePurchaseOrderRequest, DrugSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { RecordLoadError } from '../../shared/ui/RecordLoadError';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { makeDraftId } from '../../shared/make-draft-id';
import { useHasPermission } from '../auth/usePermission';
import { BaseQuantityHint } from '../drug/BaseQuantityHint';
import { useDrugsQuery } from '../drug/drug.queries';
import { QuickAddItemDialog } from '../drug/QuickAddItemDialog';
import { QuickAddItemRow } from '../drug/QuickAddItemRow';
import { isNoItemMatch } from '../drug/quick-add-search';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import {
  useApprovePurchaseOrderMutation,
  useCreatePurchaseOrderMutation,
  usePurchaseOrderOptionsQuery,
  usePurchaseOrderQuery,
  useSubmitPurchaseOrderMutation,
  useUpdatePurchaseOrderMutation,
} from './purchase-order.queries';
import { orderActionsFor } from './purchase-order-meta';
import { useStockRequestLowStockQuery, useStockRequestQuery } from './stock-request.queries';
import type { RestockPrefillLine } from './StockRequestRestockTab';

interface DraftLine {
  key: string;
  drugId: string;
  drugCode: string;
  drugName: string;
  unitOptions: string[];
  unitCode: string;
  quantity: string;
  expectedUnitCost: number | undefined;
  lineNote: string;
  /** Nhãn "Nguồn" (yêu cầu cấp hàng đang chờ hàng) và id dòng yêu cầu để máy chủ gắn liên kết. */
  sourceLabel: string | null;
  sourceRequestLineId: string | null;
}

function unitOptionsFor(drug: DrugSummary): string[] {
  return [...new Set([drug.baseUnitCode, ...drug.units.map((u) => u.unitCode)].filter((u): u is string => Boolean(u)))];
}

/**
 * Lập / sửa Đơn đặt hàng NCC (docs/DECISIONS.md #298 giai đoạn 2, mockup màn 8). Đơn thuộc chi nhánh của KHO NHẬN. Đơn giá dự kiến là tuỳ chọn (chỉ để người duyệt cân đối ngân sách).
 * Nút chính theo cấu hình: đơn cần chi nhánh chính duyệt → "Gửi chi nhánh chính duyệt"; người có quyền duyệt → "Lưu và duyệt"; còn lại → "Gửi duyệt".
 * `?fromRequest=<id>` mồi sẵn các dòng đang chờ hàng về của một phiếu yêu cầu cấp hàng (kho cấp là kho nhận của đơn).
 */
export function PurchaseOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const fromRequestId = searchParams.get('fromRequest') ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const isEdit = Boolean(id);
  const canApprove = useHasPermission('purchase_order', 'approve');
  const canRequestLow = useHasPermission('stock_request', 'create');
  const canCreateDrug = useHasPermission('drug', 'create');

  const orderQuery = usePurchaseOrderQuery(id ?? '', isEdit);
  const optionsQuery = usePurchaseOrderOptionsQuery();
  const suppliersQuery = useSuppliersQuery();
  const warehousesQuery = useWarehousesQuery();
  const unitNameByCode = useUnitNameByCode();
  const createMutation = useCreatePurchaseOrderMutation();
  const updateMutation = useUpdatePurchaseOrderMutation();
  const submitMutation = useSubmitPurchaseOrderMutation();
  const approveMutation = useApprovePurchaseOrderMutation();
  const sourceRequestQuery = useStockRequestQuery(fromRequestId, !isEdit && fromRequestId !== '');

  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const [seededFromRequest, setSeededFromRequest] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Đơn đặt hàng NCC', to: '/inventory/purchase-orders' }, { label: isEdit ? 'Sửa đơn' : 'Lập đơn' }]);

  const warehouses = useMemo(() => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive), [warehousesQuery.data]);
  const suppliers = useMemo(() => (suppliersQuery.data?.items ?? []).filter((s) => s.isActive), [suppliersQuery.data]);

  // Chọn sẵn kho nhận khi chỉ có một kho.
  useEffect(() => {
    if (!isEdit && warehouseId === '' && fromRequestId === '' && warehouses.length === 1) setWarehouseId(warehouses[0]!.id);
  }, [isEdit, warehouses, warehouseId, fromRequestId]);

  // Nạp đơn đã có vào form — chỉ khi chuyển sang đơn khác (cùng bài học `loadedForId` của phiếu yêu cầu).
  useEffect(() => {
    const o = orderQuery.data;
    if (!o || o.id === loadedForId) return;
    setSupplierId(o.supplierId);
    setWarehouseId(o.warehouseId);
    setExpectedDate(o.expectedDate ?? '');
    setNote(o.note ?? '');
    setLines(
      o.lines.map((l) => ({
        key: l.id,
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        unitOptions: [l.unitCode],
        unitCode: l.unitCode,
        quantity: String(l.quantity),
        expectedUnitCost: l.expectedUnitCost ?? undefined,
        lineNote: l.lineNote ?? '',
        sourceLabel: l.sourceRequests.length > 0 ? `Chờ hàng của ${l.sourceRequests.map((r) => r.requestNo).join(', ')}` : null,
        sourceRequestLineId: null,
      })),
    );
    setLoadedForId(o.id);
  }, [orderQuery.data, loadedForId]);

  // Mồi các dòng đang chờ hàng về của phiếu yêu cầu (chỉ một lần).
  useEffect(() => {
    const r = sourceRequestQuery.data;
    if (!r || seededFromRequest) return;
    const waiting = r.lines.filter((l) => l.fulfilStatus === 'WAITING_STOCK' && l.remainingQty > 0);
    setWarehouseId(r.supplyingWarehouseId);
    setLines(
      waiting.map((l) => ({
        key: makeDraftId(),
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        unitOptions: l.unitCode ? [l.unitCode] : [],
        unitCode: l.unitCode ?? '',
        quantity: String(l.remainingQty),
        expectedUnitCost: undefined,
        lineNote: '',
        sourceLabel: `Chờ hàng của ${r.requestNo}`,
        sourceRequestLineId: l.id,
      })),
    );
    setSeededFromRequest(true);
  }, [sourceRequestQuery.data, seededFromRequest]);

  // "Đặt NCC" từ tab "Hàng cần bổ sung" (#298, mockup màn 4): điền sẵn kho nhận và các mặt hàng đã chọn với số cần bổ sung; chỉ một lần lúc vào trang tạo mới.
  useEffect(() => {
    if (isEdit) return;
    const state = location.state as { restockLines?: RestockPrefillLine[]; warehouseId?: string | null } | null;
    if (!state?.restockLines?.length) return;
    if (state.warehouseId) setWarehouseId(state.warehouseId);
    setLines(
      state.restockLines.map((l) => ({
        key: makeDraftId(),
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        unitOptions: l.unitCode ? [l.unitCode] : [],
        unitCode: l.unitCode ?? '',
        quantity: String(l.quantity),
        expectedUnitCost: undefined,
        lineNote: '',
        sourceLabel: null,
        sourceRequestLineId: null,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedDrugQuery = useDebouncedValue(drugQuery, 300);
  const isSearching = drugQuery.trim() !== '';
  const drugSearch = useDrugsQuery({ q: debouncedDrugQuery.trim() || undefined });
  const existingDrugIds = useMemo(() => new Set(lines.map((l) => l.drugId)), [lines]);
  const searchResults = isSearching ? (drugSearch.data?.items ?? []).filter((d) => !existingDrugIds.has(d.id)) : [];
  // Chỉ coi là "không có mặt hàng nào" khi kết quả của ĐÚNG chuỗi đang gõ đã về và rỗng (không phải đang chờ, không phải chỉ vì mặt hàng đã có sẵn trong đơn).
  const noItemMatches = isNoItemMatch({ query: drugQuery, debouncedQuery: debouncedDrugQuery, isSuccess: drugSearch.isSuccess, isFetching: drugSearch.isFetching, rawResultCount: drugSearch.data?.items.length ?? 0 });

  const lowStockQuery = useStockRequestLowStockQuery(canRequestLow ? warehouseId : '');
  const lowStockToAdd = (lowStockQuery.data?.items ?? []).filter((i) => !existingDrugIds.has(i.drugId));

  function addDrug(drug: DrugSummary) {
    if (existingDrugIds.has(drug.id)) return;
    const options = unitOptionsFor(drug);
    setLines((prev) => [
      ...prev,
      { key: makeDraftId(), drugId: drug.id, drugCode: drug.code, drugName: drug.name, unitOptions: options, unitCode: drug.baseUnitCode ?? options[0] ?? '', quantity: '', expectedUnitCost: undefined, lineNote: '', sourceLabel: null, sourceRequestLineId: null },
    ]);
    setDrugQuery('');
    setHighlightedIndex(0);
    setFormError(null);
  }

  function addLowStock() {
    setLines((prev) => [
      ...prev,
      ...lowStockToAdd.map((i) => ({
        key: makeDraftId(),
        drugId: i.drugId,
        drugCode: i.drugCode,
        drugName: i.drugName,
        unitOptions: i.unitCode ? [i.unitCode] : [],
        unitCode: i.unitCode ?? '',
        quantity: String(i.suggestedQty),
        expectedUnitCost: undefined,
        lineNote: '',
        sourceLabel: null,
        sourceRequestLineId: null,
      })),
    ]);
    setFormError(null);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && noItemMatches && canCreateDrug) {
      e.preventDefault();
      setQuickAddOpen(true);
      return;
    }
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
      if (picked) addDrug(picked);
    }
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const total = lines.reduce((sum, l) => (l.expectedUnitCost != null && Number(l.quantity) > 0 ? sum + l.expectedUnitCost * Number(l.quantity) : sum), 0);

  function buildPayload(): CreatePurchaseOrderRequest | null {
    if (!supplierId) {
      setFormError('Phải chọn Nhà cung cấp.');
      return null;
    }
    if (!warehouseId) {
      setFormError('Phải chọn Kho nhận.');
      return null;
    }
    if (lines.length === 0) {
      setFormError('Phải có ít nhất 1 mặt hàng.');
      return null;
    }
    for (const l of lines) {
      if (!l.quantity || Number(l.quantity) <= 0) {
        setFormError(`Dòng "${l.drugName}" thiếu số đặt hợp lệ.`);
        return null;
      }
      if (!l.unitCode) {
        setFormError(`Dòng "${l.drugName}" chưa chọn đơn vị.`);
        return null;
      }
    }
    setFormError(null);
    return {
      supplierId,
      warehouseId,
      expectedDate: expectedDate || null,
      note: note.trim() || null,
      lines: lines.map((l) => ({
        drugId: l.drugId,
        unitCode: l.unitCode,
        quantity: Number(l.quantity),
        expectedUnitCost: l.expectedUnitCost ?? null,
        lineNote: l.lineNote.trim() || null,
        sourceRequestLineId: l.sourceRequestLineId,
      })),
    };
  }

  const requiresMain = optionsQuery.data?.requiresMainApproval === true;
  const selfApprove = !requiresMain && canApprove;
  const primaryLabel = requiresMain ? 'Gửi chi nhánh chính duyệt' : selfApprove ? 'Lưu và duyệt' : 'Gửi duyệt';

  /** `mode`: 'draft' = chỉ lưu Nháp; 'primary' = lưu rồi gửi duyệt / duyệt theo cấu hình. */
  async function save(mode: 'draft' | 'primary') {
    const payload = buildPayload();
    if (!payload) return;
    try {
      let saved;
      if (isEdit && id && orderQuery.data) {
        saved = await updateMutation.mutateAsync({ id, body: { ...payload, version: orderQuery.data.version } });
      } else {
        saved = await createMutation.mutateAsync(payload);
      }
      if (mode === 'primary') {
        if (selfApprove) await approveMutation.mutateAsync({ id: saved.id, body: { version: saved.version } });
        else await submitMutation.mutateAsync({ id: saved.id, body: { version: saved.version } });
      }
      navigate(`/inventory/purchase-orders/${saved.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Lưu đơn thất bại, vui lòng thử lại.');
    }
  }

  // Enter ở ô nhập chung (không phải ô tìm hàng) thực hiện nút chính — chuẩn Enter-to-submit (`ui-guidelines.md` mục 4.4).
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void save('primary');
  }

  if (isEdit && orderQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isEdit && orderQuery.isError) {
    return <RecordLoadError error={orderQuery.error} fallbackMessage="Không tải được đơn." onRetry={() => void orderQuery.refetch()} fallbackTo="/inventory/purchase-orders" fallbackLabel="Về danh sách đơn" />;
  }
  if (isEdit && orderQuery.data && !orderActionsFor(orderQuery.data.status).edit) {
    return <ErrorBanner message="Đơn đã gửi duyệt hoặc đã đặt nhà cung cấp nên không sửa được. Mở đơn để xem hoặc thao tác tiếp." onRetry={() => navigate(`/inventory/purchase-orders/${id}`)} />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || submitMutation.isPending || approveMutation.isPending;
  const cannotOrder = optionsQuery.isSuccess && !optionsQuery.data.canOrderHere;

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{isEdit ? 'Sửa đơn đặt hàng NCC' : 'Lập đơn đặt hàng NCC'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between gap-2">
        <h2 className="truncate text-lg font-semibold text-slate-900">{isEdit && orderQuery.data ? orderQuery.data.orderNo : 'Lập đơn đặt hàng NCC'}</h2>
        <Button type="button" variant="secondary" onClick={() => navigate('/inventory/purchase-orders')}>
          ← Quay lại danh sách
        </Button>
      </div>

      {optionsQuery.isError && <ErrorBanner message={optionsQuery.error instanceof ApiError ? optionsQuery.error.message : 'Không tải được cấu hình đặt hàng.'} onRetry={() => void optionsQuery.refetch()} />}
      {cannotOrder && <ErrorBanner message="Phòng khám không cho chi nhánh này đặt hàng nhà cung cấp riêng. Hãy gửi yêu cầu cấp hàng lên chi nhánh chính." />}
      {requiresMain && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Đơn của chi nhánh này cần <strong>chi nhánh chính duyệt</strong> trước khi gửi nhà cung cấp.
        </div>
      )}
      {fromRequestId !== '' && sourceRequestQuery.isSuccess && seededFromRequest && lines.length === 0 && (
        <ErrorBanner message="Phiếu yêu cầu này không có dòng nào đang chờ hàng về. Hãy chọn Chờ hàng về ở bước cấp hàng trước, hoặc thêm mặt hàng tay." />
      )}
      {fromRequestId !== '' && sourceRequestQuery.isError && (
        <ErrorBanner message="Không tải được phiếu yêu cầu cấp hàng để điền sẵn. Bạn vẫn có thể nhập tay." onRetry={() => void sourceRequestQuery.refetch()} />
      )}

      <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
        <div>
          <label htmlFor="po-supplier" className="mb-1 block text-sm font-semibold text-slate-800">
            Nhà cung cấp <span className="text-rose-500">*</span>
          </label>
          <Combobox id="po-supplier" value={supplierId} onChange={setSupplierId} placeholder="— Chọn nhà cung cấp —" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        </div>
        <div>
          <label htmlFor="po-warehouse" className="mb-1 block text-sm font-semibold text-slate-800">
            Kho nhận <span className="text-rose-500">*</span>
          </label>
          <Combobox
            id="po-warehouse"
            value={warehouseId}
            disabled={isEdit || fromRequestId !== ''}
            onChange={setWarehouseId}
            placeholder="— Chọn kho —"
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </div>
        <div>
          <label htmlFor="po-expected" className="mb-1 block text-sm font-semibold text-slate-800">
            Ngày giao dự kiến
          </label>
          <DateInput id="po-expected" value={expectedDate} onChange={setExpectedDate} />
        </div>
        <div>
          <label htmlFor="po-note" className="mb-1 block text-sm font-semibold text-slate-800">
            Điều khoản / ghi chú
          </label>
          <input id="po-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: giao tại kho, thanh toán 30 ngày" className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900" />
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-end gap-2.5 rounded-lg border-2 border-blue-200 bg-blue-50 p-3 shadow-sm">
        <div className="relative min-w-60 flex-1">
          <label htmlFor="po-drug-search" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Thêm mặt hàng cần đặt
          </label>
          <div className="relative">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-500" aria-hidden="true" />
            <input
              id="po-drug-search"
              type="text"
              value={drugQuery}
              onChange={(e) => {
                setDrugQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
                onSearchKeyDown(e);
              }}
              placeholder="Gõ tên/mã/mã vạch mặt hàng — Enter/Tab để thêm nhanh..."
              className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {isSearching && (
            <div className="scroll-hover absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {searchResults.length === 0 && noItemMatches && <QuickAddItemRow query={drugQuery} canCreate={canCreateDrug} onOpen={() => setQuickAddOpen(true)} />}
              {searchResults.length === 0 && !noItemMatches && <p className="px-3 py-2 text-xs text-slate-400">{drugSearch.isError ? 'Không tìm được mặt hàng, vui lòng thử lại.' : drugSearch.isFetching || debouncedDrugQuery.trim() !== drugQuery.trim() ? 'Đang tìm...' : 'Mặt hàng này đã có sẵn trong đơn.'}</p>}
              {searchResults.map((d, idx) => (
                <button key={d.id} type="button" onClick={() => addDrug(d)} className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 ${idx === highlightedIndex ? 'bg-brand-teal-tint' : 'hover:bg-slate-50'}`}>
                  <span className="font-medium text-slate-900">{d.name}</span> <span className="text-xs font-semibold text-slate-400">({d.code})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {canRequestLow && (
          <Button type="button" variant="add" disabled={lowStockToAdd.length === 0} onClick={addLowStock}>
            <ListPlus size={16} weight="bold" aria-hidden="true" />
            Lấy từ hàng cần bổ sung ({lowStockToAdd.length})
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 ? (
          <div className="scroll-hover h-full overflow-y-auto">
            <EmptyState icon={MagnifyingGlass} title="Chưa có mặt hàng nào" description="Gõ tên thuốc/vật tư ở ô trên để thêm vào đơn." />
          </div>
        ) : (
          <div role="table" aria-label="Mặt hàng đặt" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 980 }}>
              <div role="row" style={{ gridTemplateColumns: 'minmax(220px,1.5fr) 110px 100px 140px 120px minmax(170px,1fr) 44px' }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
                <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                <div role="columnheader" className="py-2.5 text-center">Số đặt</div>
                <div role="columnheader" className="py-2.5 text-center">Đơn giá dự kiến</div>
                <div role="columnheader" className="py-2.5 text-center">Thành tiền</div>
                <div role="columnheader" className="py-2.5 text-left">Nguồn</div>
                <div role="columnheader" className="py-2.5" />
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lines.map((l) => (
                  <div key={l.key} role="row" style={{ gridTemplateColumns: 'minmax(220px,1.5fr) 110px 100px 140px 120px minmax(170px,1fr) 44px', minHeight: 52 }} className="grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm">
                    <div role="cell" className="min-w-0 truncate">
                      <span className="font-semibold text-slate-900">{l.drugName}</span> <span className="text-xs font-medium text-slate-400">({l.drugCode})</span>
                    </div>
                    <div role="cell" className="px-1">
                      <Combobox id={`po-unit-${l.key}`} value={l.unitCode} disabled={isEdit && l.unitOptions.length <= 1} onChange={(v) => updateLine(l.key, { unitCode: v })} options={l.unitOptions.map((u) => ({ value: u, label: unitLabel(unitNameByCode, u) }))} />
                    </div>
                    <div role="cell" className="text-center">
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        aria-label={`Số đặt ${l.drugName}`}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <BaseQuantityHint drugId={l.drugId} unitCode={l.unitCode} quantity={l.quantity} />
                    </div>
                    <div role="cell" className="px-1">
                      <MoneyInput id={`po-cost-${l.key}`} value={l.expectedUnitCost} onChange={(v) => updateLine(l.key, { expectedUnitCost: v })} className="w-full rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900" />
                    </div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">
                      {l.expectedUnitCost != null && Number(l.quantity) > 0 ? formatVnd(l.expectedUnitCost * Number(l.quantity)) : '—'}
                    </div>
                    <div role="cell" className="min-w-0 text-left">
                      {l.sourceLabel ? <StatusBadge tone="info">{l.sourceLabel}</StatusBadge> : <span className="font-medium text-slate-400">Nhập tay</span>}
                    </div>
                    <div role="cell" className="text-center">
                      <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} aria-label={`Xoá dòng ${l.drugName}`} className="text-slate-400 hover:text-rose-600">
                        <Trash size={16} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          {formError ? <p role="alert" className="text-sm font-medium text-rose-600">{formError}</p> : <p className="text-xs text-slate-500">{lines.length} mặt hàng</p>}
          <p className="text-sm font-semibold text-slate-900">Tổng dự kiến: {formatVnd(total)}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" loading={saving} disabled={cannotOrder} onClick={() => void save('draft')}>
            Lưu nháp
          </Button>
          <Button type="submit" loading={saving} disabled={cannotOrder}>
            {primaryLabel}
          </Button>
        </div>
      </div>

      {quickAddOpen && (
        <QuickAddItemDialog
          initialName={drugQuery.trim()}
          submitLabel="Thêm vào đơn"
          onClose={() => setQuickAddOpen(false)}
          onCreated={(drug) => {
            addDrug(drug);
            setQuickAddOpen(false);
          }}
        />
      )}
    </form>
  );
}
