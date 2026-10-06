import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, MagnifyingGlass, PencilSimple, Trash } from '@phosphor-icons/react';
import type { CreateManualStockIssueRequest, DrugSummary, ManualStockIssueType, StockIssueDetail, StockIssueStatus } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { PrintButton } from '../../shared/print/PrintButton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { SummaryField } from '../../shared/ui/SummaryField';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useDrugsQuery } from '../drug/drug.queries';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { SupplierDebtAdjustmentBadge } from '../supplier-debt/SupplierDebtAdjustmentBadge';
import { getDrugBatchBalances } from './inventory.api';
import {
  useApproveStockIssueMutation,
  useCreateManualStockIssueMutation,
  useRejectStockIssueMutation,
  useStockBalancesQuery,
  useStockIssueQuery,
  useStockReceiptsQuery,
  useUpdateManualStockIssueMutation,
} from './inventory.queries';
import { ReasonConfirmDialog } from './ReasonConfirmDialog';
import { ISSUE_TYPE_OPTIONS, StockIssueHeaderDialog, type StockIssueHeaderValues } from './StockIssueHeaderDialog';
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
  /** "Công nợ nhà cung cấp" Phần C — CHỈ có ý nghĩa với `RETURN_TO_SUPPLIER`. Rỗng = để backend tự
   * tính giá mặc định (theo "Phiếu nhập gốc" nếu có chọn, không thì theo giá vốn lô/tồn kho). */
  returnUnitPrice: string;
}

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
  const location = useLocation();
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
  const [supplierId, setSupplierId] = useState('');
  const [sourceReceiptId, setSourceReceiptId] = useState('');
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
  // Popup "Thông tin phiếu xuất kho" (đúng mẫu `StockReceiptHeaderDialog` đã áp dụng) — mở NGAY khi
  // tạo phiếu mới, sửa/xem phiếu đã có chỉ mở lại qua nút "Sửa".
  const [headerDialogOpen, setHeaderDialogOpen] = useState(!isEdit);

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
    setSupplierId(it.supplierId ?? '');
    setSourceReceiptId(it.sourceReceiptId ?? '');
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
        returnUnitPrice: l.returnUnitPrice !== null ? String(l.returnUnitPrice) : '',
      })),
    );
    setLoadedForId(it.id);
  }, [issueQuery.data, loadedForId]);

  // "Sao chép thành phiếu mới" (Phần D, docs/DECISIONS.md #180/#182/#187) — chỉ mồi lúc TẠO MỚI
  // (không có `:id`), CHỈ 1 lần lúc mount. Để trống `batchId`/`batchNo` (bắt chọn lại lô mới —
  // tồn kho lúc "Sao chép" có thể đã khác lúc phiếu gốc được lập).
  useEffect(() => {
    if (isEdit) return;
    const copyFrom = (location.state as { copyFromIssue?: StockIssueDetail } | null)?.copyFromIssue;
    if (!copyFrom) return;
    setIssueType(copyFrom.issueType as ManualStockIssueType);
    setWarehouseId(copyFrom.warehouseId);
    setDepartmentId(copyFrom.departmentId ?? '');
    setSupplierId(copyFrom.supplierId ?? '');
    setSourceReceiptId(copyFrom.sourceReceiptId ?? '');
    setNote(copyFrom.note ?? '');
    setLines(
      copyFrom.lines.map((l) => ({
        key: makeKey(),
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        isBatchManaged: Boolean(l.batchNo),
        batchId: null,
        batchNo: '',
        expiryDate: '',
        availableQuantity: 0,
        quantity: String(l.quantity),
        returnUnitPrice: '',
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // "Công nợ nhà cung cấp" Phần C — chỉ NCC đang dùng, chỉ phiếu nhập PURCHASE ĐÃ DUYỆT của đúng
  // NCC đã chọn (khớp `validateReturnSupplierRefs()` backend).
  const isReturnToSupplier = issueType === 'RETURN_TO_SUPPLIER';
  const suppliersQuery = useSuppliersQuery(false);
  const sourceReceiptsQuery = useStockReceiptsQuery({ supplierId, receiptType: 'PURCHASE', status: 'POSTED', limit: 50 }, isReturnToSupplier && supplierId !== '');

  async function expandDrugToLines(drug: DrugSummary): Promise<DraftLine[]> {
    if (!drug.isBatchManaged) {
      const available = flatBalanceByDrugId.get(drug.id) ?? 0;
      // Không có dữ liệu giá vốn cho hàng KHÔNG quản lý theo lô ở tầng web (chỉ backend biết
      // `stock_balance.averageUnitCost`) — để trống, backend tự tính lúc lưu.
      return [{ key: makeKey(), drugId: drug.id, drugCode: drug.code, drugName: drug.name, isBatchManaged: false, batchId: null, batchNo: '', expiryDate: '', availableQuantity: available, quantity: '', returnUnitPrice: '' }];
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
        // "Công nợ nhà cung cấp" Phần C — chỉ mồi giá vốn lô khi RETURN_TO_SUPPLIER (giá vốn LUÔN
        // là fallback đúng của backend); loại phiếu khác không dùng tới trường này.
        returnUnitPrice: issueType === 'RETURN_TO_SUPPLIER' ? String(b.unitCost) : '',
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

  /** "Lưu" trên popup `StockIssueHeaderDialog` — commit field header vào state trang cha. Đổi/bỏ
   * "Phiếu nhập gốc" → giá trả mỗi dòng có thể đã sai (mồi theo phiếu gốc CŨ hoặc giá vốn lô) — xoá
   * về rỗng, backend tự tính lại đúng theo lựa chọn MỚI lúc lưu (Duyệt lô mockup #C mục 2). */
  function handleHeaderSave(values: StockIssueHeaderValues) {
    if (values.sourceReceiptId !== sourceReceiptId) {
      setLines((prev) => prev.map((l) => ({ ...l, returnUnitPrice: '' })));
    }
    setIssueType(values.issueType);
    setWarehouseId(values.warehouseId);
    setDepartmentId(values.departmentId);
    setSupplierId(values.supplierId);
    setSourceReceiptId(values.sourceReceiptId);
    setOccurredAt(values.occurredAt);
    setNote(values.note);
    setHeaderDialogOpen(false);
  }

  /** "Huỷ"/đóng popup — lần mở ĐẦU TIÊN lúc tạo phiếu mới (chưa từng chọn Kho) thì không có gì để
   * quay lại xem phía sau, điều hướng thẳng về danh sách; các lần mở lại sau (bấm "Sửa") chỉ đóng
   * popup, giữ nguyên dữ liệu đã có trên trang. */
  function handleHeaderCancel() {
    if (!isEdit && !warehouseId) navigate('/inventory/issues');
    else setHeaderDialogOpen(false);
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
    if (issueType === 'RETURN_TO_SUPPLIER' && !supplierId) {
      setFormError('Phiếu "Xuất trả nhà cung cấp" phải chọn Nhà cung cấp.');
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
      supplierId: issueType === 'RETURN_TO_SUPPLIER' ? supplierId : undefined,
      sourceReceiptId: issueType === 'RETURN_TO_SUPPLIER' && sourceReceiptId ? sourceReceiptId : undefined,
      occurredAt: `${occurredAt}T00:00:00+07:00`,
      note: note.trim(),
      lines: lines.map((l) => ({
        drugId: l.drugId,
        batchId: l.batchId ?? undefined,
        quantity: Number(l.quantity),
        returnUnitPrice: issueType === 'RETURN_TO_SUPPLIER' && l.returnUnitPrice.trim() !== '' ? Number(l.returnUnitPrice) : undefined,
      })),
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
  // `minmax(180px, Nfr)` (thay Nfr thuần) — đảm bảo cột tên không bị bóp dưới 180px khi khung hẹp,
  // đúng fix đã áp dụng ở `StockReceiptFormPage.tsx` (#194), phòng ngừa dù trang này chưa có cột
  // phải cạnh tranh không gian.
  const rowGridColumns = isReturnToSupplier
    ? readOnly
      ? 'minmax(180px, 1.6fr) 130px 110px 140px 140px'
      : 'minmax(180px, 1.6fr) 130px 110px 140px 140px 50px'
    : readOnly
      ? 'minmax(180px, 1.8fr) 150px 150px'
      : 'minmax(180px, 1.8fr) 150px 150px 50px';
  const returnTotalAmount = isReturnToSupplier && lines.every((l) => l.returnUnitPrice.trim() !== '') ? lines.reduce((sum, l) => sum + Number(l.returnUnitPrice) * Number(l.quantity || 0), 0) : null;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{readOnly ? 'Chi tiết phiếu xuất kho' : isEdit ? 'Sửa phiếu xuất kho' : 'Tạo phiếu xuất kho'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-bold text-slate-900">{readOnly ? issueQuery.data!.issueNo : isEdit ? 'Sửa phiếu Nháp' : 'Tạo phiếu xuất kho'}</h2>
          {isEdit && issueQuery.data && <StatusBadge tone={STATUS_META[issueQuery.data.status].tone}>{STATUS_META[issueQuery.data.status].label}</StatusBadge>}
          {isEdit && issueQuery.data && Boolean(issueQuery.data.supplierId) && <SupplierDebtAdjustmentBadge targetIssueId={issueQuery.data.id} />}
        </div>
        <div className="flex gap-2">
          {readOnly && isEdit && issueQuery.data?.status === 'DRAFT' && canApprove && (
            <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
              Từ chối
            </Button>
          )}
          {isEdit && issueQuery.data?.status === 'VOIDED' && canCreate && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/inventory/issues/manual/new', { state: { copyFromIssue: issueQuery.data } })}
            >
              <Copy size={15} weight="bold" aria-hidden="true" />
              Sao chép thành phiếu mới
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory/issues')}>
            ← Quay lại danh sách
          </Button>
        </div>
      </div>

      {/* Dải tóm tắt "Thông tin phiếu xuất kho" — thay khối ô nhập cố định trước đây (đúng mẫu
          `StockReceiptFormPage.tsx`). Nhập/sửa qua popup `StockIssueHeaderDialog`. */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <SummaryField label="Loại phiếu xuất" value={ISSUE_TYPE_OPTIONS.find((o) => o.value === issueType)?.label ?? '—'} />
          <SummaryField label="Kho xuất" value={warehouseOptions.find((w) => w.id === warehouseId)?.name ?? '—'} />
          {issueType === 'INTERNAL_ALLOCATION' && (
            <SummaryField label="Khoa/Phòng tiếp nhận" value={departmentsQuery.data?.items.find((d) => d.id === departmentId)?.name ?? '—'} />
          )}
          {isReturnToSupplier && <SummaryField label="Nhà cung cấp" value={suppliersQuery.data?.items.find((s) => s.id === supplierId)?.name ?? '—'} />}
          {isReturnToSupplier && sourceReceiptId && (
            <SummaryField label="Phiếu nhập gốc" value={sourceReceiptsQuery.data?.items.find((r) => r.id === sourceReceiptId)?.receiptNo ?? '—'} />
          )}
          <SummaryField label="Ngày xuất" value={occurredAt ? occurredAt.split('-').reverse().join('/') : '—'} />
          <SummaryField label="Lý do" value={note || '—'} />
        </div>
        {!readOnly && (
          <Button type="button" variant="secondary" onClick={() => setHeaderDialogOpen(true)}>
            <PencilSimple size={15} weight="bold" aria-hidden="true" />
            Sửa
          </Button>
        )}
      </div>

      {/* ============ Search-and-pick (chỉ khi còn Nháp) — style nổi bật đồng bộ với
          `StockReceiptFormPage.tsx` (phản hồi trực tiếp: áp dụng cách hiển thị ô tìm thuốc cho mọi
          giao diện đang dùng kiểu này trong Kho Thuốc). ============ */}
      {!readOnly && (
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-lg border-2 border-blue-200 bg-blue-50 p-3 shadow-sm">
          <div className="relative flex-1">
            <label htmlFor="issue-drug-search" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Thêm thuốc / vật tư vào phiếu
            </label>
            <div className="relative">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-500" aria-hidden="true" />
              <input
                id="issue-drug-search"
                type="text"
                value={drugQuery}
                disabled={!warehouseId}
                onChange={(e) => {
                  setDrugQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Gõ tên/mã/mã vạch mặt hàng tại Kho xuất — Enter/Tab để thêm nhanh..."
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

      {/* ============ Bảng dòng hàng ============ */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 ? (
          <EmptyState icon={MagnifyingGlass} title="Chưa có dòng hàng nào" description={readOnly ? 'Phiếu này không có dòng hàng.' : 'Gõ tên thuốc/vật tư ở ô trên để thêm dòng hàng.'} />
        ) : (
          <div role="table" aria-label="Dòng hàng xuất kho" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col">
              <div
                role="row"
                style={{ gridTemplateColumns: rowGridColumns }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="py-2.5 text-left">Lô / Hạn sử dụng (tại kho xuất)</div>
                <div role="columnheader" className="py-2.5 text-right">Tồn khả dụng</div>
                <div role="columnheader" className="py-2.5 text-center">SL xuất</div>
                {isReturnToSupplier && <div role="columnheader" className="py-2.5 text-right">Đơn giá trả</div>}
                {isReturnToSupplier && <div role="columnheader" className="py-2.5 text-right">Thành tiền</div>}
                {!readOnly && <div role="columnheader" className="py-2.5" />}
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lines.map((l) => {
                  const lineAmount = l.returnUnitPrice.trim() !== '' && l.quantity.trim() !== '' ? Number(l.returnUnitPrice) * Number(l.quantity) : null;
                  return (
                    <div key={l.key} role="row" style={{ gridTemplateColumns: rowGridColumns, minHeight: 52 }} className="grid items-center border-b border-slate-100 px-4 text-sm">
                      <div role="cell" className="min-w-0 truncate">
                        <span className="font-medium text-slate-900">{l.drugName}</span> <span className="text-xs font-medium text-slate-400">({l.drugCode})</span>
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
                      {isReturnToSupplier && (
                        <div role="cell" className="text-right">
                          {readOnly ? (
                            <span className="font-semibold tabular-nums text-slate-900">{l.returnUnitPrice ? Number(l.returnUnitPrice).toLocaleString('vi-VN') : '—'}</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              value={l.returnUnitPrice}
                              placeholder="Tự động"
                              onChange={(e) => updateLine(l.key, { returnUnitPrice: e.target.value })}
                              className="w-28 rounded-md border border-slate-300 px-1.5 py-1.5 text-right text-sm font-semibold text-slate-900"
                            />
                          )}
                        </div>
                      )}
                      {isReturnToSupplier && (
                        <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">
                          {lineAmount !== null ? lineAmount.toLocaleString('vi-VN') : <span className="font-normal text-slate-400">—</span>}
                        </div>
                      )}
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
              {isReturnToSupplier && (
                <div style={{ gridTemplateColumns: rowGridColumns }} className="grid flex-shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
                  <div className={readOnly ? 'col-span-3 text-right font-bold text-slate-600' : 'col-span-4 text-right font-bold text-slate-600'}>Giá trị trừ công nợ</div>
                  <div className="text-right font-bold text-blue-700">{returnTotalAmount !== null ? `${returnTotalAmount.toLocaleString('vi-VN')} đ` : '—'}</div>
                  {!readOnly && <div />}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isReturnToSupplier && !readOnly && (
        <p className="flex-shrink-0 text-xs text-slate-500">
          Để trống "Đơn giá trả" — hệ thống tự tính: theo <b>Phiếu nhập gốc</b> (sau chiết khấu) nếu đã chọn, không thì theo giá vốn lô. Luôn sửa được tay.
        </p>
      )}

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
          <PrintButton documentType="STOCK_ISSUE" className="ml-auto" onPrint={handlePrint}>In phiếu</PrintButton>
        )}
      </div>

      {printing && issueQuery.data && <StockIssuePrintView issue={issueQuery.data} />}

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

      {headerDialogOpen && (
        <StockIssueHeaderDialog
          initial={{ issueType, warehouseId, departmentId, supplierId, sourceReceiptId, occurredAt, note }}
          warehouseOptions={warehouseOptions.map((w) => ({ value: w.id, label: w.name }))}
          departmentOptions={(departmentsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
          supplierOptions={(suppliersQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
          warehouseLocked={lines.length > 0}
          allowSimpleClose={isEdit || Boolean(warehouseId)}
          onCancel={handleHeaderCancel}
          onSave={handleHeaderSave}
        />
      )}
    </div>
  );
}
