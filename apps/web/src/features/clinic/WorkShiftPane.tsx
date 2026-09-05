import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import type { WorkShiftItem } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { ApiError } from '../../shared/api/client';
import { useCreateWorkShiftMutation, useUpdateWorkShiftMutation, useWorkShiftsQuery } from './clinic.queries';
import { WORK_SHIFT_COLOR_HEX, WorkShiftFormModal, type WorkShiftSubmitDto } from './WorkShiftFormModal';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface ModalState {
  mode: 'create' | 'edit';
  item?: WorkShiftItem;
}

/**
 * "Ca làm việc" (docs/DECISIONS.md #101) — danh mục mẫu ca RIÊNG theo phòng khám (bảng `work_shift`
 * tenant-scoped, KHÔNG dùng chung `reference_catalog`). Dùng làm mục con trong pill "Cấu hình
 * phòng khám" (`ClinicConfigPage.tsx`) — CRUD đúng khuôn `RoomPane.tsx` (PATCH kèm `isActive`+
 * `version`, không endpoint deactivate/reactivate riêng).
 */
export function WorkShiftPane() {
  const canManage = useHasPermission('clinic_config', 'update');

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<WorkShiftItem | null>(null);

  const query = useWorkShiftsQuery();
  const createMutation = useCreateWorkShiftMutation();
  const updateMutation = useUpdateWorkShiftMutation();

  const mutationError = createMutation.error ?? updateMutation.error;
  const mutationErrorMessage = mutationError instanceof ApiError ? mutationError.message : undefined;

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }, [query.data, search]);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const rowSelection = useRowSelection(itemIds);

  // "Lưu và nhập tiếp" (.claude/docs/ui-guidelines.md mục 4.7) — đóng modal hay giữ để nhập tiếp
  // thuộc về form con (nó await Promise này), nơi này chỉ lo gửi request.
  async function handleSubmit(dto: WorkShiftSubmitDto) {
    if (modal?.mode === 'create') {
      await createMutation.mutateAsync(dto);
    } else if (modal?.item) {
      await updateMutation.mutateAsync({ id: modal.item.id, body: { ...dto, version: modal.item.version } });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-4 text-xs text-slate-500">
        Tạo và quản lý danh sách ca làm việc mẫu (khung giờ bắt đầu - kết thúc) phục vụ việc đăng ký và phân công lịch làm việc cho nhân viên.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-64">
          <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã hoặc tên..."
            className={`${inputClassName} pl-8`}
            style={{ fontSize: '14px' }}
          />
        </div>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm mới
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh mục ca làm việc." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={MagnifyingGlass} title="Chưa có ca làm việc nào" description="Bấm “Thêm mới” để tạo mẫu ca đầu tiên." />
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
                  <th className="px-4 py-2.5 text-left">Tên hiển thị</th>
                  <th className="w-28 px-4 py-2.5 text-center">Giờ bắt đầu</th>
                  <th className="w-28 px-4 py-2.5 text-center">Giờ kết thúc</th>
                  <th className="w-20 px-4 py-2.5 text-center">Thứ tự</th>
                  {canManage && <th className="w-24 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={`border-b border-slate-200 last:border-0 ${item.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center">
                      <SelectionCheckbox checked={rowSelection.isSelected(item.id)} onChange={() => rowSelection.toggle(item.id)} ariaLabel={`Chọn ${item.name}`} />
                    </td>
                    <td className="px-4 py-2 text-center text-sm font-bold text-slate-800">{item.code}</td>
                    <td className="px-4 py-2 text-left">
                      <span className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: WORK_SHIFT_COLOR_HEX[item.color] }} />
                        {item.name}
                        {!item.isActive && <StatusBadge tone="neutral">Đã ẩn</StatusBadge>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center font-semibold text-blue-600">{item.startTime}</td>
                    <td className="px-4 py-2 text-center font-semibold text-blue-600">{item.endTime}</td>
                    <td className="px-4 py-2 text-center text-slate-500">{item.sortOrder}</td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        {item.isActive ? (
                          <>
                            <button
                              type="button"
                              title="Sửa"
                              onClick={() => setModal({ mode: 'edit', item })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <PencilSimple size={15} weight="regular" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title="Xoá"
                              onClick={() => setDeactivateTarget(item)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash size={15} weight="regular" aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            title="Khôi phục"
                            onClick={() => updateMutation.mutate({ id: item.id, body: { isActive: true, version: item.version } })}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <ArrowCounterClockwise size={15} weight="regular" aria-hidden="true" />
                          </button>
                        )}
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
        <WorkShiftFormModal
          mode={modal.mode}
          item={modal.item}
          submitting={createMutation.isPending || updateMutation.isPending}
          submitError={mutationErrorMessage}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Xoá &quot;{deactivateTarget.name}&quot; khỏi danh mục?</p>
            <p className="mt-1.5 text-xs text-slate-500">Có thể khôi phục lại sau. Ca đã dùng để đăng ký lịch làm việc trước đó sẽ không bị thay đổi.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeactivateTarget(null)}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={updateMutation.isPending}
                onClick={() =>
                  updateMutation.mutate(
                    { id: deactivateTarget.id, body: { isActive: false, version: deactivateTarget.version } },
                    { onSuccess: () => setDeactivateTarget(null) },
                  )
                }
              >
                Xoá
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
