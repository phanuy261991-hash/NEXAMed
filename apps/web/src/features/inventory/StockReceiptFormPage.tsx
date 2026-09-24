import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CaretDown, CaretRight, MagnifyingGlass, Plus, Printer, Trash, Warning } from '@phosphor-icons/react';
import type { CreateStockReceiptRequest, DiscountType, DrugSummary, StockReceiptLine, StockReceiptType } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { formatVnd } from '../../shared/format/currency';
import { formatDobDisplay } from '../../shared/format/date';
import { useCollapsedGroups } from '../../shared/hooks/useCollapsedGroups';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
import { useCashAccountsQuery } from '../cash-book/cash-account.queries';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { useDrugsQuery } from '../drug/drug.queries';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { useUnitNameByCode, unitLabel } from '../drug/useUnitNameByCode';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useSupplierDebtSummaryQuery } from '../supplier-debt/supplier-debt.queries';
import {
  useApproveStockReceiptMutation,
  useCreateStockReceiptMutation,
  useStockReceiptQuery,
  useUpdateStockReceiptMutation,
} from './inventory.queries';
import { StockReceiptPrintView } from './StockReceiptPrintView';

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
  /** Chiết khấu "Từng dòng" (Kho Thuốc GĐ4, "Phiếu nhập kho mở rộng", docs/DECISIONS.md #170) — CHỈ
   * có ý nghĩa khi `receiptType='PURCHASE'` VÀ chế độ chiết khấu đang là "Từng dòng". */
  discountValue: string;
}

const STATUS_META: Record<string, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

const RECEIPT_TYPE_OPTIONS: ComboboxOption[] = [
  { value: 'PURCHASE', label: 'Nhập nhà cung cấp' },
  { value: 'OPENING_BALANCE', label: 'Nhập khởi tạo (Đầu kỳ)' },
  { value: 'RETURN_FROM_USE', label: 'Nhập hoàn trả từ bệnh nhân/khoa phòng' },
];

const DISCOUNT_MODE_OPTIONS = [
  { value: 'PER_LINE', label: 'Từng dòng' },
  { value: 'TOTAL', label: 'Toàn phiếu' },
] as const;

const DISCOUNT_TYPE_OPTIONS = [
  { value: 'PERCENT', label: '%' },
  { value: 'AMOUNT', label: 'Số tiền' },
] as const;

/** Chiết khấu — hàm THUẦN nhỏ khai RIÊNG ở đây (không import `computeDiscountAmount` từ
 * `@nexamed/core`, apps/web bị chặn import gói này #073) — chỉ dùng để XEM TRƯỚC lúc còn đang sửa
 * Nháp, số thật luôn do backend tính lại (`computeInvoiceDiscount()`) lúc lưu. PERCENT: luôn 0-100
 * (ép ở input), AMOUNT: clamp về [0, base] tránh xem trước ra số âm. */
