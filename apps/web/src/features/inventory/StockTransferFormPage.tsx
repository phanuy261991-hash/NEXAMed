import { useEffect, useMemo, useState } from 'react';
import { makeDraftId as makeKey } from '../../shared/make-draft-id';
import { useNavigate, useParams } from 'react-router-dom';
import { MagnifyingGlass, Trash } from '@phosphor-icons/react';
import type { CreateStockTransferRequest, DrugSummary, StockTransferDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { PrintButton } from '../../shared/print/PrintButton';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { RecordLoadError } from '../../shared/ui/RecordLoadError';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAuthStore } from '../auth/auth.store';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
import { showBranchInfo } from '../branch/branch-visibility';
import { useDrugsQuery } from '../drug/drug.queries';
import { useWarehousesQuery, useWarehouseTransferDestinationsQuery } from '../drug/warehouse.queries';
import { getDrugBatchBalances } from './inventory.api';
import { useCreateStockTransferMutation, useShipStockTransferMutation, useStockBalancesQuery, useStockTransferQuery, useUpdateStockTransferMutation } from './inventory.queries';
import { StockTransferConfirmReturnPanel } from './StockTransferConfirmReturnPanel';
import { StockTransferPrintView } from './StockTransferPrintView';
import { StockTransferReceivePanel } from './StockTransferReceivePanel';
import { StockTransferRejectDialog } from './StockTransferRejectDialog';
import { StockTransferResolvePanel } from './StockTransferResolvePanel';
import { nextTransferAction, REJECT_RECEIPT_REASON_LABEL, TRANSFER_STATUS_META, transferSides, VARIANCE_REASON_LABEL, VARIANCE_RESOLUTION_LABEL } from './stock-transfer-meta';

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

