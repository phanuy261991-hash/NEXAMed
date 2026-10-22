import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, MagnifyingGlass, PencilSimple, Plus, Prohibit, Trash, TreeStructure } from '@phosphor-icons/react';
import type { BranchSummary } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { ACTION_CONFLICT_MESSAGE, describeSaveError, isConflictError } from '../../shared/api/save-error';
import { fetchOneFromList } from '../../shared/api/fetch-one-from-list';
import { useEditedRecordGuard } from '../../shared/hooks/useStaleRecordWatch';
import { listBranches } from './branch.api';
import { useBranchesQuery, useCreateBranchMutation, useUpdateBranchMutation } from './branch.queries';
import { BranchFormModal, type BranchSubmitDto } from './BranchFormModal';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface ModalState {
  mode: 'create' | 'edit';
  branch?: BranchSummary;
}

/**
 * "Chi nhánh" (docs/DECISIONS.md #231, mockup đã duyệt) — mục trong "Cấu hình hệ thống › Cấu hình phòng khám". Chi nhánh mặc định (viền trái xanh) không
 * ngưng được; Ngưng = ẩn, dữ liệu cũ giữ nguyên. PATCH kèm `version` (khoá lạc quan), cùng khuôn `WorkShiftPane`.
 */
export function BranchPane() {
  const canManage = useHasPermission('branch', 'manage');

  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<BranchSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useBranchesQuery(showInactive);
  const createMutation = useCreateBranchMutation();
  const updateMutation = useUpdateBranchMutation();

  const guard = useEditedRecordGuard({
    editing: modal?.mode === 'edit' ? modal.branch : undefined,
    watchKey: 'branch',
    fetchLatest: (id) => fetchOneFromList(() => listBranches(true), id),
    onFresh: (fresh) => setModal(fresh ? { mode: 'edit', branch: fresh } : null),
    onReloaded: () => void query.refetch(),
  });

  function handleActionError(err: unknown) {
    if (isConflictError(err)) {
      setActionError(ACTION_CONFLICT_MESSAGE);
      void query.refetch();
      return;
    }
    setActionError(describeSaveError(err));
  }

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
  }, [query.data, search]);

  async function handleSubmit(dto: BranchSubmitDto) {
    if (modal?.mode === 'create') {
      await createMutation.mutateAsync({ name: dto.name, address: dto.address ?? undefined, phone: dto.phone ?? undefined, facilityCode: dto.facilityCode });
    } else if (modal?.branch) {
      await updateMutation.mutateAsync({ id: modal.branch.id, body: { ...dto, version: modal.branch.version } });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-4 text-xs text-slate-500">
        Quản lý các chi nhánh của công ty. Mỗi chi nhánh có phòng, lịch hẹn, ca làm việc, quỹ và kho riêng; hồ sơ bệnh nhân, bảng giá và danh mục dùng chung cả công ty. Công ty chỉ có một chi nhánh thì không cần thêm gì.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-72">
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4" />
            Hiện cả chi nhánh đã ngưng
          </label>
        </div>
        {canManage && (
          <Button type="button" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Thêm chi nhánh
          </Button>
        )}
      </div>

      {actionError && <ErrorBanner message={actionError} />}
      {query.isError && <ErrorBanner message="Không tải được danh sách chi nhánh." onRetry={() => query.refetch()} />}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={TreeStructure} title="Không có chi nhánh nào khớp" description="Thử đổi từ khoá tìm kiếm hoặc bật “Hiện cả chi nhánh đã ngưng”." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                  <th className="w-28 px-4 py-2.5 text-left">Mã</th>
                  <th className="px-4 py-2.5 text-left">Tên chi nhánh</th>
                  <th className="px-4 py-2.5 text-left">Địa chỉ</th>
                  <th className="w-36 px-4 py-2.5 text-center">Điện thoại</th>
                  <th className="w-28 px-4 py-2.5 text-center">Mã KCB</th>
                  <th className="w-28 px-4 py-2.5 text-center">Nhân viên</th>
                  <th className="w-36 px-4 py-2.5 text-center">Trạng thái</th>
                  {canManage && <th className="w-24 px-4 py-2.5 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr
                    key={b.id}
                    className={`h-[60px] border-b border-l-4 border-slate-200 last:border-b-0 ${b.isDefault ? 'border-l-blue-600' : 'border-l-transparent'} ${b.isActive ? '' : 'opacity-60'}`}
                  >
                    <td className="px-4 py-2 text-left text-sm font-semibold text-slate-800">{b.code}</td>
                    <td className="px-4 py-2 text-left">
                      <div className="max-w-[320px] truncate font-semibold text-slate-900" title={b.name}>{b.name}</div>
                      {b.isDefault && <div className="text-xs font-medium text-slate-500">Mặc định</div>}
                    </td>
                    <td className="max-w-[360px] truncate px-4 py-2 text-left text-slate-600" title={b.address ?? undefined}>{b.address ?? '—'}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{b.phone ?? '—'}</td>
                    <td className="px-4 py-2 text-center" title={b.facilityCode ? 'Mã cơ sở khám chữa bệnh của chi nhánh' : 'Chưa nhập — dùng mã của công ty (Thông tin phòng khám)'}>
                      {b.facilityCode ? <span className="font-semibold tabular-nums text-slate-800">{b.facilityCode}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center font-semibold text-slate-800">{b.staffCount}</td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={b.isActive ? 'success' : 'neutral'}>{b.isActive ? 'Đang hoạt động' : 'Ngưng dùng'}</StatusBadge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => setModal({ mode: 'edit', branch: b })} />
                          {b.isActive && !b.isDefault && <RowActionButton icon={Trash} label="Ngưng dùng" tone="danger" onClick={() => setDeactivateTarget(b)} />}
                          {!b.isActive && (
                            <RowActionButton
                              icon={ArrowCounterClockwise}
                              label="Khôi phục"
                              tone="primary"
                              onClick={() => {
                                setActionError(null);
                                updateMutation.mutate({ id: b.id, body: { isActive: true, version: b.version } }, { onError: handleActionError });
                              }}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
          Viền trái xanh = chi nhánh mặc định (không ngưng được). Mã <strong>CN00001</strong> tự sinh. Ngưng dùng = ẩn, dữ liệu cũ giữ nguyên.
        </div>
      )}

      {modal && (
        <BranchFormModal
          key={modal.branch ? `${modal.branch.id}:${modal.branch.version}` : 'new'}
          stale={guard.stale}
          onReload={guard.reload}
          mode={modal.mode}
          branch={modal.branch}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {deactivateTarget && (
        <ConfirmDialog
          icon={Prohibit}
          tone="danger"
          title="Ngưng chi nhánh"
          rows={[{ label: 'Chi nhánh', value: deactivateTarget.name }]}
          note="Dữ liệu cũ giữ nguyên"
          onClose={() => setDeactivateTarget(null)}
          actions={
            <>
              <Button type="button" variant="secondary" onClick={() => setDeactivateTarget(null)}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={updateMutation.isPending}
                onClick={() => {
                  setActionError(null);
                  updateMutation.mutate(
                    { id: deactivateTarget.id, body: { isActive: false, version: deactivateTarget.version } },
                    {
                      onSuccess: () => setDeactivateTarget(null),
                      onError: (err) => {
                        handleActionError(err);
                        setDeactivateTarget(null);
                      },
                    },
                  );
                }}
              >
                Ngưng dùng
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