function previewDiscountAmount(base: number, type: 'PERCENT' | 'AMOUNT' | null, value: number): number {
  if (!type || !value) return 0;
  const raw = type === 'PERCENT' ? Math.round((base * value) / 100) : value;
  return Math.min(Math.max(raw, 0), base);
}

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
  // Phân quyền theo Khoa/Phòng (retrofit #173/#177) — đúng khuôn `StockCountFormPage.tsx`. Backend
  // LUÔN enforce lại (404 nếu chọn sai kho) — lọc ở đây thuần UX, tránh hiện lựa chọn chắc chắn bị chặn.
  const createDataScope = useDataScope('stock_receipt', 'create');
  const actorDepartmentId = useActorDepartmentId();
  const isDepartmentScoped = createDataScope === 'department';
  const suppliersQuery = useSuppliersQuery();
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();
  const unitNameByCode = useUnitNameByCode();
  const clinicQuery = useClinicPrintHeaderQuery();
  const createMutation = useCreateStockReceiptMutation();
  const updateMutation = useUpdateStockReceiptMutation();
  const approveMutation = useApproveStockReceiptMutation();

  const readOnly = isEdit && receiptQuery.data !== undefined && receiptQuery.data.status !== 'DRAFT';

  const [printing, setPrinting] = useState(false);
  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [receiptType, setReceiptType] = useState<StockReceiptType>('PURCHASE');
  const [occurredAt, setOccurredAt] = useState(todayVn());
  const [note, setNote] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drugQuery, setDrugQuery] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // Chiết khấu (Kho Thuốc GĐ4, "Phiếu nhập kho mở rộng", docs/DECISIONS.md #170) — CHỈ có ý nghĩa
  // khi `receiptType='PURCHASE'`. `null` = CHƯA chọn cách nào (đúng mục 4.1c ui-guidelines — không
  // tô sẵn lựa chọn mặc định), đúng khuôn `discountEditMode` ở `InvoiceDetailPage.tsx` (#137).
  const [discountMode, setDiscountMode] = useState<'PER_LINE' | 'TOTAL' | null>(null);
  const [totalDiscountType, setTotalDiscountType] = useState<DiscountType>('PERCENT');
  const [totalDiscountValue, setTotalDiscountValue] = useState<number | undefined>(undefined);
  // "Lý do" KHÔNG nạp sẵn giá trị cũ khi mở lại phiếu (đúng #137) — luôn gõ mới mỗi lần sửa.
  const [totalDiscountReason, setTotalDiscountReason] = useState('');
  // "Trả ngay" cho NCC (Công nợ nhà cung cấp, docs/DECISIONS.md #180/#182) — CHỈ có ý nghĩa khi
  // `receiptType='PURCHASE'`. Mặc định 0 = ghi nợ hết (giá trị số thật, không phải chip tô sẵn —
  // đúng mockup màn 5, `https://claude.ai/artifact/WvZtCgwbdEKAb9LcCzyCfh`).
  const [prepaidAmount, setPrepaidAmount] = useState<number | undefined>(0);
  const [prepaidPaymentMethodCode, setPrepaidPaymentMethodCode] = useState('');
  const [prepaidCashAccountId, setPrepaidCashAccountId] = useState('');

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
        discountValue: l.discountValue != null ? String(l.discountValue) : '',
      })),
    );
    setDiscountMode(r.discountMode === 'TOTAL' ? 'TOTAL' : 'PER_LINE');
    setTotalDiscountType(r.discountType ?? 'PERCENT');
    setTotalDiscountValue(r.discountValue ?? undefined);
    setTotalDiscountReason(r.discountReason ?? '');
    setPrepaidAmount(r.prepaidAmount);
    setPrepaidPaymentMethodCode(r.prepaidPaymentMethodCode ?? '');
    setPrepaidCashAccountId(r.prepaidCashAccountId ?? '');
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

  // Chiết khấu — xem trước CLIENT-SIDE (số thật do backend tính lại lúc lưu, `computeInvoiceDiscount()`).
  const hasLineDiscount = receiptType === 'PURCHASE' && discountMode === 'PER_LINE' && lines.some((l) => Number(l.discountValue) > 0);
  const discountAmount = useMemo(() => {
    if (receiptType !== 'PURCHASE') return 0;
    if (discountMode === 'PER_LINE') {
      return lines.reduce((sum, l) => {
        const lineAmount = (Number(l.quantity) || 0) * (l.unitCost ?? 0);
        return sum + previewDiscountAmount(lineAmount, Number(l.discountValue) > 0 ? 'PERCENT' : null, Number(l.discountValue) || 0);
      }, 0);
    }
    return previewDiscountAmount(totalAmount, totalDiscountType, totalDiscountValue ?? 0);
  }, [receiptType, discountMode, lines, totalAmount, totalDiscountType, totalDiscountValue]);
  const netAmount = totalAmount - discountAmount;

  // "Thanh toán" (mới, #180/#182) — chỉ có ý nghĩa khi Loại phiếu = Nhập nhà cung cấp + đã chọn NCC.
  const showPaymentSection = receiptType === 'PURCHASE' && Boolean(supplierId);
  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);
  const supplierDebtSummaryQuery = useSupplierDebtSummaryQuery(supplierId, showPaymentSection);
  const currentDebtBalance = supplierDebtSummaryQuery.data?.balance ?? 0;
  const remainingToDebt = netAmount - (prepaidAmount ?? 0);
  const prepaidExceedsPayable = (prepaidAmount ?? 0) > netAmount;

  // Nhóm theo `drugId` để hiện 1 dòng tiêu đề sản phẩm + N dòng lô bên dưới (thay vì liệt kê phẳng
  // từng lô lặp lại tên sản phẩm) — `Map` giữ đúng thứ tự thêm vào lần đầu, đúng chốt thiết kế trực
  // tiếp với chủ dự án: hàng quản lý theo lô thật sự cần nhiều lô/phiếu (khác Số lô/Hạn dùng), gộp
  // cứng theo mã sẽ chặn nhầm tình huống đó.
  const { isCollapsed, toggle: toggleGroup } = useCollapsedGroups();

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
        discountValue: '',
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
          discountValue: '',
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
    const useTotalDiscount = receiptType === 'PURCHASE' && discountMode === 'TOTAL' && !hasLineDiscount;
    if (useTotalDiscount && totalDiscountValue) {
      if (!totalDiscountReason.trim()) {
        setFormError('Phải nhập lý do chiết khấu.');
        return null;
      }
      if (totalDiscountType === 'PERCENT' && totalDiscountValue > 100) {
        setFormError('Chiết khấu theo % không vượt quá 100.');
        return null;
      }
    }
    const usePrepaid = receiptType === 'PURCHASE' && (prepaidAmount ?? 0) > 0;
    if (usePrepaid) {
      if ((prepaidAmount ?? 0) > netAmount) {
        setFormError('Số tiền "Trả ngay" không được vượt quá tiền phải trả NCC.');
        return null;
      }
      if (!prepaidPaymentMethodCode) {
        setFormError('Phải chọn Phương thức thanh toán khi có "Trả ngay".');
        return null;
      }
      if (!prepaidCashAccountId) {
        setFormError('Phải chọn Quỹ chi khi có "Trả ngay".');
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
      discountType: useTotalDiscount && totalDiscountValue ? totalDiscountType : undefined,
      discountValue: useTotalDiscount && totalDiscountValue ? totalDiscountValue : undefined,
      discountReason: useTotalDiscount && totalDiscountValue ? totalDiscountReason.trim() : undefined,
      prepaidAmount: usePrepaid ? prepaidAmount : undefined,
      prepaidPaymentMethodCode: usePrepaid ? prepaidPaymentMethodCode : undefined,
      prepaidCashAccountId: usePrepaid ? prepaidCashAccountId : undefined,
      lines: lines.map((l) => ({
        drugId: l.drugId,
        unitCode: l.unitCode,
        quantity: Number(l.quantity),
        unitCost: l.unitCost!,
        batchNo: l.batchNo || undefined,
        expiryDate: l.expiryDate || undefined,
        discountType: receiptType === 'PURCHASE' && discountMode === 'PER_LINE' && Number(l.discountValue) > 0 ? ('PERCENT' as const) : undefined,
        discountValue: receiptType === 'PURCHASE' && discountMode === 'PER_LINE' && Number(l.discountValue) > 0 ? Number(l.discountValue) : undefined,
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
  // Cột "Chiết khấu" trong bảng dòng hàng — CHỈ hiện khi chế độ "Từng dòng" đang chọn, đúng khuôn
  // cột "Chiết khấu" của `InvoiceDetailPage.tsx` (chỉ hiện khi `discountEditMode==='PER_LINE'`).
  const showLineDiscountCol = receiptType === 'PURCHASE' && discountMode === 'PER_LINE';
  const lineGridCols = ['1.8fr', '100px', '110px', '130px', '130px', '130px', ...(showLineDiscountCol ? ['110px'] : []), '130px', ...(!readOnly ? ['50px'] : [])].join(' ');

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
            options={(warehousesQuery.data?.items ?? [])
              .filter((w) => !isDepartmentScoped || w.departmentId === actorDepartmentId)
              .map((w) => ({ value: w.id, label: w.name }))}
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

      {/* ============ Chiết khấu (Kho Thuốc GĐ4, docs/DECISIONS.md #170) + Thanh toán (Công nợ nhà
          cung cấp, #180/#182) — CHỈ hiện với loại phiếu "Nhập nhà cung cấp" (đúng mockup màn 5,
          `https://claude.ai/artifact/WvZtCgwbdEKAb9LcCzyCfh`). ============ */}
      {receiptType === 'PURCHASE' && (
        <div className="grid flex-shrink-0 grid-cols-1 gap-3 lg:grid-cols-[1fr_1.35fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Chiết khấu</span>
              {!readOnly && <TwoOptionToggle options={DISCOUNT_MODE_OPTIONS} value={discountMode} onChange={setDiscountMode} />}
              {readOnly && discountMode && <span className="text-xs font-semibold text-slate-600">{DISCOUNT_MODE_OPTIONS.find((o) => o.value === discountMode)?.label}</span>}
            </div>
            {discountMode === 'TOTAL' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Cách tính</label>
                  <TwoOptionToggle options={DISCOUNT_TYPE_OPTIONS} value={totalDiscountType} disabled={readOnly} onChange={(v) => v && setTotalDiscountType(v)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Giá trị</label>
                  {totalDiscountType === 'PERCENT' ? (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={readOnly}
                      value={totalDiscountValue ?? ''}
                      onChange={(e) => setTotalDiscountValue(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
                    />
                  ) : (
                    <MoneyInput id="receipt-total-discount-value" value={totalDiscountValue} onChange={setTotalDiscountValue} disabled={readOnly} />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">
                    Lý do <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={totalDiscountReason}
                    disabled={readOnly}
                    onChange={(e) => setTotalDiscountReason(e.target.value)}
                    placeholder="Vd: chiết khấu đơn hàng lớn"
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
                  />
                </div>
              </div>
            ) : discountMode === 'PER_LINE' ? (
              <p className="text-xs text-slate-500">Nhập trực tiếp % chiết khấu ở cột "Chiết khấu" trong bảng mặt hàng bên dưới.</p>
            ) : null}
          </div>

          {showPaymentSection && (
            <BoxedSection badge="Thanh toán">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Trả ngay cho NCC</label>
                  <MoneyInput
                    id="receipt-prepaid-amount"
                    value={prepaidAmount}
                    onChange={setPrepaidAmount}
                    disabled={readOnly}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50"
                  />
                  {!readOnly && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPrepaidAmount(0)}
                        className="rounded-full border-2 border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition-colors hover:border-blue-400 hover:bg-brand-teal-tint"
                      >
                        Không trả (ghi nợ hết)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrepaidAmount(netAmount)}
                        className="rounded-full border-2 border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition-colors hover:border-blue-400 hover:bg-brand-teal-tint"
                      >
                        Trả hết {formatVnd(netAmount)}
                      </button>
                    </div>
                  )}
                  {prepaidExceedsPayable && <p className="mt-1.5 text-xs font-semibold text-rose-600">Số tiền trả ngay không được vượt quá tiền phải trả NCC.</p>}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">
                    Phương thức {(prepaidAmount ?? 0) > 0 && <span className="text-rose-500">*</span>}
                  </label>
                  <Combobox
                    id="receipt-prepaid-payment-method"
                    value={prepaidPaymentMethodCode}
                    onChange={setPrepaidPaymentMethodCode}
                    disabled={readOnly}
                    placeholder="— Chọn —"
                    options={paymentMethods.map((m) => ({ value: m.code, label: m.name }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">
                    Quỹ chi {(prepaidAmount ?? 0) > 0 && <span className="text-rose-500">*</span>}
                  </label>
                  <Combobox
                    id="receipt-prepaid-cash-account"
                    value={prepaidCashAccountId}
                    onChange={setPrepaidCashAccountId}
                    disabled={readOnly}
                    placeholder="— Chọn —"
                    options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </div>
              </div>
              <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                <div className="flex justify-between gap-3 font-semibold text-blue-900">
                  <span>Ghi vào công nợ NCC</span>
                  <span className="text-lg font-bold">{formatVnd(Math.max(remainingToDebt, 0))}</span>
                </div>
                <div className="mt-0.5 flex justify-between gap-3 text-xs font-medium text-blue-800">
                  <span>Công nợ hiện tại {formatVnd(currentDebtBalance)} → sau khi Duyệt phiếu</span>
                  <span className="font-bold">{formatVnd(currentDebtBalance + Math.max(remainingToDebt, 0))}</span>
                </div>
              </div>
            </BoxedSection>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={drugQuery}
              onChange={(e) => setDrugQuery(e.target.value)}
              placeholder="Gõ tên/mã/mã vạch thuốc, vật tư để thêm dòng hàng..."
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
                style={{ gridTemplateColumns: lineGridCols }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="py-2.5 text-left">Thuốc / vật tư</div>
                <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                <div role="columnheader" className="py-2.5 text-center">Số lượng</div>
                <div role="columnheader" className="py-2.5 text-center">Giá vốn</div>
                <div role="columnheader" className="py-2.5 text-center">Số lô</div>
                <div role="columnheader" className="py-2.5 text-center">Hạn dùng</div>
                {showLineDiscountCol && <div role="columnheader" className="py-2.5 text-center">Chiết khấu</div>}
                <div role="columnheader" className="py-2.5 text-center">Thành tiền</div>
                {!readOnly && <div role="columnheader" className="py-2.5" />}
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {lineGroups.map((group) => {
                  const head = group[0]!;
                  const collapsible = group.length > 1;
                  const collapsed = collapsible && isCollapsed(head.drugId);
                  return (
                    <div key={head.drugId}>
                      <div
                        role="row"
                        style={{ gridTemplateColumns: lineGridCols, minHeight: 40 }}
                        className="grid items-center border-b border-slate-100 bg-slate-50/70 px-4 text-sm"
                      >
                        <div role="cell" className="flex min-w-0 items-center gap-1.5 truncate font-bold text-slate-900" title={head.drugName}>
                          {collapsible && (
                            <button
                              type="button"
                              onClick={() => toggleGroup(head.drugId)}
                              aria-label={collapsed ? `Xổ ra ${head.drugName}` : `Thu gọn ${head.drugName}`}
                              aria-expanded={!collapsed}
                              className="flex-shrink-0 text-slate-400 hover:text-slate-700"
                            >
                              {collapsed ? <CaretRight size={13} weight="bold" aria-hidden="true" /> : <CaretDown size={13} weight="bold" aria-hidden="true" />}
                            </button>
                          )}
                          <span className="truncate">
                            {head.drugName} <span className="text-xs font-medium text-slate-400">({head.drugCode})</span>
                          </span>
                          {collapsible && <span className="flex-shrink-0 text-xs font-semibold text-blue-600">· {group.length} lô</span>}
                        </div>
                        <div role="cell" style={{ gridColumn: `span ${showLineDiscountCol ? 7 : 6}` }} />
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
                      {!collapsed && group.map((l) => (
                        <div
                          key={l.key}
                          role="row"
                          style={{ gridTemplateColumns: lineGridCols, minHeight: 56 }}
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
                          {showLineDiscountCol && (
                            <div role="cell" className="px-1">
                              {readOnly ? (
                                <div className="text-center tabular-nums">{l.discountValue ? `${l.discountValue}%` : '—'}</div>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={l.discountValue}
                                  onChange={(e) => updateLine(l.key, { discountValue: e.target.value })}
                                  placeholder="0"
                                  className="w-full rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900"
                                />
                              )}
                            </div>
                          )}
                          <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">
                            {(() => {
                              const lineAmount = (Number(l.quantity) || 0) * (l.unitCost ?? 0);
                              const lineDiscount = showLineDiscountCol ? previewDiscountAmount(lineAmount, Number(l.discountValue) > 0 ? 'PERCENT' : null, Number(l.discountValue) || 0) : 0;
                              return formatVnd(lineAmount - lineDiscount);
                            })()}
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
        {discountAmount > 0 ? (
          <div className="text-sm">
            <div className="flex justify-between gap-6 text-slate-600">
              <span>Tổng tiền hàng</span>
              <span className="font-semibold text-slate-900">{formatVnd(totalAmount)}</span>
            </div>
            <div className="flex justify-between gap-6 text-slate-600">
              <span>Chiết khấu</span>
              <span className="font-semibold text-rose-600">-{formatVnd(discountAmount)}</span>
            </div>
            <div className="mt-0.5 flex justify-between gap-6 border-t border-slate-200 pt-0.5">
              <span className="font-bold text-slate-900">Thành tiền</span>
              <span className="text-lg font-bold text-slate-900">{formatVnd(netAmount)}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm font-semibold text-slate-600">
            Tổng cộng: <span className="ml-1 text-lg font-bold text-slate-900">{formatVnd(totalAmount)}</span>
          </div>
        )}
        {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
        {!readOnly && (
          <div className="flex gap-2">
            {/* Nhân viên nhập kho không có quyền `stock_receipt.approve` (Trưởng kho mới duyệt) —
                CHỈ nút này, đổi nhãn cho rõ đây là bước nộp phiếu chờ duyệt (nút KHÔNG đụng tồn
                kho, cùng hành vi "Lưu nháp" cũ, chỉ khác cách gọi tên — cùng đợt sửa `stock_count`
                22/09/2026, chủ dự án phát hiện). */}
            <Button type="button" variant={canApprove ? 'secondary' : 'primary'} loading={saving} onClick={() => void handleSave(false)}>
              {canApprove ? 'Lưu nháp' : 'Lưu & chuyển duyệt'}
            </Button>
            {canApprove && (
              <Button type="button" loading={saving} onClick={() => void handleSave(true)}>
                Lưu &amp; Duyệt ngay
              </Button>
            )}
          </div>
        )}
        {/* In phiếu — CHỈ phiếu ĐÃ DUYỆT chưa huỷ, bổ sung 22/09/2026 theo yêu cầu chủ dự án
            (`docs/DECISIONS.md` #171). */}
        {readOnly && receiptQuery.data?.status === 'POSTED' && !receiptQuery.data.voided && (
          <Button type="button" variant="secondary" onClick={handlePrint}>
            <Printer size={15} weight="bold" aria-hidden="true" />
            In phiếu
          </Button>
        )}
      </div>

      {printing && receiptQuery.data && clinicQuery.data && (
        <StockReceiptPrintView receipt={receiptQuery.data} clinicHeader={clinicQuery.data} unitNameByCode={unitNameByCode} />
      )}
    </div>
  );
}
