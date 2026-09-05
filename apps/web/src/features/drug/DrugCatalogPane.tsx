import { useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, PencilSimple, Pill, Plus } from '@phosphor-icons/react';
import type { DrugSummary } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
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
import { useCreateDrugMutation, useDrugsQuery, useUpdateDrugMutation } from './drug.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface ModalState {
  mode: 'create' | 'edit';
  item?: DrugSummary;
}

/**
 * Danh mục thuốc (Sprint 4, S4-03) — THEO TENANT, phòng khám tự nhập (không kho, không giá bán —
 * "Trường hợp A" đã chốt, xem docs/DECISIONS.md 2026-08-25). Mount tại `/admin/catalog-pharmacy`
 * (thay `ComingSoonPage`), đúng khuôn `ReferenceCatalogPane.tsx`/`RoomPane.tsx` (isActive sửa qua
 * chính modal Sửa, không endpoint deactivate/reactivate riêng — cùng cách `room` vì `drug` có
 * `version`/optimistic lock).
 */
export function DrugCatalogPane() {
  const canManage = useHasPermission('drug', 'manage');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);

  const query = useDrugsQuery({ q: debouncedSearch.trim() || undefined, includeInactive });
  const createMutation = useCreateDrugMutation();
  const updateMutation = useUpdateDrugMutation();

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const itemIds = useMemo(() => items.map((d) => d.id), [items]);
  const rowSelection = useRowSelection(itemIds);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative w-64">
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
              Hiện cả thuốc đã ẩn
            </label>
          )}
        </div>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm thuốc
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh mục thuốc." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={MagnifyingGlass} title="Chưa có thuốc nào" description="Thêm thuốc mới hoặc thử từ khoá khác." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="w-10 px-4 py-2.5 text-center">
                    <SelectionCheckbox
                      checked={rowSelection.allLoadedSelected}
                      indeterminate={rowSelection.someLoadedSelected}
                      onChange={rowSelection.toggleAll}
                      ariaLabel="Chọn tất cả"
                    />
                  </th>
                  <th className="w-24 px-4 py-2.5 text-center">Mã</th>
                  <th className="px-4 py-2.5 text-left">Tên thuốc</th>
                  <th className="px-4 py-2.5 text-left">Hoạt chất</th>
                  <th className="w-28 px-4 py-2.5 text-center">Hàm lượng</th>
                  <th className="w-20 px-4 py-2.5 text-center">Đơn vị</th>
                  <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>
                  {canManage && <th className="w-20 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((drug) => (
                  <tr key={drug.id} className={`border-b border-slate-200 last:border-0 ${drug.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center">
                      <SelectionCheckbox checked={rowSelection.isSelected(drug.id)} onChange={() => rowSelection.toggle(drug.id)} ariaLabel={`Chọn ${drug.name}`} />
                    </td>
                    <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{drug.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{drug.name}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-600">{drug.activeIngredient ?? '—'}</td>
                    <td className="px-4 py-2 text-center font-medium text-slate-600">{drug.concentration ?? '—'}</td>
                    <td className="px-4 py-2 text-center font-medium text-slate-600">{drug.unit ?? '—'}</td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={drug.isActive ? 'success' : 'neutral'}>{drug.isActive ? 'Đang dùng' : 'Đã ẩn'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setModal({ mode: 'edit', item: drug })}
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

      {modal && (
        <DrugFormModal
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={async (dto) => {
            // "Lưu và nhập tiếp" (.claude/docs/ui-guidelines.md mục 4.7) — đóng modal hay giữ để
            // nhập tiếp thuộc về form con (nó await Promise này), nơi này chỉ lo gửi request.
            if (modal.mode === 'create') {
              await createMutation.mutateAsync({ code: dto.code, name: dto.name, activeIngredient: dto.activeIngredient, unit: dto.unit, concentration: dto.concentration });
            } else if (modal.item) {
              await updateMutation.mutateAsync({
                id: modal.item.id,
                body: {
                  code: dto.code,
                  name: dto.name,
                  activeIngredient: dto.activeIngredient ?? null,
                  unit: dto.unit ?? null,
                  concentration: dto.concentration ?? null,
                  isActive: dto.isActive,
                  version: modal.item.version,
                },
              });
            }
          }}
        />
      )}
    </div>
  );
}

function DrugFormModal({
  mode,
  item,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: DrugSummary;
  submitting: boolean;
  onCancel: () => void;
  /** Trả `Promise` — `handleSubmit`/`handleSaveAndContinue` await để biết lưu xong mới đóng modal
   * hoặc làm trống form (`.claude/docs/ui-guidelines.md` mục 4.7). */
  onSubmit: (dto: { code: string; name: string; activeIngredient?: string; unit?: string; concentration?: string; isActive: boolean }) => Promise<void>;
}) {
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [activeIngredient, setActiveIngredient] = useState(item?.activeIngredient ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [concentration, setConcentration] = useState(item?.concentration ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const { flashVisible, triggerFlash } = useSaveFlash();
  const isInvalid = code.trim() === '' || name.trim() === '';

  function buildDto() {
    return {
      code: code.trim(),
      name: name.trim(),
      activeIngredient: activeIngredient.trim() || undefined,
      unit: unit.trim() || undefined,
      concentration: concentration.trim() || undefined,
      isActive,
    };
  }

  function resetForNextEntry() {
    setCode('');
    setName('');
    setActiveIngredient('');
    setUnit('');
    setConcentration('');
    codeInputRef.current?.focus();
  }

  // Bọc `<form>` để Enter trong ô nhập tự submit — bắt buộc cho mọi form Thêm/Sửa trong app
  // (.claude/docs/ui-guidelines.md mục 4.4).
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    await onSubmit(buildDto());
    onCancel();
  }

  // "Lưu và nhập tiếp" (mục 4.7) — nút `type="button"` riêng, không đụng nút submit mặc định.
  async function handleSaveAndContinue() {
    if (isInvalid) return;
    await onSubmit(buildDto());
    resetForNextEntry();
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={Pill} title={mode === 'create' ? 'Thêm thuốc mới' : 'Sửa thuốc'} onClose={onCancel} />

        <SaveFlashBanner visible={flashVisible} />

        {/* Bố cục lưới ngang bắt buộc cho mọi form (.claude/docs/ui-guidelines.md mục 4.1). */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="drug-code" className="text-sm font-semibold text-slate-800">
              Mã thuốc
            </label>
            <input id="drug-code" ref={codeInputRef} value={code} onChange={(e) => setCode(e.target.value)} className={inputClassName} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="drug-name" className="text-sm font-semibold text-slate-800">
              Tên thuốc
            </label>
            <input id="drug-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="drug-ingredient" className="text-sm font-semibold text-slate-800">
              Hoạt chất
            </label>
            <input
              id="drug-ingredient"
              placeholder="Ví dụ: Paracetamol"
              value={activeIngredient}
              onChange={(e) => setActiveIngredient(e.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="drug-concentration" className="text-sm font-semibold text-slate-800">
              Hàm lượng
            </label>
            <input
              id="drug-concentration"
              placeholder="Ví dụ: 500mg"
              value={concentration}
              onChange={(e) => setConcentration(e.target.value)}
              className={inputClassName}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="drug-unit" className="text-sm font-semibold text-slate-800">
              Đơn vị
            </label>
            <input id="drug-unit" placeholder="Ví dụ: Viên" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClassName} />
          </div>

          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 sm:col-span-2">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Đang dùng (bỏ chọn để ẩn khỏi tìm kiếm lúc kê đơn)
            </label>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
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
