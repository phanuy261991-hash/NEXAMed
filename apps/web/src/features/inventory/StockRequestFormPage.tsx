import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ListPlus, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import type { CreateStockRequestRequest, DrugSummary, StockRequestPriority } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RecordLoadError } from '../../shared/ui/RecordLoadError';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { makeDraftId } from '../../shared/make-draft-id';
import { showBranchInfo } from '../branch/branch-visibility';
import { useAuthStore } from '../auth/auth.store';
import { useDrugsQuery } from '../drug/drug.queries';
import { useStockBalancesQuery } from './inventory.queries';
import {
  useCreateStockRequestMutation,
  useStockRequestLowStockQuery,
  useStockRequestOptionsQuery,
  useStockRequestQuery,
  useSubmitStockRequestMutation,
  useUpdateStockRequestMutation,
} from './stock-request.queries';
import { requesterActionsFor } from './stock-request-meta';
import type { RestockPrefillLine } from './StockRequestRestockTab';

interface DraftLine {
  key: string;
  drugId: string;
  drugCode: string;
  drugName: string;
  unitCode: string;
  /** Tồn hiện tại của kho xin (chỉ tham khảo). */
  onHand: number;
  minStock: number | null;
  requestedQty: string;
  lineNote: string;
}

/**
 * Lập / sửa phiếu yêu cầu cấp hàng (docs/DECISIONS.md #298, mockup màn 3). Kho cấp tự điền theo cấp (không cho chọn). "Thêm các mặt hàng dưới mức tồn tối thiểu" lấy từ định mức có sẵn,
 * người dùng sửa số xin trước khi gửi. "Lưu nháp" giữ phiếu ở trạng thái Nháp, "Gửi yêu cầu" gửi luôn. Phiếu Đã gửi sửa tự do được tới khi kho cấp tiếp nhận.
 */
