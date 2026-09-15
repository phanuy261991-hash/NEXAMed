import { useMemo, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass, PencilSimple, Pill, Plus, Trash, Eye, FirstAidKit, X } from '@phosphor-icons/react';
import type { DrugIngredientInput, DrugItemType, DrugSummary, DrugUnitInput } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCreateDrugMutation, useDrugsQuery, useUpdateDrugMutation } from './drug.queries';

const inputClassName =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const ITEM_TYPE_LABEL: Record<DrugItemType, string> = { MEDICINE: 'Thuốc', SUPPLY: 'Vật tư y tế' };

/** Tính lại chuỗi quy đổi CHỈ để hiển thị — bản local thuần, không import `computeUnitConversion`
 * (@nexamed/core) vì `apps/web` chưa từng phụ thuộc `packages/core` (chỉ `packages/shared`); chỉ 1
 * chỗ dùng nên không đáng mở phụ thuộc mới, xem CLAUDE.md "trùng lặp lần 2 mới trích xuất". */
function computeUnitLevels(baseUnitCode: string, links: { unitCode: string; factorToUnitBelow: number }[]): { unitCode: string; factorToBaseUnit: number }[] {
  const levels = [{ unitCode: baseUnitCode, factorToBaseUnit: 1 }];
  let cumulative = 1;
  for (const link of links) {
    cumulative *= link.factorToUnitBelow;
    levels.push({ unitCode: link.unitCode, factorToBaseUnit: cumulative });
  }
  return levels;
}

interface FormIngredientRow {
  activeIngredientCode: string;
  /** Giá trị THẬT người dùng gõ (ví dụ "500") — quy đổi ×1000 lúc gửi (`DrugIngredientInput.strengthValue`), đúng tiền lệ `vital_sign`. */
  strengthValueDisplay: string;
  strengthUnitCode: string;
}
interface FormUnitRow {
  unitCode: string;
  factorToUnitBelow: string;
}

/**
 * Danh mục Thuốc & Vật tư y tế (Sprint 4, S4-03; mở rộng Giai đoạn 1 của Kho Thuốc & Vật tư y tế —
 * docs/DECISIONS.md #146, mockup Artifact duyệt qua nhiều vòng). Pill "Thuốc & Vật tư" trong trang
 * `/admin/catalog-pharmacy` (2 pill còn lại: `SupplierPane`/`WarehousePane`).
 *
 * Panel chi tiết trượt phải (KHÔNG xổ ngay dưới dòng như bản KiotViet tham khảo — phản hồi trực
 * tiếp: xổ trong bảng đẩy vỡ danh sách). GĐ1 CHƯA có tồn kho (GĐ2-3, chưa xây) nên panel chỉ có
 * ĐÚNG 1 khối "Thông tin chi tiết", không dựng khung Tồn theo lô/Thẻ kho giả.
 */
