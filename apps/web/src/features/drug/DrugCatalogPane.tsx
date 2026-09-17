import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CaretDown, MagnifyingGlass, PencilSimple, Pill, Plus, Trash, Eye, FirstAidKit, X } from '@phosphor-icons/react';
import type { DrugControlType, DrugIngredientInput, DrugItemType, DrugSummary, DrugUnitInput, ReferenceCatalogCategory } from '@nexamed/shared';
import { useHasAnyPermission, useHasPermission } from '../auth/usePermission';
import { useDrugBatchBalancesQuery, useDrugLedgerQuery } from '../inventory/inventory.queries';
import { DRUG_MANAGE_PERMISSIONS } from '../auth/admin-permissions';
import { Button } from '../../shared/ui/Button';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { Textarea } from '../../shared/ui/Textarea';
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
import { useCreateReferenceCatalogItemMutation, useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { appendSentence } from '../../shared/format/append-sentence';
import { formatDobDisplay } from '../../shared/format/date';
import { useCreateDrugMutation, useDrugsQuery, useUpdateDrugMutation } from './drug.queries';
import { useUnitNameByCode } from './useUnitNameByCode';

const inputClassName =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const ITEM_TYPE_LABEL: Record<DrugItemType, string> = { MEDICINE: 'Thuốc', SUPPLY: 'Vật tư y tế' };

/** Phân loại kiểm soát đặc biệt (Thông tư 20/2017/TT-BYT, docs/DECISIONS.md #151) — enum CỐ ĐỊNH,
 * KHÔNG dùng `reference_catalog` (tenant không tự thêm/sửa được). CHỈ có ý nghĩa với `itemType==='MEDICINE'`. */
const CONTROL_TYPE_OPTIONS: ComboboxOption[] = [
  { value: 'NORMAL', label: 'Thường' },
  { value: 'TOXIC', label: 'Độc' },
  { value: 'NARCOTIC', label: 'Gây nghiện' },
  { value: 'PSYCHOTROPIC', label: 'Hướng thần' },
  { value: 'PRECURSOR', label: 'Tiền chất' },
];
const CONTROL_TYPE_LABEL: Record<DrugControlType, string> = {
  NORMAL: 'Thường',
  TOXIC: 'Độc',
  NARCOTIC: 'Gây nghiện',
  PSYCHOTROPIC: 'Hướng thần',
  PRECURSOR: 'Tiền chất',
};
/** Badge tint theo mức độ nghiêm trọng (chốt qua AskUserQuestion): Gây nghiện/Hướng thần bị kiểm
 * soát chặt hơn Độc/Tiền chất theo Thông tư 20/2017/TT-BYT → rose. `NORMAL` → không hiện badge. */
const CONTROL_TYPE_BADGE_CLASS: Record<DrugControlType, string | null> = {
  NORMAL: null,
  TOXIC: 'bg-amber-100 text-amber-700',
  PRECURSOR: 'bg-amber-100 text-amber-700',
  NARCOTIC: 'bg-rose-100 text-rose-700',
  PSYCHOTROPIC: 'bg-rose-100 text-rose-700',
};

function ControlTypeBadge({ controlType }: { controlType: DrugControlType }) {
  const cls = CONTROL_TYPE_BADGE_CLASS[controlType];
  if (!cls) return null;
  return <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{CONTROL_TYPE_LABEL[controlType]}</span>;
}

/** Gộp query + "thêm nhanh" (mở rộng #151, chủ dự án yêu cầu trực tiếp) cho 1 category
 * `reference_catalog` dùng trong Combobox `allowCreate` — tránh lặp lại 5 lần cho Dạng bào chế/
 * Điều kiện bảo quản/Hãng sản xuất/Nước sản xuất/Vị trí lưu kho. */
function useCatalogCombobox(category: ReferenceCatalogCategory) {
  const query = useReferenceCatalogQuery(category);
  const createMutation = useCreateReferenceCatalogItemMutation(category);
  const options: ComboboxOption[] = (query.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const nameByCode = new Map(options.map((o) => [o.value, o.label]));
  async function onCreateOption(name: string): Promise<ComboboxOption> {
    const created = await createMutation.mutateAsync({ category, name, sortOrder: 0 });
    return { value: created.code, label: created.name };
  }
  return { options, nameByCode, onCreateOption };
}
type CatalogCombobox = ReturnType<typeof useCatalogCombobox>;

/** Định dạng chuỗi quy đổi TUẦN TỰ — mỗi bậc so với ĐÚNG bậc liền kề nhỏ hơn (vd "1 Hộp = 5 Vỉ ·
 * 1 Vỉ = 20 Viên"), KHÔNG quy đổi thẳng về đơn vị nhỏ nhất như bản trước (chủ dự án phản hồi trực
 * tiếp — "1 Hộp = 100 Viên" gộp 2 bậc khó đọc hơn tách riêng). Bản local thuần, không import
 * `computeUnitConversion` (@nexamed/core) vì `apps/web` chưa từng phụ thuộc `packages/core`; chỉ 1
 * chỗ dùng nên không đáng mở phụ thuộc mới, xem CLAUDE.md "trùng lặp lần 2 mới trích xuất". */
function formatUnitChainSequential(
  baseUnitCode: string,
  links: { unitCode: string; factorToUnitBelow: number }[],
  label: (code: string) => string,
): string {
  return links
    .map((link, i) => `1 ${label(link.unitCode)} = ${link.factorToUnitBelow.toLocaleString('vi-VN')} ${label(i === 0 ? baseUnitCode : links[i - 1]!.unitCode)}`)
    .reverse()
    .join(' · ');
}

/**
 * Gợi ý "Quy cách đóng gói" ghép TỰ ĐỘNG từ Bảng quy đổi đơn vị (đảo ngược hoãn #151, chốt
 * 17/09/2026, qua AskUserQuestion): `[Đơn vị lớn nhất] [hệ số] [đơn vị kế] x [hệ số] [đơn vị kế]...`
 * — ví dụ "Hộp 10 vỉ x 10 viên". `links` cùng thứ tự với `formatUnitChainSequential` (index 0 = bậc
 * ngay trên đơn vị cơ sở), nên đảo ngược để đi từ LỚN NHẤT xuống. Trả `null` khi chưa đủ dữ liệu để
 * ghép (chưa chọn đơn vị cơ sở, hoặc chỉ có đúng 1 đơn vị — không có gì để quy đổi).
 */
function suggestPackagingSpec(baseUnitCode: string, links: { unitCode: string; factorToUnitBelow: number }[], label: (code: string) => string): string | null {
  if (!baseUnitCode || links.length === 0) return null;
  const descending = [...links].reverse();
  const chainNames = [...descending.map((l) => l.unitCode), baseUnitCode].map(label);
  const factors = descending.map((l) => l.factorToUnitBelow);

  let result = `${chainNames[0]} ${factors[0]!.toLocaleString('vi-VN')} ${chainNames[1]!.toLowerCase()}`;
  for (let i = 1; i < factors.length; i += 1) {
    result += ` x ${factors[i]!.toLocaleString('vi-VN')} ${chainNames[i + 1]!.toLowerCase()}`;
  }
  return result;
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
  /** Giá bán RIÊNG của bậc này — CHỈ dùng khi bật "Giá theo từng đơn vị cụ thể" (mở rộng GĐ1). */
  sellPriceDisplay: string;
}

/**
 * Danh mục Thuốc & Vật tư y tế (Sprint 4, S4-03; mở rộng Giai đoạn 1 của Kho Thuốc & Vật tư y tế —
 * docs/DECISIONS.md #146, mockup Artifact duyệt qua nhiều vòng). Pill "Thuốc & Vật tư" trong trang
 * "Danh mục Thuốc và Vật Tư" (`/admin/catalog-pharmacy`, nay ở nhóm sidebar "Quản lý kho") — pill
 * còn lại trong cùng trang: `WarehousePane` ("Kho"). `SupplierPane` đã tách sang trang/nhóm menu
 * riêng "Quản lý nhà cung cấp" (`/suppliers`).
 *
 * Panel chi tiết trượt phải (KHÔNG xổ ngay dưới dòng như bản KiotViet tham khảo — phản hồi trực
 * tiếp: xổ trong bảng đẩy vỡ danh sách). GĐ1 CHƯA có tồn kho (GĐ2-3, chưa xây) nên panel chỉ có
 * ĐÚNG 1 khối "Thông tin chi tiết", không dựng khung Tồn theo lô/Thẻ kho giả.
 */
export function DrugCatalogPane() {
  const canManage = useHasAnyPermission(DRUG_MANAGE_PERMISSIONS);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [itemTypeFilter, setItemTypeFilter] = useState<DrugItemType | 'ALL'>('ALL');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; itemType: DrugItemType; item?: DrugSummary } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Kho Thuốc GĐ2 (docs/DECISIONS.md #146) — panel chi tiết đổi từ 1 khối cuộn dài sang tab thật.
  const [detailTab, setDetailTab] = useState<'info' | 'batches' | 'ledger' | 'history'>('info');
  const canSeeInventory = useHasPermission('stock_receipt', 'read');
  function openDetail(id: string) {
    setSelectedId(id);
    setDetailTab('info');
  }

  const query = useDrugsQuery({ q: debouncedSearch.trim() || undefined, itemType: itemTypeFilter === 'ALL' ? undefined : itemTypeFilter, includeInactive });
  const createMutation = useCreateDrugMutation();
  const updateMutation = useUpdateDrugMutation();

  const drugGroupQuery = useReferenceCatalogQuery('DRUG_GROUP');
  const drugRouteQuery = useReferenceCatalogQuery('DRUG_ROUTE');
  const activeIngredientQuery = useReferenceCatalogQuery('ACTIVE_INGREDIENT');
  const unitQuery = useReferenceCatalogQuery('UNIT');
  // Mở rộng #151 — Dạng bào chế/Điều kiện bảo quản/Hãng sản xuất/Nước sản xuất/Vị trí lưu kho, có
  // "thêm nhanh" ngay tại ô chọn (Combobox `allowCreate`).
  const dosageFormCatalog = useCatalogCombobox('DOSAGE_FORM');
  const storageConditionCatalog = useCatalogCombobox('STORAGE_CONDITION');
  const manufacturerCatalog = useCatalogCombobox('MANUFACTURER');
  const countryOfOriginCatalog = useCatalogCombobox('COUNTRY_OF_ORIGIN');
  const storageLocationCatalog = useCatalogCombobox('STORAGE_LOCATION');
  // "Thời điểm dùng thuốc" (docs/DECISIONS.md #155) — CHỈ dùng làm gợi ý ghép câu cho ô "Cách
  // dùng" (`usageInstruction`), không phải trường lưu riêng nên không tái dùng nguyên
  // `useCatalogCombobox` (cần thêm `description` để ghép câu, `nameByCode` không đủ) — nhưng vẫn
  // giữ "thêm nhanh" (`allowCreate`) đúng chuẩn mọi ô danh mục khác trong form này (#151).
  const usageTimingQuery = useReferenceCatalogQuery('DRUG_USAGE_TIMING');
  const createUsageTimingMutation = useCreateReferenceCatalogItemMutation('DRUG_USAGE_TIMING');
  const usageTimingOptions: ComboboxOption[] = (usageTimingQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  async function onCreateUsageTimingOption(name: string): Promise<ComboboxOption> {
    const created = await createUsageTimingMutation.mutateAsync({ category: 'DRUG_USAGE_TIMING', name, sortOrder: 0 });
    return { value: created.code, label: created.name };
  }
  const usageTimingSentenceByCode = new Map((usageTimingQuery.data?.items ?? []).map((i) => [i.code, i.description ?? i.fullName ?? i.name]));

  const drugGroupOptions: ComboboxOption[] = (drugGroupQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const drugRouteOptions: ComboboxOption[] = (drugRouteQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const activeIngredientOptions: ComboboxOption[] = (activeIngredientQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const unitOptions: ComboboxOption[] = (unitQuery.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const unitNameByCode = useUnitNameByCode();
  const drugGroupNameByCode = useMemo(() => new Map((drugGroupQuery.data?.items ?? []).map((i) => [i.code, i.name])), [drugGroupQuery.data]);
  const drugRouteNameByCode = useMemo(() => new Map((drugRouteQuery.data?.items ?? []).map((i) => [i.code, i.name])), [drugRouteQuery.data]);
  const activeIngredientNameByCode = useMemo(() => new Map((activeIngredientQuery.data?.items ?? []).map((i) => [i.code, i.name])), [activeIngredientQuery.data]);

  const items = query.data?.items ?? [];
  const itemIds = items.map((d) => d.id);
  const rowSelection = useRowSelection(itemIds);
  const selectedItem = items.find((d) => d.id === selectedId) ?? null;

  // Mở thẳng panel chi tiết + đúng tab khi điều hướng từ nơi khác (ví dụ "Tồn kho" bấm tên thuốc
  // sang thẳng tab "Tồn kho theo lô") — chỉ mở 1 lần khi danh sách vừa tải xong, không lặp lại mỗi
  // lần `items` đổi (tránh tự mở lại panel nếu người dùng đã bấm đóng).
  const [searchParams] = useSearchParams();
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || items.length === 0) return;
    const deepLinkDrugId = searchParams.get('drugId');
    if (!deepLinkDrugId) return;
    deepLinkHandledRef.current = true;
    if (!items.some((d) => d.id === deepLinkDrugId)) return;
    setSelectedId(deepLinkDrugId);
    const tab = searchParams.get('tab');
    if (tab === 'batches' || tab === 'ledger' || tab === 'history') setDetailTab(tab);
  }, [items, searchParams]);

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
                    onClick={() => openDetail(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDetail(d.id);
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
                      <div className="flex items-center font-medium text-slate-900">
                        {d.name}
                        {d.itemType === 'MEDICINE' && <ControlTypeBadge controlType={d.controlType} />}
                      </div>
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

            {/* Kho Thuốc GĐ2 (docs/DECISIONS.md #146) — tab thật thay cho 1 khối cuộn dài duy nhất
                trước đây. "Tồn kho theo lô"/"Thẻ kho"/"Lịch sử giao dịch" chỉ hiện khi actor có
                stock_receipt.read (điều dưỡng/lễ tân không có quyền này thì panel giữ nguyên như
                cũ, chỉ 1 tab "Thông tin"). */}
            {canSeeInventory && (
              <div className="flex flex-shrink-0 gap-1 border-b border-slate-200 px-5 pt-2" role="tablist">
                {(
                  [
                    ['info', 'Thông tin'],
                    ['batches', 'Tồn kho theo lô'],
                    ['ledger', 'Thẻ kho'],
                    ['history', 'Lịch sử giao dịch'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDetailTab(value)}
                    className={`border-b-2 px-2.5 py-2 text-sm font-semibold ${detailTab === value ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {detailTab === 'info' && (
            <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <DetailField label="Đơn vị cơ bản" value={selectedItem.baseUnitCode ? (unitNameByCode.get(selectedItem.baseUnitCode) ?? selectedItem.baseUnitCode) : selectedItem.unit} />
              <DetailField label="Quy đổi" value={formatUnitChain(selectedItem, unitNameByCode)} />
              <DetailField label="Quy cách đóng gói" value={selectedItem.packagingSpec} />
              {selectedItem.unitPricingEnabled ? (
                <DetailField label="Giá bán theo đơn vị" value={formatUnitPrices(selectedItem, unitNameByCode)} />
              ) : (
                <DetailField label="Giá bán" value={selectedItem.defaultSellPrice !== null ? `${selectedItem.defaultSellPrice.toLocaleString('vi-VN')} đ` : null} />
              )}
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
              {selectedItem.itemType === 'MEDICINE' && (
                <div className="border-b border-slate-100 py-2.5">
                  <dt className="text-sm font-medium text-slate-500">Phân loại kiểm soát</dt>
                  <dd className="mt-1 text-base font-semibold text-slate-900">
                    {CONTROL_TYPE_LABEL[selectedItem.controlType]}
                    <ControlTypeBadge controlType={selectedItem.controlType} />
                  </dd>
                </div>
              )}
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Yêu cầu kê đơn (Rx)" value={selectedItem.isPrescriptionOnly ? 'Có' : 'Không'} />}
              <DetailField
                label="Hãng sản xuất"
                value={selectedItem.manufacturerCode ? (manufacturerCatalog.nameByCode.get(selectedItem.manufacturerCode) ?? selectedItem.manufacturerCode) : selectedItem.manufacturer}
              />
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Mã thuốc QĐ 130" value={selectedItem.nationalCode} />}
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Số đăng ký lưu hành" value={selectedItem.registrationNumber} />}
              {selectedItem.itemType === 'MEDICINE' && (
                <DetailField label="Dạng bào chế" value={selectedItem.dosageForm ? (dosageFormCatalog.nameByCode.get(selectedItem.dosageForm) ?? selectedItem.dosageForm) : null} />
              )}
              {selectedItem.itemType === 'MEDICINE' && (
                <DetailField
                  label="Nước sản xuất"
                  value={selectedItem.countryOfOrigin ? (countryOfOriginCatalog.nameByCode.get(selectedItem.countryOfOrigin) ?? selectedItem.countryOfOrigin) : null}
                />
              )}
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
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Liều dùng mặc định" value={selectedItem.defaultDosage} />}
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Cách dùng" value={selectedItem.usageInstruction} />}
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Chống chỉ định / Cảnh báo" value={selectedItem.contraindications} />}
              {selectedItem.itemType === 'MEDICINE' && (
                <DetailField
                  label="Điều kiện bảo quản"
                  value={selectedItem.storageConditions ? (storageConditionCatalog.nameByCode.get(selectedItem.storageConditions) ?? selectedItem.storageConditions) : null}
                />
              )}
              {selectedItem.itemType === 'MEDICINE' && (
                <DetailField
                  label="Vị trí lưu kho"
                  value={selectedItem.storageLocation ? (storageLocationCatalog.nameByCode.get(selectedItem.storageLocation) ?? selectedItem.storageLocation) : null}
                />
              )}
              {selectedItem.itemType === 'MEDICINE' && <DetailField label="Mã vạch" value={selectedItem.barcode} />}
              <DetailField label="Quản lý theo lô" value={selectedItem.isBatchManaged ? 'Có' : 'Không'} />
            </div>
            )}
            {detailTab === 'batches' && <DrugBatchBalanceTab drugId={selectedItem.id} />}
            {detailTab === 'ledger' && <DrugLedgerTab drugId={selectedItem.id} mode="ledger" />}
            {detailTab === 'history' && <DrugLedgerTab drugId={selectedItem.id} mode="history" />}
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
          dosageFormCatalog={dosageFormCatalog}
          storageConditionCatalog={storageConditionCatalog}
          manufacturerCatalog={manufacturerCatalog}
          countryOfOriginCatalog={countryOfOriginCatalog}
          storageLocationCatalog={storageLocationCatalog}
          usageTimingOptions={usageTimingOptions}
          usageTimingSentenceByCode={usageTimingSentenceByCode}
          onCreateUsageTimingOption={onCreateUsageTimingOption}
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

const LEDGER_REASON_LABEL: Record<string, string> = {
  RECEIPT_PURCHASE: 'Nhập nhà cung cấp',
  RECEIPT_OPENING_BALANCE: 'Nhập khởi tạo (Đầu kỳ)',
  RECEIPT_TRANSFER_IN: 'Nhập chuyển kho',
  RECEIPT_RETURN_FROM_USE: 'Nhập hoàn trả',
  RECEIPT_COUNT_SURPLUS: 'Nhập cân bằng kiểm kê',
  RECEIPT_VOID: 'Đảo phiếu nhập (huỷ)',
  ISSUE_RETAIL_SALE: 'Xuất bán lẻ',
  ISSUE_SERVICE_CONSUMPTION: 'Xuất tiêu hao dịch vụ',
  ISSUE_INTERNAL_ALLOCATION: 'Xuất cấp phát nội bộ',
  ISSUE_TRANSFER_OUT: 'Xuất chuyển kho',
  ISSUE_RETURN_TO_SUPPLIER: 'Xuất trả nhà cung cấp',
  ISSUE_WRITE_OFF: 'Xuất huỷ',
  ISSUE_COUNT_SHORTAGE: 'Xuất cân bằng kiểm kê',
};

/** "Tồn kho theo lô" (panel chi tiết thuốc, Kho Thuốc GĐ2) — mọi lô còn tồn của thuốc này, mọi kho. */
function DrugBatchBalanceTab({ drugId }: { drugId: string }) {
  const query = useDrugBatchBalancesQuery(drugId);
  if (query.isPending) {
    return (
      <div className="scroll-hover min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="px-5 py-4">
        <ErrorBanner message="Không tải được tồn kho theo lô." onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="px-5 py-4">
        <EmptyState icon={FirstAidKit} title="Chưa có tồn kho" description="Duyệt phiếu nhập kho để bắt đầu ghi nhận tồn cho mặt hàng này." />
      </div>
    );
  }
  return (
    <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">Tồn kho theo lô</p>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-blue-600 bg-slate-100 text-[11px] font-bold uppercase text-slate-800">
              <th className="px-3 py-2 text-left">Số lô</th>
              <th className="px-3 py-2 text-center">Kho</th>
              <th className="px-3 py-2 text-center">Hạn dùng</th>
              <th className="px-3 py-2 text-center">Tồn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((b) => (
              <tr key={b.batchId}>
                <td className="px-3 py-2 font-semibold text-slate-800">{b.batchNo}</td>
                <td className="px-3 py-2 text-center font-medium text-slate-600">{b.warehouseName}</td>
                <td className={`px-3 py-2 text-center font-semibold ${b.expiryStatus === 'EXPIRED' ? 'text-rose-600' : b.expiryStatus === 'EXPIRING_SOON' ? 'text-amber-600' : 'font-medium text-slate-600'}`}>
                  {b.expiryDate ? formatDobDisplay(b.expiryDate) : '—'}
                  {b.expiryStatus === 'EXPIRED' && ` · đã quá ${Math.abs(b.daysUntilExpiry!)} ngày`}
                  {b.expiryStatus === 'EXPIRING_SOON' && ` · còn ${b.daysUntilExpiry} ngày`}
                </td>
                <td className="px-3 py-2 text-center font-semibold tabular-nums text-slate-900">{b.quantityOnHand.toLocaleString('vi-VN')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td className="px-3 py-2 font-bold text-slate-800" colSpan={3}>
                Tổng tồn
              </td>
              <td className="px-3 py-2 text-center text-base font-bold text-slate-900">{query.data!.totalQuantityOnHand.toLocaleString('vi-VN')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** "Thẻ kho"/"Lịch sử giao dịch" (panel chi tiết thuốc, Kho Thuốc GĐ2) — CÙNG dữ liệu GĐ2 (chỉ có
 * nguồn phiếu nhập kho), khác cách trình bày cột: `ledger` = Ngày/SL/Tồn sau, `history` = Ngày/Loại
 * chứng từ+Số phiếu/Người tạo. Sẽ tách API thật khi GĐ3 có thêm phiếu xuất kho (chứng từ khác). */
function DrugLedgerTab({ drugId, mode }: { drugId: string; mode: 'ledger' | 'history' }) {
  const query = useDrugLedgerQuery(drugId);
  if (query.isPending) {
    return (
      <div className="scroll-hover min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="px-5 py-4">
        <ErrorBanner message="Không tải được thẻ kho." onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="px-5 py-4">
        <EmptyState icon={FirstAidKit} title="Chưa có giao dịch nào" description="Duyệt phiếu nhập kho để bắt đầu ghi thẻ kho cho mặt hàng này." />
      </div>
    );
  }
  return (
    <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">{mode === 'ledger' ? `Thẻ kho · ${items.length} giao dịch` : 'Lịch sử giao dịch (theo chứng từ)'}</p>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-blue-600 bg-slate-100 text-[11px] font-bold uppercase text-slate-800">
              <th className="px-2.5 py-2 text-center">Ngày</th>
              {mode === 'ledger' ? (
                <>
                  <th className="px-2.5 py-2 text-center">SL</th>
                  <th className="px-2.5 py-2 text-center">Tồn sau</th>
                </>
              ) : (
                <>
                  <th className="px-2.5 py-2 text-left">Chứng từ</th>
                  <th className="px-2.5 py-2 text-left">Người tạo</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((entry) => (
              <tr key={entry.id}>
                <td className="px-2.5 py-2 text-center">
                  <div className="font-medium text-slate-700">{entry.occurredAt.slice(0, 10)}</div>
                  {mode === 'ledger' && <div className="text-[11px] font-medium text-slate-400">{entry.sourceReceiptNo ?? LEDGER_REASON_LABEL[entry.reason]}</div>}
                </td>
                {mode === 'ledger' ? (
                  <>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-center font-semibold tabular-nums ${entry.quantityChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {entry.quantityChange >= 0 ? '+' : ''}
                      {entry.quantityChange}
                    </td>
                    <td className="px-2.5 py-2 text-center font-semibold tabular-nums text-slate-900">{entry.runningBalance}</td>
                  </>
                ) : (
                  <>
                    <td className="px-2.5 py-2 text-left">
                      <div className="font-medium text-slate-700">{LEDGER_REASON_LABEL[entry.reason] ?? entry.reason}</div>
                      {entry.sourceReceiptNo && <div className="text-[11px] font-medium text-slate-400">{entry.sourceReceiptNo}</div>}
                    </td>
                    <td className="px-2.5 py-2 text-left font-medium text-slate-600">{entry.createdByName}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

/** `unitNameByCode` — bug thật phát hiện lúc chủ dự án dùng thử: bỏ tham số này thì chuỗi hiện
 * MÃ đơn vị (vd `DV00015`) thay vì tên đã chọn (vd `Hộp`) vì `unitCode` lưu trên `drug_unit` chính
 * là mã tham chiếu `reference_catalog`, không phải tên hiển thị. */
function formatUnitChain(item: DrugSummary, unitNameByCode: Map<string, string>): string | null {
  const baseUnitCode = item.baseUnitCode;
  if (!baseUnitCode || item.units.length === 0) return null;
  const label = (code: string) => unitNameByCode.get(code) ?? code;
  const sorted = [...item.units].sort((a, b) => a.sortOrder - b.sortOrder);
  return formatUnitChainSequential(
    baseUnitCode,
    sorted.map((u) => ({ unitCode: u.unitCode, factorToUnitBelow: u.factorToUnitBelow })),
    label,
  );
}

/** Giá bán RIÊNG từng đơn vị (chỉ có ý nghĩa khi `unitPricingEnabled=true`, mở rộng GĐ1 — chủ dự án
 * yêu cầu trực tiếp: viên/vỉ/hộp có giá lệch tỷ lệ, không suy ra từ giá đơn vị nhỏ nhất). */
function formatUnitPrices(item: DrugSummary, unitNameByCode: Map<string, string>): string | null {
  const baseUnitCode = item.baseUnitCode;
  if (!baseUnitCode || item.defaultSellPrice === null) return null;
  const label = (code: string) => unitNameByCode.get(code) ?? code;
  const sorted = [...item.units].sort((a, b) => a.sortOrder - b.sortOrder);
  const parts = [`${label(baseUnitCode)}: ${item.defaultSellPrice.toLocaleString('vi-VN')} đ`];
  for (const u of sorted) {
    if (u.sellPrice !== null && u.sellPrice !== undefined) parts.push(`${label(u.unitCode)}: ${u.sellPrice.toLocaleString('vi-VN')} đ`);
  }
  return parts.join(' · ');
}

function DrugFormModal({
  mode,
  itemType,
  item,
  drugGroupOptions,
  drugRouteOptions,
  activeIngredientOptions,
  unitOptions,
  dosageFormCatalog,
  storageConditionCatalog,
  manufacturerCatalog,
  countryOfOriginCatalog,
  storageLocationCatalog,
  usageTimingOptions,
  usageTimingSentenceByCode,
  onCreateUsageTimingOption,
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
  dosageFormCatalog: CatalogCombobox;
  storageConditionCatalog: CatalogCombobox;
  manufacturerCatalog: CatalogCombobox;
  countryOfOriginCatalog: CatalogCombobox;
  storageLocationCatalog: CatalogCombobox;
  usageTimingOptions: ComboboxOption[];
  usageTimingSentenceByCode: Map<string, string>;
  onCreateUsageTimingOption: (name: string) => Promise<ComboboxOption>;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: {
    code: string;
    name: string;
    itemType: DrugItemType;
    isBatchManaged: boolean;
    baseUnitCode: string;
    defaultSellPrice: number;
    unitPricingEnabled: boolean;
    drugGroupCode?: string;
    routeCode?: string;
    nationalCode?: string;
    manufacturerCode: string;
    minStockAlert?: number;
    maxStockAlert?: number;
    controlType: DrugControlType;
    isPrescriptionOnly: boolean;
    registrationNumber?: string;
    dosageForm?: string;
    countryOfOrigin?: string;
    defaultDosage?: string;
    usageInstruction?: string;
    contraindications?: string;
    storageConditions?: string;
    storageLocation?: string;
    barcode?: string;
    packagingSpec?: string;
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
  // "Giá theo từng đơn vị cụ thể" (mở rộng GĐ1, chủ dự án yêu cầu trực tiếp) — mặc định TẮT, giá
  // mỗi bậc quy đổi suy ra từ defaultSellPrice theo tỷ lệ; bật thì mỗi bậc có giá riêng, bắt buộc.
  const [unitPricingEnabled, setUnitPricingEnabled] = useState(item?.unitPricingEnabled ?? false);
  const [drugGroupCode, setDrugGroupCode] = useState(item?.drugGroupCode ?? '');
  const [routeCode, setRouteCode] = useState(item?.routeCode ?? '');
  const [nationalCode, setNationalCode] = useState(item?.nationalCode ?? '');
  const [manufacturerCode, setManufacturerCode] = useState(item?.manufacturerCode ?? '');
  const [controlType, setControlType] = useState<DrugControlType>(item?.controlType ?? 'NORMAL');
  const [isPrescriptionOnly, setIsPrescriptionOnly] = useState(item?.isPrescriptionOnly ?? true);
  // Mở rộng #151 — 3 bắt buộc (Số ĐK/Dạng bào chế/Nước SX) + 5 tùy chọn, CHỈ có ý nghĩa với Thuốc.
  const [registrationNumber, setRegistrationNumber] = useState(item?.registrationNumber ?? '');
  const [dosageForm, setDosageForm] = useState(item?.dosageForm ?? '');
  const [countryOfOrigin, setCountryOfOrigin] = useState(item?.countryOfOrigin ?? '');
  const [defaultDosage, setDefaultDosage] = useState(item?.defaultDosage ?? '');
  const [usageInstruction, setUsageInstruction] = useState(item?.usageInstruction ?? '');
  const [contraindications, setContraindications] = useState(item?.contraindications ?? '');
  const [storageConditions, setStorageConditions] = useState(item?.storageConditions ?? '');
  const [storageLocation, setStorageLocation] = useState(item?.storageLocation ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [packagingSpec, setPackagingSpec] = useState(item?.packagingSpec ?? '');
  const [minStockAlert, setMinStockAlert] = useState(item?.minStockAlert !== null && item?.minStockAlert !== undefined ? String(item.minStockAlert) : '');
  const [maxStockAlert, setMaxStockAlert] = useState(item?.maxStockAlert !== null && item?.maxStockAlert !== undefined ? String(item.maxStockAlert) : '');
  const [ingredients, setIngredients] = useState<FormIngredientRow[]>(
    (item?.ingredients ?? []).map((i) => ({ activeIngredientCode: i.activeIngredientCode, strengthValueDisplay: String(i.strengthValue / 1000), strengthUnitCode: i.strengthUnitCode })),
  );
  const [units, setUnits] = useState<FormUnitRow[]>(
    (item?.units ?? []).map((u) => ({
      unitCode: u.unitCode,
      factorToUnitBelow: String(u.factorToUnitBelow),
      sellPriceDisplay: u.sellPrice !== null && u.sellPrice !== undefined ? String(u.sellPrice) : '',
    })),
  );

  const { flashVisible, triggerFlash } = useSaveFlash();
  const validUnitRows = units.filter((r) => r.unitCode && r.factorToUnitBelow.trim() !== '');
  const validIngredientRows = ingredients.filter((r) => r.activeIngredientCode && r.strengthValueDisplay.trim() !== '');
  const missingUnitPricing =
    unitPricingEnabled && (defaultSellPrice === undefined || validUnitRows.some((r) => r.sellPriceDisplay.trim() === ''));
  // Rà soát #151 đối chiếu tài liệu quy chuẩn kho thuốc/VTYT: Giá bán/Hãng sản xuất bắt buộc cho CẢ
  // 2 loại; Nhóm thuốc/Đường dùng/Hoạt chất/Số ĐK/Dạng bào chế/Nước SX bắt buộc CHỈ khi là Thuốc.
  const missingCommonRequiredFields = defaultSellPrice === undefined || manufacturerCode.trim() === '';
  const missingMedicineRequiredFields =
    isMedicine &&
    (drugGroupCode.trim() === '' ||
      routeCode.trim() === '' ||
      validIngredientRows.length === 0 ||
      registrationNumber.trim() === '' ||
      dosageForm.trim() === '' ||
      countryOfOrigin.trim() === '');
  const isInvalid =
    code.trim() === '' ||
    name.trim() === '' ||
    baseUnitCode.trim() === '' ||
    missingUnitPricing ||
    missingCommonRequiredFields ||
    missingMedicineRequiredFields;

  function buildDto() {
    return {
      code: code.trim(),
      name: name.trim(),
      itemType,
      isBatchManaged,
      baseUnitCode: baseUnitCode.trim(),
      // `isInvalid` đã chặn submit khi `defaultSellPrice===undefined` (bắt buộc, rà soát #151).
      defaultSellPrice: defaultSellPrice!,
      unitPricingEnabled,
      drugGroupCode: isMedicine ? drugGroupCode.trim() || undefined : undefined,
      routeCode: isMedicine ? routeCode.trim() || undefined : undefined,
      nationalCode: isMedicine ? nationalCode.trim() || undefined : undefined,
      // Bắt buộc cho CẢ 2 loại (rà soát #151) — `isInvalid` đã chặn submit khi rỗng.
      manufacturerCode: manufacturerCode.trim(),
      minStockAlert: minStockAlert.trim() === '' ? undefined : Number(minStockAlert),
      maxStockAlert: maxStockAlert.trim() === '' ? undefined : Number(maxStockAlert),
      // CHỈ có ý nghĩa với Thuốc — Vật tư y tế gửi giá trị trung tính, khớp default DB.
      controlType: isMedicine ? controlType : 'NORMAL',
      isPrescriptionOnly: isMedicine ? isPrescriptionOnly : true,
      // Mở rộng #151 — CHỈ có ý nghĩa với Thuốc, `isInvalid` đã chặn submit khi 3 trường bắt buộc
      // (registrationNumber/dosageForm/countryOfOrigin) còn trống.
      registrationNumber: isMedicine ? registrationNumber.trim() || undefined : undefined,
      dosageForm: isMedicine ? dosageForm.trim() || undefined : undefined,
      countryOfOrigin: isMedicine ? countryOfOrigin.trim() || undefined : undefined,
      defaultDosage: isMedicine ? defaultDosage.trim() || undefined : undefined,
      usageInstruction: isMedicine ? usageInstruction.trim() || undefined : undefined,
      contraindications: isMedicine ? contraindications.trim() || undefined : undefined,
      storageConditions: isMedicine ? storageConditions.trim() || undefined : undefined,
      storageLocation: isMedicine ? storageLocation.trim() || undefined : undefined,
      barcode: isMedicine ? barcode.trim() || undefined : undefined,
      // "Quy cách đóng gói" — KHÔNG giới hạn Thuốc như nhóm trường #151 phía trên (đảo ngược hoãn,
      // 17/09/2026), Vật tư y tế cũng đóng gói theo hộp/gói như thuốc.
      packagingSpec: packagingSpec.trim() || undefined,
      ingredients: isMedicine
        ? validIngredientRows.map((r) => ({
            activeIngredientCode: r.activeIngredientCode,
            strengthValue: Math.round(Number(r.strengthValueDisplay) * 1000),
            strengthUnitCode: r.strengthUnitCode,
          }))
        : [],
      units: validUnitRows.map((r, i) => ({
        unitCode: r.unitCode,
        sortOrder: i,
        factorToUnitBelow: Number(r.factorToUnitBelow),
        sellPrice: unitPricingEnabled && r.sellPriceDisplay.trim() !== '' ? Number(r.sellPriceDisplay) : undefined,
      })),
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
    setPackagingSpec('');
    userEditedPackagingSpecRef.current = false;
    codeInputRef.current?.focus();
    triggerFlash();
  }

  // Bug thật phát hiện lúc chủ dự án dùng thử: `unitCode` là MÃ tham chiếu reference_catalog (vd
  // `DV00015`), không phải tên hiển thị — phải tra qua `unitOptions`.
  const unitLabel = (code: string) => unitOptions.find((o) => o.value === code)?.label ?? code;
  const validUnitLinks = units.filter((r) => r.unitCode && r.factorToUnitBelow.trim() !== '').map((r) => ({ unitCode: r.unitCode, factorToUnitBelow: Number(r.factorToUnitBelow) || 0 }));
  const unitChainSummary = baseUnitCode && units.length > 0 ? formatUnitChainSequential(baseUnitCode, validUnitLinks, unitLabel) : null;

  // "Quy cách đóng gói" — tự điền gợi ý ghép từ Bảng quy đổi, tự CẬP NHẬT THEO MỖI BẬC MỚI THÊM
  // (chốt qua AskUserQuestion, 17/09/2026, sau khi phát hiện thật lúc verify: nếu chỉ điền lần đầu
  // rồi dừng hẳn thì xây bảng quy đổi DẦN — thêm Vỉ=10 Viên rồi thêm tiếp Hộp=10 Vỉ — sẽ bị kẹt lại
  // ở "Vỉ 10 viên" thay vì ra đúng "Hộp 10 vỉ x 10 viên"). CHỈ ngừng khi NGƯỜI DÙNG THẬT SỰ gõ tay
  // vào ô này (đánh dấu qua `userEditedPackagingSpecRef`, set trong `onChange` của input, KHÔNG set
  // khi chính effect này tự gán giá trị) — phân biệt rõ "hệ thống tự điền" với "người dùng tự sửa",
  // tránh mất phần chỉnh tay cho đóng gói phức tạp (vd "...viên nén bao phim"). Hồ sơ đã có sẵn
  // `packagingSpec` từ trước (mở form Sửa) coi như đã "người dùng tự sửa" ngay từ đầu — không đụng.
  const userEditedPackagingSpecRef = useRef(Boolean(item?.packagingSpec));
  useEffect(() => {
    if (userEditedPackagingSpecRef.current) return;
    const suggestion = suggestPackagingSpec(baseUnitCode, validUnitLinks, unitLabel);
    if (suggestion) setPackagingSpec(suggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUnitCode, JSON.stringify(validUnitLinks)]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onSubmit={handleSubmit}>
        {/* Header CỐ ĐỊNH cần tự có padding riêng — KHÔNG được nằm trong vùng cuộn (đúng khuôn
            `CashVoucherFormDialog.tsx`/`ExamTypeFormModal.tsx`, bug thật phát hiện lúc chủ dự án
            dùng thử: thiếu `px-5 pt-5` khiến icon/tiêu đề/nút đóng dính sát mép modal). */}
        <div className="flex-shrink-0 px-5 pt-5">
          <ModalHeader icon={isMedicine ? Pill : FirstAidKit} title={mode === 'create' ? `Thêm ${ITEM_TYPE_LABEL[itemType].toLowerCase()}` : `Sửa ${ITEM_TYPE_LABEL[itemType].toLowerCase()}`} onClose={onCancel} />
        </div>

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
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="sm:col-span-2 lg:col-span-4">
                <label htmlFor="drug-packaging-spec" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Quy cách đóng gói
                </label>
                <input
                  id="drug-packaging-spec"
                  value={packagingSpec}
                  onChange={(e) => {
                    userEditedPackagingSpecRef.current = true;
                    setPackagingSpec(e.target.value);
                  }}
                  placeholder="Tự ghép từ Bảng quy đổi bên dưới, sửa tự do nếu cần (vd: Hộp 1 lọ bột pha tiêm + 1 ống nước cất 5ml)"
                  className={inputClassName}
                />
              </div>
              {isMedicine && (
                <div>
                  <label htmlFor="drug-group" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Nhóm thuốc <span className="text-rose-500">*</span>
                  </label>
                  <Combobox id="drug-group" required value={drugGroupCode} onChange={setDrugGroupCode} options={drugGroupOptions} />
                </div>
              )}
              {isMedicine && (
                <div>
                  <label htmlFor="drug-route" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Đường dùng <span className="text-rose-500">*</span>
                  </label>
                  <Combobox id="drug-route" required value={routeCode} onChange={setRouteCode} options={drugRouteOptions} />
                </div>
              )}
              <div>
                <label htmlFor="drug-manufacturer" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Hãng sản xuất <span className="text-rose-500">*</span>
                </label>
                <Combobox
                  id="drug-manufacturer"
                  required
                  value={manufacturerCode}
                  onChange={setManufacturerCode}
                  options={manufacturerCatalog.options}
                  allowCreate
                  onCreateOption={manufacturerCatalog.onCreateOption}
                />
              </div>
              {isMedicine && (
                <div>
                  <label htmlFor="drug-national" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Mã thuốc QĐ 130
                  </label>
                  <input id="drug-national" value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} className={inputClassName} />
                </div>
              )}
              {isMedicine && (
                <div>
                  <label htmlFor="drug-registration-number" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Số đăng ký lưu hành <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="drug-registration-number"
                    required
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="Vd: VD-25432-16"
                    className={inputClassName}
                  />
                </div>
              )}
              {isMedicine && (
                <div>
                  <label htmlFor="drug-dosage-form" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Dạng bào chế <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="drug-dosage-form"
                    required
                    value={dosageForm}
                    onChange={setDosageForm}
                    options={dosageFormCatalog.options}
                    allowCreate
                    onCreateOption={dosageFormCatalog.onCreateOption}
                  />
                </div>
              )}
              {isMedicine && (
                <div>
                  <label htmlFor="drug-country-of-origin" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Nước sản xuất <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="drug-country-of-origin"
                    required
                    value={countryOfOrigin}
                    onChange={setCountryOfOrigin}
                    options={countryOfOriginCatalog.options}
                    allowCreate
                    onCreateOption={countryOfOriginCatalog.onCreateOption}
                  />
                </div>
              )}
              {isMedicine && (
                <div>
                  <label htmlFor="drug-control-type" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Phân loại kiểm soát
                  </label>
                  <Combobox id="drug-control-type" value={controlType} onChange={(v) => setControlType(v as DrugControlType)} options={CONTROL_TYPE_OPTIONS} />
                </div>
              )}
              {isMedicine && (
                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <input type="checkbox" checked={isPrescriptionOnly} onChange={(e) => setIsPrescriptionOnly(e.target.checked)} />
                    Yêu cầu kê đơn (Rx)
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* KHỐI 2 — Hoạt chất & hàm lượng (CHỈ Thuốc — vật tư y tế không có hoạt chất). */}
          {isMedicine && (
            <section className="relative rounded-lg border border-slate-200 p-6 pt-8">
              <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Hoạt chất &amp; hàm lượng</span>
              {validIngredientRows.length === 0 && <p className="mb-2 text-xs font-semibold text-rose-500">Bắt buộc ít nhất 1 hoạt chất.</p>}
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

            {/* "Giá theo từng đơn vị cụ thể" (mở rộng GĐ1, chủ dự án yêu cầu trực tiếp) — mặc định
                TẮT: giá suy ra theo tỷ lệ quy đổi (hành vi gốc). Bật: mỗi bậc có giá riêng, bắt
                buộc nhập đủ (xem `missingUnitPricing`). Chưa có `shared/ui/Toggle.tsx` dùng chung
                — pattern hand-roll này đã lặp 4 lần ở `features/clinic/*ConfigPane.tsx`, đây là
                lần thứ 5, cân nhắc trích xuất ở lượt sau (không chặn tính năng này). */}
            <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Giá theo từng đơn vị cụ thể</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tắt: giá mỗi đơn vị tự suy ra theo tỷ lệ quy đổi từ giá đơn vị nhỏ nhất. Bật: nhập giá riêng cho từng đơn vị (vd giá 1 Viên khác giá quy đổi từ 1 Vỉ/1 Hộp).
                </p>
              </div>
              <label className="relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center">
                <input type="checkbox" className="peer sr-only" checked={unitPricingEnabled} onChange={(e) => setUnitPricingEnabled(e.target.checked)} />
                <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600" />
                <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </label>
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
                  <span className="text-sm font-semibold text-slate-700">{i === 0 ? unitLabel(baseUnitCode) : unitLabel(units[i - 1]?.unitCode ?? '')}</span>
                  {unitPricingEnabled && (
                    <div className="relative ml-2 w-28">
                      <MoneyInput
                        id={`unit-price-${i}`}
                        value={row.sellPriceDisplay === '' ? undefined : Number(row.sellPriceDisplay)}
                        onChange={(v) => setUnits((rows) => rows.map((r, idx) => (idx === i ? { ...r, sellPriceDisplay: v === undefined ? '' : String(v) } : r)))}
                        placeholder="Giá bán"
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-2 pr-6 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">đ</span>
                    </div>
                  )}
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
              onClick={() => setUnits((rows) => [...rows, { unitCode: '', factorToUnitBelow: '', sellPriceDisplay: '' }])}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-blue-400 px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
            >
              <Plus size={15} weight="bold" aria-hidden="true" />
              Thêm bậc quy đổi
            </button>
            {unitChainSummary && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{unitChainSummary}</p>}

            <div className="mt-6 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3">
              <div>
                <label htmlFor="drug-price" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  {/* Đổi nhãn theo trạng thái công tắc — "mặc định" gây hiểu lầm khi bật (chủ dự án
                      phản hồi trực tiếp): lúc đó đây KHÔNG còn là giá gốc để suy ra giá khác, mà là
                      giá RIÊNG của đúng 1 đơn vị (đơn vị nhỏ nhất), ngang hàng Vỉ/Hộp. */}
                  {unitPricingEnabled ? `Giá bán (${baseUnitCode ? unitLabel(baseUnitCode) : 'đơn vị nhỏ nhất'})` : 'Giá bán mặc định'} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <MoneyInput id="drug-price" required value={defaultSellPrice} onChange={setDefaultSellPrice} className={`${inputClassName} pr-9`} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">đ</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {unitPricingEnabled ? 'Giá riêng của đúng đơn vị này, không suy ra từ đâu khác — bắt buộc.' : 'Theo đơn vị nhỏ nhất.'}
                </p>
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

          {/* KHỐI 4 — Hướng dẫn sử dụng & Bảo quản (mở rộng #151, CHỈ Thuốc). */}
          {isMedicine && (
            <section className="relative rounded-lg border border-slate-200 p-6 pt-8">
              <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                Hướng dẫn sử dụng &amp; Bảo quản
              </span>
              <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="drug-default-dosage" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Liều dùng mặc định
                  </label>
                  <input
                    id="drug-default-dosage"
                    value={defaultDosage}
                    onChange={(e) => setDefaultDosage(e.target.value)}
                    placeholder="Vd: Uống 1 viên/lần x 2 lần/ngày"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label htmlFor="drug-usage-instruction" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Cách dùng
                  </label>
                  <input
                    id="drug-usage-instruction"
                    value={usageInstruction}
                    onChange={(e) => setUsageInstruction(e.target.value)}
                    placeholder="Vd: Uống sau khi ăn no"
                    className={inputClassName}
                  />
                </div>
                <div>
                  {/* "Thời điểm dùng thuốc" (docs/DECISIONS.md #155) — CHỈ giúp soạn nhanh câu ở ô
                      "Cách dùng" bên cạnh, không lưu thành trường riêng nào trên `drug`. Chọn xong
                      tự reset về rỗng (không phải giá trị "đang chọn" cố định) vì đây là hành động
                      chèn câu, không phải field ràng buộc 1-giá-trị. */}
                  <label htmlFor="drug-usage-timing-suggest" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Gợi ý thời điểm dùng
                  </label>
                  <Combobox
                    id="drug-usage-timing-suggest"
                    value=""
                    onChange={(code) => {
                      const sentence = usageTimingSentenceByCode.get(code);
                      if (sentence) setUsageInstruction((prev) => appendSentence(prev, sentence));
                    }}
                    options={usageTimingOptions}
                    allowCreate
                    onCreateOption={onCreateUsageTimingOption}
                    placeholder="Chọn để chèn câu gợi ý..."
                  />
                </div>
                <div>
                  <label htmlFor="drug-storage-condition" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Điều kiện bảo quản
                  </label>
                  <Combobox
                    id="drug-storage-condition"
                    value={storageConditions}
                    onChange={setStorageConditions}
                    options={storageConditionCatalog.options}
                    allowCreate
                    onCreateOption={storageConditionCatalog.onCreateOption}
                  />
                </div>
                <div>
                  <label htmlFor="drug-storage-location" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Vị trí lưu kho
                  </label>
                  <Combobox
                    id="drug-storage-location"
                    value={storageLocation}
                    onChange={setStorageLocation}
                    options={storageLocationCatalog.options}
                    allowCreate
                    onCreateOption={storageLocationCatalog.onCreateOption}
                  />
                </div>
                <div>
                  <label htmlFor="drug-barcode" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Mã vạch
                  </label>
                  <input id="drug-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputClassName} />
                </div>
                <div className="sm:col-span-3">
                  <Textarea
                    id="drug-contraindications"
                    label="Chống chỉ định / Cảnh báo"
                    value={contraindications}
                    onChange={(e) => setContraindications(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </section>
          )}
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
