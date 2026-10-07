import { useMemo, useState } from 'react';
import { MagnifyingGlass, Trash, Warning } from '@phosphor-icons/react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  CreatePriceListRequest,
  PriceableItem,
  PriceableScope,
  PriceListDetail,
  PriceListItemKind,
  PriceListLineInput,
  PriceListLineMode,
  PriceListLineView,
} from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { downloadFile } from '../../shared/api/client';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { formatVnd } from '../../shared/format/currency';
import { makeDraftId } from '../../shared/make-draft-id';
import { useHasPermission } from '../auth/usePermission';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { PRICE_LIST_ITEM_KINDS, PRICE_LIST_ITEM_KIND_LABELS, PRICE_LIST_STATUS_META } from './pricing-labels';
import { useCreatePriceListMutation, usePriceableItemSearch, usePriceListQuery, useUpdatePriceListMutation } from './pricing.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800';
const labelClassName = 'text-sm font-semibold text-slate-800';

// ≈ 1060px tối thiểu — vừa vùng nội dung ở màn 1440px (sidebar 240px + lề); tên mặt hàng co giãn.
const GRID_COLUMNS = '36px 108px 112px minmax(160px,1fr) 150px 112px 140px 108px 112px 40px';
const TABLE_MIN_WIDTH_PX = 1060;

/** Một dòng đang soạn — gom đủ dữ liệu để đổi phạm vi (Loại giá/Đơn vị) và tính lại giá áp dụng mà không gọi lại API. */
interface LineDraft {
  key: string;
  itemKind: PriceListItemKind;
  examTypeCode: string | null;
  technicalServiceId: string | null;
  servicePackageId: string | null;
  drugId: string | null;
  code: string;
  name: string;
  scopes: PriceableScope[];
  priceTypeCode: string | null;
  unitCode: string | null;
  mode: PriceListLineMode;
  value: number | undefined;
  selected: boolean;
  itemMissing: boolean;
}

function isService(kind: PriceListItemKind): boolean {
  return kind === 'EXAM_TYPE' || kind === 'TECHNICAL_SERVICE';
}

function isStock(kind: PriceListItemKind): boolean {
  return kind === 'DRUG' || kind === 'MEDICAL_SUPPLY';
}

function itemRef(line: LineDraft): string {
  return line.examTypeCode ?? line.technicalServiceId ?? line.servicePackageId ?? line.drugId ?? '';
}

/** Giá mặc định của đúng phạm vi đang chọn (hoặc mức ĐẦU TIÊN khi "mọi Loại giá"/"mọi bậc") — cùng quy tắc `pickScope` ở API. */
function baseOf(line: LineDraft): number | null {
  if (line.scopes.length === 0) return null;
  const scope = line.scopes.find((s) => (line.priceTypeCode === null || s.priceTypeCode === line.priceTypeCode) && (line.unitCode === null || s.unitCode === line.unitCode));
  return (scope ?? (line.priceTypeCode === null && line.unitCode === null ? line.scopes[0] : undefined))?.amount ?? null;
}

/** Giảm % làm tròn nửa lên về 1 đồng — cùng quy tắc `applyPriceListLine` ở API (chỉ để xem trước; số chính thức do API tính). */
function finalOf(line: LineDraft): number | null {
  if (line.value === undefined) return null;
  if (line.mode === 'NEW_PRICE') return line.value;
  const base = baseOf(line);
  if (base === null) return null;
  return Math.max(0, Math.floor((base * (100 - Math.min(100, line.value)) * 2 + 100) / 200));
}

function fromView(view: PriceListLineView): LineDraft {
  return {
    key: view.id,
    itemKind: view.itemKind,
    examTypeCode: view.examTypeCode,
    technicalServiceId: view.technicalServiceId,
    servicePackageId: view.servicePackageId,
    drugId: view.drugId,
    code: view.code,
    name: view.name,
    scopes: view.scopes,
    priceTypeCode: view.priceTypeCode,
    unitCode: view.unitCode,
    mode: view.mode,
    value: view.value,
    selected: false,
    itemMissing: view.itemMissing,
  };
}

