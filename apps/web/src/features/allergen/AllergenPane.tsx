import { useMemo, useState } from 'react';
import { MagnifyingGlass, PencilSimple, Plus, Warning } from '@phosphor-icons/react';
import type { AllergenGroupSummary, AllergenItem } from '@nexamed/shared';
import { useHasPermission } from '../auth/usePermission';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import {
  useAllergenGroupsQuery,
  useAllergensQuery,
  useCreateAllergenGroupMutation,
  useCreateAllergenMutation,
  useDeactivateAllergenGroupMutation,
  useDeactivateAllergenMutation,
  useReactivateAllergenGroupMutation,
  useReactivateAllergenMutation,
  useUpdateAllergenGroupMutation,
  useUpdateAllergenMutation,
} from './allergen.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * "Dị nguyên" (docs/DECISIONS.md #069) — bố cục master-detail (cột trái "Nhóm dị nguyên" lọc cột
 * phải "Dị nguyên"), tham khảo `DepartmentPane.tsx`. Khác Khoa/Phòng: "Nhóm dị nguyên" BẮT BUỘC
 * (không có lựa chọn "Không phân loại"), và cột trái LUÔN hiện đủ danh sách (không tuỳ chọn ẩn/hiện
 * theo `hasTypes` vì nhóm luôn cần tồn tại trước khi tạo được dị nguyên nào). "Xoá" = ẩn/khôi phục
 * qua 2 endpoint riêng (đúng khuôn `reference_catalog`, khác Khoa/Phòng dùng `isActive` trong PATCH)
 * vì dữ liệu không có `version` để optimistic-lock theo kiểu đó.
 */