function todayVn(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function formatDateTimeVn(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "Chi nhánh / kho" khi công ty nhiều chi nhánh; chỉ tên kho khi 1 chi nhánh (giao diện không đổi). */
function placeLabel(multiBranch: boolean, branchName: string, warehouseName: string): string {
  return multiBranch ? `${branchName} / ${warehouseName}` : warehouseName;
}

/**
 * Trang chi tiết phiếu điều chuyển kho (Kho Thuốc GĐ4 #170 + Đợt 2 chi nhánh #233, mockup màn 4/4b). TRANG RIÊNG (không modal), dùng chung 1 component, chọn chế độ
 * theo TRẠNG THÁI phiếu và VAI TRÒ của chi nhánh đang làm việc (gửi/nhận):
 * - `DRAFT`: form soạn đầy đủ, search-and-pick mặt hàng theo lô tại kho NGUỒN (kho đích có thể thuộc chi nhánh khác).
 * - Bên NHẬN, `IN_TRANSIT`: màn "Kiểm nhận hàng" (`StockTransferReceivePanel`).
 * - Bên GỬI, `VARIANCE_PENDING`: "Xử lý chênh lệch"; `RETURNING`: "Xác nhận đã nhận lại hàng".
 * - Còn lại: chỉ đọc (kèm lý do chênh lệch / cách xử lý / lý do từ chối nhận).
 * Chi nhánh nhận KHÔNG thấy giá vốn (máy chủ trả `unitCost = null`).
 */
export function StockTransferFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const canApprove = useHasPermission('stock_transfer', 'approve');
  const user = useAuthStore((s) => s.user);
  const currentBranchId = user?.currentBranchId ?? null;
  const multiBranch = showBranchInfo(user);

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

  const transfer: StockTransferDetail | undefined = transferQuery.data;
  const status = transfer?.status;
  const isDraftEditable = !isEdit || status === 'DRAFT';
  const action = transfer && canApprove ? nextTransferAction(transfer, currentBranchId) : null;
  const isViewOnly = isEdit && !isDraftEditable && action === null;
  const sides = transfer ? transferSides(transfer, currentBranchId) : null;
  // Kho đích có thể ở chi nhánh khác: danh sách riêng (không lọc chi nhánh) — chỉ cần khi đang soạn phiếu.
  const destinationsQuery = useWarehouseTransferDestinationsQuery(isDraftEditable);

  // In phiếu — dùng CHUNG 1 bố cục cho cả hai bên (đầu phiếu theo chi nhánh GỬI) từ lúc Duyệt xuất; Nháp/Từ chối không in (chưa có hàng di chuyển).
  const printable = status !== undefined && status !== 'DRAFT' && status !== 'REJECTED';
  const [printing, setPrinting] = useState(false);
  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

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
  const [loadedForId, setLoadedForId] = useState<string | null>(null);

  const modeLabel =
    action === 'receive' ? 'Kiểm nhận hàng' : action === 'resolve' ? 'Xử lý chênh lệch' : action === 'confirm-return' ? 'Nhận lại hàng' : isViewOnly ? 'Chi tiết' : isEdit ? 'Sửa Nháp' : 'Tạo phiếu';
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Điều chuyển kho', to: '/inventory/transfers' }, { label: modeLabel }]);

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
    return <RecordLoadError error={transferQuery.error} fallbackMessage="Không tải được phiếu." onRetry={() => void transferQuery.refetch()} fallbackTo="/inventory/transfers" fallbackLabel="Về danh sách điều chuyển" />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || shipMutation.isPending;
  const sourceOptions = (warehousesQuery.data?.items ?? []).filter((w) => !isDepartmentScoped || w.departmentId === actorDepartmentId);
  const destinationOptions = (destinationsQuery.data?.items ?? [])
    .filter((w) => w.id !== fromWarehouseId)
    .map((w) => ({ value: w.id, label: multiBranch ? `${w.name} — ${w.branchName}` : w.name }));
  const backToList = () => navigate('/inventory/transfers');
  const showCost = sides?.isSender === true && transfer?.lines.some((l) => l.unitCost !== null);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{`${modeLabel} — phiếu điều chuyển kho`}</h1>

      <div className="flex flex-shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="truncate text-lg font-bold text-slate-900">{isEdit && transfer ? transfer.transferNo : 'Tạo phiếu điều chuyển kho'}</h2>
          {transfer && <StatusBadge tone={TRANSFER_STATUS_META[transfer.status].tone}>{TRANSFER_STATUS_META[transfer.status].label}</StatusBadge>}
        </div>
        <div className="flex flex-shrink-0 gap-2">
          {printable && (
            <PrintButton documentType="STOCK_TRANSFER" onPrint={handlePrint}>
              In phiếu
            </PrintButton>
          )}
          {isDraftEditable && isEdit && canApprove && (
            <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
              Từ chối
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={backToList}>
            ← Quay lại danh sách
          </Button>
        </div>
      </div>

      {/* ============ Header — chọn kho/ngày/ghi chú (editable khi DRAFT) hoặc chỉ đọc ============ */}
      {isDraftEditable ? (
        <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
          <div>
            <label htmlFor="transfer-from-warehouse" className="mb-1 block text-sm font-semibold text-slate-800">
              Kho nguồn <span className="text-rose-500">*</span>
            </label>
            <Combobox
              id="transfer-from-warehouse"
              value={fromWarehouseId}
              disabled={lines.length > 0}
              onChange={setFromWarehouseId}
              placeholder="— Chọn kho —"
              options={sourceOptions.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label htmlFor="transfer-to-warehouse" className="mb-1 block text-sm font-semibold text-slate-800">
              Kho đích <span className="text-rose-500">*</span>
            </label>
            <Combobox id="transfer-to-warehouse" value={toWarehouseId} onChange={setToWarehouseId} placeholder="— Chọn kho —" options={destinationOptions} />
            <p className="mt-1 text-xs text-slate-400">{multiBranch ? 'Gồm cả kho của chi nhánh khác; tự loại bỏ kho nguồn đã chọn.' : 'Danh sách tự loại bỏ kho nguồn đã chọn.'}</p>
          </div>
          <div>
            <label htmlFor="transfer-occurred-at" className="mb-1 block text-sm font-semibold text-slate-800">
              Ngày chuyển <span className="text-rose-500">*</span>
            </label>
            <DateInput id="transfer-occurred-at" value={occurredAt} onChange={setOccurredAt} required />
          </div>
          <div>
            <label htmlFor="transfer-note" className="mb-1 block text-sm font-semibold text-slate-800">
              Ghi chú
            </label>
            <input
              id="transfer-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Chuyển bổ sung..."
              className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900"
            />
          </div>
        </div>
      ) : (
        transfer && (
          <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">Từ</p>
              <p className="break-words text-base font-semibold text-slate-900">{placeLabel(multiBranch, transfer.fromBranchName, transfer.fromWarehouseName)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">Đến</p>
              <p className="break-words text-base font-semibold text-slate-900">{placeLabel(multiBranch, transfer.toBranchName, transfer.toWarehouseName)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">Duyệt xuất</p>
              <p className="break-words text-base font-semibold text-slate-900">{transfer.shippedAt ? `${formatDateTimeVn(transfer.shippedAt)} · ${transfer.shippedByName ?? ''}` : '—'}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">{transfer.receivedAt ? 'Kiểm nhận' : 'Ghi chú phiếu'}</p>
              <p className="break-words text-base font-semibold text-slate-900">
                {transfer.receivedAt ? `${formatDateTimeVn(transfer.receivedAt)} · ${transfer.receivedByName ?? ''}` : transfer.note || '—'}
              </p>
            </div>
          </div>
        )
      )}

      {/* ============ Các chế độ xử lý của bên nhận / bên gửi ============ */}
      {transfer && action === 'receive' && (
        <StockTransferReceivePanel transfer={transfer} receiverName={user?.fullName ?? ''} onDone={backToList} onCancel={backToList} />
      )}
      {transfer && action === 'resolve' && <StockTransferResolvePanel transfer={transfer} onDone={backToList} onCancel={backToList} />}
      {transfer && action === 'confirm-return' && <StockTransferConfirmReturnPanel transfer={transfer} onDone={backToList} onCancel={backToList} />}

      {/* ============ Search-and-pick (chỉ khi DRAFT) — style nổi bật đồng bộ với
          `StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx`/`StockCountFormPage.tsx` ============ */}
      {isDraftEditable && (
        <div className="flex flex-shrink-0 items-end gap-2.5 rounded-lg border-2 border-blue-200 bg-blue-50 p-3 shadow-sm">
          <div className="relative flex-1">
            <label htmlFor="transfer-drug-search" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Thêm thuốc / vật tư vào phiếu
            </label>
            <div className="relative">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-500" aria-hidden="true" />
              <input
                id="transfer-drug-search"
                type="text"
                value={drugQuery}
                disabled={!fromWarehouseId}
                onChange={(e) => {
                  setDrugQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Gõ tên/mã/mã vạch mặt hàng tại Kho nguồn — Enter/Tab để thêm nhanh..."
                className="w-full rounded-md border border-blue-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
              />
            </div>
            {isSearchingDrug && (
              <div className="scroll-hover absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {searchResults.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Không tìm thấy, hoặc đã có sẵn trong phiếu.</p>}
                {searchResults.map((d, idx) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={addingDrugId !== null}
                    onClick={() => void addDrug(d)}
                    className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 disabled:opacity-60 ${idx === highlightedIndex ? 'bg-brand-teal-tint' : 'hover:bg-slate-50'}`}
                  >
                    <span className="font-medium text-slate-900">{d.name}</span> <span className="text-xs font-semibold text-slate-400">({d.code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ Bảng dòng hàng (soạn Nháp hoặc chỉ đọc) ============ */}
      {(isDraftEditable || isViewOnly) && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {isDraftEditable && lines.length === 0 ? (
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
                        <span className="font-medium text-slate-900">{l.drugName}</span> <span className="text-xs font-medium text-slate-400">({l.drugCode})</span>
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
            transfer && <ReadOnlyLines transfer={transfer} showCost={showCost === true} />
          )}
        </div>
      )}

      {/* ============ Thông tin từ chối nhận / xử lý (chỉ đọc) ============ */}
      {transfer && (isViewOnly || action !== null) && <TransferOutcomeNotes transfer={transfer} />}

      {/* ============ Footer hành động ============ */}
      {isDraftEditable && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" loading={saving} onClick={() => void handleSave(false)}>
              Lưu nháp
            </Button>
            <Button type="button" loading={saving} onClick={() => void handleSave(true)}>
              Duyệt (Xuất kho ngay)
            </Button>
          </div>
        </div>
      )}

      {isDraftEditable && (
        <p className="flex-shrink-0 px-1 text-xs text-slate-500">
          Bấm &quot;Duyệt&quot; sẽ trừ tồn kho NGUỒN ngay lập tức và chuyển phiếu sang &quot;Đang vận chuyển&quot; — chờ kho đích kiểm nhận hàng.
          {multiBranch && ' Phiếu thuộc chi nhánh gửi; chi nhánh nhận chỉ thấy từ lúc Duyệt xuất.'}
        </p>
      )}
      {isViewOnly && transfer?.status === 'IN_TRANSIT' && sides?.isSender && !sides.isReceiver && (
        <p className="flex-shrink-0 px-1 text-xs text-slate-500">Hàng đang đi — chi nhánh nhận sẽ kiểm nhận. In phiếu để đi kèm hàng.</p>
      )}

      {printing && transfer && <StockTransferPrintView transfer={transfer} />}

      {rejecting && transfer && (
        <StockTransferRejectDialog transferId={transfer.id} transferNo={transfer.transferNo} version={transfer.version} onDone={backToList} onClose={() => setRejecting(false)} />
      )}
    </div>
  );
}

/** Bảng chỉ đọc: SL đã xuất / thực nhận / lý do chênh lệch / cách xử lý; thêm cột "Giá trị thiếu" chỉ khi người xem thuộc chi nhánh GỬI (Q3). */
function ReadOnlyLines({ transfer, showCost }: { transfer: StockTransferDetail; showCost: boolean }) {
  const grid = showCost ? 'minmax(220px,1.5fr) 100px 100px 130px minmax(220px,1.5fr) minmax(170px,1fr)' : 'minmax(220px,1.5fr) 100px 100px minmax(220px,1.5fr) minmax(170px,1fr)';
  return (
    <div className="scroll-hover h-full overflow-auto">
      <div role="table" aria-label="Dòng hàng điều chuyển" style={{ minWidth: showCost ? 1040 : 900 }}>
        <div role="row" style={{ gridTemplateColumns: grid }} className="grid gap-x-2 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
          <div role="columnheader" className="py-2.5 text-left">Mặt hàng / Lô</div>
          <div role="columnheader" className="py-2.5 text-center">SL đã xuất</div>
          <div role="columnheader" className="py-2.5 text-center">SL thực nhận</div>
          {showCost && <div role="columnheader" className="py-2.5 text-right">Giá trị thiếu</div>}
          <div role="columnheader" className="py-2.5 pl-3 text-left">Lý do chênh lệch</div>
          <div role="columnheader" className="py-2.5 text-left">Xử lý</div>
        </div>
        {transfer.lines.map((l) => {
          const shortage = l.quantityReceived === null ? 0 : Math.max(0, l.quantityShipped - l.quantityReceived);
          return (
            <div key={l.id} role="row" style={{ gridTemplateColumns: grid, minHeight: 56 }} className={`grid items-center gap-x-2 border-b border-slate-100 px-4 text-sm ${shortage > 0 ? 'bg-amber-50/50' : ''}`}>
              <div role="cell" className="min-w-0 py-2">
                <p className="truncate font-bold text-slate-900" title={l.drugName}>{l.drugName}</p>
                <p className="truncate text-xs font-medium text-slate-400">{l.isBatchManaged ? `Lô ${l.batchNo}${l.expiryDate ? ` · HSD ${l.expiryDate.split('-').reverse().join('/')}` : ''}` : '— (không quản lý lô)'}</p>
              </div>
              <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{l.quantityShipped}</div>
              <div role="cell" className="text-center font-semibold tabular-nums">{l.quantityReceived ?? '—'}</div>
              {showCost && <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{shortage > 0 && l.unitCost !== null ? (shortage * l.unitCost).toLocaleString('vi-VN') : '—'}</div>}
              <div role="cell" className="min-w-0 pl-3 text-slate-700">
                {l.varianceReason ? <p className="font-semibold">{VARIANCE_REASON_LABEL[l.varianceReason]}</p> : <p className="text-slate-400">—</p>}
                {l.varianceNote && l.varianceNote !== (l.varianceReason ? VARIANCE_REASON_LABEL[l.varianceReason] : '') && <p className="break-words text-xs text-slate-500">{l.varianceNote}</p>}
              </div>
              <div role="cell" className="min-w-0 text-slate-700">
                {l.varianceResolution && <p className="font-semibold">{VARIANCE_RESOLUTION_LABEL[l.varianceResolution]}</p>}
                {l.quantityReturnedBack !== null && <p className="font-semibold">Nhận lại: {l.quantityReturnedBack}</p>}
                {l.returnVarianceNote && <p className="break-words text-xs text-slate-500">{l.returnVarianceNote}</p>}
                {!l.varianceResolution && l.quantityReturnedBack === null && <span className="text-slate-400">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ghi lại lý do bên nhận từ chối nhận / ghi chú xử lý chênh lệch / lý do bên gửi từ chối duyệt — để cả hai bên cùng thấy dấu vết. */
function TransferOutcomeNotes({ transfer }: { transfer: StockTransferDetail }) {
  const notes: { title: string; body: string }[] = [];
  if (transfer.status === 'REJECTED' && transfer.rejectionReason) {
    notes.push({ title: 'Lý do từ chối phiếu', body: transfer.rejectionReason });
  }
  if (transfer.receiveRejectReason) {
    const who = [transfer.receiveRejectedByName, transfer.receiveRejectedAt ? formatDateTimeVn(transfer.receiveRejectedAt) : null].filter(Boolean).join(' · ');
    notes.push({
      title: `Bên nhận từ chối nhận hàng: ${REJECT_RECEIPT_REASON_LABEL[transfer.receiveRejectReason]}`,
      body: [transfer.receiveRejectNote, who].filter(Boolean).join(' — '),
    });
  }
  if (transfer.returnConfirmedByName) {
    notes.push({ title: 'Đã nhận lại hàng', body: [transfer.returnConfirmedByName, transfer.returnConfirmedAt ? formatDateTimeVn(transfer.returnConfirmedAt) : null].filter(Boolean).join(' · ') });
  }
  if (transfer.varianceResolvedByName) {
    notes.push({
      title: 'Đã xử lý chênh lệch',
      body: [transfer.varianceResolutionNote, [transfer.varianceResolvedByName, transfer.varianceResolvedAt ? formatDateTimeVn(transfer.varianceResolvedAt) : null].filter(Boolean).join(' · ')].filter(Boolean).join(' — '),
    });
  }
  if (notes.length === 0) return null;
  return (
    <div className="flex-shrink-0 space-y-1.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      {notes.map((n) => (
        <p key={n.title} className="break-words text-slate-700">
          <span className="font-semibold text-slate-900">{n.title}.</span> {n.body}
        </p>
      ))}
    </div>
  );
}