function fromItem(item: PriceableItem, percent: number): LineDraft {
  return {
    key: makeDraftId(),
    itemKind: item.itemKind,
    examTypeCode: item.itemKind === 'EXAM_TYPE' ? item.ref : null,
    technicalServiceId: item.itemKind === 'TECHNICAL_SERVICE' ? item.ref : null,
    servicePackageId: item.itemKind === 'PACKAGE' ? item.ref : null,
    drugId: isStock(item.itemKind) ? item.ref : null,
    code: item.code,
    name: item.name,
    scopes: item.scopes,
    priceTypeCode: null,
    unitCode: null,
    mode: 'PERCENT_OFF',
    value: percent,
    selected: false,
    itemMissing: false,
  };
}

function toInput(line: LineDraft): PriceListLineInput {
  return {
    itemKind: line.itemKind,
    ...(line.examTypeCode ? { examTypeCode: line.examTypeCode } : {}),
    ...(line.technicalServiceId ? { technicalServiceId: line.technicalServiceId } : {}),
    ...(line.servicePackageId ? { servicePackageId: line.servicePackageId } : {}),
    ...(line.drugId ? { drugId: line.drugId } : {}),
    ...(line.priceTypeCode ? { priceTypeCode: line.priceTypeCode } : {}),
    ...(line.mode === 'NEW_PRICE' && line.unitCode ? { unitCode: line.unitCode } : {}),
    mode: line.mode,
    value: line.value as number,
  };
}

interface CopySource {
  name: string;
  priority: number;
  lines: PriceListLineView[];
}

/**
 * Chi tiết/Tạo "Bảng giá" (`/admin/price-lists/:id`, `/new`, Cận lâm sàng GĐ2, docs/DECISIONS.md #212, mockup màn 11). Hai khối: Thông tin bảng
 * giá, Mặt hàng trong bảng giá (trộn đủ 5 loại; mỗi dòng "Giảm %" hoặc "Giá mới"). "Sao chép thành bảng mới" chuyển sang `/new` kèm
 * dòng của bảng hiện tại qua router state. Giá áp dụng hiển thị là bản XEM TRƯỚC tính ngay trên trình duyệt từ giá mặc định đã tải;
 * số chính thức do API tính lại lúc lưu/tra giá.
 */
