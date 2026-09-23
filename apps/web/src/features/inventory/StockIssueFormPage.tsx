import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, MagnifyingGlass, Printer, Trash } from '@phosphor-icons/react';
import type { CreateManualStockIssueRequest, DrugSummary, ManualStockIssueType, StockIssueStatus } from '@nexamed/shared';
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
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { useDrugsQuery } from '../drug/drug.queries';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { getDrugBatchBalances } from './inventory.api';
import {
  useApproveStockIssueMutation,
  useCreateManualStockIssueMutation,
  useRejectStockIssueMutation,
  useStockBalancesQuery,
  useStockIssueQuery,
  useUpdateManualStockIssueMutation,
} from './inventory.queries';
import { ReasonConfirmDialog } from './ReasonConfirmDialog';
import { StockIssuePrintView } from './StockIssuePrintView';

interface DraftLine {
  key: string;
  drugId: string;
  drugCode: string;
  drugName: string;
  isBatchManaged: boolean;
  batchId: string | null;
  batchNo: string;
  expiryDate: string;
  /** Tồn khả dụng tại kho đã chọn — CHỈ hiển thị tham khảo, Duyệt mới kiểm thật lại. */
  availableQuantity: number;
  quantity: string;
}

const ISSUE_TYPE_OPTIONS: { value: ManualStockIssueType; label: string }[] = [
  { value: 'INTERNAL_ALLOCATION', label: 'Xuất dùng nội bộ' },
  { value: 'RETURN_TO_SUPPLIER', label: 'Xuất trả nhà cung cấp' },
  { value: 'WRITE_OFF', label: 'Xuất huỷ (hỏng/hết hạn)' },
];

const STATUS_META: Record<StockIssueStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  VOIDED: { label: 'Đã huỷ', tone: 'neutral' },
};

function makeKey(): string {
  return Math.random().toString(36).slice(2);
}

