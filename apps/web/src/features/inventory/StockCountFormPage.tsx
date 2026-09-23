import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MagnifyingGlass, Plus, Printer, Trash, X } from '@phosphor-icons/react';
import type { CreateStockCountRequest, DrugSummary, StockCountLine } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatDobDisplay } from '../../shared/format/date';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { useDrugsQuery } from '../drug/drug.queries';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { getDrugBatchBalances } from './inventory.api';
import { useApproveStockCountMutation, useCreateStockCountMutation, useStockBalancesQuery, useStockCountQuery, useUpdateStockCountMutation } from './inventory.queries';
import { StockCountApproveReasonDialog } from './StockCountApproveReasonDialog';
import { StockCountPrintView } from './StockCountPrintView';

interface DraftLine {
  key: string;
  drugId: string;
  drugCode: string;
  drugName: string;
  isBatchManaged: boolean;
  /** Lô ĐÃ có sẵn trong hệ thống — `null` khi hàng không quản lý theo lô HOẶC đây là lô mới phát
   * hiện lúc đếm (`isNewBatch=true`). */
  batchId: string | null;
  isNewBatch: boolean;
  /** Số lô hiển thị/nhập — của lô đã có (chỉ đọc) hoặc lô mới (gõ tự do), tuỳ `isNewBatch`. */
  batchNo: string;
  expiryDate: string;
  systemQuantitySnapshot: number;
  countedQuantity: string;
}

const STATUS_META: Record<string, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

const TYPE_FILTER_OPTIONS: { code: 'ALL' | 'MEDICINE' | 'SUPPLY'; label: string }[] = [
  { code: 'ALL', label: 'Tất cả' },
  { code: 'MEDICINE', label: 'Thuốc' },
  { code: 'SUPPLY', label: 'Vật tư' },
];

function makeKey(): string {
  return Math.random().toString(36).slice(2);
}