export function PriceListDetailPage() {
  const { priceListId } = useParams();
  const isNew = priceListId === 'new';
  const location = useLocation();
  const copySource = (location.state as { copy?: CopySource } | null)?.copy ?? null;
  const query = usePriceListQuery(isNew ? null : (priceListId ?? null));
  const [formKey, setFormKey] = useState(0);

  const title = isNew ? 'Tạo bảng giá' : (query.data?.name ?? 'Bảng giá');
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Bảng giá', to: '/admin/price-lists' }, { label: title }]);

  async function reload() {
    await query.refetch();
    setFormKey((k) => k + 1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <h1 className="sr-only">{title}</h1>
      {!isNew && query.isLoading && (
        <div className="space-y-3 p-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {!isNew && query.isError && (
        <div className="p-6">
          <ErrorBanner message="Không tải được bảng giá. Bảng giá có thể đã bị xoá." onRetry={() => query.refetch()} />
        </div>
      )}
      {(isNew || query.data) && <PriceListForm key={`${formKey}-${query.data?.version ?? 0}`} detail={isNew ? undefined : query.data} copySource={copySource} onReload={reload} />}
    </div>
  );
}

function PriceListForm({ detail, copySource, onReload }: { detail: PriceListDetail | undefined; copySource: CopySource | null; onReload: () => Promise<void> }) {
  const isCreate = detail === undefined;
  const navigate = useNavigate();
  const canWrite = useHasPermission('price_list', isCreate ? 'create' : 'update');
  const { saveError, run } = useSaveAttempt();
  const createMutation = useCreatePriceListMutation();
  const updateMutation = useUpdatePriceListMutation();
  const submitting = createMutation.isPending || updateMutation.isPending;

  const [name, setName] = useState(detail?.name ?? (copySource ? `Bản sao của ${copySource.name}` : ''));
  const [effectiveFrom, setEffectiveFrom] = useState(detail?.effectiveFrom ?? '');
  const [effectiveTo, setEffectiveTo] = useState(detail?.effectiveTo ?? '');
  const [priority, setPriority] = useState<string>(detail ? String(detail.priority) : copySource ? String(copySource.priority) : '');
  const [lines, setLines] = useState<LineDraft[]>(() => (detail ? detail.lines : (copySource?.lines ?? [])).map(fromView));
  const [kindFilter, setKindFilter] = useState<PriceListItemKind | 'ALL'>('ALL');
  const [bulkPercent, setBulkPercent] = useState('20');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [exporting, setExporting] = useState(false);

  const itemSearch = usePriceableItemSearch(debouncedSearch, undefined);
  const priceTypeQuery = useReferenceCatalogQuery('PRICE_TYPE');
  const unitQuery = useReferenceCatalogQuery('UNIT');
  const priceTypeName = useMemo(() => new Map((priceTypeQuery.data?.items ?? []).map((i) => [i.code, i.name])), [priceTypeQuery.data]);
  const unitName = useMemo(() => new Map((unitQuery.data?.items ?? []).map((i) => [i.code, i.name])), [unitQuery.data]);

  const addedKeys = new Set(lines.map((l) => `${l.itemKind === 'MEDICAL_SUPPLY' ? 'DRUG' : l.itemKind}:${itemRef(l)}`));
  const searchResults = (itemSearch.data?.items ?? [])
    .filter((i) => !addedKeys.has(`${i.itemKind === 'MEDICAL_SUPPLY' ? 'DRUG' : i.itemKind}:${i.ref}`))
    .slice(0, 10);

  const countsByKind = useMemo(() => {
    const map = new Map<PriceListItemKind, number>();
    for (const l of lines) map.set(l.itemKind, (map.get(l.itemKind) ?? 0) + 1);
    return map;
  }, [lines]);
  const visibleLines = kindFilter === 'ALL' ? lines : lines.filter((l) => l.itemKind === kindFilter);
  const selectedCount = lines.filter((l) => l.selected).length;
  const allVisibleSelected = visibleLines.length > 0 && visibleLines.every((l) => l.selected);
  const someVisibleSelected = visibleLines.some((l) => l.selected) && !allVisibleSelected;

  const status = detail ? PRICE_LIST_STATUS_META[detail.status] : null;
  const invalid = name.trim() === '' || effectiveFrom === '' || effectiveTo === '' || priority.trim() === '';

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function changeMode(line: LineDraft, mode: PriceListLineMode) {
    if (mode === line.mode) return;
    if (mode === 'PERCENT_OFF') {
      // "Giảm %" áp mọi bậc đơn vị của thuốc/vật tư; với dịch vụ có thể giữ Loại giá đang chọn.
      updateLine(line.key, { mode, unitCode: null, value: undefined });
      return;
    }
    // "Giá mới" bắt buộc chỉ định đúng Loại giá (dịch vụ) / Đơn vị (thuốc, vật tư): tự chọn mức đầu tiên nếu chưa chọn.
    const first = line.scopes[0];
    updateLine(line.key, {
      mode,
      value: undefined,
      priceTypeCode: isService(line.itemKind) ? (line.priceTypeCode ?? first?.priceTypeCode ?? null) : null,
      unitCode: isStock(line.itemKind) ? (line.unitCode ?? first?.unitCode ?? null) : null,
    });
  }

  function pickItem(item: PriceableItem) {
    const percent = Math.min(100, Math.max(1, Number(bulkPercent) || 10));
    setLines((prev) => [...prev, fromItem(item, percent)]);
    setSearch('');
  }

  function applyBulkPercent() {
    const percent = Number(bulkPercent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      setFormError('Phần trăm giảm phải là số nguyên từ 1 đến 100.');
      return;
    }
    setFormError(null);
    setLines((prev) => prev.map((l) => (l.selected ? { ...l, mode: 'PERCENT_OFF', unitCode: null, value: percent } : l)));
  }

  function toggleAllVisible() {
    const target = !allVisibleSelected;
    const visibleKeys = new Set(visibleLines.map((l) => l.key));
    setLines((prev) => prev.map((l) => (visibleKeys.has(l.key) ? { ...l, selected: target } : l)));
  }

  function validateLines(): string | null {
    for (const l of lines) {
      if (l.value === undefined) return `"${l.name}": chưa nhập giá trị.`;
      if (l.mode === 'PERCENT_OFF' && (l.value < 1 || l.value > 100)) return `"${l.name}": phần trăm giảm phải từ 1 đến 100.`;
      if (l.mode === 'NEW_PRICE' && isService(l.itemKind) && l.priceTypeCode === null) return `"${l.name}": "Giá mới" phải chọn Loại giá dịch vụ.`;
      if (l.mode === 'NEW_PRICE' && isStock(l.itemKind) && l.unitCode === null) return `"${l.name}": "Giá mới" phải chọn đơn vị.`;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || invalid) return;
    setFormError(null);
    const priorityNumber = Number(priority);
    if (!Number.isInteger(priorityNumber) || priorityNumber < 1 || priorityNumber > 999_999) {
      setFormError('Độ ưu tiên phải là số nguyên từ 1 đến 999999 (0 dành riêng cho Bảng giá chung).');
      return;
    }
    if (effectiveTo < effectiveFrom) {
      setFormError('Ngày kết thúc phải sau hoặc bằng Ngày bắt đầu.');
      return;
    }
    const lineError = validateLines();
    if (lineError) {
      setFormError(lineError);
      return;
    }

    let createdId: string | null = null;
    const ok = await run(async () => {
      if (isCreate) {
        const body: CreatePriceListRequest = { name: name.trim(), effectiveFrom, effectiveTo, priority: priorityNumber, lines: lines.map(toInput) };
        const created = await createMutation.mutateAsync(body);
        createdId = created.id;
      } else {
        await updateMutation.mutateAsync({ id: detail.id, body: { version: detail.version, name: name.trim(), effectiveFrom, effectiveTo, priority: priorityNumber, lines: lines.map(toInput) } });
      }
    });
    if (ok && createdId) navigate(`/admin/price-lists/${createdId}`, { replace: true });
  }

  async function exportExcel() {
    if (!detail) return;
    setExporting(true);
    setFormError(null);
    try {
      await downloadFile(`/api/v1/price-lists/${detail.id}/export`, `${detail.code}.xlsx`);
    } catch {
      setFormError('Không xuất được file Excel. Thử lại sau.');
    } finally {
      setExporting(false);
    }
  }

  async function toggleActive() {
    if (!detail) return;
    setConfirmStop(false);
    await run(async () => {
      await updateMutation.mutateAsync({ id: detail.id, body: { version: detail.version, isActive: !detail.isActive } });
    });
  }

  function priceTypeOptions(line: LineDraft, withAll: boolean): ComboboxOption[] {
    const fromScopes = line.scopes.filter((s) => s.priceTypeCode !== null).map((s) => s.priceTypeCode as string);
    const fromCatalog = (priceTypeQuery.data?.items ?? []).map((i) => i.code);
    const codes = [...new Set([...fromScopes, ...fromCatalog])];
    const options = codes.map((code) => {
      const amount = line.scopes.find((s) => s.priceTypeCode === code)?.amount;
      return { value: code, label: `${priceTypeName.get(code) ?? code}${amount !== undefined && amount !== null ? ` · ${formatVnd(amount)}` : ''}` };
    });
    return withAll ? [{ value: '', label: 'Mọi loại giá' }, ...options] : options;
  }

  function unitOptions(line: LineDraft): ComboboxOption[] {
    return line.scopes.filter((s) => s.unitCode !== null).map((s) => ({ value: s.unitCode as string, label: `${unitName.get(s.unitCode as string) ?? s.unitCode}${s.amount !== null ? ` · ${formatVnd(s.amount)}` : ''}` }));
  }

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      <div className="scroll-hover flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 pb-5 pt-6">
        <BoxedSection badge="Thông tin bảng giá">
          <div className="grid grid-cols-2 items-end gap-x-3 gap-y-3.5 lg:grid-cols-[156px_minmax(0,2fr)_160px_160px_120px_150px]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pl-code" className={labelClassName}>
                Mã
              </label>
              <input id="pl-code" value={detail?.code ?? ''} readOnly placeholder="Tự động" className={`${inputClassName} bg-slate-50`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pl-name" className={labelClassName}>
                Tên bảng giá <span className="text-rose-500">*</span>
              </label>
              <input id="pl-name" autoFocus={isCreate} value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pl-from" className={labelClassName}>
                Từ ngày <span className="text-rose-500">*</span>
              </label>
              <DateInput id="pl-from" value={effectiveFrom} onChange={setEffectiveFrom} disabled={!canWrite} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pl-to" className={labelClassName}>
                Đến ngày <span className="text-rose-500">*</span>
              </label>
              <DateInput id="pl-to" value={effectiveTo} onChange={setEffectiveTo} disabled={!canWrite} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pl-priority" className={labelClassName}>
                Độ ưu tiên <span className="text-rose-500">*</span>
              </label>
              <input
                id="pl-priority"
                inputMode="numeric"
                value={priority}
                disabled={!canWrite}
                onChange={(e) => setPriority(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`${inputClassName} text-center`}
              />
            </div>
            <div className="pb-2">{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</div>
          </div>
          <p className="mt-2.5 text-xs text-slate-500">
            Cùng ngày có nhiều bảng chứa một mặt hàng thì bảng có độ ưu tiên cao hơn được dùng. Bảng giá chung luôn là 0.
          </p>
        </BoxedSection>

        <BoxedSection badge="Mặt hàng trong bảng giá">
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[280px] flex-1">
                <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Tìm mặt hàng để thêm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter ở ô tìm CHỈ để chọn kết quả đầu — không submit cả form (ui-guidelines mục 4.4).
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const first = searchResults[0];
                      if (first) pickItem(first);
                    }
                  }}
                  placeholder="Gõ tên hoặc mã dịch vụ, gói, thuốc, vật tư để thêm…"
                  className="w-full rounded-md border-2 border-blue-600 py-2 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                {debouncedSearch !== '' && searchResults.length > 0 && (
                  <ul role="listbox" aria-label="Kết quả tìm mặt hàng" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    {searchResults.map((item) => (
                      <li key={`${item.itemKind}:${item.ref}`} role="option" aria-selected={false}>
                        <button type="button" onClick={() => pickItem(item)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <span className="min-w-0 truncate font-semibold text-slate-900">{item.name}</span>
                          <span className="flex-none text-xs font-semibold text-slate-500">
                            {PRICE_LIST_ITEM_KIND_LABELS[item.itemKind]} · {item.code}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                <label htmlFor="pl-bulk" className="whitespace-nowrap text-sm font-semibold text-slate-800">
                  Giảm % cho các dòng đang chọn
                </label>
                <input
                  id="pl-bulk"
                  inputMode="numeric"
                  value={bulkPercent}
                  onChange={(e) => setBulkPercent(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  className="w-16 rounded-md border border-slate-300 px-2 py-2 text-right text-[15px] font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <Button type="button" variant="secondary" disabled={selectedCount === 0} onClick={applyBulkPercent}>
                  Áp dụng
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Lọc mặt hàng theo loại">
            {([{ key: 'ALL', label: 'Tất cả', count: lines.length }, ...PRICE_LIST_ITEM_KINDS.map((k) => ({ key: k, label: PRICE_LIST_ITEM_KIND_LABELS[k], count: countsByKind.get(k) ?? 0 }))] as const).map((f) => {
              const active = kindFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setKindFilter(f.key)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-xs font-bold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {f.label} {f.count}
                </button>
              );
            })}
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <div className="scroll-hover overflow-x-auto overflow-y-hidden">
              <div style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
                <div
                  role="row"
                  className="grid items-center border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800"
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  <div className="flex items-center justify-center px-1 py-2.5">
                    <SelectionCheckbox checked={allVisibleSelected} indeterminate={someVisibleSelected} onChange={toggleAllVisible} ariaLabel="Chọn tất cả dòng đang hiện" />
                  </div>
                  {['Loại', 'Mã', 'Tên mặt hàng', 'Đơn vị / Loại giá', 'Giá mặc định', 'Cách tính', 'Giá trị', 'Giá áp dụng', ''].map((h, i) => (
                    <div key={i} role="columnheader" className="px-2 py-2.5">
                      {h}
                    </div>
                  ))}
                </div>

                {visibleLines.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm font-medium italic text-slate-400">
                    {lines.length === 0 ? 'Chưa có mặt hàng nào — gõ vào ô tìm phía trên để thêm.' : 'Không có mặt hàng thuộc loại này.'}
                  </div>
                )}
                {visibleLines.map((line) => {
                  const base = baseOf(line);
                  const final = finalOf(line);
                  return (
                    <div key={line.key} role="row" className="grid items-center border-b border-slate-100 text-center text-sm last:border-0" style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: 54 }}>
                      <div className="flex items-center justify-center">
                        <SelectionCheckbox checked={line.selected} onChange={() => updateLine(line.key, { selected: !line.selected })} ariaLabel={`Chọn ${line.name}`} />
                      </div>
                      <div className="px-1.5">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{PRICE_LIST_ITEM_KIND_LABELS[line.itemKind]}</span>
                      </div>
                      <div className="px-1.5 font-semibold text-slate-800">{line.code}</div>
                      <div className="min-w-0 px-2.5 py-1.5 text-left">
                        <div className="truncate font-medium text-slate-900" title={line.name}>
                          {line.name}
                        </div>
                        {line.itemMissing && (
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                            <Warning size={12} weight="fill" aria-hidden="true" />
                            Không còn trong danh mục
                          </div>
                        )}
                      </div>
                      <div className="px-1.5 text-[13px] font-medium text-slate-600">
                        {line.itemKind === 'PACKAGE' ? (
                          'Trọn gói'
                        ) : isService(line.itemKind) ? (
                          <Combobox
                            id={`pl-scope-${line.key}`}
                            value={line.priceTypeCode ?? ''}
                            onChange={(v) => updateLine(line.key, { priceTypeCode: v === '' ? null : v })}
                            options={priceTypeOptions(line, line.mode === 'PERCENT_OFF')}
                            disabled={!canWrite}
                          />
                        ) : line.mode === 'PERCENT_OFF' ? (
                          'Mọi bậc'
                        ) : (
                          <Combobox id={`pl-scope-${line.key}`} value={line.unitCode ?? ''} onChange={(v) => updateLine(line.key, { unitCode: v === '' ? null : v })} options={unitOptions(line)} disabled={!canWrite} />
                        )}
                      </div>
                      <div className="px-2.5 text-right font-medium tabular-nums text-slate-600">{base === null ? <span className="text-slate-400">Chưa có giá</span> : formatVnd(base)}</div>
                      <div className="flex justify-center px-1.5">
                        <TwoOptionToggle
                          options={[
                            { value: 'PERCENT_OFF', label: 'Giảm %' },
                            { value: 'NEW_PRICE', label: 'Giá mới' },
                          ]}
                          value={line.mode}
                          onChange={(next) => next !== null && changeMode(line, next)}
                          disabled={!canWrite}
                        />
                      </div>
                      <div className="px-1.5">
                        {line.mode === 'PERCENT_OFF' ? (
                          <div className="flex items-center gap-1">
                            <input
                              aria-label={`Phần trăm giảm ${line.name}`}
                              inputMode="numeric"
                              value={line.value ?? ''}
                              disabled={!canWrite}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
                                updateLine(line.key, { value: digits === '' ? undefined : Math.min(100, Number(digits)) });
                              }}
                              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                            />
                            <span className="text-sm font-bold text-slate-600">%</span>
                          </div>
                        ) : (
                          <MoneyInput
                            id={`pl-value-${line.key}`}
                            value={line.value}
                            onChange={(v) => updateLine(line.key, { value: v })}
                            disabled={!canWrite}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                          />
                        )}
                      </div>
                      <div className="px-2.5 text-right font-bold tabular-nums text-emerald-700">{final === null ? <span className="font-normal text-slate-400">—</span> : formatVnd(final)}</div>
                      <div className="flex justify-center">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                            aria-label={`Xoá ${line.name} khỏi bảng giá`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100"
                          >
                            <Trash size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Thuốc có nhiều bậc đơn vị (Hộp/Vỉ/Viên): "Giảm %" áp cho mọi bậc; "Giá mới" chỉ áp cho đúng đơn vị đã chọn. Gói dịch vụ tính trọn gói — bảng giá đổi giá của cả gói, không đụng tới từng dịch vụ con. Giá áp dụng làm tròn về 1 đồng.
          </p>
        </BoxedSection>

        {formError && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            <Warning size={15} weight="fill" className="flex-none" aria-hidden="true" />
            {formError}
          </div>
        )}
        <RecordFormNotice saveError={saveError} onReload={isCreate ? undefined : onReload} />
      </div>

      <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6 py-3">
        <div>
          {detail && canWrite && (
            <Button type="button" variant="danger" onClick={() => (detail.isActive ? setConfirmStop(true) : void toggleActive())}>
              {detail.isActive ? 'Ngừng bảng giá' : 'Áp dụng lại bảng giá'}
            </Button>
          )}
        </div>
        <div className="flex gap-2.5">
          {detail && (
            <Button type="button" variant="secondary" onClick={() => navigate('/admin/price-lists/new', { state: { copy: { name: detail.name, priority: detail.priority, lines: detail.lines } satisfies CopySource } })}>
              Sao chép thành bảng mới
            </Button>
          )}
          {detail && (
            <Button type="button" variant="secondary" loading={exporting} onClick={() => void exportExcel()}>
              Xuất Excel
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => navigate('/admin/price-lists')}>
            {canWrite ? 'Huỷ' : 'Đóng'}
          </Button>
          {canWrite && (
            <Button type="submit" loading={submitting} disabled={invalid}>
              Lưu bảng giá
            </Button>
          )}
        </div>
      </div>

      {confirmStop && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="pl-stop-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 id="pl-stop-title" className="text-[17px] font-bold text-slate-900">
              Ngừng bảng giá "{detail.name}"?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Bảng giá sẽ không còn được áp dụng dù còn trong khoảng ngày; mặt hàng quay về bảng có ưu tiên thấp hơn hoặc Bảng giá chung. Hoá đơn đã lập không bị đổi giá. Có thể áp dụng lại sau.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={() => setConfirmStop(false)}>
                Giữ nguyên
              </Button>
              <Button type="button" variant="danger" loading={updateMutation.isPending} onClick={() => void toggleActive()}>
                Ngừng bảng giá
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
