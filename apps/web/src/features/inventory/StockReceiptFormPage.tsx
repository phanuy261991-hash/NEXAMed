import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MagnifyingGlass, Plus, Trash, Warning } from '@phosphor-icons/react';
import type { CreateStockReceiptRequest, DrugSummary, StockReceiptLine, StockReceiptType } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { formatDobDisplay } from '../../shared/format/date';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useHasPermission } from '../auth/usePermission';
import { useDrugsQuery } from '../drug/drug.queries';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { useUnitNameByCode, unitLabel } from '../drug/useUnitNameByCode';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import {
  useApproveStockReceiptMutation,
  useCreateStockReceiptMutation,
  useStockReceiptQuery,
  useUpdateStockReceiptMutation,
} from './inventory.queries';

interface DraftLine {
  key: string;
  drugId: string;
  drugCode: string;
  drugName: string;
  isBatchManaged: boolean;
  /** Đơn vị có thể chọn cho dòng này — đúng chuỗi quy đổi của thuốc (base + drug_unit), KHÔNG cần
   * tính hệ số ở web (apps/web bị chặn import @nexamed/core, #073) — quy đổi thật do backend làm
   * lúc Duyệt, đây chỉ cần đúng DANH SÁCH mã đơn vị hợp lệ để chọn. */
  unitOptions: string[];
  unitCode: string;
  quantity: string;
  unitCost: number | undefined;
  batchNo: string;
  expiryDate: string;
}

const STATUS_META: Record<string, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

const RECEIPT_TYPE_OPTIONS: ComboboxOption[] = [
  { value: 'PURCHASE', label: 'Nhập nhà cung cấp' },
  { value: 'OPENING_BALANCE', label: 'Nhập khởi tạo (Đầu kỳ)' },
];

function unitOptionsFor(drug: DrugSummary): string[] {
  const options = [drug.baseUnitCode, ...drug.units.map((u) => u.unitCode)].filter((u): u is string => Boolean(u));
  return [...new Set(options)];
}

function makeKey(): string {
  return Math.random().toString(36).slice(2);
}