export function StockRequestFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isEdit = Boolean(id);
  const user = useAuthStore((s) => s.user);
  const multiBranch = showBranchInfo(user);

  const requestQuery = useStockRequestQuery(id ?? '', isEdit);
  const optionsQuery = useStockRequestOptionsQuery();
  const createMutation = useCreateStockRequestMutation();
  const updateMutation = useUpdateStockRequestMutation();
  const submitMutation = useSubmitStockRequestMutation();

  const [requestingWarehouseId, setRequestingWarehouseId] = useState('');
  const [priority, setPriority] = useState<StockRequestPriority>('NORMAL');
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);

  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Yêu cầu cấp hàng', to: '/inventory/requests' }, { label: isEdit ? 'Sửa yêu cầu' : 'Tạo yêu cầu' }]);

  const options = useMemo(() => optionsQuery.data?.options ?? [], [optionsQuery.data]);
  const selectedOption = options.find((o) => o.requestingWarehouseId === requestingWarehouseId) ?? null;

  // Chọn sẵn kho xin khi chỉ có một lựa chọn.
  useEffect(() => {
    if (!isEdit && requestingWarehouseId === '' && options.length === 1) setRequestingWarehouseId(options[0]!.requestingWarehouseId);
  }, [isEdit, options, requestingWarehouseId]);

  // Nạp phiếu đã có vào form — chỉ khi chuyển sang phiếu khác (cùng bài học `loadedForId` của phiếu điều chuyển).
  useEffect(() => {
    const r = requestQuery.data;
    if (!r || r.id === loadedForId) return;
    setRequestingWarehouseId(r.requestingWarehouseId);
    setPriority(r.priority);
    setNeededBy(r.neededBy ?? '');
    setNote(r.note ?? '');
    setLines(
      r.lines.map((l) => ({
        key: l.id,
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        unitCode: l.unitCode ?? '',
        onHand: l.requesterStockSnapshot ?? 0,
        minStock: null,
        requestedQty: String(l.requestedQty),
        lineNote: l.lineNote ?? '',
      })),
    );
    setLoadedForId(r.id);
  }, [requestQuery.data, loadedForId]);

  // "Xin chi nhánh chính" từ tab "Hàng cần bổ sung" (#298, mockup màn 4): điền sẵn kho xin và các mặt hàng đã chọn với số cần bổ sung; chỉ một lần lúc vào trang tạo mới.
  useEffect(() => {
    if (isEdit) return;
    const state = location.state as { restockLines?: RestockPrefillLine[]; requestingWarehouseId?: string | null } | null;
    if (!state?.restockLines?.length) return;
    if (state.requestingWarehouseId) setRequestingWarehouseId(state.requestingWarehouseId);
    setLines(
      state.restockLines.map((l) => ({
        key: makeDraftId(),
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        unitCode: l.unitCode ?? '',
        onHand: l.onHand,
        minStock: l.minStock,
        requestedQty: String(l.quantity),
        lineNote: '',
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedDrugQuery = useDebouncedValue(drugQuery, 300);
  const isSearching = drugQuery.trim() !== '';
  const drugSearch = useDrugsQuery({ q: debouncedDrugQuery.trim() || undefined });
  const existingDrugIds = useMemo(() => new Set(lines.map((l) => l.drugId)), [lines]);
  const searchResults = isSearching ? (drugSearch.data?.items ?? []).filter((d) => !existingDrugIds.has(d.id)) : [];

  // Tồn kho xin theo mặt hàng — chỉ tham khảo khi chọn hàng.
  const balancesQuery = useStockBalancesQuery({ warehouseId: requestingWarehouseId || undefined, belowMinOnly: false });
  const onHandByDrugId = useMemo(() => new Map((balancesQuery.data?.items ?? []).map((i) => [i.drugId, i.quantityOnHand])), [balancesQuery.data]);
  const lowStockQuery = useStockRequestLowStockQuery(requestingWarehouseId);
  const lowStockToAdd = (lowStockQuery.data?.items ?? []).filter((i) => !existingDrugIds.has(i.drugId));

  function addDrug(drug: DrugSummary) {
    if (existingDrugIds.has(drug.id)) return;
    setLines((prev) => [
      ...prev,
      {
        key: makeDraftId(),
        drugId: drug.id,
        drugCode: drug.code,
        drugName: drug.name,
        unitCode: drug.baseUnitCode ?? '',
        onHand: onHandByDrugId.get(drug.id) ?? 0,
        minStock: drug.minStockAlert,
        requestedQty: '',
        lineNote: '',
      },
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
        unitCode: i.unitCode ?? '',
        onHand: i.onHand,
        minStock: i.minStock,
        requestedQty: String(i.suggestedQty),
        lineNote: '',
      })),
    ]);
    setFormError(null);
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
      if (picked) addDrug(picked);
    }
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function buildPayload(): Omit<CreateStockRequestRequest, 'submit'> | null {
    if (!requestingWarehouseId) {
      setFormError('Phải chọn Kho xin.');
      return null;
    }
    if (lines.length === 0) {
      setFormError('Phải có ít nhất 1 mặt hàng.');
      return null;
    }
    for (const l of lines) {
      if (!l.requestedQty || Number(l.requestedQty) <= 0) {
        setFormError(`Dòng "${l.drugName}" thiếu số xin hợp lệ.`);
        return null;
      }
    }
    setFormError(null);
    return {
      requestingWarehouseId,
      priority,
      neededBy: neededBy || null,
      note: note.trim() || null,
      lines: lines.map((l) => ({ drugId: l.drugId, requestedQty: Number(l.requestedQty), lineNote: l.lineNote.trim() || null })),
    };
  }

  async function save(submit: boolean) {
    const payload = buildPayload();
    if (!payload) return;
    try {
      if (isEdit && id && requestQuery.data) {
        const updated = await updateMutation.mutateAsync({ id, body: { ...payload, version: requestQuery.data.version } });
        if (submit && updated.status === 'DRAFT') await submitMutation.mutateAsync({ id, body: { version: updated.version } });
        navigate(`/inventory/requests/${id}`);
      } else {
        const created = await createMutation.mutateAsync({ ...payload, submit });
        navigate(`/inventory/requests/${created.id}`);
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Lưu phiếu thất bại, vui lòng thử lại.');
    }
  }

  // Bấm Enter ở ô nhập chung (không phải ô tìm hàng) gửi yêu cầu — đúng chuẩn Enter-to-submit (`ui-guidelines.md` mục 4.4).
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void save(true);
  }

  if (isEdit && requestQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isEdit && requestQuery.isError) {
    return <RecordLoadError error={requestQuery.error} fallbackMessage="Không tải được phiếu." onRetry={() => void requestQuery.refetch()} fallbackTo="/inventory/requests" fallbackLabel="Về danh sách yêu cầu" />;
  }
  if (isEdit && requestQuery.data && !requesterActionsFor(requestQuery.data.status).edit) {
    return <ErrorBanner message="Phiếu đã được kho cấp tiếp nhận nên không sửa tự do được. Mở phiếu để thêm mặt hàng hoặc rút dòng." onRetry={() => navigate(`/inventory/requests/${id}`)} />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || submitMutation.isPending;
  const noSupplier = optionsQuery.isSuccess && options.length === 0;

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{isEdit ? 'Sửa yêu cầu cấp hàng' : 'Tạo yêu cầu cấp hàng'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between gap-2">
        <h2 className="truncate text-lg font-semibold text-slate-900">{isEdit && requestQuery.data ? requestQuery.data.requestNo : 'Tạo yêu cầu cấp hàng'}</h2>
        <Button type="button" variant="secondary" onClick={() => navigate('/inventory/requests')}>
          ← Quay lại danh sách
        </Button>
      </div>

      {optionsQuery.isError && <ErrorBanner message={optionsQuery.error instanceof ApiError ? optionsQuery.error.message : 'Không tải được danh sách kho.'} onRetry={() => void optionsQuery.refetch()} />}
      {noSupplier && (
        <ErrorBanner message="Kho của bạn không có kho cấp trên để xin hàng (kho chính của chi nhánh chính). Hãy nhập hàng từ nhà cung cấp." />
      )}

      <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
        <div>
          <label htmlFor="request-warehouse" className="mb-1 block text-sm font-semibold text-slate-800">
            Kho xin <span className="text-rose-500">*</span>
          </label>
          <Combobox
            id="request-warehouse"
            value={requestingWarehouseId}
            disabled={lines.length > 0 && isEdit}
            onChange={setRequestingWarehouseId}
            placeholder="— Chọn kho —"
            options={options.map((o) => ({ value: o.requestingWarehouseId, label: o.requestingWarehouseName }))}
          />
        </div>
        <div>
          <p className="mb-1 block text-sm font-semibold text-slate-800">Kho cấp (tự động theo cấp)</p>
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
            {selectedOption ? (multiBranch ? `${selectedOption.supplyingWarehouseName} — ${selectedOption.supplyingBranchName}` : selectedOption.supplyingWarehouseName) : '—'}
          </p>
        </div>
        <div>
          <p className="mb-1 block text-sm font-semibold text-slate-800">Mức khẩn</p>
          <SegmentedToggle
            ariaLabel="Mức khẩn"
            value={priority}
            onChange={setPriority}
            items={[
              { id: 'NORMAL', label: 'Thường' },
              { id: 'URGENT', label: 'Khẩn' },
            ]}
          />
        </div>
        <div>
          <label htmlFor="request-needed-by" className="mb-1 block text-sm font-semibold text-slate-800">
            Ngày cần hàng
          </label>
          <DateInput id="request-needed-by" value={neededBy} onChange={setNeededBy} />
        </div>
        <div className="sm:col-span-4">
          <label htmlFor="request-note" className="mb-1 block text-sm font-semibold text-slate-800">
            Lý do / ghi chú
          </label>
          <input
            id="request-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: cuối tuần nhiều ca thủ thuật"
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900"
          />
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-end gap-2.5 rounded-lg border-2 border-blue-200 bg-blue-50 p-3 shadow-sm">
        <div className="relative min-w-60 flex-1">
          <label htmlFor="request-drug-search" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Thêm mặt hàng cần xin
          </label>
          <div className="relative">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-500" aria-hidden="true" />
            <input
              id="request-drug-search"
              type="text"
              value={drugQuery}
              disabled={!requestingWarehouseId}
              onChange={(e) => {
                setDrugQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
                onSearchKeyDown(e);
              }}
              placeholder="Gõ tên/mã/mã vạch mặt hàng — Enter/Tab để thêm nhanh..."
              className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
            />
          </div>
          {isSearching && (
            <div className="scroll-hover absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {searchResults.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Không tìm thấy, hoặc đã có sẵn trong phiếu.</p>}
              {searchResults.map((d, idx) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => addDrug(d)}
                  className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 ${idx === highlightedIndex ? 'bg-brand-teal-tint' : 'hover:bg-slate-50'}`}
                >
                  <span className="font-medium text-slate-900">{d.name}</span> <span className="text-xs font-semibold text-slate-400">({d.code})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button type="button" variant="add" disabled={lowStockToAdd.length === 0} onClick={addLowStock}>
          <ListPlus size={16} weight="bold" aria-hidden="true" />
          Thêm các mặt hàng dưới mức tồn tối thiểu ({lowStockToAdd.length})
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 ? (
          <div className="scroll-hover h-full overflow-y-auto">
            <EmptyState icon={MagnifyingGlass} title="Chưa có mặt hàng nào" description="Gõ tên thuốc/vật tư ở ô trên, hoặc thêm các mặt hàng dưới mức tồn tối thiểu." />
          </div>
        ) : (
          <div role="table" aria-label="Mặt hàng cần xin" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 860 }}>
              <div role="row" style={{ gridTemplateColumns: 'minmax(220px,1.6fr) 70px 110px 110px 120px minmax(160px,1fr) 44px' }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
                <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                <div role="columnheader" className="py-2.5 text-center">Tồn hiện tại</div>
                <div role="columnheader" className="py-2.5 text-center">Mức tối thiểu</div>
                <div role="columnheader" className="py-2.5 text-center">Số xin</div>
                <div role="columnheader" className="py-2.5 text-left">Ghi chú dòng</div>
                <div role="columnheader" className="py-2.5" />
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lines.map((l) => (
                  <div key={l.key} role="row" style={{ gridTemplateColumns: 'minmax(220px,1.6fr) 70px 110px 110px 120px minmax(160px,1fr) 44px', minHeight: 52 }} className="grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm">
                    <div role="cell" className="min-w-0 truncate">
                      <span className="font-semibold text-slate-900">{l.drugName}</span> <span className="text-xs font-medium text-slate-400">({l.drugCode})</span>
                    </div>
                    <div role="cell" className="text-center font-medium text-slate-600">{l.unitCode}</div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{l.onHand}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-600">{l.minStock ?? '—'}</div>
                    <div role="cell" className="text-center">
                      <input
                        type="number"
                        min={1}
                        value={l.requestedQty}
                        aria-label={`Số xin ${l.drugName}`}
                        onChange={(e) => updateLine(l.key, { requestedQty: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                    <div role="cell" className="pr-2">
                      <input
                        type="text"
                        value={l.lineNote}
                        aria-label={`Ghi chú ${l.drugName}`}
                        onChange={(e) => updateLine(l.key, { lineNote: e.target.value })}
                        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                      />
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
        {formError ? <p role="alert" className="text-sm font-medium text-rose-600">{formError}</p> : <p className="text-xs text-slate-500">{lines.length} mặt hàng</p>}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" loading={saving} disabled={noSupplier} onClick={() => void save(false)}>
            Lưu nháp
          </Button>
          <Button type="submit" loading={saving} disabled={noSupplier}>
            Gửi yêu cầu
          </Button>
        </div>
      </div>
    </form>
  );
}
