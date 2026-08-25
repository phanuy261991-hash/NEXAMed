import { useState } from 'react';
import { MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react';
import type { DrugSummary } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useCreateDrugMutation, useDrugsQuery, useUpdateDrugMutation } from './drug.queries';

/** Khớp `drug.manage` (chỉ clinic_admin) — .claude/docs/security-audit.md. */
const MANAGE_ROLES = ['clinic_admin'];

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
  const user = useAuthStore((s) => s.user);
  const canManage = user?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);

  const query = useDrugsQuery({ q: debouncedSearch.trim() || undefined, includeInactive });
  const createMutation = useCreateDrugMutation();
  const updateMutation = useUpdateDrugMutation();

  const items = query.data?.items ?? [];

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
                    <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{drug.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{drug.name}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-600">{drug.activeIngredient ?? '—'}</td>
                    <td className="px-4 py-2 text-center font-medium text-slate-600">{drug.concentration ?? '—'}</td>
                    <td className="px-4 py-2 text-center font-medium text-slate-600">{drug.unit ?? '—'}</td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          drug.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {drug.isActive ? 'Đang dùng' : 'Đã ẩn'}
                      </span>
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

      {modal && (
        <DrugFormModal
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={(dto) => {
            const onSettled = () => setModal(null);
            if (modal.mode === 'create') {
              createMutation.mutate(
                { code: dto.code, name: dto.name, activeIngredient: dto.activeIngredient, unit: dto.unit, concentration: dto.concentration },
                { onSuccess: onSettled },
              );
            } else if (modal.item) {
              updateMutation.mutate(
                {
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
                },
                { onSuccess: onSettled },
              );
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
  onSubmit: (dto: { code: string; name: string; activeIngredient?: string; unit?: string; concentration?: string; isActive: boolean }) => void;
}) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [activeIngredient, setActiveIngredient] = useState(item?.activeIngredient ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [concentration, setConcentration] = useState(item?.concentration ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const isInvalid = code.trim() === '' || name.trim() === '';

  // Bọc `<form>` để Enter trong ô nhập tự submit — bắt buộc cho mọi form Thêm/Sửa trong app
  // (.claude/docs/ui-guidelines.md mục 4.4).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      activeIngredient: activeIngredient.trim() || undefined,
      unit: unit.trim() || undefined,
      concentration: concentration.trim() || undefined,
      isActive,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm thuốc mới' : 'Sửa thuốc'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="drug-code" className="text-sm font-semibold text-slate-800">
            Mã thuốc
          </label>
          <input id="drug-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputClassName} />
        </div>

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="drug-name" className="text-sm font-semibold text-slate-800">
            Tên thuốc
          </label>
          <input id="drug-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </div>

        <div className="mb-3.5 flex flex-col gap-1.5">
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

        <div className="mb-3.5 grid grid-cols-2 gap-3">
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
        </div>

        {mode === 'edit' && (
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Đang dùng (bỏ chọn để ẩn khỏi tìm kiếm lúc kê đơn)
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Lưu
          </Button>
        </div>
      </form>
    </div>
  );
}