export function DrugCatalogPane() {
  const canManage = useHasPermission('drug', 'manage');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [itemTypeFilter, setItemTypeFilter] = useState<DrugItemType | 'ALL'>('ALL');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; itemType: DrugItemType; item?: DrugSummary } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useDrugsQuery({ q: debouncedSearch.trim() || undefined, itemType: itemTypeFilter === 'ALL' ? undefined : itemTypeFilter, includeInactive });
  const createMutation = useCreateDrugMutation();
  const updateMutation = useUpdateDrugMutation();

  const drugGroupQuery = useReferenceCatalogQuery('DRUG_GROUP');
  const drugRouteQuery = useReferenceCatalogQuery('DRUG_ROUTE');
  const activeIngredientQuery = useReferenceCatalogQuery('ACTIVE_INGREDIENT');
  const unitQuery = useReferenceCatalogQuery('UNIT');

  const drugGroupOptions: ComboboxOption[] = (drugGroupQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const drugRouteOptions: ComboboxOption[] = (drugRouteQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const activeIngredientOptions: ComboboxOption[] = (activeIngredientQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const unitOptions: ComboboxOption[] = (unitQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const unitNameByCode = useMemo(() => new Map((unitQuery.data?.items ?? []).map((i) => [i.code, i.name])), [unitQuery.data]);
  const drugGroupNameByCode = useMemo(() => new Map((drugGroupQuery.data?.items ?? []).map((i) => [i.code, i.name])), [drugGroupQuery.data]);
  const drugRouteNameByCode = useMemo(() => new Map((drugRouteQuery.data?.items ?? []).map((i) => [i.code, i.name])), [drugRouteQuery.data]);
  const activeIngredientNameByCode = useMemo(() => new Map((activeIngredientQuery.data?.items ?? []).map((i) => [i.code, i.name])), [activeIngredientQuery.data]);

  const items = query.data?.items ?? [];
  const itemIds = items.map((d) => d.id);
  const rowSelection = useRowSelection(itemIds);
  const selectedItem = items.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(['ALL', 'MEDICINE', 'SUPPLY'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setItemTypeFilter(t)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${itemTypeFilter === t ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t === 'ALL' ? 'Tất cả' : ITEM_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="relative w-72">
            <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên, mã hoặc hoạt chất..."
              className={`${inputClassName} pl-8`}
            />
          </div>
          {canManage && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Hiện cả mặt hàng đã ngưng
            </label>
          )}
        </div>

        {canManage && (
          <div className="relative">
            <Button type="button" onClick={() => setAddMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={addMenuOpen}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              Thêm mặt hàng
              <CaretDown size={12} weight="bold" className={`transition-transform ${addMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
            {addMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} aria-hidden="true" />
                <div role="menu" className="absolute right-0 top-full z-20 mt-2 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-md">
                  {(['MEDICINE', 'SUPPLY'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setModal({ mode: 'create', itemType: t });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t === 'MEDICINE' ? <Pill size={15} weight="regular" aria-hidden="true" /> : <FirstAidKit size={15} weight="regular" aria-hidden="true" />}
                      Thêm {ITEM_TYPE_LABEL[t].toLowerCase()}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh mục." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={MagnifyingGlass} title="Chưa có mặt hàng nào" description="Thêm thuốc/vật tư mới hoặc thử từ khoá khác." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="w-10 px-3 py-3">
                    <SelectionCheckbox checked={rowSelection.allLoadedSelected} indeterminate={rowSelection.someLoadedSelected} onChange={rowSelection.toggleAll} ariaLabel="Chọn tất cả" />
                  </th>
                  <th className="w-8 px-1 py-3">
                    <span className="sr-only">Xem chi tiết</span>
                  </th>
                  <th className="w-28 px-3 py-3 text-center">Mã hàng</th>
                  <th className="px-3 py-3 text-left">Tên hàng</th>
                  <th className="w-24 px-3 py-3 text-center">Loại</th>
                  <th className="w-20 px-3 py-3 text-center">ĐVT</th>
                  <th className="w-32 px-3 py-3 text-center">Giá bán</th>
                  <th className="w-24 px-3 py-3 text-center">Quản lý lô</th>
                  <th className="w-28 px-3 py-3 text-center">Trạng thái</th>
                  {canManage && <th className="w-20 px-3 py-3 text-center">Sửa</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr
                    key={d.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(d.id);
                      }
                    }}
                    className={`cursor-pointer border-b border-slate-100 ${selectedId === d.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'} ${d.isActive ? '' : 'opacity-50'}`}
                  >
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <SelectionCheckbox checked={rowSelection.isSelected(d.id)} onChange={() => rowSelection.toggle(d.id)} ariaLabel={`Chọn ${d.name}`} />
                    </td>
                    <td className="px-1 py-2.5 text-center">
                      <Eye size={15} weight="regular" className={selectedId === d.id ? 'text-blue-600' : 'text-slate-400'} aria-hidden="true" />
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold tabular-nums text-slate-800">{d.code}</td>
                    <td className="px-3 py-2.5 text-left">
                      <div className="font-medium text-slate-900">{d.name}</div>
                      {d.activeIngredient && <div className="truncate text-xs font-medium text-slate-500">{d.activeIngredient}</div>}
                    </td>
                    <td className={`px-3 py-2.5 text-center text-xs font-semibold ${d.itemType === 'MEDICINE' ? 'text-blue-700' : 'text-slate-600'}`}>{ITEM_TYPE_LABEL[d.itemType]}</td>
                    <td className="px-3 py-2.5 text-center font-medium text-slate-700">{d.baseUnitCode ? (unitNameByCode.get(d.baseUnitCode) ?? d.baseUnitCode) : d.unit ?? '—'}</td>
                    <td className="px-3 py-2.5 text-center font-medium tabular-nums text-slate-900">
                      {d.defaultSellPrice !== null ? `${d.defaultSellPrice.toLocaleString('vi-VN')} đ` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {d.isBatchManaged ? (
                        <span className="inline-block rounded-md bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">Theo lô</span>
                      ) : (
                        <span className="inline-block rounded-md bg-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600">Không</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <StatusBadge tone={d.isActive ? 'success' : 'neutral'}>{d.isActive ? 'Đang dùng' : 'Đã ẩn'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setModal({ mode: 'edit', itemType: d.itemType, item: d })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PencilSimple size={15} weight="regular" aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {/* Panel chi tiết — trượt phải, khuôn AppointmentDetailPanel.tsx. */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/35 transition-opacity ${selectedItem ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setSelectedId(null)}
        aria-hidden="true"
      />
      <div className={`fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-full flex-col bg-white shadow-2xl transition-transform ${selectedItem ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedItem && (
          <>
            <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-3.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Pill size={18} weight="regular" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold text-slate-900">{selectedItem.name}</h2>
                <p className="truncate text-xs font-medium text-slate-500">
                  {selectedItem.code} · {ITEM_TYPE_LABEL[selectedItem.itemType]}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Đóng" className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} weight="bold" aria-hidden="true" />
              </button>
            </div>
            <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <DetailField label="Đơn vị cơ bản" value={selectedItem.baseUnitCode ? (unitNameByCode.get(selectedItem.baseUnitCode) ?? selectedItem.baseUnitCode) : selectedItem.unit} />
              <DetailField label="Quy đổi" value={formatUnitChain(selectedItem)} />
              <DetailField label="Giá bán" value={selectedItem.defaultSellPrice !== null ? `${selectedItem.defaultSellPrice.toLocaleString('vi-VN')} đ` : null} />
              <DetailField
                label="Định mức tồn"
                value={selectedItem.minStockAlert !== null || selectedItem.maxStockAlert !== null ? `${selectedItem.minStockAlert ?? '—'} - ${selectedItem.maxStockAlert ?? '—'}` : null}
              />
              {selectedItem.itemType === 'MEDICINE' && (
                <DetailField label="Nhóm thuốc" value={selectedItem.drugGroupCode ? (drugGroupNameByCode.get(selectedItem.drugGroupCode) ?? selectedItem.drugGroupCode) : null} />
              )}
              {selectedItem.itemType === 'MEDICINE' && (
                <DetailField label="Đường dùng" value={selectedItem.routeCode ? (drugRouteNameByCode.get(selectedItem.routeCode) ?? selectedItem.routeCode) : null} />
              )}
              <DetailField label="Hãng sản xuất" value={selectedItem.manufacturer} />
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Mã thuốc QĐ 130" value={selectedItem.nationalCode} />}
              {selectedItem.itemType === 'MEDICINE' && (
                <div className="border-b border-slate-100 py-2.5">
                  <dt className="text-sm font-medium text-slate-500">Hoạt chất &amp; hàm lượng</dt>
                  <dd className="mt-1 text-base font-semibold text-slate-900">
                    {selectedItem.ingredients.length === 0
                      ? 'Chưa có'
                      : selectedItem.ingredients
                          .map(
                            (ing) =>
                              `${activeIngredientNameByCode.get(ing.activeIngredientCode) ?? ing.activeIngredientCode} ${(ing.strengthValue / 1000).toLocaleString('vi-VN')} ${
                                unitNameByCode.get(ing.strengthUnitCode) ?? ing.strengthUnitCode
                              }`,
                          )
                          .join(' · ')}
                  </dd>
                </div>
              )}
              <DetailField label="Quản lý theo lô" value={selectedItem.isBatchManaged ? 'Có' : 'Không'} />
            </div>
          </>
        )}
      </div>

      {modal && (
        <DrugFormModal
          mode={modal.mode}
          itemType={modal.itemType}
          item={modal.item}
          drugGroupOptions={drugGroupOptions}
          drugRouteOptions={drugRouteOptions}
          activeIngredientOptions={activeIngredientOptions}
          unitOptions={unitOptions}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={async (dto) => {
            if (modal.mode === 'create') {
              await createMutation.mutateAsync(dto);
            } else if (modal.item) {
              await updateMutation.mutateAsync({ id: modal.item.id, body: { ...dto, isActive: modal.item.isActive, version: modal.item.version } });
            }
          }}
        />
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="border-b border-slate-100 py-2.5">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className={`mt-1 text-base ${empty ? 'font-normal text-slate-400' : 'font-semibold text-slate-900'}`}>{empty ? 'Chưa có' : value}</dd>
    </div>
  );
}

function formatUnitChain(item: DrugSummary): string | null {
  if (!item.baseUnitCode || item.units.length === 0) return null;
  const sorted = [...item.units].sort((a, b) => a.sortOrder - b.sortOrder);
  const levels = computeUnitLevels(
    item.baseUnitCode,
    sorted.map((u) => ({ unitCode: u.unitCode, factorToUnitBelow: u.factorToUnitBelow })),
  );
  return levels
    .slice()
    .reverse()
    .map((l) => `1 ${l.unitCode}${l.factorToBaseUnit > 1 ? ` = ${l.factorToBaseUnit.toLocaleString('vi-VN')} ${item.baseUnitCode}` : ''}`)
    .join(' · ');
}

function DrugFormModal({
  mode,
  itemType,
  item,
  drugGroupOptions,
  drugRouteOptions,
  activeIngredientOptions,
  unitOptions,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  itemType: DrugItemType;
  item?: DrugSummary;
  drugGroupOptions: ComboboxOption[];
  drugRouteOptions: ComboboxOption[];
  activeIngredientOptions: ComboboxOption[];
  unitOptions: ComboboxOption[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: {
    code: string;
    name: string;
    itemType: DrugItemType;
    isBatchManaged: boolean;
    baseUnitCode: string;
    defaultSellPrice?: number;
    drugGroupCode?: string;
    routeCode?: string;
    nationalCode?: string;
    manufacturer?: string;
    minStockAlert?: number;
    maxStockAlert?: number;
    ingredients: DrugIngredientInput[];
    units: DrugUnitInput[];
  }) => Promise<void>;
}) {
  const codeInputRef = useRef<HTMLInputElement>(null);
  const isMedicine = itemType === 'MEDICINE';

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [isBatchManaged, setIsBatchManaged] = useState(item?.isBatchManaged ?? true);
  const [baseUnitCode, setBaseUnitCode] = useState(item?.baseUnitCode ?? '');
  const [defaultSellPrice, setDefaultSellPrice] = useState<number | undefined>(item?.defaultSellPrice ?? undefined);
  const [drugGroupCode, setDrugGroupCode] = useState(item?.drugGroupCode ?? '');
  const [routeCode, setRouteCode] = useState(item?.routeCode ?? '');
  const [nationalCode, setNationalCode] = useState(item?.nationalCode ?? '');
  const [manufacturer, setManufacturer] = useState(item?.manufacturer ?? '');
  const [minStockAlert, setMinStockAlert] = useState(item?.minStockAlert !== null && item?.minStockAlert !== undefined ? String(item.minStockAlert) : '');
  const [maxStockAlert, setMaxStockAlert] = useState(item?.maxStockAlert !== null && item?.maxStockAlert !== undefined ? String(item.maxStockAlert) : '');
  const [ingredients, setIngredients] = useState<FormIngredientRow[]>(
    (item?.ingredients ?? []).map((i) => ({ activeIngredientCode: i.activeIngredientCode, strengthValueDisplay: String(i.strengthValue / 1000), strengthUnitCode: i.strengthUnitCode })),
  );
  const [units, setUnits] = useState<FormUnitRow[]>((item?.units ?? []).map((u) => ({ unitCode: u.unitCode, factorToUnitBelow: String(u.factorToUnitBelow) })));

  const { flashVisible, triggerFlash } = useSaveFlash();
  const isInvalid = code.trim() === '' || name.trim() === '' || baseUnitCode.trim() === '';

  function buildDto() {
    return {
      code: code.trim(),
      name: name.trim(),
      itemType,
      isBatchManaged,
      baseUnitCode: baseUnitCode.trim(),
      defaultSellPrice,
      drugGroupCode: isMedicine ? drugGroupCode.trim() || undefined : undefined,
      routeCode: isMedicine ? routeCode.trim() || undefined : undefined,
      nationalCode: isMedicine ? nationalCode.trim() || undefined : undefined,
      manufacturer: manufacturer.trim() || undefined,
      minStockAlert: minStockAlert.trim() === '' ? undefined : Number(minStockAlert),
      maxStockAlert: maxStockAlert.trim() === '' ? undefined : Number(maxStockAlert),
      ingredients: isMedicine
        ? ingredients.filter((r) => r.activeIngredientCode && r.strengthValueDisplay.trim() !== '').map((r) => ({
            activeIngredientCode: r.activeIngredientCode,
            strengthValue: Math.round(Number(r.strengthValueDisplay) * 1000),
            strengthUnitCode: r.strengthUnitCode,
          }))
        : [],
      units: units.filter((r) => r.unitCode && r.factorToUnitBelow.trim() !== '').map((r, i) => ({ unitCode: r.unitCode, sortOrder: i, factorToUnitBelow: Number(r.factorToUnitBelow) })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    await onSubmit(buildDto());
    onCancel();
  }

  async function handleSaveAndContinue() {
    if (isInvalid) return;
    await onSubmit(buildDto());
    setCode('');
    setName('');
    setIngredients([]);
    setUnits([]);
    codeInputRef.current?.focus();
    triggerFlash();
  }

  const unitChainSummary =
    baseUnitCode && units.length > 0
      ? computeUnitLevels(
          baseUnitCode,
          units.filter((r) => r.unitCode && r.factorToUnitBelow.trim() !== '').map((r) => ({ unitCode: r.unitCode, factorToUnitBelow: Number(r.factorToUnitBelow) || 0 })),
        )
          .slice()
          .reverse()
          .map((l) => `1 ${l.unitCode}${l.factorToBaseUnit > 1 ? ` = ${l.factorToBaseUnit.toLocaleString('vi-VN')} ${baseUnitCode}` : ''}`)
          .join(' · ')
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={isMedicine ? Pill : FirstAidKit} title={mode === 'create' ? `Thêm ${ITEM_TYPE_LABEL[itemType].toLowerCase()}` : `Sửa ${ITEM_TYPE_LABEL[itemType].toLowerCase()}`} onClose={onCancel} />

        <div className="scroll-hover min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6 pt-4">
          <SaveFlashBanner visible={flashVisible} />

          {/* KHỐI 1 — Thông tin chung */}
          <section className="relative rounded-lg border border-slate-200 p-6 pt-8">
            <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Thông tin chung</span>
            <div className="mb-4 flex flex-wrap items-end gap-6">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <input type="checkbox" checked={isBatchManaged} onChange={(e) => setIsBatchManaged(e.target.checked)} />
                Quản lý theo lô &amp; hạn dùng
              </label>
            </div>
            <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="drug-name" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Tên {isMedicine ? 'thương mại' : 'mặt hàng'}
                </label>
                <input id="drug-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
              </div>
              <div>
                <label htmlFor="drug-code" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Mã hàng
                </label>
                <input id="drug-code" ref={codeInputRef} value={code} onChange={(e) => setCode(e.target.value)} className={inputClassName} />
              </div>
              {isMedicine && (
                <div>
                  <label htmlFor="drug-group" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Nhóm thuốc
                  </label>
                  <Combobox id="drug-group" value={drugGroupCode} onChange={setDrugGroupCode} options={drugGroupOptions} />
                </div>
              )}
              {isMedicine && (
                <div>
                  <label htmlFor="drug-route" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Đường dùng
                  </label>
                  <Combobox id="drug-route" value={routeCode} onChange={setRouteCode} options={drugRouteOptions} />
                </div>
              )}
              <div>
                <label htmlFor="drug-manufacturer" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Hãng sản xuất
                </label>
                <input id="drug-manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={inputClassName} />
              </div>
              {isMedicine && (
                <div>
                  <label htmlFor="drug-national" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Mã thuốc QĐ 130
                  </label>
                  <input id="drug-national" value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} className={inputClassName} />
                </div>
              )}
            </div>
          </section>

          {/* KHỐI 2 — Hoạt chất & hàm lượng (CHỈ Thuốc — vật tư y tế không có hoạt chất). */}
          {isMedicine && (
            <section className="relative rounded-lg border border-slate-200 p-6 pt-8">
              <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Hoạt chất &amp; hàm lượng</span>
              <div className="space-y-2">
                {ingredients.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 items-end gap-2">
                    <div className="col-span-6">
                      {i === 0 && <label className="mb-1.5 block text-sm font-semibold text-slate-800">Hoạt chất</label>}
                      <Combobox
                        id={`ingredient-code-${i}`}
                        value={row.activeIngredientCode}
                        onChange={(v) => setIngredients((rows) => rows.map((r, idx) => (idx === i ? { ...r, activeIngredientCode: v } : r)))}
                        options={activeIngredientOptions}
                      />
                    </div>
                    <div className="col-span-3">
                      {i === 0 && <label className="mb-1.5 block text-sm font-semibold text-slate-800">Hàm lượng</label>}
                      <input
                        value={row.strengthValueDisplay}
                        onChange={(e) => setIngredients((rows) => rows.map((r, idx) => (idx === i ? { ...r, strengthValueDisplay: e.target.value } : r)))}
                        inputMode="decimal"
                        className={inputClassName}
                      />
                    </div>
                    <div className="col-span-2">
                      {i === 0 && <label className="mb-1.5 block text-sm font-semibold text-slate-800">Đơn vị</label>}
                      <Combobox
                        id={`ingredient-unit-${i}`}
                        value={row.strengthUnitCode}
                        onChange={(v) => setIngredients((rows) => rows.map((r, idx) => (idx === i ? { ...r, strengthUnitCode: v } : r)))}
                        options={unitOptions}
                      />
                    </div>
                    <div className="col-span-1">
                      <button
                        type="button"
                        aria-label="Xoá hoạt chất"
                        onClick={() => setIngredients((rows) => rows.filter((_, idx) => idx !== i))}
                        className="mb-0.5 rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash size={16} weight="regular" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setIngredients((rows) => [...rows, { activeIngredientCode: '', strengthValueDisplay: '', strengthUnitCode: '' }])}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-blue-400 px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
              >
                <Plus size={15} weight="bold" aria-hidden="true" />
                Thêm hoạt chất
              </button>
            </section>
          )}

          {/* KHỐI 3 — Đơn vị tính & giá */}
          <section className="relative rounded-lg border border-slate-200 p-6 pt-8">
            <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Đơn vị tính &amp; giá</span>
            <div className="mb-4 max-w-xs">
              <label htmlFor="drug-base-unit" className="mb-1.5 block text-sm font-semibold text-slate-800">
                Đơn vị nhỏ nhất
              </label>
              <Combobox id="drug-base-unit" value={baseUnitCode} onChange={setBaseUnitCode} options={unitOptions} />
              <p className="mt-1 text-xs text-slate-500">Đơn vị mà tồn kho sẽ được tính khi có module Kho.</p>
            </div>

            <span className="mb-1.5 block text-sm font-semibold text-slate-800">Quy đổi lên đơn vị lớn hơn</span>
            <div className="space-y-2">
              {units.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-center text-sm font-semibold text-slate-500">1</span>
                  <div className="w-32">
                    <Combobox
                      id={`unit-code-${i}`}
                      value={row.unitCode}
                      onChange={(v) => setUnits((rows) => rows.map((r, idx) => (idx === i ? { ...r, unitCode: v } : r)))}
                      options={unitOptions}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-500">=</span>
                  <input
                    value={row.factorToUnitBelow}
                    onChange={(e) => setUnits((rows) => rows.map((r, idx) => (idx === i ? { ...r, factorToUnitBelow: e.target.value } : r)))}
                    inputMode="numeric"
                    className="w-20 rounded-lg border border-slate-300 px-2.5 py-2 text-[15px] font-semibold tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <span className="text-sm font-semibold text-slate-700">{i === 0 ? unitOptions.find((o) => o.value === baseUnitCode)?.label ?? baseUnitCode : units[i - 1]?.unitCode}</span>
                  <button
                    type="button"
                    aria-label="Xoá bậc quy đổi"
                    onClick={() => setUnits((rows) => rows.filter((_, idx) => idx !== i))}
                    className="ml-1 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash size={15} weight="regular" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setUnits((rows) => [...rows, { unitCode: '', factorToUnitBelow: '' }])}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-blue-400 px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
            >
              <Plus size={15} weight="bold" aria-hidden="true" />
              Thêm bậc quy đổi
            </button>
            {unitChainSummary && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{unitChainSummary}</p>}

            <div className="mt-6 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3">
              <div>
                <label htmlFor="drug-price" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Giá bán mặc định
                </label>
                <div className="relative">
                  <MoneyInput id="drug-price" value={defaultSellPrice} onChange={setDefaultSellPrice} className={`${inputClassName} pr-9`} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">đ</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Theo đơn vị nhỏ nhất.</p>
              </div>
              <div>
                <label htmlFor="drug-min-stock" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Tồn tối thiểu
                </label>
                <input id="drug-min-stock" value={minStockAlert} onChange={(e) => setMinStockAlert(e.target.value)} inputMode="numeric" className={inputClassName} />
              </div>
              <div>
                <label htmlFor="drug-max-stock" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Tồn tối đa
                </label>
                <input id="drug-max-stock" value={maxStockAlert} onChange={(e) => setMaxStockAlert(e.target.value)} inputMode="numeric" className={inputClassName} />
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          {mode === 'create' && (
            <Button type="button" variant="secondary" loading={submitting} disabled={isInvalid} onClick={handleSaveAndContinue}>
              Lưu và nhập tiếp
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
