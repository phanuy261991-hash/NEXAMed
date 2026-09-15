import { useRef, useState } from 'react';
import { PencilSimple, Plus, Warehouse as WarehouseIcon } from '@phosphor-icons/react';
import type { WarehouseSummary } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { SaveFlashBanner } from '../../shared/ui/SaveFlashBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useSaveFlash } from '../../shared/hooks/useSaveFlash';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useCreateWarehouseMutation, useUpdateWarehouseMutation, useWarehousesQuery } from './warehouse.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const NO_DEPARTMENT_VALUE = '';

interface ModalState {
  mode: 'create' | 'edit';
  item?: WarehouseSummary;
}

/** Kho (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — pill con của "Danh mục Thuốc & Vật
 * tư". Đúng 1 tenant có đúng 1 kho mặc định — chọn "Đặt làm kho mặc định" tự bỏ cờ khỏi kho cũ
 * (server xử lý, xem `WarehouseService.clearDefaultExcept`). Mã tự sinh (tiền tố KH). */
export function WarehousePane() {
  const canManage = useHasPermission('drug', 'manage');
  const [modal, setModal] = useState<ModalState | null>(null);

  const query = useWarehousesQuery();
  const departmentOptionsQuery = useDepartmentOptionsQuery();
  const createMutation = useCreateWarehouseMutation();
  const updateMutation = useUpdateWarehouseMutation();

  const items = query.data?.items ?? [];
  const departments = departmentOptionsQuery.data?.items ?? [];
  const itemIds = items.map((w) => w.id);
  const rowSelection = useRowSelection(itemIds);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm kho
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh sách kho." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && <EmptyState icon={WarehouseIcon} title="Chưa có kho nào" description="Mỗi tenant tự động có 1 Kho chính khi khởi tạo." />}

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
                  <th className="w-32 px-4 py-2.5 text-center">Mã</th>
                  <th className="px-4 py-2.5 text-left">Tên kho</th>
                  <th className="px-4 py-2.5 text-left">Khoa/Phòng quản lý</th>
                  <th className="w-32 px-4 py-2.5 text-center">Kho mặc định</th>
                  <th className="w-32 px-4 py-2.5 text-center">Trạng thái</th>
                  {canManage && <th className="w-20 px-4 py-2.5 text-center">Sửa</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((warehouse) => (
                  <tr key={warehouse.id} className={`border-b border-slate-200 last:border-0 ${warehouse.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center">
                      <SelectionCheckbox checked={rowSelection.isSelected(warehouse.id)} onChange={() => rowSelection.toggle(warehouse.id)} ariaLabel={`Chọn ${warehouse.name}`} />
                    </td>
                    <td className="px-4 py-2 text-center font-bold text-slate-800">{warehouse.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{warehouse.name}</td>
                    <td className="px-4 py-2 text-left text-slate-600">{warehouse.departmentName ?? '—'}</td>
                    <td className="px-4 py-2 text-center">
                      {warehouse.isDefault ? <StatusBadge tone="info">Mặc định</StatusBadge> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={warehouse.isActive ? 'success' : 'neutral'}>{warehouse.isActive ? 'Đang dùng' : 'Ngưng'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setModal({ mode: 'edit', item: warehouse })}
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
        <WarehouseFormModal
          mode={modal.mode}
          item={modal.item}
          departments={departments}
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

function WarehouseFormModal({
  mode,
  item,
  departments,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  item?: WarehouseSummary;
  departments: { id: string; name: string }[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; departmentId?: string; isDefault?: boolean }) => Promise<void>;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item?.name ?? '');
  const [departmentId, setDepartmentId] = useState(item?.departmentId ?? NO_DEPARTMENT_VALUE);
  const [isDefault, setIsDefault] = useState(item?.isDefault ?? false);
  const { flashVisible, triggerFlash } = useSaveFlash();
  const isInvalid = name.trim() === '';

  const departmentOptions = [{ value: NO_DEPARTMENT_VALUE, label: 'Không gắn Khoa/Phòng nào' }, ...departments.map((d) => ({ value: d.id, label: d.name }))];

  function buildDto() {
    return { name: name.trim(), departmentId: departmentId === NO_DEPARTMENT_VALUE ? undefined : departmentId, isDefault };
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
    setName('');
    setIsDefault(false);
    nameInputRef.current?.focus();
    triggerFlash();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={WarehouseIcon} title={mode === 'create' ? 'Thêm kho' : 'Sửa kho'} onClose={onCancel} />

        <SaveFlashBanner visible={flashVisible} />

        <div className="mb-4 mt-4 grid grid-cols-1 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="warehouse-name" className="text-sm font-semibold text-slate-800">
              Tên kho
            </label>
            <input id="warehouse-name" ref={nameInputRef} placeholder="Ví dụ: Tủ trực phòng khám 1" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="warehouse-department" className="text-sm font-semibold text-slate-800">
              Khoa/Phòng quản lý
            </label>
            <Combobox id="warehouse-department" value={departmentId} onChange={setDepartmentId} options={departmentOptions} />
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Đặt làm kho mặc định (thay thế kho mặc định hiện có, nếu có)
          </label>
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