export function AllergenPane() {
  const canManage = useHasPermission('allergen_catalog', 'manage');

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupModal, setGroupModal] = useState<{ mode: 'create' | 'edit'; group?: AllergenGroupSummary } | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; allergen?: AllergenItem } | null>(null);

  const groupsQuery = useAllergenGroupsQuery(true);
  const query = useAllergensQuery(true);
  const createGroupMutation = useCreateAllergenGroupMutation();
  const updateGroupMutation = useUpdateAllergenGroupMutation();
  const deactivateGroupMutation = useDeactivateAllergenGroupMutation();
  const reactivateGroupMutation = useReactivateAllergenGroupMutation();
  const createMutation = useCreateAllergenMutation();
  const updateMutation = useUpdateAllergenMutation();
  const deactivateMutation = useDeactivateAllergenMutation();
  const reactivateMutation = useReactivateAllergenMutation();

  const groups = groupsQuery.data?.items ?? [];

  const visibleGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (q === '') return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, groupSearch]);

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    if (selectedGroupId === null) return all;
    return all.filter((a) => a.allergenGroupId === selectedGroupId);
  }, [query.data, selectedGroupId]);

  const itemIds = useMemo(() => items.map((a) => a.id), [items]);
  const rowSelection = useRowSelection(itemIds);

  function toggleGroupActive(group: AllergenGroupSummary) {
    if (group.isActive) deactivateGroupMutation.mutate(group.id);
    else reactivateGroupMutation.mutate(group.id);
  }

  function toggleActive(allergen: AllergenItem) {
    if (allergen.isActive) deactivateMutation.mutate(allergen.id);
    else reactivateMutation.mutate(allergen.id);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {(query.isError || groupsQuery.isError) && (
        <ErrorBanner message="Không tải được danh mục Dị nguyên." onRetry={() => { void query.refetch(); void groupsQuery.refetch(); }} />
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Cột "Nhóm dị nguyên" LUÔN hiện — lối vào duy nhất để tạo nhóm đầu tiên, cùng DepartmentPane. KHÔNG hiện cột/nhãn "Mã" (đã chốt). */}
        <div className="flex min-h-0 w-56 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Nhóm dị nguyên</span>
            {canManage && (
              <button
                type="button"
                title="Thêm nhóm"
                onClick={() => setGroupModal({ mode: 'create' })}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus size={14} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>
          {groups.length > 0 ? (
            <>
              <div className="relative border-b border-slate-100 px-2.5 py-2">
                <MagnifyingGlass
                  size={13}
                  weight="regular"
                  className="pointer-events-none absolute left-4.5 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="Tìm nhóm..."
                  className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <ul className="flex-1 overflow-y-auto scroll-hover py-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(null)}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm font-medium ${
                      selectedGroupId === null ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Tất cả
                  </button>
                </li>
                {visibleGroups.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">Không tìm thấy nhóm nào.</li>}
                {visibleGroups.map((group) => {
                  const selected = selectedGroupId === group.id;
                  return (
                    <li key={group.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => setSelectedGroupId(group.id)}
                        className={`flex-1 truncate px-3 py-2 text-left text-sm font-medium ${
                          selected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                        } ${group.isActive ? '' : 'opacity-50'}`}
                      >
                        {group.name}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => setGroupModal({ mode: 'edit', group })}
                          className="mr-1.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 group-hover:text-slate-400"
                        >
                          <PencilSimple size={13} weight="regular" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="px-3 py-3 text-xs text-slate-400">Chưa có nhóm nào. Bấm + để thêm.</p>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Dị nguyên</span>
            {canManage && (
              <Button type="button" onClick={() => setModal({ mode: 'create' })} disabled={groups.length === 0}>
                <Plus size={16} weight="bold" aria-hidden="true" />
                Thêm Dị nguyên
              </Button>
            )}
          </div>

          {query.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {query.isSuccess && items.length === 0 && (
            <EmptyState
              icon={Warning}
              title="Chưa có Dị nguyên nào"
              description={groups.length === 0 ? 'Tạo Nhóm dị nguyên trước, sau đó thêm Dị nguyên thuộc nhóm.' : 'Thêm mới để bắt đầu danh mục.'}
            />
          )}

          {/* Danh sách có thể dài (150+ dòng "Tất cả") — bọc riêng 1 vùng cuộn dọc (min-h-0 +
              overflow-y-auto) thay vì để bảng tự giãn theo nội dung rồi bị `overflow-hidden` của
              khung ngoài cắt cứng, không cuộn được (lỗi thật chủ dự án báo cáo). Tiêu đề cột dính
              (sticky) để vẫn thấy khi cuộn sâu. */}
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
                      <th className="px-4 py-2.5 text-left">Tên Dị nguyên</th>
                      <th className="w-40 px-4 py-2.5 text-center">Nhóm dị nguyên</th>
                      <th className="w-36 px-4 py-2.5 text-center">Trạng thái</th>
                      {canManage && <th className="w-20 px-4 py-2.5 text-center">Sửa</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((allergen) => (
                      <tr key={allergen.id} className={`border-b border-slate-200 last:border-0 ${allergen.isActive ? '' : 'opacity-50'}`}>
                        <td className="px-4 py-2 text-center">
                          <SelectionCheckbox
                            checked={rowSelection.isSelected(allergen.id)}
                            onChange={() => rowSelection.toggle(allergen.id)}
                            ariaLabel={`Chọn ${allergen.name}`}
                          />
                        </td>
                        {/* Mã không bấm được → đen, không xanh (.claude/docs/ui-guidelines.md mục 9 nhóm 2) — tự sinh, không sửa qua UI này. */}
                        <td className="px-4 py-2 text-center font-semibold text-slate-800">{allergen.code}</td>
                        <td className="px-4 py-2 text-left font-medium text-slate-900">{allergen.name}</td>
                        <td className="px-4 py-2 text-center font-medium text-slate-600">{allergen.allergenGroupName}</td>
                        <td className="px-4 py-2 text-center">
                          <StatusBadge tone={allergen.isActive ? 'success' : 'neutral'}>
                            {allergen.isActive ? 'Đang hoạt động' : 'Ngưng dùng'}
                          </StatusBadge>
                        </td>
                        {canManage && (
                          <td className="px-4 py-2 text-center">
                            <button
                              type="button"
                              title="Sửa"
                              onClick={() => setModal({ mode: 'edit', allergen })}
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
        </div>
      </div>

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {groupModal && (
        <AllergenGroupFormModal
          mode={groupModal.mode}
          group={groupModal.group}
          submitting={createGroupMutation.isPending || updateGroupMutation.isPending || deactivateGroupMutation.isPending || reactivateGroupMutation.isPending}
          onCancel={() => setGroupModal(null)}
          onToggleActive={groupModal.group ? () => toggleGroupActive(groupModal.group!) : undefined}
          onSubmit={(dto) => {
            const onSettled = () => setGroupModal(null);
            if (groupModal.mode === 'create') {
              createGroupMutation.mutate({ name: dto.name }, { onSuccess: onSettled });
            } else if (groupModal.group) {
              updateGroupMutation.mutate({ id: groupModal.group.id, body: { name: dto.name } }, { onSuccess: onSettled });
            }
          }}
        />
      )}

      {modal && (
        <AllergenFormModal
          mode={modal.mode}
          allergen={modal.allergen}
          groups={groups.filter((g) => g.isActive)}
          defaultGroupId={selectedGroupId ?? undefined}
          submitting={createMutation.isPending || updateMutation.isPending || deactivateMutation.isPending || reactivateMutation.isPending}
          onCancel={() => setModal(null)}
          onToggleActive={modal.allergen ? () => toggleActive(modal.allergen!) : undefined}
          onSubmit={(dto) => {
            const onSettled = () => setModal(null);
            if (modal.mode === 'create') {
              createMutation.mutate({ allergenGroupId: dto.allergenGroupId, name: dto.name }, { onSuccess: onSettled });
            } else if (modal.allergen) {
              updateMutation.mutate(
                { id: modal.allergen.id, body: { allergenGroupId: dto.allergenGroupId, name: dto.name } },
                { onSuccess: onSettled },
              );
            }
          }}
        />
      )}
    </div>
  );
}

function AllergenGroupFormModal({
  mode,
  group,
  submitting,
  onCancel,
  onSubmit,
  onToggleActive,
}: {
  mode: 'create' | 'edit';
  group?: AllergenGroupSummary;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string }) => void;
  onToggleActive?: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const isInvalid = name.trim() === '';

  // Bọc `<form>` để Enter trong ô nhập tự submit — bắt buộc cho mọi form Thêm/Sửa (`.claude/docs/
  // ui-guidelines.md` mục 4.4).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({ name: name.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm Nhóm dị nguyên' : 'Sửa Nhóm dị nguyên'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="allergen-group-name" className="text-sm font-semibold text-slate-800">
            Tên nhóm
          </label>
          <input
            id="allergen-group-name"
            placeholder="Ví dụ: Nhóm thuốc"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {mode === 'edit' && onToggleActive ? (
            <Button type="button" variant="secondary" onClick={onToggleActive} disabled={submitting}>
              {group?.isActive ? 'Ẩn nhóm' : 'Khôi phục'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Huỷ
            </Button>
            <Button type="submit" loading={submitting} disabled={isInvalid}>
              Lưu
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function AllergenFormModal({
  mode,
  allergen,
  groups,
  defaultGroupId,
  submitting,
  onCancel,
  onSubmit,
  onToggleActive,
}: {
  mode: 'create' | 'edit';
  allergen?: AllergenItem;
  groups: AllergenGroupSummary[];
  /** Nhóm đang được chọn ở cột trái lúc mở modal tạo mới — mồi sẵn thay vì luôn về nhóm đầu danh sách. */
  defaultGroupId?: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dto: { name: string; allergenGroupId: string }) => void;
  onToggleActive?: () => void;
}) {
  const [name, setName] = useState(allergen?.name ?? '');
  const [allergenGroupId, setAllergenGroupId] = useState(allergen?.allergenGroupId ?? defaultGroupId ?? groups[0]?.id ?? '');

  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));
  const isInvalid = name.trim() === '' || allergenGroupId === '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    onSubmit({ name: name.trim(), allergenGroupId });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <h2 className="text-[15px] font-semibold text-slate-900">{mode === 'create' ? 'Thêm Dị nguyên' : 'Sửa Dị nguyên'}</h2>

        <div className="mb-3.5 mt-4 flex flex-col gap-1.5">
          <label htmlFor="allergen-group" className="text-sm font-semibold text-slate-800">
            Nhóm dị nguyên
          </label>
          <Combobox id="allergen-group" value={allergenGroupId} onChange={setAllergenGroupId} options={groupOptions} />
        </div>

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="allergen-name" className="text-sm font-semibold text-slate-800">
            Tên Dị nguyên
          </label>
          <input
            id="allergen-name"
            placeholder="Ví dụ: Penicillin"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {mode === 'edit' && onToggleActive ? (
            <Button type="button" variant="secondary" onClick={onToggleActive} disabled={submitting}>
              {allergen?.isActive ? 'Ẩn' : 'Khôi phục'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Huỷ
            </Button>
            <Button type="submit" loading={submitting} disabled={isInvalid}>
              Lưu
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