function todayVn(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * "Tạo phiếu nhập kho" / "Sửa Nháp" / "Xem chi tiết" — Kho Thuốc GĐ2 (docs/DECISIONS.md #146,
 * mockup precious-humming-goblet.md). TRANG RIÊNG (không modal, theo phản hồi "khung nhỏ khó
 * nhìn" lúc duyệt mockup) — dùng CHUNG 1 component cho cả 3 chế độ theo trạng thái phiếu: không có
 * `:id` → Tạo mới; có `:id` + `status=DRAFT` → Sửa; có `:id` + trạng thái khác → chỉ xem.
 */
export function StockReceiptFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const canApprove = useHasPermission('stock_receipt', 'approve');

  const receiptQuery = useStockReceiptQuery(id ?? '', isEdit);
  const warehousesQuery = useWarehousesQuery();
  const suppliersQuery = useSuppliersQuery();
  const unitNameByCode = useUnitNameByCode();
  const createMutation = useCreateStockReceiptMutation();
  const updateMutation = useUpdateStockReceiptMutation();
  const approveMutation = useApproveStockReceiptMutation();

  const readOnly = isEdit && receiptQuery.data !== undefined && receiptQuery.data.status !== 'DRAFT';

  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [receiptType, setReceiptType] = useState<StockReceiptType>('PURCHASE');
  const [occurredAt, setOccurredAt] = useState(todayVn());
  const [note, setNote] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useBreadcrumb([
    { label: 'Quản lý kho' },
    { label: 'Phiếu nhập kho', to: '/inventory/receipts' },
    { label: readOnly ? 'Chi tiết' : isEdit ? 'Sửa Nháp' : 'Tạo phiếu' },
  ]);

  // Nạp dữ liệu phiếu đã có (Sửa/Xem) vào state form — chỉ chạy 1 lần khi dữ liệu về.
  useEffect(() => {
    if (!receiptQuery.data) return;
    const r = receiptQuery.data;
    setWarehouseId(r.warehouseId);
    setSupplierId(r.supplierId ?? '');
    setReceiptType(r.receiptType);
    setOccurredAt(r.occurredAt.slice(0, 10));
    setNote(r.note ?? '');
    setSupplierInvoiceNo(r.supplierInvoiceNo ?? '');
    setLines(
      r.lines.map((l: StockReceiptLine) => ({
        key: l.id,
        drugId: l.drugId,
        drugCode: l.drugCode,
        drugName: l.drugName,
        isBatchManaged: Boolean(l.batchNo),
        unitOptions: [l.unitCode],
        unitCode: l.unitCode,
        quantity: String(l.quantity),
        unitCost: l.unitCost,
        batchNo: l.batchNo ?? '',
        expiryDate: l.expiryDate ?? '',
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptQuery.data?.id]);

  const debouncedDrugQuery = useDebouncedValue(drugQuery, 300);
  // Gate hiện/ẩn dropdown theo `drugQuery` (tức thời), KHÔNG theo `debouncedDrugQuery` — bug thật
  // phát hiện lúc chủ dự án dùng thử: `addLine()` xoá `drugQuery` ngay nhưng `debouncedDrugQuery`
  // còn giữ giá trị cũ tới 300ms sau, khiến dropdown kết quả cũ còn hiện thêm 1 khoảng ngắn sau khi
  // đã thêm dòng — bấm thêm lần nữa trong khoảng đó tạo ra 2 dòng trùng cùng 1 thuốc.
  const isSearchingDrug = drugQuery.trim() !== '';
  const drugSearchQuery = useDrugsQuery({ q: debouncedDrugQuery.trim() || undefined });
  const searchResults = isSearchingDrug ? (drugSearchQuery.data?.items ?? []) : [];

  const totalAmount = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (l.unitCost ?? 0), 0), [lines]);

  // Nhóm theo `drugId` để hiện 1 dòng tiêu đề sản phẩm + N dòng lô bên dưới (thay vì liệt kê phẳng
  // từng lô lặp lại tên sản phẩm) — `Map` giữ đúng thứ tự thêm vào lần đầu, đúng chốt thiết kế trực
  // tiếp với chủ dự án: hàng quản lý theo lô thật sự cần nhiều lô/phiếu (khác Số lô/Hạn dùng), gộp
  // cứng theo mã sẽ chặn nhầm tình huống đó.
  const lineGroups = useMemo(() => {
    const map = new Map<string, DraftLine[]>();
    for (const l of lines) {
      const arr = map.get(l.drugId);
      if (arr) arr.push(l);
      else map.set(l.drugId, [l]);
    }
    return [...map.values()];
  }, [lines]);

  function addLine(drug: DrugSummary) {
    const alreadyAdded = lines.some((l) => l.drugId === drug.id);
    if (alreadyAdded && !drug.isBatchManaged) {
      // Hàng KHÔNG quản lý theo lô — không có gì phân biệt 2 dòng cùng mã, bỏ qua thay vì tạo dòng
      // thừa (bug thật: dropdown kết quả tìm kiếm không ẩn kịp, bấm trùng lần nữa tạo 2 dòng giống
      // hệt nhau). Hàng CÓ quản lý theo lô vẫn cho thêm — xem `addBatchLine`.
      setDrugQuery('');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: makeKey(),
        drugId: drug.id,
        drugCode: drug.code,
        drugName: drug.name,
        isBatchManaged: drug.isBatchManaged,
        unitOptions: unitOptionsFor(drug),
        unitCode: drug.baseUnitCode ?? unitOptionsFor(drug)[0] ?? '',
        quantity: '',
        unitCost: undefined,
        batchNo: '',
        expiryDate: '',
      },
    ]);
    setDrugQuery('');
  }

  /** Nút "+" trên dòng tiêu đề sản phẩm (chỉ hiện khi `isBatchManaged`) — thêm 1 dòng lô mới cho
   * ĐÚNG sản phẩm đã có trong bảng, không cần gõ tìm lại. */
  function addBatchLine(groupDrugId: string) {
    setLines((prev) => {
      const template = prev.find((l) => l.drugId === groupDrugId);
      if (!template) return prev;
      return [
        ...prev,
        {
          key: makeKey(),
          drugId: template.drugId,
          drugCode: template.drugCode,
          drugName: template.drugName,
          isBatchManaged: template.isBatchManaged,
          unitOptions: template.unitOptions,
          unitCode: template.unitCode,
          quantity: '',
          unitCost: undefined,
          batchNo: '',
          expiryDate: '',
        },
      ];
    });
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function buildPayload(): CreateStockReceiptRequest | null {
    if (!warehouseId) {
      setFormError('Phải chọn Kho.');
      return null;
    }
    if (receiptType === 'PURCHASE' && !supplierId) {
      setFormError('Phiếu nhập nhà cung cấp phải chọn Nhà cung cấp.');
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
      if (l.unitCost === undefined) {
        setFormError(`Dòng "${l.drugName}" thiếu giá vốn.`);
        return null;
      }
      if (l.isBatchManaged && !l.batchNo.trim()) {
        setFormError(`Dòng "${l.drugName}" quản lý theo lô — phải nhập Số lô.`);
        return null;
      }
    }
    setFormError(null);
    return {
      warehouseId,
      supplierId: receiptType === 'PURCHASE' ? supplierId : undefined,
      receiptType,
      occurredAt: `${occurredAt}T00:00:00+07:00`,
      note: note || undefined,
      supplierInvoiceNo: supplierInvoiceNo || undefined,
      lines: lines.map((l) => ({
        drugId: l.drugId,
        unitCode: l.unitCode,
        quantity: Number(l.quantity),
        unitCost: l.unitCost!,
        batchNo: l.batchNo || undefined,
        expiryDate: l.expiryDate || undefined,
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
        const updated = await updateMutation.mutateAsync({ id, body: { ...payload, version: receiptQuery.data!.version } });
        savedVersion = updated.version;
      } else {
        const created = await createMutation.mutateAsync(payload);
        savedId = created.id;
        savedVersion = created.version;
      }
      if (andApprove && savedId) {
        await approveMutation.mutateAsync({ id: savedId, body: { version: savedVersion } });
      }
      navigate('/inventory/receipts');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Lưu phiếu thất bại, vui lòng thử lại.');
    }
  }

  if (isEdit && receiptQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (isEdit && receiptQuery.isError) {
    return <ErrorBanner message={receiptQuery.error instanceof ApiError ? receiptQuery.error.message : 'Không tải được phiếu.'} onRetry={() => void receiptQuery.refetch()} />;
  }

  const saving = createMutation.isPending || updateMutation.isPending || approveMutation.isPending;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">{readOnly ? 'Chi tiết phiếu nhập kho' : isEdit ? 'Sửa phiếu nhập kho' : 'Tạo phiếu nhập kho'}</h1>

      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-bold text-slate-900">{readOnly ? receiptQuery.data!.receiptNo : isEdit ? 'Sửa phiếu Nháp' : 'Tạo phiếu nhập kho'}</h2>
          {isEdit && receiptQuery.data && <StatusBadge tone={STATUS_META[receiptQuery.data.status]!.tone}>{STATUS_META[receiptQuery.data.status]!.label}</StatusBadge>}
        </div>
        <Button type="button" variant="secondary" onClick={() => navigate('/inventory/receipts')}>
          ← Quay lại danh sách
        </Button>
      </div>

      {/* Khối header — 1 hàng ngang gọn theo mockup. */}
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Loại phiếu <span className="text-rose-500">*</span>
          </label>
          <Combobox
            id="receipt-type"
            value={receiptType}
            disabled={readOnly}
            onChange={(v) => setReceiptType(v as StockReceiptType)}
            options={RECEIPT_TYPE_OPTIONS}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Kho <span className="text-rose-500">*</span>
          </label>
          <Combobox
            id="receipt-warehouse"
            value={warehouseId}
            disabled={readOnly}
            onChange={setWarehouseId}
            placeholder="— Chọn kho —"
            options={(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
        </div>
        {receiptType === 'PURCHASE' && (
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Nhà cung cấp <span className="text-rose-500">*</span>
            </label>
            <Combobox
              id="receipt-supplier"
              value={supplierId}
              disabled={readOnly}
              onChange={setSupplierId}
              placeholder="— Chọn NCC —"
              options={(suppliersQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        )}
        {receiptType === 'PURCHASE' && (
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">Mã hoá đơn NCC</label>
            <input
              type="text"
              value={supplierInvoiceNo}
              disabled={readOnly}
              onChange={(e) => setSupplierInvoiceNo(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            Ngày nhập <span className="text-rose-500">*</span>
          </label>
          <DateInput id="receipt-occurred-at" value={occurredAt} onChange={setOccurredAt} disabled={readOnly} required />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-semibold text-slate-800">Ghi chú</label>
          <input
            type="text"
            value={note}
            disabled={readOnly}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
          />
        </div>
      </div>

      {!readOnly && (
        <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={drugQuery}
              onChange={(e) => setDrugQuery(e.target.value)}
              placeholder="Gõ tên/mã thuốc, vật tư để thêm dòng hàng..."
              className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {isSearchingDrug && (
            <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto scroll-hover">
              {searchResults.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Không tìm thấy thuốc/vật tư nào khớp.</p>}
              {searchResults.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => addLine(d)}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-400 hover:bg-brand-teal-tint"
                >
                  <span>
                    <span className="font-bold text-slate-900">{d.name}</span>
                    <span className="ml-1.5 text-slate-500">({d.code})</span>
                  </span>
                  <Plus size={15} weight="bold" className="text-blue-600" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {lines.length === 0 ? (
          <EmptyState icon={Warning} title="Chưa có dòng hàng nào" description={readOnly ? 'Phiếu này không có dòng hàng.' : 'Gõ tên thuốc/vật tư ở ô trên để thêm dòng hàng.'} />
        ) : (
          <div role="table" aria-label="Dòng hàng" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 900 }}>
              <div
                role="row"
                style={{ gridTemplateColumns: readOnly ? '1.8fr 100px 110px 130px 130px 130px 130px' : '1.8fr 100px 110px 130px 130px 130px 130px 50px' }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="py-2.5 text-left">Thuốc / vật tư</div>
                <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                <div role="columnheader" className="py-2.5 text-center">Số lượng</div>
                <div role="columnheader" className="py-2.5 text-center">Giá vốn</div>
                <div role="columnheader" className="py-2.5 text-center">Số lô</div>
                <div role="columnheader" className="py-2.5 text-center">Hạn dùng</div>
                <div role="columnheader" className="py-2.5 text-center">Thành tiền</div>
                {!readOnly && <div role="columnheader" className="py-2.5" />}
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lineGroups.map((group) => {
                  const head = group[0]!;
                  return (
                    <div key={head.drugId}>
                      <div
                        role="row"
                        style={{ gridTemplateColumns: readOnly ? '1.8fr 100px 110px 130px 130px 130px 130px' : '1.8fr 100px 110px 130px 130px 130px 130px 50px', minHeight: 40 }}
                        className="grid items-center border-b border-slate-100 bg-slate-50/70 px-4 text-sm"
                      >
                        <div role="cell" className="min-w-0 truncate font-bold text-slate-900" title={head.drugName}>
                          {head.drugName} <span className="text-xs font-medium text-slate-400">({head.drugCode})</span>
                          {group.length > 1 && <span className="ml-1.5 text-xs font-semibold text-blue-600">· {group.length} lô</span>}
                        </div>
                        <div role="cell" className="col-span-6" />
                        {!readOnly && (
                          <div role="cell" className="text-center">
                            {head.isBatchManaged && (
                              <button
                                type="button"
                                onClick={() => addBatchLine(head.drugId)}
                                aria-label={`Thêm lô cho ${head.drugName}`}
                                title="Thêm lô"
                                className="rounded-full p-1 text-blue-600 hover:bg-blue-50"
                              >
                                <Plus size={15} weight="bold" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {group.map((l) => (
                        <div
                          key={l.key}
                          role="row"
                          style={{ gridTemplateColumns: readOnly ? '1.8fr 100px 110px 130px 130px 130px 130px' : '1.8fr 100px 110px 130px 130px 130px 130px 50px', minHeight: 56 }}
                          className="grid items-center border-b border-slate-100 px-4 text-sm"
                        >
                          <div role="cell" className="min-w-0 pl-3 text-slate-300">↳</div>
                          <div role="cell" className="px-1">
                            {readOnly ? (
                              <div className="text-center">{unitLabel(unitNameByCode, l.unitCode)}</div>
                            ) : (
                              <Combobox
                                id={`unit-${l.key}`}
                                value={l.unitCode}
                                onChange={(v) => updateLine(l.key, { unitCode: v })}
                                options={l.unitOptions.map((u) => ({ value: u, label: unitLabel(unitNameByCode, u) }))}
                              />
                            )}
                          </div>
                          <div role="cell" className="px-1">
                            {readOnly ? (
                              <div className="text-center tabular-nums">{l.quantity}</div>
                            ) : (
                              <input
                                type="number"
                                min={1}
                                value={l.quantity}
                                onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                                className="w-full rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                              />
                            )}
                          </div>
                          <div role="cell" className="px-1">
                            {readOnly ? (
                              <div className="text-center tabular-nums">{formatVnd(l.unitCost ?? 0)}</div>
                            ) : (
                              <MoneyInput
                                id={`unit-cost-${l.key}`}
                                value={l.unitCost}
                                onChange={(v) => updateLine(l.key, { unitCost: v })}
                                className="w-full rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                              />
                            )}
                          </div>
                          <div role="cell" className="px-1">
                            {readOnly ? (
                              <div className="text-center">{l.batchNo || '—'}</div>
                            ) : (
                              <input
                                type="text"
                                value={l.batchNo}
                                onChange={(e) => updateLine(l.key, { batchNo: e.target.value })}
                                className="w-full rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                              />
                            )}
                          </div>
                          <div role="cell" className="px-1">
                            {readOnly ? (
                              <div className="text-center">{l.expiryDate ? formatDobDisplay(l.expiryDate) : '—'}</div>
                            ) : (
                              <DateInput id={`expiry-${l.key}`} value={l.expiryDate} onChange={(v) => updateLine(l.key, { expiryDate: v })} dense />
                            )}
                          </div>
                          <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">
                            {formatVnd((Number(l.quantity) || 0) * (l.unitCost ?? 0))}
                          </div>
                          {!readOnly && (
                            <div role="cell" className="text-center">
                              <button type="button" onClick={() => removeLine(l.key)} aria-label={`Xoá dòng ${l.drugName}`} className="text-rose-500 hover:text-rose-700">
                                <Trash size={16} weight="bold" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-slate-600">
          Tổng cộng: <span className="ml-1 text-lg font-bold text-slate-900">{formatVnd(totalAmount)}</span>
        </div>
        {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
        {!readOnly && (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" loading={saving} onClick={() => void handleSave(false)}>
              Lưu nháp
            </Button>
            {canApprove && (
              <Button type="button" loading={saving} onClick={() => void handleSave(true)}>
                Lưu &amp; Duyệt ngay
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