function todayVn(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function diffMeta(diff: number): { label: string; className: string } {
  if (diff > 0) return { label: `+${diff}`, className: 'bg-emerald-100 text-emerald-700' };
  if (diff < 0) return { label: `${diff}`, className: 'bg-rose-100 text-rose-700' };
  return { label: 'Khớp', className: 'bg-slate-200 text-slate-700' };
}

/**
 * "Tạo phiếu kiểm kê" / "Sửa Nháp" / "Xem chi tiết" — Kho Thuốc GĐ4, phần "Kiểm kê" (docs/DECISIONS.md
 * #170, mockup `KiemKeForm.dc.html` đã duyệt). TRANG RIÊNG (không modal, đúng khuôn
 * `StockReceiptFormPage.tsx`) — dùng CHUNG 1 component cho cả 3 chế độ theo trạng thái phiếu.
 *
 * Search-and-pick 1 bước: gõ tên/mã → chọn → tự tách N dòng theo TỪNG LÔ hiện có của thuốc đó (gọi
 * `GET /inventory/drugs/:id/balances` ngay lúc thêm — không có lô nào thì tự thêm 1 dòng "lô mới"
 * trống). Nút "+ Thêm lô mới" trên tiêu đề nhóm cho lô hoàn toàn lạ hệ thống chưa biết tới.
 */
export function StockCountFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const canApprove = useHasPermission('stock_count', 'approve');

  const countQuery = useStockCountQuery(id ?? '', isEdit);
  const warehousesQuery = useWarehousesQuery();
  const clinicQuery = useClinicPrintHeaderQuery();
  // Phân quyền theo Khoa/Phòng (docs/DECISIONS.md #170) — mặc định 5 vai trò hệ thống vẫn `global`
  // (không lọc gì); chỉ có tác dụng khi `clinic_admin` chủ động chọn scope `department` cho 1 vai
  // trò tuỳ biến ở "Vai trò & Phân quyền". Backend LUÔN enforce lại (404 nếu chọn sai kho) — lọc ở
  // đây thuần UX, tránh hiện lựa chọn chắc chắn sẽ bị chặn khi Lưu.
  const createDataScope = useDataScope('stock_count', 'create');
  const actorDepartmentId = useActorDepartmentId();
  const isDepartmentScoped = createDataScope === 'department';
  const createMutation = useCreateStockCountMutation();
  const updateMutation = useUpdateStockCountMutation();
  const approveMutation = useApproveStockCountMutation();

  const readOnly = isEdit && countQuery.data !== undefined && countQuery.data.status !== 'DRAFT';

  const [warehouseId, setWarehouseId] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayVn());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [addingDrugId, setAddingDrugId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupFilterType, setGroupFilterType] = useState<'ALL' | 'MEDICINE' | 'SUPPLY'>('ALL');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ id: string; version: number; countNo: string } | null>(null);
  const [printing, setPrinting] = useState(false);

  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

  useBreadcrumb([
    { label: 'Quản lý kho' },
    { label: 'Kiểm kê', to: '/inventory/counts' },
    { label: readOnly ? 'Chi tiết' : isEdit ? 'Sửa Nháp' : 'Tạo phiếu' },
  ]);

  // Nạp dữ liệu phiếu đã có (Sửa/Xem) vào state form — chỉ chạy 1 lần khi dữ liệu về.
  useEffect(() => {
    if (!countQuery.data) return;
    const c = countQuery.data;
    setWarehouseId(c.warehouseId);
    setOccurredAt(c.occurredAt.slice(0, 10));
    setNote(c.note ?? '');
    setLines(
      c.lines.map((l: StockCountLine) => ({
        key: l.id,
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        isBatchManaged: l.isBatchManaged,
        batchId: l.batchId,
        isNewBatch: l.isNewBatch,
        batchNo: l.batchNo ?? '',
        expiryDate: l.expiryDate ?? '',
        systemQuantitySnapshot: l.systemQuantitySnapshot,
        countedQuantity: String(l.countedQuantity),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countQuery.data?.id]);

  const debouncedDrugQuery = useDebouncedValue(drugQuery, 300);
  const isSearchingDrug = drugQuery.trim() !== '';
  const drugSearchQuery = useDrugsQuery({ q: debouncedDrugQuery.trim() || undefined });
  const existingDrugIds = useMemo(() => new Set(lines.map((l) => l.drugId)), [lines]);
  const searchResults = isSearchingDrug ? (drugSearchQuery.data?.items ?? []).filter((d) => !existingDrugIds.has(d.id)) : [];

  // Tồn TỔNG HỢP (mọi lô gộp lại) theo drugId, tại đúng kho đang chọn — dùng làm "Tồn hệ thống"
  // cho hàng KHÔNG quản lý theo lô (endpoint theo-lô luôn rỗng cho nhóm hàng này).
  const balancesQuery = useStockBalancesQuery({ warehouseId: warehouseId || undefined, belowMinOnly: false });
  const flatBalanceByDrugId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of balancesQuery.data?.items ?? []) map.set(item.drugId, item.quantityOnHand);
    return map;
  }, [balancesQuery.data]);

  // Danh mục đầy đủ (không lọc theo ô tìm) — phục vụ panel "Thêm theo nhóm".
  const allDrugsQuery = useDrugsQuery({});
  const groupCatalogQuery = useReferenceCatalogQuery('DRUG_GROUP');

  function makeFlatLine(drug: DrugSummary): DraftLine {
    const systemQty = flatBalanceByDrugId.get(drug.id) ?? 0;
    return {
      key: makeKey(),
      drugId: drug.id,
      drugCode: drug.code,
      drugName: drug.name,
      isBatchManaged: false,
      batchId: null,
      isNewBatch: false,
      batchNo: '',
      expiryDate: '',
      systemQuantitySnapshot: systemQty,
      countedQuantity: String(systemQty),
    };
  }

  function makeNewBatchLine(drug: DrugSummary): DraftLine {
    return {
      key: makeKey(),
      drugId: drug.id,
      drugCode: drug.code,
      drugName: drug.name,
      isBatchManaged: true,
      batchId: null,
      isNewBatch: true,
      batchNo: '',
      expiryDate: '',
      systemQuantitySnapshot: 0,
      countedQuantity: '0',
    };
  }

  async function expandDrugToLines(drug: DrugSummary): Promise<DraftLine[]> {
    if (!drug.isBatchManaged) return [makeFlatLine(drug)];
    const res = await getDrugBatchBalances(drug.id, warehouseId);
    if (res.items.length === 0) return [makeNewBatchLine(drug)];
    return res.items.map((b) => ({
      key: makeKey(),
      drugId: drug.id,
      drugCode: drug.code,
      drugName: drug.name,
      isBatchManaged: true,
      batchId: b.batchId,
      isNewBatch: false,
      batchNo: b.batchNo,
      expiryDate: b.expiryDate ?? '',
      systemQuantitySnapshot: b.quantityOnHand,
      countedQuantity: String(b.quantityOnHand),
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
      setLines((prev) => [...prev, ...newLines]);
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

  function addNewBatchRow(groupDrugId: string) {
    setLines((prev) => {
      const template = prev.find((l) => l.drugId === groupDrugId);
      if (!template) return prev;
      return [...prev, { ...makeNewBatchLine({ id: template.drugId, code: template.drugCode, name: template.drugName } as DrugSummary) }];
    });
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  // ============ "Thêm theo nhóm" ============

  const allDrugs = allDrugsQuery.data?.items ?? [];
  const groupOptions = groupCatalogQuery.data?.items ?? [];

  const groupMatches = useMemo(() => {
    return allDrugs.filter((d) => {
      if (existingDrugIds.has(d.id)) return false;
      if (groupFilterType === 'MEDICINE' && d.itemType !== 'MEDICINE') return false;
      if (groupFilterType === 'SUPPLY' && d.itemType !== 'SUPPLY') return false;
      if (selectedGroups.length > 0) {
        if (d.itemType !== 'MEDICINE') return false;
        if (!d.drugGroupCode || !selectedGroups.includes(d.drugGroupCode)) return false;
      }
      return true;
    });
  }, [allDrugs, existingDrugIds, groupFilterType, selectedGroups]);

  function toggleGroupCode(code: string) {
    setSelectedGroups((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function bulkAddByGroup() {
    if (groupMatches.length === 0 || !warehouseId) return;
    setBulkAdding(true);
    try {
      const expanded = await Promise.all(groupMatches.map((d) => expandDrugToLines(d)));
      setLines((prev) => [...prev, ...expanded.flat()]);
      setGroupPanelOpen(false);
      setGroupFilterType('ALL');
      setSelectedGroups([]);
    } finally {
      setBulkAdding(false);
    }
  }

  // ============ nhóm theo drugId để render (1 tiêu đề sản phẩm + N dòng lô) ============

  const lineGroups = useMemo(() => {
    const map = new Map<string, DraftLine[]>();
    for (const l of lines) {
      const arr = map.get(l.drugId);
      if (arr) arr.push(l);
      else map.set(l.drugId, [l]);
    }
    return [...map.values()];
  }, [lines]);

  // ============ tổng hợp dư/thiếu/khớp — dùng `difference` THẬT nếu đã Duyệt, ngược lại tính preview ============

  const { surplusCount, shortageCount, matchCount } = useMemo(() => {
    let surplus = 0;
    let shortage = 0;
    let match = 0;
    for (const l of lines) {
      const diff = readOnly ? ((countQuery.data?.lines.find((x) => x.id === l.key)?.difference ?? 0)) : Number(l.countedQuantity || 0) - l.systemQuantitySnapshot;
      if (diff > 0) surplus += 1;
      else if (diff < 0) shortage += 1;
      else match += 1;
    }
    return { surplusCount: surplus, shortageCount: shortage, matchCount: match };
  }, [lines, readOnly, countQuery.data]);

  function buildPayload(): CreateStockCountRequest | null {
    if (!warehouseId) {
      setFormError('Phải chọn Kho kiểm kê.');
      return null;
    }
    if (lines.length === 0) {
      setFormError('Phải có ít nhất 1 dòng đếm.');
      return null;
    }
    for (const l of lines) {
      if (l.countedQuantity === '' || Number(l.countedQuantity) < 0) {
        setFormError(`Dòng "${l.drugName}" thiếu số đếm hợp lệ.`);
        return null;
      }
      if (l.isNewBatch && !l.batchNo.trim()) {
        setFormError(`Dòng "${l.drugName}" (lô mới) — phải nhập Số lô.`);
        return null;
      }
    }
    setFormError(null);
    return {
      warehouseId,
      occurredAt: `${occurredAt}T00:00:00+07:00`,
      note: note || undefined,
      lines: lines.map((l) => ({
        drugId: l.drugId,
        batchId: l.isNewBatch ? undefined : (l.batchId ?? undefined),
        newBatchNo: l.isNewBatch ? l.batchNo : undefined,
        newBatchExpiryDate: l.isNewBatch ? l.expiryDate || undefined : undefined,
        systemQuantitySnapshot: l.systemQuantitySnapshot,
        countedQuantity: Number(l.countedQuantity),
      })),
    };
  }

  async function handleSave(andApprove: boolean) {
    const payload = buildPayload();
    if (!payload) return;

    let savedId: string | undefined;
    let savedVersion: number | undefined;
    let savedCountNo: string | undefined;
    try {
      if (isEdit && id) {
        const updated = await updateMutation.mutateAsync({ id, body: { ...payload, version: countQuery.data!.version } });
        savedId = id;
        savedVersion = updated.version;
        savedCountNo = updated.countNo;
      } else {
        const created = await createMutation.mutateAsync(payload);
        savedId = created.id;
        savedVersion = created.version;
        savedCountNo = created.countNo;
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Lưu phiếu thất bại, vui lòng thử lại.');
      return;
    }

    if (!andApprove || !savedId) {
      navigate('/inventory/counts');
      return;
    }

    try {
      await approveMutation.mutateAsync({ id: savedId, body: { version: savedVersion! } });
      navigate('/inventory/counts');
    } catch (err) {
      // Phiếu có dòng dư/thiếu (đọc tồn kho SỐNG lúc Duyệt) — bản ghi ĐÃ LƯU thành công rồi, chỉ
      // bước Duyệt cần thêm lý do. Mở popup thay vì báo lỗi để không phải nhập lại từ đầu.
      if (err instanceof ApiError && err.code === 'STOCK_COUNT_APPROVAL_REASON_REQUIRED') {
        setPendingApproval({ id: savedId, version: savedVersion!, countNo: savedCountNo ?? '' });
        return;
      }
      setFormError(err instanceof ApiError ? err.message : 'Duyệt phiếu thất bại, vui lòng thử lại.');
    }
  }

  if (isEdit && countQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isEdit && countQuery.isError) {
    return <ErrorBanner message={countQuery.error instanceof ApiError ? countQuery.error.message : 'Không tải được phiếu.'} onRetry={() => void countQuery.refetch()} />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || approveMutation.isPending;
  const columns = readOnly ? '1.8fr 130px 150px 120px' : '1.8fr 130px 150px 120px 50px';

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{readOnly ? 'Chi tiết phiếu kiểm kê' : isEdit ? 'Sửa phiếu kiểm kê' : 'Tạo phiếu kiểm kê'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-bold text-slate-900">{readOnly ? countQuery.data!.countNo : isEdit ? 'Sửa phiếu Nháp' : 'Tạo phiếu kiểm kê'}</h2>
          {isEdit && countQuery.data && <StatusBadge tone={STATUS_META[countQuery.data.status]!.tone}>{STATUS_META[countQuery.data.status]!.label}</StatusBadge>}
        </div>
        <Button type="button" variant="secondary" onClick={() => navigate('/inventory/counts')}>
          ← Quay lại danh sách
        </Button>
      </div>

      {/* Lý do chênh lệch — chỉ có giá trị SAU khi Duyệt phiếu có dòng dư/thiếu (docs/DECISIONS.md
          #171). Trước đây chỉ hiện trên phiếu in, bổ sung hiện ngay trên màn hình xem — người xem lại
          lịch sử không cần in mới biết lý do. */}
      {readOnly && countQuery.data?.approvalReason && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm">
          <span className="font-semibold text-amber-900">Lý do chênh lệch:</span>
          <span className="text-amber-800">{countQuery.data.approvalReason}</span>
        </div>
      )}

      {/* Khối header — đúng mockup: Kho kiểm kê / Ngày kiểm kê / Ghi chú. */}
      <div className="grid flex-shrink-0 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Kho kiểm kê <span className="text-rose-500">*</span>
          </label>
          <Combobox
            id="count-warehouse"
            value={warehouseId}
            disabled={readOnly || lines.length > 0}
            onChange={setWarehouseId}
            placeholder="— Chọn kho —"
            options={(warehousesQuery.data?.items ?? [])
              .filter((w) => !isDepartmentScoped || w.departmentId === actorDepartmentId)
              .map((w) => ({ value: w.id, label: w.name }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Ngày kiểm kê <span className="text-rose-500">*</span>
          </label>
          <DateInput id="count-occurred-at" value={occurredAt} onChange={setOccurredAt} disabled={readOnly} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">Ghi chú</label>
          <input
            type="text"
            value={note}
            disabled={readOnly}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Kiểm kê định kỳ cuối tháng..."
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
          />
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-shrink-0 flex-col gap-2.5">
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
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
                placeholder="Gõ tên/mã/mã vạch để tìm — Enter/Tab để thêm nhanh..."
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
            <Button type="button" variant="add" disabled={!warehouseId} onClick={() => setGroupPanelOpen((v) => !v)}>
              Thêm theo nhóm
            </Button>
          </div>

          {groupPanelOpen && (
            <div className="flex flex-col gap-3.5 rounded-lg border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">Thêm nhiều mặt hàng cùng lúc theo Loại / Nhóm thuốc</span>
                <button type="button" onClick={() => setGroupPanelOpen(false)} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Loại mặt hàng</span>
                <div className="flex gap-2">
                  {TYPE_FILTER_OPTIONS.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => {
                        setGroupFilterType(t.code);
                        if (t.code === 'SUPPLY') setSelectedGroups([]);
                      }}
                      className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${groupFilterType === t.code ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {groupFilterType !== 'SUPPLY' && (
                <div>
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Nhóm thuốc (chỉ áp dụng cho Thuốc)</span>
                  <div className="flex flex-wrap gap-2">
                    {groupOptions.map((g) => {
                      const active = selectedGroups.includes(g.code);
                      const count = allDrugs.filter((d) => d.itemType === 'MEDICINE' && d.drugGroupCode === g.code && !existingDrugIds.has(d.id)).length;
                      return (
                        <button
                          key={g.code}
                          type="button"
                          onClick={() => toggleGroupCode(g.code)}
                          className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                        >
                          {g.name} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm font-semibold text-slate-700">
                  {groupMatches.length === 0 ? 'Không có sản phẩm nào khớp bộ lọc (hoặc đã có sẵn trong phiếu)' : `${groupMatches.length} sản phẩm khớp bộ lọc, chưa có trong phiếu`}
                </span>
                <Button type="button" loading={bulkAdding} disabled={groupMatches.length === 0} onClick={() => void bulkAddByGroup()}>
                  Thêm {groupMatches.length} sản phẩm vào phiếu
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 ? (
          <EmptyState icon={MagnifyingGlass} title="Chưa có dòng đếm nào" description={readOnly ? 'Phiếu này không có dòng đếm.' : 'Gõ tên thuốc/vật tư ở ô trên để thêm dòng đếm.'} />
        ) : (
          <div role="table" aria-label="Dòng đếm" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 820 }}>
              <div role="row" style={{ gridTemplateColumns: columns }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-left">Lô / Hạn sử dụng</div>
                <div role="columnheader" className="py-2.5 text-right">Tồn hệ thống</div>
                <div role="columnheader" className="py-2.5 text-center">Số đếm thực tế</div>
                <div role="columnheader" className="py-2.5 text-center">Chênh lệch</div>
                {!readOnly && <div role="columnheader" className="py-2.5" />}
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lineGroups.map((group) => {
                  const head = group[0]!;
                  return (
                    <div key={head.drugId}>
                      <div role="row" style={{ gridTemplateColumns: columns, minHeight: 40 }} className="grid items-center border-b border-slate-100 bg-slate-50/70 px-4 text-sm">
                        <div role="cell" className="min-w-0 truncate font-bold text-slate-900" title={head.drugName}>
                          {head.drugName} <span className="text-xs font-medium text-slate-400">({head.drugCode})</span>
                        </div>
                        <div role="cell" className={readOnly ? 'col-span-3' : 'col-span-3'} />
                        {!readOnly && (
                          <div role="cell" className="text-center">
                            {head.isBatchManaged && (
                              <button type="button" onClick={() => addNewBatchRow(head.drugId)} aria-label={`Thêm lô mới cho ${head.drugName}`} title="Thêm lô mới (chưa có trong hệ thống)" className="rounded-full p-1 text-blue-600 hover:bg-blue-50">
                                <Plus size={15} weight="bold" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {group.map((l) => {
                        const persistedDiff = countQuery.data?.lines.find((x) => x.id === l.key)?.difference;
                        const diff = readOnly ? (persistedDiff ?? 0) : Number(l.countedQuantity || 0) - l.systemQuantitySnapshot;
                        const meta = diffMeta(diff);
                        return (
                          <div key={l.key} role="row" style={{ gridTemplateColumns: columns, minHeight: 52 }} className="grid items-center border-b border-slate-100 px-4 text-sm">
                            <div role="cell" className="min-w-0 pl-4 text-slate-500">
                              {!l.isBatchManaged && '— (không quản lý lô)'}
                              {l.isBatchManaged && !l.isNewBatch && (
                                <>
                                  Lô {l.batchNo} {l.expiryDate && <>· HSD {formatDobDisplay(l.expiryDate)}</>}
                                </>
                              )}
                              {l.isBatchManaged && l.isNewBatch && !readOnly && (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={l.batchNo}
                                    onChange={(e) => updateLine(l.key, { batchNo: e.target.value })}
                                    placeholder="Nhập số lô mới..."
                                    className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-900"
                                  />
                                  <DateInput id={`count-new-expiry-${l.key}`} value={l.expiryDate} onChange={(v) => updateLine(l.key, { expiryDate: v })} dense />
                                </div>
                              )}
                              {l.isBatchManaged && l.isNewBatch && readOnly && (
                                <>
                                  Lô {l.batchNo || '—'} {l.expiryDate && <>· HSD {formatDobDisplay(l.expiryDate)}</>}
                                </>
                              )}
                            </div>
                            <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{l.systemQuantitySnapshot}</div>
                            <div role="cell" className="px-1">
                              {readOnly ? (
                                <div className="text-center tabular-nums">{l.countedQuantity}</div>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  value={l.countedQuantity}
                                  onChange={(e) => updateLine(l.key, { countedQuantity: e.target.value })}
                                  className="w-24 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                                />
                              )}
                            </div>
                            <div role="cell" className="text-center">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>{meta.label}</span>
                            </div>
                            {!readOnly && (
                              <div role="cell" className="text-center">
                                <button type="button" onClick={() => removeLine(l.key)} aria-label={`Xoá dòng ${l.drugName}`} className="text-slate-400 hover:text-rose-600">
                                  <Trash size={16} weight="bold" aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3.5 text-sm font-semibold text-slate-700">
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">{surplusCount} dòng dư</span>
          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">{shortageCount} dòng thiếu</span>
          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700">{matchCount} dòng khớp</span>
        </div>
        {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
        {!readOnly && (
          <div className="flex gap-2">
            {/* Nhân viên kiểm kê không có quyền `stock_count.approve` (Trưởng kho mới duyệt) —
                CHỈ nút này, đổi nhãn cho rõ đây là bước nộp phiếu chờ duyệt (nút KHÔNG đụng tồn
                kho, cùng hành vi "Lưu nháp" cũ, chỉ khác cách gọi tên — chủ dự án phát hiện 22/09/2026). */}
            <Button type="button" variant={canApprove ? 'secondary' : 'primary'} loading={saving} onClick={() => void handleSave(false)}>
              {canApprove ? 'Lưu nháp' : 'Lưu & chuyển duyệt'}
            </Button>
            {canApprove && (
              <Button type="button" loading={saving} onClick={() => void handleSave(true)}>
                Duyệt
              </Button>
            )}
          </div>
        )}
        {/* In phiếu — CHỈ phiếu ĐÃ DUYỆT (`difference`/lý do chênh lệch chỉ có giá trị thật sau khi
            Duyệt), bổ sung 22/09/2026 theo yêu cầu chủ dự án (`docs/DECISIONS.md` #171). */}
        {readOnly && countQuery.data?.status === 'POSTED' && (
          <Button type="button" variant="secondary" onClick={handlePrint}>
            <Printer size={15} weight="bold" aria-hidden="true" />
            In phiếu
          </Button>
        )}
      </div>

      {printing && countQuery.data && clinicQuery.data && <StockCountPrintView count={countQuery.data} clinicHeader={clinicQuery.data} />}

      {pendingApproval && (
        <StockCountApproveReasonDialog
          countId={pendingApproval.id}
          countNo={pendingApproval.countNo}
          version={pendingApproval.version}
          onDone={() => {
            setPendingApproval(null);
            navigate('/inventory/counts');
          }}
          onClose={() => setPendingApproval(null)}
        />
      )}
    </div>
  );
}