function todayVn(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * "Tạo phiếu xuất" / "Sửa Nháp" / "Xem chi tiết" — "Phiếu xuất kho mở rộng" (Kho Thuốc GĐ4,
 * docs/DECISIONS.md #170, kế hoạch bright-bubbling-axolotl.md mục 4, mockup NVC5A4uZsmX9kFsAk5Td88
 * đã duyệt) — 3 loại Nháp→Duyệt lập tay (Xuất dùng nội bộ/Xuất trả nhà cung cấp/Xuất huỷ), KHÔNG
 * gắn đơn thuốc/hoá đơn nào (khác "Phát thuốc" 1 bước của GĐ3, route/trang riêng). TRANG RIÊNG
 * (không modal, đúng khuôn `StockTransferFormPage.tsx`) — search-and-pick mặt hàng tại kho đã chọn,
 * tự tách theo lô (`getDrugBatchBalances()`), đúng khuôn Điều chuyển kho — khác `StockReceiptFormPage`
 * (gõ Số lô/Hạn dùng tự do): ở đây hàng phải CÓ THẬT trong kho mới xuất được.
 */
export function StockIssueFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const canCreate = useHasPermission('stock_issue', 'create');
  const canApprove = useHasPermission('stock_issue', 'approve');

  const issueQuery = useStockIssueQuery(id ?? '', isEdit);
  const warehousesQuery = useWarehousesQuery();
  const departmentsQuery = useDepartmentOptionsQuery(false);
  // Phân quyền theo Khoa/Phòng (đúng khuôn `StockReceiptFormPage.tsx`/`StockTransferFormPage.tsx`)
  // — backend LUÔN enforce lại (404 nếu chọn sai kho), lọc ở đây thuần UX.
  const createDataScope = useDataScope('stock_issue', 'create');
  const actorDepartmentId = useActorDepartmentId();
  const isDepartmentScoped = createDataScope === 'department';

  const createMutation = useCreateManualStockIssueMutation();
  const updateMutation = useUpdateManualStockIssueMutation();
  const approveMutation = useApproveStockIssueMutation();
  const clinicQuery = useClinicPrintHeaderQuery();

  const readOnly = isEdit && issueQuery.data !== undefined && issueQuery.data.status !== 'DRAFT';

  const [printing, setPrinting] = useState(false);
  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

  const [issueType, setIssueType] = useState<ManualStockIssueType>('INTERNAL_ALLOCATION');
  const [warehouseId, setWarehouseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayVn());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [addingDrugId, setAddingDrugId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const rejectMutation = useRejectStockIssueMutation();

  useBreadcrumb([
    { label: 'Quản lý kho' },
    { label: 'Phiếu xuất kho', to: '/inventory/issues' },
    { label: readOnly ? 'Chi tiết' : isEdit ? 'Sửa Nháp' : 'Tạo phiếu' },
  ]);

  // Nạp dữ liệu phiếu đã có vào state form — chỉ khi CHUYỂN SANG phiếu khác (đúng bài học
  // `loadedForId` đã sửa ở `EncounterConsultationPage.tsx`, tránh lẫn dữ liệu 2 phiếu).
  useEffect(() => {
    if (!issueQuery.data || issueQuery.data.id === loadedForId) return;
    const it = issueQuery.data;
    setIssueType(it.issueType as ManualStockIssueType);
    setWarehouseId(it.warehouseId);
    setDepartmentId(it.departmentId ?? '');
    setOccurredAt(it.occurredAt.slice(0, 10));
    setNote(it.note ?? '');
    setLines(
      it.lines.map((l) => ({
        key: l.id,
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        isBatchManaged: Boolean(l.batchNo),
        batchId: l.batchId,
        batchNo: l.batchNo ?? '',
        expiryDate: '',
        availableQuantity: 0,
        quantity: String(l.quantity),
      })),
    );
    setLoadedForId(it.id);
  }, [issueQuery.data, loadedForId]);

  const debouncedDrugQuery = useDebouncedValue(drugQuery, 300);
  const isSearchingDrug = drugQuery.trim() !== '';
  const drugSearchQuery = useDrugsQuery({ q: debouncedDrugQuery.trim() || undefined });
  const existingDrugIds = useMemo(() => new Set(lines.map((l) => l.drugId)), [lines]);
  const searchResults = isSearchingDrug ? (drugSearchQuery.data?.items ?? []).filter((d) => !existingDrugIds.has(d.id)) : [];

  // Tồn TỔNG HỢP tại kho đã chọn theo drugId — dùng cho hàng KHÔNG quản lý theo lô.
  const balancesQuery = useStockBalancesQuery({ warehouseId: warehouseId || undefined, belowMinOnly: false });
  const flatBalanceByDrugId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of balancesQuery.data?.items ?? []) map.set(item.drugId, item.quantityOnHand);
    return map;
  }, [balancesQuery.data]);

  async function expandDrugToLines(drug: DrugSummary): Promise<DraftLine[]> {
    if (!drug.isBatchManaged) {
      const available = flatBalanceByDrugId.get(drug.id) ?? 0;
      return [{ key: makeKey(), drugId: drug.id, drugCode: drug.code, drugName: drug.name, isBatchManaged: false, batchId: null, batchNo: '', expiryDate: '', availableQuantity: available, quantity: '' }];
    }
    const res = await getDrugBatchBalances(drug.id, warehouseId);
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
        quantity: '',
      }));
  }

  async function addDrug(drug: DrugSummary) {
    if (!warehouseId || existingDrugIds.has(drug.id)) {
      setDrugQuery('');
      return;
    }
    setAddingDrugId(drug.id);
    try {
      const newLines = await expandDrugToLines(drug);
      if (newLines.length === 0) {
        setFormError(`"${drug.name}" hiện không còn tồn tại kho đã chọn.`);
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

  function buildPayload(): CreateManualStockIssueRequest | null {
    if (!warehouseId) {
      setFormError('Phải chọn Kho xuất.');
      return null;
    }
    if (issueType === 'INTERNAL_ALLOCATION' && !departmentId) {
      setFormError('Phiếu "Xuất dùng nội bộ" phải chọn Khoa/Phòng tiếp nhận.');
      return null;
    }
    if (!note.trim()) {
      setFormError('Phải nhập Lý do.');
      return null;
    }
    if (lines.length === 0) {
      setFormError('Phải có ít nhất 1 dòng hàng.');
      return null;
    }
    for (const l of lines) {
      if (!l.quantity || Number(l.quantity) <= 0) {
        setFormError(`Dòng "${l.drugName}" thiếu số lượng hợp lệ.`);
        return null;
      }
    }
    setFormError(null);
    return {
      issueType,
      warehouseId,
      departmentId: issueType === 'INTERNAL_ALLOCATION' ? departmentId : undefined,
      occurredAt: `${occurredAt}T00:00:00+07:00`,
      note: note.trim(),
      lines: lines.map((l) => ({ drugId: l.drugId, batchId: l.batchId ?? undefined, quantity: Number(l.quantity) })),
    };
  }

  async function handleSave(andApprove: boolean) {
    const payload = buildPayload();
    if (!payload) return;
    try {
      let savedId = id;
      let savedVersion: number;
      if (isEdit && id) {
        const updated = await updateMutation.mutateAsync({ id, body: { ...payload, version: issueQuery.data!.version } });
        savedVersion = updated.version;
      } else {
        const created = await createMutation.mutateAsync(payload);
        savedId = created.id;
        savedVersion = created.version;
      }
      if (andApprove && savedId) {
        await approveMutation.mutateAsync({ id: savedId, body: { version: savedVersion } });
      }
      navigate('/inventory/issues');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Lưu phiếu thất bại, vui lòng thử lại.');
    }
  }

  if (isEdit && issueQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isEdit && issueQuery.isError) {
    return <ErrorBanner message={issueQuery.error instanceof ApiError ? issueQuery.error.message : 'Không tải được phiếu.'} onRetry={() => void issueQuery.refetch()} />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || approveMutation.isPending;
  const warehouseOptions = (warehousesQuery.data?.items ?? []).filter((w) => !isDepartmentScoped || w.departmentId === actorDepartmentId);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{readOnly ? 'Chi tiết phiếu xuất kho' : isEdit ? 'Sửa phiếu xuất kho' : 'Tạo phiếu xuất kho'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-bold text-slate-900">{readOnly ? issueQuery.data!.issueNo : isEdit ? 'Sửa phiếu Nháp' : 'Tạo phiếu xuất kho'}</h2>
          {isEdit && issueQuery.data && <StatusBadge tone={STATUS_META[issueQuery.data.status].tone}>{STATUS_META[issueQuery.data.status].label}</StatusBadge>}
        </div>
        <div className="flex gap-2">
          {readOnly && isEdit && issueQuery.data?.status === 'DRAFT' && canApprove && (
            <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
              Từ chối
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory/issues')}>
            ← Quay lại danh sách
          </Button>
        </div>
      </div>

      {/* Khối header — 1 hàng ngang gọn theo mockup. */}
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Loại phiếu xuất <span className="text-rose-500">*</span>
          </label>
          <Combobox id="issue-type" value={issueType} disabled={readOnly} onChange={(v) => setIssueType(v as ManualStockIssueType)} options={ISSUE_TYPE_OPTIONS} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Kho xuất <span className="text-rose-500">*</span>
          </label>
          <Combobox
            id="issue-warehouse"
            value={warehouseId}
            disabled={readOnly || lines.length > 0}
            onChange={setWarehouseId}
            placeholder="— Chọn kho —"
            options={warehouseOptions.map((w) => ({ value: w.id, label: w.name }))}
          />
        </div>
        {issueType === 'INTERNAL_ALLOCATION' && (
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Khoa/Phòng tiếp nhận <span className="text-rose-500">*</span>
            </label>
            <Combobox
              id="issue-department"
              value={departmentId}
              disabled={readOnly}
              onChange={setDepartmentId}
              placeholder="— Chọn Khoa/Phòng —"
              options={(departmentsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Ngày xuất <span className="text-rose-500">*</span>
          </label>
          <DateInput id="issue-occurred-at" value={occurredAt} onChange={setOccurredAt} disabled={readOnly} required />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Lý do <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={note}
            disabled={readOnly}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Vd: cấp phát vật tư sát khuẩn tuần này..."
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
          />
        </div>
      </div>

      {/* ============ Search-and-pick (chỉ khi còn Nháp) ============ */}
      {!readOnly && (
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative flex-1">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={drugQuery}
              disabled={!warehouseId}
              onChange={(e) => {
                setDrugQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Gõ tên/mã/mã vạch mặt hàng tại Kho xuất — Enter/Tab để thêm nhanh..."
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
            />
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
                    <span className="font-bold text-slate-900">{d.name}</span> <span className="text-xs font-semibold text-slate-400">({d.code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-slate-400">Chỉ hiện mặt hàng đang có tồn tại Kho xuất</span>
        </div>
      )}

      {/* ============ Bảng dòng hàng ============ */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 ? (
          <EmptyState icon={MagnifyingGlass} title="Chưa có dòng hàng nào" description={readOnly ? 'Phiếu này không có dòng hàng.' : 'Gõ tên thuốc/vật tư ở ô trên để thêm dòng hàng.'} />
        ) : (
          <div role="table" aria-label="Dòng hàng xuất kho" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 820 }}>
              <div
                role="row"
                style={{ gridTemplateColumns: readOnly ? '1.8fr 150px 150px' : '1.8fr 150px 150px 50px' }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="py-2.5 text-left">Lô / Hạn sử dụng (tại kho xuất)</div>
                <div role="columnheader" className="py-2.5 text-right">Tồn khả dụng</div>
                <div role="columnheader" className="py-2.5 text-center">SL xuất</div>
                {!readOnly && <div role="columnheader" className="py-2.5" />}
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lines.map((l) => (
                  <div key={l.key} role="row" style={{ gridTemplateColumns: readOnly ? '1.8fr 150px 150px' : '1.8fr 150px 150px 50px', minHeight: 52 }} className="grid items-center border-b border-slate-100 px-4 text-sm">
                    <div role="cell" className="min-w-0 truncate">
                      <span className="font-bold text-slate-900">{l.drugName}</span> <span className="text-xs font-medium text-slate-400">({l.drugCode})</span>
                      {l.isBatchManaged ? (
                        <span className="ml-1 text-slate-500">
                          — Lô {l.batchNo} {l.expiryDate && <>· HSD {l.expiryDate.split('-').reverse().join('/')}</>}
                        </span>
                      ) : (
                        <span className="ml-1 text-slate-400">— (không quản lý lô)</span>
                      )}
                    </div>
                    <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{l.availableQuantity}</div>
                    <div role="cell" className="text-center">
                      {readOnly ? (
                        <span className="font-semibold tabular-nums text-slate-900">{l.quantity}</span>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          max={l.availableQuantity || undefined}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                          className="w-24 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                        />
                      )}
                    </div>
                    {!readOnly && (
                      <div role="cell" className="text-center">
                        <button type="button" onClick={() => removeLine(l.key)} aria-label={`Xoá dòng ${l.drugName}`} className="text-slate-400 hover:text-rose-600">
                          <Trash size={16} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============ Footer hành động ============ */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
        {!readOnly && canCreate && (
          <div className="ml-auto flex gap-2">
            <Button type="button" variant={canApprove ? 'secondary' : 'primary'} loading={saving} onClick={() => void handleSave(false)}>
              {canApprove ? 'Lưu nháp' : 'Lưu & chuyển duyệt'}
            </Button>
            {canApprove && (
              <Button type="button" loading={saving} onClick={() => void handleSave(true)}>
                <Check size={15} weight="bold" aria-hidden="true" />
                Lưu &amp; Duyệt ngay
              </Button>
            )}
          </div>
        )}
        {readOnly && issueQuery.data?.status === 'POSTED' && (
          <Button type="button" variant="secondary" className="ml-auto" onClick={handlePrint}>
            <Printer size={15} weight="bold" aria-hidden="true" />
            In phiếu
          </Button>
        )}
      </div>

      {printing && issueQuery.data && clinicQuery.data && <StockIssuePrintView issue={issueQuery.data} clinicHeader={clinicQuery.data} />}

      {rejecting && issueQuery.data && (
        <ReasonConfirmDialog
          title="Từ chối phiếu xuất kho?"
          description={`Phiếu ${issueQuery.data.issueNo} sẽ chuyển sang trạng thái Từ chối, không đụng tồn kho.`}
          confirmLabel="Xác nhận từ chối"
          confirmVariant="danger"
          onConfirm={(reason) => rejectMutation.mutateAsync({ id: issueQuery.data!.id, body: { reason, version: issueQuery.data!.version } })}
          onDone={() => navigate('/inventory/issues')}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  );
}
